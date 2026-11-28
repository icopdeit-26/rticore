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
-- Actual finding guard and append-only transition history.
INSERT INTO rticore_document_library(id,tenant_id,opportunity_id,kind,version,file_name,media_type,byte_length,sha256,iv,chunk_count,created_by) VALUES('vapt-retest-ci-doc','defendit360','vapt-ci-opportunity','supporting',2,'synthetic-retest.pdf','application/pdf',1,repeat('d',64),repeat('a',16),1,'ci');
INSERT INTO rticore_native_vapt_finding(id,tenant_id,legal_entity_id,project_id,engagement_id,finding_code,title,cvss_tenths,affected_asset,remediation,evidence_document_id,evidence_sha256,created_by,last_actor,last_notes)
VALUES('vapt-finding-ci','defendit360','p0-rehearsal-a','vapt-ci-project','vapt-eng-ci','F-001','Synthetic finding',75,'Synthetic asset','Synthetic remediation guidance','vapt-ci-doc',repeat('c',64),'vapt-maker@example.invalid','vapt-maker@example.invalid','Synthetic finding record');
DO $v$
BEGIN
 BEGIN
 UPDATE rticore_native_vapt_finding SET status='qa_approved',version=2,last_actor='vapt-maker@example.invalid',last_notes='Synthetic self approval' WHERE id='vapt-finding-ci';
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'VAPT_QA_REVIEW_INVALID' THEN RAISE; END IF; END;
 UPDATE rticore_native_vapt_finding SET status='qa_approved',version=2,last_actor='vapt-checker@example.invalid',last_notes='Synthetic independent QA' WHERE id='vapt-finding-ci';
 UPDATE rticore_native_vapt_finding SET status='retest_requested',version=3,last_actor='vapt-checker@example.invalid',last_notes='Synthetic retest request' WHERE id='vapt-finding-ci';
 UPDATE rticore_native_vapt_finding SET status='retest_submitted',version=4,last_actor='vapt-maker@example.invalid',last_notes='Synthetic retest submission',retest_document_id='vapt-retest-ci-doc',retest_sha256=repeat('d',64),retest_by='vapt-maker@example.invalid' WHERE id='vapt-finding-ci';
 UPDATE rticore_native_vapt_finding SET status='verified_fixed',version=5,last_actor='vapt-checker@example.invalid',last_notes='Synthetic independent retest verification' WHERE id='vapt-finding-ci';
 IF (SELECT count(*) FROM rticore_native_vapt_finding_event WHERE finding_id='vapt-finding-ci')<>5 THEN RAISE EXCEPTION 'VAPT_HISTORY_INVALID'; END IF;
 BEGIN
 DELETE FROM rticore_native_vapt_finding_event WHERE finding_id='vapt-finding-ci';
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'VAPT_FINDING_EVENT_IMMUTABLE' THEN RAISE; END IF; END;
END $v$;
INSERT INTO rticore_members(email,role,active,created_by) VALUES('offense-ci@example.invalid','offense_member',1,'ci');
INSERT INTO rticore_erp_staff_org(tenant_id,email,unit_id,position_title,created_by,status,reviewed_by,review_notes) VALUES('defendit360','offense-ci@example.invalid','p0-rehearsal-a','Technical CI','ci','approved','reviewer','Synthetic approval');
INSERT INTO rticore_resource_people(id,tenant_id,email,display_name,skills,capacity_pd_month,daily_cost_idr,created_by) VALUES('offense-ci-person','defendit360','offense-ci@example.invalid','Synthetic technical person','[]',20,0,'ci');
INSERT INTO rticore_resource_allocations(id,tenant_id,opportunity_id,person_id,allocation_month,work_role,person_days,daily_cost_snapshot,created_by) VALUES('offense-ci-allocation','defendit360','vapt-ci-opportunity','offense-ci-person',to_char(CURRENT_DATE,'YYYY-MM'),'Analyst',1,0,'ci');
DO $test$ BEGIN
 IF rticore_native_vapt_actor('defendit360','p0-rehearsal-a','vapt-ci-project','offense-ci@example.invalid') IS DISTINCT FROM 'offense_member' OR rticore_native_vapt_actor('defendit360','p0-rehearsal-b','vapt-ci-project','offense-ci@example.invalid') IS NOT NULL THEN RAISE EXCEPTION 'TECHNICAL_SCOPE_FAILED'; END IF;
 INSERT INTO rticore_native_vapt_finding(id,tenant_id,legal_entity_id,project_id,engagement_id,finding_code,title,cvss_tenths,affected_asset,remediation,evidence_document_id,evidence_sha256,created_by,last_actor,last_notes) VALUES('offense-finding-ci','defendit360','p0-rehearsal-a','vapt-ci-project','vapt-eng-ci','F-OFF','Synthetic technical finding',50,'Synthetic asset','Synthetic mitigation advice','vapt-ci-doc',repeat('c',64),'offense-ci@example.invalid','offense-ci@example.invalid','Synthetic technical evidence');
 BEGIN UPDATE rticore_native_vapt_finding SET status='qa_approved',version=2,last_actor='offense-ci@example.invalid',last_notes='Synthetic unauthorized approval' WHERE id='offense-finding-ci';RAISE EXCEPTION 'UNEXPECTED_SUCCESS';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'VAPT_QA_REVIEW_INVALID' THEN RAISE;END IF;END;
 UPDATE rticore_resource_allocations SET status='cancelled' WHERE id='offense-ci-allocation';
 IF rticore_native_vapt_actor('defendit360','p0-rehearsal-a','vapt-ci-project','offense-ci@example.invalid') IS NOT NULL THEN RAISE EXCEPTION 'TECHNICAL_REVOKE_FAILED';END IF;
END $test$;
ROLLBACK;
