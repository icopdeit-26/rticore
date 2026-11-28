-- 0088: expiry acquisition dependency and scoped missing-outbox candidate register.
-- Evidence discovery only; no automatic recovery, historical rewrites or journal posting.
BEGIN;
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
 AND EXISTS(SELECT 1 FROM rticore_fg_invoice_allocations a WHERE a.tenant_id=l.tenant_id AND a.legal_entity_id=l.legal_entity_id AND a.wallet_id=l.wallet_id AND a.invoice_id=l.invoice_id AND a.status='approved' AND a.credits=l.credits_total AND a.net_cents=l.financial_value_cents)
 AND EXISTS(SELECT 1 FROM rticore_flexguard_enterprise_ledger p JOIN rticore_finance_integration_events v ON v.tenant_id=p.tenant_id AND v.legal_entity_id=p.legal_entity_id AND v.id=p.finance_outbox_event_id AND v.source_document_id=p.id AND v.status='processed' AND v.direction='outbox' AND v.source_system='RTICORE' AND v.event_type='flexguard.credit_purchased'
 JOIN rticore_fg_finance_links f ON f.tenant_id=v.tenant_id AND f.legal_entity_id=v.legal_entity_id AND f.event_id=v.id AND f.journal_id=v.resulting_journal_id AND f.net_amount_cents=p.financial_value_cents
 JOIN rticore_gl_journals j ON j.tenant_id=f.tenant_id AND j.legal_entity_id=f.legal_entity_id AND j.id=f.journal_id AND j.status='posted' AND j.source_type='ar' AND j.source_key=l.invoice_id
 WHERE p.tenant_id=l.tenant_id AND p.legal_entity_id=l.legal_entity_id AND p.lot_id=l.id AND p.transaction_type IN ('purchase','top_up') AND rticore_fg_independent_posting(j.created_by,j.reviewed_by,j.posted_by,j.posted_at) AND nullif(btrim(v.processed_by),'') IS NOT NULL AND nullif(btrim(v.processed_at::text),'') IS NOT NULL AND lower(btrim(v.processed_by))<>lower(btrim(f.linked_by)))
 GROUP BY l.id,l.wallet_id HAVING coalesce(sum(e.available_delta),0)>0 ORDER BY l.id LIMIT p_limit
 LOOP
  -- Include the current immutable ledger count, allowing a new request after a later release.
  k:='fg-expiry-'||encode(sha256(convert_to(x.id||':'||(SELECT count(*) FROM rticore_flexguard_enterprise_ledger e WHERE e.tenant_id=p_tenant AND e.lot_id=x.id)::text,'UTF8')),'hex');
  r:=rticore_fg_submit(p_tenant,p_entity,p_actor,x.wallet_id,'expiry',x.available,NULL,x.id,NULL,NULL,k,'Scheduled expiry candidate; independent Finance approval required');
  IF r->>'status'='pending_approval' THEN lot_id:=x.id;request_id:=r->>'id';credits:=x.available;RETURN NEXT; END IF;
 END LOOP;
END $fg$;

-- Metadata-only candidate discovery. A missing immutable pointer is not repaired
-- by inserting an unlinked event, and this function never authorizes posting.
CREATE OR REPLACE FUNCTION rticore_fg_missing_outbox_candidates(p_tenant text,p_entity text,p_actor text)
RETURNS TABLE(ledger_id text,lot_id text,transaction_type text,amount_cents bigint,reason_code text,request_matches boolean,allocation_approved boolean,existing_event_count bigint,posted_invoice_journal_count bigint)
LANGUAGE plpgsql STABLE SET search_path=public,pg_catalog AS $fg$
BEGIN
 IF NOT coalesce(rticore_catalog_finance_access(p_tenant,p_entity,p_actor,'make') OR rticore_catalog_finance_access(p_tenant,p_entity,p_actor,'approve'),false) THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
 RETURN QUERY SELECT l.id,l.lot_id,l.transaction_type,l.financial_value_cents,
 CASE WHEN l.finance_outbox_event_id IS NULL THEN 'MISSING_IMMUTABLE_OUTBOX_POINTER' ELSE 'OUTBOX_LINK_SCOPE_REVIEW' END,
 EXISTS(SELECT 1 FROM rticore_flexguard_requests r WHERE r.tenant_id=l.tenant_id AND r.legal_entity_id=l.legal_entity_id AND r.id=l.id AND r.wallet_id=l.wallet_id AND r.status='posted' AND r.transaction_type=l.transaction_type AND r.credit_amount=l.credit_amount AND r.actor_email=l.actor_email AND r.approved_by=l.approved_by AND r.approved_at=l.approved_at AND lower(btrim(r.actor_email))<>lower(btrim(r.approved_by))),
 EXISTS(SELECT 1 FROM rticore_fg_invoice_allocations a WHERE a.tenant_id=lot.tenant_id AND a.legal_entity_id=lot.legal_entity_id AND a.wallet_id=lot.wallet_id AND a.invoice_id=lot.invoice_id AND a.credits=lot.credits_total AND a.net_cents=lot.financial_value_cents AND a.status='approved'),
 (SELECT count(*) FROM rticore_finance_integration_events e WHERE e.tenant_id=l.tenant_id AND e.legal_entity_id=l.legal_entity_id AND e.source_document_id=l.id AND e.direction='outbox' AND e.source_system='RTICORE'),
 (SELECT count(*) FROM rticore_gl_journals j WHERE j.tenant_id=lot.tenant_id AND j.legal_entity_id=lot.legal_entity_id AND j.source_type='ar' AND j.source_key=lot.invoice_id AND j.status='posted' AND rticore_fg_independent_posting(j.created_by,j.reviewed_by,j.posted_by,j.posted_at))
 FROM rticore_flexguard_enterprise_ledger l JOIN rticore_flexguard_credit_lots lot ON lot.tenant_id=l.tenant_id AND lot.legal_entity_id=l.legal_entity_id AND lot.wallet_id=l.wallet_id AND lot.id=l.lot_id
 WHERE l.tenant_id=p_tenant AND l.legal_entity_id=p_entity AND l.transaction_type IN ('purchase','top_up','consumption','expiry','adjustment')
 AND NOT EXISTS(SELECT 1 FROM rticore_finance_integration_events e WHERE e.tenant_id=l.tenant_id AND e.legal_entity_id=l.legal_entity_id AND e.id=l.finance_outbox_event_id AND e.source_document_id=l.id AND e.direction='outbox' AND e.source_system='RTICORE' AND e.event_type=CASE l.transaction_type WHEN 'purchase' THEN 'flexguard.credit_purchased' WHEN 'top_up' THEN 'flexguard.credit_purchased' WHEN 'consumption' THEN 'flexguard.credit_consumed' WHEN 'expiry' THEN 'flexguard.credit_expired' ELSE 'flexguard.credit_adjusted' END);
END $fg$;
COMMIT;
