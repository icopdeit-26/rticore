-- 0057: Native PostgreSQL FlexGuard monetary ledger. No automatic backfill of legacy wallets.
-- Apply only after 0053-0054 and schema/trigger rehearsal. Deliberately not a second writable legacy balance.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS rticore_flexguard_credit_lots (
 id text PRIMARY KEY, tenant_id text NOT NULL, legal_entity_id text NOT NULL, customer_id text NOT NULL,
 contract_id text NOT NULL, wallet_id text NOT NULL, invoice_id text NOT NULL, lot_code text NOT NULL,
 credits_total bigint NOT NULL CHECK(credits_total BETWEEN 1 AND 100000),
 unit_value_cents bigint NOT NULL CHECK(unit_value_cents>0 AND unit_value_cents<900000000000000),
 financial_value_cents bigint NOT NULL CHECK(financial_value_cents=credits_total*unit_value_cents AND financial_value_cents<900000000000000),
 issued_at text NOT NULL, expires_at text NOT NULL, created_by text NOT NULL,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,invoice_id), UNIQUE(tenant_id,wallet_id,lot_code),
 UNIQUE(tenant_id,legal_entity_id,customer_id,contract_id,wallet_id,id),
 FOREIGN KEY(tenant_id,wallet_id) REFERENCES rticore_flexguard_wallets(tenant_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES rticore_sales_accounts(tenant_id,id),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES rticore_service_contracts(tenant_id,id),
 FOREIGN KEY(tenant_id,invoice_id) REFERENCES rticore_billing_invoices(tenant_id,id),
 CHECK(expires_at>=issued_at)
);
CREATE TABLE IF NOT EXISTS rticore_flexguard_requests (
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,wallet_id text NOT NULL,
 transaction_type text NOT NULL CHECK(transaction_type IN ('purchase','top_up','reservation','reservation_release','consumption','expiry','adjustment')),
 credit_amount bigint NOT NULL CHECK(credit_amount BETWEEN -100000 AND 100000 AND credit_amount<>0),
 invoice_id text,lot_id text,source_tx_id text,milestone_id text,reason text NOT NULL CHECK(length(reason) BETWEEN 12 AND 1000),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 128),actor_email text NOT NULL,
 status text NOT NULL DEFAULT 'pending_approval' CHECK(status IN ('pending_approval','posted','rejected')),
 approved_by text, approved_at text, approval_notes text, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,idempotency_key),
 FOREIGN KEY(tenant_id,wallet_id) REFERENCES rticore_flexguard_wallets(tenant_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 CHECK(status='pending_approval' OR (approved_by IS NOT NULL AND lower(actor_email)<>lower(approved_by) AND length(approval_notes)>=12))
);
CREATE TABLE IF NOT EXISTS rticore_flexguard_enterprise_ledger (
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,customer_id text NOT NULL,contract_id text NOT NULL,wallet_id text NOT NULL,
 lot_id text NOT NULL,transaction_type text NOT NULL CHECK(transaction_type IN ('purchase','top_up','reservation','reservation_release','consumption','expiry','adjustment')),
 credit_amount bigint NOT NULL CHECK(credit_amount BETWEEN -100000 AND 100000 AND credit_amount<>0),
 unit_value_cents bigint NOT NULL CHECK(unit_value_cents>0),
 financial_value_cents bigint NOT NULL CHECK(financial_value_cents=abs(credit_amount)*unit_value_cents AND financial_value_cents<900000000000000),
 available_delta bigint NOT NULL,reserved_delta bigint NOT NULL,consumed_delta bigint NOT NULL,expired_delta bigint NOT NULL,adjustment_delta bigint NOT NULL,
 source_tx_id text,milestone_id text,reference_code text NOT NULL,idempotency_key text NOT NULL,actor_email text NOT NULL,
 approval_status text NOT NULL DEFAULT 'posted' CHECK(approval_status='posted'),
 approved_by text NOT NULL,approved_at text NOT NULL,reason text NOT NULL,
 finance_outbox_event_id text,created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,idempotency_key), UNIQUE(tenant_id,legal_entity_id,wallet_id,id),
 FOREIGN KEY(tenant_id,id) REFERENCES rticore_flexguard_requests(tenant_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id,customer_id,contract_id,wallet_id,lot_id)
 REFERENCES rticore_flexguard_credit_lots(tenant_id,legal_entity_id,customer_id,contract_id,wallet_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id,wallet_id,source_tx_id) REFERENCES rticore_flexguard_enterprise_ledger(tenant_id,legal_entity_id,wallet_id,id),
 FOREIGN KEY(tenant_id,finance_outbox_event_id) REFERENCES rticore_finance_integration_events(tenant_id,id),
 FOREIGN KEY(tenant_id,milestone_id) REFERENCES rticore_delivery_milestones(tenant_id,id),
 CHECK(lower(actor_email)<>lower(approved_by)),
 CHECK((transaction_type IN ('purchase','top_up','reservation','reservation_release','consumption','expiry') AND credit_amount>0) OR transaction_type='adjustment'),
 CHECK(available_delta+reserved_delta+consumed_delta+expired_delta-adjustment_delta=CASE WHEN transaction_type IN ('purchase','top_up') THEN credit_amount ELSE 0 END)
);
CREATE UNIQUE INDEX IF NOT EXISTS rticore_fg_consumption_milestone_uq ON rticore_flexguard_enterprise_ledger(tenant_id,milestone_id) WHERE transaction_type='consumption';
CREATE INDEX IF NOT EXISTS rticore_fg_ledger_lot_idx ON rticore_flexguard_enterprise_ledger(tenant_id,lot_id);
CREATE INDEX IF NOT EXISTS rticore_fg_requests_scope_idx ON rticore_flexguard_requests(tenant_id,legal_entity_id,wallet_id,status);
-- Existing inbound 22-event protocol remains intact; these two additional events are internal outbound policy-review events only.
ALTER TABLE rticore_finance_integration_events DROP CONSTRAINT IF EXISTS rticore_finance_integration_events_event_type_check;
ALTER TABLE rticore_finance_integration_events ADD CONSTRAINT rticore_finance_integration_events_event_type_check CHECK(event_type IN (
  'customer.created','customer.updated','contract.approved','contract.amended',
  'project.created','project.milestone_accepted','project.completed',
  'timesheet.approved','resource.cost_allocated','procurement.requested',
  'purchase_order.approved','goods.received','service.accepted',
  'vendor_invoice.approved','customer_invoice.approved','customer.payment_received',
  'vendor.payment_completed','flexguard.credit_purchased','flexguard.credit_consumed',
  'subscription.activated','subscription.renewed','subscription.terminated','flexguard.credit_expired','flexguard.credit_adjusted'));
