-- RTICORE canonical migration 0055: CTI (M14), GRC Consulting (M15), Enterprise Risk & Control (M27),
-- Durable Background Job Queue (M30/H08) and Backup/Restore Drill Metadata (M30/H11).
-- Strictly additive; preserves 0001-0054 and enforces SoD, immutability, and legal entity isolation.

CREATE TABLE rticore_migration_0055_dependency(ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO rticore_migration_0055_dependency(ok)
SELECT CASE WHEN EXISTS(SELECT 1 FROM rticore_schema_migrations WHERE version=54) THEN 1 ELSE 0 END;
DROP TABLE rticore_migration_0055_dependency;

-- 1. Cyber Threat Intelligence Cases & IOC Management (M14)
CREATE TABLE rticore_cti_cases (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 customer_id TEXT,
 case_code TEXT NOT NULL CHECK(length(case_code) BETWEEN 4 AND 64),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 5 AND 200),
 request_type TEXT NOT NULL CHECK(request_type IN ('intelligence_request','threat_monitoring','ioc_investigation','brand_monitoring','darkweb_advisory','vulnerability_intel')),
 tlp_classification TEXT NOT NULL DEFAULT 'TLP:AMBER' CHECK(tlp_classification IN ('TLP:CLEAR','TLP:GREEN','TLP:AMBER','TLP:AMBER+STRICT','TLP:RED')),
 severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low','medium','high','critical')),
 assigned_analyst_email TEXT COLLATE NOCASE,
 workload_hours_hundredths INTEGER NOT NULL DEFAULT 0 CHECK(workload_hours_hundredths >= 0),
 report_summary TEXT,
 status TEXT NOT NULL DEFAULT 'intake' CHECK(status IN ('intake','monitoring','analyzing','qa_review','disseminated','closed')),
 created_by TEXT NOT NULL COLLATE NOCASE,
 reviewed_by TEXT COLLATE NOCASE,
 disseminated_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, case_code),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by) != lower(created_by))
);
CREATE INDEX idx_rticore_cti_cases_entity ON rticore_cti_cases(tenant_id, legal_entity_id, status, severity);
CREATE TRIGGER rticore_cti_cases_no_delete BEFORE DELETE ON rticore_cti_cases
BEGIN SELECT RAISE(ABORT,'CTI_CASE_IMMUTABLE'); END;

CREATE TABLE rticore_cti_iocs (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 cti_case_id TEXT NOT NULL,
 ioc_type TEXT NOT NULL CHECK(ioc_type IN ('ipv4','ipv6','domain','url','sha256','md5','cve','email','yara')),
 indicator_value TEXT NOT NULL CHECK(length(indicator_value) BETWEEN 3 AND 512),
 confidence_score INTEGER NOT NULL DEFAULT 75 CHECK(confidence_score BETWEEN 0 AND 100),
 tlp_classification TEXT NOT NULL DEFAULT 'TLP:AMBER' CHECK(tlp_classification IN ('TLP:CLEAR','TLP:GREEN','TLP:AMBER','TLP:AMBER+STRICT','TLP:RED')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_by TEXT NOT NULL COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, cti_case_id, ioc_type, indicator_value),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, cti_case_id) REFERENCES rticore_cti_cases(tenant_id, id)
);

-- 2. GRC & Consulting Services Engagements (M15)
CREATE TABLE rticore_grc_engagements (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 customer_id TEXT,
 project_id TEXT,
 engagement_code TEXT NOT NULL CHECK(length(engagement_code) BETWEEN 4 AND 64),
 framework TEXT NOT NULL CHECK(framework IN ('ISO_27001','UU_PDP','OJK_POJK','BI_PBI','NIST_CSF','PCI_DSS','COBIT','IT_RISK','SECURITY_ARCH','CUSTOM')),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 5 AND 200),
 total_controls INTEGER NOT NULL DEFAULT 0 CHECK(total_controls >= 0),
 compliant_controls INTEGER NOT NULL DEFAULT 0 CHECK(compliant_controls >= 0),
 open_gaps INTEGER NOT NULL DEFAULT 0 CHECK(open_gaps >= 0),
 audit_readiness_bps INTEGER NOT NULL DEFAULT 0 CHECK(audit_readiness_bps BETWEEN 0 AND 10000),
 roadmap_summary TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'assessment' CHECK(status IN ('assessment','gap_analysis','policy_dev','remediation','audit_ready','closed')),
 lead_consultant_email TEXT NOT NULL COLLATE NOCASE,
 created_by TEXT NOT NULL COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, engagement_code),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(compliant_controls <= total_controls)
);
CREATE TRIGGER rticore_grc_eng_no_delete BEFORE DELETE ON rticore_grc_engagements
BEGIN SELECT RAISE(ABORT,'GRC_ENGAGEMENT_IMMUTABLE'); END;

