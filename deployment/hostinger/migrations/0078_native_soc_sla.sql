BEGIN;
-- A-R05: evidence-backed monthly operational SLA. Never derive revenue or post Finance journals.
CREATE TABLE IF NOT EXISTS rticore_native_soc_sla (
 id text PRIMARY KEY, tenant_id text NOT NULL, legal_entity_id text NOT NULL, project_id text NOT NULL,
 period_code text NOT NULL CHECK(period_code ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 observations integer NOT NULL CHECK(observations BETWEEN 1 AND 10000000),
 within_sla integer NOT NULL CHECK(within_sla>=0 AND within_sla<=observations),
 alerts_triaged integer NOT NULL CHECK(alerts_triaged BETWEEN 0 AND 10000000),
 incidents_escalated integer NOT NULL CHECK(incidents_escalated BETWEEN 0 AND alerts_triaged),
 mttd_minutes integer CHECK(mttd_minutes BETWEEN 0 AND 525600),
 mttr_minutes integer CHECK(mttr_minutes BETWEEN 0 AND 525600),
 document_id text NOT NULL REFERENCES rticore_document_library(id),
 document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[0-9a-f]{64}$'),
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reviewed_by text, reviewed_at timestamptz, review_notes text,
 FOREIGN KEY(tenant_id,project_id) REFERENCES rticore_delivery_projects(tenant_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 CHECK((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_notes IS NULL) OR (status<>'pending' AND reviewed_by IS NOT NULL AND lower(reviewed_by)<>lower(created_by) AND reviewed_at IS NOT NULL AND length(coalesce(review_notes,'')) BETWEEN 12 AND 800))
);
CREATE UNIQUE INDEX IF NOT EXISTS rticore_native_soc_sla_current ON rticore_native_soc_sla(tenant_id,legal_entity_id,project_id,period_code) WHERE status IN ('pending','approved');
CREATE OR REPLACE FUNCTION rticore_native_soc_actor(p_tenant text,p_entity text,p_project text,p_actor text)
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
 JOIN rticore_delivery_projects p ON p.tenant_id=sc.tenant_id AND p.id=sc.project_id AND p.service_family='SOC/MDR'
 JOIN rticore_erp_org_units u ON u.tenant_id=p_tenant AND u.id=p_entity AND u.kind='legal_entity' AND u.active=1
 WHERE lower(m.email)=lower(p_actor) AND m.active=1 AND m.role IN ('admin','defense_leader','approver') AND EXISTS(SELECT 1 FROM scoped WHERE unit_id=p_entity)
$s$;
CREATE OR REPLACE FUNCTION rticore_native_soc_sla_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $s$
DECLARE opp text; actor_role text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SOC_SLA_IMMUTABLE'; END IF;
 SELECT opportunity_id INTO opp FROM rticore_delivery_projects WHERE tenant_id=NEW.tenant_id AND id=NEW.project_id AND service_family='SOC/MDR' FOR UPDATE;
 IF NOT FOUND OR NEW.period_code>to_char(CURRENT_DATE,'YYYY-MM') OR NOT EXISTS(SELECT 1 FROM rticore_document_library d WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.document_id AND d.opportunity_id=opp AND d.kind='supporting' AND lower(d.sha256)=NEW.document_sha256 AND (d.retention_until IS NULL OR d.retention_until>=CURRENT_DATE::text OR d.legal_hold=1)) THEN RAISE EXCEPTION 'SOC_SLA_EVIDENCE_INVALID'; END IF;
 actor_role:=rticore_native_soc_actor(NEW.tenant_id,NEW.legal_entity_id,NEW.project_id,NEW.created_by);
 IF actor_role IS NULL OR actor_role NOT IN ('admin','defense_leader') THEN RAISE EXCEPTION 'SOC_SLA_SCOPE_INVALID'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'pending' THEN RAISE EXCEPTION 'SOC_SLA_INVALID'; END IF;
  NEW.created_at:=clock_timestamp();RETURN NEW;
 END IF;
 IF OLD.status<>'pending' OR NEW.status NOT IN ('approved','rejected') OR (to_jsonb(NEW)-ARRAY['status','reviewed_by','reviewed_at','review_notes']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewed_by','reviewed_at','review_notes']) THEN RAISE EXCEPTION 'SOC_SLA_IMMUTABLE'; END IF;
 IF lower(NEW.reviewed_by)=lower(OLD.created_by) OR rticore_native_soc_actor(NEW.tenant_id,NEW.legal_entity_id,NEW.project_id,NEW.reviewed_by) IS DISTINCT FROM 'approver' THEN RAISE EXCEPTION 'SOC_SLA_REVIEW_INVALID'; END IF;
 NEW.reviewed_at:=clock_timestamp();RETURN NEW;
END $s$;
DROP TRIGGER IF EXISTS rticore_native_soc_sla_guard ON rticore_native_soc_sla;
CREATE TRIGGER rticore_native_soc_sla_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_native_soc_sla FOR EACH ROW EXECUTE FUNCTION rticore_native_soc_sla_guard();
COMMIT;
