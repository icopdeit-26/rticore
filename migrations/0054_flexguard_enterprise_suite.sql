-- RTICORE canonical migration 0054: FlexGuard Enterprise Service Credit Management System (M09).
-- Extends 0030 immutable wallet/events and 0052 Finance valuation without breaking existing tables.
-- Supports Package Builder, Versioned Conversion Matrix, Credit Lots, 12-Type Immutable Enterprise Ledger,
-- 14-Step Service Request Workflow, SLA Events, and Customer Portal Scoped Access.

CREATE TABLE rticore_migration_0054_dependency(ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO rticore_migration_0054_dependency(ok)
SELECT CASE WHEN EXISTS(SELECT 1 FROM rticore_schema_migrations WHERE version=53) THEN 1 ELSE 0 END;
DROP TABLE rticore_migration_0054_dependency;

-- 1. Configurable FlexGuard Package Builder (Section 7.1 & 7.2)
CREATE TABLE rticore_flexguard_packages (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 package_code TEXT NOT NULL CHECK(length(package_code) BETWEEN 3 AND 48),
 package_name TEXT NOT NULL CHECK(length(package_name) BETWEEN 3 AND 160),
 billing_model TEXT NOT NULL CHECK(billing_model IN (
  'prepaid_mandays','postpaid_mandays','annual_credits','monthly_allocation',
  'quarterly_allocation','retainer','committed_capacity','hybrid_subscription'
 )),
 credit_pool_mode TEXT NOT NULL DEFAULT 'shared_pool' CHECK(credit_pool_mode IN ('shared_pool','service_specific','multi_entity_contract')),
 credits_included INTEGER NOT NULL CHECK(credits_included BETWEEN 1 AND 1000000),
 unit_credit_price_cents INTEGER NOT NULL CHECK(unit_credit_price_cents > 0),
 package_price_cents INTEGER NOT NULL CHECK(package_price_cents > 0),
 validity_days INTEGER NOT NULL DEFAULT 365 CHECK(validity_days BETWEEN 30 AND 1825),
 carry_forward_allowed INTEGER NOT NULL DEFAULT 0 CHECK(carry_forward_allowed IN (0,1)),
 carry_forward_max_bps INTEGER NOT NULL DEFAULT 0 CHECK(carry_forward_max_bps BETWEEN 0 AND 10000),
 emergency_reserve_credits INTEGER NOT NULL DEFAULT 0 CHECK(emergency_reserve_credits >= 0),
 overdraft_limit_credits INTEGER NOT NULL DEFAULT 0 CHECK(overdraft_limit_credits >= 0),
 sla_ack_hours INTEGER NOT NULL DEFAULT 4 CHECK(sla_ack_hours BETWEEN 1 AND 168),
 sla_mobilize_hours INTEGER NOT NULL DEFAULT 24 CHECK(sla_mobilize_hours BETWEEN 1 AND 720),
 sla_delivery_hours INTEGER NOT NULL DEFAULT 120 CHECK(sla_delivery_hours BETWEEN 4 AND 4320),
 eligible_services_json TEXT NOT NULL DEFAULT '[]',
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','superseded','retired')),
 created_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 approval_notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, package_code, version),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(created_by)),
 CHECK(status != 'approved' OR (approved_by IS NOT NULL AND coalesce(length(approval_notes), 0) >= 12))
);
CREATE TRIGGER rticore_fg_pkg_no_delete BEFORE DELETE ON rticore_flexguard_packages
BEGIN SELECT RAISE(ABORT,'FLEXGUARD_PACKAGE_IMMUTABLE'); END;

-- 2. Versioned Service Credit Conversion Matrix (Section 7.3)
CREATE TABLE rticore_flexguard_conversion_matrix (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 contract_id TEXT NOT NULL,
 contract_version INTEGER NOT NULL DEFAULT 1 CHECK(contract_version > 0),
 service_tier TEXT NOT NULL CHECK(service_tier IN (
  'standard_analyst','senior_specialist','lead_specialist',
  'principal_consultant','emergency_response','specialized_forensic','custom'
 )),
 service_category TEXT,
 multiplier_bps INTEGER NOT NULL CHECK(multiplier_bps BETWEEN 5000 AND 50000),
 effective_from TEXT NOT NULL,
 effective_to TEXT,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','superseded')),
 created_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 approval_notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, contract_id, contract_version, service_tier),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(created_by))
);
CREATE TRIGGER rticore_fg_conv_no_delete BEFORE DELETE ON rticore_flexguard_conversion_matrix
BEGIN SELECT RAISE(ABORT,'FLEXGUARD_CONVERSION_IMMUTABLE'); END;

