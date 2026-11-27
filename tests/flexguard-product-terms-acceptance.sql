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
DO $fg$
BEGIN
 IF rticore_fg_contract_binding_valid('defendit360','fg-terms-a','nonexistent-contract','fg-terms-one') THEN RAISE EXCEPTION 'UNEXPECTED_BINDING'; END IF;
 BEGIN
  PERFORM rticore_fg_bind_contract('defendit360','fg-terms-a','fg-terms-maker@example.invalid','create','nonexistent-contract','fg-terms-one',NULL);
  RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'FLEXGUARD_SCOPE_INVALID' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM rticore_fg_contract_terms WHERE legal_entity_id='fg-terms-a') THEN RAISE EXCEPTION 'INVALID_BINDING_PERSISTED'; END IF;
END $fg$;
INSERT INTO rticore_erp_project_scopes(tenant_id,project_id,legal_entity_id,status,requested_by,reviewed_by) VALUES('defendit360','fg-ci-project','fg-terms-a','approved','ci-maker','ci-checker');
INSERT INTO rticore_resource_people(id,tenant_id,email,display_name,skills,capacity_pd_month,daily_cost_idr,created_by) VALUES('fg-ci-person','defendit360','fg-terms-maker@example.invalid','FG CI person','test',20,100,'ci');
INSERT INTO rticore_resource_allocations(id,tenant_id,opportunity_id,person_id,allocation_month,work_role,person_days,daily_cost_snapshot,created_by) VALUES('fg-ci-allocation','defendit360','fg-ci-opportunity','fg-ci-person',to_char(CURRENT_DATE,'YYYY-MM'),'analyst',2,100,'ci');
INSERT INTO rticore_project_timesheets(id,tenant_id,project_id,person_id,allocation_id,work_date,minutes,cost_snapshot_cents,billable,description,created_by)
VALUES('fg-ci-ts','defendit360','fg-ci-project','fg-ci-person','fg-ci-allocation',CURRENT_DATE::text,480,10000,1,'Synthetic approved work','fg-terms-maker@example.invalid');
UPDATE rticore_project_timesheets SET status='approved',version=version+1,reviewed_by='fg-terms-checker@example.invalid',review_notes='Synthetic approved work' WHERE id='fg-ci-ts';
INSERT INTO rticore_finance_integration_events(id,tenant_id,legal_entity_id,direction,event_type,source_system,source_document_id,correlation_id,idempotency_key,payload_json,payload_sha256,event_timestamp)
SELECT 'fg-ci-ts-event','defendit360','fg-terms-a','outbox','timesheet.approved','RTICORE','fg-ci-ts','FG-CI-TS','FG-CI-TS-APPROVED',p,encode(sha256(convert_to(p,'UTF8')),'hex'),CURRENT_TIMESTAMP::text
FROM (SELECT jsonb_build_object('timesheet_id','fg-ci-ts','project_id','fg-ci-project','minutes',480,'billable',true,'cost_snapshot_cents','10000','approved_by','fg-terms-checker@example.invalid')::text p) q;
DO $fg$
DECLARE r jsonb; wid text; lot text; reservation text; rid text; before_n bigint; maker text:='fg-terms-maker@example.invalid'; checker text:='fg-terms-checker@example.invalid';
BEGIN
 r:=rticore_fg_bind_contract('defendit360','fg-terms-a',maker,'create','fg-ci-contract','fg-terms-one',NULL);
 IF r->>'status'<>'draft' THEN RAISE EXCEPTION 'BINDING_DRAFT_FAILED'; END IF;
 r:=rticore_fg_bind_contract('defendit360','fg-terms-a',checker,'approve','fg-ci-contract','fg-terms-one','Synthetic independent binding approval');
 IF r->>'status'<>'approved' OR NOT rticore_fg_contract_binding_valid('defendit360','fg-terms-a','fg-ci-contract','fg-terms-one') THEN RAISE EXCEPTION 'BINDING_POSITIVE_FAILED'; END IF;
 BEGIN
  PERFORM rticore_fg_wallet_command('defendit360','fg-terms-a',maker,'create','fg-ci-contract',21,NULL);
  RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'FLEXGUARD_ENTITLEMENT_BINDING_INVALID' THEN RAISE; END IF; END;
 r:=rticore_fg_bound_wallet_command('defendit360','fg-terms-a',maker,'create','fg-ci-contract',NULL);wid:=r->>'id';
 IF NOT EXISTS(SELECT 1 FROM rticore_flexguard_wallets WHERE id=wid AND entitlement_units=20 AND status='draft') THEN RAISE EXCEPTION 'BOUND_WALLET_FAILED'; END IF;
 r:=rticore_fg_bound_wallet_command('defendit360','fg-terms-a',checker,'approve',wid,'Synthetic wallet approval');
 IF r->>'status'<>'active' THEN RAISE EXCEPTION 'BOUND_WALLET_APPROVAL_FAILED'; END IF;
 PERFORM rticore_fg_allocate_invoice('defendit360','fg-terms-a',maker,'submit',wid,'fg-ci-invoice',20,'Synthetic invoice allocation');
 PERFORM rticore_fg_allocate_invoice('defendit360','fg-terms-a',checker,'approve',wid,'fg-ci-invoice',NULL,'Synthetic allocation approval');
 r:=rticore_fg_submit('defendit360','fg-terms-a',maker,wid,'purchase',20,'fg-ci-invoice',NULL,NULL,NULL,'FG-CI-PURCHASE-0001','Synthetic purchase request');
 r:=rticore_fg_review('defendit360','fg-terms-a',checker,r->>'id',true,'Synthetic purchase approval');lot:=r->>'lot_id';
 r:=rticore_fg_submit('defendit360','fg-terms-a',maker,wid,'reservation',2,NULL,lot,NULL,NULL,'FG-CI-RESERVE-00001','Synthetic reserve request');
 reservation:=r->>'id';PERFORM rticore_fg_review('defendit360','fg-terms-a',checker,reservation,true,'Synthetic reserve approval');
 r:=rticore_fg_psa_submit('defendit360','fg-terms-a',maker,wid,lot,reservation,'fg-ci-milestone','standard_analyst','["fg-ci-ts"]','FG-CI-PSA-CONSUME-1','Synthetic PSA consumption');rid:=r->>'id';
 IF r->>'credits'<>'1' OR r->>'status'<>'pending_approval' OR EXISTS(SELECT 1 FROM rticore_flexguard_enterprise_ledger WHERE id=rid) THEN RAISE EXCEPTION 'PSA_SUBMIT_FAILED'; END IF;
 r:=rticore_fg_psa_submit('defendit360','fg-terms-a',maker,wid,lot,reservation,'fg-ci-milestone','standard_analyst','["fg-ci-ts"]','FG-CI-PSA-CONSUME-1','Synthetic PSA consumption');
 IF r->>'id'<>rid OR r->>'replayed'<>'true' THEN RAISE EXCEPTION 'PSA_REPLAY_FAILED'; END IF;
 SELECT count(*) INTO before_n FROM rticore_flexguard_requests WHERE wallet_id=wid;
 BEGIN
  PERFORM rticore_fg_psa_submit('defendit360','fg-terms-a',maker,wid,lot,reservation,'fg-ci-milestone','standard_analyst','["fg-ci-ts"]','FG-CI-PSA-CONSUME-2','Synthetic duplicate request');
  RAISE EXCEPTION 'UNEXPECTED_SUCCESS';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 IF (SELECT count(*) FROM rticore_flexguard_requests WHERE wallet_id=wid)<>before_n THEN RAISE EXCEPTION 'DUPLICATE_PARTIAL_REQUEST'; END IF;
 r:=rticore_fg_review('defendit360','fg-terms-a',checker,rid,true,'Synthetic PSA independent approval');
 IF r->>'status'<>'posted' OR NOT EXISTS(SELECT 1 FROM rticore_flexguard_enterprise_ledger l JOIN rticore_finance_integration_events e ON e.id=l.finance_outbox_event_id AND e.tenant_id=l.tenant_id WHERE l.id=rid AND l.credit_amount=1 AND l.financial_value_cents=10000 AND e.event_type='flexguard.credit_consumed' AND e.status='received' AND e.resulting_journal_id IS NULL) THEN RAISE EXCEPTION 'PSA_POST_OUTBOX_FAILED'; END IF;
END $fg$;
ROLLBACK;
