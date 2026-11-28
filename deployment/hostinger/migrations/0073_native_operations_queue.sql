BEGIN;
-- Native bounded queue for explicitly supported internal work. No arbitrary SQL or external commands.
CREATE TABLE IF NOT EXISTS rticore_native_jobs (
 id text PRIMARY KEY, tenant_id text NOT NULL, legal_entity_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('flexguard_retry','flexguard_expiry')),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 128),
 requested_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','dead_letter')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8),
 max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 8),
 due_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, lease_token text,
 last_reason text,
 UNIQUE(tenant_id,legal_entity_id,kind,idempotency_key),
 UNIQUE(tenant_id,legal_entity_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 CHECK((status='running' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR (status<>'running' AND lease_token IS NULL AND lease_until IS NULL)),
 CHECK(attempts<=max_attempts)
);
CREATE INDEX IF NOT EXISTS rticore_native_jobs_due ON rticore_native_jobs(tenant_id,legal_entity_id,due_at,id) WHERE status='queued';
CREATE TABLE IF NOT EXISTS rticore_native_job_recovery (
 id text PRIMARY KEY, tenant_id text NOT NULL, legal_entity_id text NOT NULL, job_id text NOT NULL,
 requested_by text NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 12 AND 800),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reviewed_by text, reviewed_at timestamptz,
 FOREIGN KEY(tenant_id,legal_entity_id,job_id) REFERENCES rticore_native_jobs(tenant_id,legal_entity_id,id),
 CHECK((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR (status<>'pending' AND reviewed_by IS NOT NULL AND lower(reviewed_by)<>lower(requested_by) AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS rticore_native_job_recovery_pending ON rticore_native_job_recovery(tenant_id,legal_entity_id,job_id) WHERE status='pending';
CREATE OR REPLACE FUNCTION rticore_native_job_claim(p_tenant text,p_entity text,p_actor text,p_token text)
RETURNS TABLE(job_id text,job_kind text) LANGUAGE plpgsql SET search_path=public,pg_catalog AS $j$
BEGIN
 IF NOT coalesce(rticore_fg_maintenance_actor(p_tenant,p_entity,p_actor),false) OR length(coalesce(p_token,'')) NOT BETWEEN 32 AND 128 THEN RAISE EXCEPTION 'JOB_ACCESS_DENIED'; END IF;
 UPDATE rticore_native_jobs SET status=CASE WHEN attempts>=max_attempts THEN 'dead_letter' ELSE 'queued' END,lease_token=NULL,lease_until=NULL,due_at=now()+interval '5 minutes',last_reason='LEASE_EXPIRED' WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND status='running' AND lease_until<=now();
 RETURN QUERY WITH candidate AS (SELECT j.id FROM rticore_native_jobs j WHERE j.tenant_id=p_tenant AND j.legal_entity_id=p_entity AND j.status='queued' AND j.due_at<=now() AND j.attempts<j.max_attempts ORDER BY j.due_at,j.id LIMIT 1 FOR UPDATE SKIP LOCKED)
 UPDATE rticore_native_jobs j SET status='running',attempts=j.attempts+1,lease_token=p_token,lease_until=now()+interval '2 minutes' FROM candidate c WHERE j.id=c.id RETURNING j.id,j.kind;
END $j$;
CREATE OR REPLACE FUNCTION rticore_native_job_finish(p_tenant text,p_entity text,p_actor text,p_id text,p_token text,p_ok boolean)
RETURNS boolean LANGUAGE plpgsql SET search_path=public,pg_catalog AS $j$
BEGIN
 IF NOT coalesce(rticore_fg_maintenance_actor(p_tenant,p_entity,p_actor),false) OR p_ok IS NULL THEN RAISE EXCEPTION 'JOB_ACCESS_DENIED'; END IF;
 UPDATE rticore_native_jobs SET status=CASE WHEN p_ok THEN 'succeeded' WHEN attempts>=max_attempts THEN 'dead_letter' ELSE 'queued' END,lease_until=NULL,lease_token=NULL,due_at=now()+make_interval(mins=>least(1440,5*(2^attempts)::integer)),last_reason=CASE WHEN p_ok THEN 'COMPLETED' ELSE 'EXECUTION_FAILED' END WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=p_id AND status='running' AND lease_token=p_token AND lease_until>now();
 RETURN FOUND;
END $j$;
COMMIT;