-- 3. FlexGuard Credit Lots (Expiry, Carry-Forward & Overdraft Control — Section 7.4 & 7.5)
CREATE TABLE rticore_flexguard_credit_lots (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 customer_id TEXT NOT NULL,
 contract_id TEXT NOT NULL,
 wallet_id TEXT NOT NULL,
 lot_code TEXT NOT NULL CHECK(length(lot_code) BETWEEN 3 AND 64),
 lot_kind TEXT NOT NULL CHECK(lot_kind IN ('initial_allocation','purchase','top_up','carry_forward','emergency_reserve')),
 credits_total INTEGER NOT NULL CHECK(credits_total > 0),
 unit_value_cents INTEGER NOT NULL CHECK(unit_value_cents > 0),
 overdraft_limit_credits INTEGER NOT NULL DEFAULT 0 CHECK(overdraft_limit_credits >= 0),
 carry_forward_cap_credits INTEGER NOT NULL DEFAULT 0 CHECK(carry_forward_cap_credits >= 0),
 issued_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','depleted','expired','carried_forward')),
 created_by TEXT NOT NULL COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, wallet_id, lot_code),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, customer_id) REFERENCES rticore_sales_accounts(tenant_id, id),
 CHECK(expires_at >= issued_at)
);
CREATE INDEX idx_rticore_fg_lots_wallet ON rticore_flexguard_credit_lots(tenant_id, legal_entity_id, wallet_id, expires_at);
CREATE TRIGGER rticore_fg_lots_no_delete BEFORE DELETE ON rticore_flexguard_credit_lots
BEGIN SELECT RAISE(ABORT,'FLEXGUARD_LOT_IMMUTABLE'); END;

-- 4. FlexGuard Enterprise 12-Type Immutable Credit Ledger (Section 7.4 & 7.5)
CREATE TABLE rticore_flexguard_enterprise_ledger (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 customer_id TEXT NOT NULL,
 contract_id TEXT NOT NULL,
 wallet_id TEXT NOT NULL,
 lot_id TEXT,
 service_request_id TEXT,
 transaction_type TEXT NOT NULL CHECK(transaction_type IN (
  'initial_allocation','purchase','top_up','reservation','reservation_release',
  'consumption','adjustment','reversal','transfer','carry_forward','expiry','refund'
 )),
 credit_amount INTEGER NOT NULL CHECK(credit_amount != 0 AND credit_amount BETWEEN -1000000 AND 1000000),
 actual_mandays_tenths INTEGER NOT NULL DEFAULT 0 CHECK(actual_mandays_tenths >= 0),
 billable_mandays_tenths INTEGER NOT NULL DEFAULT 0 CHECK(billable_mandays_tenths >= 0),
 multiplier_bps INTEGER NOT NULL DEFAULT 10000 CHECK(multiplier_bps BETWEEN 5000 AND 50000),
 financial_value_cents INTEGER NOT NULL DEFAULT 0 CHECK(financial_value_cents >= 0),
 source_tx_id TEXT,
 reference_code TEXT NOT NULL CHECK(length(reference_code) BETWEEN 3 AND 128),
 idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 12 AND 128),
 actor_email TEXT NOT NULL COLLATE NOCASE,
 approval_status TEXT NOT NULL DEFAULT 'posted' CHECK(approval_status IN ('pending_approval','posted','rejected')),
 approved_by TEXT COLLATE NOCASE,
 approved_at TEXT,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 12 AND 1000),
 finance_outbox_event_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, idempotency_key),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, customer_id) REFERENCES rticore_sales_accounts(tenant_id, id),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(actor_email)),
 CHECK(transaction_type != 'adjustment' OR approval_status = 'pending_approval' OR approved_by IS NOT NULL)
);
CREATE INDEX idx_rticore_fg_ent_ledger_wallet ON rticore_flexguard_enterprise_ledger(tenant_id, legal_entity_id, wallet_id, created_at);
CREATE TRIGGER rticore_fg_ent_ledger_no_delete BEFORE DELETE ON rticore_flexguard_enterprise_ledger
BEGIN SELECT RAISE(ABORT,'FLEXGUARD_ENTERPRISE_LEDGER_IMMUTABLE'); END;
CREATE TRIGGER rticore_fg_ent_ledger_no_tamper BEFORE UPDATE ON rticore_flexguard_enterprise_ledger
WHEN OLD.approval_status != 'pending_approval'
 OR NEW.id != OLD.id OR NEW.tenant_id != OLD.tenant_id OR NEW.legal_entity_id != OLD.legal_entity_id
 OR NEW.wallet_id != OLD.wallet_id OR NEW.customer_id != OLD.customer_id OR NEW.credit_amount != OLD.credit_amount
 OR NEW.transaction_type != OLD.transaction_type OR NEW.idempotency_key != OLD.idempotency_key
 OR lower(NEW.actor_email) != lower(OLD.actor_email)
 OR (NEW.approval_status = 'posted' AND (NEW.approved_by IS NULL OR lower(NEW.approved_by) = lower(OLD.actor_email)))
BEGIN SELECT RAISE(ABORT,'FLEXGUARD_ENTERPRISE_LEDGER_IMMUTABLE'); END;

