BEGIN;
INSERT INTO rticore_members(email,role,active,created_by) VALUES('soc-maker@example.invalid','defense_leader',1,'ci'),('soc-checker@example.invalid','approver',1,'ci');
INSERT INTO rticore_erp_staff_org(tenant_id,email,unit_id,position_title,created_by,status,reviewed_by,review_notes) VALUES
 ('defendit360','soc-maker@example.invalid','p0-rehearsal-a','SOC lead','ci','approved','reviewer','Synthetic approval'),('defendit360','soc-checker@example.invalid','p0-rehearsal-a','SOC approver','ci','approved','reviewer','Synthetic approval');
INSERT INTO rticore_erp_capability_grants(id,tenant_id,email,capability,unit_id,status,requested_by,reviewed_by,review_notes) VALUES
 ('soc-maker-grant','defendit360','soc-maker@example.invalid','cyber_ops','p0-rehearsal-a','approved','ci','reviewer','Synthetic approval'),('soc-checker-grant','defendit360','soc-checker@example.invalid','cyber_ops','p0-rehearsal-a','approved','ci','reviewer','Synthetic approval');
INSERT INTO rticore_erp_project_scopes(tenant_id,project_id,legal_entity_id,status,requested_by,reviewed_by) VALUES('defendit360','soc-ci-project','p0-rehearsal-a','approved','ci','reviewer');
INSERT INTO rticore_native_soc_sla(id,tenant_id,legal_entity_id,project_id,period_code,observations,within_sla,alerts_triaged,incidents_escalated,mttd_minutes,mttr_minutes,document_id,document_sha256,created_by)
VALUES('soc-sla-ci','defendit360','p0-rehearsal-a','soc-ci-project','2026-01',100,99,20,3,10,30,'soc-ci-doc',repeat('c',64),'soc-maker@example.invalid');
DO $s$
BEGIN
 BEGIN
 UPDATE rticore_native_soc_sla SET status='approved',reviewed_by='soc-maker@example.invalid',reviewed_at=now(),review_notes='Synthetic self approval' WHERE id='soc-sla-ci';
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SOC_SLA_REVIEW_INVALID' THEN RAISE; END IF; END;
 BEGIN
 UPDATE rticore_native_soc_sla SET status='approved',reviewed_by='soc-checker@example.invalid',reviewed_at=now(),review_notes='Synthetic modified approval',within_sla=100 WHERE id='soc-sla-ci';
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SOC_SLA_IMMUTABLE' THEN RAISE; END IF; END;
 UPDATE rticore_native_soc_sla SET status='approved',reviewed_by='soc-checker@example.invalid',reviewed_at=now(),review_notes='Synthetic independent approval' WHERE id='soc-sla-ci';
 IF NOT EXISTS(SELECT 1 FROM rticore_native_soc_sla WHERE id='soc-sla-ci' AND status='approved' AND round(within_sla::numeric*10000/observations)=9900) THEN RAISE EXCEPTION 'SOC_APPROVAL_FAILED'; END IF;
 BEGIN
 DELETE FROM rticore_native_soc_sla WHERE id='soc-sla-ci';
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SOC_SLA_IMMUTABLE' THEN RAISE; END IF; END;
END $s$;
ROLLBACK;
