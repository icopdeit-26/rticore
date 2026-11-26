-- RTICORE canonical migration 0056: VAPT Operations (M11), SOC/MDR SLA & Profitability (M12),
-- and DFIR Incident Response & Immutable Chain of Custody (M13).
-- Strictly additive; preserves 0001-0055 with integer minor units, legal entity isolation, and SoD.

CREATE TABLE rticore_migration_0056_dependency(ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO rticore_migration_0056_dependency(ok)
SELECT CASE WHEN EXISTS(SELECT 1 FROM rticore_schema_migrations WHERE version=55) THEN 1 ELSE 0 END;
DROP TABLE rticore_migration_0056_dependency;

-- 1. VAPT Engagement Lifecycle, Rules of Engagement & Authorization (M11)
CREATE TABLE rticore_vapt_engagements (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 customer_id TEXT,
 project_id TEXT,
 engagement_code TEXT NOT NULL CHECK(length(engagement_code) BETWEEN 4 AND 64),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 5 AND 200),
 test_type TEXT NOT NULL CHECK(test_type IN ('web_app','mobile_app','api','network','cloud','active_directory','wireless','red_team','purple_team','source_code')),
 scope_assets_json TEXT NOT NULL DEFAULT '[]',
 roe_document_id TEXT,
 authorization_approved_by TEXT COLLATE NOCASE,
 authorization_notes TEXT,
 window_start TEXT NOT NULL,
 window_end TEXT NOT NULL,
 lead_pentester_email TEXT NOT NULL COLLATE NOCASE,
 assigned_testers_json TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL DEFAULT 'registered' CHECK(status IN (
  'registered','scope_validated','roe_approved','scheduled','testing',
  'qa_review','retest','report_delivered','customer_accepted','closed'
 )),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
 created_by TEXT NOT NULL COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, engagement_code),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(window_end >= window_start),
 CHECK(authorization_approved_by IS NULL OR lower(authorization_approved_by) != lower(created_by)),
 CHECK(status NOT IN ('roe_approved','scheduled','testing','qa_review','retest','report_delivered','customer_accepted','closed')
   OR (authorization_approved_by IS NOT NULL AND coalesce(length(authorization_notes), 0) >= 12))
);
CREATE INDEX idx_rticore_vapt_eng_entity ON rticore_vapt_engagements(tenant_id, legal_entity_id, status);
CREATE TRIGGER rticore_vapt_eng_no_delete BEFORE DELETE ON rticore_vapt_engagements
BEGIN SELECT RAISE(ABORT,'VAPT_ENGAGEMENT_IMMUTABLE'); END;

-- 2. VAPT Findings, CVSS Scoring, QA & Retest Verification (M11)
CREATE TABLE rticore_vapt_findings (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 engagement_id TEXT NOT NULL,
 finding_code TEXT NOT NULL CHECK(length(finding_code) BETWEEN 3 AND 48),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 5 AND 200),
 severity TEXT NOT NULL CHECK(severity IN ('info','low','medium','high','critical')),
 cvss_score_tenths INTEGER NOT NULL CHECK(cvss_score_tenths BETWEEN 0 AND 100),
 cwe_owasp_ref TEXT NOT NULL DEFAULT 'OWASP-TOP10',
 affected_asset TEXT NOT NULL CHECK(length(affected_asset) BETWEEN 3 AND 250),
 evidence_document_id TEXT,
 remediation_guidance TEXT NOT NULL CHECK(length(remediation_guidance) BETWEEN 12 AND 3000),
 retest_status TEXT NOT NULL DEFAULT 'open' CHECK(retest_status IN ('open','qa_approved','retest_requested','verified_fixed','still_vulnerable','risk_accepted')),
 created_by TEXT NOT NULL COLLATE NOCASE,
 qa_reviewed_by TEXT COLLATE NOCASE,
 qa_notes TEXT,
 retested_by TEXT COLLATE NOCASE,
 retest_notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, engagement_id, finding_code),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, engagement_id) REFERENCES rticore_vapt_engagements(tenant_id, id),
 CHECK(qa_reviewed_by IS NULL OR lower(qa_reviewed_by) != lower(created_by))
);
CREATE INDEX idx_rticore_vapt_find_eng ON rticore_vapt_findings(tenant_id, engagement_id, severity, retest_status);
CREATE TRIGGER rticore_vapt_find_no_delete BEFORE DELETE ON rticore_vapt_findings
BEGIN SELECT RAISE(ABORT,'VAPT_FINDING_IMMUTABLE'); END;

