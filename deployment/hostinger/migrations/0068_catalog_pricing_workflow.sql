-- 0068 native activity profiles, approved complexity and immutable pricing evidence.
BEGIN;
CREATE TABLE IF NOT EXISTS rticore_catalog_activity_profiles(
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,service_id text NOT NULL,version bigint NOT NULL CHECK(version BETWEEN 1 AND 1000000),
 activities jsonb NOT NULL CHECK(jsonb_typeof(activities)='array' AND jsonb_array_length(activities) BETWEEN 1 AND 60),
 UNIQUE(tenant_id,legal_entity_id,service_id,version),
 FOREIGN KEY(tenant_id,legal_entity_id,service_id) REFERENCES rticore_service_catalog_v2(tenant_id,legal_entity_id,id),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),created_by text NOT NULL,approved_by text,approval_notes text,approved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,legal_entity_id,id),FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),CHECK((status='draft' AND approved_by IS NULL AND approval_notes IS NULL AND approved_at IS NULL) OR (status='approved' AND approved_by IS NOT NULL AND lower(approved_by)<>lower(created_by) AND coalesce(length(approval_notes),0) BETWEEN 12 AND 1000 AND approved_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS rticore_catalog_complexity(
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,matrix_code text NOT NULL CHECK(length(matrix_code) BETWEEN 3 AND 64),label text NOT NULL CHECK(length(label) BETWEEN 3 AND 160),
 version bigint NOT NULL CHECK(version BETWEEN 1 AND 1000000),factor_bps bigint NOT NULL CHECK(factor_bps BETWEEN 5000 AND 40000),
 UNIQUE(tenant_id,legal_entity_id,matrix_code,version),status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),created_by text NOT NULL,approved_by text,approval_notes text,approved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,legal_entity_id,id),FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),CHECK((status='draft' AND approved_by IS NULL AND approval_notes IS NULL AND approved_at IS NULL) OR (status='approved' AND approved_by IS NOT NULL AND lower(approved_by)<>lower(created_by) AND coalesce(length(approval_notes),0) BETWEEN 12 AND 1000 AND approved_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS rticore_catalog_pricing_snapshots(
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,service_id text NOT NULL,profile_id text NOT NULL,complexity_id text NOT NULL,
 opportunity_id text NOT NULL,opportunity_scope_version bigint NOT NULL,quantity bigint NOT NULL CHECK(quantity BETWEEN 1 AND 1000),
 pricing_method text NOT NULL CHECK(pricing_method IN ('target_margin','cost_plus')),
 overhead_bps bigint NOT NULL CHECK(overhead_bps BETWEEN 0 AND 6000),risk_bps bigint NOT NULL CHECK(risk_bps BETWEEN 0 AND 5000),target_bps bigint NOT NULL CHECK(target_bps BETWEEN 0 AND 8500),
 minimum_margin_bps bigint NOT NULL CHECK(minimum_margin_bps BETWEEN 0 AND 8500),
 billable_mandays_tenths bigint NOT NULL CHECK(billable_mandays_tenths>0),nonbillable_mandays_tenths bigint NOT NULL CHECK(nonbillable_mandays_tenths>=0),
 direct_cost_cents bigint NOT NULL CHECK(direct_cost_cents>0),loaded_cost_cents bigint NOT NULL CHECK(loaded_cost_cents>=direct_cost_cents),net_price_cents bigint NOT NULL CHECK(net_price_cents>=loaded_cost_cents AND net_price_cents<900000000000000),
 calculation jsonb NOT NULL,calculation_sha256 text NOT NULL CHECK(calculation_sha256=encode(sha256(convert_to(calculation::text,'UTF8')),'hex')),
 FOREIGN KEY(tenant_id,legal_entity_id,service_id) REFERENCES rticore_service_catalog_v2(tenant_id,legal_entity_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id,profile_id) REFERENCES rticore_catalog_activity_profiles(tenant_id,legal_entity_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id,complexity_id) REFERENCES rticore_catalog_complexity(tenant_id,legal_entity_id,id),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),created_by text NOT NULL,approved_by text,approval_notes text,approved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,legal_entity_id,id),FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),CHECK((status='draft' AND approved_by IS NULL AND approval_notes IS NULL AND approved_at IS NULL) OR (status='approved' AND approved_by IS NOT NULL AND lower(approved_by)<>lower(created_by) AND coalesce(length(approval_notes),0) BETWEEN 12 AND 1000 AND approved_at IS NOT NULL))
);
CREATE OR REPLACE FUNCTION rticore_catalog_profile_valid(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $cat$
DECLARE a jsonb;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(p) NOT BETWEEN 1 AND 60 THEN RETURN false; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(p) LOOP
  IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR (a->>'phase_code') IS NULL OR (a->>'phase_code') NOT IN ('presales_assessment','scope_validation','preparation','kickoff','technical_execution','analysis','quality_assurance','reporting','presentation','retest','project_management','closure') OR (a->>'resource_role') IS NULL OR (a->>'resource_role') NOT IN ('junior_analyst','analyst','senior_analyst','consultant','senior_consultant','specialist','lead_pentester','principal_consultant','soc_analyst_l1','soc_analyst_l2','soc_analyst_l3','incident_responder','digital_forensic_specialist','threat_intelligence_analyst','grc_consultant','project_manager','solution_architect','subject_matter_expert','external_associate') OR coalesce(length(a->>'activity_name'),0) NOT BETWEEN 3 AND 160 OR jsonb_typeof(a->'resource_count') IS DISTINCT FROM 'number' OR (a->>'resource_count') !~ '^[0-9]+$' OR (a->>'resource_count')::numeric NOT BETWEEN 1 AND 50 OR jsonb_typeof(a->'hours_hundredths') IS DISTINCT FROM 'number' OR (a->>'hours_hundredths') !~ '^[0-9]+$' OR (a->>'hours_hundredths')::numeric NOT BETWEEN 1 AND 100000 OR jsonb_typeof(a->'billable') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
 END LOOP;
 RETURN EXISTS(SELECT 1 FROM jsonb_array_elements(p) a WHERE a->>'billable'='true');
END $cat$;
CREATE OR REPLACE FUNCTION rticore_catalog_workflow_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $cat$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CATALOG_IMMUTABLE'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' OR NOT rticore_catalog_finance_access(NEW.tenant_id,NEW.legal_entity_id,NEW.created_by,'make') THEN RAISE EXCEPTION 'CATALOG_ACCESS_DENIED'; END IF;
  IF TG_TABLE_NAME='rticore_catalog_activity_profiles' THEN
   IF NOT rticore_catalog_profile_valid(NEW.activities) THEN RAISE EXCEPTION 'CATALOG_ACTIVITY_INVALID'; END IF;
   IF NOT EXISTS(SELECT 1 FROM rticore_service_catalog_v2 s WHERE s.tenant_id=NEW.tenant_id AND s.legal_entity_id=NEW.legal_entity_id AND s.id=NEW.service_id AND s.lifecycle_status='approved') THEN RAISE EXCEPTION 'CATALOG_SCOPE_INVALID'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF OLD.status<>'draft' OR NEW.status<>'approved' OR (to_jsonb(OLD)-ARRAY['status','approved_by','approval_notes','approved_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','approved_by','approval_notes','approved_at']) THEN RAISE EXCEPTION 'CATALOG_IMMUTABLE'; END IF;
 IF lower(NEW.approved_by)=lower(OLD.created_by) OR NOT rticore_catalog_finance_access(NEW.tenant_id,NEW.legal_entity_id,NEW.approved_by,'approve') THEN RAISE EXCEPTION 'CATALOG_APPROVAL_DENIED'; END IF;
 IF TG_TABLE_NAME='rticore_catalog_pricing_snapshots' THEN
  IF NOT EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=NEW.tenant_id AND a.legal_entity_id=NEW.legal_entity_id AND lower(a.email)=lower(NEW.approved_by) AND a.status='approved' AND a.can_check=1 AND a.can_approve=1 AND a.finance_role IN ('cfo','financial_controller') AND a.business_unit_id IS NULL AND a.department_id IS NULL AND a.approval_limit_cents>=NEW.net_price_cents) OR NOT EXISTS(SELECT 1 FROM rticore_erp_opportunity_scopes s WHERE s.tenant_id=NEW.tenant_id AND s.legal_entity_id=NEW.legal_entity_id AND s.opportunity_id=NEW.opportunity_id AND s.status='approved' AND s.version=NEW.opportunity_scope_version) THEN RAISE EXCEPTION 'CATALOG_APPROVAL_DENIED'; END IF;
 END IF;
 RETURN NEW;
