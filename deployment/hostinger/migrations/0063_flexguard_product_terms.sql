-- 0063 additive product terms, not a monetary ledger or entitlement grant.
BEGIN;
SET LOCAL lock_timeout='5s';
-- Reject a legacy-shaped ledger rather than silently accepting CREATE IF NOT EXISTS.
DO $fg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rticore_flexguard_credit_lots' AND column_name='invoice_id' AND is_nullable='NO')
 OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='rticore_flexguard_enterprise_ledger' AND column_name='available_delta' AND data_type='bigint')
 OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND ((table_name='rticore_flexguard_credit_lots' AND column_name='lot_kind') OR (table_name='rticore_flexguard_enterprise_ledger' AND column_name='service_request_id')))
 OR to_regprocedure('public.rticore_fg_review(text,text,text,text,boolean,text)') IS NULL
 THEN RAISE EXCEPTION 'FLEXGUARD_NATIVE_SCHEMA_REQUIRED'; END IF;
END $fg$;
CREATE TABLE IF NOT EXISTS rticore_fg_product_terms (
 id text PRIMARY KEY, tenant_id text NOT NULL, legal_entity_id text NOT NULL,
 package_code text NOT NULL CHECK(length(package_code) BETWEEN 3 AND 48),
 package_name text NOT NULL CHECK(length(package_name) BETWEEN 3 AND 160),
 version bigint NOT NULL CHECK(version>0),
 billing_model text NOT NULL CHECK(billing_model IN ('prepaid_mandays','postpaid_mandays','annual_credits','monthly_allocation','quarterly_allocation','retainer','committed_capacity','hybrid_subscription')),
 credits_included bigint NOT NULL CHECK(credits_included BETWEEN 1 AND 100000),
 unit_credit_price_cents bigint NOT NULL CHECK(unit_credit_price_cents BETWEEN 1 AND 899999999999999),
 package_price_cents bigint NOT NULL CHECK(package_price_cents=credits_included*unit_credit_price_cents AND package_price_cents<900000000000000),
 validity_days bigint NOT NULL CHECK(validity_days BETWEEN 30 AND 1825),
 effective_from date NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),
 created_by text NOT NULL, approved_by text, approval_notes text,
 created_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz,
 UNIQUE(tenant_id,legal_entity_id,id), UNIQUE(tenant_id,legal_entity_id,package_code,version),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 CHECK((status='draft' AND approved_by IS NULL AND approval_notes IS NULL AND approved_at IS NULL) OR
 (status='approved' AND approved_by IS NOT NULL AND lower(approved_by)<>lower(created_by) AND coalesce(length(approval_notes),0) BETWEEN 12 AND 1000 AND approved_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS rticore_fg_product_conversions (
 id text PRIMARY KEY, tenant_id text NOT NULL, legal_entity_id text NOT NULL, terms_id text NOT NULL,
 service_tier text NOT NULL CHECK(service_tier IN ('standard_analyst','senior_specialist','lead_specialist','principal_consultant','emergency_response','specialized_forensic','custom')),
 multiplier_bps bigint NOT NULL CHECK(multiplier_bps BETWEEN 5000 AND 50000),
 UNIQUE(tenant_id,legal_entity_id,terms_id,service_tier),
 FOREIGN KEY(tenant_id,legal_entity_id,terms_id) REFERENCES rticore_fg_product_terms(tenant_id,legal_entity_id,id)
);
CREATE OR REPLACE FUNCTION rticore_fg_product_terms_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FLEXGUARD_TERMS_IMMUTABLE'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' OR coalesce(rticore_fg_actor_role(NEW.tenant_id,NEW.legal_entity_id,NEW.created_by),'') NOT IN ('finance','admin') THEN RAISE EXCEPTION 'FLEXGUARD_TERMS_MAKER_DENIED'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status<>'draft' OR NEW.status<>'approved' OR
 (to_jsonb(OLD)-ARRAY['status','approved_by','approval_notes','approved_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','approved_by','approval_notes','approved_at'])
 THEN RAISE EXCEPTION 'FLEXGUARD_TERMS_IMMUTABLE'; END IF;
 IF coalesce(rticore_fg_actor_role(NEW.tenant_id,NEW.legal_entity_id,NEW.approved_by),'') NOT IN ('approver','finance','admin')
 OR lower(NEW.approved_by)=lower(OLD.created_by)
 THEN RAISE EXCEPTION 'FLEXGUARD_TERMS_CHECKER_DENIED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rticore_fg_product_conversions c WHERE c.tenant_id=OLD.tenant_id AND c.legal_entity_id=OLD.legal_entity_id AND c.terms_id=OLD.id)
 THEN RAISE EXCEPTION 'FLEXGUARD_TERMS_CONVERSION_REQUIRED'; END IF;
 RETURN NEW;
END $fg$;
DROP TRIGGER IF EXISTS rticore_fg_product_terms_guard ON rticore_fg_product_terms;
CREATE TRIGGER rticore_fg_product_terms_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_fg_product_terms FOR EACH ROW EXECUTE FUNCTION rticore_fg_product_terms_guard();
CREATE OR REPLACE FUNCTION rticore_fg_product_conversion_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE terms_status text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'FLEXGUARD_CONVERSION_IMMUTABLE'; END IF;
 SELECT t.status INTO terms_status FROM rticore_fg_product_terms t WHERE t.tenant_id=NEW.tenant_id AND t.legal_entity_id=NEW.legal_entity_id AND t.id=NEW.terms_id FOR UPDATE;
 IF terms_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'FLEXGUARD_CONVERSION_DRAFT_REQUIRED'; END IF;
 RETURN NEW;
END $fg$;
DROP TRIGGER IF EXISTS rticore_fg_product_conversion_guard ON rticore_fg_product_conversions;
CREATE TRIGGER rticore_fg_product_conversion_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_fg_product_conversions FOR EACH ROW EXECUTE FUNCTION rticore_fg_product_conversion_guard();
COMMIT;
