-- 0057: Native PostgreSQL FlexGuard monetary ledger. No automatic backfill of legacy wallets.
-- Apply only after 0053-0054 and schema/trigger rehearsal. Deliberately not a second writable legacy balance.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE IF NOT EXISTS rticore_flexguard_credit_lots (
 id text PRIMARY KEY, tenant_id text NOT NULL, legal_entity_id text NOT NULL, customer_id text NOT NULL,
 contract_id text NOT NULL, wallet_id text NOT NULL, invoice_id text NOT NULL, lot_code text NOT NULL,
 credits_total bigint NOT NULL CHECK(credits_total BETWEEN 1 AND 100000),
 unit_value_cents bigint NOT NULL CHECK(unit_value_cents>0 AND unit_value_cents<900000000000000),
 financial_value_cents bigint NOT NULL CHECK(financial_value_cents=credits_total*unit_value_cents AND financial_value_cents<900000000000000),
 issued_at text NOT NULL, expires_at text NOT NULL, created_by text NOT NULL,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,invoice_id), UNIQUE(tenant_id,wallet_id,lot_code),
 UNIQUE(tenant_id,legal_entity_id,customer_id,contract_id,wallet_id,id),
 FOREIGN KEY(tenant_id,wallet_id) REFERENCES rticore_flexguard_wallets(tenant_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES rticore_sales_accounts(tenant_id,id),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES rticore_service_contracts(tenant_id,id),
 FOREIGN KEY(tenant_id,invoice_id) REFERENCES rticore_billing_invoices(tenant_id,id),
 CHECK(expires_at>=issued_at)
);
CREATE TABLE IF NOT EXISTS rticore_flexguard_requests (
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,wallet_id text NOT NULL,
 transaction_type text NOT NULL CHECK(transaction_type IN ('purchase','top_up','reservation','reservation_release','consumption','expiry','adjustment')),
 credit_amount bigint NOT NULL CHECK(credit_amount BETWEEN -100000 AND 100000 AND credit_amount<>0),
 invoice_id text,lot_id text,source_tx_id text,milestone_id text,reason text NOT NULL CHECK(length(reason) BETWEEN 12 AND 1000),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 128),actor_email text NOT NULL,
 status text NOT NULL DEFAULT 'pending_approval' CHECK(status IN ('pending_approval','posted','rejected')),
 approved_by text, approved_at text, approval_notes text, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,idempotency_key),
 FOREIGN KEY(tenant_id,wallet_id) REFERENCES rticore_flexguard_wallets(tenant_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 CHECK(status='pending_approval' OR (approved_by IS NOT NULL AND lower(actor_email)<>lower(approved_by) AND length(approval_notes)>=12))
);
CREATE TABLE IF NOT EXISTS rticore_flexguard_enterprise_ledger (
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,customer_id text NOT NULL,contract_id text NOT NULL,wallet_id text NOT NULL,
 lot_id text NOT NULL,transaction_type text NOT NULL CHECK(transaction_type IN ('purchase','top_up','reservation','reservation_release','consumption','expiry','adjustment')),
 credit_amount bigint NOT NULL CHECK(credit_amount BETWEEN -100000 AND 100000 AND credit_amount<>0),
 unit_value_cents bigint NOT NULL CHECK(unit_value_cents>0),
 financial_value_cents bigint NOT NULL CHECK(financial_value_cents=abs(credit_amount)*unit_value_cents AND financial_value_cents<900000000000000),
 available_delta bigint NOT NULL,reserved_delta bigint NOT NULL,consumed_delta bigint NOT NULL,expired_delta bigint NOT NULL,adjustment_delta bigint NOT NULL,
 source_tx_id text,milestone_id text,reference_code text NOT NULL,idempotency_key text NOT NULL,actor_email text NOT NULL,
 approval_status text NOT NULL DEFAULT 'posted' CHECK(approval_status='posted'),
 approved_by text NOT NULL,approved_at text NOT NULL,reason text NOT NULL,
 finance_outbox_event_id text,created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,idempotency_key), UNIQUE(tenant_id,legal_entity_id,wallet_id,id),
 FOREIGN KEY(tenant_id,id) REFERENCES rticore_flexguard_requests(tenant_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id,customer_id,contract_id,wallet_id,lot_id)
 REFERENCES rticore_flexguard_credit_lots(tenant_id,legal_entity_id,customer_id,contract_id,wallet_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id,wallet_id,source_tx_id) REFERENCES rticore_flexguard_enterprise_ledger(tenant_id,legal_entity_id,wallet_id,id),
 FOREIGN KEY(tenant_id,finance_outbox_event_id) REFERENCES rticore_finance_integration_events(tenant_id,id),
 FOREIGN KEY(tenant_id,milestone_id) REFERENCES rticore_delivery_milestones(tenant_id,id),
 CHECK(lower(actor_email)<>lower(approved_by)),
 CHECK((transaction_type IN ('purchase','top_up','reservation','reservation_release','consumption','expiry') AND credit_amount>0) OR transaction_type='adjustment'),
 CHECK(available_delta+reserved_delta+consumed_delta+expired_delta-adjustment_delta=CASE WHEN transaction_type IN ('purchase','top_up') THEN credit_amount ELSE 0 END)
);
CREATE UNIQUE INDEX IF NOT EXISTS rticore_fg_consumption_milestone_uq ON rticore_flexguard_enterprise_ledger(tenant_id,milestone_id) WHERE transaction_type='consumption';
CREATE INDEX IF NOT EXISTS rticore_fg_ledger_lot_idx ON rticore_flexguard_enterprise_ledger(tenant_id,lot_id);
CREATE INDEX IF NOT EXISTS rticore_fg_requests_scope_idx ON rticore_flexguard_requests(tenant_id,legal_entity_id,wallet_id,status);
-- Existing inbound 22-event protocol remains intact; these two additional events are internal outbound policy-review events only.
ALTER TABLE rticore_finance_integration_events DROP CONSTRAINT IF EXISTS rticore_finance_integration_events_event_type_check;
ALTER TABLE rticore_finance_integration_events ADD CONSTRAINT rticore_finance_integration_events_event_type_check CHECK(event_type IN ('DISQUALIFY','PLAN','TOUCH','PAUSE','RESUME','REACTIVATE','COMPLETE')),
 actor_email TEXT NOT NULL ,
 reason_code TEXT,
 detail TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_lead_nurture_plans(
 lead_id TEXT PRIMARY KEY NOT NULL REFERENCES rticore_marketing_leads(id),
 tenant_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('active','paused','completed','cancelled')),
 cadence_days BIGINT NOT NULL CHECK(cadence_days IN (7,14,30,60,90)),
 channel TEXT NOT NULL CHECK(channel IN ('call','email','meeting','follow_up')),
 next_touch_at TEXT NOT NULL CHECK(next_touch_at ~ '^....-..-..$'),
 last_touch_at TEXT,
 touch_count BIGINT NOT NULL DEFAULT 0 CHECK(touch_count>=0),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>=1),
 created_by TEXT NOT NULL ,
 updated_by TEXT NOT NULL ,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 updated_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_lead_disqualifications(
 lead_id TEXT PRIMARY KEY NOT NULL REFERENCES rticore_marketing_leads(id),
 tenant_id TEXT NOT NULL,
 reason_code TEXT NOT NULL CHECK(reason_code IN ('NO_BUDGET','NO_AUTHORITY','TIMING_LATER','NO_FIT','NO_RESPONSE','DUPLICATE','INVALID_CONTACT','OTHER')),
 reason_text TEXT NOT NULL CHECK(length(trim(reason_text))>=3),
 active BIGINT NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 changed_by TEXT NOT NULL ,
 changed_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_lead_sla (
 tenant_id TEXT NOT NULL,
 lead_id TEXT NOT NULL REFERENCES rticore_marketing_leads(id),
 owner_email TEXT NOT NULL ,
 assigned_at TEXT NOT NULL,
 response_due_at TEXT NOT NULL,
 first_response_at TEXT,
 baseline TEXT NOT NULL DEFAULT 'new' CHECK(baseline IN ('new','legacy_unverified')),
 PRIMARY KEY(tenant_id,lead_id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_marketing_lead_events (
 id TEXT PRIMARY KEY NOT NULL,
 tenant_id TEXT NOT NULL,
 lead_id TEXT NOT NULL,
 action TEXT NOT NULL,
 actor_email TEXT NOT NULL ,
 from_status TEXT,
 to_status TEXT,
 detail TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 FOREIGN KEY(lead_id) REFERENCES rticore_marketing_leads(id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_marketing_activities (
 id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL,
 lead_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('call','email','meeting','follow_up','note')),
 summary TEXT NOT NULL, next_action_at TEXT,
 created_by TEXT NOT NULL , created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 FOREIGN KEY(lead_id) REFERENCES rticore_marketing_leads(id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_opportunities (
 id TEXT PRIMARY KEY NOT NULL,
 tenant_id TEXT NOT NULL,
 company_id TEXT NOT NULL,
 title TEXT NOT NULL,
 stage TEXT NOT NULL DEFAULT 'prospecting'
 CHECK(stage IN ('prospecting','qualified','discovery','solution_design','commercial_review','quotation_sent','negotiation','pending_po','closed_won','closed_lost')),
 estimated_value_idr BIGINT NOT NULL CHECK(estimated_value_idr>0),
 data_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data_json)),
 created_by TEXT NOT NULL ,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), flow_version BIGINT NOT NULL DEFAULT 1,
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,company_id) REFERENCES rticore_sales_accounts(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_hr_assets(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,legal_entity_id TEXT NOT NULL,
 tag TEXT NOT NULL,category TEXT NOT NULL CHECK(category IN ('laptop','mobile','security_token','equipment','license')),
 model TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','assigned','retired')),
 assigned_to TEXT ,created_by TEXT NOT NULL,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,tag),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 FOREIGN KEY(tenant_id,assigned_to) REFERENCES rticore_hr_employees(tenant_id,email),
 CHECK((status='assigned' AND assigned_to IS NOT NULL) OR (status!='assigned' AND assigned_to IS NULL))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_hr_skills(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,email TEXT NOT NULL ,
 skill TEXT NOT NULL,level TEXT NOT NULL CHECK(level IN ('foundation','intermediate','advanced','expert')),
 evidence_document_id TEXT,expires_at TEXT,
 created_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,email,skill),
 FOREIGN KEY(tenant_id,email) REFERENCES rticore_hr_employees(tenant_id,email)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_hr_leave_requests(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,email TEXT NOT NULL ,
 policy_id TEXT NOT NULL,from_date TEXT NOT NULL,to_date TEXT NOT NULL,
 business_days BIGINT NOT NULL CHECK(business_days BETWEEN 1 AND 365),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','rejected')),
 version BIGINT NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL ,reviewed_by TEXT ,
 notes TEXT NOT NULL DEFAULT '',review_notes TEXT,
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,email) REFERENCES rticore_hr_employees(tenant_id,email),
 FOREIGN KEY(tenant_id,policy_id) REFERENCES rticore_hr_leave_policies(tenant_id,id),
 CHECK(from_date<=to_date),
 CHECK(reviewed_by IS NULL OR (lower(reviewed_by)!=lower(created_by) AND lower(reviewed_by)!=lower(email))),
 CHECK(status='draft' OR (reviewed_by IS NOT NULL AND coalesce(length(review_notes),0)>=12))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_procurement_requisitions(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,opportunity_id TEXT NOT NULL,
 budget_id TEXT NOT NULL,request_number TEXT NOT NULL,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 8 AND 180),
 qty BIGINT NOT NULL CHECK(qty BETWEEN 1 AND 1000000),
 ceiling_cents BIGINT NOT NULL CHECK(ceiling_cents>0 AND ceiling_cents<900000000000000),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','rejected')),
 version BIGINT NOT NULL DEFAULT 1,created_by TEXT NOT NULL ,reviewed_by TEXT ,
 review_notes TEXT,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,request_number),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id),
 FOREIGN KEY(tenant_id,budget_id) REFERENCES rticore_procurement_budgets(tenant_id,id),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by)!=lower(created_by)),
 CHECK(status='draft' OR (reviewed_by IS NOT NULL AND coalesce(length(review_notes),0)>=12))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_treasury_accounts(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,legal_entity_id TEXT NOT NULL,
 bank_name TEXT NOT NULL,masked_number TEXT NOT NULL CHECK(length(masked_number) BETWEEN 4 AND 32),
 currency TEXT NOT NULL DEFAULT 'IDR' CHECK(currency='IDR'),
 gl_account_id TEXT NOT NULL,active BIGINT NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_by TEXT NOT NULL,UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 FOREIGN KEY(tenant_id,gl_account_id) REFERENCES rticore_gl_accounts(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_erp_access_change_requests(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,grant_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action='revoke'),reason TEXT NOT NULL CHECK(length(reason) BETWEEN 12 AND 800),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 version BIGINT NOT NULL DEFAULT 1,
 requested_by TEXT NOT NULL ,reviewed_by TEXT ,
 review_notes TEXT,requested_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),reviewed_at TEXT,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,grant_id,action),
 FOREIGN KEY(tenant_id,grant_id) REFERENCES rticore_erp_capability_grants(tenant_id,id),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by)!=lower(requested_by)),
 CHECK(status='pending' OR (reviewed_by IS NOT NULL AND coalesce(length(review_notes),0)>=12))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_erp_hr_leave_requests(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,employee_id TEXT NOT NULL,
 start_date TEXT NOT NULL,end_date TEXT NOT NULL,leave_type TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 requested_by TEXT NOT NULL ,reviewed_by TEXT ,
 CHECK(end_date>=start_date),CHECK(reviewed_by IS NULL OR lower(reviewed_by)!=lower(requested_by)),
 FOREIGN KEY(tenant_id,employee_id) REFERENCES rticore_erp_hr_employee_profiles(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_erp_purchase_requisitions(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,opportunity_id TEXT NOT NULL,
 description TEXT NOT NULL,quantity BIGINT NOT NULL CHECK(quantity>0),
 budget_cents BIGINT NOT NULL CHECK(budget_cents>0),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','rejected')),
 requested_by TEXT NOT NULL ,approved_by TEXT ,
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id),
 CHECK(approved_by IS NULL OR lower(approved_by)!=lower(requested_by))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_gl_close_requests(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,period_id TEXT NOT NULL,legal_entity_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 requested_by TEXT NOT NULL ,reviewed_by TEXT ,
 reason TEXT NOT NULL CHECK(length(reason)>=12),created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), notes TEXT, snapshot_debits BIGINT, snapshot_credits BIGINT, created_by TEXT , review_notes TEXT, version BIGINT NOT NULL DEFAULT 1, reviewed_at TEXT,
 FOREIGN KEY(tenant_id,period_id) REFERENCES rticore_gl_periods(tenant_id,id),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by)!=lower(requested_by))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_gl_journals (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,legal_entity_id TEXT NOT NULL,
 period_id TEXT NOT NULL,source_type TEXT NOT NULL,source_key TEXT NOT NULL,
 memo TEXT NOT NULL CHECK(length(memo) BETWEEN 12 AND 500),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','posted','rejected')),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),
 created_by TEXT NOT NULL ,reviewed_by TEXT ,posted_by TEXT ,
 review_notes TEXT,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 reviewed_at TEXT,posted_at TEXT,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,source_type,source_key),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 FOREIGN KEY(tenant_id,period_id) REFERENCES rticore_gl_periods(tenant_id,id),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by)!=lower(created_by)),
 CHECK(status NOT IN ('approved','posted') OR (reviewed_by IS NOT NULL AND coalesce(length(review_notes),0)>=12))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_erp_opportunity_scopes (
 tenant_id TEXT NOT NULL,opportunity_id TEXT NOT NULL,legal_entity_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 requested_by TEXT NOT NULL ,reviewed_by TEXT ,version BIGINT NOT NULL DEFAULT 1,
 PRIMARY KEY(tenant_id,opportunity_id),FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by)!=lower(requested_by))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_opportunity_relations(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,source_id TEXT NOT NULL,target_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('related','renewal','expansion')),contract_id TEXT,
 created_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,source_id,target_id),UNIQUE(tenant_id,contract_id,kind),CHECK(source_id!=target_id),
 FOREIGN KEY(tenant_id,source_id) REFERENCES rticore_sales_opportunities(tenant_id,id),
 FOREIGN KEY(tenant_id,target_id) REFERENCES rticore_sales_opportunities(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_customer_records(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,customer_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('stakeholder','installed_product')),
 title TEXT NOT NULL,data_json TEXT NOT NULL CHECK(json_valid(data_json)),opportunity_id TEXT,created_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES rticore_sales_accounts(tenant_id,id),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_actual_costs (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,opportunity_id TEXT NOT NULL,period TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN ('vendor','labor','license','travel','cloud','other')),
 amount_idr BIGINT NOT NULL CHECK(amount_idr>0 AND amount_idr<100000000000000),
 evidence_reference TEXT NOT NULL,evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','rejected')),
 reverses_id TEXT UNIQUE,created_by TEXT NOT NULL,reviewed_by TEXT,notes TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 FOREIGN KEY(opportunity_id) REFERENCES rticore_sales_opportunities(id),FOREIGN KEY(reverses_id) REFERENCES rticore_actual_costs(id),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by)!=lower(created_by))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_resource_allocations(
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
 person_id TEXT NOT NULL, allocation_month TEXT NOT NULL CHECK(length(allocation_month)=7),
 work_role TEXT NOT NULL, person_days DOUBLE PRECISION NOT NULL CHECK(person_days>0 AND person_days<=31),
 daily_cost_snapshot DOUBLE PRECISION NOT NULL CHECK(daily_cost_snapshot>=0 AND daily_cost_snapshot<1e12),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
 created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id),
 FOREIGN KEY(tenant_id,person_id) REFERENCES rticore_resource_people(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_feasibility_plans(
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
 service_line TEXT NOT NULL CHECK(service_line IN ('VAPT','SOC/MDR','FortiSIEM','GRC','Managed Security')),
 start_date TEXT NOT NULL, end_date TEXT NOT NULL, months BIGINT NOT NULL CHECK(months BETWEEN 1 AND 60),
 asset_count BIGINT NOT NULL DEFAULT 0 CHECK(asset_count BETWEEN 0 AND 100000),
 pd_per_asset DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK(pd_per_asset>=0 AND pd_per_asset<=1000),
 retest_pct DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK(retest_pct BETWEEN 0 AND 100),
 coordination_pd DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK(coordination_pd BETWEEN 0 AND 100000),
 base_pd DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK(base_pd BETWEEN 0 AND 100000),
 coverage_hours BIGINT NOT NULL DEFAULT 0 CHECK(coverage_hours IN (0,8,12,24)),
 staffing BIGINT NOT NULL DEFAULT 0 CHECK(staffing BETWEEN 0 AND 200),
 coverage_days BIGINT NOT NULL DEFAULT 0 CHECK(coverage_days BETWEEN 0 AND 31),
 required_pd DOUBLE PRECISION NOT NULL CHECK(required_pd>0 AND required_pd<=1000000),
 target_margin_pct DOUBLE PRECISION NOT NULL CHECK(target_margin_pct BETWEEN 0 AND 99),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','rejected')),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),
 created_by TEXT NOT NULL , reviewed_by TEXT, review_notes TEXT, reviewed_at TEXT,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), updated_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,opportunity_id), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id),
 CHECK(status!='approved' OR (reviewed_by IS NOT NULL AND lower(reviewed_by)!=lower(created_by)))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_target_events (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 period TEXT NOT NULL,
 owner_email TEXT NOT NULL ,
 version BIGINT NOT NULL,
 amount_idr BIGINT NOT NULL,
 rationale TEXT NOT NULL,
 actor_email TEXT NOT NULL ,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,period,owner_email,version),
 FOREIGN KEY(tenant_id,period,owner_email) REFERENCES rticore_sales_targets(tenant_id,period,owner_email)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_document_library (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('nda','rks','kak','quotation','supporting')),
 version BIGINT NOT NULL CHECK(version > 0),
 file_name TEXT NOT NULL CHECK(length(file_name) BETWEEN 1 AND 180),
 media_type TEXT NOT NULL, byte_length BIGINT NOT NULL CHECK(byte_length BETWEEN 1 AND 8388608),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 iv TEXT NOT NULL CHECK(length(iv)=16),
 chunk_count BIGINT NOT NULL CHECK(chunk_count BETWEEN 1 AND 33),
 retention_until TEXT CHECK(retention_until IS NULL OR (length(retention_until)=10 AND date(retention_until)=retention_until)),
 legal_hold BIGINT NOT NULL DEFAULT 0 CHECK(legal_hold IN (0,1)),
 hold_reason TEXT, updated_by TEXT, updated_at TEXT,
 created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id),
 UNIQUE(tenant_id,opportunity_id,kind,version)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_tender_deadlines(
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
 milestone TEXT NOT NULL CHECK(milestone IN ('clarification','aanwijzing','administrative','technical','commercial','submission')),
 due_at TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','rejected')),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0), created_by TEXT NOT NULL ,
 reviewed_by TEXT, review_notes TEXT, reviewed_at TEXT, created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,opportunity_id,milestone), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id),
 CHECK(status!='approved' OR (reviewed_by IS NOT NULL AND lower(reviewed_by)!=lower(created_by)))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_forecast_events(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,opportunity_id TEXT NOT NULL,version BIGINT NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),actor_email TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,opportunity_id,version),FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_forecasts(
 tenant_id TEXT NOT NULL,opportunity_id TEXT NOT NULL,expected_close_date TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN ('pipeline','best_case','commit','omit')),
 reason TEXT NOT NULL CHECK(length(trim(reason))>=12),version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),
 updated_by TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 PRIMARY KEY(tenant_id,opportunity_id),FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_vendor_offers(
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, opportunity_id TEXT NOT NULL, vendor_id TEXT NOT NULL,
 scope TEXT NOT NULL, quantity DOUBLE PRECISION NOT NULL CHECK(quantity>0 AND quantity<1e9), unit TEXT NOT NULL,
 unit_price_idr DOUBLE PRECISION NOT NULL CHECK(unit_price_idr>0 AND unit_price_idr<1e14),
 capacity_confirmed DOUBLE PRECISION NOT NULL CHECK(capacity_confirmed>=quantity AND capacity_confirmed<1e9),
 valid_until TEXT NOT NULL, evidence_reference TEXT NOT NULL, evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','validated','rejected')), version BIGINT NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL , reviewed_by TEXT, review_notes TEXT, reviewed_at TEXT, created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id),
 FOREIGN KEY(tenant_id,vendor_id) REFERENCES rticore_vendors(tenant_id,id),
 CHECK(status!='validated' OR (reviewed_by IS NOT NULL AND lower(reviewed_by)!=lower(created_by)))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_activity_tasks (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 lead_id TEXT REFERENCES rticore_marketing_leads(id),
 opportunity_id TEXT REFERENCES rticore_sales_opportunities(id),
 owner_email TEXT NOT NULL ,
 kind TEXT NOT NULL CHECK(kind IN ('visit','call','meeting','follow_up')),
 subject TEXT NOT NULL CHECK(length(subject) BETWEEN 3 AND 200),
 detail TEXT NOT NULL DEFAULT '',
 start_at TEXT NOT NULL,
 due_at TEXT NOT NULL,
 reminder_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','completed','cancelled')),
 outcome TEXT NOT NULL DEFAULT '',
 revision BIGINT NOT NULL DEFAULT 1 CHECK(revision>=1),
 completed_at TEXT,
 created_by TEXT NOT NULL ,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 updated_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 CHECK((lead_id IS NOT NULL AND opportunity_id IS NULL) OR (lead_id IS NULL AND opportunity_id IS NOT NULL)),
 CHECK(datetime(start_at) IS NOT NULL AND datetime(due_at) IS NOT NULL AND datetime(reminder_at) IS NOT NULL),
 CHECK(datetime(due_at)>=datetime(start_at))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_releases(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,opportunity_id TEXT NOT NULL,version BIGINT NOT NULL CHECK(version>0),
 status TEXT NOT NULL CHECK(status IN ('scoped','proposed','approved','superseded')),
 scope_snapshot TEXT NOT NULL CHECK(json_valid(scope_snapshot)),account_snapshot TEXT NOT NULL CHECK(json_valid(account_snapshot)),
 scope_notes TEXT NOT NULL,scoped_by TEXT NOT NULL,scoped_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 proposal_snapshot TEXT CHECK(proposal_snapshot IS NULL OR json_valid(proposal_snapshot)),
 proposal_reference TEXT,proposal_sha256 TEXT,proposal_notes TEXT,proposed_by TEXT,proposed_at TEXT,
 boq_id TEXT REFERENCES rticore_boq(id),boq_version BIGINT,boq_edit_seq BIGINT,
 approved_by TEXT,approved_at TEXT,approval_notes TEXT,
 CHECK(status NOT IN ('proposed','approved') OR (proposed_by IS NOT NULL AND proposal_reference IS NOT NULL AND length(proposal_sha256)=64 AND boq_id IS NOT NULL AND boq_version IS NOT NULL AND boq_edit_seq IS NOT NULL)),
 CHECK(status!='approved' OR (approved_by IS NOT NULL AND lower(trim(approved_by))!=lower(trim(proposed_by)))),
 UNIQUE(tenant_id,opportunity_id,version),UNIQUE(tenant_id,boq_id),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_award_documents (
 id TEXT PRIMARY KEY NOT NULL,
 tenant_id TEXT NOT NULL,
 opportunity_id TEXT NOT NULL,
 document_kind TEXT NOT NULL CHECK(document_kind IN ('po','spk','contract','award_letter')),
 document_number TEXT NOT NULL,
 file_name TEXT NOT NULL DEFAULT '',
 archive_reference TEXT NOT NULL,
 original_sha256 TEXT NOT NULL CHECK(length(original_sha256)=64),
 created_by TEXT NOT NULL,
 finance_reviewed_by TEXT,
 finance_reviewed_at TEXT,
 finance_review_notes TEXT NOT NULL DEFAULT '',
 legal_reviewed_by TEXT,
 legal_reviewed_at TEXT,
 legal_review_notes TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), release_id TEXT REFERENCES rticore_sales_releases(id), po_data_json TEXT,
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_submissions(
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 opportunity_id TEXT NOT NULL,
 boq_id TEXT NOT NULL,
 quotation_number TEXT NOT NULL,
 boq_version BIGINT NOT NULL,
 recipient_email TEXT NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN ('email','procurement_portal','physical')),
 sent_at TEXT NOT NULL,
 evidence_reference TEXT NOT NULL,
 evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64),
 status TEXT NOT NULL DEFAULT 'reported' CHECK(status IN ('reported','verified','rejected','superseded')),
 created_by TEXT NOT NULL,
 verified_by TEXT,
 reviewed_at TEXT,
 review_notes TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), release_id TEXT REFERENCES rticore_sales_releases(id),
 UNIQUE(tenant_id,opportunity_id,boq_id,boq_version,recipient_email),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id),
 FOREIGN KEY(boq_id) REFERENCES rticore_boq(id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_requirements (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 opportunity_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('rks','kak','rfp','rfq','nda','technical','commercial','vendor_quote','clarification')),
 title TEXT NOT NULL,
 file_reference TEXT NOT NULL DEFAULT '',
 file_name TEXT NOT NULL DEFAULT '',
 source_content_hash TEXT NOT NULL DEFAULT '',
 requirement_summary TEXT NOT NULL DEFAULT '',
 compliance_status TEXT NOT NULL DEFAULT 'pending' CHECK(compliance_status IN ('pending','compliant','partial','non_compliant','not_applicable')),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','reviewed','superseded')),
 review_notes TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL,
 reviewed_by TEXT,
 reviewed_at TEXT,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_bids (
 opportunity_id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN ('direct','rfq','rfp','tender')),
 tender_number TEXT NOT NULL DEFAULT '',
 tender_deadline TEXT NOT NULL DEFAULT '',
 summary TEXT NOT NULL DEFAULT '',
 bid_decision TEXT NOT NULL DEFAULT 'pending' CHECK(bid_decision IN ('pending','go','conditional_go','no_go')),
 decision_reason TEXT NOT NULL DEFAULT '',
 proposed_by TEXT NOT NULL,
 decided_by TEXT,
 decided_at TEXT,
 updated_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_lead_links (
 tenant_id TEXT NOT NULL,
 lead_id TEXT NOT NULL PRIMARY KEY,
 customer_id TEXT NOT NULL,
 opportunity_id TEXT NOT NULL UNIQUE,
 converted_by TEXT NOT NULL,
 converted_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 FOREIGN KEY(lead_id) REFERENCES rticore_marketing_leads(id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES rticore_sales_accounts(tenant_id,id),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_po_checks (
 opportunity_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, boq_id TEXT NOT NULL,
 po_number TEXT NOT NULL, po_date TEXT NOT NULL, po_reference TEXT NOT NULL,
 po_amount_before_vat DOUBLE PRECISION NOT NULL, quotation_amount_before_vat DOUBLE PRECISION NOT NULL,
 verified_by TEXT NOT NULL, verified_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, release_id TEXT REFERENCES rticore_sales_releases(id), award_id TEXT REFERENCES rticore_sales_award_documents(id), rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_hr_asset_events(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,asset_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('assign','return','retire')),
 employee_email TEXT ,evidence_document_id TEXT,
 created_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 FOREIGN KEY(tenant_id,asset_id) REFERENCES rticore_hr_assets(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_gl_reversal_links(
 tenant_id TEXT NOT NULL,original_journal_id TEXT NOT NULL,reversal_journal_id TEXT NOT NULL,
 created_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 PRIMARY KEY(tenant_id,original_journal_id),UNIQUE(tenant_id,reversal_journal_id),
 FOREIGN KEY(tenant_id,original_journal_id) REFERENCES rticore_gl_journals(tenant_id,id),
 FOREIGN KEY(tenant_id,reversal_journal_id) REFERENCES rticore_gl_journals(tenant_id,id),
 CHECK(original_journal_id!=reversal_journal_id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_gl_reversal_requests(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,original_journal_id TEXT NOT NULL,
 reversal_period_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 requested_by TEXT NOT NULL ,reviewed_by TEXT ,
 reason TEXT NOT NULL CHECK(length(reason)>=12),created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 FOREIGN KEY(tenant_id,original_journal_id) REFERENCES rticore_gl_journals(tenant_id,id),
 FOREIGN KEY(tenant_id,reversal_period_id) REFERENCES rticore_gl_periods(tenant_id,id),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by)!=lower(requested_by))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_purchase_orders (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,vendor_id TEXT NOT NULL,offer_id TEXT NOT NULL,opportunity_id TEXT NOT NULL,
 po_number TEXT NOT NULL,qty BIGINT NOT NULL CHECK(qty BETWEEN 1 AND 1000000),
 unit_price_cents BIGINT NOT NULL CHECK(unit_price_cents>0 AND unit_price_cents<900000000000000),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','rejected')),
 version BIGINT NOT NULL DEFAULT 1,created_by TEXT NOT NULL ,reviewed_by TEXT ,
 review_notes TEXT,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),reviewed_at TEXT,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,po_number),UNIQUE(tenant_id,offer_id),
 FOREIGN KEY(tenant_id,offer_id) REFERENCES rticore_vendor_offers(tenant_id,id),
 FOREIGN KEY(tenant_id,vendor_id) REFERENCES rticore_vendors(tenant_id,id),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by)!=lower(created_by)),
 CHECK(status='draft' OR (reviewed_by IS NOT NULL AND coalesce(length(review_notes),0)>=12))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_gl_lines (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,journal_id TEXT NOT NULL,
 account_id TEXT NOT NULL,debit_cents BIGINT NOT NULL DEFAULT 0 CHECK(debit_cents>=0 AND debit_cents<9000000000000000),
 credit_cents BIGINT NOT NULL DEFAULT 0 CHECK(credit_cents>=0 AND credit_cents<9000000000000000),
 description TEXT NOT NULL DEFAULT '',
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,journal_id) REFERENCES rticore_gl_journals(tenant_id,id),
 FOREIGN KEY(tenant_id,account_id) REFERENCES rticore_gl_accounts(tenant_id,id),
 CHECK((debit_cents>0 AND credit_cents=0) OR (credit_cents>0 AND debit_cents=0))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_delivery_projects(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,opportunity_id TEXT NOT NULL,customer_id TEXT NOT NULL,
 release_id TEXT NOT NULL,po_number TEXT NOT NULL,title TEXT NOT NULL,service_family TEXT NOT NULL,
 baseline_json TEXT NOT NULL CHECK(json_valid(baseline_json)),budget_json TEXT NOT NULL CHECK(json_valid(budget_json)),
 contract_cents BIGINT NOT NULL CHECK(contract_cents>0 AND contract_cents<9000000000000000),
 pm_email TEXT,status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','completed')),
 start_date TEXT,end_date TEXT,version BIGINT NOT NULL DEFAULT 1,created_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,opportunity_id),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES rticore_sales_accounts(tenant_id,id),FOREIGN KEY(release_id) REFERENCES rticore_sales_releases(id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_partner_records (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,vendor_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('profile','agreement','license','purchase','evaluation')),
 opportunity_id TEXT,offer_id TEXT,document_id TEXT,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 240),
 data_json TEXT NOT NULL CHECK(json_valid(data_json)),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','rejected','ordered','received','cancelled')),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),created_by TEXT NOT NULL,reviewed_by TEXT,
 review_notes TEXT,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),updated_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 FOREIGN KEY(tenant_id,vendor_id) REFERENCES rticore_vendors(tenant_id,id),FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id),
 FOREIGN KEY(tenant_id,offer_id) REFERENCES rticore_vendor_offers(tenant_id,id),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by)!=lower(created_by)),
 CHECK(status NOT IN ('approved','ordered','received') OR reviewed_by IS NOT NULL),
 CHECK(kind!='purchase' OR (opportunity_id IS NOT NULL AND offer_id IS NOT NULL)),
 CHECK(kind NOT IN ('agreement','license') OR document_id IS NOT NULL)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_feasibility_costs(
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
 cost_type TEXT NOT NULL CHECK(cost_type IN ('license','subscription','supplier_service','tooling','cloud','travel','other')),
 description TEXT NOT NULL, sku TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL,
 quantity DOUBLE PRECISION NOT NULL CHECK(quantity>0 AND quantity<=1000000),
 periods BIGINT NOT NULL CHECK(periods BETWEEN 1 AND 60),
 unit_price_idr DOUBLE PRECISION NOT NULL CHECK(unit_price_idr>=0 AND unit_price_idr<1e13),
 supplier_offer_id TEXT, created_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,opportunity_id,supplier_offer_id), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id),
 FOREIGN KEY(tenant_id,supplier_offer_id) REFERENCES rticore_vendor_offers(tenant_id,id),
 CHECK(cost_type!='license' OR length(sku)>=2),
 CHECK(supplier_offer_id IS NULL OR unit_price_idr>0)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_document_library_chunks (
 document_id TEXT NOT NULL REFERENCES rticore_document_library(id),
 part BIGINT NOT NULL CHECK(part BETWEEN 0 AND 32),
 ciphertext TEXT NOT NULL CHECK(length(ciphertext) BETWEEN 4 AND 349528),
 PRIMARY KEY(document_id,part)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_revenue(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,opportunity_id TEXT NOT NULL,release_id TEXT NOT NULL REFERENCES rticore_sales_releases(id),
 recognition_date TEXT NOT NULL,amount_before_vat DOUBLE PRECISION NOT NULL CHECK(amount_before_vat!=0 AND abs(amount_before_vat)<1e14),
 ledger_reference TEXT NOT NULL,invoice_reference TEXT NOT NULL,acceptance_reference TEXT NOT NULL,
 evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64),notes TEXT NOT NULL,
 reversal_of TEXT REFERENCES rticore_sales_revenue(id),status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','rejected')),
 created_by TEXT NOT NULL,reviewed_by TEXT,review_notes TEXT,reviewed_at TEXT,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,ledger_reference),FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id),
 CHECK((reversal_of IS NULL AND amount_before_vat>0) OR (reversal_of IS NOT NULL AND amount_before_vat<0)),
 CHECK(status!='approved' OR (reviewed_by IS NOT NULL AND lower(created_by)!=lower(reviewed_by)))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_opportunity_emails(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,opportunity_id TEXT NOT NULL,release_id TEXT,
 message_id TEXT NOT NULL,in_reply_to TEXT NOT NULL DEFAULT '',subject TEXT NOT NULL,
 sender_email TEXT NOT NULL,recipient_emails TEXT NOT NULL CHECK(json_valid(recipient_emails)),
 direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),sent_at TEXT NOT NULL,
 excerpt TEXT NOT NULL,source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
 verification TEXT NOT NULL DEFAULT 'imported_unverified' CHECK(verification='imported_unverified'),
 imported_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,message_id),UNIQUE(tenant_id,source_sha256),UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id),
 FOREIGN KEY(release_id) REFERENCES rticore_sales_releases(id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_tender_compliance_items(
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, opportunity_id TEXT NOT NULL, requirement_id TEXT NOT NULL REFERENCES rticore_sales_requirements(id),
 clause_reference TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('administrative','technical','commercial','security','vendor')),
 requirement_text TEXT NOT NULL, mandatory BIGINT NOT NULL CHECK(mandatory IN (0,1)), response_text TEXT NOT NULL,
 evidence_reference TEXT NOT NULL, evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64),
 vendor_offer_id TEXT, compliance_status TEXT NOT NULL DEFAULT 'pending' CHECK(compliance_status IN ('pending','compliant','partial','non_compliant','not_applicable')),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','reviewed')), version BIGINT NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL , reviewed_by TEXT, review_notes TEXT, reviewed_at TEXT,
 UNIQUE(tenant_id,requirement_id,clause_reference),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id),
 FOREIGN KEY(tenant_id,vendor_offer_id) REFERENCES rticore_vendor_offers(tenant_id,id),
 CHECK(status!='reviewed' OR (reviewed_by IS NOT NULL AND lower(reviewed_by)!=lower(created_by))),
 CHECK(category!='vendor' OR vendor_offer_id IS NOT NULL), CHECK(mandatory=0 OR compliance_status!='not_applicable')
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_document_vault(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,opportunity_id TEXT NOT NULL,
 release_id TEXT NOT NULL REFERENCES rticore_sales_releases(id),
 kind TEXT NOT NULL CHECK(kind IN ('proposal','submission','negotiation','po','spk','contract','award_letter')),
 file_name TEXT NOT NULL CHECK(length(file_name) BETWEEN 1 AND 180),media_type TEXT NOT NULL,
 byte_length BIGINT NOT NULL CHECK(byte_length BETWEEN 1 AND 8388608),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),iv TEXT NOT NULL CHECK(length(iv)=16),
 chunk_count BIGINT NOT NULL CHECK(chunk_count BETWEEN 1 AND 33),
 created_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_activity_alerts (
 alert_key TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 task_id TEXT REFERENCES rticore_sales_activity_tasks(id),
 lead_id TEXT REFERENCES rticore_marketing_leads(id),
 recipient_email TEXT NOT NULL ,
 alert_type TEXT NOT NULL CHECK(alert_type IN ('reminder','overdue','lead_sla','manager_escalation','unassigned_manager')),
 message TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 read_at TEXT,
 CHECK((task_id IS NOT NULL AND lead_id IS NULL) OR (task_id IS NULL AND lead_id IS NOT NULL))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_activity_events (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 task_id TEXT NOT NULL REFERENCES rticore_sales_activity_tasks(id),
 action TEXT NOT NULL CHECK(action IN ('scheduled','rescheduled','completed','cancelled')),
 actor_email TEXT NOT NULL ,
 detail TEXT NOT NULL DEFAULT '',
 at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_negotiations(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,opportunity_id TEXT NOT NULL,release_id TEXT NOT NULL REFERENCES rticore_sales_releases(id),
 submission_id TEXT NOT NULL REFERENCES rticore_sales_submissions(id),
 decision TEXT NOT NULL CHECK(decision IN ('pending','approved','rejected','revision_required')),
 amount_before_vat DOUBLE PRECISION NOT NULL CHECK(amount_before_vat>0 AND amount_before_vat<1e14),
 notes TEXT NOT NULL,evidence_reference TEXT NOT NULL,evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64),
 created_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), communication_id TEXT REFERENCES rticore_opportunity_emails(id),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_procurement_commitments(
 tenant_id TEXT NOT NULL,requisition_id TEXT NOT NULL,po_id TEXT NOT NULL,
 created_by TEXT NOT NULL,PRIMARY KEY(tenant_id,requisition_id),
 UNIQUE(tenant_id,po_id),
 FOREIGN KEY(tenant_id,requisition_id) REFERENCES rticore_procurement_requisitions(tenant_id,id),
 FOREIGN KEY(tenant_id,po_id) REFERENCES rticore_purchase_orders(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_erp_security_connectors(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,project_id TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('splunk','microsoft_sentinel','elastic','crowdstrike','microsoft_defender','generic_siem','generic_edr')),
 integration_kind TEXT NOT NULL CHECK(integration_kind IN ('siem','edr')),
 secret_binding_name TEXT NOT NULL,endpoint_alias TEXT NOT NULL,
 enabled BIGINT NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 last_verified_at TEXT,created_by TEXT NOT NULL ,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,project_id,provider,endpoint_alias),
 FOREIGN KEY(tenant_id,project_id) REFERENCES rticore_delivery_projects(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_cyber_cases (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,project_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('vapt_finding','soc_incident','dfir_incident')),
 external_ref TEXT NOT NULL CHECK(length(external_ref) BETWEEN 3 AND 120),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 8 AND 240),
 severity TEXT NOT NULL CHECK(severity IN ('critical','high','medium','low','informational')),
 classification TEXT NOT NULL CHECK(classification IN ('confidential','restricted')),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed','closed','rejected')),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),
 created_by TEXT NOT NULL ,
 reviewer_email TEXT ,review_notes TEXT,
 evidence_document_id TEXT,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 reviewed_at TEXT,closed_at TEXT,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,project_id,kind,external_ref),
 FOREIGN KEY(tenant_id,project_id) REFERENCES rticore_delivery_projects(tenant_id,id),
 CHECK(reviewer_email IS NULL OR lower(reviewer_email)!=lower(created_by))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_cyber_case_assignments (
 tenant_id TEXT NOT NULL,case_id TEXT NOT NULL,
 assignee_email TEXT NOT NULL ,assigned_by TEXT NOT NULL ,
 status TEXT NOT NULL DEFAULT 'assigned' CHECK(status IN ('assigned','submitted','returned')),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),
 investigation_notes TEXT CHECK(investigation_notes IS NULL OR length(investigation_notes) BETWEEN 12 AND 2000),
 evidence_document_id TEXT,
 leader_notes TEXT CHECK(leader_notes IS NULL OR length(leader_notes) BETWEEN 12 AND 800),
 assigned_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 submitted_at TEXT,updated_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 PRIMARY KEY(tenant_id,case_id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES rticore_cyber_cases(tenant_id,id),
 CHECK(status!='submitted' OR (investigation_notes IS NOT NULL AND evidence_document_id IS NOT NULL AND submitted_at IS NOT NULL)),
 CHECK(status!='returned' OR leader_notes IS NOT NULL)
, rowid BIGSERIAL);

CREATE INDEX IF NOT EXISTS rticore_cyber_assignment_queue ON rticore_cyber_case_assignments(tenant_id,assignee_email,status);

CREATE TABLE IF NOT EXISTS rticore_ap_supplier_invoices (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,po_id TEXT NOT NULL,vendor_id TEXT NOT NULL,
 supplier_invoice_number TEXT NOT NULL,qty BIGINT NOT NULL CHECK(qty BETWEEN 1 AND 1000000),
 amount_cents BIGINT NOT NULL CHECK(amount_cents>0 AND amount_cents<900000000000000),
 evidence_document_id TEXT NOT NULL,due_date TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','rejected')),
 version BIGINT NOT NULL DEFAULT 1,created_by TEXT NOT NULL ,
 reviewed_by TEXT ,review_notes TEXT,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),reviewed_at TEXT,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,vendor_id,supplier_invoice_number),
 FOREIGN KEY(tenant_id,po_id) REFERENCES rticore_purchase_orders(tenant_id,id),
 FOREIGN KEY(tenant_id,vendor_id) REFERENCES rticore_vendors(tenant_id,id),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by)!=lower(created_by)),
 CHECK(status='draft' OR (reviewed_by IS NOT NULL AND coalesce(length(review_notes),0)>=12))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_purchase_receipts (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,po_id TEXT NOT NULL,qty BIGINT NOT NULL CHECK(qty BETWEEN 1 AND 1000000),
 evidence_document_id TEXT NOT NULL,received_by TEXT NOT NULL ,
 received_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,po_id,evidence_document_id),
 FOREIGN KEY(tenant_id,po_id) REFERENCES rticore_purchase_orders(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_erp_project_scopes (
 tenant_id TEXT NOT NULL,project_id TEXT NOT NULL,legal_entity_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 requested_by TEXT NOT NULL ,reviewed_by TEXT ,
 version BIGINT NOT NULL DEFAULT 1,
 PRIMARY KEY(tenant_id,project_id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES rticore_delivery_projects(tenant_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by)!=lower(requested_by))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_project_timesheets (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL,
 person_id TEXT NOT NULL, allocation_id TEXT NOT NULL, work_date TEXT NOT NULL,
 minutes BIGINT NOT NULL CHECK(minutes BETWEEN 15 AND 480 AND minutes % 15=0),
 cost_snapshot_cents BIGINT NOT NULL CHECK(cost_snapshot_cents>=0 AND cost_snapshot_cents<9000000000000000),
 billable BIGINT NOT NULL CHECK(billable IN (0,1)),
 description TEXT NOT NULL CHECK(length(description) BETWEEN 12 AND 1000),
 status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','approved','rejected')),
 version BIGINT NOT NULL DEFAULT 1, created_by TEXT NOT NULL ,
 reviewed_by TEXT , review_notes TEXT,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), reviewed_at TEXT,
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES rticore_delivery_projects(tenant_id,id),
 FOREIGN KEY(tenant_id,person_id) REFERENCES rticore_resource_people(tenant_id,id),
 FOREIGN KEY(tenant_id,allocation_id) REFERENCES rticore_resource_allocations(tenant_id,id),
 CHECK(status!='approved' OR (reviewed_by IS NOT NULL AND lower(reviewed_by)!=lower(created_by)))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_service_contracts(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,project_id TEXT NOT NULL,customer_id TEXT NOT NULL,
 model TEXT NOT NULL DEFAULT 'OTC' CHECK(model IN ('OTC','MRC','managed_service','license','retainer','FlexGuard')),
 start_date TEXT,end_date TEXT,notice_days BIGINT NOT NULL DEFAULT 90 CHECK(notice_days BETWEEN 1 AND 365),
 recurring_cents BIGINT NOT NULL DEFAULT 0 CHECK(recurring_cents>=0),renewal_cents BIGINT CHECK(renewal_cents>0),
 probability_pct BIGINT NOT NULL DEFAULT 50 CHECK(probability_pct BETWEEN 0 AND 100),
 churn_risk TEXT NOT NULL DEFAULT 'unknown' CHECK(churn_risk IN ('unknown','low','medium','high')),churn_reason TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','expired','churned')),
 configured_by TEXT,approved_by TEXT,version BIGINT NOT NULL DEFAULT 1,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,project_id),FOREIGN KEY(tenant_id,project_id) REFERENCES rticore_delivery_projects(tenant_id,id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES rticore_sales_accounts(tenant_id,id),
 CHECK(status='draft' OR (configured_by IS NOT NULL AND approved_by IS NOT NULL AND lower(configured_by)!=lower(approved_by) AND start_date IS NOT NULL AND end_date IS NOT NULL))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_delivery_milestones(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,project_id TEXT NOT NULL,title TEXT NOT NULL,trigger_text TEXT NOT NULL DEFAULT '',
 amount_cents BIGINT CHECK(amount_cents>0 AND amount_cents<9000000000000000),due_date TEXT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','accepted')),document_id TEXT,accepted_by TEXT,
 created_by TEXT NOT NULL,UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,project_id) REFERENCES rticore_delivery_projects(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_delivery_tasks(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,project_id TEXT NOT NULL,code TEXT NOT NULL,title TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done')),detail TEXT NOT NULL DEFAULT '',
 due_date TEXT,period TEXT NOT NULL DEFAULT '',document_id TEXT,completed_by TEXT,
 UNIQUE(tenant_id,project_id,code,period),FOREIGN KEY(tenant_id,project_id) REFERENCES rticore_delivery_projects(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_document_governance (
 document_id TEXT PRIMARY KEY REFERENCES rticore_document_vault(id),
 tenant_id TEXT NOT NULL,
 opportunity_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 version BIGINT NOT NULL CHECK(version > 0),
 retention_until TEXT CHECK(retention_until IS NULL OR (length(retention_until)=10 AND date(retention_until)=retention_until)),
 legal_hold BIGINT NOT NULL DEFAULT 0 CHECK(legal_hold IN (0,1)),
 hold_reason TEXT,
 updated_by TEXT,
 updated_at TEXT,
 UNIQUE(tenant_id, opportunity_id, kind, version)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_tender_checklist(
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
 item_code TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('administrative','technical','commercial')),
 label TEXT NOT NULL, mandatory BIGINT NOT NULL CHECK(mandatory IN (0,1)),
 document_name TEXT NOT NULL DEFAULT '', evidence_reference TEXT NOT NULL DEFAULT '',
 evidence_sha256 TEXT NOT NULL DEFAULT '', source_clause_id TEXT,
 due_at TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','rejected')),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0), created_by TEXT NOT NULL ,
 checked_by TEXT, checked_at TEXT, review_notes TEXT,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,opportunity_id,item_code), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,opportunity_id) REFERENCES rticore_sales_opportunities(tenant_id,id),
 FOREIGN KEY(source_clause_id) REFERENCES rticore_tender_compliance_items(id),
 CHECK(evidence_sha256='' OR length(evidence_sha256)=64),
 CHECK(status!='ready' OR (
  checked_by IS NOT NULL AND lower(checked_by)!=lower(created_by) AND
  length(evidence_reference)>=8 AND length(evidence_sha256)=64 AND length(document_name)>0))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_document_chunks(
 document_id TEXT NOT NULL REFERENCES rticore_document_vault(id),part BIGINT NOT NULL CHECK(part BETWEEN 0 AND 32),
 ciphertext TEXT NOT NULL CHECK(length(ciphertext) BETWEEN 4 AND 349528),PRIMARY KEY(document_id,part)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_security_dispatches(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,connector_id TEXT NOT NULL,case_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','delivered','retryable','rejected')),
 attempts BIGINT NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 last_http_code BIGINT,requested_by TEXT NOT NULL ,
 last_attempt_at TEXT,delivered_at TEXT,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,connector_id,case_id),
 FOREIGN KEY(tenant_id,connector_id) REFERENCES rticore_security_connectors(tenant_id,id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES rticore_cyber_cases(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_treasury_payments(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,legal_entity_id TEXT NOT NULL,ap_invoice_id TEXT NOT NULL,
 bank_account_id TEXT NOT NULL,amount_cents BIGINT NOT NULL CHECK(amount_cents>0 AND amount_cents<900000000000000),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','recorded','settled','rejected')),
 version BIGINT NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL ,reviewed_by TEXT ,recorded_by TEXT ,settled_by TEXT ,
 review_notes TEXT,bank_reference TEXT,bank_evidence_document_id TEXT,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),settled_at TEXT,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,bank_reference),
 FOREIGN KEY(tenant_id,ap_invoice_id) REFERENCES rticore_ap_supplier_invoices(tenant_id,id),
 FOREIGN KEY(tenant_id,bank_account_id) REFERENCES rticore_treasury_accounts(tenant_id,id),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by)!=lower(created_by)),
 CHECK(status NOT IN ('approved','recorded','settled') OR (reviewed_by IS NOT NULL AND coalesce(length(review_notes),0)>=12)),
 CHECK(status NOT IN ('recorded','settled') OR (bank_reference IS NOT NULL AND bank_evidence_document_id IS NOT NULL))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_erp_security_ingestion_events(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,connector_id TEXT NOT NULL,
 external_event_id TEXT NOT NULL,received_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 severity TEXT NOT NULL,case_id TEXT,payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 UNIQUE(tenant_id,connector_id,external_event_id),
 FOREIGN KEY(tenant_id,connector_id) REFERENCES rticore_erp_security_connectors(tenant_id,id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES rticore_cyber_cases(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_erp_treasury_payment_requests(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,ap_invoice_id TEXT NOT NULL,
 amount_cents BIGINT NOT NULL CHECK(amount_cents>0),currency TEXT NOT NULL DEFAULT 'IDR' CHECK(currency='IDR'),
 beneficiary_reference TEXT NOT NULL,bank_account_token TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','sent','settled','failed')),
 requested_by TEXT NOT NULL ,approved_by TEXT ,
 bank_idempotency_key TEXT NOT NULL,bank_reference TEXT,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,bank_idempotency_key),
 FOREIGN KEY(tenant_id,ap_invoice_id) REFERENCES rticore_ap_supplier_invoices(tenant_id,id),
 CHECK(approved_by IS NULL OR lower(approved_by)!=lower(requested_by))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_flexguard_wallets(
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 customer_id TEXT NOT NULL,
 contract_id TEXT NOT NULL,
 entitlement_units BIGINT NOT NULL CHECK(entitlement_units BETWEEN 1 AND 100000),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active')),
 created_by TEXT NOT NULL ,
 approved_by TEXT,
 approved_at TEXT,
 approved_notes TEXT,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,contract_id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES rticore_sales_accounts(tenant_id,id),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES rticore_service_contracts(tenant_id,id),
 CHECK(status!='active' OR (approved_by IS NOT NULL AND lower(approved_by)!=lower(created_by) AND length(approved_notes)>=12))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_billing_invoices(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,project_id TEXT NOT NULL,milestone_id TEXT NOT NULL,number TEXT NOT NULL,
 issue_date TEXT NOT NULL,due_date TEXT NOT NULL,amount_cents BIGINT NOT NULL CHECK(amount_cents>0),
 vat_cents BIGINT NOT NULL CHECK(vat_cents>=0),document_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','rejected')),
 created_by TEXT NOT NULL,reviewed_by TEXT,review_notes TEXT,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),UNIQUE(tenant_id,id),UNIQUE(tenant_id,number),
 FOREIGN KEY(tenant_id,project_id) REFERENCES rticore_delivery_projects(tenant_id,id),
 FOREIGN KEY(tenant_id,milestone_id) REFERENCES rticore_delivery_milestones(tenant_id,id),
 CHECK(status!='approved' OR (reviewed_by IS NOT NULL AND lower(reviewed_by)!=lower(created_by)))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_flexguard_events(
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 wallet_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('ISSUE','TOPUP','RESERVE','RELEASE','DEBIT','REFUND','EXPIRY')),
 units BIGINT NOT NULL CHECK(units BETWEEN 1 AND 100000),
 invoice_id TEXT,
 opportunity_id TEXT,
 source_event_id TEXT,
 document_id TEXT,
 request_key TEXT NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
 actor_email TEXT NOT NULL,
 explanation TEXT NOT NULL CHECK(length(explanation) BETWEEN 12 AND 1000),
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,request_key),UNIQUE(wallet_id,invoice_id),
 FOREIGN KEY(tenant_id,wallet_id) REFERENCES rticore_flexguard_wallets(tenant_id,id),
 FOREIGN KEY(invoice_id) REFERENCES rticore_billing_invoices(id),
 FOREIGN KEY(opportunity_id) REFERENCES rticore_sales_opportunities(id),
 FOREIGN KEY(source_event_id) REFERENCES rticore_flexguard_events(id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_invoice_revenue_links(
 invoice_id TEXT NOT NULL REFERENCES rticore_billing_invoices(id),revenue_id TEXT NOT NULL UNIQUE REFERENCES rticore_sales_revenue(id),
 created_by TEXT NOT NULL,PRIMARY KEY(invoice_id,revenue_id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_billing_payments(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,invoice_id TEXT NOT NULL,reference TEXT NOT NULL,payment_date TEXT NOT NULL,
 amount_cents BIGINT NOT NULL CHECK(amount_cents!=0 AND abs(amount_cents)<9000000000000000),document_id TEXT NOT NULL,
 reversal_of TEXT,created_by TEXT NOT NULL,reviewed_by TEXT,review_notes TEXT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','rejected')),
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),UNIQUE(tenant_id,reference),
 FOREIGN KEY(tenant_id,invoice_id) REFERENCES rticore_billing_invoices(tenant_id,id),FOREIGN KEY(reversal_of) REFERENCES rticore_billing_payments(id),
 CHECK((reversal_of IS NULL AND amount_cents>0) OR (reversal_of IS NOT NULL AND amount_cents<0)),
 CHECK(status!='approved' OR (reviewed_by IS NOT NULL AND lower(reviewed_by)!=lower(created_by)))
, rowid BIGSERIAL);

CREATE OR REPLACE VIEW rticore_document_evidence AS SELECT d.*,'vault:'||d.id AS reference FROM rticore_document_vault d
WHERE (SELECT count(*) FROM rticore_document_chunks c WHERE c.document_id=d.id)=d.chunk_count;

CREATE OR REPLACE VIEW rticore_tender_compliance_gaps AS
 SELECT c.*,CASE WHEN c.status!='reviewed' OR c.compliance_status!='compliant' THEN 1
 WHEN c.category='vendor' AND NOT EXISTS(SELECT 1 FROM rticore_vendor_offers o JOIN rticore_vendors v ON v.id=o.vendor_id AND v.tenant_id=o.tenant_id
 WHERE o.id=c.vendor_offer_id AND o.tenant_id=c.tenant_id AND o.opportunity_id=c.opportunity_id AND o.status='validated' AND v.status='validated'
 AND date(o.valid_until)>=date('now','+7 hours') AND date(v.valid_until)>=date('now','+7 hours') AND o.unit=v.capacity_unit
 AND o.capacity_confirmed>=o.quantity AND v.capacity_units>=o.capacity_confirmed) THEN 1 ELSE 0 END AS is_gap
 FROM rticore_tender_compliance_items c;

CREATE OR REPLACE VIEW rticore_tender_vault_originals AS
 SELECT d.tenant_id,d.opportunity_id,d.kind,d.file_name,
        'library:'||d.id AS evidence_reference,d.sha256,d.id AS document_id
 FROM rticore_document_library d
 WHERE d.chunk_count>0 AND
       (SELECT count(*) FROM rticore_document_library_chunks c WHERE c.document_id=d.id)=d.chunk_count;

CREATE OR REPLACE VIEW rticore_solution_feasibility_gaps AS
SELECT p.tenant_id,p.opportunity_id,p.id,p.status,
 CASE WHEN p.status!='approved' OR p.reviewed_by IS NULL OR lower(p.reviewed_by)=lower(p.created_by)
 OR date(p.end_date)<date(p.start_date)
 OR coalesce((SELECT sum(a.person_days) FROM rticore_resource_allocations a
  WHERE a.tenant_id=p.tenant_id AND a.opportunity_id=p.opportunity_id AND a.status='active'),0)<p.required_pd
 OR EXISTS(SELECT 1 FROM rticore_resource_allocations a JOIN rticore_resource_people e ON e.id=a.person_id AND e.tenant_id=a.tenant_id
  WHERE a.tenant_id=p.tenant_id AND a.opportunity_id=p.opportunity_id AND a.status='active' AND
  (e.active!=1 OR a.allocation_month<substr(p.start_date,1,7) OR a.allocation_month>substr(p.end_date,1,7)
   OR (SELECT coalesce(sum(x.person_days),0) FROM rticore_resource_allocations x
       WHERE x.tenant_id=a.tenant_id AND x.person_id=a.person_id AND x.allocation_month=a.allocation_month AND x.status='active')>e.capacity_pd_month))
 OR EXISTS(SELECT 1 FROM rticore_feasibility_costs c LEFT JOIN rticore_vendor_offers o ON o.id=c.supplier_offer_id AND o.tenant_id=c.tenant_id AND o.opportunity_id=c.opportunity_id
   LEFT JOIN rticore_vendors v ON v.id=o.vendor_id AND v.tenant_id=o.tenant_id
   WHERE c.tenant_id=p.tenant_id AND c.opportunity_id=p.opportunity_id AND c.supplier_offer_id IS NOT NULL
   AND (o.id IS NULL OR o.status!='validated' OR v.status!='validated' OR date(o.valid_until)<date('now','+7 hours')
   OR date(v.valid_until)<date('now','+7 hours') OR date(o.valid_until)<date(coalesce(nullif(json_extract((SELECT data_json FROM rticore_sales_opportunities d WHERE d.tenant_id=p.tenant_id AND d.id=p.opportunity_id),'$.quotation_valid_until'),''),p.start_date))
   OR date(v.valid_until)<date(p.start_date) OR o.unit!=c.unit OR o.unit_price_idr!=c.unit_price_idr OR o.quantity<c.quantity*c.periods OR o.capacity_confirmed<c.quantity*c.periods OR v.capacity_units<o.capacity_confirmed))
 OR (p.service_line='FortiSIEM' AND NOT EXISTS(SELECT 1 FROM rticore_feasibility_costs c WHERE c.tenant_id=p.tenant_id AND c.opportunity_id=p.opportunity_id AND c.cost_type='license' AND c.supplier_offer_id IS NOT NULL))
 OR (p.service_line IN ('SOC/MDR','Managed Security') AND NOT EXISTS(SELECT 1 FROM rticore_feasibility_costs c WHERE c.tenant_id=p.tenant_id AND c.opportunity_id=p.opportunity_id AND c.cost_type IN ('license','subscription','cloud','tooling')))
 OR (SELECT estimated_value_idr FROM rticore_sales_opportunities d WHERE d.id=p.opportunity_id AND d.tenant_id=p.tenant_id)<=0
 OR (100*(1-(
   coalesce((SELECT sum(a.person_days*a.daily_cost_snapshot) FROM rticore_resource_allocations a WHERE a.tenant_id=p.tenant_id AND a.opportunity_id=p.opportunity_id AND a.status='active'),0)
  +coalesce((SELECT sum(c.quantity*c.periods*c.unit_price_idr) FROM rticore_feasibility_costs c WHERE c.tenant_id=p.tenant_id AND c.opportunity_id=p.opportunity_id),0)
 )/(SELECT estimated_value_idr FROM rticore_sales_opportunities d WHERE d.id=p.opportunity_id AND d.tenant_id=p.tenant_id)))<p.target_margin_pct
 THEN 1 ELSE 0 END AS is_gap
FROM rticore_feasibility_plans p;

CREATE OR REPLACE VIEW rticore_delivery_source AS
 SELECT 'project-'||d.id AS id,d.tenant_id,d.id AS opportunity_id,d.company_id AS customer_id,r.id AS release_id,p.po_number,d.title,
 coalesce(json_extract(r.scope_snapshot,'$.fields.service_family'),'Other') AS service_family,
 jsonb_build_object('scope',json_FromText(r.scope_snapshot),'account',json_FromText(r.account_snapshot),'po_number',p.po_number,'po_date',p.po_date,
 'po_amount_before_vat',p.po_amount_before_vat,'award_id',p.award_id,'boq_id',b.id,'boq_version',b.version,'boq_edit_seq',b.edit_seq,'payment_terms',b.payment_terms) AS baseline_json,
 b.cost_items_json AS budget_json,CAST(round(p.po_amount_before_vat*100) AS BIGINT) AS contract_cents,d.created_by
 FROM rticore_sales_opportunities d JOIN rticore_sales_po_checks p ON p.tenant_id=d.tenant_id AND p.opportunity_id=d.id
 JOIN rticore_sales_releases r ON r.id=p.release_id AND r.opportunity_id=d.id AND r.tenant_id=d.tenant_id AND r.status='approved'
 JOIN rticore_boq b ON b.id=p.boq_id AND b.tenant_id=d.tenant_id AND b.id=r.boq_id AND b.status='approved' AND b.edit_seq=r.boq_edit_seq
 WHERE d.stage='closed_won';

CREATE OR REPLACE VIEW rticore_delivery_planned_pm AS
 SELECT f.tenant_id,f.opportunity_id,min(e.email) pm_email,f.start_date,f.end_date
 FROM rticore_feasibility_plans f JOIN rticore_resource_allocations a ON a.tenant_id=f.tenant_id AND a.opportunity_id=f.opportunity_id AND a.status='active' AND lower(trim(a.work_role)) IN ('pm','project manager','project_manager')
 JOIN rticore_resource_people e ON e.tenant_id=a.tenant_id AND e.id=a.person_id AND e.active=1
 JOIN rticore_members m ON lower(m.email)=lower(e.email) AND m.active=1 AND m.role IN ('presales','admin','project_manager')
 WHERE f.status='approved' GROUP BY f.tenant_id,f.opportunity_id,f.start_date,f.end_date HAVING count(DISTINCT lower(e.email))=1;

CREATE OR REPLACE VIEW rticore_effective_settings AS
 SELECT s.* FROM rticore_setting_versions s
 WHERE s.status='approved'
 AND s.version=(
  SELECT max(x.version) FROM rticore_setting_versions x
  WHERE x.tenant_id=s.tenant_id AND x.kind=s.kind
    AND x.setting_key=s.setting_key AND x.status='approved'
 )
 AND coalesce(json_extract(s.data_json,'$.deleted'),'0') IN ('0','false');

CREATE OR REPLACE VIEW rticore_treasury_ap_outstanding AS SELECT i.tenant_id,i.id invoice_id,i.amount_cents,
 (SELECT coalesce(sum(p.amount_cents),0) FROM rticore_treasury_payments p WHERE p.tenant_id=i.tenant_id AND p.ap_invoice_id=i.id AND p.status='settled') settled_cents
 FROM rticore_ap_supplier_invoices i WHERE i.status='approved';

CREATE OR REPLACE VIEW rticore_procurement_budget_usage AS SELECT b.tenant_id,b.id budget_id,b.limit_cents,
 coalesce((SELECT sum(r.ceiling_cents) FROM rticore_procurement_requisitions r
 JOIN rticore_procurement_commitments c ON c.tenant_id=r.tenant_id AND c.requisition_id=r.id
 WHERE r.budget_id=b.id AND r.tenant_id=b.tenant_id),0) committed_cents
 FROM rticore_procurement_budgets b;

CREATE INDEX IF NOT EXISTS idx_rticore_boq_tenant_updated ON rticore_boq(tenant_id,updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_rticore_audit_tenant ON rticore_audit_log(tenant_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_audit_time ON rticore_ai_config_audit(happened_at);

CREATE INDEX IF NOT EXISTS idx_rticore_boq_status_version ON rticore_boq(tenant_id,status,quotation_number,version);

CREATE INDEX IF NOT EXISTS idx_rticore_sales_audit ON rticore_sales_audit(tenant_id,entity_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rticore_sales_activities ON rticore_sales_activities(tenant_id,opportunity_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rticore_sales_documents ON rticore_sales_documents(tenant_id,opportunity_id);

CREATE INDEX IF NOT EXISTS idx_rticore_sales_accounts_tenant ON rticore_sales_accounts(tenant_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rticore_sales_opportunity_stage ON rticore_sales_opportunities(tenant_id,stage,created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rticore_sales_customer_name_unique
 ON rticore_sales_accounts(tenant_id,lower(trim(legal_name)));

CREATE INDEX IF NOT EXISTS idx_rticore_leads_owner ON rticore_marketing_leads(tenant_id,assigned_sales_email,status,updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_rticore_leads_campaign ON rticore_marketing_leads(tenant_id,source,campaign,status);

CREATE INDEX IF NOT EXISTS idx_rticore_lead_activities ON rticore_marketing_activities(tenant_id,lead_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_bids_decision ON rticore_sales_bids(tenant_id,bid_decision,updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_requirements_opportunity ON rticore_sales_requirements(tenant_id,opportunity_id,kind,status);

CREATE INDEX IF NOT EXISTS idx_sales_submission_stage ON rticore_sales_submissions(tenant_id,opportunity_id,status,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rticore_award_gate ON rticore_sales_award_documents(tenant_id,opportunity_id,document_kind,created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rticore_marketing_lead_request
ON rticore_marketing_leads(tenant_id,created_by,request_key)
WHERE request_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rticore_campaign_tenant_status
ON rticore_marketing_campaigns(tenant_id,status,updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_rticore_marketing_leads_campaign_id
ON rticore_marketing_leads(tenant_id,campaign_id);

CREATE INDEX IF NOT EXISTS idx_rticore_consolidated_lead_event
 ON rticore_marketing_lead_events(tenant_id,lead_id,created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rticore_consolidated_lead_account_opportunity
 ON rticore_sales_lead_links(tenant_id,lead_id,opportunity_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rticore_release_current ON rticore_sales_releases(tenant_id,opportunity_id) WHERE status!='superseded';

CREATE INDEX IF NOT EXISTS idx_rticore_negotiation_release ON rticore_sales_negotiations(tenant_id,opportunity_id,release_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rticore_award_original ON rticore_sales_award_documents(tenant_id,opportunity_id,release_id,document_kind,document_number,original_sha256);

CREATE INDEX IF NOT EXISTS idx_rticore_activity_owner_due ON rticore_sales_activity_tasks(tenant_id,owner_email,status,due_at);

CREATE INDEX IF NOT EXISTS idx_rticore_activity_lead ON rticore_sales_activity_tasks(tenant_id,lead_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rticore_activity_opportunity ON rticore_sales_activity_tasks(tenant_id,opportunity_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rticore_activity_events ON rticore_sales_activity_events(tenant_id,task_id,at DESC);

CREATE INDEX IF NOT EXISTS idx_rticore_sla_open ON rticore_sales_lead_sla(tenant_id,first_response_at,response_due_at);

CREATE INDEX IF NOT EXISTS idx_rticore_alert_recipient ON rticore_sales_activity_alerts(tenant_id,recipient_email,read_at,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rticore_lead_disq_reason ON rticore_lead_disqualifications(tenant_id,active,reason_code);

CREATE INDEX IF NOT EXISTS idx_rticore_nurture_due ON rticore_lead_nurture_plans(tenant_id,state,next_touch_at);

CREATE INDEX IF NOT EXISTS idx_rticore_lead_intelligence_events ON rticore_lead_intelligence_events(tenant_id,lead_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rticore_document_opportunity ON rticore_document_vault(tenant_id,opportunity_id,release_id);

CREATE INDEX IF NOT EXISTS rticore_vendor_offers_opportunity ON rticore_vendor_offers(tenant_id,opportunity_id,status,valid_until);

CREATE INDEX IF NOT EXISTS rticore_compliance_opportunity ON rticore_tender_compliance_items(tenant_id,opportunity_id,requirement_id,status);

CREATE INDEX IF NOT EXISTS rticore_email_opportunity ON rticore_opportunity_emails(tenant_id,opportunity_id,sent_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS rticore_revenue_reversal ON rticore_sales_revenue(reversal_of) WHERE reversal_of IS NOT NULL AND status!='rejected';

CREATE INDEX IF NOT EXISTS rticore_revenue_period ON rticore_sales_revenue(tenant_id,status,recognition_date,opportunity_id);

CREATE INDEX IF NOT EXISTS rticore_tender_deadline_due ON rticore_tender_deadlines(tenant_id,due_at,status);

CREATE INDEX IF NOT EXISTS rticore_tender_checklist_opportunity ON rticore_tender_checklist(tenant_id,opportunity_id,category,status);

CREATE INDEX IF NOT EXISTS idx_rticore_governance_retention ON rticore_document_governance(retention_until,legal_hold);

CREATE INDEX IF NOT EXISTS idx_rticore_library_opp ON rticore_document_library(tenant_id,opportunity_id,kind,version);

CREATE INDEX IF NOT EXISTS idx_rticore_library_retention ON rticore_document_library(retention_until,legal_hold);

CREATE INDEX IF NOT EXISTS idx_rticore_document_events ON rticore_document_access_events(tenant_id,opportunity_id,event_at DESC);

CREATE INDEX IF NOT EXISTS idx_rticore_sales_targets_owner ON rticore_sales_targets(tenant_id,owner_email,period);

CREATE UNIQUE INDEX IF NOT EXISTS rticore_alloc_active_unique ON rticore_resource_allocations(tenant_id,opportunity_id,person_id,allocation_month) WHERE status='active';

CREATE INDEX IF NOT EXISTS rticore_alloc_calendar ON rticore_resource_allocations(tenant_id,person_id,allocation_month,status);

CREATE INDEX IF NOT EXISTS rticore_feasibility_costs_opportunity ON rticore_feasibility_costs(tenant_id,opportunity_id);

CREATE INDEX IF NOT EXISTS rticore_operations_events_idx ON rticore_operations_events(tenant_id,area,created_at DESC);

CREATE INDEX IF NOT EXISTS rticore_partner_records_vendor ON rticore_partner_records(tenant_id,vendor_id,kind,status);

CREATE INDEX IF NOT EXISTS rticore_partner_records_deal ON rticore_partner_records(tenant_id,opportunity_id,kind);

CREATE INDEX IF NOT EXISTS rticore_actual_costs_period ON rticore_actual_costs(tenant_id,period,opportunity_id,status);

CREATE UNIQUE INDEX IF NOT EXISTS rticore_payment_reversal ON rticore_billing_payments(reversal_of) WHERE reversal_of IS NOT NULL AND status!='rejected';

CREATE INDEX IF NOT EXISTS rticore_delivery_customer ON rticore_delivery_projects(tenant_id,customer_id);

CREATE INDEX IF NOT EXISTS rticore_delivery_task_project ON rticore_delivery_tasks(tenant_id,project_id,period);

CREATE INDEX IF NOT EXISTS rticore_delivery_invoice_project ON rticore_billing_invoices(tenant_id,project_id,status,due_date);

CREATE INDEX IF NOT EXISTS rticore_delivery_payment_invoice ON rticore_billing_payments(tenant_id,invoice_id,status);

CREATE INDEX IF NOT EXISTS rticore_contract_renewal_date ON rticore_service_contracts(tenant_id,status,end_date);

CREATE INDEX IF NOT EXISTS idx_rticore_postal_areas_postal
 ON rticore_postal_areas(postal_code,province_code,regency_code,district_code);

CREATE INDEX IF NOT EXISTS idx_rticore_postal_areas_regency
 ON rticore_postal_areas(regency_code,district_code);

CREATE INDEX IF NOT EXISTS rticore_flexguard_wallet_customer ON rticore_flexguard_wallets(tenant_id,customer_id,status);

CREATE INDEX IF NOT EXISTS rticore_flexguard_event_wallet ON rticore_flexguard_events(tenant_id,wallet_id,created_at);

CREATE INDEX IF NOT EXISTS rticore_flexguard_event_source ON rticore_flexguard_events(source_event_id,kind);

CREATE INDEX IF NOT EXISTS rticore_admin_options_display ON rticore_admin_options(tenant_id,group_key,active,sort_order,option_label);

CREATE INDEX IF NOT EXISTS rticore_timesheet_project_date ON rticore_project_timesheets(tenant_id,project_id,work_date,status);

CREATE UNIQUE INDEX IF NOT EXISTS rticore_timesheet_active_day ON rticore_project_timesheets(tenant_id,project_id,person_id,work_date) WHERE status!='rejected';

CREATE INDEX IF NOT EXISTS rticore_erp_capability_access ON rticore_erp_capability_grants(tenant_id,email,capability,status);

CREATE INDEX IF NOT EXISTS rticore_gl_journal_period ON rticore_gl_journals(tenant_id,period_id,status);

CREATE INDEX IF NOT EXISTS rticore_gl_line_account ON rticore_gl_lines(tenant_id,account_id);

CREATE INDEX IF NOT EXISTS rticore_ap_aging ON rticore_ap_supplier_invoices(tenant_id,status,due_date);

CREATE INDEX IF NOT EXISTS rticore_cyber_case_board ON rticore_cyber_cases(tenant_id,kind,status,severity);

CREATE UNIQUE INDEX IF NOT EXISTS rticore_gl_close_once ON rticore_gl_close_requests(tenant_id,period_id) WHERE status IN ('pending','approved');

CREATE UNIQUE INDEX IF NOT EXISTS rticore_gl_reversal_once ON rticore_gl_reversal_requests(tenant_id,original_journal_id) WHERE status IN ('pending','approved');

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (1,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (2,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (3,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (4,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (5,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (6,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (7,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (8,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (9,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (10,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (11,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (12,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (13,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (14,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (15,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (16,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (17,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (18,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (19,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (20,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (21,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (22,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (23,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (24,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (25,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (26,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (27,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (28,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (29,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (30,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (31,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (32,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (33,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (34,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (35,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (36,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (37,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (38,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (39,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (40,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (41,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (42,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (43,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (44,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_migrations" (version,applied_at) VALUES (45,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0011_marketing_sales_consolidation.sql','consolidated','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0014_lead_intelligence.sql','lead-intelligence','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0015_secure_document_vault.sql','rticore-ag-vault-tender-integration','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0016_tender_vendor_compliance.sql','p1-p2-integration','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0017_opportunity_email.sql','p1-p2-integration','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0018_sales_forecast.sql','p1-p2-integration','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0019_verified_revenue.sql','p1-p2-integration','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0020_activity_lead_intelligence.sql','p1-p2-integration','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0021_tender_bid_readiness.sql','tender-bid-readiness','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0022_document_vault_governance.sql','rticore-ag-vault-tender-integration','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0023_tender_vault_integrity.sql','rticore-ag-vault-tender-integration','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0024_executive_sales_targets.sql','executive-sales-dashboard','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0025_vendor_resource_feasibility.sql','vendor-resource-feasibility','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0026_partner_reporting_administration.sql','modules-13-15','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0027_customer_delivery_cash_renewal.sql','customer-delivery-cash-renewal','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0028_ai_mistral_provider.sql','mistral-pr39-canonical-reconciliation','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0029_indonesia_postal_reference.sql','pr32-canonical-reconciliation','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0030_flexguard_immutable_ledger.sql','flexguard-canonical-d1','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0031_admin_option_registry.sql','admin-registration-center','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0032_setting_versioned_deletion.sql','settings-update-delete','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0033_project_timesheets.sql','psa-timesheets','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0034_erp_org_capabilities.sql','erp-wp2','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0035_erp_general_ledger.sql','erp-finance','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0036_erp_procurement_ap.sql','erp-procurement','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0037_erp_cyber_cases.sql','erp-cyber-ops','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0038_erp_enterprise_controls.sql','erp-enterprise-controls','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0039_erp_enterprise_guards.sql','erp-enterprise-controls','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0040_erp_role_matrix_revocation.sql','erp-extensions','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0041_erp_financial_close_treasury.sql','erp-extensions','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0042_erp_p2p_budget_requisitions.sql','erp-extensions','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0043_erp_hr_workforce.sql','erp-extensions','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0044_erp_siem_edr_connectors.sql','erp-extensions','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_schema_file_manifest" (path,source_branch,applied_at) VALUES ('migrations/0045_erp_role_policy_change.sql','erp-extensions','2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_sales_activity_policy" (tenant_id,lead_response_minutes,escalation_minutes,reminder_minutes) VALUES ('defendit360',120,60,30) ON CONFLICT DO NOTHING;

INSERT INTO "rticore_ai_providers" (provider_id,model,priority,enabled,key_iv,key_ciphertext,tested_at,tested_ok,updated_at,updated_by) VALUES ('mistral','mistral-small-latest',7,0,NULL,NULL,NULL,NULL,'2026-11-07 12:12:08','system:migration-0028') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_erp_role_capability_matrix" (role,capability,allowed,updated_at) VALUES ('finance','finance_gl',1,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_erp_role_capability_matrix" (role,capability,allowed,updated_at) VALUES ('finance','finance_ap',1,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_erp_role_capability_matrix" (role,capability,allowed,updated_at) VALUES ('admin','finance_ap',1,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_erp_role_capability_matrix" (role,capability,allowed,updated_at) VALUES ('approver','finance_gl',1,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_erp_role_capability_matrix" (role,capability,allowed,updated_at) VALUES ('approver','finance_ap',1,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_erp_role_capability_matrix" (role,capability,allowed,updated_at) VALUES ('approver','procurement',1,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_erp_role_capability_matrix" (role,capability,allowed,updated_at) VALUES ('approver','cyber_ops',1,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_erp_role_capability_matrix" (role,capability,allowed,updated_at) VALUES ('presales','procurement',1,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_erp_role_capability_matrix" (role,capability,allowed,updated_at) VALUES ('presales','cyber_ops',1,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_erp_role_capability_matrix" (role,capability,allowed,updated_at) VALUES ('admin','procurement',1,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_erp_role_capability_matrix" (role,capability,allowed,updated_at) VALUES ('admin','cyber_ops',1,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_erp_role_capability_matrix" (role,capability,allowed,updated_at) VALUES ('admin','resource',1,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_erp_role_capability_matrix" (role,capability,allowed,updated_at) VALUES ('admin','hr',1,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_erp_role_capability_matrix" (role,capability,allowed,updated_at) VALUES ('approver','hr',1,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_erp_role_capability_matrix" (role,capability,allowed,updated_at) VALUES ('admin','audit',1,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_erp_role_capability_matrix" (role,capability,allowed,updated_at) VALUES ('approver','audit',1,'2026-11-07 12:12:08') ON CONFLICT DO NOTHING;

INSERT INTO "rticore_erp_role_capability_matrix" (role,capability,allowed) VALUES ('defense_leader','cyber_ops',1),('defense_member','cyber_ops',1) ON CONFLICT DO NOTHING;


INSERT INTO rticore_members (email, role, active, created_by) VALUES
  ('admin@rticore.local', 'admin', 1, 'LOCAL_PG_SEED'),
  ('admin2@rticore.local', 'admin', 1, 'LOCAL_PG_SEED'),
  ('marketing@rticore.local', 'marketing', 1, 'LOCAL_PG_SEED'),
  ('sales.a@rticore.local', 'sales', 1, 'LOCAL_PG_SEED'),
  ('sales.b@rticore.local', 'sales', 1, 'LOCAL_PG_SEED'),
  ('presales@rticore.local', 'presales', 1, 'LOCAL_PG_SEED'),
  ('finance@rticore.local', 'finance', 1, 'LOCAL_PG_SEED'),
  ('approver@rticore.local', 'approver', 1, 'LOCAL_PG_SEED'),
  ('legal@rticore.local', 'legal', 1, 'LOCAL_PG_SEED'),
  ('viewer@rticore.local', 'viewer', 1, 'LOCAL_PG_SEED')
ON CONFLICT (email) DO NOTHING;

-- Import verified national postal data using npm run local:postal:import.


-- Scoping price-model calibration (ICOP indication vs final negotiated PO value).
-- Mirrors the on-demand DDL in src/lib/scoping-model-store.ts.
CREATE TABLE IF NOT EXISTS rticore_scoping_models (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, version INTEGER NOT NULL,
 status TEXT NOT NULL, factors_json TEXT NOT NULL, stats_json TEXT NOT NULL,
 method TEXT NOT NULL, provider_id TEXT, model TEXT, ai_rationale TEXT,
 sample_count INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 activated_by TEXT, activated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_rticore_scoping_models_status ON rticore_scoping_models(tenant_id,status,version);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rticore_scoping_models_version ON rticore_scoping_models(tenant_id,version);
CREATE TABLE IF NOT EXISTS rticore_scoping_model_settings (
 tenant_id TEXT PRIMARY KEY, provider_id TEXT, model TEXT,
 updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- Migration 0052: RTI Finance Enterprise Suite
CREATE TABLE IF NOT EXISTS rticore_finance_role_assignments (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 email TEXT NOT NULL ,
 finance_role TEXT NOT NULL CHECK(finance_role IN (
  'super_admin','ceo','cfo','financial_controller','finance_manager',
  'accounting_officer','ar_officer','ap_officer','treasury_officer',
  'tax_officer','budget_officer','procurement_officer','project_manager',
  'business_unit_head','human_capital_officer','internal_auditor',
  'external_auditor','management_viewer','flexguard.credit_expired','flexguard.credit_adjusted'));
CREATE OR REPLACE FUNCTION rticore_fg_immutable() RETURNS trigger LANGUAGE plpgsql AS $fg$
BEGIN RAISE EXCEPTION 'FLEXGUARD_ENTERPRISE_IMMUTABLE'; END $fg$;
DROP TRIGGER IF EXISTS rticore_fg_lot_immutable ON rticore_flexguard_credit_lots;
CREATE TRIGGER rticore_fg_lot_immutable BEFORE UPDATE OR DELETE ON rticore_flexguard_credit_lots FOR EACH ROW EXECUTE FUNCTION rticore_fg_immutable();
DROP TRIGGER IF EXISTS rticore_fg_ledger_immutable ON rticore_flexguard_enterprise_ledger;
CREATE TRIGGER rticore_fg_ledger_immutable BEFORE UPDATE OR DELETE ON rticore_flexguard_enterprise_ledger FOR EACH ROW EXECUTE FUNCTION rticore_fg_immutable();
CREATE OR REPLACE FUNCTION rticore_fg_request_guard() RETURNS trigger LANGUAGE plpgsql AS $fg$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FLEXGUARD_REQUEST_IMMUTABLE'; END IF;
 IF OLD.status<>'pending_approval' OR NEW.status NOT IN ('posted','rejected') OR
    (to_jsonb(OLD)-ARRAY['status','approved_by','approved_at','approval_notes']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','approved_by','approved_at','approval_notes'])
 THEN RAISE EXCEPTION 'FLEXGUARD_REQUEST_IMMUTABLE'; END IF;
 RETURN NEW;
END $fg$;
DROP TRIGGER IF EXISTS rticore_fg_request_immutable ON rticore_flexguard_requests;
CREATE TRIGGER rticore_fg_request_immutable BEFORE UPDATE OR DELETE ON rticore_flexguard_requests FOR EACH ROW EXECUTE FUNCTION rticore_fg_request_guard();
-- Reject two independent ledgers for the same wallet, including old operational writers.
CREATE OR REPLACE FUNCTION rticore_fg_legacy_guard() RETURNS trigger LANGUAGE plpgsql AS $fg$
BEGIN
 PERFORM 1 FROM rticore_flexguard_wallets w WHERE w.tenant_id=NEW.tenant_id AND w.id=NEW.wallet_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM rticore_flexguard_requests r WHERE r.tenant_id=NEW.tenant_id AND r.wallet_id=NEW.wallet_id AND r.status IN ('pending_approval','posted')) THEN RAISE EXCEPTION 'FLEXGUARD_ENTERPRISE_WALLET'; END IF;
 RETURN NEW;
END $fg$;
DROP TRIGGER IF EXISTS rticore_fg_legacy_exclusion ON rticore_flexguard_events;
CREATE TRIGGER rticore_fg_legacy_exclusion BEFORE INSERT ON rticore_flexguard_events FOR EACH ROW EXECUTE FUNCTION rticore_fg_legacy_guard();
-- The session actor is supplied only by the native authenticated server. Database function is SECURITY INVOKER.
CREATE OR REPLACE FUNCTION rticore_fg_actor_role(p_tenant text,p_entity text,p_actor text) RETURNS text LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $fg$
 SELECT m.role FROM rticore_members m WHERE lower(m.email)=lower(p_actor) AND m.active=1
 AND EXISTS(SELECT 1 FROM rticore_erp_org_units u WHERE u.tenant_id=p_tenant AND u.id=p_entity AND u.kind='legal_entity' AND u.active=1)
 AND (EXISTS(SELECT 1 FROM rticore_erp_staff_org s WHERE s.tenant_id=p_tenant AND s.unit_id=p_entity AND lower(s.email)=lower(p_actor) AND s.status='approved')
 OR EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=p_tenant AND a.legal_entity_id=p_entity AND lower(a.email)=lower(p_actor) AND a.status='approved' AND a.business_unit_id IS NULL AND a.department_id IS NULL))
$fg$;
CREATE OR REPLACE FUNCTION rticore_fg_submit(p_tenant text,p_entity text,p_actor text,p_wallet text,p_kind text,p_units bigint,p_invoice text,p_lot text,p_source text,p_milestone text,p_key text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE w record; actor_role text; rid text:=gen_random_uuid()::text; prior rticore_flexguard_requests%ROWTYPE;
BEGIN
 actor_role:=rticore_fg_actor_role(p_tenant,p_entity,p_actor);
 IF actor_role IS NULL OR actor_role NOT IN ('finance','admin','presales','project_manager') THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
 SELECT x.*,c.status AS contract_status,c.model,c.end_date,c.project_id,p.pm_email INTO w
 FROM rticore_flexguard_wallets x JOIN rticore_service_contracts c ON c.tenant_id=x.tenant_id AND c.id=x.contract_id
 JOIN rticore_delivery_projects p ON p.tenant_id=c.tenant_id AND p.id=c.project_id AND p.customer_id=x.customer_id AND c.customer_id=x.customer_id
 JOIN rticore_erp_project_scopes sc ON sc.tenant_id=p.tenant_id AND sc.project_id=p.id AND sc.legal_entity_id=p_entity AND sc.status='approved'
 WHERE x.tenant_id=p_tenant AND x.id=p_wallet AND x.status='active' AND c.model='FlexGuard' FOR UPDATE OF x;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_SCOPE_INVALID'; END IF;
 IF actor_role IN ('presales','project_manager') AND (p_kind NOT IN ('reservation','reservation_release','consumption') OR lower(w.pm_email) IS DISTINCT FROM lower(p_actor)) THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
 IF p_kind NOT IN ('purchase','top_up','reservation','reservation_release','consumption','expiry','adjustment') OR p_units IS NULL OR p_units=0 OR abs(p_units)>100000 OR (p_kind<>'adjustment' AND p_units<0) OR length(coalesce(p_reason,'')) NOT BETWEEN 12 AND 1000 OR length(coalesce(p_key,'')) NOT BETWEEN 16 AND 128 THEN RAISE EXCEPTION 'FLEXGUARD_REQUEST_INVALID'; END IF;
 IF (p_kind IN ('purchase','top_up') AND (p_invoice IS NULL OR p_lot IS NOT NULL OR p_source IS NOT NULL OR p_milestone IS NOT NULL)) OR
 (p_kind NOT IN ('purchase','top_up') AND (p_invoice IS NOT NULL OR p_lot IS NULL)) OR
 (p_kind IN ('reservation_release','consumption') AND p_source IS NULL) OR (p_kind='consumption' AND p_milestone IS NULL) OR
 (p_kind<>'consumption' AND p_milestone IS NOT NULL) OR (p_kind IN ('reservation','expiry') AND p_source IS NOT NULL) OR
 (p_kind='adjustment' AND ((p_units>0 AND p_source IS NULL) OR (p_units<0 AND p_source IS NOT NULL))) THEN RAISE EXCEPTION 'FLEXGUARD_REFERENCE_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM rticore_flexguard_events e WHERE e.tenant_id=p_tenant AND e.wallet_id=p_wallet) THEN RAISE EXCEPTION 'FLEXGUARD_LEGACY_RECONCILIATION_REQUIRED'; END IF;
 SELECT * INTO prior FROM rticore_flexguard_requests WHERE tenant_id=p_tenant AND idempotency_key=p_key;
 IF FOUND THEN
  IF prior.legal_entity_id<>p_entity OR prior.wallet_id<>p_wallet OR lower(prior.actor_email)<>lower(p_actor) OR prior.transaction_type<>p_kind OR prior.credit_amount<>p_units OR prior.invoice_id IS DISTINCT FROM p_invoice OR prior.lot_id IS DISTINCT FROM p_lot OR prior.source_tx_id IS DISTINCT FROM p_source OR prior.milestone_id IS DISTINCT FROM p_milestone OR prior.reason<>p_reason THEN RAISE EXCEPTION 'FLEXGUARD_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN jsonb_build_object('id',prior.id,'status',prior.status,'replayed',true);
 END IF;
 INSERT INTO rticore_flexguard_requests(id,tenant_id,legal_entity_id,wallet_id,transaction_type,credit_amount,invoice_id,lot_id,source_tx_id,milestone_id,reason,idempotency_key,actor_email)
 VALUES(rid,p_tenant,p_entity,p_wallet,p_kind,p_units,p_invoice,p_lot,p_source,p_milestone,p_reason,p_key,lower(p_actor));
 RETURN jsonb_build_object('id',rid,'status','pending_approval');
END $fg$;
CREATE OR REPLACE FUNCTION rticore_fg_review(p_tenant text,p_entity text,p_actor text,p_request text,p_approve boolean,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE r rticore_flexguard_requests%ROWTYPE; w record; l rticore_flexguard_credit_lots%ROWTYPE; src rticore_flexguard_enterprise_ledger%ROWTYPE;
 actor_role text; inv record; av bigint; rs bigint; used bigint; restored bigint; val bigint; rate bigint; n bigint;
 da bigint:=0; dr bigint:=0; dc bigint:=0; de bigint:=0; dj bigint:=0; evt text; eid text; payload text; lot text;
 today text:=to_char(CURRENT_DATE,'YYYY-MM-DD'); nowtext text:=CURRENT_TIMESTAMP::text;
BEGIN
 actor_role:=rticore_fg_actor_role(p_tenant,p_entity,p_actor);
 IF actor_role IS NULL OR actor_role NOT IN ('finance','approver','admin') OR length(coalesce(p_notes,'')) NOT BETWEEN 12 AND 1000 OR NOT EXISTS(
 SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=p_tenant AND a.legal_entity_id=p_entity AND lower(a.email)=lower(p_actor) AND a.status='approved' AND a.finance_role IN ('cfo','financial_controller') AND a.can_approve=1 AND a.can_check=1 AND a.business_unit_id IS NULL AND a.department_id IS NULL
 ) THEN RAISE EXCEPTION 'FLEXGUARD_APPROVAL_DENIED'; END IF;
 SELECT * INTO r FROM rticore_flexguard_requests WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=p_request;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_SCOPE_INVALID'; END IF;
 SELECT x.*,c.status AS contract_status,c.end_date,c.project_id,c.model INTO w FROM rticore_flexguard_wallets x
 JOIN rticore_service_contracts c ON c.tenant_id=x.tenant_id AND c.id=x.contract_id AND c.customer_id=x.customer_id
 JOIN rticore_erp_project_scopes sc ON sc.tenant_id=c.tenant_id AND sc.project_id=c.project_id AND sc.legal_entity_id=p_entity AND sc.status='approved'
 WHERE x.tenant_id=p_tenant AND x.id=r.wallet_id AND x.status='active' AND c.model='FlexGuard' FOR UPDATE OF x;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_SCOPE_INVALID'; END IF;
 SELECT * INTO r FROM rticore_flexguard_requests WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=p_request FOR UPDATE;
 IF lower(r.actor_email)=lower(p_actor) THEN RAISE EXCEPTION 'FLEXGUARD_SELF_APPROVAL'; END IF;
 IF r.status<>'pending_approval' THEN RAISE EXCEPTION 'FLEXGUARD_REQUEST_ALREADY_REVIEWED'; END IF;
 IF p_approve IS NOT TRUE THEN UPDATE rticore_flexguard_requests SET status='rejected',approved_by=lower(p_actor),approved_at=nowtext,approval_notes=p_notes WHERE id=r.id; RETURN jsonb_build_object('id',r.id,'status','rejected'); END IF;
 IF rticore_fg_actor_role(p_tenant,p_entity,r.actor_email) IS NULL OR EXISTS(SELECT 1 FROM rticore_flexguard_events WHERE tenant_id=p_tenant AND wallet_id=w.id) THEN RAISE EXCEPTION 'FLEXGUARD_LEGACY_OR_SCOPE_REVIEW_REQUIRED'; END IF;
 n:=abs(r.credit_amount);
 IF r.transaction_type IN ('purchase','top_up') THEN
  IF w.contract_status<>'active' OR w.end_date<today THEN RAISE EXCEPTION 'FLEXGUARD_CONTRACT_INACTIVE'; END IF;
  SELECT i.* INTO inv FROM rticore_billing_invoices i WHERE i.tenant_id=p_tenant AND i.id=r.invoice_id AND i.project_id=w.project_id AND i.status='approved' AND i.reviewed_by IS NOT NULL AND lower(i.reviewed_by)<>lower(i.created_by);
  IF NOT FOUND OR (SELECT coalesce(sum(p.amount_cents),0) FROM rticore_billing_payments p WHERE p.tenant_id=p_tenant AND p.invoice_id=r.invoice_id AND p.status='approved')<inv.amount_cents+inv.vat_cents THEN RAISE EXCEPTION 'FLEXGUARD_PAYMENT_UNVERIFIED'; END IF;
  IF inv.amount_cents%n<>0 THEN RAISE EXCEPTION 'FLEXGUARD_RATE_ROUNDING_REVIEW_REQUIRED'; END IF;
  IF (SELECT coalesce(sum(credits_total),0) FROM rticore_flexguard_credit_lots WHERE tenant_id=p_tenant AND wallet_id=w.id)+n>w.entitlement_units THEN RAISE EXCEPTION 'FLEXGUARD_ENTITLEMENT_EXCEEDED'; END IF;
  IF (r.transaction_type='purchase' AND EXISTS(SELECT 1 FROM rticore_flexguard_credit_lots WHERE tenant_id=p_tenant AND wallet_id=w.id)) OR (r.transaction_type='top_up' AND NOT EXISTS(SELECT 1 FROM rticore_flexguard_credit_lots WHERE tenant_id=p_tenant AND wallet_id=w.id)) THEN RAISE EXCEPTION 'FLEXGUARD_PURCHASE_SEQUENCE'; END IF;
  lot:=gen_random_uuid()::text;rate:=inv.amount_cents/n;val:=inv.amount_cents;da:=n;evt:='flexguard.credit_purchased';
 ELSE
  SELECT * INTO l FROM rticore_flexguard_credit_lots WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND wallet_id=w.id AND id=r.lot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_LOT_SCOPE_INVALID'; END IF;
  lot:=l.id;rate:=l.unit_value_cents;val:=n*rate;
  SELECT coalesce(sum(available_delta),0),coalesce(sum(reserved_delta),0) INTO av,rs FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=p_tenant AND lot_id=lot;
  IF r.transaction_type IN ('reservation','consumption') AND (w.contract_status<>'active' OR l.expires_at<today) THEN RAISE EXCEPTION 'FLEXGUARD_LOT_EXPIRED'; END IF;
  IF r.transaction_type='reservation' THEN da:=-n;dr:=n;
  ELSIF r.transaction_type IN ('reservation_release','consumption') THEN
   SELECT * INTO src FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND wallet_id=w.id AND lot_id=lot AND id=r.source_tx_id AND transaction_type='reservation';
   IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_RESERVATION_SOURCE_INVALID'; END IF;
   SELECT coalesce(sum(credit_amount),0) INTO used FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=p_tenant AND source_tx_id=src.id AND transaction_type IN ('reservation_release','consumption');
   IF used+n>src.credit_amount THEN RAISE EXCEPTION 'FLEXGUARD_RESERVATION_EXCEEDED'; END IF;
   dr:=-n;
   IF r.transaction_type='reservation_release' THEN da:=n;
   ELSE
    IF NOT EXISTS(SELECT 1 FROM rticore_delivery_milestones m JOIN rticore_delivery_projects p ON p.tenant_id=m.tenant_id AND p.id=m.project_id JOIN rticore_document_library d ON d.tenant_id=m.tenant_id AND d.id=m.document_id AND d.opportunity_id=p.opportunity_id AND d.kind='supporting' WHERE m.tenant_id=p_tenant AND m.project_id=w.project_id AND m.id=r.milestone_id AND m.status='accepted' AND m.accepted_by IS NOT NULL AND lower(m.accepted_by)<>lower(m.created_by)) THEN RAISE EXCEPTION 'FLEXGUARD_ACCEPTED_DELIVERY_EVIDENCE_REQUIRED'; END IF;
    dc:=n;evt:='flexguard.credit_consumed';
   END IF;
  ELSIF r.transaction_type='expiry' THEN
   IF l.expires_at>=today THEN RAISE EXCEPTION 'FLEXGUARD_NOT_EXPIRED'; END IF;
   da:=-n;de:=n;evt:='flexguard.credit_expired';
  ELSIF r.transaction_type='adjustment' THEN
   IF r.credit_amount>0 THEN
    IF l.expires_at<today OR w.contract_status<>'active' THEN RAISE EXCEPTION 'FLEXGUARD_LOT_EXPIRED'; END IF;
    SELECT * INTO src FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND wallet_id=w.id AND lot_id=lot AND id=r.source_tx_id AND transaction_type='adjustment' AND credit_amount<0;
    IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_ADJUSTMENT_SOURCE_INVALID'; END IF;
    SELECT coalesce(sum(credit_amount),0) INTO restored FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=p_tenant AND source_tx_id=src.id AND transaction_type='adjustment' AND credit_amount>0;
    IF restored+n>abs(src.credit_amount) THEN RAISE EXCEPTION 'FLEXGUARD_ADJUSTMENT_EXCEEDED'; END IF;
   END IF;
   da:=r.credit_amount;dj:=r.credit_amount;evt:='flexguard.credit_adjusted';
  END IF;
  IF av+da<0 OR rs+dr<0 THEN RAISE EXCEPTION 'FLEXGUARD_INSUFFICIENT_BALANCE'; END IF;
 END IF;
 IF val<=0 OR val>=900000000000000 OR NOT EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=p_tenant AND a.legal_entity_id=p_entity AND lower(a.email)=lower(p_actor) AND a.status='approved' AND a.finance_role IN ('cfo','financial_controller') AND a.can_approve=1 AND a.can_check=1 AND a.business_unit_id IS NULL AND a.department_id IS NULL AND a.approval_limit_cents>=val) THEN RAISE EXCEPTION 'FLEXGUARD_APPROVAL_LIMIT'; END IF;
 IF r.transaction_type IN ('purchase','top_up') THEN
  INSERT INTO rticore_flexguard_credit_lots(id,tenant_id,legal_entity_id,customer_id,contract_id,wallet_id,invoice_id,lot_code,credits_total,unit_value_cents,financial_value_cents,issued_at,expires_at,created_by)
  VALUES(lot,p_tenant,p_entity,w.customer_id,w.contract_id,w.id,r.invoice_id,r.id,n,rate,val,today,w.end_date,r.actor_email);
 END IF;
 IF evt IS NOT NULL THEN
  eid:=gen_random_uuid()::text;
  payload:=jsonb_build_object('wallet_id',w.id,'customer_id',w.customer_id,'contract_id',w.contract_id,'lot_id',lot,'credits',n,'signed_credits',r.credit_amount,'unit_value_cents',rate,'amount_cents',val,'transaction_type',r.transaction_type,'source_tx_id',r.source_tx_id,'invoice_id',r.invoice_id,'milestone_id',r.milestone_id,'approved_by',lower(p_actor),'accounting_status','requires_independent_finance_policy_review','automatic_posting',false)::text;
  INSERT INTO rticore_finance_integration_events(id,tenant_id,legal_entity_id,direction,event_type,source_system,source_document_id,correlation_id,idempotency_key,schema_version,payload_json,payload_sha256,status,event_timestamp)
  VALUES(eid,p_tenant,p_entity,'outbox',evt,'RTICORE',r.id,'FG-'||r.id,'FG-'||r.id,'1.0',payload,encode(sha256(convert_to(payload,'UTF8')),'hex'),'received',nowtext);
 END IF;
 INSERT INTO rticore_flexguard_enterprise_ledger(id,tenant_id,legal_entity_id,customer_id,contract_id,wallet_id,lot_id,transaction_type,credit_amount,unit_value_cents,financial_value_cents,available_delta,reserved_delta,consumed_delta,expired_delta,adjustment_delta,source_tx_id,milestone_id,reference_code,idempotency_key,actor_email,approved_by,approved_at,reason,finance_outbox_event_id)
 VALUES(r.id,p_tenant,p_entity,w.customer_id,w.contract_id,w.id,lot,r.transaction_type,r.credit_amount,rate,val,da,dr,dc,de,dj,r.source_tx_id,r.milestone_id,r.id,r.idempotency_key,r.actor_email,lower(p_actor),nowtext,r.reason,eid);
 UPDATE rticore_flexguard_requests SET status='posted',approved_by=lower(p_actor),approved_at=nowtext,approval_notes=p_notes WHERE id=r.id;
 RETURN jsonb_build_object('id',r.id,'status','posted','lot_id',lot,'financial_value_cents',val,'finance_outbox_event_id',eid,'accounting_status','not_posted_to_gl');
END $fg$;
COMMIT;