END $cat$;
DROP TRIGGER IF EXISTS rticore_catalog_activity_profiles_guard ON rticore_catalog_activity_profiles;
CREATE TRIGGER rticore_catalog_activity_profiles_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_catalog_activity_profiles FOR EACH ROW EXECUTE FUNCTION rticore_catalog_workflow_guard();
DROP TRIGGER IF EXISTS rticore_catalog_complexity_guard ON rticore_catalog_complexity;
CREATE TRIGGER rticore_catalog_complexity_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_catalog_complexity FOR EACH ROW EXECUTE FUNCTION rticore_catalog_workflow_guard();
DROP TRIGGER IF EXISTS rticore_catalog_pricing_snapshots_guard ON rticore_catalog_pricing_snapshots;
CREATE TRIGGER rticore_catalog_pricing_snapshots_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_catalog_pricing_snapshots FOR EACH ROW EXECUTE FUNCTION rticore_catalog_workflow_guard();
CREATE OR REPLACE FUNCTION rticore_catalog_workflow_command(p_tenant text,p_entity text,p_actor text,p_action text,p_id text,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $cat$
DECLARE rid text:=gen_random_uuid()::text; n bigint; service record; profile record; matrix record; rate record; a jsonb; q bigint; scope_version bigint; method text; overhead bigint; risk bigint; target bigint; minimum bigint; md bigint; bmd bigint:=0; nmd bigint:=0; direct numeric:=0; loaded numeric; price numeric; evidence jsonb:='[]'; calc jsonb;
BEGIN
 IF p_action IN ('create_activity_profile','create_complexity','create_pricing_snapshot') THEN
  IF NOT rticore_catalog_finance_access(p_tenant,p_entity,p_actor,'make') THEN RAISE EXCEPTION 'CATALOG_ACCESS_DENIED'; END IF;
  IF p_action='create_activity_profile' THEN
   INSERT INTO rticore_catalog_activity_profiles(id,tenant_id,legal_entity_id,service_id,version,activities,created_by) VALUES(rid,p_tenant,p_entity,p_data->>'service_id',(p_data->>'version')::bigint,p_data->'activities',lower(p_actor));
  ELSIF p_action='create_complexity' THEN
   INSERT INTO rticore_catalog_complexity(id,tenant_id,legal_entity_id,matrix_code,label,version,factor_bps,created_by) VALUES(rid,p_tenant,p_entity,p_data->>'matrix_code',p_data->>'label',(p_data->>'version')::bigint,(p_data->>'factor_bps')::bigint,lower(p_actor));
  ELSE
   SELECT * INTO service FROM rticore_service_catalog_v2 WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=p_data->>'service_id' AND lifecycle_status='approved' AND effective_date<=CURRENT_DATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'CATALOG_SCOPE_INVALID'; END IF;
   SELECT * INTO profile FROM rticore_catalog_activity_profiles WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=p_data->>'profile_id' AND service_id=service.id AND status='approved';
   IF NOT FOUND THEN RAISE EXCEPTION 'CATALOG_SCOPE_INVALID'; END IF;
   SELECT * INTO matrix FROM rticore_catalog_complexity WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=p_data->>'complexity_id' AND status='approved';
   IF NOT FOUND THEN RAISE EXCEPTION 'CATALOG_SCOPE_INVALID'; END IF;
   SELECT version INTO scope_version FROM rticore_erp_opportunity_scopes WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND opportunity_id=p_data->>'opportunity_id' AND status='approved' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'CATALOG_SCOPE_INVALID'; END IF;
   q:=(p_data->>'quantity')::bigint;method:=p_data->>'pricing_method';overhead:=(p_data->>'overhead_bps')::bigint;risk:=(p_data->>'risk_bps')::bigint;target:=(p_data->>'target_bps')::bigint;minimum:=(p_data->>'minimum_margin_bps')::bigint;
   IF q IS NULL OR q NOT BETWEEN 1 AND 1000 OR method IS NULL OR method NOT IN ('target_margin','cost_plus') OR overhead IS NULL OR overhead NOT BETWEEN 0 AND 6000 OR risk IS NULL OR risk NOT BETWEEN 0 AND 5000 OR target IS NULL OR target NOT BETWEEN 0 AND 8500 OR minimum IS NULL OR minimum NOT BETWEEN 0 AND 8500 THEN RAISE EXCEPTION 'CATALOG_PRICING_INVALID'; END IF;
   FOR a IN SELECT value FROM jsonb_array_elements(profile.activities) LOOP
    SELECT id,version,internal_cost_rate_cents,min_selling_rate_cents,effective_date INTO rate FROM rticore_enterprise_rate_cards WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND role_code=a->>'resource_role' AND status='approved' AND effective_date<=CURRENT_DATE ORDER BY effective_date DESC,version DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'CATALOG_RATE_REQUIRED'; END IF;
    md:=ceil(round(q*(a->>'resource_count')::numeric*(a->>'hours_hundredths')::numeric*matrix.factor_bps/10000)*10/800);
    IF a->>'billable'='true' THEN bmd:=bmd+md; ELSE nmd:=nmd+md; END IF;
    direct:=direct+round(md*rate.internal_cost_rate_cents::numeric/10);
    evidence:=evidence||jsonb_build_array(jsonb_build_object('activity',a,'rate_id',rate.id,'rate_version',rate.version,'rate_effective_date',rate.effective_date,'internal_rate_cents',rate.internal_cost_rate_cents,'minimum_rate_cents',rate.min_selling_rate_cents,'mandays_tenths',md));
   END LOOP;
   IF bmd<=0 OR bmd+nmd NOT BETWEEN service.min_mandays_tenths AND service.max_mandays_tenths OR direct<=0 THEN RAISE EXCEPTION 'CATALOG_EFFORT_INVALID'; END IF;
   loaded:=direct+round(direct*overhead/10000)+round(direct*risk/10000);
   price:=CASE WHEN method='target_margin' THEN ceil(loaded*10000/(10000-target)) ELSE ceil(loaded*(10000+target)/10000) END;
   price:=greatest(price,ceil(loaded*10000/(10000-minimum)),(SELECT sum(ceil((x->>'mandays_tenths')::numeric*(x->>'minimum_rate_cents')::numeric/10)) FROM jsonb_array_elements(evidence) x));
   IF price>=900000000000000 THEN RAISE EXCEPTION 'CATALOG_PRICING_INVALID'; END IF;
   calc:=jsonb_build_object('formula_version','0068-v1','service_id',service.id,'service_version',service.service_version,'profile_id',profile.id,'profile_version',profile.version,'complexity_id',matrix.id,'complexity_version',matrix.version,'factor_bps',matrix.factor_bps,'quantity',q,'method',method,'overhead_bps',overhead,'risk_bps',risk,'target_bps',target,'minimum_margin_bps',minimum,'activities',evidence,'direct_cost_cents',direct,'loaded_cost_cents',loaded,'net_price_cents',price);
   INSERT INTO rticore_catalog_pricing_snapshots(id,tenant_id,legal_entity_id,service_id,profile_id,complexity_id,opportunity_id,opportunity_scope_version,quantity,pricing_method,overhead_bps,risk_bps,target_bps,minimum_margin_bps,billable_mandays_tenths,nonbillable_mandays_tenths,direct_cost_cents,loaded_cost_cents,net_price_cents,calculation,calculation_sha256,created_by)
   VALUES(rid,p_tenant,p_entity,service.id,profile.id,matrix.id,p_data->>'opportunity_id',scope_version,q,method,overhead,risk,target,minimum,bmd,nmd,direct,loaded,price,calc,encode(sha256(convert_to(calc::text,'UTF8')),'hex'),lower(p_actor));
  END IF;
 ELSE
  IF NOT rticore_catalog_finance_access(p_tenant,p_entity,p_actor,'approve') THEN RAISE EXCEPTION 'CATALOG_APPROVAL_DENIED'; END IF;
  rid:=p_id;
  IF p_action='approve_activity_profile' THEN UPDATE rticore_catalog_activity_profiles SET status='approved',approved_by=lower(p_actor),approved_at=now(),approval_notes=p_data->>'notes' WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=rid AND status='draft';
  ELSIF p_action='approve_complexity' THEN UPDATE rticore_catalog_complexity SET status='approved',approved_by=lower(p_actor),approved_at=now(),approval_notes=p_data->>'notes' WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=rid AND status='draft';
  ELSIF p_action='approve_pricing_snapshot' THEN UPDATE rticore_catalog_pricing_snapshots SET status='approved',approved_by=lower(p_actor),approved_at=now(),approval_notes=p_data->>'notes' WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=rid AND status='draft';
  ELSE RAISE EXCEPTION 'CATALOG_ACTION_INVALID'; END IF;
  GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'CATALOG_SCOPE_INVALID'; END IF;
 END IF;
 INSERT INTO rticore_operations_events(id,tenant_id,area,entity_id,action,actor_email,snapshot_json) VALUES(gen_random_uuid()::text,p_tenant,'service_catalog',rid,p_action,lower(p_actor),jsonb_build_object('legal_entity_id',p_entity)::text);
 RETURN jsonb_build_object('id',rid,'status',CASE WHEN p_action LIKE 'create_%' THEN 'draft' ELSE 'approved' END);
END $cat$;
COMMIT;
