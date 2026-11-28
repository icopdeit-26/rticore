BEGIN;
INSERT INTO rticore_members(email,role,active,created_by) VALUES ('backup-maker@example.invalid','admin',1,'ci'),('backup-checker@example.invalid','approver',1,'ci');
INSERT INTO rticore_erp_staff_org(tenant_id,email,unit_id,position_title,created_by,status,reviewed_by,review_notes) VALUES
 ('defendit360','backup-maker@example.invalid','p0-rehearsal-a','Admin','ci','approved','reviewer','Synthetic approval'),
 ('defendit360','backup-checker@example.invalid','p0-rehearsal-a','Approver','ci','approved','reviewer','Synthetic approval');
INSERT INTO rticore_native_backup_drill(id,tenant_id,legal_entity_id,environment,source_sha,evidence_sha256,backup_sha256,backup_at,restore_completed_at,backup_bytes,compared_tables,rto_seconds,rpo_seconds,rto_target_seconds,rpo_target_seconds,row_match,privileges_verified,isolated_restore,requested_by,notes)
VALUES('backup-ci','defendit360','p0-rehearsal-a','staging',repeat('a',40),repeat('b',64),repeat('c',64),now()-interval '1 hour',now(),1000,13,600,0,3600,300,true,true,true,'backup-maker@example.invalid','Synthetic restore evidence only');
DO $test$ BEGIN
 BEGIN
 UPDATE rticore_native_backup_drill SET status='verified',reviewed_by='backup-maker@example.invalid',review_notes='Synthetic self approval',review_evidence_sha256=repeat('b',64) WHERE id='backup-ci';
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BACKUP_DRILL_REVIEW_INVALID' THEN RAISE; END IF; END;
 BEGIN
 UPDATE rticore_native_backup_drill SET status='verified',reviewed_by='backup-checker@example.invalid',review_notes='Synthetic wrong evidence',review_evidence_sha256=repeat('d',64) WHERE id='backup-ci';
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BACKUP_DRILL_REVIEW_INVALID' THEN RAISE; END IF; END;
 UPDATE rticore_native_backup_drill SET status='verified',reviewed_by='backup-checker@example.invalid',review_notes='Synthetic independent review',review_evidence_sha256=repeat('b',64) WHERE id='backup-ci';
 IF NOT EXISTS(SELECT 1 FROM rticore_native_backup_drill WHERE id='backup-ci' AND status='verified' AND reviewed_at IS NOT NULL) THEN RAISE EXCEPTION 'BACKUP_REVIEW_FAILED'; END IF;
 BEGIN
 DELETE FROM rticore_native_backup_drill WHERE id='backup-ci';RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BACKUP_DRILL_IMMUTABLE' THEN RAISE; END IF; END;
END $test$;
ROLLBACK;
