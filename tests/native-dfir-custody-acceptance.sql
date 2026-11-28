BEGIN;
INSERT INTO rticore_members(email,role,active,created_by) VALUES('dfir-maker@example.invalid','admin',1,'ci'),('dfir-checker@example.invalid','defense_leader',1,'ci');
INSERT INTO rticore_erp_staff_org(tenant_id,email,unit_id,position_title,created_by,status,reviewed_by,review_notes) VALUES
 ('defendit360','dfir-maker@example.invalid','p0-rehearsal-a','DFIR admin','ci','approved','reviewer','Synthetic approval'),
 ('defendit360','dfir-checker@example.invalid','p0-rehearsal-a','DFIR leader','ci','approved','reviewer','Synthetic approval');
INSERT INTO rticore_erp_capability_grants(id,tenant_id,email,capability,unit_id,status,requested_by,reviewed_by,review_notes) VALUES
 ('dfir-maker-grant','defendit360','dfir-maker@example.invalid','cyber_ops','p0-rehearsal-a','approved','ci','reviewer','Synthetic approval'),
 ('dfir-checker-grant','defendit360','dfir-checker@example.invalid','cyber_ops','p0-rehearsal-a','approved','ci','reviewer','Synthetic approval');
INSERT INTO rticore_erp_project_scopes(tenant_id,project_id,legal_entity_id,status,requested_by,reviewed_by) VALUES('defendit360','dfir-ci-project','p0-rehearsal-a','approved','ci','reviewer');
INSERT INTO rticore_cyber_cases(id,tenant_id,project_id,kind,external_ref,title,severity,classification,created_by) VALUES('dfir-ci-case','defendit360','dfir-ci-project','dfir_incident','DFIR-CASE-CI','Synthetic DFIR case','high','restricted','dfir-maker@example.invalid');
DO $c$
DECLARE r jsonb;
BEGIN
 BEGIN
 PERFORM rticore_native_dfir_append('defendit360','p0-rehearsal-b','dfir-ci-case','dfir-maker@example.invalid','TAG-1','dfir-ci-doc','collected',NULL,'Synthetic custody record',0);
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'CUSTODY_SCOPE_INVALID' THEN RAISE; END IF; END;
 BEGIN
 PERFORM rticore_native_dfir_append('defendit360','p0-rehearsal-a','dfir-ci-case','dfir-maker@example.invalid','TAG-1','fg-ci-doc','collected',NULL,'Synthetic foreign evidence',0);
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'CUSTODY_EVIDENCE_INVALID' THEN RAISE; END IF; END;
 r:=rticore_native_dfir_append('defendit360','p0-rehearsal-a','dfir-ci-case','dfir-maker@example.invalid','TAG-1','dfir-ci-doc','collected',NULL,'Synthetic collected evidence',0);
 IF r->>'seq'<>'1' OR r->>'sha256'<>repeat('c',64) THEN RAISE EXCEPTION 'CUSTODY_CREATE_FAILED'; END IF;
 BEGIN
 PERFORM rticore_native_dfir_append('defendit360','p0-rehearsal-a','dfir-ci-case','dfir-maker@example.invalid','TAG-1','dfir-ci-doc','analyzed',NULL,'Synthetic stale revision',0);
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'CUSTODY_SEQUENCE_INVALID' THEN RAISE; END IF; END;
 PERFORM rticore_native_dfir_append('defendit360','p0-rehearsal-a','dfir-ci-case','dfir-maker@example.invalid','TAG-1','dfir-ci-doc','transferred','dfir-checker@example.invalid','Synthetic transfer evidence',1);
 BEGIN
 PERFORM rticore_native_dfir_append('defendit360','p0-rehearsal-a','dfir-ci-case','dfir-maker@example.invalid','TAG-1','dfir-ci-doc','analyzed',NULL,'Synthetic former custodian',2);
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'CUSTODY_SEQUENCE_INVALID' THEN RAISE; END IF; END;
 PERFORM rticore_native_dfir_append('defendit360','p0-rehearsal-a','dfir-ci-case','dfir-checker@example.invalid','TAG-1','dfir-ci-doc','sealed',NULL,'Synthetic seal evidence',2);
 PERFORM rticore_native_dfir_append('defendit360','p0-rehearsal-a','dfir-ci-case','dfir-checker@example.invalid','TAG-1','dfir-ci-doc','archived',NULL,'Synthetic archived evidence',3);
 BEGIN
 UPDATE rticore_native_dfir_custody SET notes='Tampered custody record' WHERE case_id='dfir-ci-case';
 RAISE EXCEPTION 'UNEXPECTED_SUCCESS'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'CUSTODY_IMMUTABLE' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM rticore_native_dfir_custody WHERE case_id='dfir-ci-case')<>4 THEN RAISE EXCEPTION 'CUSTODY_COUNT_INVALID'; END IF;
END $c$;
ROLLBACK;
