-- =============================================================================
-- RTICORE ? Complete PostgreSQL Schema & Compatibility Layer (Migrations 0001-0045)
-- Compatible with PostgreSQL 16+ and PGlite
-- =============================================================================

CREATE OR REPLACE FUNCTION datetime(val text DEFAULT 'now', mod1 text DEFAULT NULL) RETURNS text AS $$
BEGIN
  IF val = 'now' AND mod1 IS NULL THEN
    RETURN to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS');
  ELSIF val = 'now' AND mod1 IS NOT NULL THEN
    RETURN to_char((NOW() AT TIME ZONE 'UTC') + (mod1::interval), 'YYYY-MM-DD HH24:MI:SS');
  ELSE
    IF mod1 IS NULL THEN
      RETURN to_char(val::timestamp, 'YYYY-MM-DD HH24:MI:SS');
    ELSE
      RETURN to_char((val::timestamp) + (mod1::interval), 'YYYY-MM-DD HH24:MI:SS');
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RETURN val;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION date(val text DEFAULT 'now', mod1 text DEFAULT NULL) RETURNS text AS $$
BEGIN
  IF val = 'now' AND mod1 IS NULL THEN
    RETURN to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
  ELSIF val = 'now' AND mod1 IS NOT NULL THEN
    RETURN to_char((NOW() AT TIME ZONE 'UTC') + (mod1::interval), 'YYYY-MM-DD');
  ELSE
    IF mod1 IS NULL THEN
      RETURN to_char(val::timestamp, 'YYYY-MM-DD');
    ELSE
      RETURN to_char((val::timestamp) + (mod1::interval), 'YYYY-MM-DD');
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RETURN substr(val, 1, 10);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION json_FromText(val text) RETURNS jsonb AS $$
BEGIN
  RETURN val::jsonb;
EXCEPTION WHEN OTHERS THEN
  RETURN '{}'::jsonb;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION json_valid(val text) RETURNS boolean AS $$
BEGIN
  IF val IS NULL THEN RETURN false; END IF;
  PERFORM val::jsonb;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION json_type(val text, path text DEFAULT NULL) RETURNS text AS $$
DECLARE
  j jsonb;
  k text;
BEGIN
  j := val::jsonb;
  IF path IS NOT NULL AND path LIKE '$.%' THEN
    k := substr(path, 3);
    j := j -> k;
  END IF;
  IF j IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_typeof(j);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION json_extract(val text, path text) RETURNS text AS $$
DECLARE
  j jsonb;
  p text[];
BEGIN
  IF val IS NULL THEN RETURN NULL; END IF;
  j := val::jsonb;
  IF path = '$' THEN RETURN val; END IF;
  p := string_to_array(regexp_replace(path, '^\$\.?', ''), '.');
  RETURN j #>> p;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE VIEW sqlite_master AS
SELECT
  CASE WHEN c.relkind = 'r' THEN 'table' WHEN c.relkind = 'v' THEN 'view' WHEN c.relkind = 'i' THEN 'index' ELSE 'other' END AS type,
  c.relname::text AS name,
  c.relname::text AS tbl_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public';


