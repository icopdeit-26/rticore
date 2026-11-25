-- =============================================================================
-- Migration 0052: RTI FINANCE Enterprise Financial Management, Accounting,
-- Controlling & RTICore Docking System (WP01 - WP09 Additive Schema)
-- =============================================================================
-- Principles:
-- 1. 100% Additive: zero modifications to existing 0001-0051 tables or triggers.
-- 2. Monetary precision: all monetary values use integer minor units (_cents)
--    or basis points (_bps) / micro-rates (_micro). Zero floating-point balances.
-- 3. Strict Maker-Checker (SoD), immutability of posted records, and tenant/entity
--    isolation enforced at the database trigger level (SQLite/D1 & PostgreSQL).
-- =============================================================================

-- =============================================================================
-- WP01: FINANCIAL FOUNDATION, 18-ROLE RBAC & MASTER DATA (F02, F25)
-- =============================================================================

-- 1. Granular 18 Finance Roles & Tiered Approval Authority Assignment
CREATE TABLE rticore_finance_role_assignments (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 email TEXT NOT NULL COLLATE NOCASE,
 finance_role TEXT NOT NULL CHECK(finance_role IN (
  'super_admin','ceo','cfo','financial_controller','finance_manager',
  'accounting_officer','ar_officer','ap_officer','treasury_officer',
  'tax_officer','budget_officer','procurement_officer','project_manager',
  'business_unit_head','human_capital_officer','internal_auditor',
  'external_auditor','management_viewer'
 )),
 legal_entity_id TEXT NOT NULL,
 business_unit_id TEXT,
 department_id TEXT,
 approval_limit_cents INTEGER NOT NULL DEFAULT 0 CHECK(approval_limit_cents >= 0 AND approval_limit_cents < 9000000000000000),
 can_make INTEGER NOT NULL DEFAULT 0 CHECK(can_make IN (0,1)),
 can_check INTEGER NOT NULL DEFAULT 0 CHECK(can_check IN (0,1)),
 can_approve INTEGER NOT NULL DEFAULT 0 CHECK(can_approve IN (0,1)),
 can_post INTEGER NOT NULL DEFAULT 0 CHECK(can_post IN (0,1)),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','revoked')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
 requested_by TEXT NOT NULL COLLATE NOCASE,
 reviewed_by TEXT COLLATE NOCASE,
 review_notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_at TEXT,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, email, finance_role, legal_entity_id),
 FOREIGN KEY(email) REFERENCES rticore_members(email),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(reviewed_by IS NULL OR (lower(reviewed_by) != lower(requested_by) AND lower(reviewed_by) != lower(email))),
 CHECK(status = 'pending' OR (reviewed_by IS NOT NULL AND coalesce(length(review_notes), 0) >= 12)),
 CHECK(finance_role NOT IN ('super_admin','internal_auditor','external_auditor','management_viewer') OR (can_approve = 0 AND can_post = 0))
);
CREATE INDEX idx_rticore_fin_role_lookup ON rticore_finance_role_assignments(tenant_id, email, legal_entity_id, status);
CREATE TRIGGER rticore_fin_role_no_delete BEFORE DELETE ON rticore_finance_role_assignments
BEGIN SELECT RAISE(ABORT,'FIN_ROLE_IMMUTABLE'); END;
CREATE TRIGGER rticore_fin_role_review BEFORE UPDATE ON rticore_finance_role_assignments
WHEN NEW.version != OLD.version + 1 OR NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id
 OR NEW.email IS NOT OLD.email OR NEW.finance_role IS NOT OLD.finance_role
 OR NEW.legal_entity_id IS NOT OLD.legal_entity_id OR NEW.requested_by IS NOT OLD.requested_by
 OR lower(NEW.reviewed_by) = lower(OLD.requested_by) OR lower(NEW.reviewed_by) = lower(OLD.email)
 OR NOT ((OLD.status = 'pending' AND NEW.status IN ('approved','revoked')) OR (OLD.status = 'approved' AND NEW.status = 'revoked'))
BEGIN SELECT RAISE(ABORT,'FIN_ROLE_SOD_VIOLATION'); END;

-- 2. Profit Centers & Cost Centers Master Extension
CREATE TABLE rticore_finance_profit_centers (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 business_unit_id TEXT,
 code TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 3 AND 160),
 center_kind TEXT NOT NULL CHECK(center_kind IN ('profit_center','cost_center','investment_center')),
 manager_email TEXT COLLATE NOCASE,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_by TEXT NOT NULL COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, code),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id)
);
CREATE TRIGGER rticore_fin_pc_no_delete BEFORE DELETE ON rticore_finance_profit_centers
BEGIN SELECT RAISE(ABORT,'FIN_PROFIT_CENTER_ARCHIVE_ONLY'); END;

-- 3. Currencies & Effective-Dated Exchange Rates (micro-units: 1 IDR = 1_000_000 micro)
CREATE TABLE rticore_finance_exchange_rates (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 from_currency TEXT NOT NULL CHECK(length(from_currency) = 3),
 to_currency TEXT NOT NULL DEFAULT 'IDR' CHECK(length(to_currency) = 3),
 effective_date TEXT NOT NULL,
 rate_micro INTEGER NOT NULL CHECK(rate_micro > 0 AND rate_micro < 9000000000000000),
 source_reference TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),
 created_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, from_currency, to_currency, effective_date),
 CHECK(status != 'approved' OR (approved_by IS NOT NULL AND lower(approved_by) != lower(created_by)))
);
CREATE TRIGGER rticore_fin_fx_no_delete BEFORE DELETE ON rticore_finance_exchange_rates
BEGIN SELECT RAISE(ABORT,'FIN_FX_IMMUTABLE'); END;

-- 4. Hierarchical Chart of Accounts Metadata (10 classifications, normal balance, control account, consolidation)
CREATE TABLE rticore_finance_coa_hierarchy (
 tenant_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 parent_account_id TEXT,
 classification TEXT NOT NULL CHECK(classification IN (
  'asset','liability','equity','revenue','cost_of_revenue',
  'operating_expense','other_income','other_expense','tax_expense','contra_account'
 )),
 account_group TEXT NOT NULL,
 normal_balance TEXT NOT NULL CHECK(normal_balance IN ('debit','credit')),
 is_header INTEGER NOT NULL DEFAULT 0 CHECK(is_header IN (0,1)),
 is_control_account INTEGER NOT NULL DEFAULT 0 CHECK(is_control_account IN (0,1)),
 allow_manual_posting INTEGER NOT NULL DEFAULT 1 CHECK(allow_manual_posting IN (0,1)),
 consolidation_code TEXT,
 effective_from TEXT NOT NULL,
 effective_to TEXT,
 created_by TEXT NOT NULL COLLATE NOCASE,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id, account_id),
 FOREIGN KEY(tenant_id, account_id) REFERENCES rticore_gl_accounts(tenant_id, id),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(parent_account_id IS NULL OR parent_account_id != account_id),
 CHECK(is_header = 0 OR allow_manual_posting = 0)
);
CREATE TRIGGER rticore_fin_coa_meta_no_delete BEFORE DELETE ON rticore_finance_coa_hierarchy
BEGIN SELECT RAISE(ABORT,'FIN_COA_META_IMMUTABLE'); END;

-- =============================================================================
-- WP02: CORE DOUBLE-ENTRY ACCOUNTING ENGINE, DIMENSIONS & POSTING RULES (F03)
-- =============================================================================

