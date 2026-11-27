-- 0067: native reconciliation of PR1 Service Master and Rate Card, without legacy migration 0053.
BEGIN;
CREATE TABLE IF NOT EXISTS rticore_service_catalog_v2 (
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,
 service_code text NOT NULL CHECK(length(service_code) BETWEEN 3 AND 48),service_name text NOT NULL CHECK(length(service_name) BETWEEN 3 AND 160),
 service_category text NOT NULL CHECK(service_category IN ('web_app_pentest','mobile_app_pentest','api_pentest','network_pentest','infrastructure_assessment','cloud_security_assessment','active_directory_assessment','wireless_security_assessment','red_team_assessment','purple_team_assessment','vulnerability_assessment','source_code_review','soc_managed_services','mdr','siem_implementation','digital_forensics','incident_response','cyber_threat_intelligence','threat_hunting','grc_consulting','iso_27001_consulting','data_privacy_consulting','it_risk_management','security_architecture_consulting','cybersecurity_awareness','cybersecurity_training','security_tool_implementation','technology_professional_services','other_configurable')),
 description text NOT NULL CHECK(length(description) BETWEEN 8 AND 1000),scope_summary text NOT NULL CHECK(length(scope_summary) BETWEEN 8 AND 2000),
 complexity_level text NOT NULL CHECK(complexity_level IN ('basic','standard','medium','high','critical')),
 min_mandays_tenths bigint NOT NULL CHECK(min_mandays_tenths BETWEEN 5 AND 100000),
 standard_mandays_tenths bigint NOT NULL CHECK(standard_mandays_tenths BETWEEN min_mandays_tenths AND 100000),
 max_mandays_tenths bigint NOT NULL CHECK(max_mandays_tenths BETWEEN standard_mandays_tenths AND 100000),
 effective_date date NOT NULL,service_version bigint NOT NULL CHECK(service_version BETWEEN 1 AND 1000000),
 lifecycle_status text NOT NULL DEFAULT 'draft' CHECK(lifecycle_status IN ('draft','approved')),
 created_by text NOT NULL,approved_by text,approval_notes text,approved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,legal_entity_id,id),UNIQUE(tenant_id,legal_entity_id,service_code,service_version),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 CHECK((lifecycle_status='draft' AND approved_by IS NULL AND approval_notes IS NULL AND approved_at IS NULL) OR (lifecycle_status='approved' AND approved_by IS NOT NULL AND lower(approved_by)<>lower(created_by) AND coalesce(length(approval_notes),0) BETWEEN 12 AND 1000 AND approved_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS rticore_enterprise_rate_cards (
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,
 role_code text NOT NULL CHECK(role_code IN ('junior_analyst','analyst','senior_analyst','consultant','senior_consultant','specialist','lead_pentester','principal_consultant','soc_analyst_l1','soc_analyst_l2','soc_analyst_l3','incident_responder','digital_forensic_specialist','threat_intelligence_analyst','grc_consultant','project_manager','solution_architect','subject_matter_expert','external_associate')),
 monthly_compensation_cents bigint NOT NULL CHECK(monthly_compensation_cents BETWEEN 0 AND 1000000000000),
 benefit_allocation_cents bigint NOT NULL CHECK(benefit_allocation_cents BETWEEN 0 AND 1000000000000),
 employer_contrib_cents bigint NOT NULL CHECK(employer_contrib_cents BETWEEN 0 AND 1000000000000),
 allocated_expense_cents bigint NOT NULL CHECK(allocated_expense_cents BETWEEN 0 AND 1000000000000),
 annual_loaded_cost_cents bigint GENERATED ALWAYS AS ((monthly_compensation_cents+benefit_allocation_cents+employer_contrib_cents+allocated_expense_cents)*12) STORED,
 available_working_days bigint NOT NULL CHECK(available_working_days BETWEEN 100 AND 300),target_utilization_bps bigint NOT NULL CHECK(target_utilization_bps BETWEEN 3000 AND 9500),
 target_margin_bps bigint NOT NULL CHECK(target_margin_bps BETWEEN 500 AND 8500),min_margin_bps bigint NOT NULL CHECK(min_margin_bps BETWEEN 0 AND target_margin_bps),
 internal_cost_rate_cents bigint NOT NULL CHECK(internal_cost_rate_cents>0),standard_selling_rate_cents bigint NOT NULL CHECK(standard_selling_rate_cents>=internal_cost_rate_cents),
 min_selling_rate_cents bigint NOT NULL CHECK(min_selling_rate_cents BETWEEN internal_cost_rate_cents AND standard_selling_rate_cents),
 effective_date date NOT NULL,version bigint NOT NULL CHECK(version BETWEEN 1 AND 1000000),status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),
 created_by text NOT NULL,approved_by text,approval_notes text,approved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,legal_entity_id,id),UNIQUE(tenant_id,legal_entity_id,role_code,effective_date,version),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 CHECK(annual_loaded_cost_cents>0),
 CHECK(internal_cost_rate_cents=round(annual_loaded_cost_cents::numeric*100/round(available_working_days*target_utilization_bps::numeric/100))),
 CHECK(standard_selling_rate_cents=ceil(internal_cost_rate_cents::numeric*10000/(10000-target_margin_bps))),
 CHECK(min_selling_rate_cents=ceil(internal_cost_rate_cents::numeric*10000/(10000-min_margin_bps))),
 CHECK((status='draft' AND approved_by IS NULL AND approval_notes IS NULL AND approved_at IS NULL) OR (status='approved' AND approved_by IS NOT NULL AND lower(approved_by)<>lower(created_by) AND coalesce(length(approval_notes),0) BETWEEN 12 AND 1000 AND approved_at IS NOT NULL))
);
CREATE OR REPLACE FUNCTION rticore_catalog_finance_access(p_tenant text,p_entity text,p_actor text,p_mode text) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $cat$
 SELECT coalesce(rticore_fg_actor_role(p_tenant,p_entity,p_actor),'') IN (CASE WHEN p_mode='make' THEN 'finance' ELSE 'approver' END,'finance')
 AND EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=p_tenant AND a.legal_entity_id=p_entity AND lower(a.email)=lower(p_actor) AND a.status='approved' AND a.business_unit_id IS NULL AND a.department_id IS NULL AND
 ((p_mode='make' AND a.can_make=1 AND a.finance_role IN ('financial_controller','finance_manager','accounting_officer')) OR (p_mode='approve' AND a.can_check=1 AND a.can_approve=1 AND a.finance_role IN ('cfo','financial_controller'))))
