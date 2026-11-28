-- 0076: fail-closed Finance acknowledgement and acquisition evidence checks.
-- No historical data mutations; missing outbox remains an explicit corrective-review exception.
BEGIN;
CREATE OR REPLACE FUNCTION rticore_fg_independent_posting(p_maker text,p_checker text,p_poster text,p_posted_at text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fg$
 SELECT coalesce(nullif(btrim(p_maker),'') IS NOT NULL AND nullif(btrim(p_checker),'') IS NOT NULL AND nullif(btrim(p_poster),'') IS NOT NULL AND nullif(btrim(p_posted_at),'') IS NOT NULL AND lower(btrim(p_maker))<>lower(btrim(p_checker)) AND lower(btrim(p_maker))<>lower(btrim(p_poster)) AND lower(btrim(p_checker))<>lower(btrim(p_poster)),false)
$fg$;
CREATE OR REPLACE FUNCTION rticore_fg_dock(p_tenant text,p_entity text,p_actor text,p_event text,p_action text,p_rule text,p_period text,p_journal text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE e rticore_finance_integration_events%ROWTYPE; l rticore_flexguard_enterprise_ledger%ROWTYPE; lot rticore_flexguard_credit_lots%ROWTYPE;
 link rticore_fg_finance_links%ROWTYPE; rule rticore_finance_posting_rules%ROWTYPE; j rticore_gl_journals%ROWTYPE; periodrow rticore_gl_periods%ROWTYPE;
 role text; event_policy text; debit_category text; credit_category text; jid text; line1 text; line2 text; gross bigint; net bigint; today text:=to_char(CURRENT_DATE,'YYYY-MM-DD');
BEGIN
 role:=rticore_fg_actor_role(p_tenant,p_entity,p_actor);
 IF role IS NULL OR role NOT IN ('finance','approver') THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
 SELECT * INTO e FROM rticore_finance_integration_events WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=p_event AND direction='outbox' AND source_system='RTICORE' AND event_type IN ('flexguard.credit_purchased','flexguard.credit_consumed','flexguard.credit_expired','flexguard.credit_adjusted') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_SCOPE_INVALID'; END IF;
 SELECT * INTO l FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=e.source_document_id AND finance_outbox_event_id=e.id;
 IF NOT FOUND OR e.payload_sha256<>encode(sha256(convert_to(e.payload_json,'UTF8')),'hex') OR e.payload_json::jsonb->>'wallet_id' IS DISTINCT FROM l.wallet_id OR e.payload_json::jsonb->>'lot_id' IS DISTINCT FROM l.lot_id OR e.payload_json::jsonb->>'amount_cents' IS DISTINCT FROM l.financial_value_cents::text OR e.payload_json::jsonb->>'unit_value_cents' IS DISTINCT FROM l.unit_value_cents::text OR e.payload_json::jsonb->>'signed_credits' IS DISTINCT FROM l.credit_amount::text OR e.payload_json::jsonb->>'transaction_type' IS DISTINCT FROM l.transaction_type THEN RAISE EXCEPTION 'FLEXGUARD_DOCKING_INTEGRITY_INVALID'; END IF;
 IF NOT ((e.event_type='flexguard.credit_purchased' AND l.transaction_type IN ('purchase','top_up')) OR (e.event_type='flexguard.credit_consumed' AND l.transaction_type='consumption') OR (e.event_type='flexguard.credit_expired' AND l.transaction_type='expiry') OR (e.event_type='flexguard.credit_adjusted' AND l.transaction_type='adjustment')) THEN RAISE EXCEPTION 'FLEXGUARD_DOCKING_EVENT_INVALID'; END IF;
 SELECT * INTO lot FROM rticore_flexguard_credit_lots WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=l.lot_id AND wallet_id=l.wallet_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_SCOPE_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rticore_fg_invoice_allocations a WHERE a.tenant_id=lot.tenant_id AND a.legal_entity_id=lot.legal_entity_id AND a.wallet_id=lot.wallet_id AND a.invoice_id=lot.invoice_id AND a.status='approved' AND a.credits=lot.credits_total AND a.net_cents=lot.financial_value_cents) THEN RAISE EXCEPTION 'FLEXGUARD_APPROVED_INVOICE_ALLOCATION_REQUIRED'; END IF;
 net:=l.financial_value_cents;gross:=net;
 SELECT * INTO link FROM rticore_fg_finance_links WHERE tenant_id=p_tenant AND event_id=e.id;
 IF p_action='ack' THEN
  IF role<>'approver' OR NOT EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=p_tenant AND a.legal_entity_id=p_entity AND lower(a.email)=lower(p_actor) AND a.status='approved' AND a.finance_role IN ('cfo','financial_controller') AND a.can_check=1 AND a.can_approve=1 AND a.approval_limit_cents>=net AND a.business_unit_id IS NULL AND a.department_id IS NULL) THEN RAISE EXCEPTION 'FLEXGUARD_APPROVAL_DENIED'; END IF;
  IF link.event_id IS NULL OR link.legal_entity_id<>p_entity OR lower(link.linked_by)=lower(p_actor) THEN RAISE EXCEPTION 'FLEXGUARD_DOCKING_LINK_REQUIRED'; END IF;
  IF e.status NOT IN ('validated','processed') THEN RAISE EXCEPTION 'FLEXGUARD_DOCKING_STATUS_INVALID'; END IF;
  IF e.resulting_journal_id IS DISTINCT FROM link.journal_id OR link.net_amount_cents IS DISTINCT FROM net THEN RAISE EXCEPTION 'FLEXGUARD_DOCKING_INTEGRITY_INVALID'; END IF;
  SELECT * INTO j FROM rticore_gl_journals WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=link.journal_id;
  IF NOT FOUND OR j.status IS DISTINCT FROM 'posted' OR NOT rticore_fg_independent_posting(j.created_by,j.reviewed_by,j.posted_by,j.posted_at) THEN RAISE EXCEPTION 'FLEXGUARD_POSTED_JOURNAL_REQUIRED'; END IF;
  IF (SELECT coalesce(sum(debit_cents),0) FROM rticore_gl_lines WHERE tenant_id=p_tenant AND journal_id=j.id AND account_id=link.debit_account_id)<>link.gross_debit_cents OR
   (SELECT coalesce(sum(credit_cents),0) FROM rticore_gl_lines WHERE tenant_id=p_tenant AND journal_id=j.id AND account_id=link.credit_account_id)<>link.net_amount_cents OR
   (SELECT coalesce(sum(debit_cents),0) FROM rticore_gl_lines WHERE tenant_id=p_tenant AND journal_id=j.id)<>link.gross_debit_cents OR
   (SELECT coalesce(sum(credit_cents),0) FROM rticore_gl_lines WHERE tenant_id=p_tenant AND journal_id=j.id)<>link.gross_debit_cents THEN RAISE EXCEPTION 'FLEXGUARD_JOURNAL_RECONCILIATION_FAILED'; END IF;
  IF j.source_type='flexguard' AND NOT EXISTS(SELECT 1 FROM rticore_finance_journal_workflows w WHERE w.tenant_id=j.tenant_id AND w.legal_entity_id=j.legal_entity_id AND w.journal_id=j.id AND w.lifecycle_stage='posted' AND w.approved_by=j.reviewed_by AND w.posted_by=j.posted_by) THEN RAISE EXCEPTION 'FLEXGUARD_POSTED_WORKFLOW_REQUIRED'; END IF;
  IF e.status='processed' THEN
   IF nullif(btrim(e.processed_by),'') IS NULL OR nullif(btrim(e.processed_at::text),'') IS NULL OR lower(btrim(e.processed_by))=lower(btrim(link.linked_by)) THEN RAISE EXCEPTION 'FLEXGUARD_DOCKING_INTEGRITY_INVALID'; END IF;
   RETURN jsonb_build_object('status','processed','journal_id',link.journal_id,'replayed',true);
  END IF;
  UPDATE rticore_finance_integration_events SET status='processed',resulting_journal_id=j.id,processed_by=lower(p_actor),processed_at=CURRENT_TIMESTAMP::text,error_message=NULL WHERE tenant_id=p_tenant AND id=e.id;
  INSERT INTO rticore_operations_events(id,tenant_id,area,entity_id,action,actor_email,snapshot_json) VALUES(gen_random_uuid()::text,p_tenant,'flexguard',e.id,'FINANCE_ACK',lower(p_actor),jsonb_build_object('journal_id',j.id,'amount_cents',net)::text);
  RETURN jsonb_build_object('status','processed','journal_id',j.id);
 END IF;
 IF role<>'finance' OR NOT EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=p_tenant AND a.legal_entity_id=p_entity AND lower(a.email)=lower(p_actor) AND a.status='approved' AND a.can_make=1 AND a.finance_role IN ('financial_controller','finance_manager','accounting_officer') AND a.business_unit_id IS NULL AND a.department_id IS NULL) THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
 IF p_action NOT IN ('draft','link_purchase') OR e.status NOT IN ('received','validated') THEN RAISE EXCEPTION 'FLEXGUARD_DOCKING_STATUS_INVALID'; END IF;
 IF link.event_id IS NOT NULL THEN
  IF link.rule_id IS DISTINCT FROM p_rule OR (p_journal IS NOT NULL AND p_journal<>link.journal_id) THEN RAISE EXCEPTION 'FLEXGUARD_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN jsonb_build_object('status','validated','journal_id',link.journal_id,'replayed',true);
 END IF;
 event_policy:=CASE WHEN e.event_type='flexguard.credit_adjusted' THEN e.event_type||CASE WHEN l.credit_amount>0 THEN '.positive' ELSE '.negative' END ELSE e.event_type END;
 SELECT * INTO rule FROM rticore_finance_posting_rules WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=p_rule AND business_event=event_policy AND status='approved' AND effective_from<=today AND (effective_to IS NULL OR effective_to>=today) AND approved_by IS NOT NULL AND lower(approved_by)<>lower(created_by) AND service_category IN ('*','FlexGuard') AND tax_treatment IN ('*','IDR');
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_APPROVED_ACCOUNTING_POLICY_REQUIRED'; END IF;
 SELECT category INTO debit_category FROM rticore_gl_accounts a WHERE a.tenant_id=p_tenant AND a.legal_entity_id=p_entity AND a.id=rule.debit_account_id AND a.active=1 AND NOT EXISTS(SELECT 1 FROM rticore_finance_coa_hierarchy h WHERE h.tenant_id=a.tenant_id AND h.account_id=a.id AND h.is_header=1);
 SELECT category INTO credit_category FROM rticore_gl_accounts a WHERE a.tenant_id=p_tenant AND a.legal_entity_id=p_entity AND a.id=rule.credit_account_id AND a.active=1 AND NOT EXISTS(SELECT 1 FROM rticore_finance_coa_hierarchy h WHERE h.tenant_id=a.tenant_id AND h.account_id=a.id AND h.is_header=1);
 IF debit_category IS NULL OR credit_category IS NULL THEN RAISE EXCEPTION 'FLEXGUARD_POSTING_ACCOUNT_INVALID'; END IF;
 IF e.event_type='flexguard.credit_purchased' THEN
  -- Never create another invoice/receivable journal: link original posted invoice source.
  IF p_action<>'link_purchase' OR p_journal IS NULL OR debit_category<>'asset' OR credit_category<>'liability' THEN RAISE EXCEPTION 'FLEXGUARD_EXISTING_INVOICE_JOURNAL_REQUIRED'; END IF;
  SELECT i.amount_cents+i.vat_cents INTO gross FROM rticore_billing_invoices i WHERE i.tenant_id=p_tenant AND i.id=lot.invoice_id AND i.status='approved' AND i.amount_cents=net;
  IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_INVOICE_INVALID'; END IF;
  SELECT * INTO j FROM rticore_gl_journals WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=p_journal AND source_type='ar' AND source_key=lot.invoice_id AND status='posted';
  IF NOT FOUND OR NOT rticore_fg_independent_posting(j.created_by,j.reviewed_by,j.posted_by,j.posted_at) THEN RAISE EXCEPTION 'FLEXGUARD_POSTED_JOURNAL_REQUIRED'; END IF;
  IF (SELECT coalesce(sum(debit_cents),0) FROM rticore_gl_lines WHERE tenant_id=p_tenant AND journal_id=j.id AND account_id=rule.debit_account_id)<>gross OR
     (SELECT coalesce(sum(credit_cents),0) FROM rticore_gl_lines WHERE tenant_id=p_tenant AND journal_id=j.id AND account_id=rule.credit_account_id)<>net OR
     (SELECT coalesce(sum(debit_cents),0) FROM rticore_gl_lines WHERE tenant_id=p_tenant AND journal_id=j.id)<>gross OR
     (SELECT coalesce(sum(credit_cents),0) FROM rticore_gl_lines WHERE tenant_id=p_tenant AND journal_id=j.id)<>gross THEN RAISE EXCEPTION 'FLEXGUARD_JOURNAL_RECONCILIATION_FAILED'; END IF;
  jid:=j.id;
 ELSE
  IF p_action<>'draft' OR p_period IS NULL OR p_journal IS NOT NULL THEN RAISE EXCEPTION 'FLEXGUARD_DRAFT_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM rticore_flexguard_enterprise_ledger x JOIN rticore_finance_integration_events y ON y.tenant_id=x.tenant_id AND y.id=x.finance_outbox_event_id JOIN rticore_fg_finance_links f ON f.tenant_id=y.tenant_id AND f.legal_entity_id=y.legal_entity_id AND f.event_id=y.id AND f.journal_id=y.resulting_journal_id JOIN rticore_gl_journals gj ON gj.tenant_id=f.tenant_id AND gj.legal_entity_id=f.legal_entity_id AND gj.id=f.journal_id WHERE x.tenant_id=p_tenant AND x.legal_entity_id=p_entity AND y.legal_entity_id=p_entity AND x.lot_id=lot.id AND x.transaction_type IN ('purchase','top_up') AND y.status='processed' AND f.net_amount_cents=x.financial_value_cents AND gj.status='posted' AND gj.source_type='ar' AND gj.source_key=lot.invoice_id AND rticore_fg_independent_posting(gj.created_by,gj.reviewed_by,gj.posted_by,gj.posted_at)) THEN RAISE EXCEPTION 'FLEXGUARD_PURCHASE_RECONCILIATION_REQUIRED'; END IF;
  IF e.event_type IN ('flexguard.credit_consumed','flexguard.credit_expired') AND (debit_category<>'liability' OR credit_category<>'revenue' OR rule.journal_type<>'revenue_recognition') THEN RAISE EXCEPTION 'FLEXGUARD_POSTING_ACCOUNT_INVALID'; END IF;
  IF e.event_type='flexguard.credit_adjusted' AND rule.journal_type<>'adjustment' THEN RAISE EXCEPTION 'FLEXGUARD_POSTING_ACCOUNT_INVALID'; END IF;
  SELECT * INTO periodrow FROM rticore_gl_periods p WHERE p.tenant_id=p_tenant AND p.legal_entity_id=p_entity AND p.id=p_period AND p.status='open' AND NOT EXISTS(SELECT 1 FROM rticore_finance_period_controls c WHERE c.tenant_id=p.tenant_id AND c.period_id=p.id AND c.close_stage<>'open') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_PERIOD_CLOSED'; END IF;
  jid:=gen_random_uuid()::text;line1:=gen_random_uuid()::text;line2:=gen_random_uuid()::text;
  INSERT INTO rticore_gl_journals(id,tenant_id,legal_entity_id,period_id,source_type,source_key,memo,created_by) VALUES(jid,p_tenant,p_entity,p_period,'flexguard',e.id,'FlexGuard approved policy draft: '||event_policy,lower(p_actor));
  INSERT INTO rticore_gl_lines(id,tenant_id,journal_id,account_id,debit_cents,credit_cents,description) VALUES(line1,p_tenant,jid,rule.debit_account_id,net,0,event_policy),(line2,p_tenant,jid,rule.credit_account_id,0,net,event_policy);
  INSERT INTO rticore_finance_journal_workflows(tenant_id,journal_id,legal_entity_id,journal_type,lifecycle_stage,currency,posting_rule_id,submitted_by,submitted_at) VALUES(p_tenant,jid,p_entity,rule.journal_type,'submitted','IDR',rule.id,lower(p_actor),CURRENT_TIMESTAMP::text);
  INSERT INTO rticore_finance_journal_dimensions(tenant_id,line_id,journal_id,legal_entity_id,project_id,contract_id,customer_id,service_category,currency,foreign_amount_cents,period_code)
   SELECT p_tenant,x.id,jid,p_entity,c.project_id,l.contract_id,l.customer_id,'FlexGuard','IDR',net,periodrow.period FROM (VALUES(line1),(line2)) x(id) JOIN rticore_service_contracts c ON c.tenant_id=p_tenant AND c.id=l.contract_id;
 END IF;
 INSERT INTO rticore_fg_finance_links(tenant_id,legal_entity_id,event_id,journal_id,rule_id,debit_account_id,credit_account_id,net_amount_cents,gross_debit_cents,linked_by) VALUES(p_tenant,p_entity,e.id,jid,rule.id,rule.debit_account_id,rule.credit_account_id,net,gross,lower(p_actor));
 UPDATE rticore_finance_integration_events SET status='validated',resulting_journal_id=jid,error_message=NULL WHERE tenant_id=p_tenant AND id=e.id;
 INSERT INTO rticore_operations_events(id,tenant_id,area,entity_id,action,actor_email,snapshot_json) VALUES(gen_random_uuid()::text,p_tenant,'flexguard',e.id,'FINANCE_JOURNAL_LINK',lower(p_actor),jsonb_build_object('journal_id',jid,'policy',rule.policy_reference,'amount_cents',net)::text);
 RETURN jsonb_build_object('status','validated','journal_id',jid,'automatic_posting',false);