-- 5. Configurable Accounting Policies & Posting Rule Engine (Zero Hardcoded Account Numbers)
CREATE TABLE rticore_finance_posting_rules (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 rule_code TEXT NOT NULL,
 business_event TEXT NOT NULL,
 journal_type TEXT NOT NULL CHECK(journal_type IN (
  'general','sales','purchase','cash_receipt','cash_disbursement',
  'revenue_recognition','accrual','prepaid_expense','depreciation',
  'payroll','tax','adjustment','reclassification','reversal',
  'intercompany','closing'
 )),
 service_category TEXT NOT NULL DEFAULT '*',
 tax_treatment TEXT NOT NULL DEFAULT '*',
 debit_account_id TEXT NOT NULL,
 credit_account_id TEXT NOT NULL,
 policy_reference TEXT NOT NULL CHECK(length(policy_reference) >= 6),
 effective_from TEXT NOT NULL,
 effective_to TEXT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','superseded')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
 created_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 review_notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, rule_code, version),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, debit_account_id) REFERENCES rticore_gl_accounts(tenant_id, id),
 FOREIGN KEY(tenant_id, credit_account_id) REFERENCES rticore_gl_accounts(tenant_id, id),
 CHECK(debit_account_id != credit_account_id),
 CHECK(status != 'approved' OR (approved_by IS NOT NULL AND lower(approved_by) != lower(created_by) AND coalesce(length(review_notes), 0) >= 12))
);
CREATE TRIGGER rticore_fin_posting_rule_no_delete BEFORE DELETE ON rticore_finance_posting_rules
BEGIN SELECT RAISE(ABORT,'FIN_POSTING_RULE_IMMUTABLE'); END;

-- 6. Extended Journal Workflow & Header Metadata (6-stage lifecycle: Draft -> Submitted -> Reviewed -> Approved -> Posted -> Reversed)
CREATE TABLE rticore_finance_journal_workflows (
 tenant_id TEXT NOT NULL,
 journal_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 journal_type TEXT NOT NULL CHECK(journal_type IN (
  'general','sales','purchase','cash_receipt','cash_disbursement',
  'revenue_recognition','accrual','prepaid_expense','depreciation',
  'payroll','tax','adjustment','reclassification','reversal',
  'intercompany','closing'
 )),
 lifecycle_stage TEXT NOT NULL DEFAULT 'draft' CHECK(lifecycle_stage IN ('draft','submitted','reviewed','approved','posted','reversed','rejected')),
 currency TEXT NOT NULL DEFAULT 'IDR' CHECK(length(currency) = 3),
 exchange_rate_micro INTEGER NOT NULL DEFAULT 1000000 CHECK(exchange_rate_micro > 0),
 posting_rule_id TEXT,
 supporting_document_id TEXT,
 submitted_by TEXT COLLATE NOCASE,
 submitted_at TEXT,
 checked_by TEXT COLLATE NOCASE,
 checked_at TEXT,
 approved_by TEXT COLLATE NOCASE,
 approved_at TEXT,
 posted_by TEXT COLLATE NOCASE,
 posted_at TEXT,
 reversed_by_journal_id TEXT,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
 PRIMARY KEY(tenant_id, journal_id),
 FOREIGN KEY(tenant_id, journal_id) REFERENCES rticore_gl_journals(tenant_id, id),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(checked_by IS NULL OR lower(checked_by) != lower(coalesce(submitted_by, ''))),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(coalesce(submitted_by, '')))
);
CREATE TRIGGER rticore_fin_jwf_no_delete BEFORE DELETE ON rticore_finance_journal_workflows
BEGIN SELECT RAISE(ABORT,'FIN_JOURNAL_WORKFLOW_IMMUTABLE'); END;

-- 7. 13 Accounting Dimensions per Journal Line
CREATE TABLE rticore_finance_journal_dimensions (
 tenant_id TEXT NOT NULL,
 line_id TEXT NOT NULL,
 journal_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 business_unit_id TEXT,
 department_id TEXT,
 cost_center_id TEXT,
 profit_center_id TEXT,
 project_id TEXT,
 contract_id TEXT,
 customer_id TEXT,
 vendor_id TEXT,
 product_code TEXT,
 service_category TEXT,
 currency TEXT NOT NULL DEFAULT 'IDR',
 foreign_amount_cents INTEGER NOT NULL DEFAULT 0,
 period_code TEXT NOT NULL,
 PRIMARY KEY(tenant_id, line_id),
 FOREIGN KEY(tenant_id, line_id) REFERENCES rticore_gl_lines(tenant_id, id),
 FOREIGN KEY(tenant_id, journal_id) REFERENCES rticore_gl_journals(tenant_id, id),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id)
);
CREATE INDEX idx_rticore_fin_dim_project ON rticore_finance_journal_dimensions(tenant_id, project_id, period_code);
CREATE INDEX idx_rticore_fin_dim_customer ON rticore_finance_journal_dimensions(tenant_id, customer_id, period_code);
CREATE INDEX idx_rticore_fin_dim_vendor ON rticore_finance_journal_dimensions(tenant_id, vendor_id, period_code);
CREATE TRIGGER rticore_fin_jdim_no_update BEFORE UPDATE ON rticore_finance_journal_dimensions
BEGIN SELECT RAISE(ABORT,'FIN_JOURNAL_DIMENSION_IMMUTABLE'); END;
CREATE TRIGGER rticore_fin_jdim_no_delete BEFORE DELETE ON rticore_finance_journal_dimensions
BEGIN SELECT RAISE(ABORT,'FIN_JOURNAL_DIMENSION_IMMUTABLE'); END;

-- =============================================================================
-- WP03: RTICORE FINANCE DOCKING GATEWAY (F25)
-- =============================================================================

-- 8. Docking Connections & Operating Mode Configuration (Mode A: Standalone, Mode B: Docked, Mode C: Multi-Entity)
CREATE TABLE rticore_finance_docking_connections (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 operating_mode TEXT NOT NULL DEFAULT 'docked' CHECK(operating_mode IN ('standalone','docked','multi_entity')),
 connection_status TEXT NOT NULL DEFAULT 'connected' CHECK(connection_status IN ('connected','disconnected','degraded')),
 rticore_endpoint TEXT NOT NULL,
 auth_protocol TEXT NOT NULL DEFAULT 'oidc_jwt_hmac' CHECK(auth_protocol IN ('oidc_jwt_hmac','oauth2_client_credentials','in_cluster_atomic')),
 webhook_secret_sha256 TEXT NOT NULL CHECK(length(webhook_secret_sha256) = 64),
 subscribed_events_json TEXT NOT NULL CHECK(json_valid(subscribed_events_json)),
 last_health_check_at TEXT,
 last_health_status TEXT NOT NULL DEFAULT 'healthy' CHECK(last_health_status IN ('healthy','warning','unreachable')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
 configured_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(configured_by))
);
CREATE TRIGGER rticore_fin_dock_conn_no_delete BEFORE DELETE ON rticore_finance_docking_connections
BEGIN SELECT RAISE(ABORT,'FIN_DOCKING_HISTORY_PRESERVED'); END;

-- 9. Cross-System Master Data & Chart of Accounts Mapping
CREATE TABLE rticore_finance_integration_mappings (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 domain TEXT NOT NULL CHECK(domain IN ('tenant','user','customer','vendor','contract','project','service_catalog','coa')),
 rticore_source_id TEXT NOT NULL,
 finance_target_id TEXT NOT NULL,
 mapping_meta_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(mapping_meta_json)),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_by TEXT NOT NULL COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, domain, rticore_source_id),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id)
);
CREATE TRIGGER rticore_fin_map_no_delete BEFORE DELETE ON rticore_finance_integration_mappings
BEGIN SELECT RAISE(ABORT,'FIN_MAPPING_IMMUTABLE'); END;

