\set ON_ERROR_STOP on
BEGIN;
INSERT INTO rticore_erp_org_units(id,tenant_id,code,label,kind,created_by) VALUES('fg-terms-a','defendit360','FG-TERMS-A','Terms A','legal_entity','ci'),('fg-terms-b','defendit360','FG-TERMS-B','Terms B','legal_entity','ci');
INSERT INTO rticore_members(email,role,active,created_by) VALUES('fg-terms-maker@example.invalid','finance',1,'ci'),('fg-terms-checker@example.invalid','approver',1,'ci');
INSERT INTO rticore_erp_staff_org(tenant_id,email,unit_id,position_title,created_by,status,reviewed_by,review_notes) VALUES
('defendit360','fg-terms-maker@example.invalid','fg-terms-a','Finance','ci','approved','reviewer','Synthetic approval'),
('defendit360','fg-terms-checker@example.invalid','fg-terms-a','Checker','ci','approved','reviewer','Synthetic approval');
INSERT INTO rticore_fg_product_terms(id,tenant_id,legal_entity_id,package_code,package_name,version,billing_model,credits_included,unit_credit_price_cents,package_price_cents,validity_days,effective_from,created_by)
VALUES('fg-terms-one','defendit360','fg-terms-a','FG-TEST','Test terms',1,'annual_credits',20,10000,200000,365,'2026-11-27','fg-terms-maker@example.invalid');
DO $fg$
BEGIN
 BEGIN
  UPDATE rticore_fg_product_terms SET status='approved',approved_by='fg-terms-checker@example.invalid',approval_notes='Synthetic approval',approved_at=now() WHERE id='fg-terms-one';
  RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'FLEXGUARD_TERMS_CONVERSION_REQUIRED' THEN RAISE; END IF; END;
 BEGIN
  INSERT INTO rticore_fg_product_conversions VALUES('fg-terms-cross','defendit360','fg-terms-b','fg-terms-one','standard_analyst',10000);
  RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'FLEXGUARD_CONVERSION_DRAFT_REQUIRED' THEN RAISE; END IF; END;
END $fg$;
INSERT INTO rticore_fg_product_conversions VALUES('fg-terms-conv','defendit360','fg-terms-a','fg-terms-one','standard_analyst',10000);
DO $fg$
BEGIN
 BEGIN
  UPDATE rticore_fg_product_terms SET status='approved',approved_by='fg-terms-maker@example.invalid',approval_notes='Synthetic approval',approved_at=now() WHERE id='fg-terms-one';
  RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'FLEXGUARD_TERMS_CHECKER_DENIED' THEN RAISE; END IF; END;
END $fg$;
UPDATE rticore_fg_product_terms SET status='approved',approved_by='fg-terms-checker@example.invalid',approval_notes='Synthetic approval',approved_at=now() WHERE id='fg-terms-one';
DO $fg$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM rticore_fg_product_terms WHERE id='fg-terms-one' AND status='approved') THEN RAISE EXCEPTION 'APPROVAL_MISSING'; END IF;
 BEGIN
  UPDATE rticore_fg_product_terms SET credits_included=21 WHERE id='fg-terms-one';
  RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'FLEXGUARD_TERMS_IMMUTABLE' THEN RAISE; END IF; END;
 BEGIN
  INSERT INTO rticore_fg_product_conversions VALUES('fg-terms-late','defendit360','fg-terms-a','fg-terms-one','lead_specialist',15000);
  RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'FLEXGUARD_CONVERSION_DRAFT_REQUIRED' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM rticore_flexguard_enterprise_ledger WHERE legal_entity_id IN ('fg-terms-a','fg-terms-b')) THEN RAISE EXCEPTION 'UNEXPECTED_LEDGER_MUTATION'; END IF;
END $fg$;
ROLLBACK;
