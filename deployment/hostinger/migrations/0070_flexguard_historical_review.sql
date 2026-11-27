-- 0070: current-date corrective allocation review, never backdate or change ledger.
BEGIN;
CREATE OR REPLACE FUNCTION rticore_fg_historical_allocation_candidates(p_tenant text,p_entity text,p_actor text)
RETURNS TABLE(lot_id text,wallet_id text,invoice_id text,credits bigint,net_cents bigint,invoice_document_id text,invoice_sha256 text,allocation_status text,source_metadata_complete boolean) LANGUAGE plpgsql STABLE SET search_path=public,pg_catalog AS $fg$
BEGIN
 IF NOT (rticore_catalog_finance_access(p_tenant,p_entity,p_actor,'make') OR rticore_catalog_finance_access(p_tenant,p_entity,p_actor,'approve')) THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
 RETURN QUERY SELECT l.id,l.wallet_id,l.invoice_id,l.credits_total,l.financial_value_cents,i.document_id,d.sha256,coalesce(a.status,'missing'),
 coalesce(i.status='approved' AND i.reviewed_by IS NOT NULL AND lower(i.created_by)<>lower(i.reviewed_by) AND i.amount_cents=l.financial_value_cents AND d.id IS NOT NULL AND sc.status='approved'
 AND (SELECT coalesce(sum(pay.amount_cents),0) FROM rticore_billing_payments pay WHERE pay.tenant_id=i.tenant_id AND pay.invoice_id=i.id AND pay.status='approved' AND pay.reviewed_by IS NOT NULL AND lower(pay.created_by)<>lower(pay.reviewed_by) AND EXISTS(SELECT 1 FROM rticore_document_library pd WHERE pd.tenant_id=pay.tenant_id AND pd.id=pay.document_id AND pd.opportunity_id=p.opportunity_id AND pd.kind='supporting'))>=i.amount_cents+i.vat_cents,false)
 FROM rticore_flexguard_credit_lots l
 JOIN rticore_billing_invoices i ON i.tenant_id=l.tenant_id AND i.id=l.invoice_id
 JOIN rticore_service_contracts c ON c.tenant_id=l.tenant_id AND c.id=l.contract_id AND c.project_id=i.project_id AND c.customer_id=l.customer_id
 JOIN rticore_delivery_projects p ON p.tenant_id=c.tenant_id AND p.id=c.project_id
 JOIN rticore_erp_project_scopes sc ON sc.tenant_id=p.tenant_id AND sc.project_id=p.id AND sc.legal_entity_id=l.legal_entity_id
 LEFT JOIN rticore_document_library d ON d.tenant_id=i.tenant_id AND d.id=i.document_id AND d.opportunity_id=p.opportunity_id AND d.kind='supporting'
 LEFT JOIN rticore_fg_invoice_allocations a ON a.tenant_id=l.tenant_id AND a.invoice_id=l.invoice_id
 WHERE l.tenant_id=p_tenant AND l.legal_entity_id=p_entity AND NOT EXISTS(SELECT 1 FROM rticore_fg_invoice_allocations x WHERE x.tenant_id=l.tenant_id AND x.legal_entity_id=l.legal_entity_id AND x.wallet_id=l.wallet_id AND x.invoice_id=l.invoice_id AND x.credits=l.credits_total AND x.net_cents=l.financial_value_cents AND x.status='approved');
END $fg$;
CREATE OR REPLACE FUNCTION rticore_fg_historical_allocation_review(p_tenant text,p_entity text,p_actor text,p_action text,p_lot text,p_document_sha text,p_notes text) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE ev record; r jsonb;
BEGIN
 IF p_action NOT IN ('submit','approve') OR length(coalesce(p_notes,'')) NOT BETWEEN 12 AND 350 OR p_document_sha IS NULL OR p_document_sha !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'FLEXGUARD_HISTORICAL_REVIEW_INVALID'; END IF;
 IF NOT rticore_catalog_finance_access(p_tenant,p_entity,p_actor,CASE WHEN p_action='submit' THEN 'make' ELSE 'approve' END) THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
 -- Existing allocation command takes a wallet lock; serialize rechecks on the same wallet first.
 PERFORM 1 FROM rticore_flexguard_wallets w JOIN rticore_flexguard_credit_lots l ON l.tenant_id=w.tenant_id AND l.wallet_id=w.id WHERE l.tenant_id=p_tenant AND l.legal_entity_id=p_entity AND l.id=p_lot FOR UPDATE OF w;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_SCOPE_INVALID'; END IF;
 SELECT * INTO ev FROM rticore_fg_historical_allocation_candidates(p_tenant,p_entity,p_actor) v WHERE v.lot_id=p_lot;
 IF NOT FOUND OR NOT ev.source_metadata_complete OR ev.invoice_sha256 IS DISTINCT FROM p_document_sha OR (p_action='submit' AND ev.allocation_status NOT IN ('missing','pending')) OR (p_action='approve' AND ev.allocation_status<>'pending') THEN RAISE EXCEPTION 'FLEXGUARD_HISTORICAL_SOURCE_REVIEW_REQUIRED'; END IF;
 r:=rticore_fg_allocate_invoice(p_tenant,p_entity,p_actor,p_action,ev.wallet_id,ev.invoice_id,CASE WHEN p_action='submit' THEN ev.credits ELSE NULL END,'CURRENT CORRECTIVE REVIEW invoice_sha256='||p_document_sha||' '||p_notes);
 INSERT INTO rticore_operations_events(id,tenant_id,area,entity_id,action,actor_email,snapshot_json)
 VALUES(gen_random_uuid()::text,p_tenant,'flexguard',p_lot,'HISTORICAL_ALLOCATION_'||upper(p_action),lower(p_actor),jsonb_build_object('legal_entity_id',p_entity,'invoice_id',ev.invoice_id,'document_sha256',p_document_sha,'current_review',true)::text);
 RETURN r||jsonb_build_object('lot_id',p_lot,'ledger_changed',false,'journal_posted',false);
END $fg$;
COMMIT;
