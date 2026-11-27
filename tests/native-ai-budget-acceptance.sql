\set ON_ERROR_STOP on
BEGIN;
INSERT INTO rticore_members(email,role,active,created_by) VALUES('ai-ci@example.invalid','admin',1,'ci'),('ai-ci-viewer@example.invalid','viewer',1,'ci');
DO $test$
BEGIN
 FOR n IN 1..20 LOOP
  IF NOT rticore_reserve_ai_request('ai-ci-'||n,'defendit360','AI-CI@example.invalid','chat') THEN RAISE EXCEPTION 'AI_QUOTA_EARLY_DENIAL'; END IF;
 END LOOP;
 IF rticore_reserve_ai_request('ai-ci-over','defendit360','ai-ci@example.invalid','chat_retry') THEN RAISE EXCEPTION 'AI_QUOTA_BYPASS'; END IF;
 IF rticore_reserve_ai_request('ai-ci-view','defendit360','ai-ci-viewer@example.invalid','chat') THEN RAISE EXCEPTION 'AI_ROLE_BYPASS'; END IF;
 IF (SELECT count(*) FROM rticore_sales_ai_audit WHERE actor_email='ai-ci@example.invalid' AND provider_id='request')<>20 THEN RAISE EXCEPTION 'AI_QUOTA_AUDIT_INVALID'; END IF;
END $test$;
ROLLBACK;