CREATE OR REPLACE FUNCTION rticore_fg_immutable() RETURNS trigger LANGUAGE plpgsql AS $fg$
BEGIN RAISE EXCEPTION 'FLEXGUARD_ENTERPRISE_IMMUTABLE'; END $fg$;
DROP TRIGGER IF EXISTS rticore_fg_lot_immutable ON rticore_flexguard_credit_lots;
CREATE TRIGGER rticore_fg_lot_immutable BEFORE UPDATE OR DELETE ON rticore_flexguard_credit_lots FOR EACH ROW EXECUTE FUNCTION rticore_fg_immutable();
DROP TRIGGER IF EXISTS rticore_fg_ledger_immutable ON rticore_flexguard_enterprise_ledger;
CREATE TRIGGER rticore_fg_ledger_immutable BEFORE UPDATE OR DELETE ON rticore_flexguard_enterprise_ledger FOR EACH ROW EXECUTE FUNCTION rticore_fg_immutable();
CREATE OR REPLACE FUNCTION rticore_fg_request_guard() RETURNS trigger LANGUAGE plpgsql AS $fg$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FLEXGUARD_REQUEST_IMMUTABLE'; END IF;
 IF OLD.status<>'pending_approval' OR NEW.status NOT IN ('posted','rejected') OR
    (to_jsonb(OLD)-ARRAY['status','approved_by','approved_at','approval_notes']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','approved_by','approved_at','approval_notes'])
 THEN RAISE EXCEPTION 'FLEXGUARD_REQUEST_IMMUTABLE'; END IF;
 RETURN NEW;
END $fg$;
DROP TRIGGER IF EXISTS rticore_fg_request_immutable ON rticore_flexguard_requests;
CREATE TRIGGER rticore_fg_request_immutable BEFORE UPDATE OR DELETE ON rticore_flexguard_requests FOR EACH ROW EXECUTE FUNCTION rticore_fg_request_guard();
-- Reject two independent ledgers for the same wallet, including old operational writers.
CREATE OR REPLACE FUNCTION rticore_fg_legacy_guard() RETURNS trigger LANGUAGE plpgsql AS $fg$
BEGIN
 PERFORM 1 FROM rticore_flexguard_wallets w WHERE w.tenant_id=NEW.tenant_id AND w.id=NEW.wallet_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM rticore_flexguard_requests r WHERE r.tenant_id=NEW.tenant_id AND r.wallet_id=NEW.wallet_id AND r.status IN ('pending_approval','posted')) THEN RAISE EXCEPTION 'FLEXGUARD_ENTERPRISE_WALLET'; END IF;
 RETURN NEW;
