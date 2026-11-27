-- 0065: approved commercial evidence binding; no ledger writes.
BEGIN;
CREATE TABLE IF NOT EXISTS rticore_fg_contract_terms (
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,contract_id text NOT NULL,contract_version bigint NOT NULL,
 terms_id text NOT NULL,release_id text NOT NULL,boq_id text NOT NULL,boq_version bigint NOT NULL,boq_edit_seq bigint NOT NULL,proposal_sha256 text NOT NULL CHECK(length(proposal_sha256)=64),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),created_by text NOT NULL,approved_by text,approval_notes text,
 created_at timestamptz NOT NULL DEFAULT now(),approved_at timestamptz,
 UNIQUE(tenant_id,contract_id,contract_version),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES rticore_service_contracts(tenant_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id,terms_id) REFERENCES rticore_fg_product_terms(tenant_id,legal_entity_id,id),
 FOREIGN KEY(release_id) REFERENCES rticore_sales_releases(id),FOREIGN KEY(boq_id) REFERENCES rticore_boq(id),
 CHECK((status='draft' AND approved_by IS NULL AND approved_at IS NULL AND approval_notes IS NULL) OR (status='approved' AND approved_by IS NOT NULL AND lower(approved_by)<>lower(created_by) AND approved_at IS NOT NULL AND coalesce(length(approval_notes),0)>=12))
);
CREATE OR REPLACE FUNCTION rticore_fg_contract_binding_valid(p_tenant text,p_entity text,p_contract text,p_terms text) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $fg$
 SELECT EXISTS(SELECT 1 FROM rticore_fg_contract_terms b
 JOIN rticore_service_contracts c ON c.tenant_id=b.tenant_id AND c.id=b.contract_id AND c.version=b.contract_version
 JOIN rticore_delivery_projects p ON p.tenant_id=c.tenant_id AND p.id=c.project_id AND p.customer_id=c.customer_id AND p.release_id=b.release_id
 JOIN rticore_erp_project_scopes s ON s.tenant_id=p.tenant_id AND s.project_id=p.id AND s.legal_entity_id=b.legal_entity_id AND s.status='approved'
 JOIN rticore_sales_releases r ON r.tenant_id=p.tenant_id AND r.id=p.release_id AND r.opportunity_id=p.opportunity_id AND r.status='approved' AND r.proposal_sha256=b.proposal_sha256 AND r.boq_id=b.boq_id AND r.boq_version=b.boq_version AND r.boq_edit_seq=b.boq_edit_seq
 JOIN rticore_boq q ON q.tenant_id=r.tenant_id AND q.id=r.boq_id AND q.opportunity_id=r.opportunity_id AND q.version=r.boq_version AND q.edit_seq=r.boq_edit_seq AND q.status='approved'
 JOIN rticore_fg_product_terms t ON t.tenant_id=b.tenant_id AND t.legal_entity_id=b.legal_entity_id AND t.id=b.terms_id AND t.status='approved'
 WHERE b.tenant_id=p_tenant AND b.legal_entity_id=p_entity AND b.contract_id=p_contract AND b.terms_id=p_terms AND b.status='approved'
 AND c.model='FlexGuard' AND c.status='active' AND c.start_date<=CURRENT_DATE::text AND c.end_date>=CURRENT_DATE::text AND t.effective_from<=CURRENT_DATE AND t.package_price_cents=p.contract_cents)
