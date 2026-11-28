BEGIN;
-- Append-only reviews; approved means evidence reviewed, not acceptance of enterprise risk.
CREATE TABLE IF NOT EXISTS rticore_native_cti_grc_lifecycle (
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,project_id text NOT NULL,
 record_kind text NOT NULL CHECK(record_kind IN ('cti_case','grc_engagement','grc_risk')),
 record_id text NOT NULL,version integer NOT NULL CHECK(version>0),
 status text NOT NULL CHECK(status IN ('in_progress','submitted','reviewed','returned','closed')),
 actor_email text NOT NULL,notes text NOT NULL CHECK(length(notes) BETWEEN 12 AND 1000),
 document_id text NOT NULL REFERENCES rticore_document_library(id),
 document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,record_kind,record_id,version),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES rticore_delivery_projects(tenant_id,id)
);
CREATE OR REPLACE FUNCTION rticore_native_cti_grc_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $g$
DECLARE owner_email text; classification text; opp text; actor_role text; prior record; old_status text; old_version integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CTI_GRC_LIFECYCLE_IMMUTABLE'; END IF;
 IF NEW.record_kind='cti_case' THEN
  SELECT created_by,tlp INTO owner_email,classification FROM rticore_native_cti_case WHERE tenant_id=NEW.tenant_id AND legal_entity_id=NEW.legal_entity_id AND project_id=NEW.project_id AND id=NEW.record_id FOR UPDATE;
 ELSIF NEW.record_kind='grc_engagement' THEN
  SELECT created_by INTO owner_email FROM rticore_native_grc_engagement WHERE tenant_id=NEW.tenant_id AND legal_entity_id=NEW.legal_entity_id AND project_id=NEW.project_id AND id=NEW.record_id FOR UPDATE;
 ELSIF NEW.record_kind='grc_risk' THEN
  SELECT created_by INTO owner_email FROM rticore_native_grc_risk WHERE tenant_id=NEW.tenant_id AND legal_entity_id=NEW.legal_entity_id AND project_id=NEW.project_id AND id=NEW.record_id FOR UPDATE;
 ELSE RAISE EXCEPTION 'CTI_GRC_LIFECYCLE_SCOPE_INVALID'; END IF;
 IF owner_email IS NULL OR (classification='TLP:RED' AND lower(owner_email)<>lower(NEW.actor_email)) THEN RAISE EXCEPTION 'CTI_GRC_LIFECYCLE_SCOPE_INVALID'; END IF;
 actor_role:=rticore_native_cti_grc_actor(NEW.tenant_id,NEW.legal_entity_id,NEW.project_id,NEW.actor_email);
 IF actor_role IS NULL THEN RAISE EXCEPTION 'CTI_GRC_LIFECYCLE_SCOPE_INVALID'; END IF;
 SELECT opportunity_id INTO opp FROM rticore_delivery_projects WHERE tenant_id=NEW.tenant_id AND id=NEW.project_id AND status='active';
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM rticore_document_library d WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.document_id AND d.opportunity_id=opp AND d.kind='supporting' AND lower(d.sha256)=NEW.document_sha256 AND (d.retention_until IS NULL OR d.retention_until>=CURRENT_DATE::text OR d.legal_hold=1)) THEN RAISE EXCEPTION 'CTI_GRC_LIFECYCLE_EVIDENCE_INVALID'; END IF;
 SELECT status,version,actor_email,document_id INTO prior FROM rticore_native_cti_grc_lifecycle WHERE tenant_id=NEW.tenant_id AND record_kind=NEW.record_kind AND record_id=NEW.record_id ORDER BY version DESC LIMIT 1;
 old_status:=coalesce(prior.status,'open');old_version:=coalesce(prior.version,0);
 IF NEW.version<>old_version+1 THEN RAISE EXCEPTION 'CTI_GRC_LIFECYCLE_VERSION_INVALID'; END IF;
 IF (old_status IN ('open','returned') AND NEW.status='in_progress') OR (old_status='in_progress' AND NEW.status='submitted') THEN
  IF actor_role NOT IN ('admin','presales','defense_leader','governance_leader','governance_member') THEN RAISE EXCEPTION 'CTI_GRC_LIFECYCLE_MAKER_INVALID'; END IF;
 ELSIF (old_status='submitted' AND NEW.status IN ('reviewed','returned')) OR (old_status='reviewed' AND NEW.status='closed') THEN
  IF actor_role<>'approver' OR lower(owner_email)=lower(NEW.actor_email) OR (old_status='submitted' AND lower(prior.actor_email)=lower(NEW.actor_email)) THEN RAISE EXCEPTION 'CTI_GRC_LIFECYCLE_REVIEW_INVALID'; END IF;
 ELSE RAISE EXCEPTION 'CTI_GRC_LIFECYCLE_TRANSITION_INVALID'; END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END $g$;
DROP TRIGGER IF EXISTS rticore_native_cti_grc_lifecycle_guard ON rticore_native_cti_grc_lifecycle;
CREATE TRIGGER rticore_native_cti_grc_lifecycle_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_native_cti_grc_lifecycle FOR EACH ROW EXECUTE FUNCTION rticore_native_cti_grc_lifecycle_guard();
COMMIT;
