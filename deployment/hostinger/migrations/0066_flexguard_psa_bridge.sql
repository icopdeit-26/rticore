-- 0066: native bound wallet and PSA evidence bridge. Existing historical ledger remains untouched.
BEGIN;
CREATE TABLE IF NOT EXISTS rticore_fg_psa_consumption_evidence (
 tenant_id text NOT NULL,legal_entity_id text NOT NULL,request_id text NOT NULL,timesheet_id text NOT NULL,
 binding_id text NOT NULL REFERENCES rticore_fg_contract_terms(id),service_tier text NOT NULL,minutes bigint NOT NULL CHECK(minutes BETWEEN 15 AND 480),
 multiplier_bps bigint NOT NULL CHECK(multiplier_bps BETWEEN 5000 AND 50000),unit_value_cents bigint NOT NULL CHECK(unit_value_cents>0),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,timesheet_id),
 FOREIGN KEY(tenant_id,request_id) REFERENCES rticore_flexguard_requests(tenant_id,id),
 FOREIGN KEY(tenant_id,timesheet_id) REFERENCES rticore_project_timesheets(tenant_id,id)
);
CREATE OR REPLACE FUNCTION rticore_fg_bound_wallet_command(p_tenant text,p_entity text,p_actor text,p_action text,p_id text,p_notes text) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE bid text; units bigint; cid text; wallet_units bigint;
BEGIN
 IF p_action='create' THEN cid:=p_id;
 ELSIF p_action='approve' THEN
  SELECT contract_id,entitlement_units INTO cid,wallet_units FROM rticore_flexguard_wallets WHERE tenant_id=p_tenant AND id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_SCOPE_INVALID'; END IF;
 ELSE RAISE EXCEPTION 'FLEXGUARD_REQUEST_INVALID'; END IF;
 PERFORM 1 FROM rticore_service_contracts WHERE tenant_id=p_tenant AND id=cid FOR UPDATE;
 SELECT b.id,t.credits_included INTO bid,units FROM rticore_fg_contract_terms b JOIN rticore_fg_product_terms t ON t.id=b.terms_id AND t.tenant_id=b.tenant_id AND t.legal_entity_id=b.legal_entity_id
 WHERE b.tenant_id=p_tenant AND b.legal_entity_id=p_entity AND b.contract_id=cid AND rticore_fg_contract_binding_valid(p_tenant,p_entity,cid,b.terms_id);
 IF NOT FOUND OR (p_action='approve' AND wallet_units<>units) THEN RAISE EXCEPTION 'FLEXGUARD_BINDING_INVALID'; END IF;
 RETURN rticore_fg_wallet_command(p_tenant,p_entity,p_actor,p_action,p_id,CASE WHEN p_action='create' THEN units ELSE NULL END,p_notes);
END $fg$;
-- Preserve historic wallets; once a contract has approved binding, even the old command cannot create inconsistent entitlement.
CREATE OR REPLACE FUNCTION rticore_fg_bound_wallet_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
BEGIN
 IF EXISTS(SELECT 1 FROM rticore_fg_contract_terms b WHERE b.tenant_id=NEW.tenant_id AND b.contract_id=NEW.contract_id AND b.status='approved')
 AND NOT EXISTS(SELECT 1 FROM rticore_fg_contract_terms b JOIN rticore_fg_product_terms t ON t.id=b.terms_id AND t.tenant_id=b.tenant_id AND t.legal_entity_id=b.legal_entity_id WHERE b.tenant_id=NEW.tenant_id AND b.contract_id=NEW.contract_id AND t.credits_included=NEW.entitlement_units AND rticore_fg_contract_binding_valid(b.tenant_id,b.legal_entity_id,b.contract_id,b.terms_id))
 THEN RAISE EXCEPTION 'FLEXGUARD_ENTITLEMENT_BINDING_INVALID'; END IF;
 RETURN NEW;
END $fg$;
DROP TRIGGER IF EXISTS rticore_fg_bound_wallet_guard ON rticore_flexguard_wallets;
CREATE TRIGGER rticore_fg_bound_wallet_guard BEFORE INSERT OR UPDATE ON rticore_flexguard_wallets FOR EACH ROW EXECUTE FUNCTION rticore_fg_bound_wallet_guard();
CREATE OR REPLACE FUNCTION rticore_fg_psa_source_valid(p_tenant text,p_entity text,p_project text,p_timesheet text) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $fg$
 SELECT EXISTS(SELECT 1 FROM rticore_project_timesheets ts JOIN rticore_finance_integration_events e ON e.tenant_id=ts.tenant_id AND e.legal_entity_id=p_entity AND e.direction='outbox' AND e.event_type='timesheet.approved' AND e.source_document_id=ts.id
 WHERE ts.tenant_id=p_tenant AND ts.project_id=p_project AND ts.id=p_timesheet AND ts.status='approved' AND ts.billable=1 AND ts.reviewed_by IS NOT NULL AND lower(ts.reviewed_by)<>lower(ts.created_by)
 AND e.payload_sha256=encode(sha256(convert_to(e.payload_json,'UTF8')),'hex') AND e.payload_json::jsonb->>'timesheet_id'=ts.id AND e.payload_json::jsonb->>'project_id'=ts.project_id AND e.payload_json::jsonb->>'minutes'=ts.minutes::text AND e.payload_json::jsonb->>'billable'='true' AND e.payload_json::jsonb->>'cost_snapshot_cents'=ts.cost_snapshot_cents::text AND lower(e.payload_json::jsonb->>'approved_by')=lower(ts.reviewed_by))
