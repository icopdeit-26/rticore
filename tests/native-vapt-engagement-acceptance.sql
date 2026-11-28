BEGIN;
INSERT INTO rticore_members(email,role,active,created_by) VALUES('vapt-maker@example.invalid','presales',1,'ci'),('vapt-checker@example.invalid','approver',1,'ci');
INSERT INTO rticore_erp_staff_org(tenant_id,email,unit_id,position_title,created_by,status,reviewed_by,review_notes) VALUES
 ('defendit360','vapt-maker@example.invalid','p0-rehearsal-a','VAPT presales','ci','approved','reviewer','Synthetic approval'),('defendit360','vapt-checker@example.invalid','p0-rehearsal-a','VAPT approver','ci','approved','reviewer','Synthetic approval');
INSERT INTO rticore_erp_capability_grants(id,tenant_id,email,capability,unit_id,status,requested_by,reviewed_by,review_notes) VALUES
 ('vapt-maker-grant','defendit360','vapt-maker@example.invalid','cyber_ops','p0-rehearsal-a','approved','ci','reviewer','Synthetic approval'),('vapt-checker-grant','defendit360','vapt-checker@example.invalid','cyber_ops','p0-rehearsal-a','approved','ci','reviewer','Synthetic approval');
INSERT INTO rticore_erp_project_scopes(tenant_id,project_id,legal_entity_id,status,requested_by,reviewed_by) VALUES('defendit360','vapt-ci-project','p0-rehearsal-a','approved','ci','reviewer');
INSERT INTO rticore_native_vapt_engagement(id,tenant_id,legal_entity_id,project_id,engagement_code,title,test_type,scope_summary,window_start,window_end,roe_document_id,roe_sha256,created_by)
VALUES('vapt-eng-ci','defendit360','p0-rehearsal-a','vapt-ci-project','VAPT-001','Synthetic VAPT engagement','web_app','Synthetic authorized scope',CURRENT_DATE,CURRENT_DATE+7,'vapt-ci-doc',repeat('c',64),'vapt-maker@example.invalid');
DO $v$
BEGIN
 BEGIN
 UPDATE rticore_native_vapt_engagement SET status='roe_approved',version=2,reviewed_by='vapt-maker@example.invalid',reviewed_at=now(),review_notes='Synthetic self approval' WHERE id='vapt-eng-ci';
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'VAPT_ROE_REVIEW_INVALID' THEN RAISE; END IF; END;
 BEGIN
 UPDATE rticore_native_vapt_engagement SET status='roe_approved',version=2,reviewed_by='vapt-checker@example.invalid',reviewed_at=now(),review_notes='Synthetic modified approval',scope_summary='Tampered scope after submission' WHERE id='vapt-eng-ci';
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'VAPT_ENGAGEMENT_IMMUTABLE' THEN RAISE; END IF; END;
 UPDATE rticore_native_vapt_engagement SET status='roe_approved',version=2,reviewed_by='vapt-checker@example.invalid',reviewed_at=now(),review_notes='Synthetic independent approval' WHERE id='vapt-eng-ci';
 IF NOT EXISTS(SELECT 1 FROM rticore_native_vapt_engagement WHERE id='vapt-eng-ci' AND status='roe_approved' AND version=2) THEN RAISE EXCEPTION 'VAPT_APPROVAL_FAILED'; END IF;
 BEGIN
 DELETE FROM rticore_native_vapt_engagement WHERE id='vapt-eng-ci';
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'VAPT_ENGAGEMENT_IMMUTABLE' THEN RAISE; END IF; END;
END $v$;
ROLLBACK;