-- 10. Event-Driven Transactional Inbox, Outbox & Dead Letter Queue (22 Versioned Event Contracts)
CREATE TABLE rticore_finance_integration_events (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN ('inbox','outbox')),
 event_type TEXT NOT NULL CHECK(event_type IN (
  'customer.created','customer.updated','contract.approved','contract.amended',
  'project.created','project.milestone_accepted','project.completed',
  'timesheet.approved','resource.cost_allocated','procurement.requested',
  'purchase_order.approved','goods.received','service.accepted',
  'vendor_invoice.approved','customer_invoice.approved','customer.payment_received',
  'vendor.payment_completed','flexguard.credit_purchased','flexguard.credit_consumed',
  'subscription.activated','subscription.renewed','subscription.terminated'
 )),
 source_system TEXT NOT NULL CHECK(source_system IN ('RTICORE','RTI_FINANCE')),
 source_document_id TEXT NOT NULL,
 correlation_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 160),
 schema_version TEXT NOT NULL DEFAULT '1.0',
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64),
 status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','validated','processed','failed','dead_letter')),
 retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
 error_message TEXT,
 resulting_journal_id TEXT,
 event_timestamp TEXT NOT NULL,
 processed_at TEXT,
 processed_by TEXT COLLATE NOCASE,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, idempotency_key),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id)
);
CREATE INDEX idx_rticore_fin_events_status ON rticore_finance_integration_events(tenant_id, status, event_type);
CREATE TRIGGER rticore_fin_event_no_delete BEFORE DELETE ON rticore_finance_integration_events
BEGIN SELECT RAISE(ABORT,'FIN_INTEGRATION_EVENT_IMMUTABLE'); END;
CREATE TRIGGER rticore_fin_event_processed_lock BEFORE UPDATE ON rticore_finance_integration_events
WHEN OLD.status = 'processed'
BEGIN SELECT RAISE(ABORT,'FIN_EVENT_ALREADY_PROCESSED'); END;

-- 11. Cross-Domain & Subledger-to-GL Reconciliation Records
CREATE TABLE rticore_finance_reconciliations (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 period_code TEXT NOT NULL,
 reconciliation_kind TEXT NOT NULL CHECK(reconciliation_kind IN (
  'ar_to_gl','ap_to_gl','bank_to_gl','revenue_to_contract','project_cost_to_gl',
  'flexguard_to_liability','tax_to_gl','fixed_asset_to_gl','intercompany','rticore_docking_sync'
 )),
 source_balance_cents INTEGER NOT NULL,
 target_gl_balance_cents INTEGER NOT NULL,
 variance_cents INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('matched','exception','reconciled_with_adjustment')),
 notes TEXT NOT NULL CHECK(length(notes) >= 12),
 prepared_by TEXT NOT NULL COLLATE NOCASE,
 reviewed_by TEXT COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_at TEXT,
 UNIQUE(tenant_id, id),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(variance_cents = source_balance_cents - target_gl_balance_cents),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by) != lower(prepared_by))
);
CREATE TRIGGER rticore_fin_recon_no_delete BEFORE DELETE ON rticore_finance_reconciliations
BEGIN SELECT RAISE(ABORT,'FIN_RECONCILIATION_IMMUTABLE'); END;

-- =============================================================================
-- WP04: FINANCIAL OPERATIONS — AR, BILLING, AP, TREASURY & BANK RECON (F04-F08)
-- =============================================================================

-- 12. AR Invoice Lines, Credit/Debit Notes, Deposits, Payment Allocations, Disputes & Bad Debt (F04, F06)
CREATE TABLE rticore_finance_ar_invoice_lines (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 invoice_id TEXT NOT NULL,
 line_number INTEGER NOT NULL CHECK(line_number > 0),
 description TEXT NOT NULL CHECK(length(description) BETWEEN 3 AND 240),
 service_category TEXT NOT NULL,
 billing_type TEXT NOT NULL CHECK(billing_type IN ('milestone','recurring','advance','partial','progress')),
 qty INTEGER NOT NULL CHECK(qty > 0),
 unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents > 0),
 line_amount_cents INTEGER NOT NULL CHECK(line_amount_cents > 0),
 tax_code TEXT,
 tax_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(tax_amount_cents >= 0),
 performance_obligation_id TEXT,
 revenue_account_id TEXT,
 deferred_account_id TEXT,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, invoice_id, line_number),
 FOREIGN KEY(tenant_id, invoice_id) REFERENCES rticore_billing_invoices(tenant_id, id),
 CHECK(line_amount_cents = qty * unit_price_cents)
);
CREATE TRIGGER rticore_fin_ar_line_no_delete BEFORE DELETE ON rticore_finance_ar_invoice_lines
BEGIN SELECT RAISE(ABORT,'FIN_AR_LINE_IMMUTABLE'); END;

CREATE TABLE rticore_finance_ar_adjustments (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 customer_id TEXT NOT NULL,
 invoice_id TEXT,
 adjustment_kind TEXT NOT NULL CHECK(adjustment_kind IN ('credit_note','debit_note','customer_deposit','dispute_hold','bad_debt_provision','bad_debt_writeoff')),
 document_number TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0 AND amount_cents < 900000000000000),
 tax_cents INTEGER NOT NULL DEFAULT 0 CHECK(tax_cents >= 0),
 reason TEXT NOT NULL CHECK(length(reason) >= 12),
 evidence_document_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','rejected','posted')),
 version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL COLLATE NOCASE,
 reviewed_by TEXT COLLATE NOCASE,
 journal_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, document_number),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, customer_id) REFERENCES rticore_sales_accounts(tenant_id, id),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by) != lower(created_by)),
 CHECK(status = 'draft' OR reviewed_by IS NOT NULL)
);
CREATE TRIGGER rticore_fin_ar_adj_no_delete BEFORE DELETE ON rticore_finance_ar_adjustments
BEGIN SELECT RAISE(ABORT,'FIN_AR_ADJUSTMENT_IMMUTABLE'); END;

CREATE TABLE rticore_finance_ar_payment_allocations (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 payment_id TEXT NOT NULL,
 invoice_id TEXT NOT NULL,
 allocated_cents INTEGER NOT NULL CHECK(allocated_cents > 0),
 allocation_date TEXT NOT NULL,
 created_by TEXT NOT NULL COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 FOREIGN KEY(payment_id) REFERENCES rticore_billing_payments(id),
 FOREIGN KEY(tenant_id, invoice_id) REFERENCES rticore_billing_invoices(tenant_id, id)
);
CREATE TRIGGER rticore_fin_ar_alloc_no_delete BEFORE DELETE ON rticore_finance_ar_payment_allocations
BEGIN SELECT RAISE(ABORT,'FIN_AR_ALLOCATION_IMMUTABLE'); END;

