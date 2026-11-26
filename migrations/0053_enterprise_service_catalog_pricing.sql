-- RTICORE canonical migration 0053: Enterprise Foundation (Feature Flags),
-- Service Catalog V4 (29+ categories, 12-phase Activity Modeling, Complexity Matrix),
-- Unified 19-Role Resource Rate Cards & Enterprise Service Pricing Intelligence Engine.
-- Strictly additive; preserves 0001-0052 and enforces integer minor units (_cents, _bps, _tenths).

CREATE TABLE rticore_migration_0053_dependency(ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO rticore_migration_0053_dependency(ok)
SELECT CASE WHEN EXISTS(SELECT 1 FROM rticore_schema_migrations WHERE version=52) THEN 1 ELSE 0 END;
DROP TABLE rticore_migration_0053_dependency;

-- 1. Feature Flags with Maker-Checker Governance (M30 / Principle 20)
CREATE TABLE rticore_feature_flags (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT,
 flag_key TEXT NOT NULL CHECK(length(flag_key) BETWEEN 3 AND 96),
 description TEXT NOT NULL CHECK(length(description) BETWEEN 8 AND 500),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 rollout_scope TEXT NOT NULL DEFAULT 'disabled' CHECK(rollout_scope IN ('disabled','staging_only','entity_pilot','all_certified')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','revoked')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
 requested_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 approval_notes TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, flag_key, legal_entity_id),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(requested_by)),
 CHECK(enabled = 0 OR (status = 'active' AND approved_by IS NOT NULL AND coalesce(length(approval_notes), 0) >= 12))
);
CREATE INDEX idx_rticore_feature_flags_lookup ON rticore_feature_flags(tenant_id, flag_key, status);
CREATE TRIGGER rticore_feature_flags_no_delete BEFORE DELETE ON rticore_feature_flags
BEGIN SELECT RAISE(ABORT,'FEATURE_FLAG_IMMUTABLE'); END;

