-- 0061: scoped, bounded operational work queue; does not approve or post journals.
BEGIN;
CREATE TABLE IF NOT EXISTS rticore_fg_retry_attempts (
 tenant_id text NOT NULL,legal_entity_id text NOT NULL,event_id text NOT NULL,attempt_no integer NOT NULL CHECK(attempt_no BETWEEN 1 AND 8),
 attempted_by text NOT NULL,outcome text NOT NULL CHECK(outcome IN ('drafted','linked','retry','manual_review')),
 reason_code text NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 100),
 attempted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,event_id,attempt_no),
 FOREIGN KEY(tenant_id,event_id) REFERENCES rticore_finance_integration_events(tenant_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id)
);
DROP TRIGGER IF EXISTS rticore_fg_retry_attempt_immutable ON rticore_fg_retry_attempts;
CREATE TRIGGER rticore_fg_retry_attempt_immutable BEFORE UPDATE OR DELETE ON rticore_fg_retry_attempts FOR EACH ROW EXECUTE FUNCTION rticore_fg_immutable();

CREATE OR REPLACE FUNCTION rticore_fg_maintenance_actor(p_tenant text,p_entity text,p_actor text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $fg$
 SELECT coalesce(rticore_fg_actor_role(p_tenant,p_entity,p_actor)='finance',false) AND EXISTS(
 SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=p_tenant AND a.legal_entity_id=p_entity AND lower(a.email)=lower(p_actor) AND a.status='approved' AND a.can_make=1 AND a.finance_role IN ('financial_controller','finance_manager','accounting_officer') AND a.business_unit_id IS NULL AND a.department_id IS NULL)
$fg$;
CREATE OR REPLACE FUNCTION rticore_fg_retry_due(p_tenant text,p_entity text,p_actor text,p_period text,p_limit integer)
RETURNS TABLE(event_id text,outcome text,reason_code text) LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE x record; rule_count bigint; rule_id text; journal_count bigint; journal_id text; action_name text; policy_name text; attempt integer; result jsonb; err text; code text;
BEGIN
 IF NOT rticore_fg_maintenance_actor(p_tenant,p_entity,p_actor) OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
 FOR x IN SELECT e.id,l.transaction_type,l.credit_amount,l.lot_id,lot.invoice_id,e.event_type,
 coalesce(a.n,0) AS prior_attempts,a.last_outcome,a.last_attempt
 FROM rticore_finance_integration_events e
 JOIN rticore_flexguard_enterprise_ledger l ON l.tenant_id=e.tenant_id AND l.legal_entity_id=e.legal_entity_id AND l.finance_outbox_event_id=e.id AND l.id=e.source_document_id
 JOIN rticore_flexguard_credit_lots lot ON lot.tenant_id=l.tenant_id AND lot.legal_entity_id=l.legal_entity_id AND lot.id=l.lot_id
 LEFT JOIN LATERAL (SELECT z.attempt_no AS n,z.outcome AS last_outcome,z.attempted_at AS last_attempt FROM rticore_fg_retry_attempts z WHERE z.tenant_id=e.tenant_id AND z.event_id=e.id ORDER BY z.attempt_no DESC LIMIT 1) a ON true
 WHERE e.tenant_id=p_tenant AND e.legal_entity_id=p_entity AND e.direction='outbox' AND e.source_system='RTICORE' AND e.status='received'
 AND e.event_type IN ('flexguard.credit_purchased','flexguard.credit_consumed','flexguard.credit_expired','flexguard.credit_adjusted')
 AND coalesce(a.n,0)<8 AND (a.last_outcome IS NULL OR a.last_outcome='retry')
 AND (a.last_attempt IS NULL OR a.last_attempt+make_interval(mins=>least(1440,5*(2^least(a.n,8))::integer))<=CURRENT_TIMESTAMP)
 ORDER BY e.event_timestamp,e.id LIMIT p_limit FOR UPDATE OF e SKIP LOCKED
 LOOP
  attempt:=x.prior_attempts+1;event_id:=x.id;outcome:='retry';reason_code:='DEPENDENCY_NOT_READY';
  BEGIN
   policy_name:=CASE WHEN x.event_type='flexguard.credit_adjusted' THEN x.event_type||CASE WHEN x.credit_amount>0 THEN '.positive' ELSE '.negative' END ELSE x.event_type END;
   SELECT count(*),min(r.id) INTO rule_count,rule_id FROM rticore_finance_posting_rules r WHERE r.tenant_id=p_tenant AND r.legal_entity_id=p_entity AND r.business_event=policy_name AND r.status='approved' AND r.effective_from<=to_char(CURRENT_DATE,'YYYY-MM-DD') AND (r.effective_to IS NULL OR r.effective_to>=to_char(CURRENT_DATE,'YYYY-MM-DD')) AND r.service_category IN ('*','FlexGuard') AND r.tax_treatment IN ('*','IDR');
   IF rule_count<>1 THEN outcome:='manual_review';reason_code:='APPROVED_POLICY_MISSING_OR_AMBIGUOUS';
   ELSE
    journal_id:=NULL;action_name:='draft';
    IF x.transaction_type IN ('purchase','top_up') THEN
     action_name:='link_purchase';
     SELECT count(*),min(j.id) INTO journal_count,journal_id FROM rticore_gl_journals j WHERE j.tenant_id=p_tenant AND j.legal_entity_id=p_entity AND j.source_type='ar' AND j.source_key=x.invoice_id AND j.status='posted';
     IF journal_count<>1 THEN RAISE EXCEPTION 'FLEXGUARD_POSTED_JOURNAL_REQUIRED'; END IF;
    ELSE
     IF p_period IS NULL THEN RAISE EXCEPTION 'FLEXGUARD_PERIOD_CLOSED'; END IF;
    END IF;
    result:=rticore_fg_dock(p_tenant,p_entity,p_actor,x.id,action_name,rule_id,p_period,journal_id);
    IF result->>'status'<>'validated' THEN RAISE EXCEPTION 'FLEXGUARD_DOCKING_STATUS_INVALID'; END IF;
    outcome:=CASE WHEN action_name='draft' THEN 'drafted' ELSE 'linked' END;reason_code:='INDEPENDENT_APPROVAL_OR_ACK_REQUIRED';
   END IF;
  EXCEPTION WHEN raise_exception THEN
   GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
   IF err IN ('FLEXGUARD_POSTED_JOURNAL_REQUIRED','FLEXGUARD_PURCHASE_RECONCILIATION_REQUIRED','FLEXGUARD_PERIOD_CLOSED','FLEXGUARD_ADJUSTMENT_REVERSAL_POLICY_MISMATCH') THEN outcome:='retry';reason_code:=err;
   ELSE outcome:='manual_review';reason_code:='CONTROL_REVIEW_REQUIRED'; END IF;
  WHEN unique_violation OR foreign_key_violation OR check_violation THEN outcome:='manual_review';reason_code:='DATABASE_CONSTRAINT_REVIEW';
  END;
  IF attempt=8 AND outcome='retry' THEN outcome:='manual_review';reason_code:='RETRY_LIMIT_REACHED'; END IF;
  INSERT INTO rticore_fg_retry_attempts(tenant_id,legal_entity_id,event_id,attempt_no,attempted_by,outcome,reason_code) VALUES(p_tenant,p_entity,event_id,attempt,lower(p_actor),outcome,reason_code);
  RETURN NEXT;
 END LOOP;
END $fg$;

-- Expiry only submits a maker request; independently approved transactions are still mandatory.
CREATE OR REPLACE FUNCTION rticore_fg_expiry_due(p_tenant text,p_entity text,p_actor text,p_limit integer)
RETURNS TABLE(lot_id text,request_id text,credits bigint) LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE x record;r jsonb;k text;
BEGIN
 IF NOT rticore_fg_maintenance_actor(p_tenant,p_entity,p_actor) OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
 FOR x IN SELECT l.id,l.wallet_id,coalesce(sum(e.available_delta),0)::bigint AS available
 FROM rticore_flexguard_credit_lots l JOIN rticore_flexguard_wallets w ON w.tenant_id=l.tenant_id AND w.id=l.wallet_id AND w.status='active'
 JOIN rticore_flexguard_enterprise_ledger e ON e.tenant_id=l.tenant_id AND e.legal_entity_id=l.legal_entity_id AND e.lot_id=l.id
 WHERE l.tenant_id=p_tenant AND l.legal_entity_id=p_entity AND l.expires_at<to_char(CURRENT_DATE,'YYYY-MM-DD')
 AND NOT EXISTS(SELECT 1 FROM rticore_flexguard_requests q WHERE q.tenant_id=l.tenant_id AND q.legal_entity_id=l.legal_entity_id AND q.lot_id=l.id AND q.transaction_type='expiry' AND q.status='pending_approval')
 AND EXISTS(SELECT 1 FROM rticore_flexguard_enterprise_ledger p JOIN rticore_finance_integration_events v ON v.tenant_id=p.tenant_id AND v.id=p.finance_outbox_event_id AND v.status='processed' JOIN rticore_fg_finance_links f ON f.tenant_id=v.tenant_id AND f.event_id=v.id AND f.journal_id=v.resulting_journal_id JOIN rticore_gl_journals j ON j.tenant_id=f.tenant_id AND j.id=f.journal_id AND j.status='posted' WHERE p.tenant_id=l.tenant_id AND p.lot_id=l.id AND p.transaction_type IN ('purchase','top_up'))
 GROUP BY l.id,l.wallet_id HAVING coalesce(sum(e.available_delta),0)>0 ORDER BY l.id LIMIT p_limit
 LOOP
  -- Include the current immutable ledger count, allowing a new request after a later release.
  k:='fg-expiry-'||encode(sha256(convert_to(x.id||':'||(SELECT count(*) FROM rticore_flexguard_enterprise_ledger e WHERE e.tenant_id=p_tenant AND e.lot_id=x.id)::text,'UTF8')),'hex');
  r:=rticore_fg_submit(p_tenant,p_entity,p_actor,x.wallet_id,'expiry',x.available,NULL,x.id,NULL,NULL,k,'Scheduled expiry candidate; independent Finance approval required');
  IF r->>'status'='pending_approval' THEN lot_id:=x.id;request_id:=r->>'id';credits:=x.available;RETURN NEXT; END IF;
 END LOOP;
END $fg$;
COMMIT;
