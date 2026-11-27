\set ON_ERROR_STOP on
BEGIN;
INSERT INTO rticore_erp_org_units(id,tenant_id,code,label,kind,created_by) VALUES('cams-ci-entity','defendit360','CAMS-CI-ENTITY','CAMS CI Entity','legal_entity','ci');
INSERT INTO rticore_erp_org_units(id,tenant_id,code,label,kind,parent_id,created_by) VALUES('cams-ci-division','defendit360','CAMS-CI-DIV','CAMS CI Division','division','cams-ci-entity','ci'),('cams-ci-cost','defendit360','CAMS-CI-COST','CAMS CI Cost','cost_center','cams-ci-division','ci');
INSERT INTO rticore_gl_periods(id,tenant_id,legal_entity_id,period,created_by) VALUES('cams-ci-period','defendit360','cams-ci-entity','2026-11','ci');
INSERT INTO rticore_gl_accounts(id,tenant_id,legal_entity_id,code,name,category,created_by) VALUES('cams-ci-debit','defendit360','cams-ci-entity','CAMS-CI-D','Cash test','asset','ci'),('cams-ci-credit','defendit360','cams-ci-entity','CAMS-CI-C','Revenue test','revenue','ci');
INSERT INTO rticore_cams_finance_inbox(id,source_tenant_id,source_journal_id,idempotency_key,payload_hash,legal_entity_id,period_code,payload_json,mapped_lines_json) VALUES('cams-ci-receipt','tenant-test','journal-test','OUTBOX-JRN-test','test-hash','cams-ci-entity','2026-11','{}','[{"accountId":"cams-ci-debit","debit":"10000","credit":"0","costCenterId":"cams-ci-cost"},{"accountId":"cams-ci-credit","debit":"0","credit":"10000","costCenterId":null}]');
DO $$
DECLARE j text; replay text; n int;
BEGIN
 j:=cams_create_finance_draft('cams-ci-receipt');
 replay:=cams_create_finance_draft('cams-ci-receipt');
 IF j IS NULL OR j<>replay THEN RAISE EXCEPTION 'Draft replay mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rticore_gl_journals WHERE id=j AND status='draft' AND source_type='camsrti') THEN RAISE EXCEPTION 'Draft missing or auto-posted'; END IF;
 SELECT count(*) INTO n FROM rticore_gl_lines WHERE journal_id=j;
 IF n<>2 THEN RAISE EXCEPTION 'Duplicate or missing lines'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rticore_finance_journal_dimensions WHERE journal_id=j AND cost_center_id='cams-ci-cost') THEN RAISE EXCEPTION 'Cost center not persisted'; END IF;
 BEGIN
  UPDATE rticore_gl_journals SET status='approved',version=version+1,reviewed_by=created_by,review_notes='Attempted self approval' WHERE id=j;
  RAISE EXCEPTION 'SELF_APPROVAL_WAS_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE rticore_cams_finance_inbox SET payload_hash='changed' WHERE id='cams-ci-receipt';
  RAISE EXCEPTION 'INBOX_MUTATION_WAS_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'CAMS_FINANCE_INBOX_IMMUTABLE' THEN RAISE; END IF; END;
 INSERT INTO rticore_cams_finance_inbox(id,source_tenant_id,source_journal_id,idempotency_key,payload_hash,legal_entity_id,period_code,payload_json,mapped_lines_json) VALUES('cams-ci-bad','tenant-test','journal-bad','OUTBOX-JRN-bad','bad-hash','cams-ci-entity','2026-11','{}','[{"accountId":"cams-ci-debit","debit":"10000","credit":"0"},{"accountId":"nonexistent","debit":"0","credit":"10000"}]');
 BEGIN
  PERFORM cams_create_finance_draft('cams-ci-bad');
  RAISE EXCEPTION 'INVALID_ACCOUNT_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'CAMS_ACCOUNT_INVALID' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM rticore_gl_journals WHERE source_key='OUTBOX-JRN-bad') THEN RAISE EXCEPTION 'Partial draft persisted'; END IF;
END $$;
ROLLBACK;