-- 2. Enterprise Service Catalog Master V4 (M05)
CREATE TABLE rticore_service_catalog_v2 (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 service_code TEXT NOT NULL CHECK(length(service_code) BETWEEN 3 AND 48),
 service_name TEXT NOT NULL CHECK(length(service_name) BETWEEN 3 AND 160),
 service_category TEXT NOT NULL CHECK(service_category IN (
  'web_app_pentest','mobile_app_pentest','api_pentest','network_pentest',
  'infrastructure_assessment','cloud_security_assessment','active_directory_assessment',
  'wireless_security_assessment','red_team_assessment','purple_team_assessment',
  'vulnerability_assessment','source_code_review','soc_managed_services','mdr',
  'siem_implementation','digital_forensics','incident_response','cyber_threat_intelligence',
  'threat_hunting','grc_consulting','iso_27001_consulting','data_privacy_consulting',
  'it_risk_management','security_architecture_consulting','cybersecurity_awareness',
  'cybersecurity_training','security_tool_implementation','technology_professional_services',
  'other_configurable'
 )),
 service_owner_email TEXT NOT NULL COLLATE NOCASE,
 description TEXT NOT NULL CHECK(length(description) BETWEEN 8 AND 1000),
 scope_summary TEXT NOT NULL CHECK(length(scope_summary) BETWEEN 8 AND 2000),
 deliverables_json TEXT NOT NULL DEFAULT '[]',
 prerequisites TEXT NOT NULL DEFAULT '',
 exclusions TEXT NOT NULL DEFAULT '',
 unit_of_measurement TEXT NOT NULL DEFAULT 'engagement',
 complexity_level TEXT NOT NULL DEFAULT 'standard' CHECK(complexity_level IN ('basic','standard','medium','high','critical')),
 min_mandays_tenths INTEGER NOT NULL CHECK(min_mandays_tenths >= 5),
 standard_mandays_tenths INTEGER NOT NULL CHECK(standard_mandays_tenths >= min_mandays_tenths),
 max_mandays_tenths INTEGER NOT NULL CHECK(max_mandays_tenths >= standard_mandays_tenths),
 resource_requirements_json TEXT NOT NULL DEFAULT '[]',
 skill_requirements_json TEXT NOT NULL DEFAULT '[]',
 default_tool_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(default_tool_cost_cents >= 0),
 default_third_party_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(default_third_party_cost_cents >= 0),
 default_travel_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(default_travel_cost_cents >= 0),
 overhead_allocation_bps INTEGER NOT NULL DEFAULT 1500 CHECK(overhead_allocation_bps BETWEEN 0 AND 6000),
 target_gross_margin_bps INTEGER NOT NULL DEFAULT 3500 CHECK(target_gross_margin_bps BETWEEN 500 AND 8500),
 min_acceptable_margin_bps INTEGER NOT NULL DEFAULT 2000 CHECK(min_acceptable_margin_bps BETWEEN 0 AND target_gross_margin_bps),
 standard_sla_hours INTEGER NOT NULL DEFAULT 24 CHECK(standard_sla_hours BETWEEN 1 AND 2160),
 flexguard_eligible INTEGER NOT NULL DEFAULT 1 CHECK(flexguard_eligible IN (0,1)),
 effective_date TEXT NOT NULL,
 service_version INTEGER NOT NULL DEFAULT 1 CHECK(service_version > 0),
 lifecycle_status TEXT NOT NULL DEFAULT 'draft' CHECK(lifecycle_status IN ('draft','approved','superseded','retired')),
 created_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 approved_at TEXT,
 approval_notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, service_code, service_version),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(created_by)),
 CHECK(lifecycle_status != 'approved' OR (approved_by IS NOT NULL AND coalesce(length(approval_notes), 0) >= 12))
);
CREATE INDEX idx_rticore_svc_cat_v2_entity ON rticore_service_catalog_v2(tenant_id, legal_entity_id, service_category, lifecycle_status);
CREATE TRIGGER rticore_svc_cat_v2_no_delete BEFORE DELETE ON rticore_service_catalog_v2
BEGIN SELECT RAISE(ABORT,'SERVICE_CATALOG_IMMUTABLE'); END;

-- 3. Activity-Based 12-Phase Mandays Templates (M05 / Section 5.3)
CREATE TABLE rticore_service_activity_templates (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 service_id TEXT NOT NULL,
 phase_code TEXT NOT NULL CHECK(phase_code IN (
  'presales_assessment','scope_validation','preparation','kickoff',
  'technical_execution','analysis','quality_assurance','reporting',
  'presentation','retest','project_management','closure'
 )),
 phase_order INTEGER NOT NULL CHECK(phase_order BETWEEN 1 AND 12),
 activity_name TEXT NOT NULL CHECK(length(activity_name) BETWEEN 3 AND 160),
 resource_role TEXT NOT NULL,
 skill_level TEXT NOT NULL DEFAULT 'standard' CHECK(skill_level IN ('junior','standard','senior','lead','principal')),
 resource_count INTEGER NOT NULL DEFAULT 1 CHECK(resource_count BETWEEN 1 AND 50),
 standard_hours_per_unit_hundredths INTEGER NOT NULL CHECK(standard_hours_per_unit_hundredths BETWEEN 0 AND 100000),
 min_effort_hours_hundredths INTEGER NOT NULL DEFAULT 0 CHECK(min_effort_hours_hundredths >= 0),
 complexity_factor_bps INTEGER NOT NULL DEFAULT 10000 CHECK(complexity_factor_bps BETWEEN 5000 AND 30000),
 billable INTEGER NOT NULL DEFAULT 1 CHECK(billable IN (0,1)),
 depends_on_phase TEXT,
 created_by TEXT NOT NULL COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, service_id, phase_code),
 FOREIGN KEY(tenant_id, service_id) REFERENCES rticore_service_catalog_v2(tenant_id, id),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id)
);
CREATE INDEX idx_rticore_svc_act_tpl_service ON rticore_service_activity_templates(tenant_id, service_id, phase_order);

