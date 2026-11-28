BEGIN;
-- A-R01/A-R02: VAPT engagement and approved RoE register, on canonical delivery projects.
CREATE TABLE IF NOT EXISTS rticore_native_vapt_engagement (
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,project_id text NOT NULL,
 engagement_code text NOT NULL CHECK(length(engagement_code) BETWEEN 4 AND 64),
 title text NOT NULL CHECK(length(title) BETWEEN 5 AND 200),
 test_type text NOT NULL CHECK(test_type IN ('web_app','mobile_app','api','network','cloud','active_directory','wireless','red_team','purple_team','source_code')),
 scope_summary text NOT NULL CHECK(length(scope_summary) BETWEEN 12 AND 2000),
 window_start date NOT NULL,window_end date NOT NULL CHECK(window_end>=window_start),
 roe_document_id text NOT NULL REFERENCES rticore_document_library(id),
 roe_sha256 text NOT NULL CHECK(roe_sha256 ~ '^[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'registered' CHECK(status IN ('registered','roe_approved','roe_rejected')),
 version integer NOT NULL DEFAULT 1 CHECK(version IN (1,2)),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reviewed_by text,reviewed_at timestamptz,review_notes text,
 UNIQUE(tenant_id,legal_entity_id,project_id,engagement_code),
 UNIQUE(tenant_id,legal_entity_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES rticore_delivery_projects(tenant_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 CHECK((status='registered' AND version=1 AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_notes IS NULL) OR (status<>'registered' AND version=2 AND reviewed_by IS NOT NULL AND lower(reviewed_by)<>lower(created_by) AND reviewed_at IS NOT NULL AND length(coalesce(review_notes,'')) BETWEEN 12 AND 800))
);
CREATE OR REPLACE FUNCTION rticore_native_vapt_actor(p_tenant text,p_entity text,p_project text,p_actor text)
RETURNS text LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $s$
 WITH RECURSIVE scoped(unit_id) AS (
 SELECT s.unit_id FROM rticore_erp_staff_org s JOIN rticore_erp_org_units u ON u.tenant_id=s.tenant_id AND u.id=s.unit_id AND u.active=1 WHERE s.tenant_id=p_tenant AND lower(s.email)=lower(p_actor) AND s.status='approved'
 UNION
 SELECT u.parent_id FROM rticore_erp_org_units u JOIN scoped x ON x.unit_id=u.id JOIN rticore_erp_org_units p ON p.tenant_id=u.tenant_id AND p.id=u.parent_id AND p.active=1 WHERE u.tenant_id=p_tenant AND u.active=1
 )
 SELECT m.role FROM rticore_members m
 JOIN rticore_erp_role_capability_matrix pol ON pol.role=m.role AND pol.capability='cyber_ops' AND pol.allowed=1
 JOIN rticore_erp_capability_grants g ON lower(g.email)=lower(m.email) AND g.tenant_id=p_tenant AND g.unit_id=p_entity AND g.capability='cyber_ops' AND g.status='approved'
 JOIN rticore_erp_project_scopes sc ON sc.tenant_id=p_tenant AND sc.project_id=p_project AND sc.legal_entity_id=p_entity AND sc.status='approved'
 JOIN rticore_delivery_projects p ON p.tenant_id=sc.tenant_id AND p.id=sc.project_id AND p.service_family='VAPT'
 JOIN rticore_erp_org_units u ON u.tenant_id=p_tenant AND u.id=p_entity AND u.kind='legal_entity' AND u.active=1
 WHERE lower(m.email)=lower(p_actor) AND m.active=1 AND m.role IN ('admin','presales','approver') AND EXISTS(SELECT 1 FROM scoped WHERE unit_id=p_entity)
$s$;

CREATE OR REPLACE FUNCTION rticore_native_vapt_engagement_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $v$
DECLARE opp text; role text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'VAPT_ENGAGEMENT_IMMUTABLE'; END IF;
 SELECT opportunity_id INTO opp FROM rticore_delivery_projects WHERE tenant_id=NEW.tenant_id AND id=NEW.project_id AND service_family='VAPT' AND status='active' FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM rticore_document_library d WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.roe_document_id AND d.opportunity_id=opp AND d.kind='supporting' AND lower(d.sha256)=NEW.roe_sha256 AND (d.retention_until IS NULL OR d.retention_until>=CURRENT_DATE::text OR d.legal_hold=1)) THEN RAISE EXCEPTION 'VAPT_ROE_EVIDENCE_INVALID'; END IF;
 role:=rticore_native_vapt_actor(NEW.tenant_id,NEW.legal_entity_id,NEW.project_id,NEW.created_by);
 IF role IS NULL OR role NOT IN ('admin','presales') THEN RAISE EXCEPTION 'VAPT_SCOPE_INVALID'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'registered' OR NEW.version<>1 OR NEW.window_end<CURRENT_DATE THEN RAISE EXCEPTION 'VAPT_REGISTRATION_INVALID'; END IF;
  NEW.created_at:=clock_timestamp();RETURN NEW;
 END IF;
 IF OLD.status<>'registered' OR NEW.status NOT IN ('roe_approved','roe_rejected') OR NEW.version<>OLD.version+1 OR (to_jsonb(NEW)-ARRAY['status','version','reviewed_by','reviewed_at','review_notes']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','reviewed_by','reviewed_at','review_notes']) THEN RAISE EXCEPTION 'VAPT_ENGAGEMENT_IMMUTABLE'; END IF;
 IF lower(NEW.reviewed_by)=lower(OLD.created_by) OR rticore_native_vapt_actor(NEW.tenant_id,NEW.legal_entity_id,NEW.project_id,NEW.reviewed_by) IS DISTINCT FROM 'approver' OR (NEW.status='roe_approved' AND NEW.window_end<CURRENT_DATE) THEN RAISE EXCEPTION 'VAPT_ROE_REVIEW_INVALID'; END IF;
 NEW.reviewed_at:=clock_timestamp();RETURN NEW;
END $v$;
DROP TRIGGER IF EXISTS rticore_native_vapt_engagement_guard ON rticore_native_vapt_engagement;
CREATE TRIGGER rticore_native_vapt_engagement_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_native_vapt_engagement FOR EACH ROW EXECUTE FUNCTION rticore_native_vapt_engagement_guard();
COMMIT;