END $fg$;
CREATE OR REPLACE FUNCTION rticore_fg_event_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
BEGIN
 IF OLD.direction='outbox' AND OLD.source_system='RTICORE' AND OLD.event_type IN ('flexguard.credit_purchased','flexguard.credit_consumed','flexguard.credit_expired','flexguard.credit_adjusted') THEN
  IF (to_jsonb(OLD)-ARRAY['status','retry_count','error_message','resulting_journal_id','processed_at','processed_by']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','retry_count','error_message','resulting_journal_id','processed_at','processed_by']) THEN RAISE EXCEPTION 'FLEXGUARD_OUTBOX_IMMUTABLE'; END IF;
  IF OLD.status='processed' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.processed_by IS DISTINCT FROM OLD.processed_by OR NEW.processed_at IS DISTINCT FROM OLD.processed_at) THEN RAISE EXCEPTION 'FLEXGUARD_OUTBOX_IMMUTABLE'; END IF;
  IF OLD.resulting_journal_id IS NOT NULL AND NEW.resulting_journal_id IS DISTINCT FROM OLD.resulting_journal_id THEN RAISE EXCEPTION 'FLEXGUARD_OUTBOX_LINK_IMMUTABLE'; END IF;
  IF NEW.status='processed' AND NOT EXISTS(SELECT 1 FROM rticore_fg_finance_links f JOIN rticore_gl_journals j ON j.tenant_id=f.tenant_id AND j.legal_entity_id=f.legal_entity_id AND j.id=f.journal_id AND j.status='posted'
   WHERE f.tenant_id=OLD.tenant_id AND f.legal_entity_id=OLD.legal_entity_id AND f.event_id=OLD.id AND f.journal_id=NEW.resulting_journal_id AND nullif(btrim(NEW.processed_at::text),'') IS NOT NULL AND nullif(btrim(NEW.processed_by),'') IS NOT NULL AND lower(btrim(NEW.processed_by))<>lower(btrim(f.linked_by))
    AND rticore_fg_independent_posting(j.created_by,j.reviewed_by,j.posted_by,j.posted_at)
    AND (j.source_type='ar' OR EXISTS(SELECT 1 FROM rticore_finance_journal_workflows w WHERE w.tenant_id=j.tenant_id AND w.journal_id=j.id AND w.legal_entity_id=j.legal_entity_id AND w.lifecycle_stage='posted' AND w.approved_by=j.reviewed_by AND w.posted_by=j.posted_by))) THEN RAISE EXCEPTION 'FLEXGUARD_POSTED_WORKFLOW_REQUIRED'; END IF;
 END IF;
 RETURN NEW;
END $fg$;
COMMIT;