-- 4. Configurable Complexity Matrix (Section 5.4)
CREATE TABLE rticore_complexity_matrices (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 matrix_code TEXT NOT NULL CHECK(length(matrix_code) BETWEEN 3 AND 64),
 factor_group TEXT NOT NULL CHECK(factor_group IN ('tier','environment','regulatory','delivery','emergency')),
 factor_key TEXT NOT NULL CHECK(length(factor_key) BETWEEN 2 AND 64),
 label TEXT NOT NULL CHECK(length(label) BETWEEN 3 AND 160),
 multiplier_bps INTEGER NOT NULL CHECK(multiplier_bps BETWEEN 5000 AND 40000),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','superseded')),
 created_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 approval_notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, matrix_code, factor_key),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(created_by)),
 CHECK(status != 'approved' OR (approved_by IS NOT NULL AND coalesce(length(approval_notes), 0) >= 12))
);
CREATE TRIGGER rticore_complexity_no_delete BEFORE DELETE ON rticore_complexity_matrices
BEGIN SELECT RAISE(ABORT,'COMPLEXITY_MATRIX_IMMUTABLE'); END;

-- 5. Unified Enterprise 19-Role Resource Rate Card (Section 6.1 & 6.2)
CREATE TABLE rticore_enterprise_rate_cards (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 role_code TEXT NOT NULL CHECK(role_code IN (
  'junior_analyst','analyst','senior_analyst','consultant','senior_consultant',
  'specialist','lead_pentester','principal_consultant','soc_analyst_l1','soc_analyst_l2',
  'soc_analyst_l3','incident_responder','digital_forensic_specialist','threat_intelligence_analyst',
  'grc_consultant','project_manager','solution_architect','subject_matter_expert','external_associate'
 )),
 role_label TEXT NOT NULL CHECK(length(role_label) BETWEEN 3 AND 120),
 monthly_compensation_cents INTEGER NOT NULL CHECK(monthly_compensation_cents >= 0),
 benefit_allocation_cents INTEGER NOT NULL DEFAULT 0 CHECK(benefit_allocation_cents >= 0),
 employer_contrib_cents INTEGER NOT NULL DEFAULT 0 CHECK(employer_contrib_cents >= 0),
 allocated_expense_cents INTEGER NOT NULL DEFAULT 0 CHECK(allocated_expense_cents >= 0),
 annual_loaded_cost_cents INTEGER NOT NULL CHECK(annual_loaded_cost_cents > 0),
 available_working_days INTEGER NOT NULL DEFAULT 240 CHECK(available_working_days BETWEEN 100 AND 300),
 target_utilization_bps INTEGER NOT NULL DEFAULT 7500 CHECK(target_utilization_bps BETWEEN 3000 AND 9500),
 internal_cost_rate_cents INTEGER NOT NULL CHECK(internal_cost_rate_cents > 0),
 standard_selling_rate_cents INTEGER NOT NULL CHECK(standard_selling_rate_cents >= internal_cost_rate_cents),
 min_selling_rate_cents INTEGER NOT NULL CHECK(min_selling_rate_cents >= internal_cost_rate_cents AND min_selling_rate_cents <= standard_selling_rate_cents),
 overtime_multiplier_bps INTEGER NOT NULL DEFAULT 15000 CHECK(overtime_multiplier_bps BETWEEN 10000 AND 30000),
 emergency_multiplier_bps INTEGER NOT NULL DEFAULT 20000 CHECK(emergency_multiplier_bps BETWEEN 10000 AND 40000),
 effective_date TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','superseded')),
 created_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 approved_at TEXT,
 approval_notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, role_code, effective_date, version),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(created_by)),
 CHECK(status != 'approved' OR (approved_by IS NOT NULL AND coalesce(length(approval_notes), 0) >= 12))
);
CREATE INDEX idx_rticore_ent_rate_cards_active ON rticore_enterprise_rate_cards(tenant_id, legal_entity_id, role_code, status, effective_date);
CREATE TRIGGER rticore_ent_rate_cards_no_delete BEFORE DELETE ON rticore_enterprise_rate_cards
BEGIN SELECT RAISE(ABORT,'RATE_CARD_IMMUTABLE'); END;
CREATE TRIGGER rticore_ent_rate_cards_frozen_approved BEFORE UPDATE ON rticore_enterprise_rate_cards
WHEN OLD.status = 'approved' AND (
 NEW.internal_cost_rate_cents != OLD.internal_cost_rate_cents OR
 NEW.standard_selling_rate_cents != OLD.standard_selling_rate_cents OR
 NEW.min_selling_rate_cents != OLD.min_selling_rate_cents OR
 NEW.annual_loaded_cost_cents != OLD.annual_loaded_cost_cents
)
BEGIN SELECT RAISE(ABORT,'APPROVED_RATE_CARD_IMMUTABLE'); END;