-- 3. Enterprise Risk & Internal Control Register (M27)
CREATE TABLE rticore_enterprise_risk_register (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 risk_code TEXT NOT NULL CHECK(length(risk_code) BETWEEN 3 AND 48),
 risk_domain TEXT NOT NULL CHECK(risk_domain IN ('strategic','financial','operational','cybersecurity','compliance','third_party','business_continuity')),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 5 AND 200),
 description TEXT NOT NULL CHECK(length(description) BETWEEN 12 AND 2000),
 inherent_likelihood INTEGER NOT NULL CHECK(inherent_likelihood BETWEEN 1 AND 5),
 inherent_impact INTEGER NOT NULL CHECK(inherent_impact BETWEEN 1 AND 5),
 residual_likelihood INTEGER NOT NULL CHECK(residual_likelihood BETWEEN 1 AND 5),
 residual_impact INTEGER NOT NULL CHECK(residual_impact BETWEEN 1 AND 5),
 kri_metric TEXT,
 kri_threshold TEXT,
 risk_owner_email TEXT NOT NULL COLLATE NOCASE,
 remediation_plan TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','mitigating','accepted','remediated','closed')),
 created_by TEXT NOT NULL COLLATE NOCASE,
 reviewed_by TEXT COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, risk_code),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by) != lower(risk_owner_email))
);
CREATE TRIGGER rticore_ent_risk_no_delete BEFORE DELETE ON rticore_enterprise_risk_register
BEGIN SELECT RAISE(ABORT,'ENTERPRISE_RISK_IMMUTABLE'); END;

CREATE TABLE rticore_enterprise_control_register (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 risk_id TEXT,
 control_code TEXT NOT NULL CHECK(length(control_code) BETWEEN 3 AND 48),
 regulatory_ref TEXT NOT NULL DEFAULT 'ISO_27001',
 title TEXT NOT NULL CHECK(length(title) BETWEEN 5 AND 200),
 control_type TEXT NOT NULL CHECK(control_type IN ('preventive','detective','corrective')),
 control_owner_email TEXT NOT NULL COLLATE NOCASE,
 assessment_status TEXT NOT NULL DEFAULT 'not_tested' CHECK(assessment_status IN ('not_tested','effective','partially_effective','ineffective')),
 tested_by TEXT COLLATE NOCASE,
 tested_at TEXT,
 test_notes TEXT,
 created_by TEXT NOT NULL COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, control_code),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(tested_by IS NULL OR lower(tested_by) != lower(control_owner_email))
);
CREATE TRIGGER rticore_ent_ctrl_no_delete BEFORE DELETE ON rticore_enterprise_control_register
BEGIN SELECT RAISE(ABORT,'ENTERPRISE_CONTROL_IMMUTABLE'); END;

-- 4. Durable Background Job Queue (M30 / H08 Hostinger Compatible)
CREATE TABLE rticore_background_jobs (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT,
 job_type TEXT NOT NULL CHECK(job_type IN (
  'finance_outbox_dispatch','flexguard_expiry_scan','sla_breach_monitor',
  'sales_activity_sla','backup_verification','report_generation','renewal_signal_scan'
 )),
 idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 160),
 payload_json TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','dead_letter')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
 max_attempts INTEGER NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 20),
 next_run_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 locked_by TEXT,
 last_error TEXT,
 completed_at TEXT,
 created_by TEXT NOT NULL COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, idempotency_key)
);
CREATE INDEX idx_rticore_bg_jobs_poll ON rticore_background_jobs(tenant_id, status, next_run_at);

-- 5. Backup & Disaster Recovery Drill Evidence (M30 / H11)
CREATE TABLE rticore_backup_drills (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 environment_name TEXT NOT NULL CHECK(environment_name IN ('local_rehearsal','staging','production')),
 backup_kind TEXT NOT NULL CHECK(backup_kind IN ('postgresql_logical','postgresql_pitr','sqlite_rehearsal','document_vault')),
 encrypted INTEGER NOT NULL DEFAULT 1 CHECK(encrypted IN (0,1)),
 sha256_checksum TEXT NOT NULL CHECK(length(sha256_checksum) = 64),
 rpo_minutes INTEGER NOT NULL CHECK(rpo_minutes >= 0),
 rto_minutes INTEGER NOT NULL CHECK(rto_minutes >= 0),
 restore_verified INTEGER NOT NULL DEFAULT 0 CHECK(restore_verified IN (0,1)),
 reconciliation_passed INTEGER NOT NULL DEFAULT 0 CHECK(reconciliation_passed IN (0,1)),
 notes TEXT NOT NULL CHECK(length(notes) BETWEEN 12 AND 1000),
 executed_by TEXT NOT NULL COLLATE NOCASE,
 verified_by TEXT COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 CHECK(verified_by IS NULL OR lower(verified_by) != lower(executed_by)),
 CHECK(restore_verified = 0 OR verified_by IS NOT NULL)
);
CREATE TRIGGER rticore_backup_drills_no_delete BEFORE DELETE ON rticore_backup_drills
BEGIN SELECT RAISE(ABORT,'BACKUP_DRILL_IMMUTABLE'); END;

INSERT INTO rticore_schema_file_manifest(path, source_branch)
VALUES('migrations/0055_enterprise_cyber_grc_cti_bi_ops.sql', 'feature/hostinger-finance-docking');
INSERT INTO rticore_schema_migrations(version) VALUES(55);