-- 3. DFIR Incident Response & Emergency Activation (M13)
CREATE TABLE rticore_dfir_incidents (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 customer_id TEXT,
 flexguard_request_id TEXT,
 incident_code TEXT NOT NULL CHECK(length(incident_code) BETWEEN 4 AND 64),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 5 AND 200),
 severity TEXT NOT NULL CHECK(severity IN ('sev1_critical','sev2_high','sev3_medium','sev4_low')),
 incident_commander_email TEXT NOT NULL COLLATE NOCASE,
 activated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 contained_at TEXT,
 recovered_at TEXT,
 emergency_mandays_tenths INTEGER NOT NULL DEFAULT 0 CHECK(emergency_mandays_tenths >= 0),
 post_incident_summary TEXT,
 status TEXT NOT NULL DEFAULT 'intake' CHECK(status IN ('intake','activated','investigating','contained','recovering','post_incident_review','closed')),
 created_by TEXT NOT NULL COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, incident_code),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id)
);
CREATE TRIGGER rticore_dfir_inc_no_delete BEFORE DELETE ON rticore_dfir_incidents
BEGIN SELECT RAISE(ABORT,'DFIR_INCIDENT_IMMUTABLE'); END;

-- 4. Immutable Forensic Evidence Chain of Custody (M13)
CREATE TABLE rticore_dfir_chain_of_custody (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 incident_id TEXT NOT NULL,
 evidence_tag TEXT NOT NULL CHECK(length(evidence_tag) BETWEEN 3 AND 64),
 evidence_description TEXT NOT NULL CHECK(length(evidence_description) BETWEEN 8 AND 500),
 sha256_hash TEXT NOT NULL CHECK(length(sha256_hash) = 64),
 custody_action TEXT NOT NULL CHECK(custody_action IN ('collected','transferred','analyzed','sealed','returned','archived')),
 actor_email TEXT NOT NULL COLLATE NOCASE,
 custodian_to_email TEXT COLLATE NOCASE,
 storage_location TEXT NOT NULL CHECK(length(storage_location) BETWEEN 3 AND 200),
 notes TEXT NOT NULL CHECK(length(notes) BETWEEN 8 AND 1000),
 recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, incident_id) REFERENCES rticore_dfir_incidents(tenant_id, id)
);
CREATE TRIGGER rticore_dfir_coc_no_update BEFORE UPDATE ON rticore_dfir_chain_of_custody
BEGIN SELECT RAISE(ABORT,'DFIR_CHAIN_OF_CUSTODY_IMMUTABLE'); END;
CREATE TRIGGER rticore_dfir_coc_no_delete BEFORE DELETE ON rticore_dfir_chain_of_custody
BEGIN SELECT RAISE(ABORT,'DFIR_CHAIN_OF_CUSTODY_IMMUTABLE'); END;

-- 5. SOC/MDR Monthly Operational SLA & Subscription Profitability (M12)
CREATE TABLE rticore_soc_sla_metrics (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 customer_id TEXT,
 period_code TEXT NOT NULL,
 monitored_assets INTEGER NOT NULL CHECK(monitored_assets >= 0),
 active_use_cases INTEGER NOT NULL CHECK(active_use_cases >= 0),
 alerts_triaged INTEGER NOT NULL CHECK(alerts_triaged >= 0),
 incidents_escalated INTEGER NOT NULL CHECK(incidents_escalated >= 0),
 mttd_minutes INTEGER NOT NULL CHECK(mttd_minutes >= 0),
 mttr_minutes INTEGER NOT NULL CHECK(mttr_minutes >= 0),
 sla_compliance_bps INTEGER NOT NULL CHECK(sla_compliance_bps BETWEEN 0 AND 10000),
 subscription_revenue_cents INTEGER NOT NULL DEFAULT 0 CHECK(subscription_revenue_cents >= 0),
 direct_soc_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(direct_soc_cost_cents >= 0),
 recorded_by TEXT NOT NULL COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, customer_id, period_code),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id)
);
CREATE TRIGGER rticore_soc_sla_no_delete BEFORE DELETE ON rticore_soc_sla_metrics
BEGIN SELECT RAISE(ABORT,'SOC_SLA_IMMUTABLE'); END;

INSERT INTO rticore_schema_file_manifest(path, source_branch)
VALUES('migrations/0056_vapt_dfir_soc_sla_enterprise.sql', 'feature/hostinger-finance-docking');
INSERT INTO rticore_schema_migrations(version) VALUES(56);