-- 13. AP Vendor Bank Account Dual-Control, Vendor Advances, Withholding & Payment Batches (F05, F11)
CREATE TABLE rticore_finance_vendor_bank_accounts (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 vendor_id TEXT NOT NULL,
 bank_name TEXT NOT NULL CHECK(length(bank_name) BETWEEN 3 AND 120),
 account_holder_name TEXT NOT NULL CHECK(length(account_holder_name) BETWEEN 3 AND 160),
 masked_account_number TEXT NOT NULL CHECK(length(masked_account_number) BETWEEN 4 AND 32),
 account_hash_sha256 TEXT NOT NULL CHECK(length(account_hash_sha256) = 64),
 currency TEXT NOT NULL DEFAULT 'IDR',
 status TEXT NOT NULL DEFAULT 'pending_approval' CHECK(status IN ('pending_approval','approved','superseded','rejected')),
 version INTEGER NOT NULL DEFAULT 1,
 change_reason TEXT NOT NULL CHECK(length(change_reason) >= 12),
 evidence_document_id TEXT NOT NULL,
 created_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 approved_at TEXT,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, vendor_id, account_hash_sha256),
 FOREIGN KEY(tenant_id, vendor_id) REFERENCES rticore_vendors(tenant_id, id),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(created_by)),
 CHECK(status != 'approved' OR approved_by IS NOT NULL)
);
CREATE TRIGGER rticore_fin_vbank_no_delete BEFORE DELETE ON rticore_finance_vendor_bank_accounts
BEGIN SELECT RAISE(ABORT,'FIN_VENDOR_BANK_AUDIT_TRAIL_IMMUTABLE'); END;
CREATE TRIGGER rticore_fin_vbank_review BEFORE UPDATE ON rticore_finance_vendor_bank_accounts
WHEN OLD.status != 'pending_approval' OR NEW.status NOT IN ('approved','rejected')
 OR NEW.version != OLD.version + 1 OR lower(NEW.approved_by) = lower(OLD.created_by)
 OR NEW.account_hash_sha256 IS NOT OLD.account_hash_sha256 OR NEW.vendor_id IS NOT OLD.vendor_id
BEGIN SELECT RAISE(ABORT,'FIN_VENDOR_BANK_SOD_VIOLATION'); END;

CREATE TABLE rticore_finance_ap_extensions (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 vendor_id TEXT NOT NULL,
 ap_invoice_id TEXT,
 po_id TEXT,
 record_kind TEXT NOT NULL CHECK(record_kind IN ('service_acceptance','vendor_advance','accrued_expense','debit_note','payment_batch')),
 reference_number TEXT NOT NULL,
 gross_amount_cents INTEGER NOT NULL CHECK(gross_amount_cents > 0),
 withholding_tax_code TEXT,
 withholding_tax_cents INTEGER NOT NULL DEFAULT 0 CHECK(withholding_tax_cents >= 0),
 net_payable_cents INTEGER NOT NULL CHECK(net_payable_cents > 0),
 due_date TEXT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','settled','rejected')),
 version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL COLLATE NOCASE,
 reviewed_by TEXT COLLATE NOCASE,
 review_notes TEXT,
 journal_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, record_kind, reference_number),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, vendor_id) REFERENCES rticore_vendors(tenant_id, id),
 CHECK(net_payable_cents = gross_amount_cents - withholding_tax_cents),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by) != lower(created_by)),
 CHECK(status = 'draft' OR (reviewed_by IS NOT NULL AND coalesce(length(review_notes), 0) >= 12))
);
CREATE TRIGGER rticore_fin_ap_ext_no_delete BEFORE DELETE ON rticore_finance_ap_extensions
BEGIN SELECT RAISE(ABORT,'FIN_AP_EXTENSION_IMMUTABLE'); END;

-- 14. Treasury Cash Operations, Petty Cash, Loans, 13-Week Cash Forecast & Bank Reconciliation (F07, F08)
CREATE TABLE rticore_finance_bank_statements (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 bank_account_id TEXT NOT NULL,
 statement_number TEXT NOT NULL,
 period_start TEXT NOT NULL,
 period_end TEXT NOT NULL,
 opening_balance_cents INTEGER NOT NULL,
 closing_balance_cents INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'imported' CHECK(status IN ('imported','reconciling','reconciled','approved')),
 imported_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, bank_account_id, statement_number),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, bank_account_id) REFERENCES rticore_treasury_accounts(tenant_id, id),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(imported_by))
);
CREATE TRIGGER rticore_fin_bstmt_no_delete BEFORE DELETE ON rticore_finance_bank_statements
BEGIN SELECT RAISE(ABORT,'FIN_BANK_STATEMENT_IMMUTABLE'); END;

CREATE TABLE rticore_finance_bank_statement_lines (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 statement_id TEXT NOT NULL,
 tx_date TEXT NOT NULL,
 external_reference TEXT NOT NULL,
 description TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN ('inflow','outflow')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 match_status TEXT NOT NULL DEFAULT 'unmatched' CHECK(match_status IN ('unmatched','matched','exception')),
 matched_source_type TEXT CHECK(matched_source_type IS NULL OR matched_source_type IN ('ar_payment','ap_payment','gl_journal','bank_fee','fx_adjustment')),
 matched_source_id TEXT,
 reconciled_by TEXT COLLATE NOCASE,
 reconciled_at TEXT,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, statement_id, external_reference),
 FOREIGN KEY(tenant_id, statement_id) REFERENCES rticore_finance_bank_statements(tenant_id, id)
);
CREATE TRIGGER rticore_fin_bline_no_delete BEFORE DELETE ON rticore_finance_bank_statement_lines
BEGIN SELECT RAISE(ABORT,'FIN_BANK_LINE_IMMUTABLE'); END;

CREATE TABLE rticore_finance_cash_forecasts (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 horizon_kind TEXT NOT NULL CHECK(horizon_kind IN ('weekly_13w','monthly_12m')),
 bucket_label TEXT NOT NULL,
 bucket_start TEXT NOT NULL,
 bucket_end TEXT NOT NULL,
 opening_cash_cents INTEGER NOT NULL,
 expected_receipts_cents INTEGER NOT NULL DEFAULT 0 CHECK(expected_receipts_cents >= 0),
 expected_ap_payments_cents INTEGER NOT NULL DEFAULT 0 CHECK(expected_ap_payments_cents >= 0),
 project_commitments_cents INTEGER NOT NULL DEFAULT 0 CHECK(project_commitments_cents >= 0),
 payroll_obligations_cents INTEGER NOT NULL DEFAULT 0 CHECK(payroll_obligations_cents >= 0),
 tax_obligations_cents INTEGER NOT NULL DEFAULT 0 CHECK(tax_obligations_cents >= 0),
 debt_service_cents INTEGER NOT NULL DEFAULT 0 CHECK(debt_service_cents >= 0),
 projected_closing_cents INTEGER NOT NULL,
 minimum_liquidity_buffer_cents INTEGER NOT NULL DEFAULT 0 CHECK(minimum_liquidity_buffer_cents >= 0),
 shortfall_flag INTEGER NOT NULL DEFAULT 0 CHECK(shortfall_flag IN (0,1)),
 generated_by TEXT NOT NULL COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, horizon_kind, bucket_label),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(projected_closing_cents = opening_cash_cents + expected_receipts_cents - expected_ap_payments_cents - project_commitments_cents - payroll_obligations_cents - tax_obligations_cents - debt_service_cents)
);

-- =============================================================================
-- WP05: PSAK 115 REVENUE RECOGNITION, PROJECT ACCOUNTING & FLEXGUARD (F09, F10, F19)
-- =============================================================================

