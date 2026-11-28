BEGIN;
-- Bind an authenticated portal decision to a single independently reviewed internal version.
CREATE TABLE IF NOT EXISTS rticore_native_fg_portal_binding (
 submission_id text PRIMARY KEY REFERENCES rticore_native_fg_portal_submission(id),
 tenant_id text NOT NULL,legal_entity_id text NOT NULL,wallet_id text NOT NULL,request_id text NOT NULL,
 target_version integer NOT NULL CHECK(target_version>0),kind text NOT NULL CHECK(kind IN ('service_request','quote_acceptance','delivery_acceptance')),
 reviewer_email text NOT NULL,bound_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,request_id,target_version),
 FOREIGN KEY(tenant_id,legal_entity_id,wallet_id,request_id) REFERENCES rticore_native_fg_service_request(tenant_id,legal_entity_id,wallet_id,id)
);
CREATE OR REPLACE FUNCTION rticore_native_fg_portal_binding_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $p$
DECLARE s record; r record; actor_role text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'FLEXGUARD_PORTAL_BINDING_IMMUTABLE'; END IF;
 SELECT * INTO s FROM rticore_native_fg_portal_submission WHERE id=NEW.submission_id;
 IF NOT FOUND OR s.tenant_id<>NEW.tenant_id OR s.legal_entity_id<>NEW.legal_entity_id OR s.wallet_id<>NEW.wallet_id OR s.kind<>NEW.kind THEN RAISE EXCEPTION 'FLEXGUARD_PORTAL_BINDING_SCOPE_INVALID'; END IF;
 SELECT * INTO r FROM rticore_native_fg_service_request WHERE tenant_id=NEW.tenant_id AND legal_entity_id=NEW.legal_entity_id AND wallet_id=NEW.wallet_id AND id=NEW.request_id FOR UPDATE;
 IF NOT FOUND OR r.version<>NEW.target_version OR lower(r.last_actor)<>lower(NEW.reviewer_email) THEN RAISE EXCEPTION 'FLEXGUARD_PORTAL_BINDING_VERSION_INVALID'; END IF;
 actor_role:=rticore_fg_actor_role(NEW.tenant_id,NEW.legal_entity_id,NEW.reviewer_email);
 IF NEW.kind='service_request' THEN
  IF r.status<>'submitted' OR r.version<>1 OR actor_role IS NULL OR actor_role NOT IN ('admin','finance') THEN RAISE EXCEPTION 'FLEXGUARD_PORTAL_BINDING_ROLE_INVALID'; END IF;
 ELSE
  IF actor_role IS DISTINCT FROM 'approver' OR s.request_id IS DISTINCT FROM NEW.request_id OR s.request_version IS DISTINCT FROM NEW.target_version-1 OR
   (NEW.kind='quote_acceptance' AND r.status<>'scope_approved') OR (NEW.kind='delivery_acceptance' AND r.status<>'accepted') THEN RAISE EXCEPTION 'FLEXGUARD_PORTAL_BINDING_VERSION_INVALID'; END IF;
 END IF;
 NEW.bound_at:=clock_timestamp();RETURN NEW;
END $p$;
DROP TRIGGER IF EXISTS rticore_native_fg_portal_binding_guard ON rticore_native_fg_portal_binding;
CREATE TRIGGER rticore_native_fg_portal_binding_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_native_fg_portal_binding FOR EACH ROW EXECUTE FUNCTION rticore_native_fg_portal_binding_guard();
CREATE OR REPLACE FUNCTION rticore_native_fg_service_acceptance_link() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $p$
DECLARE k text; sid text;
BEGIN
 IF OLD.status='scope_quoted' AND NEW.status='scope_approved' THEN k:='quote_acceptance';
 ELSIF OLD.status='qa_passed' AND NEW.status='accepted' THEN k:='delivery_acceptance';
 ELSE RETURN NEW; END IF;
 SELECT id INTO sid FROM rticore_native_fg_portal_submission WHERE tenant_id=NEW.tenant_id AND legal_entity_id=NEW.legal_entity_id AND wallet_id=NEW.wallet_id AND request_id=NEW.id AND request_version=OLD.version AND kind=k;
 IF sid IS NULL THEN
  -- An approved portal wallet requires actual customer acceptance; offline workflow is retained only
  -- if no portal approval has ever been issued for this wallet.
  IF EXISTS(SELECT 1 FROM rticore_native_fg_portal_grant WHERE tenant_id=NEW.tenant_id AND legal_entity_id=NEW.legal_entity_id AND wallet_id=NEW.wallet_id AND status IN ('approved','revoked')) THEN RAISE EXCEPTION 'FLEXGUARD_PORTAL_ACCEPTANCE_REQUIRED'; END IF;
  RETURN NEW;
 END IF;
 INSERT INTO rticore_native_fg_portal_binding(submission_id,tenant_id,legal_entity_id,wallet_id,request_id,target_version,kind,reviewer_email)
 VALUES(sid,NEW.tenant_id,NEW.legal_entity_id,NEW.wallet_id,NEW.id,NEW.version,k,NEW.last_actor);
 RETURN NEW;
END $p$;
DROP TRIGGER IF EXISTS rticore_native_fg_service_acceptance_link ON rticore_native_fg_service_request;
CREATE TRIGGER rticore_native_fg_service_acceptance_link AFTER UPDATE ON rticore_native_fg_service_request FOR EACH ROW EXECUTE FUNCTION rticore_native_fg_service_acceptance_link();
COMMIT;
