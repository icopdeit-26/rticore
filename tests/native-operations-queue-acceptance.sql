BEGIN;
INSERT INTO rticore_native_jobs(id,tenant_id,legal_entity_id,kind,idempotency_key,requested_by,max_attempts)
VALUES('native-job-ci','defendit360','p0-rehearsal-a','flexguard_retry','synthetic-job-ci-001','maker@example.invalid',1);
DO $test$
BEGIN
 BEGIN
 INSERT INTO rticore_native_jobs(id,tenant_id,legal_entity_id,kind,idempotency_key,requested_by)
 VALUES('native-job-ci-dup','defendit360','p0-rehearsal-a','flexguard_retry','synthetic-job-ci-001','maker@example.invalid');
 RAISE EXCEPTION 'duplicate accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
 UPDATE rticore_native_jobs SET status='running' WHERE id='native-job-ci';
 RAISE EXCEPTION 'missing lease accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
 PERFORM rticore_native_job_claim('defendit360','p0-rehearsal-a','unauthorized@example.invalid','12345678901234567890123456789012');
 RAISE EXCEPTION 'unauthorized claim accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'JOB_ACCESS_DENIED' THEN RAISE; END IF; END;
 UPDATE rticore_native_jobs SET status='dead_letter',attempts=1 WHERE id='native-job-ci';
 INSERT INTO rticore_native_job_recovery(id,tenant_id,legal_entity_id,job_id,requested_by,reason)
 VALUES('native-recovery-ci','defendit360','p0-rehearsal-a','native-job-ci','maker@example.invalid','Synthetic recovery request');
 BEGIN
 UPDATE rticore_native_job_recovery SET status='approved',reviewed_by='MAKER@example.invalid',reviewed_at=now() WHERE id='native-recovery-ci';
 RAISE EXCEPTION 'self approval accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $test$;
ROLLBACK;
