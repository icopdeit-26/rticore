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

-- A-R12: real commands with active scoped maker and independent checker.
INSERT INTO rticore_members(email,role,active,created_by) VALUES
 ('recovery-maker@example.invalid','finance',1,'ci'),('recovery-checker@example.invalid','approver',1,'ci');
INSERT INTO rticore_erp_staff_org(tenant_id,email,unit_id,position_title,created_by,status,reviewed_by,review_notes) VALUES
 ('defendit360','recovery-maker@example.invalid','p0-rehearsal-a','Finance','ci','approved','reviewer','Synthetic approval'),
 ('defendit360','recovery-checker@example.invalid','p0-rehearsal-a','Checker','ci','approved','reviewer','Synthetic approval');
INSERT INTO rticore_finance_role_assignments(id,tenant_id,email,finance_role,legal_entity_id,approval_limit_cents,can_make,can_check,can_approve,status,requested_by,reviewed_by,review_notes)
VALUES ('recovery-maker-role','defendit360','recovery-maker@example.invalid','finance_manager','p0-rehearsal-a',0,1,0,0,'approved','ci','reviewer','Synthetic assignment');
INSERT INTO rticore_native_jobs(id,tenant_id,legal_entity_id,kind,idempotency_key,requested_by,status,attempts,max_attempts)
VALUES('native-recovery-job-ci','defendit360','p0-rehearsal-a','flexguard_retry','synthetic-recovery-job-ci','recovery-maker@example.invalid','dead_letter',2,2);
DO $test$
DECLARE rid text; result jsonb;
BEGIN
 result:=rticore_native_recovery_command('defendit360','p0-rehearsal-a','recovery-maker@example.invalid','request','native-recovery-job-ci',NULL,'Synthetic recovery request');
 rid:=result->>'id';
 IF result->>'status'<>'pending' OR NOT EXISTS(SELECT 1 FROM rticore_native_job_recovery WHERE id=rid AND prior_attempts=2) THEN RAISE EXCEPTION 'RECOVERY_REQUEST_FAILED'; END IF;
 BEGIN
  PERFORM rticore_native_recovery_command('defendit360','p0-rehearsal-a','recovery-maker@example.invalid','request','native-recovery-job-ci',NULL,'Duplicate synthetic recovery');
  RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  PERFORM rticore_native_recovery_command('defendit360','p0-rehearsal-a','recovery-maker@example.invalid','approve','native-recovery-job-ci',rid,'Synthetic self approval');
  RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'RECOVERY_ACCESS_DENIED' THEN RAISE; END IF; END;
 BEGIN
  PERFORM rticore_native_recovery_command('defendit360','p0-rehearsal-b','recovery-checker@example.invalid','approve','native-recovery-job-ci',rid,'Synthetic cross entity approval');
  RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'RECOVERY_ACCESS_DENIED' THEN RAISE; END IF; END;
 result:=rticore_native_recovery_command('defendit360','p0-rehearsal-a','recovery-checker@example.invalid','approve','native-recovery-job-ci',rid,'Synthetic independent approval');
 IF result->>'status'<>'approved' OR result->>'automatic_posting'<>'false' OR NOT EXISTS(SELECT 1 FROM rticore_native_jobs WHERE id='native-recovery-job-ci' AND status='queued' AND attempts=0) THEN RAISE EXCEPTION 'RECOVERY_APPROVAL_FAILED'; END IF;
 BEGIN
  UPDATE rticore_native_job_recovery SET reason='Tampered recovery reason' WHERE id=rid;
  RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'RECOVERY_IMMUTABLE' THEN RAISE; END IF; END;
 UPDATE rticore_native_jobs SET status='dead_letter',attempts=2 WHERE id='native-recovery-job-ci';
 BEGIN
  PERFORM rticore_native_recovery_command('defendit360','p0-rehearsal-a','recovery-maker@example.invalid','request','native-recovery-job-ci',NULL,'Repeated synthetic recovery');
  RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'RECOVERY_ALREADY_APPROVED' THEN RAISE; END IF; END;
END $test$;
ROLLBACK;
