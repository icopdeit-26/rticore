BEGIN;
-- A-R12: bounded independent recovery for native dead-letter jobs, never journal posting.
ALTER TABLE rticore_native_job_recovery ADD COLUMN IF NOT EXISTS prior_attempts integer CHECK(prior_attempts BETWEEN 1 AND 8);
ALTER TABLE rticore_native_job_recovery ADD COLUMN IF NOT EXISTS review_notes text CHECK(length(review_notes) BETWEEN 12 AND 800);
CREATE UNIQUE INDEX IF NOT EXISTS rticore_native_job_recovery_once ON rticore_native_job_recovery(tenant_id,legal_entity_id,job_id) WHERE status='approved';

CREATE OR REPLACE FUNCTION rticore_native_recovery_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $r$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RECOVERY_IMMUTABLE'; END IF;
 IF OLD.status<>'pending' OR NEW.status='pending' OR
 (to_jsonb(NEW)-ARRAY['status','reviewed_by','reviewed_at','review_notes']) IS DISTINCT FROM
 (to_jsonb(OLD)-ARRAY['status','reviewed_by','reviewed_at','review_notes']) THEN
 RAISE EXCEPTION 'RECOVERY_IMMUTABLE'; END IF;
 RETURN NEW;
END $r$;
DROP TRIGGER IF EXISTS rticore_native_recovery_guard ON rticore_native_job_recovery;
CREATE TRIGGER rticore_native_recovery_guard BEFORE UPDATE OR DELETE ON rticore_native_job_recovery
 FOR EACH ROW EXECUTE FUNCTION rticore_native_recovery_guard();

CREATE OR REPLACE FUNCTION rticore_native_recovery_command(p_tenant text,p_entity text,p_actor text,p_action text,p_job text,p_request text,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $r$
DECLARE j rticore_native_jobs%ROWTYPE; x rticore_native_job_recovery%ROWTYPE; rid text; actor_role text;
BEGIN
 actor_role:=rticore_fg_actor_role(p_tenant,p_entity,p_actor);
 IF p_action IS NULL OR p_action NOT IN ('request','approve','reject') OR length(trim(coalesce(p_notes,''))) NOT BETWEEN 12 AND 800 THEN RAISE EXCEPTION 'RECOVERY_INVALID'; END IF;
 IF (p_action='request' AND NOT coalesce(rticore_fg_maintenance_actor(p_tenant,p_entity,p_actor),false))
 OR (p_action<>'request' AND actor_role IS DISTINCT FROM 'approver') THEN RAISE EXCEPTION 'RECOVERY_ACCESS_DENIED'; END IF;
 SELECT * INTO j FROM rticore_native_jobs WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=p_job FOR UPDATE;
 IF NOT FOUND OR j.status<>'dead_letter' OR j.attempts<>j.max_attempts THEN RAISE EXCEPTION 'RECOVERY_SCOPE_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM rticore_native_job_recovery WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND job_id=p_job AND status='approved') THEN RAISE EXCEPTION 'RECOVERY_ALREADY_APPROVED'; END IF;
 IF p_action='request' THEN
  IF p_request IS NOT NULL THEN RAISE EXCEPTION 'RECOVERY_INVALID'; END IF;
  rid:=gen_random_uuid()::text;
  INSERT INTO rticore_native_job_recovery(id,tenant_id,legal_entity_id,job_id,requested_by,reason,prior_attempts)
  VALUES(rid,p_tenant,p_entity,p_job,lower(p_actor),trim(p_notes),j.attempts);
  RETURN jsonb_build_object('id',rid,'status','pending','automatic_posting',false);
 END IF;
 SELECT * INTO x FROM rticore_native_job_recovery WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND job_id=p_job AND id=p_request FOR UPDATE;
 IF NOT FOUND OR x.status<>'pending' OR x.prior_attempts IS DISTINCT FROM j.attempts OR lower(x.requested_by)=lower(p_actor) THEN RAISE EXCEPTION 'RECOVERY_REVIEW_INVALID'; END IF;
 IF NOT coalesce(rticore_fg_maintenance_actor(p_tenant,p_entity,x.requested_by),false) THEN RAISE EXCEPTION 'RECOVERY_MAKER_INVALID'; END IF;
 IF p_action='approve' THEN
  UPDATE rticore_native_jobs SET status='queued',attempts=0,due_at=now(),lease_token=NULL,lease_until=NULL,last_reason='INDEPENDENT_RECOVERY_APPROVED'
   WHERE id=j.id AND tenant_id=p_tenant AND legal_entity_id=p_entity;
 END IF;
 UPDATE rticore_native_job_recovery SET status=CASE WHEN p_action='approve' THEN 'approved' ELSE 'rejected' END,reviewed_by=lower(p_actor),reviewed_at=now(),review_notes=trim(p_notes)
  WHERE id=x.id AND tenant_id=p_tenant AND legal_entity_id=p_entity;
 RETURN jsonb_build_object('id',x.id,'status',CASE WHEN p_action='approve' THEN 'approved' ELSE 'rejected' END,'automatic_posting',false);
END $r$;
COMMIT;
