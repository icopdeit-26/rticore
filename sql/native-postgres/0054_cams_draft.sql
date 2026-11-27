-- Native PostgreSQL only; apply after 0053 and Finance GL/period/dimension migrations.
BEGIN;
CREATE OR REPLACE FUNCTION cams_create_finance_draft(receipt_id text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r rticore_cams_finance_inbox%ROWTYPE; jid text; pid text; line jsonb; lid text; cc text; maker text := 'cams-finance-service@integration.invalid'; t constant text := 'defendit360';
BEGIN
 SELECT * INTO STRICT r FROM rticore_cams_finance_inbox WHERE id=receipt_id FOR UPDATE;
 SELECT id INTO jid FROM rticore_gl_journals WHERE tenant_id=t AND legal_entity_id=r.legal_entity_id AND source_type='camsrti' AND source_key=r.idempotency_key;
 IF jid IS NOT NULL THEN RETURN jid; END IF;
 IF NOT EXISTS(SELECT 1 FROM rticore_erp_org_units WHERE tenant_id=t AND id=r.legal_entity_id AND kind='legal_entity' AND active=1) THEN RAISE EXCEPTION 'CAMS_ENTITY_INVALID'; END IF;
 SELECT p.id INTO pid FROM rticore_gl_periods p WHERE p.tenant_id=t AND p.legal_entity_id=r.legal_entity_id AND p.period=r.period_code AND p.status='open' AND NOT EXISTS(SELECT 1 FROM rticore_finance_period_controls c WHERE c.tenant_id=p.tenant_id AND c.period_id=p.id AND c.close_stage<>'open') FOR UPDATE OF p;
 IF pid IS NULL THEN RAISE EXCEPTION 'CAMS_PERIOD_NOT_OPEN'; END IF;
 -- Legacy manually created journals must be reconciled instead of duplicated.
 IF EXISTS(SELECT 1 FROM rticore_gl_journals WHERE tenant_id=t AND source_key=r.idempotency_key) THEN RAISE EXCEPTION 'CAMS_LEGACY_JOURNAL_EXISTS'; END IF;
 jid := gen_random_uuid()::text;
 INSERT INTO rticore_gl_journals(id,tenant_id,legal_entity_id,period_id,source_type,source_key,memo,created_by) VALUES(jid,t,r.legal_entity_id,pid,'camsrti',r.idempotency_key,'CAMSRTI receipt '||r.id,maker);
 INSERT INTO rticore_finance_journal_workflows(tenant_id,journal_id,legal_entity_id,journal_type,lifecycle_stage,currency,exchange_rate_micro,submitted_by,submitted_at) VALUES(t,jid,r.legal_entity_id,'general','submitted','IDR',1000000,maker,CURRENT_TIMESTAMP);
 FOR line IN SELECT value FROM jsonb_array_elements(r.mapped_lines_json) LOOP
   lid := gen_random_uuid()::text; cc := line->>'costCenterId';
   IF NOT EXISTS(SELECT 1 FROM rticore_gl_accounts a WHERE a.id=line->>'accountId' AND a.tenant_id=t AND a.legal_entity_id=r.legal_entity_id AND a.active=1 AND NOT EXISTS(SELECT 1 FROM rticore_finance_coa_hierarchy h WHERE h.tenant_id=t AND h.legal_entity_id=r.legal_entity_id AND h.account_id=a.id AND h.is_header=1)) THEN RAISE EXCEPTION 'CAMS_ACCOUNT_INVALID'; END IF;
   IF cc IS NOT NULL AND NOT EXISTS(WITH RECURSIVE scope AS (SELECT id,parent_id,kind,active FROM rticore_erp_org_units WHERE tenant_id=t AND id=cc AND kind='cost_center' AND active=1 UNION SELECT u.id,u.parent_id,u.kind,u.active FROM rticore_erp_org_units u JOIN scope s ON s.parent_id=u.id WHERE u.tenant_id=t AND u.active=1) SELECT 1 FROM scope WHERE id=r.legal_entity_id AND kind='legal_entity') THEN RAISE EXCEPTION 'CAMS_COST_CENTER_INVALID'; END IF;
   INSERT INTO rticore_gl_lines(id,tenant_id,journal_id,account_id,debit_cents,credit_cents,description) VALUES(lid,t,jid,line->>'accountId',(line->>'debit')::bigint,(line->>'credit')::bigint,'CAMSRTI imported line');
   INSERT INTO rticore_finance_journal_dimensions(tenant_id,line_id,journal_id,legal_entity_id,cost_center_id,currency,foreign_amount_cents,period_code) VALUES(t,lid,jid,r.legal_entity_id,cc,'IDR',greatest((line->>'debit')::bigint,(line->>'credit')::bigint),r.period_code);
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM rticore_gl_lines WHERE tenant_id=t AND journal_id=jid GROUP BY journal_id HAVING count(*)>=2 AND sum(debit_cents)=sum(credit_cents) AND sum(debit_cents)>0) THEN RAISE EXCEPTION 'CAMS_UNBALANCED'; END IF;
 RETURN jid;
END;
$$;
COMMIT;