-- 6. Enterprise Pricing Scenarios, Approvals & Immutable Quotation Snapshots (Section 6.3–6.6)
CREATE TABLE rticore_pricing_scenarios (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 opportunity_id TEXT,
 service_id TEXT,
 scenario_name TEXT NOT NULL CHECK(length(scenario_name) BETWEEN 3 AND 160),
 pricing_method TEXT NOT NULL CHECK(pricing_method IN (
  'cost_plus','target_margin','fixed_price','time_and_material','mandays_based',
  'subscription','retainer','tiered','volume_discount','bundle',
  'value_based','emergency_service','flexguard_credit','hybrid'
 )),
 currency_code TEXT NOT NULL DEFAULT 'IDR',
 working_hours_per_md INTEGER NOT NULL DEFAULT 8 CHECK(working_hours_per_md BETWEEN 4 AND 12),
 total_mandays_tenths INTEGER NOT NULL CHECK(total_mandays_tenths > 0),
 direct_labor_cost_cents INTEGER NOT NULL CHECK(direct_labor_cost_cents >= 0),
 tools_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(tools_cost_cents >= 0),
 license_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(license_cost_cents >= 0),
 travel_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(travel_cost_cents >= 0),
 third_party_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(third_party_cost_cents >= 0),
 other_direct_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(other_direct_cost_cents >= 0),
 total_direct_cost_cents INTEGER NOT NULL CHECK(total_direct_cost_cents >= 0),
 overhead_cents INTEGER NOT NULL DEFAULT 0 CHECK(overhead_cents >= 0),
 risk_contingency_cents INTEGER NOT NULL DEFAULT 0 CHECK(risk_contingency_cents >= 0),
 fully_loaded_cost_cents INTEGER NOT NULL CHECK(fully_loaded_cost_cents > 0),
 target_margin_bps INTEGER NOT NULL CHECK(target_margin_bps BETWEEN 0 AND 9000),
 discount_bps INTEGER NOT NULL DEFAULT 0 CHECK(discount_bps BETWEEN 0 AND 8000),
 gross_selling_price_cents INTEGER NOT NULL CHECK(gross_selling_price_cents > 0),
 net_selling_price_cents INTEGER NOT NULL CHECK(net_selling_price_cents >= fully_loaded_cost_cents),
 break_even_price_cents INTEGER NOT NULL CHECK(break_even_price_cents = fully_loaded_cost_cents),
 min_selling_price_cents INTEGER NOT NULL CHECK(min_selling_price_cents >= fully_loaded_cost_cents),
 direct_gross_margin_bps INTEGER NOT NULL,
 fully_loaded_margin_bps INTEGER NOT NULL CHECK(fully_loaded_margin_bps >= 0),
 tax_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(tax_amount_cents >= 0),
 flexguard_credits_equivalent INTEGER NOT NULL DEFAULT 0 CHECK(flexguard_credits_equivalent >= 0),
 approval_required_level TEXT NOT NULL DEFAULT 'none' CHECK(approval_required_level IN ('none','sales_manager','pricing_manager','finance_manager','director','ceo')),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected','converted_to_quotation')),
 inputs_json TEXT NOT NULL,
 created_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 approved_at TEXT,
 approval_notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(created_by)),
 CHECK(status NOT IN ('approved','converted_to_quotation') OR (approved_by IS NOT NULL AND coalesce(length(approval_notes), 0) >= 12))
);
CREATE INDEX idx_rticore_pricing_scenarios_entity ON rticore_pricing_scenarios(tenant_id, legal_entity_id, status, created_at);
CREATE TRIGGER rticore_pricing_scenarios_no_delete BEFORE DELETE ON rticore_pricing_scenarios
BEGIN SELECT RAISE(ABORT,'PRICING_SCENARIO_IMMUTABLE'); END;

