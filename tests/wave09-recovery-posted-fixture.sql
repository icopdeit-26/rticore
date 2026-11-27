-- Disposable CI only; independent synthetic posted journal retained for backup/restore comparison.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO rticore_members(email,role,active,created_by) VALUES ('cams-recovery-check@example.invalid','finance',1,'ci'),('cams-recovery-post@example.invalid','finance',1,'ci'),('cams-recovery-other@example.invalid','finance',1,'ci');
INSERT INTO rticore_erp_org_units(id,tenant_id,code,label,kind,created_by) VALUES ('cams-recovery-entity','defendit360','CAMS-BR-E','Review Entity','legal_entity','ci'),('cams-recovery-other','defendit360','CAMS-BR-O','Other Entity','legal_entity','ci');
INSERT INTO rticore_finance_role_assignments(id,tenant_id,email,finance_role,legal_entity_id,approval_limit_cents,can_check,can_approve,can_post,status,requested_by,reviewed_by,review_notes) VALUES
('cams-recovery-check','defendit360','cams-recovery-check@example.invalid','financial_controller','cams-recovery-entity',20000,1,1,1,'approved','ci-maker','ci-reviewer','Independent CI assignment'),
('cams-recovery-post','defendit360','cams-recovery-post@example.invalid','accounting_officer','cams-recovery-entity',0,0,0,1,'approved','ci-maker','ci-reviewer','Independent CI assignment'),
('cams-recovery-foreign','defendit360','cams-recovery-other@example.invalid','financial_controller','cams-recovery-other',20000,1,1,1,'approved','ci-maker','ci-reviewer','Independent CI assignment');
INSERT INTO rticore_gl_periods(id,tenant_id,legal_entity_id,period,created_by) VALUES('cams-recovery-period','defendit360','cams-recovery-entity','2026-11','ci');
INSERT INTO rticore_gl_accounts(id,tenant_id,legal_entity_id,code,name,category,created_by) VALUES ('cams-recovery-dr','defendit360','cams-recovery-entity','CAMS-BR-D','Cash','asset','ci'),('cams-recovery-cr','defendit360','cams-recovery-entity','CAMS-BR-C','Revenue','revenue','ci');
INSERT INTO rticore_cams_finance_inbox(id,source_tenant_id,source_journal_id,idempotency_key,payload_hash,legal_entity_id,period_code,payload_json,mapped_lines_json) VALUES('cams-recovery-receipt','source-recovery','journal-recovery','OUTBOX-JRN-recovery','hash-recovery','cams-recovery-entity','2026-11','{}','[{"accountId":"cams-recovery-dr","debit":"10000","credit":"0"},{"accountId":"cams-recovery-cr","debit":"0","credit":"10000"}]');
DO $test$
DECLARE j text; result jsonb; n int; actor text;
BEGIN
 j:=cams_create_finance_draft('cams-recovery-receipt');
 FOREACH actor IN ARRAY ARRAY['cams-finance-service@integration.invalid','cams-recovery-other@example.invalid','cams-recovery-post@example.invalid'] LOOP
  BEGIN
   PERFORM cams_review_command('defendit360','cams-recovery-entity','source-recovery','cams-recovery-receipt',actor,'approve',1,'Negative review test');
   RAISE EXCEPTION 'UNAUTHORIZED_APPROVAL_ACCEPTED';
  EXCEPTION WHEN check_violation THEN NULL; END;
 END LOOP;
 BEGIN
  PERFORM cams_review_command('defendit360','cams-recovery-entity','wrong-source','cams-recovery-receipt','cams-recovery-check@example.invalid','approve',1,'Wrong source test');
  RAISE EXCEPTION 'WRONG_SOURCE_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 result:=cams_review_command('defendit360','cams-recovery-entity','source-recovery','cams-recovery-receipt','cams-recovery-check@example.invalid','approve',1,'Independent approval test');
 IF result->>'status'<>'approved' OR NOT EXISTS(SELECT 1 FROM rticore_gl_journals WHERE id=j AND status='approved' AND posted_by IS NULL) THEN RAISE EXCEPTION 'APPROVAL_AUTO_POSTED'; END IF;
 BEGIN
  UPDATE rticore_gl_journals SET status='posted',version=version+1,posted_by='cams-recovery-check@example.invalid' WHERE id=j;
  RAISE EXCEPTION 'DIRECT_SELF_POST_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM cams_review_command('defendit360','cams-recovery-entity','source-recovery','cams-recovery-receipt','cams-recovery-post@example.invalid','post',1,'Stale version test');
  RAISE EXCEPTION 'STALE_VERSION_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 result:=cams_review_command('defendit360','cams-recovery-entity','source-recovery','cams-recovery-receipt','cams-recovery-post@example.invalid','post',2,'Independent posting test');
 IF result->>'status'<>'posted' OR NOT EXISTS(SELECT 1 FROM rticore_gl_journals WHERE id=j AND status='posted' AND reviewed_by='cams-recovery-check@example.invalid' AND posted_by='cams-recovery-post@example.invalid') THEN RAISE EXCEPTION 'POST_NOT_PERSISTED'; END IF;
 SELECT count(*) INTO n FROM rticore_operations_events WHERE entity_id=j AND action IN ('CAMS_JOURNAL_APPROVED','CAMS_JOURNAL_POSTED');
 IF n<>2 THEN RAISE EXCEPTION 'AUDIT_MISSING'; END IF;
END $test$;
COMMIT;