$fg$;
CREATE OR REPLACE FUNCTION rticore_fg_contract_terms_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FLEXGUARD_BINDING_IMMUTABLE'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' THEN RAISE EXCEPTION 'FLEXGUARD_BINDING_INVALID'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status<>'draft' OR NEW.status<>'approved' OR (to_jsonb(OLD)-ARRAY['status','approved_by','approved_at','approval_notes']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','approved_by','approved_at','approval_notes']) THEN RAISE EXCEPTION 'FLEXGUARD_BINDING_IMMUTABLE'; END IF;
 RETURN NEW;
END $fg$;
DROP TRIGGER IF EXISTS rticore_fg_contract_terms_guard ON rticore_fg_contract_terms;
CREATE TRIGGER rticore_fg_contract_terms_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_fg_contract_terms FOR EACH ROW EXECUTE FUNCTION rticore_fg_contract_terms_guard();
CREATE OR REPLACE FUNCTION rticore_fg_bind_contract(p_tenant text,p_entity text,p_actor text,p_action text,p_contract text,p_terms text,p_notes text) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE role_name text; evidence record; existing rticore_fg_contract_terms%ROWTYPE; rid text;
BEGIN
 role_name:=rticore_fg_actor_role(p_tenant,p_entity,p_actor);
 SELECT c.version,r.id AS release_id,r.boq_id,r.boq_version,r.boq_edit_seq,r.proposal_sha256,t.package_price_cents,t.credits_included INTO evidence
 FROM rticore_service_contracts c JOIN rticore_delivery_projects p ON p.tenant_id=c.tenant_id AND p.id=c.project_id AND p.customer_id=c.customer_id
 JOIN rticore_erp_project_scopes s ON s.tenant_id=p.tenant_id AND s.project_id=p.id AND s.legal_entity_id=p_entity AND s.status='approved'
 JOIN rticore_sales_releases r ON r.tenant_id=p.tenant_id AND r.id=p.release_id AND r.opportunity_id=p.opportunity_id AND r.status='approved'
 JOIN rticore_boq q ON q.tenant_id=r.tenant_id AND q.id=r.boq_id AND q.opportunity_id=r.opportunity_id AND q.version=r.boq_version AND q.edit_seq=r.boq_edit_seq AND q.status='approved'
 JOIN rticore_fg_product_terms t ON t.tenant_id=c.tenant_id AND t.legal_entity_id=p_entity AND t.id=p_terms AND t.status='approved'
 WHERE c.tenant_id=p_tenant AND c.id=p_contract AND c.model='FlexGuard' AND c.status='active' AND c.start_date<=CURRENT_DATE::text AND c.end_date>=CURRENT_DATE::text AND t.effective_from<=CURRENT_DATE AND t.package_price_cents=p.contract_cents FOR UPDATE OF c;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_SCOPE_INVALID'; END IF;
 IF p_action='create' THEN
  IF role_name IS DISTINCT FROM 'finance' OR NOT EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=p_tenant AND a.legal_entity_id=p_entity AND lower(a.email)=lower(p_actor) AND a.status='approved' AND a.can_make=1 AND a.finance_role IN ('finance_manager','financial_controller','accounting_officer') AND a.business_unit_id IS NULL AND a.department_id IS NULL) THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
  rid:=gen_random_uuid()::text;
  INSERT INTO rticore_fg_contract_terms(id,tenant_id,legal_entity_id,contract_id,contract_version,terms_id,release_id,boq_id,boq_version,boq_edit_seq,proposal_sha256,created_by)
  VALUES(rid,p_tenant,p_entity,p_contract,evidence.version,p_terms,evidence.release_id,evidence.boq_id,evidence.boq_version,evidence.boq_edit_seq,evidence.proposal_sha256,lower(p_actor));
  RETURN jsonb_build_object('id',rid,'status','draft');
 END IF;
 IF p_action IS DISTINCT FROM 'approve' OR coalesce(role_name,'') NOT IN ('finance','approver') OR length(coalesce(p_notes,'')) NOT BETWEEN 12 AND 1000 OR NOT EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=p_tenant AND a.legal_entity_id=p_entity AND lower(a.email)=lower(p_actor) AND a.status='approved' AND a.can_check=1 AND a.can_approve=1 AND a.finance_role IN ('cfo','financial_controller') AND a.approval_limit_cents>=evidence.package_price_cents AND a.business_unit_id IS NULL AND a.department_id IS NULL) THEN RAISE EXCEPTION 'FLEXGUARD_APPROVAL_DENIED'; END IF;
 SELECT * INTO existing FROM rticore_fg_contract_terms WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND contract_id=p_contract AND contract_version=evidence.version AND terms_id=p_terms FOR UPDATE;
 IF NOT FOUND OR existing.status<>'draft' OR existing.release_id<>evidence.release_id OR existing.boq_id<>evidence.boq_id OR existing.boq_version<>evidence.boq_version OR existing.boq_edit_seq<>evidence.boq_edit_seq OR existing.proposal_sha256<>evidence.proposal_sha256 THEN RAISE EXCEPTION 'FLEXGUARD_BINDING_INVALID'; END IF;
 IF lower(existing.created_by)=lower(p_actor) THEN RAISE EXCEPTION 'FLEXGUARD_SELF_APPROVAL'; END IF;
 UPDATE rticore_fg_contract_terms SET status='approved',approved_by=lower(p_actor),approved_at=now(),approval_notes=p_notes WHERE id=existing.id;
 IF NOT rticore_fg_contract_binding_valid(p_tenant,p_entity,p_contract,p_terms) THEN RAISE EXCEPTION 'FLEXGUARD_BINDING_INVALID'; END IF;
 RETURN jsonb_build_object('id',existing.id,'status','approved','entitlement_units',evidence.credits_included);
END $fg$;
COMMIT;