-- 5. FlexGuard 14-Step Service Request Workflow (Section 7.6)
CREATE TABLE rticore_flexguard_service_requests (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 customer_id TEXT NOT NULL,
 contract_id TEXT NOT NULL,
 contract_version INTEGER NOT NULL DEFAULT 1 CHECK(contract_version > 0),
 wallet_id TEXT NOT NULL,
 request_number TEXT NOT NULL CHECK(length(request_number) BETWEEN 4 AND 64),
 service_category TEXT NOT NULL,
 service_tier TEXT NOT NULL DEFAULT 'standard_analyst',
 title TEXT NOT NULL CHECK(length(title) BETWEEN 5 AND 200),
 scope_description TEXT NOT NULL CHECK(length(scope_description) BETWEEN 12 AND 3000),
 emergency_flag INTEGER NOT NULL DEFAULT 0 CHECK(emergency_flag IN (0,1)),
 priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','emergency')),
 status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN (
  'submitted','scope_validated','estimated','credit_quoted','customer_approved',
  'credits_reserved','resource_assigned','in_execution','timesheet_approved',
  'qa_passed','customer_accepted','consumed','reconciled',
  'revision_requested','cancelled','disputed','additional_credit_pending'
 )),
 estimated_mandays_tenths INTEGER NOT NULL DEFAULT 0 CHECK(estimated_mandays_tenths >= 0),
 estimated_credits INTEGER NOT NULL DEFAULT 0 CHECK(estimated_credits >= 0),
 reserved_credits INTEGER NOT NULL DEFAULT 0 CHECK(reserved_credits >= 0),
 reservation_tx_id TEXT,
 assigned_resource_email TEXT COLLATE NOCASE,
 actual_mandays_tenths INTEGER NOT NULL DEFAULT 0 CHECK(actual_mandays_tenths >= 0),
 multiplier_bps INTEGER NOT NULL DEFAULT 10000 CHECK(multiplier_bps BETWEEN 5000 AND 50000),
 consumed_credits INTEGER NOT NULL DEFAULT 0 CHECK(consumed_credits >= 0),
 additional_credits_requested INTEGER NOT NULL DEFAULT 0 CHECK(additional_credits_requested >= 0),
 additional_credits_approved_by TEXT COLLATE NOCASE,
 deliverable_document_id TEXT,
 internal_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(internal_cost_cents >= 0),
 customer_accepted_by TEXT COLLATE NOCASE,
 customer_accepted_at TEXT,
 sla_ack_due_at TEXT,
 sla_ack_at TEXT,
 sla_mobilize_due_at TEXT,
 sla_mobilize_at TEXT,
 sla_delivery_due_at TEXT,
 sla_completed_at TEXT,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
 requested_by TEXT NOT NULL COLLATE NOCASE,
 updated_by TEXT NOT NULL COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, request_number),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, customer_id) REFERENCES rticore_sales_accounts(tenant_id, id)
);
CREATE INDEX idx_rticore_fg_sr_customer ON rticore_flexguard_service_requests(tenant_id, legal_entity_id, customer_id, status);
CREATE TRIGGER rticore_fg_sr_no_delete BEFORE DELETE ON rticore_flexguard_service_requests
BEGIN SELECT RAISE(ABORT,'FLEXGUARD_SERVICE_REQUEST_IMMUTABLE'); END;

-- 6. FlexGuard SLA Events & Escalation Tracking (Section 7.8)
CREATE TABLE rticore_flexguard_sla_events (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 service_request_id TEXT NOT NULL,
 sla_stage TEXT NOT NULL CHECK(sla_stage IN ('acknowledgment','scope_assessment','mobilization','delivery','emergency_response')),
 target_hours INTEGER NOT NULL CHECK(target_hours > 0),
 actual_hours_hundredths INTEGER NOT NULL CHECK(actual_hours_hundredths >= 0),
 breached INTEGER NOT NULL DEFAULT 0 CHECK(breached IN (0,1)),
 escalated_to TEXT COLLATE NOCASE,
 remedy_credits INTEGER NOT NULL DEFAULT 0 CHECK(remedy_credits >= 0),
 notes TEXT NOT NULL CHECK(length(notes) BETWEEN 8 AND 1000),
 recorded_by TEXT NOT NULL COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, service_request_id) REFERENCES rticore_flexguard_service_requests(tenant_id, id)
);
CREATE TRIGGER rticore_fg_sla_no_delete BEFORE DELETE ON rticore_flexguard_sla_events
BEGIN SELECT RAISE(ABORT,'FLEXGUARD_SLA_IMMUTABLE'); END;

-- 7. FlexGuard Customer Portal Scoped Access Grants (Section 7.7)
CREATE TABLE rticore_flexguard_portal_grants (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 customer_id TEXT NOT NULL,
 portal_email TEXT NOT NULL COLLATE NOCASE,
 portal_role TEXT NOT NULL CHECK(portal_role IN ('customer_admin','customer_user')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 approval_notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, customer_id, portal_email),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, customer_id) REFERENCES rticore_sales_accounts(tenant_id, id),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(created_by))
);
CREATE TRIGGER rticore_fg_portal_no_delete BEFORE DELETE ON rticore_flexguard_portal_grants
BEGIN SELECT RAISE(ABORT,'FLEXGUARD_PORTAL_GRANT_IMMUTABLE'); END;

INSERT INTO rticore_schema_file_manifest(path, source_branch)
VALUES('migrations/0054_flexguard_enterprise_suite.sql', 'feature/hostinger-finance-docking');
INSERT INTO rticore_schema_migrations(version) VALUES(54);
