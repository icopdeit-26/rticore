-- 0060: approved invoice credit allocation, scoped journal lifecycle and event integrity.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS rticore_fg_invoice_allocations(
 tenant_id text NOT NULL,legal_entity_id text NOT NULL,wallet_id text NOT NULL,invoice_id text NOT NULL,
 credits bigint NOT NULL CHECK(credits BETWEEN 1 AND 100000),net_cents bigint NOT NULL CHECK(net_cents>0 AND net_cents<900000000000000),
 evidence_ref text NOT NULL CHECK(length(evidence_ref) BETWEEN 12 AND 500),
 maker text NOT NULL,checker text,review_notes text,created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
 reviewed_at text,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 PRIMARY KEY(tenant_id,invoice_id),
 FOREIGN KEY(tenant_id,wallet_id) REFERENCES rticore_flexguard_wallets(tenant_id,id),
 FOREIGN KEY(tenant_id,invoice_id) REFERENCES rticore_billing_invoices(tenant_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 CHECK(net_cents%credits=0),
 CHECK(status='pending' OR (checker IS NOT NULL AND lower(checker)<>lower(maker) AND reviewed_at IS NOT NULL AND length(review_notes)>=12))
);
CREATE OR REPLACE FUNCTION rticore_fg_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $fg$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FLEXGUARD_ALLOCATION_IMMUTABLE'; END IF;
 IF OLD.status<>'pending' OR NEW.status NOT IN ('approved','rejected') OR
 (to_jsonb(OLD)-ARRAY['status','checker','review_notes','reviewed_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','checker','review_notes','reviewed_at'])
 THEN RAISE EXCEPTION 'FLEXGUARD_ALLOCATION_IMMUTABLE'; END IF;
 RETURN NEW;
END $fg$;
DROP TRIGGER IF EXISTS rticore_fg_allocation_immutable ON rticore_fg_invoice_allocations;
CREATE TRIGGER rticore_fg_allocation_immutable BEFORE UPDATE OR DELETE ON rticore_fg_invoice_allocations FOR EACH ROW EXECUTE FUNCTION rticore_fg_allocation_guard();
CREATE OR REPLACE FUNCTION rticore_fg_allocate_invoice(p_tenant text,p_entity text,p_actor text,p_action text,p_wallet text,p_invoice text,p_credits bigint,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE a rticore_fg_invoice_allocations%ROWTYPE; inv rticore_billing_invoices%ROWTYPE; w record; role text;
BEGIN
 role:=rticore_fg_actor_role(p_tenant,p_entity,p_actor);
 IF role IS NULL OR length(coalesce(p_notes,'')) NOT BETWEEN 12 AND 500 THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
 SELECT x.*,c.project_id INTO w FROM rticore_flexguard_wallets x JOIN rticore_service_contracts c ON c.tenant_id=x.tenant_id AND c.id=x.contract_id AND c.customer_id=x.customer_id AND c.model='FlexGuard'
 JOIN rticore_erp_project_scopes s ON s.tenant_id=c.tenant_id AND s.project_id=c.project_id AND s.legal_entity_id=p_entity AND s.status='approved'
 WHERE x.tenant_id=p_tenant AND x.id=p_wallet AND x.status='active' FOR UPDATE OF x;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_SCOPE_INVALID'; END IF;
 SELECT i.* INTO inv FROM rticore_billing_invoices i WHERE i.tenant_id=p_tenant AND i.id=p_invoice AND i.project_id=w.project_id AND i.status='approved' AND i.reviewed_by IS NOT NULL AND lower(i.created_by)<>lower(i.reviewed_by);
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_INVOICE_INVALID'; END IF;
 SELECT * INTO a FROM rticore_fg_invoice_allocations WHERE tenant_id=p_tenant AND invoice_id=p_invoice FOR UPDATE;
 IF p_action='submit' THEN
  IF role<>'finance' OR NOT EXISTS(SELECT 1 FROM rticore_finance_role_assignments f WHERE f.tenant_id=p_tenant AND f.legal_entity_id=p_entity AND lower(f.email)=lower(p_actor) AND f.status='approved' AND f.can_make=1 AND f.finance_role IN ('financial_controller','finance_manager','accounting_officer') AND f.business_unit_id IS NULL AND f.department_id IS NULL) THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
  IF p_credits IS NULL OR p_credits NOT BETWEEN 1 AND w.entitlement_units OR inv.amount_cents%p_credits<>0 THEN RAISE EXCEPTION 'FLEXGUARD_ALLOCATION_INVALID'; END IF;
  IF a.invoice_id IS NOT NULL THEN
   IF a.legal_entity_id=p_entity AND a.wallet_id=p_wallet AND a.credits=p_credits AND lower(a.maker)=lower(p_actor) AND a.evidence_ref=p_notes THEN RETURN jsonb_build_object('status',a.status,'replayed',true); END IF;
   RAISE EXCEPTION 'FLEXGUARD_IDEMPOTENCY_CONFLICT';
  END IF;
  INSERT INTO rticore_fg_invoice_allocations(tenant_id,legal_entity_id,wallet_id,invoice_id,credits,net_cents,evidence_ref,maker)
  VALUES(p_tenant,p_entity,p_wallet,p_invoice,p_credits,inv.amount_cents,p_notes,lower(p_actor));
  RETURN jsonb_build_object('status','pending','credits',p_credits,'net_cents',inv.amount_cents,'unit_value_cents',inv.amount_cents/p_credits);
 END IF;
 IF p_action NOT IN ('approve','reject') OR role NOT IN ('approver','finance') OR NOT EXISTS(SELECT 1 FROM rticore_finance_role_assignments f WHERE f.tenant_id=p_tenant AND f.legal_entity_id=p_entity AND lower(f.email)=lower(p_actor) AND f.status='approved' AND f.can_check=1 AND f.can_approve=1 AND f.finance_role IN ('cfo','financial_controller') AND f.approval_limit_cents>=inv.amount_cents AND f.business_unit_id IS NULL AND f.department_id IS NULL) THEN RAISE EXCEPTION 'FLEXGUARD_APPROVAL_DENIED'; END IF;
 IF a.invoice_id IS NULL OR a.wallet_id<>p_wallet OR a.legal_entity_id<>p_entity OR a.status<>'pending' OR a.net_cents<>inv.amount_cents THEN RAISE EXCEPTION 'FLEXGUARD_ALLOCATION_INVALID'; END IF;
 IF lower(a.maker)=lower(p_actor) THEN RAISE EXCEPTION 'FLEXGUARD_SELF_APPROVAL'; END IF;
 UPDATE rticore_fg_invoice_allocations SET status=CASE WHEN p_action='approve' THEN 'approved' ELSE 'rejected' END,checker=lower(p_actor),review_notes=p_notes,reviewed_at=CURRENT_TIMESTAMP::text WHERE tenant_id=p_tenant AND invoice_id=p_invoice;
 RETURN jsonb_build_object('status',CASE WHEN p_action='approve' THEN 'approved' ELSE 'rejected' END);
END $fg$;
CREATE OR REPLACE FUNCTION rticore_fg_lot_allocation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM rticore_fg_invoice_allocations a WHERE a.tenant_id=NEW.tenant_id AND a.legal_entity_id=NEW.legal_entity_id AND a.wallet_id=NEW.wallet_id AND a.invoice_id=NEW.invoice_id AND a.status='approved' AND a.credits=NEW.credits_total AND a.net_cents=NEW.financial_value_cents)
 THEN RAISE EXCEPTION 'FLEXGUARD_APPROVED_INVOICE_ALLOCATION_REQUIRED'; END IF;
 RETURN NEW;
END $fg$;
DROP TRIGGER IF EXISTS rticore_fg_lot_allocation ON rticore_flexguard_credit_lots;
CREATE TRIGGER rticore_fg_lot_allocation BEFORE INSERT ON rticore_flexguard_credit_lots FOR EACH ROW EXECUTE FUNCTION rticore_fg_lot_allocation_guard();

-- Bind downstream journals to the liability account used by the original purchase.
CREATE OR REPLACE FUNCTION rticore_fg_link_policy_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE l rticore_flexguard_enterprise_ledger%ROWTYPE; orig rticore_fg_finance_links%ROWTYPE; prior rticore_fg_finance_links%ROWTYPE;
BEGIN
 SELECT x.* INTO l FROM rticore_flexguard_enterprise_ledger x WHERE x.tenant_id=NEW.tenant_id AND x.legal_entity_id=NEW.legal_entity_id AND x.finance_outbox_event_id=NEW.event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_DOCKING_SCOPE_INVALID'; END IF;
 IF l.transaction_type IN ('purchase','top_up') THEN RETURN NEW; END IF;
 SELECT f.* INTO orig FROM rticore_flexguard_enterprise_ledger x JOIN rticore_finance_integration_events e ON e.tenant_id=x.tenant_id AND e.id=x.finance_outbox_event_id AND e.status='processed'
 JOIN rticore_fg_finance_links f ON f.tenant_id=e.tenant_id AND f.event_id=e.id AND f.legal_entity_id=l.legal_entity_id
 WHERE x.tenant_id=l.tenant_id AND x.lot_id=l.lot_id AND x.transaction_type IN ('purchase','top_up');
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_PURCHASE_RECONCILIATION_REQUIRED'; END IF;
 IF l.transaction_type IN ('consumption','expiry') OR (l.transaction_type='adjustment' AND l.credit_amount<0) THEN
  IF NEW.debit_account_id<>orig.credit_account_id THEN RAISE EXCEPTION 'FLEXGUARD_CONTRACT_LIABILITY_ACCOUNT_MISMATCH'; END IF;
 ELSE
  IF l.transaction_type<>'adjustment' OR NEW.credit_account_id<>orig.credit_account_id THEN RAISE EXCEPTION 'FLEXGUARD_CONTRACT_LIABILITY_ACCOUNT_MISMATCH'; END IF;
  SELECT f.* INTO prior FROM rticore_flexguard_enterprise_ledger x JOIN rticore_finance_integration_events e ON e.tenant_id=x.tenant_id AND e.id=x.finance_outbox_event_id AND e.status='processed'
  JOIN rticore_fg_finance_links f ON f.tenant_id=e.tenant_id AND f.event_id=e.id WHERE x.tenant_id=l.tenant_id AND x.id=l.source_tx_id;
  IF NOT FOUND OR NEW.debit_account_id<>prior.credit_account_id OR NEW.credit_account_id<>prior.debit_account_id THEN RAISE EXCEPTION 'FLEXGUARD_ADJUSTMENT_REVERSAL_POLICY_MISMATCH'; END IF;
 END IF;
 RETURN NEW;
END $fg$;
DROP TRIGGER IF EXISTS rticore_fg_link_policy ON rticore_fg_finance_links;
CREATE TRIGGER rticore_fg_link_policy BEFORE INSERT ON rticore_fg_finance_links FOR EACH ROW EXECUTE FUNCTION rticore_fg_link_policy_guard();

CREATE OR REPLACE FUNCTION rticore_fg_event_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
BEGIN
 IF OLD.direction='outbox' AND OLD.source_system='RTICORE' AND OLD.event_type IN ('flexguard.credit_purchased','flexguard.credit_consumed','flexguard.credit_expired','flexguard.credit_adjusted') THEN
  IF (to_jsonb(OLD)-ARRAY['status','retry_count','error_message','resulting_journal_id','processed_at','processed_by']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','retry_count','error_message','resulting_journal_id','processed_at','processed_by']) THEN RAISE EXCEPTION 'FLEXGUARD_OUTBOX_IMMUTABLE'; END IF;
  IF OLD.resulting_journal_id IS NOT NULL AND NEW.resulting_journal_id IS DISTINCT FROM OLD.resulting_journal_id THEN RAISE EXCEPTION 'FLEXGUARD_OUTBOX_LINK_IMMUTABLE'; END IF;
  IF NEW.status='processed' AND NOT EXISTS(SELECT 1 FROM rticore_fg_finance_links f JOIN rticore_gl_journals j ON j.tenant_id=f.tenant_id AND j.legal_entity_id=f.legal_entity_id AND j.id=f.journal_id AND j.status='posted'
   WHERE f.tenant_id=OLD.tenant_id AND f.legal_entity_id=OLD.legal_entity_id AND f.event_id=OLD.id AND f.journal_id=NEW.resulting_journal_id AND NEW.processed_at IS NOT NULL AND NEW.processed_by IS NOT NULL AND lower(NEW.processed_by)<>lower(f.linked_by)
    AND j.reviewed_by IS NOT NULL AND j.posted_by IS NOT NULL AND lower(j.reviewed_by)<>lower(j.created_by)
    AND (j.source_type='ar' OR EXISTS(SELECT 1 FROM rticore_finance_journal_workflows w WHERE w.tenant_id=j.tenant_id AND w.journal_id=j.id AND w.legal_entity_id=j.legal_entity_id AND w.lifecycle_stage='posted' AND w.approved_by=j.reviewed_by AND w.posted_by=j.posted_by))) THEN RAISE EXCEPTION 'FLEXGUARD_POSTED_WORKFLOW_REQUIRED'; END IF;
 END IF;
 RETURN NEW;
END $fg$;
DROP TRIGGER IF EXISTS rticore_fg_outbox_guard ON rticore_finance_integration_events;
CREATE TRIGGER rticore_fg_outbox_guard BEFORE UPDATE ON rticore_finance_integration_events FOR EACH ROW EXECUTE FUNCTION rticore_fg_event_guard();

-- A FlexGuard GL journal may be approved/post only by explicitly assigned independent users.
CREATE OR REPLACE FUNCTION rticore_fg_journal_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE f rticore_fg_finance_links%ROWTYPE;
BEGIN
 IF OLD.source_type<>'flexguard' THEN RETURN NEW; END IF;
 SELECT * INTO f FROM rticore_fg_finance_links WHERE tenant_id=OLD.tenant_id AND legal_entity_id=OLD.legal_entity_id AND journal_id=OLD.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_DOCKING_LINK_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rticore_gl_periods p WHERE p.tenant_id=OLD.tenant_id AND p.legal_entity_id=OLD.legal_entity_id AND p.id=OLD.period_id AND p.status='open' AND NOT EXISTS(SELECT 1 FROM rticore_finance_period_controls c WHERE c.tenant_id=p.tenant_id AND c.period_id=p.id AND c.close_stage<>'open')) THEN RAISE EXCEPTION 'FLEXGUARD_PERIOD_CLOSED'; END IF;
 IF NEW.status='approved' THEN
  IF NEW.reviewed_by IS NULL OR lower(NEW.reviewed_by)=lower(OLD.created_by) OR NOT EXISTS(SELECT 1 FROM rticore_finance_role_assignments a JOIN rticore_members m ON lower(m.email)=lower(a.email) AND m.active=1 WHERE a.tenant_id=OLD.tenant_id AND a.legal_entity_id=OLD.legal_entity_id AND lower(a.email)=lower(NEW.reviewed_by) AND a.status='approved' AND a.finance_role IN ('cfo','financial_controller') AND a.can_check=1 AND a.can_approve=1 AND a.approval_limit_cents>=f.net_amount_cents AND a.business_unit_id IS NULL AND a.department_id IS NULL)
   OR NOT EXISTS(SELECT 1 FROM rticore_finance_journal_workflows w WHERE w.tenant_id=OLD.tenant_id AND w.journal_id=OLD.id AND w.lifecycle_stage='submitted') THEN RAISE EXCEPTION 'FLEXGUARD_APPROVAL_DENIED'; END IF;
 ELSIF NEW.status='posted' THEN
  IF NEW.posted_by IS NULL OR lower(NEW.posted_by)=lower(OLD.reviewed_by) OR lower(NEW.posted_by)=lower(OLD.created_by) OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
   OR NOT EXISTS(SELECT 1 FROM rticore_finance_role_assignments a JOIN rticore_members m ON lower(m.email)=lower(a.email) AND m.active=1 WHERE a.tenant_id=OLD.tenant_id AND a.legal_entity_id=OLD.legal_entity_id AND lower(a.email)=lower(NEW.posted_by) AND a.status='approved' AND a.finance_role IN ('cfo','financial_controller','finance_manager','accounting_officer') AND a.can_post=1 AND a.business_unit_id IS NULL AND a.department_id IS NULL)
   OR NOT EXISTS(SELECT 1 FROM rticore_finance_journal_workflows w WHERE w.tenant_id=OLD.tenant_id AND w.journal_id=OLD.id AND w.lifecycle_stage='approved' AND w.approved_by=OLD.reviewed_by) THEN RAISE EXCEPTION 'FLEXGUARD_INDEPENDENT_POSTER_REQUIRED'; END IF;
 END IF;
 RETURN NEW;
END $fg$;
DROP TRIGGER IF EXISTS rticore_fg_journal_control ON rticore_gl_journals;
CREATE TRIGGER rticore_fg_journal_control BEFORE UPDATE ON rticore_gl_journals FOR EACH ROW EXECUTE FUNCTION rticore_fg_journal_guard();
CREATE OR REPLACE FUNCTION rticore_fg_journal_command(p_tenant text,p_entity text,p_actor text,p_journal text,p_action text,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE j rticore_gl_journals%ROWTYPE; f rticore_fg_finance_links%ROWTYPE; role text; nowtext text:=CURRENT_TIMESTAMP::text;
BEGIN
 role:=rticore_fg_actor_role(p_tenant,p_entity,p_actor);
 IF role IS NULL OR length(coalesce(p_notes,'')) NOT BETWEEN 12 AND 500 THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
 SELECT * INTO j FROM rticore_gl_journals WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=p_journal AND source_type='flexguard' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_SCOPE_INVALID'; END IF;
 SELECT * INTO f FROM rticore_fg_finance_links WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND journal_id=j.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_DOCKING_LINK_REQUIRED'; END IF;
 IF p_action='approve' AND role IN ('finance','approver') AND j.status='draft' THEN
  UPDATE rticore_gl_journals SET status='approved',version=version+1,reviewed_by=lower(p_actor),review_notes=p_notes,reviewed_at=nowtext WHERE tenant_id=p_tenant AND id=j.id;
  UPDATE rticore_finance_journal_workflows SET lifecycle_stage='approved',checked_by=lower(p_actor),checked_at=nowtext,approved_by=lower(p_actor),approved_at=nowtext,version=version+1 WHERE tenant_id=p_tenant AND journal_id=j.id;
 ELSIF p_action='post' AND role='finance' AND j.status='approved' THEN
  UPDATE rticore_gl_journals SET status='posted',version=version+1,posted_by=lower(p_actor),posted_at=nowtext WHERE tenant_id=p_tenant AND id=j.id;
  UPDATE rticore_finance_journal_workflows SET lifecycle_stage='posted',posted_by=lower(p_actor),posted_at=nowtext,version=version+1 WHERE tenant_id=p_tenant AND journal_id=j.id;
 ELSE RAISE EXCEPTION 'FLEXGUARD_JOURNAL_STATUS_INVALID'; END IF;
 INSERT INTO rticore_operations_events(id,tenant_id,area,entity_id,action,actor_email,snapshot_json) VALUES(gen_random_uuid()::text,p_tenant,'flexguard',j.id,'JOURNAL_'||upper(p_action),lower(p_actor),jsonb_build_object('notes',p_notes,'event_id',f.event_id)::text);
 RETURN jsonb_build_object('status',CASE WHEN p_action='approve' THEN 'approved' ELSE 'posted' END,'journal_id',j.id);
END $fg$;
COMMIT;