$cat$;
CREATE OR REPLACE FUNCTION rticore_catalog_version_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $cat$
DECLARE status_field text:=CASE WHEN TG_TABLE_NAME='rticore_service_catalog_v2' THEN 'lifecycle_status' ELSE 'status' END;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CATALOG_IMMUTABLE'; END IF;
 IF TG_OP='INSERT' THEN
  IF to_jsonb(NEW)->>status_field<>'draft' OR NOT rticore_catalog_finance_access(NEW.tenant_id,NEW.legal_entity_id,NEW.created_by,'make') THEN RAISE EXCEPTION 'CATALOG_ACCESS_DENIED'; END IF;
  RETURN NEW;
 END IF;
 IF to_jsonb(OLD)->>status_field<>'draft' OR to_jsonb(NEW)->>status_field<>'approved' OR
 (to_jsonb(OLD)-ARRAY[status_field,'approved_by','approval_notes','approved_at','annual_loaded_cost_cents']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY[status_field,'approved_by','approval_notes','approved_at','annual_loaded_cost_cents'])
 THEN RAISE EXCEPTION 'CATALOG_IMMUTABLE'; END IF;
 IF lower(NEW.approved_by)=lower(OLD.created_by) OR NOT rticore_catalog_finance_access(NEW.tenant_id,NEW.legal_entity_id,NEW.approved_by,'approve') THEN RAISE EXCEPTION 'CATALOG_APPROVAL_DENIED'; END IF;
 RETURN NEW;
