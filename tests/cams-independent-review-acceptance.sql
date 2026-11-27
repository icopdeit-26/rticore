\set ON_ERROR_STOP on
BEGIN;
INSERT INTO rticore_members(email,role,active,created_by) VALUES ('cams-check@example.invalid','finance',1,'ci'),('cams-post@example.invalid','finance',1,'ci'),('cams-other@example.invalid','finance',1,'ci');
INSERT INTO rticore_erp_org_units(id,tenant_id,code,label,kind,created_by) VALUES ('cams-review-entity','defendit360','CAMS-R-E','Review Entity','legal_entity','ci'),('cams-review-other','defendit360','CAMS-R-O','Other Entity','legal_entity','ci');
INSERT INTO rticore_finance_role_assignments(id,tenant_id,email,finance_role,legal_entity_id,approval_limit_cents,can_check,can_approve,can_post,status,requested_by,reviewed_by,review_notes) VALUES
('cams-review-check','defendit360','cams-check@example.invalid','financial_controller','cams-review-entity',20000,1,1,1,'approved','ci-maker','ci-reviewer','Independent CI assignment'),
('cams-review-post','defendit360','cams-post@example.invalid','accounting_officer','cams-review-entity',0,0,0,1,'approved','ci-maker','ci-reviewer','Independent CI assignment'),
('cams-review-foreign','defendit360','cams-other@example.invalid','financial_controller','cams-review-other',20000,1,1,1,'approved','ci-maker','ci-reviewer','Independent CI assignment');
INSERT INTO rticore_gl_periods(id,tenant_id,legal_entity_id,period,created_by) VALUES('cams-review-period','defendit360','cams-review-entity','2026-11','ci');
INSERT INTO rticore_gl_accounts(id,tenant_id,legal_entity_id,code,name,category,created_by) VALUES ('cams-review-dr','defendit360','cams-review-entity','CAMS-R-D','Cash','asset','ci'),('cams-review-cr','defendit360','cams-review-entity','CAMS-R-C','Revenue','revenue','ci');
INSERT INTO rticore_cams_finance_inbox(id,source_tenant_id,source_journal_id,idempotency_key,payload_hash,legal_entity_id,period_code,payload_json,mapped_lines_json) VALUES('cams-review-receipt','source-review','journal-review','OUTBOX-JRN-review','hash-review','cams-review-entity','2026-11','{}','[{"accountId":"cams-review-dr","debit":"10000","credit":"0"},{"accountId":"cams-review-cr","debit":"0","credit":"10000"}]');
DO $test$
DECLARE j text; result jsonb; n int; actor text;
BEGIN
 j:=cams_create_finance_draft('cams-review-receipt');
 FOREACH actor IN ARRAY ARRAY['cams-finance-service@integration.invalid','cams-other@example.invalid','cams-post@example.invalid'] LOOP
  BEGIN
   PERFORM cams_review_command('defendit360','cams-review-entity','source-review','cams-review-receipt',actor,'approve',1,'Negative review test');
   RAISE EXCEPTION 'UNAUTHORIZED_APPROVAL_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL; END;
 END LOOP;
 BEGIN
  PERFORM cams_review_command('defendit360','cams-review-entity','wrong-source','cams-review-receipt','cams-check@example.invalid','approve',1,'Wrong source test');
  RAISE EXCEPTION 'WRONG_SOURCE_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 result:=cams_review_command('defendit360','cams-review-entity','source-review','cams-review-receipt','cams-check@example.invalid','approve',1,'Independent approval test');
 IF result->>'status'<>'approved' OR NOT EXISTS(SELECT 1 FROM rticore_gl_journals WHERE id=j AND status='approved' AND posted_by IS NULL) THEN RAISE EXCEPTION 'APPROVAL_AUTO_POSTED'; END IF;
 BEGIN
  UPDATE rticore_gl_journals SET status='posted',version=version+1,posted_by='cams-check@example.invalid' WHERE id=j;
  RAISE EXCEPTION 'DIRECT_SELF_POST_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM cams_review_command('defendit360','cams-review-entity','source-review','cams-review-receipt','cams-post@example.invalid','post',1,'Stale version test');
  RAISE EXCEPTION 'STALE_VERSION_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 result:=cams_review_command('defendit360','cams-review-entity','source-review','cams-review-receipt','cams-post@example.invalid','post',2,'Independent posting test');
 IF result->>'status'<>'posted' OR NOT EXISTS(SELECT 1 FROM rticore_gl_journals WHERE id=j AND status='posted' AND reviewed_by='cams-check@example.invalid' AND posted_by='cams-post@example.invalid') THEN RAISE EXCEPTION 'POST_NOT_PERSISTED'; END IF;
 SELECT count(*) INTO n FROM rticore_operations_events WHERE entity_id=j AND action IN ('CAMS_JOURNAL_APPROVED','CAMS_JOURNAL_POSTED');
 IF n<>2 THEN RAISE EXCEPTION 'AUDIT_MISSING'; END IF;
END $test$;
ROLLBACK;
