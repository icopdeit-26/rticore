BEGIN;
CREATE TABLE IF NOT EXISTS rticore_feature_change_requests (
 id text PRIMARY KEY, tenant_id text NOT NULL, legal_entity_id text NOT NULL,
 flag_key text NOT NULL CHECK(flag_key IN ('service_catalog','flexguard_enterprise','flexguard_product')),
 requested_enabled boolean NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 12 AND 800),
 requested_by text NOT NULL, requested_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reviewed_by text, reviewed_at timestamptz, review_notes text,
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 CHECK((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_notes IS NULL) OR (status IN ('approved','rejected') AND reviewed_by IS NOT NULL AND lower(reviewed_by)<>lower(requested_by) AND reviewed_at IS NOT NULL AND length(coalesce(review_notes,'')) BETWEEN 12 AND 800))
);
CREATE UNIQUE INDEX IF NOT EXISTS rticore_feature_change_pending ON rticore_feature_change_requests(tenant_id,legal_entity_id,flag_key) WHERE status='pending';
CREATE OR REPLACE FUNCTION rticore_feature_change_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $f$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FEATURE_IMMUTABLE'; END IF;
 IF OLD.status<>'pending' OR NEW.status='pending' OR (to_jsonb(NEW)-ARRAY['status','reviewed_by','reviewed_at','review_notes']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewed_by','reviewed_at','review_notes']) THEN RAISE EXCEPTION 'FEATURE_IMMUTABLE'; END IF;
 RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS rticore_feature_change_guard ON rticore_feature_change_requests;
CREATE TRIGGER rticore_feature_change_guard BEFORE UPDATE OR DELETE ON rticore_feature_change_requests FOR EACH ROW EXECUTE FUNCTION rticore_feature_change_guard();
COMMIT;