-- 15. PSAK 115 Performance Obligations & Standalone Selling Price (SSP) Allocation (F09)
CREATE TABLE rticore_finance_performance_obligations (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 contract_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 obligation_code TEXT NOT NULL,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 200),
 revenue_model TEXT NOT NULL CHECK(revenue_model IN (
  'fixed_price_vapt','time_and_material','milestone_consulting','monthly_soc_mdr',
  'annual_managed_service','retainer_dfir','threat_intel_subscription','grc_consulting',
  'software_license','hardware_sale','managed_security','flexguard_prepaid',
  'training_service','bundled_solution'
 )),
 satisfaction_method TEXT NOT NULL CHECK(satisfaction_method IN ('point_in_time','over_time_output','over_time_input','over_time_straight_line','usage_based')),
 principal_vs_agent TEXT NOT NULL DEFAULT 'principal' CHECK(principal_vs_agent IN ('principal','agent')),
 ssp_cents INTEGER NOT NULL CHECK(ssp_cents > 0),
 allocated_transaction_price_cents INTEGER NOT NULL CHECK(allocated_transaction_price_cents > 0),
 recognized_to_date_cents INTEGER NOT NULL DEFAULT 0 CHECK(recognized_to_date_cents >= 0),
 billed_to_date_cents INTEGER NOT NULL DEFAULT 0 CHECK(billed_to_date_cents >= 0),
 contract_asset_cents INTEGER NOT NULL DEFAULT 0 CHECK(contract_asset_cents >= 0),
 contract_liability_cents INTEGER NOT NULL DEFAULT 0 CHECK(contract_liability_cents >= 0),
 policy_reference TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','satisfied','modified')),
 version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 review_notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, contract_id, obligation_code),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, contract_id) REFERENCES rticore_service_contracts(tenant_id, id),
 FOREIGN KEY(tenant_id, project_id) REFERENCES rticore_delivery_projects(tenant_id, id),
 CHECK(recognized_to_date_cents <= allocated_transaction_price_cents),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(created_by)),
 CHECK(status = 'draft' OR (approved_by IS NOT NULL AND coalesce(length(review_notes), 0) >= 12))
);
CREATE TRIGGER rticore_fin_po_psak_no_delete BEFORE DELETE ON rticore_finance_performance_obligations
BEGIN SELECT RAISE(ABORT,'FIN_PSAK115_OBLIGATION_IMMUTABLE'); END;

CREATE TABLE rticore_finance_revenue_schedules (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 obligation_id TEXT NOT NULL,
 period_code TEXT NOT NULL,
 planned_cents INTEGER NOT NULL CHECK(planned_cents >= 0),
 recognized_cents INTEGER NOT NULL DEFAULT 0 CHECK(recognized_cents >= 0),
 evidence_kind TEXT NOT NULL CHECK(evidence_kind IN ('bast_milestone','timesheet_approved','monthly_service_report','flexguard_debit','license_delivery','expiry_policy')),
 evidence_source_id TEXT,
 evidence_document_id TEXT,
 status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','pending_approval','recognized','reversed')),
 version INTEGER NOT NULL DEFAULT 1,
 prepared_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 journal_id TEXT,
 recognized_at TEXT,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, obligation_id, period_code, evidence_kind, evidence_source_id),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, obligation_id) REFERENCES rticore_finance_performance_obligations(tenant_id, id),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(prepared_by)),
 CHECK(status != 'recognized' OR (approved_by IS NOT NULL AND recognized_cents > 0))
);
CREATE TRIGGER rticore_fin_rev_sched_no_delete BEFORE DELETE ON rticore_finance_revenue_schedules
BEGIN SELECT RAISE(ABORT,'FIN_REVENUE_SCHEDULE_IMMUTABLE'); END;

-- 16. Project Accounting, Effective-Dated Resource Cost Rates & Financial Snapshots (F10)
CREATE TABLE rticore_finance_resource_cost_rates (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 role_band_code TEXT NOT NULL,
 person_id TEXT,
 effective_from TEXT NOT NULL,
 effective_to TEXT,
 daily_cost_cents INTEGER NOT NULL CHECK(daily_cost_cents > 0 AND daily_cost_cents < 900000000000),
 hourly_overhead_cents INTEGER NOT NULL DEFAULT 0 CHECK(hourly_overhead_cents >= 0),
 confidentiality_tier TEXT NOT NULL DEFAULT 'band_blended' CHECK(confidentiality_tier IN ('band_blended','restricted_hr')),
 status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('draft','approved')),
 created_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 UNIQUE(tenant_id, id),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(created_by))
);
CREATE TRIGGER rticore_fin_rate_no_delete BEFORE DELETE ON rticore_finance_resource_cost_rates
BEGIN SELECT RAISE(ABORT,'FIN_COST_RATE_IMMUTABLE'); END;

CREATE TABLE rticore_finance_project_cost_ledger (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 period_code TEXT NOT NULL,
 cost_bucket TEXT NOT NULL CHECK(cost_bucket IN (
  'labor_timesheet','external_consultant','software_license',
  'hardware','travel_expense','procurement_po','allocated_overhead'
 )),
 source_domain TEXT NOT NULL CHECK(source_domain IN ('psa_timesheet','ap_invoice','expense_claim','payroll_allocation','inventory_issue','overhead_rule')),
 source_record_id TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0 AND amount_cents < 900000000000000),
 is_committed INTEGER NOT NULL DEFAULT 0 CHECK(is_committed IN (0,1)),
 is_actual INTEGER NOT NULL DEFAULT 1 CHECK(is_actual IN (0,1)),
 journal_id TEXT,
 status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('draft','approved','reversed')),
 created_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 -- Anti-double-counting constraint: a single source record cannot be posted twice to project cost
 UNIQUE(tenant_id, source_domain, source_record_id),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, project_id) REFERENCES rticore_delivery_projects(tenant_id, id),
 CHECK(is_committed != is_actual)
);
CREATE TRIGGER rticore_fin_proj_cost_no_delete BEFORE DELETE ON rticore_finance_project_cost_ledger
BEGIN SELECT RAISE(ABORT,'FIN_PROJECT_COST_IMMUTABLE'); END;

CREATE TABLE rticore_finance_project_snapshots (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 period_code TEXT NOT NULL,
 approved_budget_cents INTEGER NOT NULL CHECK(approved_budget_cents >= 0),
 contract_value_cents INTEGER NOT NULL CHECK(contract_value_cents >= 0),
 recognized_revenue_cents INTEGER NOT NULL CHECK(recognized_revenue_cents >= 0),
 billed_amount_cents INTEGER NOT NULL CHECK(billed_amount_cents >= 0),
 cash_collected_cents INTEGER NOT NULL CHECK(cash_collected_cents >= 0),
 direct_cost_cents INTEGER NOT NULL CHECK(direct_cost_cents >= 0),
 indirect_cost_cents INTEGER NOT NULL CHECK(indirect_cost_cents >= 0),
 committed_cost_cents INTEGER NOT NULL CHECK(committed_cost_cents >= 0),
 estimate_to_complete_cents INTEGER NOT NULL CHECK(estimate_to_complete_cents >= 0),
 estimate_at_completion_cents INTEGER NOT NULL CHECK(estimate_at_completion_cents >= 0),
 gross_profit_cents INTEGER NOT NULL,
 gross_margin_bps INTEGER NOT NULL,
 budget_variance_cents INTEGER NOT NULL,
 certification_status TEXT NOT NULL DEFAULT 'provisional' CHECK(certification_status IN ('provisional','reconciled','certified_closed')),
 generated_by TEXT NOT NULL COLLATE NOCASE,
 certified_by TEXT COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, project_id, period_code),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, project_id) REFERENCES rticore_delivery_projects(tenant_id, id),
 CHECK(gross_profit_cents = recognized_revenue_cents - direct_cost_cents - indirect_cost_cents),
 CHECK(estimate_at_completion_cents = direct_cost_cents + indirect_cost_cents + estimate_to_complete_cents),
 CHECK(certification_status != 'certified_closed' OR (certified_by IS NOT NULL AND lower(certified_by) != lower(generated_by)))
);

