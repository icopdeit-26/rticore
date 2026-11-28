BEGIN;
-- A-R13: record and independently review externally retained backup/restore evidence.
-- No backup bytes, database credentials, or automatic certification are stored here.
CREATE TABLE IF NOT EXISTS rticore_native_backup_drill (
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,
 environment text NOT NULL CHECK(environment IN ('staging','production')),
 source_sha text NOT NULL CHECK(source_sha ~ '^[0-9a-f]{40}$'),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
 backup_sha256 text NOT NULL CHECK(backup_sha256 ~ '^[0-9a-f]{64}$'),
 backup_at timestamptz NOT NULL,restore_completed_at timestamptz NOT NULL,
 backup_bytes bigint NOT NULL CHECK(backup_bytes>0),
 compared_tables integer NOT NULL CHECK(compared_tables>0),
 rto_seconds integer NOT NULL CHECK(rto_seconds>=0),rpo_seconds integer NOT NULL CHECK(rpo_seconds>=0),
 rto_target_seconds integer NOT NULL CHECK(rto_target_seconds>0),rpo_target_seconds integer NOT NULL CHECK(rpo_target_seconds>=0),
 row_match boolean NOT NULL,privileges_verified boolean NOT NULL,isolated_restore boolean NOT NULL,
 requested_by text NOT NULL,notes text NOT NULL CHECK(length(notes) BETWEEN 12 AND 800),
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected')),
 reviewed_by text,reviewed_at timestamptz,review_notes text,review_evidence_sha256 text,
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 UNIQUE(tenant_id,legal_entity_id,evidence_sha256),
 CHECK(restore_completed_at>=backup_at),
 CHECK((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_notes IS NULL AND review_evidence_sha256 IS NULL)
 OR (status<>'pending' AND reviewed_by IS NOT NULL AND lower(reviewed_by)<>lower(requested_by) AND reviewed_at IS NOT NULL
 AND length(coalesce(review_notes,'')) BETWEEN 12 AND 800 AND review_evidence_sha256 IS NOT NULL AND review_evidence_sha256=evidence_sha256)),
 CHECK(status<>'verified' OR (row_match AND privileges_verified AND isolated_restore AND rto_seconds<=rto_target_seconds AND rpo_seconds<=rpo_target_seconds))
);
CREATE OR REPLACE FUNCTION rticore_native_backup_drill_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $b$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'BACKUP_DRILL_IMMUTABLE'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'pending' OR rticore_fg_actor_role(NEW.tenant_id,NEW.legal_entity_id,NEW.requested_by) IS DISTINCT FROM 'admin'
    OR NEW.restore_completed_at>clock_timestamp() THEN RAISE EXCEPTION 'BACKUP_DRILL_SCOPE_INVALID'; END IF;
  NEW.requested_at:=clock_timestamp();RETURN NEW;
 END IF;
 IF OLD.status<>'pending' OR NEW.status NOT IN ('verified','rejected') OR
 (to_jsonb(NEW)-ARRAY['status','reviewed_by','reviewed_at','review_notes','review_evidence_sha256']) IS DISTINCT FROM
 (to_jsonb(OLD)-ARRAY['status','reviewed_by','reviewed_at','review_notes','review_evidence_sha256']) THEN RAISE EXCEPTION 'BACKUP_DRILL_IMMUTABLE'; END IF;
 IF rticore_fg_actor_role(NEW.tenant_id,NEW.legal_entity_id,NEW.reviewed_by) IS DISTINCT FROM 'approver'
 OR lower(NEW.reviewed_by)=lower(OLD.requested_by) OR NEW.review_evidence_sha256 IS DISTINCT FROM OLD.evidence_sha256
 THEN RAISE EXCEPTION 'BACKUP_DRILL_REVIEW_INVALID'; END IF;
 NEW.reviewed_at:=clock_timestamp();RETURN NEW;
END $b$;
DROP TRIGGER IF EXISTS rticore_native_backup_drill_guard ON rticore_native_backup_drill;
CREATE TRIGGER rticore_native_backup_drill_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_native_backup_drill FOR EACH ROW EXECUTE FUNCTION rticore_native_backup_drill_guard();
COMMIT;
