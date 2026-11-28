BEGIN;
INSERT INTO rticore_members(email,role,active,created_by) VALUES('grc-maker@example.invalid','presales',1,'ci'),('grc-checker@example.invalid','approver',1,'ci');
INSERT INTO rticore_erp_staff_org(tenant_id,email,unit_id,position_title,created_by,status,reviewed_by,review_notes) VALUES
 ('defendit360','grc-maker@example.invalid','p0-rehearsal-a','GRC maker','ci','approved','reviewer','Synthetic approval'),('defendit360','grc-checker@example.invalid','p0-rehearsal-a','GRC checker','ci','approved','reviewer','Synthetic approval');
INSERT INTO rticore_erp_capability_grants(id,tenant_id,email,capability,unit_id,status,requested_by,reviewed_by,review_notes) VALUES
 ('grc-maker-grant','defendit360','grc-maker@example.invalid','cyber_ops','p0-rehearsal-a','approved','ci','reviewer','Synthetic approval'),('grc-checker-grant','defendit360','grc-checker@example.invalid','cyber_ops','p0-rehearsal-a','approved','ci','reviewer','Synthetic approval');
INSERT INTO rticore_erp_project_scopes(tenant_id,project_id,legal_entity_id,status,requested_by,reviewed_by) VALUES('defendit360','grc-ci-project','p0-rehearsal-a','approved','ci','reviewer'),('defendit360','cti-ci-project','p0-rehearsal-a','approved','ci','reviewer');
INSERT INTO rticore_native_cti_case(id,tenant_id,legal_entity_id,project_id,code,title,request_type,tlp,severity,summary,document_id,document_sha256,created_by) VALUES('cti-case-ci','defendit360','p0-rehearsal-a','cti-ci-project','CTI-001','Synthetic CTI case','intelligence_request','TLP:AMBER','medium','Synthetic intelligence report','cti-ci-doc',repeat('c',64),'grc-maker@example.invalid');
INSERT INTO rticore_native_cti_ioc(id,tenant_id,legal_entity_id,project_id,case_id,ioc_type,indicator_value,confidence,document_id,document_sha256,created_by) VALUES('ioc-ci','defendit360','p0-rehearsal-a','cti-ci-project','cti-case-ci','domain','Example.Invalid',90,'cti-ci-doc',repeat('c',64),'grc-maker@example.invalid');
INSERT INTO rticore_native_grc_engagement(id,tenant_id,legal_entity_id,project_id,code,title,framework,scope_summary,document_id,document_sha256,created_by) VALUES('grc-eng-ci','defendit360','p0-rehearsal-a','grc-ci-project','GRC-001','Synthetic GRC engagement','ISO 27001','Synthetic assessment scope','grc-ci-doc',repeat('c',64),'grc-maker@example.invalid');
INSERT INTO rticore_native_grc_risk(id,tenant_id,legal_entity_id,project_id,engagement_id,code,title,risk_domain,description,inherent_likelihood,inherent_impact,residual_likelihood,residual_impact,kri_metric,kri_threshold,treatment_plan,document_id,document_sha256,created_by) VALUES('risk-ci','defendit360','p0-rehearsal-a','grc-ci-project','grc-eng-ci','R-001','Synthetic risk','cybersecurity','Synthetic risk description',4,5,2,3,'Overdue remediation','5','Synthetic treatment plan','grc-ci-doc',repeat('c',64),'grc-maker@example.invalid');
INSERT INTO rticore_native_grc_control(id,tenant_id,legal_entity_id,project_id,engagement_id,risk_id,code,title,regulatory_ref,control_type,control_description,document_id,document_sha256,created_by) VALUES('control-ci','defendit360','p0-rehearsal-a','grc-ci-project','grc-eng-ci','risk-ci','C-001','Synthetic control','ISO 27001','preventive','Synthetic control description','grc-ci-doc',repeat('c',64),'grc-maker@example.invalid');
INSERT INTO rticore_native_cti_case(id,tenant_id,legal_entity_id,project_id,code,title,request_type,tlp,severity,summary,document_id,document_sha256,created_by) VALUES('cti-red-ci','defendit360','p0-rehearsal-a','cti-ci-project','CTI-RED','Synthetic restricted case','intelligence_request','TLP:RED','high','Synthetic restricted report','cti-ci-doc',repeat('c',64),'grc-maker@example.invalid');
INSERT INTO rticore_members(email,role,active,created_by) VALUES('cti-other@example.invalid','admin',1,'ci');
INSERT INTO rticore_erp_staff_org(tenant_id,email,unit_id,position_title,created_by,status,reviewed_by,review_notes) VALUES('defendit360','cti-other@example.invalid','p0-rehearsal-a','CTI second maker','ci','approved','reviewer','Synthetic approval');
INSERT INTO rticore_erp_capability_grants(id,tenant_id,email,capability,unit_id,status,requested_by,reviewed_by,review_notes) VALUES('cti-other-grant','defendit360','cti-other@example.invalid','cyber_ops','p0-rehearsal-a','approved','ci','reviewer','Synthetic approval');
DO $g$
BEGIN
 BEGIN
 INSERT INTO rticore_native_cti_ioc(id,tenant_id,legal_entity_id,project_id,case_id,ioc_type,indicator_value,confidence,document_id,document_sha256,created_by) VALUES('ioc-red-invalid','defendit360','p0-rehearsal-a','cti-ci-project','cti-red-ci','domain','example.invalid',90,'cti-ci-doc',repeat('c',64),'cti-other@example.invalid');
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'CTI_CASE_SCOPE_INVALID' THEN RAISE; END IF; END;
 IF NOT EXISTS(SELECT 1 FROM rticore_native_cti_ioc WHERE id='ioc-ci' AND indicator_value='example.invalid') THEN RAISE EXCEPTION 'IOC_NORMALIZATION_FAILED'; END IF;
 BEGIN
 INSERT INTO rticore_native_cti_ioc(id,tenant_id,legal_entity_id,project_id,case_id,ioc_type,indicator_value,confidence,document_id,document_sha256,created_by) VALUES('ioc-invalid','defendit360','p0-rehearsal-a','cti-ci-project','cti-case-ci','sha256','not-a-hash',80,'cti-ci-doc',repeat('c',64),'grc-maker@example.invalid');
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'CTI_IOC_INVALID' THEN RAISE; END IF; END;
 BEGIN
 INSERT INTO rticore_native_grc_control_test(id,tenant_id,legal_entity_id,project_id,control_id,test_type,assessment_status,test_notes,document_id,document_sha256,created_by) VALUES('self-test-ci','defendit360','p0-rehearsal-a','grc-ci-project','control-ci','design','effective','Synthetic self testing','grc-ci-doc',repeat('c',64),'grc-maker@example.invalid');
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'GRC_INDEPENDENT_TEST_REQUIRED' THEN RAISE; END IF; END;
 BEGIN
 INSERT INTO rticore_native_grc_control_test(id,tenant_id,legal_entity_id,project_id,control_id,test_type,assessment_status,test_notes,document_id,document_sha256,created_by) VALUES('foreign-test-ci','defendit360','p0-rehearsal-a','grc-ci-project','control-ci','design','effective','Synthetic foreign evidence','cti-ci-doc',repeat('c',64),'grc-checker@example.invalid');
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'CTI_GRC_EVIDENCE_INVALID' THEN RAISE; END IF; END;
 INSERT INTO rticore_native_grc_control_test(id,tenant_id,legal_entity_id,project_id,control_id,test_type,assessment_status,test_notes,document_id,document_sha256,created_by) VALUES('control-test-ci','defendit360','p0-rehearsal-a','grc-ci-project','control-ci','design','effective','Synthetic independent test','grc-ci-doc',repeat('c',64),'grc-checker@example.invalid');
 BEGIN
 DELETE FROM rticore_native_grc_control_test WHERE id='control-test-ci';
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'CTI_GRC_REGISTER_IMMUTABLE' THEN RAISE; END IF; END;
END $g$;
ROLLBACK;