-- 17. FlexGuard Monetary Valuation & Contract Liability Ledger (F19)
CREATE TABLE rticore_finance_flexguard_valuations (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 wallet_id TEXT NOT NULL,
 flexguard_event_id TEXT NOT NULL,
 event_kind TEXT NOT NULL CHECK(event_kind IN ('ISSUE','TOPUP','DEBIT','REFUND','EXPIRY','ADJUSTMENT')),
 units INTEGER NOT NULL CHECK(units > 0),
 unit_rate_cents INTEGER NOT NULL CHECK(unit_rate_cents > 0),
 monetary_amount_cents INTEGER NOT NULL CHECK(monetary_amount_cents > 0),
 liability_delta_cents INTEGER NOT NULL,
 revenue_recognized_cents INTEGER NOT NULL DEFAULT 0 CHECK(revenue_recognized_cents >= 0),
 accounting_policy_ref TEXT NOT NULL,
 journal_id TEXT,
 status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('draft','approved','posted')),
 created_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 -- Guarantees no duplicate monetary valuation or revenue recognition for the same FlexGuard event
 UNIQUE(tenant_id, flexguard_event_id),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, wallet_id) REFERENCES rticore_flexguard_wallets(tenant_id, id),
 FOREIGN KEY(flexguard_event_id) REFERENCES rticore_flexguard_events(id),
 CHECK(monetary_amount_cents = units * unit_rate_cents)
);
CREATE TRIGGER rticore_fin_fg_val_no_delete BEFORE DELETE ON rticore_finance_flexguard_valuations
BEGIN SELECT RAISE(ABORT,'FIN_FLEXGUARD_VALUATION_IMMUTABLE'); END;

-- =============================================================================
-- WP06: CORPORATE FINANCE — BUDGET, FP&A, EXPENSE, PAYROLL, TAX, ASSETS & LICENSES (F11-F18)
-- =============================================================================

-- 18. Multi-Dimensional Enterprise Budget & FP&A Scenarios (F12, F13)
CREATE TABLE rticore_finance_budgets (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 fiscal_year INTEGER NOT NULL CHECK(fiscal_year BETWEEN 2020 AND 2100),
 period_code TEXT NOT NULL,
 budget_type TEXT NOT NULL CHECK(budget_type IN ('revenue','opex','capex','project','procurement','human_capital','marketing','cash_flow')),
 control_mode TEXT NOT NULL DEFAULT 'hard' CHECK(control_mode IN ('soft','hard')),
 business_unit_id TEXT,
 department_id TEXT,
 cost_center_id TEXT,
 profit_center_id TEXT,
 project_id TEXT,
 service_line TEXT,
 account_id TEXT NOT NULL,
 original_budget_cents INTEGER NOT NULL CHECK(original_budget_cents >= 0),
 revision_delta_cents INTEGER NOT NULL DEFAULT 0,
 transfer_delta_cents INTEGER NOT NULL DEFAULT 0,
 current_approved_cents INTEGER NOT NULL CHECK(current_approved_cents >= 0),
 reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK(reserved_cents >= 0),
 committed_cents INTEGER NOT NULL DEFAULT 0 CHECK(committed_cents >= 0),
 actual_realized_cents INTEGER NOT NULL DEFAULT 0 CHECK(actual_realized_cents >= 0),
 workflow_status TEXT NOT NULL DEFAULT 'preparation' CHECK(workflow_status IN (
  'preparation','submitted','reviewed','consolidated','approved','locked','revised'
 )),
 overrun_approved_by TEXT COLLATE NOCASE,
 version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, account_id) REFERENCES rticore_gl_accounts(tenant_id, id),
 CHECK(current_approved_cents = original_budget_cents + revision_delta_cents + transfer_delta_cents),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(created_by)),
 CHECK(control_mode = 'soft' OR overrun_approved_by IS NOT NULL OR (reserved_cents + committed_cents + actual_realized_cents <= current_approved_cents))
);
CREATE TRIGGER rticore_fin_budget_no_delete BEFORE DELETE ON rticore_finance_budgets
BEGIN SELECT RAISE(ABORT,'FIN_BUDGET_IMMUTABLE'); END;

CREATE TABLE rticore_finance_fpa_scenarios (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 fiscal_year INTEGER NOT NULL,
 scenario_kind TEXT NOT NULL CHECK(scenario_kind IN ('base_case','optimistic','pessimistic','rolling_forecast')),
 title TEXT NOT NULL,
 projected_revenue_cents INTEGER NOT NULL,
 projected_cogs_cents INTEGER NOT NULL,
 projected_opex_cents INTEGER NOT NULL,
 projected_ebitda_cents INTEGER NOT NULL,
 working_capital_cents INTEGER NOT NULL,
 planned_headcount INTEGER NOT NULL CHECK(planned_headcount >= 0),
 break_even_revenue_cents INTEGER NOT NULL CHECK(break_even_revenue_cents >= 0),
 assumptions_json TEXT NOT NULL CHECK(json_valid(assumptions_json)),
 created_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(projected_ebitda_cents = projected_revenue_cents - projected_cogs_cents - projected_opex_cents)
);

-- 19. Employee Expense Claims & Cash Advances (F14)
CREATE TABLE rticore_finance_expense_claims (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 claim_number TEXT NOT NULL,
 employee_email TEXT NOT NULL COLLATE NOCASE,
 claim_kind TEXT NOT NULL CHECK(claim_kind IN ('reimbursement','cash_advance','advance_settlement')),
 category TEXT NOT NULL CHECK(category IN ('travel','accommodation','client_engagement','certification_exam','project_supplies','other')),
 project_id TEXT,
 cost_center_id TEXT,
 period_code TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0 AND amount_cents < 900000000000),
 evidence_document_id TEXT NOT NULL,
 description TEXT NOT NULL CHECK(length(description) >= 12),
 status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','approved','rejected','reimbursed','posted')),
 version INTEGER NOT NULL DEFAULT 1,
 reviewed_by TEXT COLLATE NOCASE,
 review_notes TEXT,
 journal_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, claim_number),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(employee_email) REFERENCES rticore_members(email),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by) != lower(employee_email)),
 CHECK(status = 'submitted' OR (reviewed_by IS NOT NULL AND coalesce(length(review_notes), 0) >= 12))
);
CREATE TRIGGER rticore_fin_expense_no_delete BEFORE DELETE ON rticore_finance_expense_claims
BEGIN SELECT RAISE(ABORT,'FIN_EXPENSE_CLAIM_IMMUTABLE'); END;

-- 20. Payroll Accounting Summary Batches (F15 - Privacy-Preserving Aggregated Posting)
CREATE TABLE rticore_finance_payroll_batches (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 period_code TEXT NOT NULL,
 batch_number TEXT NOT NULL,
 headcount INTEGER NOT NULL CHECK(headcount > 0),
 gross_salary_cents INTEGER NOT NULL CHECK(gross_salary_cents > 0),
 allowances_cents INTEGER NOT NULL DEFAULT 0 CHECK(allowances_cents >= 0),
 employer_bpjs_cents INTEGER NOT NULL DEFAULT 0 CHECK(employer_bpjs_cents >= 0),
 pph21_withheld_cents INTEGER NOT NULL DEFAULT 0 CHECK(pph21_withheld_cents >= 0),
 employee_deductions_cents INTEGER NOT NULL DEFAULT 0 CHECK(employee_deductions_cents >= 0),
 net_take_home_cents INTEGER NOT NULL CHECK(net_take_home_cents > 0),
 project_allocated_cents INTEGER NOT NULL DEFAULT 0 CHECK(project_allocated_cents >= 0),
 opex_allocated_cents INTEGER NOT NULL DEFAULT 0 CHECK(opex_allocated_cents >= 0),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','posted','reconciled')),
 version INTEGER NOT NULL DEFAULT 1,
 prepared_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 journal_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, period_code, batch_number),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(net_take_home_cents = gross_salary_cents + allowances_cents - pph21_withheld_cents - employee_deductions_cents),
 CHECK(project_allocated_cents + opex_allocated_cents = gross_salary_cents + allowances_cents + employer_bpjs_cents),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(prepared_by))
);
CREATE TRIGGER rticore_fin_payroll_no_delete BEFORE DELETE ON rticore_finance_payroll_batches
BEGIN SELECT RAISE(ABORT,'FIN_PAYROLL_BATCH_IMMUTABLE'); END;