CREATE TABLE rticore_pricing_snapshots (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 scenario_id TEXT NOT NULL,
 quotation_id TEXT,
 boq_id TEXT,
 snapshot_version INTEGER NOT NULL DEFAULT 1 CHECK(snapshot_version > 0),
 rate_card_snapshot_json TEXT NOT NULL,
 activity_breakdown_json TEXT NOT NULL,
 financial_summary_json TEXT NOT NULL,
 net_selling_price_cents INTEGER NOT NULL CHECK(net_selling_price_cents > 0),
 fully_loaded_cost_cents INTEGER NOT NULL CHECK(fully_loaded_cost_cents > 0),
 snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash) = 64),
 frozen_by TEXT NOT NULL COLLATE NOCASE,
 frozen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, scenario_id, snapshot_version),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, scenario_id) REFERENCES rticore_pricing_scenarios(tenant_id, id)
);
CREATE TRIGGER rticore_pricing_snapshots_no_update BEFORE UPDATE ON rticore_pricing_snapshots
BEGIN SELECT RAISE(ABORT,'PRICING_SNAPSHOT_IMMUTABLE'); END;
CREATE TRIGGER rticore_pricing_snapshots_no_delete BEFORE DELETE ON rticore_pricing_snapshots
BEGIN SELECT RAISE(ABORT,'PRICING_SNAPSHOT_IMMUTABLE'); END;

-- 7. Historical Learning Benchmarks (Section 5.5 — never auto-applies without approval)
CREATE TABLE rticore_historical_effort_benchmarks (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 service_id TEXT NOT NULL,
 project_id TEXT,
 planned_mandays_tenths INTEGER NOT NULL CHECK(planned_mandays_tenths > 0),
 actual_mandays_tenths INTEGER NOT NULL CHECK(actual_mandays_tenths > 0),
 estimated_cost_cents INTEGER NOT NULL CHECK(estimated_cost_cents > 0),
 actual_cost_cents INTEGER NOT NULL CHECK(actual_cost_cents > 0),
 estimated_margin_bps INTEGER NOT NULL,
 actual_margin_bps INTEGER NOT NULL,
 delivery_variance_bps INTEGER NOT NULL,
 retest_count INTEGER NOT NULL DEFAULT 0 CHECK(retest_count >= 0),
 scope_changes_count INTEGER NOT NULL DEFAULT 0 CHECK(scope_changes_count >= 0),
 recommended_mandays_tenths INTEGER NOT NULL CHECK(recommended_mandays_tenths > 0),
 calibration_status TEXT NOT NULL DEFAULT 'recommended' CHECK(calibration_status IN ('recommended','approved','dismissed')),
 recorded_by TEXT NOT NULL COLLATE NOCASE,
 reviewed_by TEXT COLLATE NOCASE,
 review_notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, service_id) REFERENCES rticore_service_catalog_v2(tenant_id, id),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by) != lower(recorded_by))
);
CREATE TRIGGER rticore_hist_bench_no_delete BEFORE DELETE ON rticore_historical_effort_benchmarks
BEGIN SELECT RAISE(ABORT,'HISTORICAL_BENCHMARK_IMMUTABLE'); END;

INSERT INTO rticore_schema_file_manifest(path, source_branch)
VALUES('migrations/0053_enterprise_service_catalog_pricing.sql', 'feature/hostinger-finance-docking');
INSERT INTO rticore_schema_migrations(version) VALUES(53);