END $fg$;
DROP TRIGGER IF EXISTS rticore_fg_legacy_exclusion ON rticore_flexguard_events;
CREATE TRIGGER rticore_fg_legacy_exclusion BEFORE INSERT ON rticore_flexguard_events FOR EACH ROW EXECUTE FUNCTION rticore_fg_legacy_guard();
-- The session actor is supplied only by the native authenticated server. Database function is SECURITY INVOKER.
CREATE OR REPLACE FUNCTION rticore_fg_actor_role(p_tenant text,p_entity text,p_actor text) RETURNS text LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $fg$
 SELECT m.role FROM rticore_members m WHERE lower(m.email)=lower(p_actor) AND m.active=1
 AND EXISTS(SELECT 1 FROM rticore_erp_org_units u WHERE u.tenant_id=p_tenant AND u.id=p_entity AND u.kind='legal_entity' AND u.active=1)
 AND (EXISTS(SELECT 1 FROM rticore_erp_staff_org s WHERE s.tenant_id=p_tenant AND s.unit_id=p_entity AND lower(s.email)=lower(p_actor) AND s.status='approved')
 OR EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=p_tenant AND a.legal_entity_id=p_entity AND lower(a.email)=lower(p_actor) AND a.status='approved' AND a.business_unit_id IS NULL AND a.department_id IS NULL))