-- 21. Configurable Indonesian Tax Engine & Tax Register (F16 - Zero Hardcoded Tax Rates)
CREATE TABLE rticore_finance_tax_rules (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 tax_code TEXT NOT NULL,
 tax_type TEXT NOT NULL CHECK(tax_type IN ('PPN','PPH21','PPH22','PPH23','PPH25','PPH26','PPH4_2')),
 transaction_classification TEXT NOT NULL,
 legal_basis TEXT NOT NULL CHECK(length(legal_basis) >= 6),
 rate_bps INTEGER NOT NULL CHECK(rate_bps >= 0 AND rate_bps <= 10000),
 tax_base_ratio_bps INTEGER NOT NULL DEFAULT 10000 CHECK(tax_base_ratio_bps > 0 AND tax_base_ratio_bps <= 10000),
 is_withholding INTEGER NOT NULL DEFAULT 0 CHECK(is_withholding IN (0,1)),
 is_exempt INTEGER NOT NULL DEFAULT 0 CHECK(is_exempt IN (0,1)),
 tax_account_id TEXT NOT NULL,
 effective_from TEXT NOT NULL,
 effective_to TEXT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','superseded')),
 created_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, tax_code, effective_from),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, tax_account_id) REFERENCES rticore_gl_accounts(tenant_id, id),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(created_by))
);
CREATE TRIGGER rticore_fin_tax_rule_no_delete BEFORE DELETE ON rticore_finance_tax_rules
BEGIN SELECT RAISE(ABORT,'FIN_TAX_RULE_IMMUTABLE'); END;

CREATE TABLE rticore_finance_tax_transactions (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 period_code TEXT NOT NULL,
 tax_rule_id TEXT NOT NULL,
 tax_type TEXT NOT NULL,
 tax_document_number TEXT NOT NULL,
 source_type TEXT NOT NULL CHECK(source_type IN ('ar_invoice','ap_invoice','payroll','cross_border','monthly_installment')),
 source_id TEXT NOT NULL,
 counterparty_name TEXT NOT NULL,
 counterparty_npwp TEXT NOT NULL,
 tax_base_cents INTEGER NOT NULL CHECK(tax_base_cents >= 0),
 tax_amount_cents INTEGER NOT NULL CHECK(tax_amount_cents >= 0),
 status TEXT NOT NULL DEFAULT 'recorded' CHECK(status IN ('recorded','reported','paid','reconciled')),
 payment_ntp_number TEXT,
 journal_id TEXT,
 created_by TEXT NOT NULL COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, tax_type, tax_document_number),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, tax_rule_id) REFERENCES rticore_finance_tax_rules(tenant_id, id)
);
CREATE TRIGGER rticore_fin_tax_tx_no_delete BEFORE DELETE ON rticore_finance_tax_transactions
BEGIN SELECT RAISE(ABORT,'FIN_TAX_TRANSACTION_IMMUTABLE'); END;

-- 22. Fixed Asset Register, Depreciation & Inventory/License Accounting (F17, F18)
CREATE TABLE rticore_finance_fixed_assets (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 asset_tag TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 3 AND 160),
 asset_class TEXT NOT NULL CHECK(asset_class IN ('server_hardware','security_appliance','network_equipment','office_equipment','intangible_software','right_of_use')),
 acquisition_date TEXT NOT NULL,
 capitalization_date TEXT NOT NULL,
 acquisition_cost_cents INTEGER NOT NULL CHECK(acquisition_cost_cents > 0),
 salvage_value_cents INTEGER NOT NULL DEFAULT 0 CHECK(salvage_value_cents >= 0),
 useful_life_months INTEGER NOT NULL CHECK(useful_life_months BETWEEN 1 AND 600),
 depreciation_method TEXT NOT NULL DEFAULT 'straight_line' CHECK(depreciation_method IN ('straight_line','double_declining')),
 accumulated_depreciation_cents INTEGER NOT NULL DEFAULT 0 CHECK(accumulated_depreciation_cents >= 0),
 impairment_loss_cents INTEGER NOT NULL DEFAULT 0 CHECK(impairment_loss_cents >= 0),
 net_book_value_cents INTEGER NOT NULL CHECK(net_book_value_cents >= 0),
 location_department_id TEXT,
 custodian_email TEXT COLLATE NOCASE,
 last_verified_at TEXT,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','impaired','disposed','fully_depreciated')),
 created_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, asset_tag),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(net_book_value_cents = acquisition_cost_cents - accumulated_depreciation_cents - impairment_loss_cents),
 CHECK(salvage_value_cents <= acquisition_cost_cents)
);
CREATE TRIGGER rticore_fin_fa_no_delete BEFORE DELETE ON rticore_finance_fixed_assets
BEGIN SELECT RAISE(ABORT,'FIN_FIXED_ASSET_IMMUTABLE'); END;

CREATE TABLE rticore_finance_license_inventory (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 sku_code TEXT NOT NULL,
 product_name TEXT NOT NULL,
 item_kind TEXT NOT NULL CHECK(item_kind IN ('hardware_inventory','software_license','security_appliance','cloud_subscription')),
 vendor_id TEXT,
 project_id TEXT,
 customer_id TEXT,
 total_seats_units INTEGER NOT NULL CHECK(total_seats_units > 0),
 assigned_seats_units INTEGER NOT NULL DEFAULT 0 CHECK(assigned_seats_units >= 0),
 total_prepaid_cost_cents INTEGER NOT NULL CHECK(total_prepaid_cost_cents > 0),
 amortized_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(amortized_cost_cents >= 0),
 remaining_book_value_cents INTEGER NOT NULL CHECK(remaining_book_value_cents >= 0),
 billed_revenue_cents INTEGER NOT NULL DEFAULT 0 CHECK(billed_revenue_cents >= 0),
 start_date TEXT NOT NULL,
 renewal_date TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','allocated_to_project')),
 created_by TEXT NOT NULL COLLATE NOCASE,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, sku_code),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(assigned_seats_units <= total_seats_units),
 CHECK(remaining_book_value_cents = total_prepaid_cost_cents - amortized_cost_cents)
);
CREATE TRIGGER rticore_fin_lic_no_delete BEFORE DELETE ON rticore_finance_license_inventory
BEGIN SELECT RAISE(ABORT,'FIN_LICENSE_INVENTORY_IMMUTABLE'); END;

-- =============================================================================
-- WP07 & WP08: FINANCIAL CLOSING COCKPIT, CONSOLIDATION & ICOFR (F20, F22, F23)
-- =============================================================================

