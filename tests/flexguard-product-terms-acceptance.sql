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
-- Exercise the real stored command, not only table guards.
INSERT INTO rticore_finance_role_assignments(id,tenant_id,email,finance_role,legal_entity_id,approval_limit_cents,can_make,can_check,can_approve,status,requested_by,reviewed_by,review_notes)
VALUES ('fg-terms-maker-role','defendit360','fg-terms-maker@example.invalid','finance_manager','fg-terms-a',0,1,0,0,'approved','ci','reviewer','Synthetic assignment'),
('fg-terms-checker-role','defendit360','fg-terms-checker@example.invalid','financial_controller','fg-terms-a',500000,0,1,1,'approved','ci','reviewer','Synthetic assignment');
DO $fg$
DECLARE r jsonb; rid text; payload jsonb:='{"package_code":"FG-COMMAND","package_name":"Command product","version":1,"billing_model":"annual_credits","credits_included":20,"unit_credit_price_cents":10000,"validity_days":365,"effective_from":"2026-11-27","conversions":[{"service_tier":"standard_analyst","multiplier_bps":10000},{"service_tier":"lead_specialist","multiplier_bps":15000}]}'::jsonb;
BEGIN
 r:=rticore_fg_product_command('defendit360','fg-terms-a','fg-terms-maker@example.invalid','create',NULL,payload);
 rid:=r->>'id';
 IF r->>'status'<>'draft' OR (SELECT count(*) FROM rticore_fg_product_conversions WHERE terms_id=rid)<>2 THEN RAISE EXCEPTION 'COMMAND_CREATE_FAILED'; END IF;
 BEGIN
  PERFORM rticore_fg_product_command('defendit360','fg-terms-a','fg-terms-maker@example.invalid','approve',rid,'{"notes":"Synthetic self approval"}');
  RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'FLEXGUARD_SELF_APPROVAL' THEN RAISE; END IF; END;
 BEGIN
  PERFORM rticore_fg_product_command('defendit360','fg-terms-b','fg-terms-maker@example.invalid','create',NULL,payload);
  RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'FLEXGUARD_ACCESS_DENIED' THEN RAISE; END IF; END;
 r:=rticore_fg_product_command('defendit360','fg-terms-a','fg-terms-checker@example.invalid','approve',rid,'{"notes":"Synthetic independent approval"}');
 IF r->>'status'<>'approved' THEN RAISE EXCEPTION 'COMMAND_APPROVAL_FAILED'; END IF;
 BEGIN
  PERFORM rticore_fg_product_command('defendit360','fg-terms-a','fg-terms-maker@example.invalid','create',NULL,jsonb_set(jsonb_set(payload,'{package_code}','"FG-DUPLICATE"'),'{conversions}','[{"service_tier":"standard_analyst","multiplier_bps":10000},{"service_tier":"standard_analyst","multiplier_bps":10000}]'));
  RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 IF EXISTS(SELECT 1 FROM rticore_fg_product_terms WHERE package_code='FG-DUPLICATE') THEN RAISE EXCEPTION 'PARTIAL_PRODUCT_PERSISTED'; END IF;
 IF (SELECT count(*) FROM rticore_operations_events WHERE entity_id=rid AND action IN ('PRODUCT_TERMS_CREATED','PRODUCT_TERMS_APPROVED'))<>2 THEN RAISE EXCEPTION 'AUDIT_MISSING'; END IF;
END $fg$;
ROLLBACK;