$fg$;
CREATE OR REPLACE FUNCTION rticore_fg_psa_submit(p_tenant text,p_entity text,p_actor text,p_wallet text,p_lot text,p_reservation text,p_milestone text,p_tier text,p_ids jsonb,p_key text,p_notes text) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE w record; ts record; n bigint; mins bigint:=0; cnt bigint:=0; r jsonb; rid text; tid text; ids text[];
BEGIN
 IF rticore_fg_actor_role(p_tenant,p_entity,p_actor) IS DISTINCT FROM 'finance' OR NOT EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=p_tenant AND a.legal_entity_id=p_entity AND lower(a.email)=lower(p_actor) AND a.status='approved' AND a.can_make=1 AND a.finance_role IN ('finance_manager','financial_controller','accounting_officer') AND a.business_unit_id IS NULL AND a.department_id IS NULL) THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
 IF jsonb_typeof(p_ids) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'FLEXGUARD_PSA_INVALID'; END IF;
 IF jsonb_array_length(p_ids) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'FLEXGUARD_PSA_INVALID'; END IF;
 SELECT array_agg(value ORDER BY value) INTO ids FROM jsonb_array_elements_text(p_ids);
 IF (SELECT count(DISTINCT x) FROM unnest(ids) x)<>cardinality(ids) THEN RAISE EXCEPTION 'FLEXGUARD_PSA_DUPLICATE'; END IF;
 SELECT x.id,x.entitlement_units,c.id AS contract_id,c.project_id,c.start_date,c.end_date,b.id AS binding_id,t.unit_credit_price_cents,t.credits_included,m.multiplier_bps INTO w
 FROM rticore_flexguard_wallets x JOIN rticore_service_contracts c ON c.tenant_id=x.tenant_id AND c.id=x.contract_id
 JOIN rticore_fg_contract_terms b ON b.tenant_id=c.tenant_id AND b.contract_id=c.id AND b.legal_entity_id=p_entity
 JOIN rticore_fg_product_terms t ON t.tenant_id=b.tenant_id AND t.legal_entity_id=b.legal_entity_id AND t.id=b.terms_id
 JOIN rticore_fg_product_conversions m ON m.tenant_id=t.tenant_id AND m.legal_entity_id=t.legal_entity_id AND m.terms_id=t.id AND m.service_tier=p_tier
 JOIN rticore_flexguard_credit_lots l ON l.tenant_id=x.tenant_id AND l.wallet_id=x.id AND l.legal_entity_id=p_entity AND l.id=p_lot AND l.unit_value_cents=t.unit_credit_price_cents
 WHERE x.tenant_id=p_tenant AND x.id=p_wallet AND x.status='active' AND x.entitlement_units=t.credits_included AND rticore_fg_contract_binding_valid(p_tenant,p_entity,c.id,t.id) FOR UPDATE OF x;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_BINDING_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rticore_delivery_milestones m JOIN rticore_delivery_projects p ON p.tenant_id=m.tenant_id AND p.id=m.project_id JOIN rticore_document_library d ON d.tenant_id=m.tenant_id AND d.id=m.document_id AND d.opportunity_id=p.opportunity_id AND d.kind='supporting' WHERE m.tenant_id=p_tenant AND m.project_id=w.project_id AND m.id=p_milestone AND m.status='accepted' AND m.accepted_by IS NOT NULL AND lower(m.accepted_by)<>lower(m.created_by)) THEN RAISE EXCEPTION 'FLEXGUARD_ACCEPTED_DELIVERY_EVIDENCE_REQUIRED'; END IF;
 FOR ts IN SELECT * FROM rticore_project_timesheets WHERE tenant_id=p_tenant AND project_id=w.project_id AND id=ANY(ids) AND work_date BETWEEN w.start_date AND w.end_date ORDER BY id FOR SHARE LOOP
  IF NOT rticore_fg_psa_source_valid(p_tenant,p_entity,w.project_id,ts.id) THEN RAISE EXCEPTION 'FLEXGUARD_PSA_SOURCE_INVALID'; END IF;
  mins:=mins+ts.minutes;cnt:=cnt+1;
 END LOOP;
 IF cnt<>cardinality(ids) THEN RAISE EXCEPTION 'FLEXGUARD_PSA_SOURCE_INVALID'; END IF;
 n:=(mins*w.multiplier_bps+4799999)/4800000;
 IF n NOT BETWEEN 1 AND w.credits_included THEN RAISE EXCEPTION 'FLEXGUARD_ENTITLEMENT_EXCEEDED'; END IF;
 r:=rticore_fg_submit(p_tenant,p_entity,p_actor,p_wallet,'consumption',n,NULL,p_lot,p_reservation,p_milestone,p_key,p_notes);rid:=r->>'id';
 IF coalesce((r->>'replayed')::boolean,false) THEN
  IF (SELECT array_agg(timesheet_id ORDER BY timesheet_id) FROM rticore_fg_psa_consumption_evidence WHERE tenant_id=p_tenant AND request_id=rid AND legal_entity_id=p_entity AND binding_id=w.binding_id AND service_tier=p_tier) IS DISTINCT FROM ids THEN RAISE EXCEPTION 'FLEXGUARD_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN r;
 END IF;
 FOREACH tid IN ARRAY ids LOOP
  INSERT INTO rticore_fg_psa_consumption_evidence(tenant_id,legal_entity_id,request_id,timesheet_id,binding_id,service_tier,minutes,multiplier_bps,unit_value_cents)
  SELECT p_tenant,p_entity,rid,t.id,w.binding_id,p_tier,t.minutes,w.multiplier_bps,w.unit_credit_price_cents FROM rticore_project_timesheets t WHERE t.tenant_id=p_tenant AND t.id=tid;
 END LOOP;
 RETURN r||jsonb_build_object('credits',n,'approved_billable_minutes',mins,'accounting_status','not_posted_to_gl');