-- 23. Financial Closing Cockpit: 5-Stage Period Control & 17-Point Checklist (F20)
CREATE TABLE rticore_finance_period_controls (
 tenant_id TEXT NOT NULL,
 period_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 period_code TEXT NOT NULL,
 period_type TEXT NOT NULL DEFAULT 'monthly' CHECK(period_type IN ('monthly','quarterly','annual')),
 close_stage TEXT NOT NULL DEFAULT 'open' CHECK(close_stage IN ('open','soft_close','under_review','approved','hard_close')),
 checklist_json TEXT NOT NULL CHECK(json_valid(checklist_json)),
 completed_tasks_count INTEGER NOT NULL DEFAULT 0 CHECK(completed_tasks_count BETWEEN 0 AND 17),
 reopen_count INTEGER NOT NULL DEFAULT 0 CHECK(reopen_count >= 0),
 last_reopen_reason TEXT,
 last_reopened_by TEXT COLLATE NOCASE,
 controller_reviewed_by TEXT COLLATE NOCASE,
 cfo_approved_by TEXT COLLATE NOCASE,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id, period_id),
 FOREIGN KEY(tenant_id, period_id) REFERENCES rticore_gl_periods(tenant_id, id),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(close_stage NOT IN ('approved','hard_close') OR (completed_tasks_count = 17 AND controller_reviewed_by IS NOT NULL AND cfo_approved_by IS NOT NULL AND lower(controller_reviewed_by) != lower(cfo_approved_by)))
);
CREATE TRIGGER rticore_fin_pctrl_no_delete BEFORE DELETE ON rticore_finance_period_controls
BEGIN SELECT RAISE(ABORT,'FIN_PERIOD_CONTROL_IMMUTABLE'); END;
CREATE TRIGGER rticore_fin_pctrl_reopen_guard BEFORE UPDATE ON rticore_finance_period_controls
WHEN OLD.close_stage IN ('approved','hard_close') AND NEW.close_stage IN ('open','soft_close')
 AND (NEW.reopen_count != OLD.reopen_count + 1 OR coalesce(length(NEW.last_reopen_reason), 0) < 15 OR NEW.last_reopened_by IS NULL)
BEGIN SELECT RAISE(ABORT,'FIN_REOPEN_REQUIRES_SPECIAL_AUTHORIZATION_AND_REASON'); END;

-- 24. Multi-Entity Consolidation & Intercompany Elimination (F22)
CREATE TABLE rticore_finance_intercompany_eliminations (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 period_code TEXT NOT NULL,
 source_entity_id TEXT NOT NULL,
 counterparty_entity_id TEXT NOT NULL,
 elimination_kind TEXT NOT NULL CHECK(elimination_kind IN ('intercompany_ar_ap','intercompany_revenue_expense','intercompany_loan','dividend_equity','fx_translation')),
 source_amount_cents INTEGER NOT NULL CHECK(source_amount_cents > 0),
 counterparty_amount_cents INTEGER NOT NULL CHECK(counterparty_amount_cents > 0),
 elimination_amount_cents INTEGER NOT NULL CHECK(elimination_amount_cents > 0),
 status TEXT NOT NULL DEFAULT 'matched' CHECK(status IN ('draft','matched','eliminated')),
 prepared_by TEXT NOT NULL COLLATE NOCASE,
 approved_by TEXT COLLATE NOCASE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, id),
 FOREIGN KEY(tenant_id, source_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 FOREIGN KEY(tenant_id, counterparty_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(source_entity_id != counterparty_entity_id),
 CHECK(source_amount_cents = counterparty_amount_cents AND elimination_amount_cents = source_amount_cents),
 CHECK(approved_by IS NULL OR lower(approved_by) != lower(prepared_by))
);
CREATE TRIGGER rticore_fin_ic_no_delete BEFORE DELETE ON rticore_finance_intercompany_eliminations
BEGIN SELECT RAISE(ABORT,'FIN_INTERCOMPANY_ELIMINATION_IMMUTABLE'); END;

-- 25. ICOFR Risk & Control Matrix (COSO) and Automated Financial Exceptions Register (F23)
CREATE TABLE rticore_finance_icofr_controls (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 control_code TEXT NOT NULL,
 coso_component TEXT NOT NULL CHECK(coso_component IN ('control_environment','risk_assessment','control_activities','information_communication','monitoring_activities')),
 control_category TEXT NOT NULL CHECK(control_category IN ('entity_level','it_general','it_application','manual_preventive','automated_detective')),
 risk_description TEXT NOT NULL CHECK(length(risk_description) >= 12),
 control_objective TEXT NOT NULL CHECK(length(control_objective) >= 12),
 control_owner_email TEXT NOT NULL COLLATE NOCASE,
 frequency TEXT NOT NULL CHECK(frequency IN ('continuous','daily','monthly_close','quarterly','annual')),
 tod_status TEXT NOT NULL DEFAULT 'effective' CHECK(tod_status IN ('not_tested','effective','deficient')),
 toe_status TEXT NOT NULL DEFAULT 'effective' CHECK(toe_status IN ('not_tested','effective','deficient')),
 deficiency_severity TEXT CHECK(deficiency_severity IS NULL OR deficiency_severity IN ('control_deficiency','significant_deficiency','material_weakness')),
 remediation_plan TEXT,
 last_tested_by TEXT COLLATE NOCASE,
 last_tested_at TEXT,
 UNIQUE(tenant_id, id),
 UNIQUE(tenant_id, legal_entity_id, control_code),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(last_tested_by IS NULL OR lower(last_tested_by) != lower(control_owner_email))
);
CREATE TRIGGER rticore_fin_icofr_no_delete BEFORE DELETE ON rticore_finance_icofr_controls
BEGIN SELECT RAISE(ABORT,'FIN_ICOFR_CONTROL_IMMUTABLE'); END;

CREATE TABLE rticore_finance_exceptions (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 exception_kind TEXT NOT NULL CHECK(exception_kind IN (
  'unbalanced_journal','duplicate_invoice','duplicate_payment','unauthorized_posting',
  'closed_period_posting','suspicious_manual_journal','unsupported_transaction',
  'vendor_bank_change','budget_overrun','unreconciled_balance','negative_policy_balance',
  'sod_conflict','missing_approval','revenue_recognition_exception','integration_failure'
 )),
 severity TEXT NOT NULL CHECK(severity IN ('low','medium','high','critical')),
 source_domain TEXT NOT NULL,
 source_record_id TEXT NOT NULL,
 description TEXT NOT NULL CHECK(length(description) >= 12),
 responsible_owner_email TEXT NOT NULL COLLATE NOCASE,
 due_date TEXT NOT NULL,
 evidence_reference TEXT,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','investigating','escalated','resolved')),
 resolution_notes TEXT,
 resolved_by TEXT COLLATE NOCASE,
 detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 resolved_at TEXT,
 UNIQUE(tenant_id, id),
 FOREIGN KEY(tenant_id, legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id, id),
 CHECK(status != 'resolved' OR (resolved_by IS NOT NULL AND coalesce(length(resolution_notes), 0) >= 12))
);
CREATE INDEX idx_rticore_fin_exceptions_open ON rticore_finance_exceptions(tenant_id, legal_entity_id, status, severity);
CREATE TRIGGER rticore_fin_exc_no_delete BEFORE DELETE ON rticore_finance_exceptions
BEGIN SELECT RAISE(ABORT,'FIN_EXCEPTION_AUDIT_IMMUTABLE'); END;

INSERT INTO rticore_schema_file_manifest(path, source_branch)
VALUES('migrations/0052_rti_finance_enterprise_suite.sql', 'rti-finance-v1');
INSERT INTO rticore_schema_migrations(version) VALUES(52);