CREATE TABLE IF NOT EXISTS rticore_erp_role_policy_changes(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','marketing','sales','presales','finance','approver','legal','viewer')),
 capability TEXT NOT NULL CHECK(capability IN ('finance_gl','finance_ap','procurement','cyber_ops','resource','hr','audit')),
 from_allowed BIGINT NOT NULL CHECK(from_allowed IN (0,1)),
 to_allowed BIGINT NOT NULL CHECK(to_allowed IN (0,1)),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 12 AND 800),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 version BIGINT NOT NULL DEFAULT 1,requested_by TEXT NOT NULL ,
 reviewed_by TEXT ,review_notes TEXT,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,id),CHECK(from_allowed!=to_allowed),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by)!=lower(requested_by)),
 CHECK(status='pending' OR (reviewed_by IS NOT NULL AND coalesce(length(review_notes),0)>=12))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_erp_role_capability_matrix (
 role TEXT NOT NULL, capability TEXT NOT NULL,
 allowed BIGINT NOT NULL CHECK(allowed IN (0,1)),
 updated_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 PRIMARY KEY(role,capability),
 CHECK(role IN ('admin','marketing','sales','presales','finance','approver','legal','viewer')),
 CHECK(capability IN ('finance_gl','finance_ap','procurement','cyber_ops','resource','hr','audit'))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_erp_role_matrix(
 tenant_id TEXT NOT NULL,role TEXT NOT NULL,capability TEXT NOT NULL,unit_kind TEXT NOT NULL,
 can_request BIGINT NOT NULL DEFAULT 0 CHECK(can_request IN (0,1)),
 can_review BIGINT NOT NULL DEFAULT 0 CHECK(can_review IN (0,1)),
 can_execute BIGINT NOT NULL DEFAULT 0 CHECK(can_execute IN (0,1)),
 version BIGINT NOT NULL DEFAULT 1,approved_by TEXT NOT NULL,approved_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 PRIMARY KEY(tenant_id,role,capability,unit_kind)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_erp_access_changes(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,email TEXT NOT NULL ,capability TEXT NOT NULL,
 unit_id TEXT NOT NULL,operation TEXT NOT NULL CHECK(operation IN ('grant','revoke','suspend')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 requested_by TEXT NOT NULL ,reviewed_by TEXT ,reason TEXT NOT NULL CHECK(length(reason)>=12),
 reviewed_at TEXT,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 CHECK(reviewed_by IS NULL OR (lower(reviewed_by)!=lower(requested_by) AND lower(reviewed_by)!=lower(email)))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_erp_org_units (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, code TEXT NOT NULL,
 label TEXT NOT NULL CHECK(length(label) BETWEEN 3 AND 160),
 kind TEXT NOT NULL CHECK(kind IN ('legal_entity','division','department','team','cost_center')),
 parent_id TEXT, active BIGINT NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,code),
 FOREIGN KEY(tenant_id,parent_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 CHECK(parent_id IS NULL OR parent_id!=id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_admin_options (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 group_key TEXT NOT NULL CHECK(length(group_key) BETWEEN 2 AND 61),
 option_value TEXT NOT NULL CHECK(length(option_value) BETWEEN 2 AND 61),
 option_label TEXT NOT NULL CHECK(length(option_label) BETWEEN 2 AND 120),
 description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=500),
 sort_order BIGINT NOT NULL DEFAULT 100 CHECK(sort_order BETWEEN 0 AND 9999),
 active BIGINT NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),
 updated_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 updated_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,group_key,option_value)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_postal_lookup (
 postal_code TEXT PRIMARY KEY NOT NULL CHECK(length(postal_code)=5),
 areas_json TEXT NOT NULL CHECK(json_valid(areas_json)),
 village_count BIGINT NOT NULL CHECK(village_count>0),
 source_version TEXT NOT NULL
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_postal_import_state (
 singleton BIGINT PRIMARY KEY NOT NULL CHECK(singleton = 1),
 status TEXT NOT NULL CHECK(status = 'ready'),
 source_version TEXT NOT NULL,
 row_count BIGINT NOT NULL CHECK(row_count >= 80000),
 province_count BIGINT NOT NULL CHECK(province_count = 38),
 postal_count BIGINT NOT NULL CHECK(postal_count > 0),
 verified_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_postal_areas (
 region_code TEXT PRIMARY KEY NOT NULL,
 postal_code TEXT NOT NULL CHECK(length(postal_code)=5),
 province_code TEXT NOT NULL,
 province_name TEXT NOT NULL,
 regency_code TEXT NOT NULL,
 regency_name TEXT NOT NULL,
 district_code TEXT NOT NULL,
 district_name TEXT NOT NULL,
 village_name TEXT NOT NULL,
 village_kind TEXT NOT NULL CHECK(village_kind IN ('Desa','Kelurahan')),
 source_version TEXT NOT NULL
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS "rticore_ai_providers" (
 provider_id TEXT PRIMARY KEY CHECK(provider_id IN ('openai','gemini','anthropic','groq','openrouter','deepseek','mistral')),
 model TEXT NOT NULL,
 priority BIGINT NOT NULL,
 enabled BIGINT NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 key_iv TEXT,
 key_ciphertext TEXT,
 tested_at TEXT,
 tested_ok BIGINT CHECK(tested_ok IN (0,1)),
 updated_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 updated_by TEXT NOT NULL
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_report_definitions (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,title TEXT NOT NULL,owner_email TEXT NOT NULL,
 definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),version BIGINT NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),updated_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_number_reservations (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,number TEXT NOT NULL,kind TEXT NOT NULL,period TEXT NOT NULL,
 sequence BIGINT NOT NULL CHECK(sequence>0),actor_email TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,number),UNIQUE(tenant_id,kind,period,sequence)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_setting_versions (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('organization','approval','numbering','template','integration','access')),
 setting_key TEXT NOT NULL,title TEXT NOT NULL,data_json TEXT NOT NULL CHECK(json_valid(data_json)),
 version BIGINT NOT NULL CHECK(version>0),status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','rejected')),
 created_by TEXT NOT NULL,reviewed_by TEXT,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,kind,setting_key,version),CHECK(reviewed_by IS NULL OR lower(reviewed_by)!=lower(created_by))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_operations_events (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, area TEXT NOT NULL, entity_id TEXT NOT NULL,
 action TEXT NOT NULL, actor_email TEXT NOT NULL, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_feasibility_history(
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
 entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 action TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_resource_people(
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT NOT NULL ,
 display_name TEXT NOT NULL, skills TEXT NOT NULL,
 capacity_pd_month DOUBLE PRECISION NOT NULL CHECK(capacity_pd_month>0 AND capacity_pd_month<=31),
 daily_cost_idr DOUBLE PRECISION NOT NULL CHECK(daily_cost_idr>=0 AND daily_cost_idr<1e12),
 active BIGINT NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 version BIGINT NOT NULL DEFAULT 1, created_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,email), UNIQUE(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_document_access_events (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL,
 opportunity_id TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('release','library')),
 document_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('UPLOAD','DOWNLOAD','RETENTION_SET','LEGAL_HOLD_SET','LEGAL_HOLD_RELEASE')),
 actor_email TEXT NOT NULL,
 actor_role TEXT NOT NULL,
 description TEXT,
 event_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_tender_readiness_history(
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
 entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 archived_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_procurement_history(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),archived_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_vendors(
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, legal_name TEXT NOT NULL, registration_number TEXT NOT NULL,
 contact_email TEXT NOT NULL, capabilities TEXT NOT NULL, capacity_units DOUBLE PRECISION NOT NULL CHECK(capacity_units>0 AND capacity_units<1e9),
 capacity_unit TEXT NOT NULL, evidence_reference TEXT NOT NULL, evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64),
 valid_until TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','validated','rejected','suspended')),
 version BIGINT NOT NULL DEFAULT 1, created_by TEXT NOT NULL , reviewed_by TEXT, review_notes TEXT,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), reviewed_at TEXT,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,registration_number),
 CHECK(status!='validated' OR (reviewed_by IS NOT NULL AND lower(reviewed_by)!=lower(created_by)))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_team_managers (
 tenant_id TEXT NOT NULL,
 sales_email TEXT NOT NULL ,
 manager_email TEXT NOT NULL ,
 assigned_by TEXT NOT NULL ,
 assigned_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 PRIMARY KEY(tenant_id,sales_email),
 CHECK(sales_email<>manager_email)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_activity_policy (
 tenant_id TEXT PRIMARY KEY,
 lead_response_minutes BIGINT NOT NULL DEFAULT 120 CHECK(lead_response_minutes BETWEEN 15 AND 10080),
 escalation_minutes BIGINT NOT NULL DEFAULT 60 CHECK(escalation_minutes BETWEEN 0 AND 10080),
 reminder_minutes BIGINT NOT NULL DEFAULT 30 CHECK(reminder_minutes BETWEEN 0 AND 10080)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_po_check_history(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,opportunity_id TEXT NOT NULL,snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 archived_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_tx_guards(id TEXT PRIMARY KEY, ok BIGINT NOT NULL CHECK(ok=1), rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_schema_file_manifest (
 path TEXT PRIMARY KEY NOT NULL,
 source_branch TEXT NOT NULL,
 applied_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_marketing_campaigns (
 id TEXT PRIMARY KEY NOT NULL,
 tenant_id TEXT NOT NULL,
 code TEXT NOT NULL,
 name TEXT NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN ('webinar','event','partnership','outbound','referral','digital','other')),
 status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','paused','completed','cancelled')),
 owner_email TEXT NOT NULL ,
 budget_idr BIGINT NOT NULL DEFAULT 0 CHECK(budget_idr>=0),
 start_date TEXT NOT NULL DEFAULT '',
 end_date TEXT NOT NULL DEFAULT '',
 notes TEXT NOT NULL DEFAULT '',
 revision BIGINT NOT NULL DEFAULT 1 CHECK(revision>=1),
 created_by TEXT NOT NULL ,
 updated_by TEXT NOT NULL ,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 updated_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,code)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_marketing_leads (
 id TEXT PRIMARY KEY NOT NULL,
 tenant_id TEXT NOT NULL,
 lead_number TEXT NOT NULL,
 account_name TEXT NOT NULL,
 source TEXT NOT NULL,
 campaign TEXT NOT NULL DEFAULT '',
 service_family TEXT NOT NULL,
 contact_name TEXT NOT NULL DEFAULT '',
 contact_email TEXT NOT NULL DEFAULT '',
 assigned_sales_email TEXT NOT NULL ,
 estimated_value_idr BIGINT NOT NULL DEFAULT 0 CHECK(estimated_value_idr>=0),
 expected_closing_date TEXT NOT NULL DEFAULT '',
 qualification_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(qualification_json)),
 status TEXT NOT NULL DEFAULT 'new'
 CHECK(status IN ('new','assigned','qualified','disqualified','converted')),
 created_by TEXT NOT NULL ,
 updated_by TEXT NOT NULL ,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 updated_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), request_key TEXT, campaign_id TEXT REFERENCES rticore_marketing_campaigns(id), version BIGINT NOT NULL DEFAULT 1 CHECK(version>=1),
 UNIQUE(tenant_id,lead_number)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS "rticore_members" (
 email TEXT PRIMARY KEY NOT NULL ,
 role TEXT NOT NULL CHECK(role IN ('admin','marketing','finance','presales','sales','approver','legal','project_manager','viewer')),
 active BIGINT NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 created_by TEXT
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_accounts (
 id TEXT PRIMARY KEY NOT NULL,
 tenant_id TEXT NOT NULL,
 legal_name TEXT NOT NULL,
 customer_number TEXT NOT NULL,
 data_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data_json)),
 created_by TEXT NOT NULL ,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,customer_number)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_ai_audit (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, opportunity_id TEXT,
 purpose TEXT NOT NULL, provider_id TEXT NOT NULL, model TEXT NOT NULL,
 actor_email TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_documents (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
 kind TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','verified','superseded')),
 reference TEXT NOT NULL, version BIGINT NOT NULL DEFAULT 1, 
 checklist_json TEXT NOT NULL DEFAULT '[]', created_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_activities (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, opportunity_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('call','email','meeting','follow_up','tender','note')),
 subject TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', next_action_at TEXT,
 created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_audit (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, entity_type TEXT NOT NULL,
 entity_id TEXT NOT NULL, action TEXT NOT NULL, from_stage TEXT, to_stage TEXT,
 actor_email TEXT NOT NULL, summary TEXT, created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_ai_config_audit (
 id BIGSERIAL PRIMARY KEY,
 actor_email TEXT NOT NULL,
 provider_id TEXT NOT NULL,
 action TEXT NOT NULL,
 happened_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_catalog(
 sku TEXT PRIMARY KEY, category TEXT NOT NULL, description TEXT NOT NULL, unit TEXT NOT NULL,
 vendor TEXT, license_status TEXT NOT NULL DEFAULT 'verification_required',
 active BIGINT NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_audit_log(
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, boq_id TEXT, action TEXT NOT NULL,
 actor_email TEXT NOT NULL, summary TEXT,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_boq(
 id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL DEFAULT 'defendit360',
 project_name TEXT NOT NULL, customer_name TEXT NOT NULL, quotation_number TEXT NOT NULL,
 service_type TEXT NOT NULL, opportunity_id TEXT,
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected','archived')),
 currency TEXT NOT NULL DEFAULT 'IDR',
 vat_rate DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK(vat_rate>=0 AND vat_rate<=1),
 payment_terms TEXT NOT NULL DEFAULT '30-50-20',
 line_items_json TEXT NOT NULL DEFAULT '[]',
 cost_items_json TEXT NOT NULL DEFAULT '[]',
 notes TEXT, created_by TEXT NOT NULL, updated_by TEXT NOT NULL,
 approved_by TEXT, created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 updated_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), edit_seq BIGINT NOT NULL DEFAULT 0,
 UNIQUE(tenant_id,quotation_number,version), rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_schema_migrations(
 version BIGINT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_security_connectors(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,legal_entity_id TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 3 AND 120),
 kind TEXT NOT NULL CHECK(kind IN ('siem','edr')),
 endpoint TEXT NOT NULL CHECK(endpoint LIKE 'https://%'),
 status TEXT NOT NULL DEFAULT 'disabled' CHECK(status IN ('disabled','enabled')),
 created_by TEXT NOT NULL ,
 reviewed_by TEXT ,
 review_notes TEXT,version BIGINT NOT NULL DEFAULT 1,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,legal_entity_id,name),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 CHECK(status='disabled' OR (reviewed_by IS NOT NULL AND lower(reviewed_by)!=lower(created_by) AND coalesce(length(review_notes),0)>=12))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_hr_leave_policies(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,legal_entity_id TEXT NOT NULL,
 leave_type TEXT NOT NULL CHECK(leave_type IN ('annual','sick','unpaid','special')),
 calendar_year BIGINT NOT NULL CHECK(calendar_year BETWEEN 2020 AND 2150),
 days_entitlement BIGINT NOT NULL CHECK(days_entitlement>=0 AND days_entitlement<=365),
 created_by TEXT NOT NULL,approved_by TEXT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,legal_entity_id,leave_type,calendar_year),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 CHECK(status!='approved' OR (approved_by IS NOT NULL AND lower(approved_by)!=lower(created_by)))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_hr_employees(
 tenant_id TEXT NOT NULL,email TEXT NOT NULL ,
 employment_type TEXT NOT NULL CHECK(employment_type IN ('permanent','contract','intern','external')),
 start_date TEXT NOT NULL,end_date TEXT,
 status TEXT NOT NULL DEFAULT 'onboarding' CHECK(status IN ('onboarding','active','offboarded')),
 version BIGINT NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL ,
 approved_by TEXT ,reason TEXT,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 PRIMARY KEY(tenant_id,email),FOREIGN KEY(email) REFERENCES rticore_members(email),
 CHECK(end_date IS NULL OR end_date>=start_date)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_procurement_budgets(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,legal_entity_id TEXT NOT NULL,
 period TEXT NOT NULL CHECK(period ~ '^20[0-9][0-9]-[0-1][0-9]$'),
 code TEXT NOT NULL,limit_cents BIGINT NOT NULL CHECK(limit_cents>0 AND limit_cents<9000000000000000),
 created_by TEXT NOT NULL,approved_by TEXT,approved_at TEXT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,legal_entity_id,period,code),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 CHECK(status!='approved' OR (approved_by IS NOT NULL AND lower(approved_by)!=lower(created_by)))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_erp_hr_employee_profiles(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,email TEXT NOT NULL ,
 employment_status TEXT NOT NULL CHECK(employment_status IN ('onboarding','active','leave','offboarding','terminated')),
 employee_number TEXT NOT NULL,hire_date TEXT NOT NULL,
 created_by TEXT NOT NULL ,
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,email),UNIQUE(tenant_id,employee_number),
 FOREIGN KEY(email) REFERENCES rticore_members(email)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_gl_periods (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,legal_entity_id TEXT NOT NULL,
 period TEXT NOT NULL CHECK(period ~ '^20[0-9][0-9]-[0-1][0-9]$'),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 created_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,legal_entity_id,period),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_gl_accounts (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,legal_entity_id TEXT NOT NULL,
 code TEXT NOT NULL,name TEXT NOT NULL CHECK(length(name) BETWEEN 3 AND 160),
 category TEXT NOT NULL CHECK(category IN ('asset','liability','equity','revenue','expense')),
 active BIGINT NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,legal_entity_id,code),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_erp_capability_grants (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT NOT NULL ,
 capability TEXT NOT NULL CHECK(capability IN ('finance_gl','finance_ap','procurement','cyber_ops','resource','hr','audit')),
 unit_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','revoked')),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),
 requested_by TEXT NOT NULL ,
 reviewed_by TEXT , review_notes TEXT,
 created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), reviewed_at TEXT,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,email,capability,unit_id),
 FOREIGN KEY(email) REFERENCES rticore_members(email),
 FOREIGN KEY(tenant_id,unit_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 CHECK(reviewed_by IS NULL OR (lower(reviewed_by)!=lower(requested_by) AND lower(reviewed_by)!=lower(email))),
 CHECK(status NOT IN ('approved','rejected','revoked') OR (reviewed_by IS NOT NULL AND coalesce(length(review_notes),0)>=12))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_erp_staff_org (
 tenant_id TEXT NOT NULL, email TEXT NOT NULL , unit_id TEXT NOT NULL,
 position_title TEXT NOT NULL CHECK(length(position_title) BETWEEN 3 AND 120),
 created_by TEXT NOT NULL , created_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 version BIGINT NOT NULL DEFAULT 1,reviewed_by TEXT ,review_notes TEXT,
 PRIMARY KEY(tenant_id,email), FOREIGN KEY(email) REFERENCES rticore_members(email),
 FOREIGN KEY(tenant_id,unit_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 CHECK(reviewed_by IS NULL OR (lower(reviewed_by)!=lower(created_by) AND lower(reviewed_by)!=lower(email))),
 CHECK(status='pending' OR (reviewed_by IS NOT NULL AND coalesce(length(review_notes),0)>=12))
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_customer_relations(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,child_id TEXT NOT NULL,parent_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('subsidiary','branch')),created_by TEXT NOT NULL,
 UNIQUE(tenant_id,child_id),CHECK(child_id!=parent_id),
 FOREIGN KEY(tenant_id,child_id) REFERENCES rticore_sales_accounts(tenant_id,id),
 FOREIGN KEY(tenant_id,parent_id) REFERENCES rticore_sales_accounts(tenant_id,id)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_member_orgs(email TEXT PRIMARY KEY ,unit_key TEXT NOT NULL,updated_by TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),FOREIGN KEY(email) REFERENCES rticore_members(email), rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_sales_targets (
 tenant_id TEXT NOT NULL,
 period TEXT NOT NULL CHECK(length(period)=7 AND period ~ '^[0-9][0-9][0-9][0-9]-[0-9][0-9]$'),
 owner_email TEXT NOT NULL ,
 amount_idr BIGINT NOT NULL CHECK(amount_idr>0 AND amount_idr<100000000000000),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>=1),
 rationale TEXT NOT NULL CHECK(length(trim(rationale)) BETWEEN 12 AND 1000),
 updated_by TEXT NOT NULL ,
 updated_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
 PRIMARY KEY(tenant_id,period,owner_email),
 FOREIGN KEY(owner_email) REFERENCES rticore_members(email)
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_lead_sla_history(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,lead_id TEXT NOT NULL REFERENCES rticore_marketing_leads(id),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),archived_at TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
, rowid BIGSERIAL);

CREATE TABLE IF NOT EXISTS rticore_lead_intelligence_events(
 id TEXT PRIMARY KEY NOT NULL,
 tenant_id TEXT NOT NULL,
 lead_id TEXT NOT NULL REFERENCES rticore_marketing_leads(id),
 event_type TEXT NOT NULL CHECK(event_type IN ('DISQUALIFY','PLAN','TOUCH','PAUSE','RESUME','REACTIVATE','COMPLETE')),
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

