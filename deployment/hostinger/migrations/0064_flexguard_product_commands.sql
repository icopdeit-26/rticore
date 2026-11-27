-- 0064 Product management commands. No direct ledger mutation.
BEGIN;
CREATE OR REPLACE FUNCTION rticore_fg_product_command(p_tenant text,p_entity text,p_actor text,p_action text,p_id text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE rid text; role_name text; price bigint; units bigint; t rticore_fg_product_terms%ROWTYPE; item jsonb;
BEGIN
 role_name:=rticore_fg_actor_role(p_tenant,p_entity,p_actor);
 IF p_action='create' THEN
  IF role_name IS DISTINCT FROM 'finance' OR NOT EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=p_tenant AND a.legal_entity_id=p_entity AND lower(a.email)=lower(p_actor) AND a.status='approved' AND a.can_make=1 AND a.finance_role IN ('financial_controller','finance_manager','accounting_officer') AND a.business_unit_id IS NULL AND a.department_id IS NULL) THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
  IF jsonb_typeof(p_data->'conversions') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'FLEXGUARD_CONVERSION_INVALID'; END IF;
  IF jsonb_array_length(p_data->'conversions') NOT BETWEEN 1 AND 7 THEN RAISE EXCEPTION 'FLEXGUARD_CONVERSION_INVALID'; END IF;
  units:=(p_data->>'credits_included')::bigint; price:=(p_data->>'unit_credit_price_cents')::bigint;
  IF units IS NULL OR units NOT BETWEEN 1 AND 100000 OR price IS NULL OR price<1 OR units::numeric*price>=900000000000000 THEN RAISE EXCEPTION 'FLEXGUARD_TERMS_INVALID'; END IF;
  rid:=gen_random_uuid()::text;
  INSERT INTO rticore_fg_product_terms(id,tenant_id,legal_entity_id,package_code,package_name,version,billing_model,credits_included,unit_credit_price_cents,package_price_cents,validity_days,effective_from,created_by)
  VALUES(rid,p_tenant,p_entity,p_data->>'package_code',p_data->>'package_name',(p_data->>'version')::bigint,p_data->>'billing_model',units,price,units*price,(p_data->>'validity_days')::bigint,(p_data->>'effective_from')::date,lower(p_actor));
  FOR item IN SELECT value FROM jsonb_array_elements(p_data->'conversions') LOOP
   INSERT INTO rticore_fg_product_conversions(id,tenant_id,legal_entity_id,terms_id,service_tier,multiplier_bps)
   VALUES(gen_random_uuid()::text,p_tenant,p_entity,rid,item->>'service_tier',(item->>'multiplier_bps')::bigint);
  END LOOP;
  INSERT INTO rticore_operations_events(id,tenant_id,area,entity_id,action,actor_email,snapshot_json)
  VALUES(gen_random_uuid()::text,p_tenant,'flexguard',rid,'PRODUCT_TERMS_CREATED',lower(p_actor),jsonb_build_object('legal_entity_id',p_entity,'version',p_data->>'version')::text);
  RETURN jsonb_build_object('id',rid,'status','draft');
 END IF;
 IF p_action IS DISTINCT FROM 'approve' OR coalesce(role_name,'') NOT IN ('finance','approver') OR length(coalesce(p_data->>'notes','')) NOT BETWEEN 12 AND 1000 THEN RAISE EXCEPTION 'FLEXGUARD_APPROVAL_DENIED'; END IF;
 SELECT * INTO t FROM rticore_fg_product_terms WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_SCOPE_INVALID'; END IF;
 IF lower(t.created_by)=lower(p_actor) THEN RAISE EXCEPTION 'FLEXGUARD_SELF_APPROVAL'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=p_tenant AND a.legal_entity_id=p_entity AND lower(a.email)=lower(p_actor) AND a.status='approved' AND a.can_check=1 AND a.can_approve=1 AND a.finance_role IN ('cfo','financial_controller') AND a.approval_limit_cents>=t.package_price_cents AND a.business_unit_id IS NULL AND a.department_id IS NULL) THEN RAISE EXCEPTION 'FLEXGUARD_APPROVAL_DENIED'; END IF;
 IF t.status<>'draft' THEN RAISE EXCEPTION 'FLEXGUARD_TERMS_IMMUTABLE'; END IF;
 UPDATE rticore_fg_product_terms SET status='approved',approved_by=lower(p_actor),approval_notes=p_data->>'notes',approved_at=now() WHERE id=t.id;
 INSERT INTO rticore_operations_events(id,tenant_id,area,entity_id,action,actor_email,snapshot_json)
 VALUES(gen_random_uuid()::text,p_tenant,'flexguard',t.id,'PRODUCT_TERMS_APPROVED',lower(p_actor),jsonb_build_object('legal_entity_id',p_entity,'version',t.version)::text);
 RETURN jsonb_build_object('id',t.id,'status','approved');
END $fg$;
COMMIT;