END $fg$;
CREATE OR REPLACE FUNCTION rticore_fg_psa_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $fg$
BEGIN RAISE EXCEPTION 'FLEXGUARD_PSA_EVIDENCE_IMMUTABLE'; END $fg$;
DROP TRIGGER IF EXISTS rticore_fg_psa_evidence_immutable ON rticore_fg_psa_consumption_evidence;
CREATE TRIGGER rticore_fg_psa_evidence_immutable BEFORE UPDATE OR DELETE ON rticore_fg_psa_consumption_evidence FOR EACH ROW EXECUTE FUNCTION rticore_fg_psa_evidence_immutable();
CREATE OR REPLACE FUNCTION rticore_fg_psa_post_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE n bigint; bad bigint; cnt bigint; tier_count bigint;
BEGIN
 IF NEW.transaction_type<>'consumption' THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM rticore_fg_contract_terms b WHERE b.tenant_id=NEW.tenant_id AND b.contract_id=NEW.contract_id AND b.status='approved') THEN RETURN NEW; END IF;
 SELECT count(*),count(DISTINCT e.service_tier),coalesce(sum(e.minutes*e.multiplier_bps),0),count(*) FILTER(WHERE b.id IS NULL OR t.id IS NULL OR c.id IS NULL OR ts.id IS NULL OR ts.minutes<>e.minutes OR m.multiplier_bps IS DISTINCT FROM e.multiplier_bps OR t.unit_credit_price_cents IS DISTINCT FROM e.unit_value_cents OR NEW.unit_value_cents<>e.unit_value_cents OR NOT coalesce(rticore_fg_contract_binding_valid(NEW.tenant_id,NEW.legal_entity_id,NEW.contract_id,t.id),false) OR NOT coalesce(rticore_fg_psa_source_valid(NEW.tenant_id,NEW.legal_entity_id,c.project_id,e.timesheet_id),false)) INTO cnt,tier_count,n,bad
 FROM rticore_fg_psa_consumption_evidence e
 LEFT JOIN rticore_fg_contract_terms b ON b.id=e.binding_id AND b.tenant_id=e.tenant_id AND b.legal_entity_id=e.legal_entity_id AND b.contract_id=NEW.contract_id
 LEFT JOIN rticore_fg_product_terms t ON t.id=b.terms_id AND t.tenant_id=b.tenant_id AND t.legal_entity_id=b.legal_entity_id
 LEFT JOIN rticore_fg_product_conversions m ON m.tenant_id=t.tenant_id AND m.legal_entity_id=t.legal_entity_id AND m.terms_id=t.id AND m.service_tier=e.service_tier
 LEFT JOIN rticore_service_contracts c ON c.tenant_id=b.tenant_id AND c.id=b.contract_id
 LEFT JOIN rticore_project_timesheets ts ON ts.tenant_id=e.tenant_id AND ts.id=e.timesheet_id AND ts.project_id=c.project_id AND ts.work_date BETWEEN c.start_date AND c.end_date
 WHERE e.tenant_id=NEW.tenant_id AND e.legal_entity_id=NEW.legal_entity_id AND e.request_id=NEW.id;
 IF cnt=0 OR tier_count<>1 OR bad<>0 OR (n+4799999)/4800000<>NEW.credit_amount THEN RAISE EXCEPTION 'FLEXGUARD_PSA_EVIDENCE_REQUIRED'; END IF;
 RETURN NEW;
END $fg$;
DROP TRIGGER IF EXISTS rticore_fg_psa_post_guard ON rticore_flexguard_enterprise_ledger;
CREATE TRIGGER rticore_fg_psa_post_guard BEFORE INSERT ON rticore_flexguard_enterprise_ledger FOR EACH ROW EXECUTE FUNCTION rticore_fg_psa_post_guard();
COMMIT;
