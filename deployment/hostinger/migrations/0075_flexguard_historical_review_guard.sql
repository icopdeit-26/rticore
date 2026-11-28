-- 0075: close historical allocation pending-scope/evidence mismatch and duplicate audit replay.
-- No data mutation; retain 0070 unchanged. Historical exceptions remain open until genuine review.
BEGIN;
CREATE OR REPLACE FUNCTION rticore_fg_historical_allocation_review(p_tenant text,p_entity text,p_actor text,p_action text,p_lot text,p_document_sha text,p_notes text) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE ev record; r jsonb; prior rticore_fg_invoice_allocations%ROWTYPE; evidence_prefix text;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('submit','approve') OR length(coalesce(p_notes,'')) NOT BETWEEN 12 AND 350 OR p_document_sha IS NULL OR p_document_sha !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'FLEXGUARD_HISTORICAL_REVIEW_INVALID'; END IF;
 IF NOT rticore_catalog_finance_access(p_tenant,p_entity,p_actor,CASE WHEN p_action='submit' THEN 'make' ELSE 'approve' END) THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
 -- Existing allocation command takes a wallet lock; serialize rechecks on the same wallet first.
 PERFORM 1 FROM rticore_flexguard_wallets w JOIN rticore_flexguard_credit_lots l ON l.tenant_id=w.tenant_id AND l.wallet_id=w.id WHERE l.tenant_id=p_tenant AND l.legal_entity_id=p_entity AND l.id=p_lot FOR UPDATE OF w;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_SCOPE_INVALID'; END IF;
 SELECT * INTO ev FROM rticore_fg_historical_allocation_candidates(p_tenant,p_entity,p_actor) v WHERE v.lot_id=p_lot;
 IF NOT FOUND OR NOT ev.source_metadata_complete OR ev.invoice_sha256 IS DISTINCT FROM p_document_sha OR (p_action='submit' AND ev.allocation_status NOT IN ('missing','pending')) OR (p_action='approve' AND ev.allocation_status<>'pending') THEN RAISE EXCEPTION 'FLEXGUARD_HISTORICAL_SOURCE_REVIEW_REQUIRED'; END IF;
 evidence_prefix:='CURRENT CORRECTIVE REVIEW invoice_sha256='||p_document_sha||' ';
 SELECT * INTO prior FROM rticore_fg_invoice_allocations a WHERE a.tenant_id=p_tenant AND a.invoice_id=ev.invoice_id FOR UPDATE;
 IF FOUND AND (prior.status IS DISTINCT FROM 'pending' OR prior.legal_entity_id IS DISTINCT FROM p_entity OR prior.wallet_id IS DISTINCT FROM ev.wallet_id OR prior.credits IS DISTINCT FROM ev.credits OR prior.net_cents IS DISTINCT FROM ev.net_cents OR left(prior.evidence_ref,length(evidence_prefix)) IS DISTINCT FROM evidence_prefix) THEN
  RAISE EXCEPTION 'FLEXGUARD_HISTORICAL_SOURCE_REVIEW_REQUIRED';
 END IF;
 r:=rticore_fg_allocate_invoice(p_tenant,p_entity,p_actor,p_action,ev.wallet_id,ev.invoice_id,CASE WHEN p_action='submit' THEN ev.credits ELSE NULL END,evidence_prefix||p_notes);
 -- An exact submit replay must not emit a second approval-evidence event.
 IF r->>'replayed'='true' THEN
  RETURN r||jsonb_build_object('lot_id',p_lot,'ledger_changed',false,'journal_posted',false);
 END IF;
 INSERT INTO rticore_operations_events(id,tenant_id,area,entity_id,action,actor_email,snapshot_json)
 VALUES(gen_random_uuid()::text,p_tenant,'flexguard',p_lot,'HISTORICAL_ALLOCATION_'||upper(p_action),lower(p_actor),jsonb_build_object('legal_entity_id',p_entity,'invoice_id',ev.invoice_id,'document_sha256',p_document_sha,'current_review',true)::text);
 RETURN r||jsonb_build_object('lot_id',p_lot,'ledger_changed',false,'journal_posted',false);
END $fg$;
COMMIT;
