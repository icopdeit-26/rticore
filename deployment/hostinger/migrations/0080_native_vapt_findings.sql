BEGIN;
-- A-R03: specialized findings under approved engagements, never a scanning engine.
CREATE TABLE IF NOT EXISTS rticore_native_vapt_finding (
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,project_id text NOT NULL,engagement_id text NOT NULL,
 finding_code text NOT NULL CHECK(length(finding_code) BETWEEN 3 AND 64),
 title text NOT NULL CHECK(length(title) BETWEEN 5 AND 200),
 cvss_tenths integer NOT NULL CHECK(cvss_tenths BETWEEN 0 AND 100),
 affected_asset text NOT NULL CHECK(length(affected_asset) BETWEEN 3 AND 250),
 remediation text NOT NULL CHECK(length(remediation) BETWEEN 12 AND 2000),
 evidence_document_id text NOT NULL REFERENCES rticore_document_library(id),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','qa_approved','qa_rejected','retest_requested','retest_submitted','verified_fixed','still_vulnerable')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_by text NOT NULL,
 last_actor text NOT NULL,last_notes text NOT NULL CHECK(length(last_notes) BETWEEN 12 AND 800),
 retest_document_id text REFERENCES rticore_document_library(id),retest_sha256 text CHECK(retest_sha256 ~ '^[0-9a-f]{64}$'),
 retest_by text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,engagement_id,finding_code),
 UNIQUE(tenant_id,legal_entity_id,project_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id,project_id,engagement_id) REFERENCES rticore_native_vapt_engagement(tenant_id,legal_entity_id,project_id,id),
 CHECK((retest_document_id IS NULL AND retest_sha256 IS NULL AND retest_by IS NULL) OR (retest_document_id IS NOT NULL AND retest_sha256 IS NOT NULL AND retest_by IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS rticore_native_vapt_finding_event (
 tenant_id text NOT NULL,legal_entity_id text NOT NULL,project_id text NOT NULL,finding_id text NOT NULL,version integer NOT NULL,
 status text NOT NULL,actor_email text NOT NULL,notes text NOT NULL,document_id text NOT NULL,document_sha256 text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,finding_id,version),
 FOREIGN KEY(tenant_id,legal_entity_id,project_id,finding_id) REFERENCES rticore_native_vapt_finding(tenant_id,legal_entity_id,project_id,id)
);
CREATE OR REPLACE FUNCTION rticore_native_vapt_finding_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $v$
DECLARE e record; actor_role text; doc text; digest text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'VAPT_FINDING_IMMUTABLE'; END IF;
 SELECT x.status,x.window_start,x.window_end,p.opportunity_id INTO e FROM rticore_native_vapt_engagement x JOIN rticore_delivery_projects p ON p.tenant_id=x.tenant_id AND p.id=x.project_id WHERE x.tenant_id=NEW.tenant_id AND x.legal_entity_id=NEW.legal_entity_id AND x.project_id=NEW.project_id AND x.id=NEW.engagement_id AND p.status='active' FOR UPDATE OF x;
 IF NOT FOUND OR e.status<>'roe_approved' THEN RAISE EXCEPTION 'VAPT_ROE_REQUIRED'; END IF;
 actor_role:=rticore_native_vapt_actor(NEW.tenant_id,NEW.legal_entity_id,NEW.project_id,NEW.last_actor);
 IF actor_role IS NULL THEN RAISE EXCEPTION 'VAPT_FINDING_SCOPE_INVALID'; END IF;
 doc:=NEW.evidence_document_id;digest:=NEW.evidence_sha256;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'open' OR NEW.version<>1 OR actor_role NOT IN ('admin','presales') OR lower(NEW.created_by)<>lower(NEW.last_actor) OR NEW.retest_document_id IS NOT NULL OR CURRENT_DATE NOT BETWEEN e.window_start AND e.window_end THEN RAISE EXCEPTION 'VAPT_FINDING_REGISTRATION_INVALID'; END IF;
  NEW.created_at:=clock_timestamp();
 ELSE
  IF NEW.version<>OLD.version+1 OR (to_jsonb(NEW)-ARRAY['status','version','last_actor','last_notes','retest_document_id','retest_sha256','retest_by']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','last_actor','last_notes','retest_document_id','retest_sha256','retest_by']) THEN RAISE EXCEPTION 'VAPT_FINDING_IMMUTABLE'; END IF;
  IF OLD.status='open' AND NEW.status IN ('qa_approved','qa_rejected') THEN
   IF actor_role<>'approver' OR lower(NEW.last_actor)=lower(OLD.created_by) THEN RAISE EXCEPTION 'VAPT_QA_REVIEW_INVALID'; END IF;
  ELSIF OLD.status IN ('qa_approved','still_vulnerable') AND NEW.status='retest_requested' THEN
   IF actor_role<>'approver' OR lower(NEW.last_actor)=lower(OLD.created_by) THEN RAISE EXCEPTION 'VAPT_QA_REVIEW_INVALID'; END IF;
  ELSIF OLD.status='retest_requested' AND NEW.status='retest_submitted' THEN
   IF actor_role NOT IN ('admin','presales') OR lower(NEW.last_actor)=lower(OLD.last_actor) OR NEW.retest_document_id IS NULL OR NEW.retest_document_id=OLD.evidence_document_id OR NEW.retest_document_id IS NOT DISTINCT FROM OLD.retest_document_id OR lower(NEW.retest_by) IS DISTINCT FROM lower(NEW.last_actor) THEN RAISE EXCEPTION 'VAPT_RETEST_INVALID'; END IF;
   doc:=NEW.retest_document_id;digest:=NEW.retest_sha256;
  ELSIF OLD.status='retest_submitted' AND NEW.status IN ('verified_fixed','still_vulnerable') THEN
   IF actor_role<>'approver' OR lower(NEW.last_actor) IN (lower(OLD.created_by),lower(OLD.retest_by)) THEN RAISE EXCEPTION 'VAPT_RETEST_REVIEW_INVALID'; END IF;
   doc:=OLD.retest_document_id;digest:=OLD.retest_sha256;
  ELSE RAISE EXCEPTION 'VAPT_FINDING_TRANSITION_INVALID'; END IF;
  IF NEW.status<>'retest_submitted' AND (NEW.retest_document_id IS DISTINCT FROM OLD.retest_document_id OR NEW.retest_sha256 IS DISTINCT FROM OLD.retest_sha256 OR NEW.retest_by IS DISTINCT FROM OLD.retest_by) THEN RAISE EXCEPTION 'VAPT_FINDING_IMMUTABLE'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM rticore_document_library d WHERE d.tenant_id=NEW.tenant_id AND d.id=doc AND d.opportunity_id=e.opportunity_id AND d.kind='supporting' AND lower(d.sha256)=digest AND (d.retention_until IS NULL OR d.retention_until>=CURRENT_DATE::text OR d.legal_hold=1)) THEN RAISE EXCEPTION 'VAPT_FINDING_EVIDENCE_INVALID'; END IF;
 RETURN NEW;
END $v$;
DROP TRIGGER IF EXISTS rticore_native_vapt_finding_guard ON rticore_native_vapt_finding;
CREATE TRIGGER rticore_native_vapt_finding_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_native_vapt_finding FOR EACH ROW EXECUTE FUNCTION rticore_native_vapt_finding_guard();
CREATE OR REPLACE FUNCTION rticore_native_vapt_finding_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $v$
BEGIN
 INSERT INTO rticore_native_vapt_finding_event(tenant_id,legal_entity_id,project_id,finding_id,version,status,actor_email,notes,document_id,document_sha256)
 VALUES(NEW.tenant_id,NEW.legal_entity_id,NEW.project_id,NEW.id,NEW.version,NEW.status,NEW.last_actor,NEW.last_notes,coalesce(NEW.retest_document_id,NEW.evidence_document_id),coalesce(NEW.retest_sha256,NEW.evidence_sha256));
 RETURN NEW;
END $v$;
DROP TRIGGER IF EXISTS rticore_native_vapt_finding_audit ON rticore_native_vapt_finding;
CREATE TRIGGER rticore_native_vapt_finding_audit AFTER INSERT OR UPDATE ON rticore_native_vapt_finding FOR EACH ROW EXECUTE FUNCTION rticore_native_vapt_finding_audit();
CREATE OR REPLACE FUNCTION rticore_native_vapt_event_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $v$
BEGIN RAISE EXCEPTION 'VAPT_FINDING_EVENT_IMMUTABLE'; END $v$;
DROP TRIGGER IF EXISTS rticore_native_vapt_event_immutable ON rticore_native_vapt_finding_event;
CREATE TRIGGER rticore_native_vapt_event_immutable BEFORE UPDATE OR DELETE ON rticore_native_vapt_finding_event FOR EACH ROW EXECUTE FUNCTION rticore_native_vapt_event_immutable();
COMMIT;