$fg$;
CREATE OR REPLACE FUNCTION rticore_fg_submit(p_tenant text,p_entity text,p_actor text,p_wallet text,p_kind text,p_units bigint,p_invoice text,p_lot text,p_source text,p_milestone text,p_key text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE w record; actor_role text; rid text:=gen_random_uuid()::text; prior rticore_flexguard_requests%ROWTYPE;
BEGIN
 actor_role:=rticore_fg_actor_role(p_tenant,p_entity,p_actor);
 IF actor_role IS NULL OR actor_role NOT IN ('finance','admin','presales','project_manager') THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
 SELECT x.*,c.status AS contract_status,c.model,c.end_date,c.project_id,p.pm_email INTO w
 FROM rticore_flexguard_wallets x JOIN rticore_service_contracts c ON c.tenant_id=x.tenant_id AND c.id=x.contract_id
 JOIN rticore_delivery_projects p ON p.tenant_id=c.tenant_id AND p.id=c.project_id AND p.customer_id=x.customer_id AND c.customer_id=x.customer_id
 JOIN rticore_erp_project_scopes sc ON sc.tenant_id=p.tenant_id AND sc.project_id=p.id AND sc.legal_entity_id=p_entity AND sc.status='approved'
 WHERE x.tenant_id=p_tenant AND x.id=p_wallet AND x.status='active' AND c.model='FlexGuard' FOR UPDATE OF x;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_SCOPE_INVALID'; END IF;
 IF actor_role IN ('presales','project_manager') AND (p_kind NOT IN ('reservation','reservation_release','consumption') OR lower(w.pm_email) IS DISTINCT FROM lower(p_actor)) THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
 IF p_kind NOT IN ('purchase','top_up','reservation','reservation_release','consumption','expiry','adjustment') OR p_units IS NULL OR p_units=0 OR abs(p_units)>100000 OR (p_kind<>'adjustment' AND p_units<0) OR length(coalesce(p_reason,'')) NOT BETWEEN 12 AND 1000 OR length(coalesce(p_key,'')) NOT BETWEEN 16 AND 128 THEN RAISE EXCEPTION 'FLEXGUARD_REQUEST_INVALID'; END IF;
 IF (p_kind IN ('purchase','top_up') AND (p_invoice IS NULL OR p_lot IS NOT NULL OR p_source IS NOT NULL OR p_milestone IS NOT NULL)) OR
 (p_kind NOT IN ('purchase','top_up') AND (p_invoice IS NOT NULL OR p_lot IS NULL)) OR
 (p_kind IN ('reservation_release','consumption') AND p_source IS NULL) OR (p_kind='consumption' AND p_milestone IS NULL) OR
 (p_kind<>'consumption' AND p_milestone IS NOT NULL) OR (p_kind IN ('reservation','expiry') AND p_source IS NOT NULL) OR
 (p_kind='adjustment' AND ((p_units>0 AND p_source IS NULL) OR (p_units<0 AND p_source IS NOT NULL))) THEN RAISE EXCEPTION 'FLEXGUARD_REFERENCE_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM rticore_flexguard_events e WHERE e.tenant_id=p_tenant AND e.wallet_id=p_wallet) THEN RAISE EXCEPTION 'FLEXGUARD_LEGACY_RECONCILIATION_REQUIRED'; END IF;
 SELECT * INTO prior FROM rticore_flexguard_requests WHERE tenant_id=p_tenant AND idempotency_key=p_key;
 IF FOUND THEN
  IF prior.legal_entity_id<>p_entity OR prior.wallet_id<>p_wallet OR lower(prior.actor_email)<>lower(p_actor) OR prior.transaction_type<>p_kind OR prior.credit_amount<>p_units OR prior.invoice_id IS DISTINCT FROM p_invoice OR prior.lot_id IS DISTINCT FROM p_lot OR prior.source_tx_id IS DISTINCT FROM p_source OR prior.milestone_id IS DISTINCT FROM p_milestone OR prior.reason<>p_reason THEN RAISE EXCEPTION 'FLEXGUARD_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN jsonb_build_object('id',prior.id,'status',prior.status,'replayed',true);
 END IF;
 INSERT INTO rticore_flexguard_requests(id,tenant_id,legal_entity_id,wallet_id,transaction_type,credit_amount,invoice_id,lot_id,source_tx_id,milestone_id,reason,idempotency_key,actor_email)
 VALUES(rid,p_tenant,p_entity,p_wallet,p_kind,p_units,p_invoice,p_lot,p_source,p_milestone,p_reason,p_key,lower(p_actor));
 RETURN jsonb_build_object('id',rid,'status','pending_approval');
END $fg$;
CREATE OR REPLACE FUNCTION rticore_fg_review(p_tenant text,p_entity text,p_actor text,p_request text,p_approve boolean,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE r rticore_flexguard_requests%ROWTYPE; w record; l rticore_flexguard_credit_lots%ROWTYPE; src rticore_flexguard_enterprise_ledger%ROWTYPE;
 actor_role text; inv record; av bigint; rs bigint; used bigint; restored bigint; val bigint; rate bigint; n bigint;
 da bigint:=0; dr bigint:=0; dc bigint:=0; de bigint:=0; dj bigint:=0; evt text; eid text; payload text; lot text;
 today text:=to_char(CURRENT_DATE,'YYYY-MM-DD'); nowtext text:=CURRENT_TIMESTAMP::text;
BEGIN
 actor_role:=rticore_fg_actor_role(p_tenant,p_entity,p_actor);
 IF actor_role IS NULL OR actor_role NOT IN ('finance','approver','admin') OR length(coalesce(p_notes,'')) NOT BETWEEN 12 AND 1000 OR NOT EXISTS(
 SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=p_tenant AND a.legal_entity_id=p_entity AND lower(a.email)=lower(p_actor) AND a.status='approved' AND a.finance_role IN ('cfo','financial_controller') AND a.can_approve=1 AND a.can_check=1 AND a.business_unit_id IS NULL AND a.department_id IS NULL
 ) THEN RAISE EXCEPTION 'FLEXGUARD_APPROVAL_DENIED'; END IF;
 SELECT * INTO r FROM rticore_flexguard_requests WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=p_request;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_SCOPE_INVALID'; END IF;
 SELECT x.*,c.status AS contract_status,c.end_date,c.project_id,c.model INTO w FROM rticore_flexguard_wallets x
 JOIN rticore_service_contracts c ON c.tenant_id=x.tenant_id AND c.id=x.contract_id AND c.customer_id=x.customer_id
 JOIN rticore_erp_project_scopes sc ON sc.tenant_id=c.tenant_id AND sc.project_id=c.project_id AND sc.legal_entity_id=p_entity AND sc.status='approved'
 WHERE x.tenant_id=p_tenant AND x.id=r.wallet_id AND x.status='active' AND c.model='FlexGuard' FOR UPDATE OF x;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_SCOPE_INVALID'; END IF;
 SELECT * INTO r FROM rticore_flexguard_requests WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=p_request FOR UPDATE;
 IF lower(r.actor_email)=lower(p_actor) THEN RAISE EXCEPTION 'FLEXGUARD_SELF_APPROVAL'; END IF;
 IF r.status<>'pending_approval' THEN RAISE EXCEPTION 'FLEXGUARD_REQUEST_ALREADY_REVIEWED'; END IF;
 IF p_approve IS NOT TRUE THEN UPDATE rticore_flexguard_requests SET status='rejected',approved_by=lower(p_actor),approved_at=nowtext,approval_notes=p_notes WHERE id=r.id; RETURN jsonb_build_object('id',r.id,'status','rejected'); END IF;
 IF rticore_fg_actor_role(p_tenant,p_entity,r.actor_email) IS NULL OR EXISTS(SELECT 1 FROM rticore_flexguard_events WHERE tenant_id=p_tenant AND wallet_id=w.id) THEN RAISE EXCEPTION 'FLEXGUARD_LEGACY_OR_SCOPE_REVIEW_REQUIRED'; END IF;
 n:=abs(r.credit_amount);
 IF r.transaction_type IN ('purchase','top_up') THEN
  IF w.contract_status<>'active' OR w.end_date<today THEN RAISE EXCEPTION 'FLEXGUARD_CONTRACT_INACTIVE'; END IF;
  SELECT i.* INTO inv FROM rticore_billing_invoices i WHERE i.tenant_id=p_tenant AND i.id=r.invoice_id AND i.project_id=w.project_id AND i.status='approved' AND i.reviewed_by IS NOT NULL AND lower(i.reviewed_by)<>lower(i.created_by);
  IF NOT FOUND OR (SELECT coalesce(sum(p.amount_cents),0) FROM rticore_billing_payments p WHERE p.tenant_id=p_tenant AND p.invoice_id=r.invoice_id AND p.status='approved')<inv.amount_cents+inv.vat_cents THEN RAISE EXCEPTION 'FLEXGUARD_PAYMENT_UNVERIFIED'; END IF;
  IF inv.amount_cents%n<>0 THEN RAISE EXCEPTION 'FLEXGUARD_RATE_ROUNDING_REVIEW_REQUIRED'; END IF;
  IF (SELECT coalesce(sum(credits_total),0) FROM rticore_flexguard_credit_lots WHERE tenant_id=p_tenant AND wallet_id=w.id)+n>w.entitlement_units THEN RAISE EXCEPTION 'FLEXGUARD_ENTITLEMENT_EXCEEDED'; END IF;
  IF (r.transaction_type='purchase' AND EXISTS(SELECT 1 FROM rticore_flexguard_credit_lots WHERE tenant_id=p_tenant AND wallet_id=w.id)) OR (r.transaction_type='top_up' AND NOT EXISTS(SELECT 1 FROM rticore_flexguard_credit_lots WHERE tenant_id=p_tenant AND wallet_id=w.id)) THEN RAISE EXCEPTION 'FLEXGUARD_PURCHASE_SEQUENCE'; END IF;
  lot:=gen_random_uuid()::text;rate:=inv.amount_cents/n;val:=inv.amount_cents;da:=n;evt:='flexguard.credit_purchased';
 ELSE
  SELECT * INTO l FROM rticore_flexguard_credit_lots WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND wallet_id=w.id AND id=r.lot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_LOT_SCOPE_INVALID'; END IF;
  lot:=l.id;rate:=l.unit_value_cents;val:=n*rate;
  SELECT coalesce(sum(available_delta),0),coalesce(sum(reserved_delta),0) INTO av,rs FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=p_tenant AND lot_id=lot;
  IF r.transaction_type IN ('reservation','consumption') AND (w.contract_status<>'active' OR l.expires_at<today) THEN RAISE EXCEPTION 'FLEXGUARD_LOT_EXPIRED'; END IF;
  IF r.transaction_type='reservation' THEN da:=-n;dr:=n;
  ELSIF r.transaction_type IN ('reservation_release','consumption') THEN
   SELECT * INTO src FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND wallet_id=w.id AND lot_id=lot AND id=r.source_tx_id AND transaction_type='reservation';
   IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_RESERVATION_SOURCE_INVALID'; END IF;
   SELECT coalesce(sum(credit_amount),0) INTO used FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=p_tenant AND source_tx_id=src.id AND transaction_type IN ('reservation_release','consumption');
   IF used+n>src.credit_amount THEN RAISE EXCEPTION 'FLEXGUARD_RESERVATION_EXCEEDED'; END IF;
   dr:=-n;
   IF r.transaction_type='reservation_release' THEN da:=n;
   ELSE
    IF NOT EXISTS(SELECT 1 FROM rticore_delivery_milestones m JOIN rticore_delivery_projects p ON p.tenant_id=m.tenant_id AND p.id=m.project_id JOIN rticore_document_library d ON d.tenant_id=m.tenant_id AND d.id=m.document_id AND d.opportunity_id=p.opportunity_id AND d.kind='supporting' WHERE m.tenant_id=p_tenant AND m.project_id=w.project_id AND m.id=r.milestone_id AND m.status='accepted' AND m.accepted_by IS NOT NULL AND lower(m.accepted_by)<>lower(m.created_by)) THEN RAISE EXCEPTION 'FLEXGUARD_ACCEPTED_DELIVERY_EVIDENCE_REQUIRED'; END IF;
    dc:=n;evt:='flexguard.credit_consumed';
   END IF;
  ELSIF r.transaction_type='expiry' THEN
   IF l.expires_at>=today THEN RAISE EXCEPTION 'FLEXGUARD_NOT_EXPIRED'; END IF;
   da:=-n;de:=n;evt:='flexguard.credit_expired';
  ELSIF r.transaction_type='adjustment' THEN
   IF r.credit_amount>0 THEN
    IF l.expires_at<today OR w.contract_status<>'active' THEN RAISE EXCEPTION 'FLEXGUARD_LOT_EXPIRED'; END IF;
    SELECT * INTO src FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND wallet_id=w.id AND lot_id=lot AND id=r.source_tx_id AND transaction_type='adjustment' AND credit_amount<0;
    IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_ADJUSTMENT_SOURCE_INVALID'; END IF;
    SELECT coalesce(sum(credit_amount),0) INTO restored FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=p_tenant AND source_tx_id=src.id AND transaction_type='adjustment' AND credit_amount>0;
    IF restored+n>abs(src.credit_amount) THEN RAISE EXCEPTION 'FLEXGUARD_ADJUSTMENT_EXCEEDED'; END IF;
   END IF;
   da:=r.credit_amount;dj:=r.credit_amount;evt:='flexguard.credit_adjusted';
  END IF;
  IF av+da<0 OR rs+dr<0 THEN RAISE EXCEPTION 'FLEXGUARD_INSUFFICIENT_BALANCE'; END IF;
 END IF;
 IF val<=0 OR val>=900000000000000 OR NOT EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=p_tenant AND a.legal_entity_id=p_entity AND lower(a.email)=lower(p_actor) AND a.status='approved' AND a.finance_role IN ('cfo','financial_controller') AND a.can_approve=1 AND a.can_check=1 AND a.business_unit_id IS NULL AND a.department_id IS NULL AND a.approval_limit_cents>=val) THEN RAISE EXCEPTION 'FLEXGUARD_APPROVAL_LIMIT'; END IF;
 IF r.transaction_type IN ('purchase','top_up') THEN
  INSERT INTO rticore_flexguard_credit_lots(id,tenant_id,legal_entity_id,customer_id,contract_id,wallet_id,invoice_id,lot_code,credits_total,unit_value_cents,financial_value_cents,issued_at,expires_at,created_by)
  VALUES(lot,p_tenant,p_entity,w.customer_id,w.contract_id,w.id,r.invoice_id,r.id,n,rate,val,today,w.end_date,r.actor_email);
 END IF;
 IF evt IS NOT NULL THEN
  eid:=gen_random_uuid()::text;
  payload:=jsonb_build_object('wallet_id',w.id,'customer_id',w.customer_id,'contract_id',w.contract_id,'lot_id',lot,'credits',n,'signed_credits',r.credit_amount,'unit_value_cents',rate,'amount_cents',val,'transaction_type',r.transaction_type,'source_tx_id',r.source_tx_id,'invoice_id',r.invoice_id,'milestone_id',r.milestone_id,'approved_by',lower(p_actor),'accounting_status','requires_independent_finance_policy_review','automatic_posting',false)::text;
  INSERT INTO rticore_finance_integration_events(id,tenant_id,legal_entity_id,direction,event_type,source_system,source_document_id,correlation_id,idempotency_key,schema_version,payload_json,payload_sha256,status,event_timestamp)
  VALUES(eid,p_tenant,p_entity,'outbox',evt,'RTICORE',r.id,'FG-'||r.id,'FG-'||r.id,'1.0',payload,encode(sha256(convert_to(payload,'UTF8')),'hex'),'received',nowtext);
 END IF;
 INSERT INTO rticore_flexguard_enterprise_ledger(id,tenant_id,legal_entity_id,customer_id,contract_id,wallet_id,lot_id,transaction_type,credit_amount,unit_value_cents,financial_value_cents,available_delta,reserved_delta,consumed_delta,expired_delta,adjustment_delta,source_tx_id,milestone_id,reference_code,idempotency_key,actor_email,approved_by,approved_at,reason,finance_outbox_event_id)
 VALUES(r.id,p_tenant,p_entity,w.customer_id,w.contract_id,w.id,lot,r.transaction_type,r.credit_amount,rate,val,da,dr,dc,de,dj,r.source_tx_id,r.milestone_id,r.id,r.idempotency_key,r.actor_email,lower(p_actor),nowtext,r.reason,eid);
 UPDATE rticore_flexguard_requests SET status='posted',approved_by=lower(p_actor),approved_at=nowtext,approval_notes=p_notes WHERE id=r.id;
 RETURN jsonb_build_object('id',r.id,'status','posted','lot_id',lot,'financial_value_cents',val,'finance_outbox_event_id',eid,'accounting_status','not_posted_to_gl');
END $fg$;
COMMIT;