END $cat$;
DROP TRIGGER IF EXISTS rticore_catalog_service_guard ON rticore_service_catalog_v2;
CREATE TRIGGER rticore_catalog_service_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_service_catalog_v2 FOR EACH ROW EXECUTE FUNCTION rticore_catalog_version_guard();
DROP TRIGGER IF EXISTS rticore_catalog_rate_guard ON rticore_enterprise_rate_cards;
CREATE TRIGGER rticore_catalog_rate_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_enterprise_rate_cards FOR EACH ROW EXECUTE FUNCTION rticore_catalog_version_guard();
CREATE OR REPLACE FUNCTION rticore_catalog_command(p_tenant text,p_entity text,p_actor text,p_action text,p_id text,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $cat$
DECLARE rid text:=gen_random_uuid()::text; n bigint; cost bigint; annual numeric; days bigint; util bigint; target bigint; minimum bigint;
BEGIN
 IF p_action IN ('create_service','create_rate_card') THEN
  IF NOT rticore_catalog_finance_access(p_tenant,p_entity,p_actor,'make') THEN RAISE EXCEPTION 'CATALOG_ACCESS_DENIED'; END IF;
  IF p_action='create_service' THEN
   INSERT INTO rticore_service_catalog_v2(id,tenant_id,legal_entity_id,service_code,service_name,service_category,description,scope_summary,complexity_level,min_mandays_tenths,standard_mandays_tenths,max_mandays_tenths,effective_date,service_version,created_by)
   VALUES(rid,p_tenant,p_entity,p_data->>'service_code',p_data->>'service_name',p_data->>'service_category',p_data->>'description',p_data->>'scope_summary',p_data->>'complexity_level',(p_data->>'min_mandays_tenths')::bigint,(p_data->>'standard_mandays_tenths')::bigint,(p_data->>'max_mandays_tenths')::bigint,(p_data->>'effective_date')::date,(p_data->>'service_version')::bigint,lower(p_actor));
  ELSE
   annual:=((p_data->>'monthly_compensation_cents')::numeric+(p_data->>'benefit_allocation_cents')::numeric+(p_data->>'employer_contrib_cents')::numeric+(p_data->>'allocated_expense_cents')::numeric)*12;
   days:=(p_data->>'available_working_days')::bigint;util:=(p_data->>'target_utilization_bps')::bigint;target:=(p_data->>'target_margin_bps')::bigint;minimum:=(p_data->>'min_margin_bps')::bigint;
   IF annual IS NULL OR annual<=0 OR days NOT BETWEEN 100 AND 300 OR util NOT BETWEEN 3000 AND 9500 OR target NOT BETWEEN 500 AND 8500 OR minimum NOT BETWEEN 0 AND target THEN RAISE EXCEPTION 'CATALOG_RATE_INVALID'; END IF;
   cost:=round(annual*100/round(days*util::numeric/100));
   INSERT INTO rticore_enterprise_rate_cards(id,tenant_id,legal_entity_id,role_code,monthly_compensation_cents,benefit_allocation_cents,employer_contrib_cents,allocated_expense_cents,available_working_days,target_utilization_bps,target_margin_bps,min_margin_bps,internal_cost_rate_cents,standard_selling_rate_cents,min_selling_rate_cents,effective_date,version,created_by)
   VALUES(rid,p_tenant,p_entity,p_data->>'role_code',(p_data->>'monthly_compensation_cents')::bigint,(p_data->>'benefit_allocation_cents')::bigint,(p_data->>'employer_contrib_cents')::bigint,(p_data->>'allocated_expense_cents')::bigint,days,util,target,minimum,cost,ceil(cost::numeric*10000/(10000-target)),ceil(cost::numeric*10000/(10000-minimum)),(p_data->>'effective_date')::date,(p_data->>'version')::bigint,lower(p_actor));
  END IF;
 ELSE
  IF NOT rticore_catalog_finance_access(p_tenant,p_entity,p_actor,'approve') THEN RAISE EXCEPTION 'CATALOG_APPROVAL_DENIED'; END IF;
  rid:=p_id;
  IF p_action='approve_service' THEN
   UPDATE rticore_service_catalog_v2 SET lifecycle_status='approved',approved_by=lower(p_actor),approved_at=now(),approval_notes=p_data->>'notes' WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=rid AND lifecycle_status='draft';
  ELSIF p_action='approve_rate_card' THEN
   UPDATE rticore_enterprise_rate_cards SET status='approved',approved_by=lower(p_actor),approved_at=now(),approval_notes=p_data->>'notes' WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=rid AND status='draft';
  ELSE RAISE EXCEPTION 'CATALOG_ACTION_INVALID'; END IF;
  GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'CATALOG_SCOPE_INVALID'; END IF;
 END IF;
 INSERT INTO rticore_operations_events(id,tenant_id,area,entity_id,action,actor_email,snapshot_json)
 VALUES(gen_random_uuid()::text,p_tenant,'service_catalog',rid,p_action,lower(p_actor),jsonb_build_object('legal_entity_id',p_entity)::text);
 RETURN jsonb_build_object('id',rid,'status',CASE WHEN p_action LIKE 'create_%' THEN 'draft' ELSE 'approved' END);
END $cat$;
COMMIT;
