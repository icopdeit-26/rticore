-- Recurring contract totals; activity quantities cover the entire contract term. No billing or revenue recognition is triggered.
BEGIN;
ALTER TABLE rticore_catalog_pricing_snapshots DROP CONSTRAINT IF EXISTS rticore_catalog_pricing_snapshots_pricing_method_check;
ALTER TABLE rticore_catalog_pricing_snapshots ADD CONSTRAINT rticore_catalog_pricing_snapshots_pricing_method_check CHECK(pricing_method IN ('target_margin','cost_plus','mandays_based','emergency_service','fixed_price','time_and_material','subscription','retainer','tiered','volume_discount'));
CREATE OR REPLACE FUNCTION rticore_catalog_workflow_command(p_tenant text,p_entity text,p_actor text,p_action text,p_id text,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $cat$
DECLARE threshold_qty numeric; discount_bps numeric; margin_price numeric; months numeric; monthly_fee numeric; fixed_price numeric; rid text:=gen_random_uuid()::text; n bigint; service record; profile record; matrix record; rate record; a jsonb; q bigint; scope_version bigint; method text; overhead bigint; risk bigint; target bigint; minimum bigint; md bigint; bmd bigint:=0; nmd bigint:=0; direct numeric:=0; loaded numeric; price numeric; evidence jsonb:='[]'; calc jsonb;
BEGIN
 IF p_action IN ('create_activity_profile','create_complexity','create_pricing_snapshot') THEN
  IF NOT rticore_catalog_finance_access(p_tenant,p_entity,p_actor,'make') THEN RAISE EXCEPTION 'CATALOG_ACCESS_DENIED'; END IF;
  IF p_action='create_activity_profile' THEN
   INSERT INTO rticore_catalog_activity_profiles(id,tenant_id,legal_entity_id,service_id,version,activities,created_by) VALUES(rid,p_tenant,p_entity,p_data->>'service_id',(p_data->>'version')::bigint,p_data->'activities',lower(p_actor));
  ELSIF p_action='create_complexity' THEN
   INSERT INTO rticore_catalog_complexity(id,tenant_id,legal_entity_id,matrix_code,label,version,factor_bps,created_by) VALUES(rid,p_tenant,p_entity,p_data->>'matrix_code',p_data->>'label',(p_data->>'version')::bigint,(p_data->>'factor_bps')::bigint,lower(p_actor));
  ELSE
   SELECT * INTO service FROM rticore_service_catalog_v2 WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=p_data->>'service_id' AND lifecycle_status='approved' AND effective_date<=CURRENT_DATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'CATALOG_SCOPE_INVALID'; END IF;
   SELECT * INTO profile FROM rticore_catalog_activity_profiles WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=p_data->>'profile_id' AND service_id=service.id AND status='approved';
   IF NOT FOUND THEN RAISE EXCEPTION 'CATALOG_SCOPE_INVALID'; END IF;
   SELECT * INTO matrix FROM rticore_catalog_complexity WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=p_data->>'complexity_id' AND status='approved';
   IF NOT FOUND THEN RAISE EXCEPTION 'CATALOG_SCOPE_INVALID'; END IF;
   SELECT version INTO scope_version FROM rticore_erp_opportunity_scopes WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND opportunity_id=p_data->>'opportunity_id' AND status='approved' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'CATALOG_SCOPE_INVALID'; END IF;
   q:=(p_data->>'quantity')::bigint;method:=p_data->>'pricing_method';overhead:=(p_data->>'overhead_bps')::bigint;risk:=(p_data->>'risk_bps')::bigint;target:=(p_data->>'target_bps')::bigint;minimum:=(p_data->>'minimum_margin_bps')::bigint;
   IF q IS NULL OR q NOT BETWEEN 1 AND 1000 OR method IS NULL OR method NOT IN ('target_margin','cost_plus','mandays_based','emergency_service','fixed_price','time_and_material','subscription','retainer','tiered','volume_discount') OR overhead IS NULL OR overhead NOT BETWEEN 0 AND 6000 OR risk IS NULL OR risk NOT BETWEEN 0 AND 5000 OR target IS NULL OR target NOT BETWEEN 0 AND 8500 OR minimum IS NULL OR minimum NOT BETWEEN 0 AND 8500 THEN RAISE EXCEPTION 'CATALOG_PRICING_INVALID'; END IF;
   IF method='fixed_price' THEN
    IF jsonb_typeof(p_data->'fixed_price_cents') IS DISTINCT FROM 'number' OR (p_data->>'fixed_price_cents') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'CATALOG_FIXED_PRICE_INVALID'; END IF;
    fixed_price:=(p_data->>'fixed_price_cents')::numeric;
    IF fixed_price NOT BETWEEN 1 AND 899999999999999 THEN RAISE EXCEPTION 'CATALOG_FIXED_PRICE_INVALID'; END IF;
   ELSIF p_data ? 'fixed_price_cents' AND p_data->'fixed_price_cents'<>'null'::jsonb THEN RAISE EXCEPTION 'CATALOG_FIXED_PRICE_INVALID'; END IF;
   IF method IN ('subscription','retainer') THEN
    IF jsonb_typeof(p_data->'contract_months') IS DISTINCT FROM 'number' OR (p_data->>'contract_months') !~ '^[0-9]+$' OR jsonb_typeof(p_data->'monthly_fee_cents') IS DISTINCT FROM 'number' OR (p_data->>'monthly_fee_cents') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'CATALOG_RECURRING_INVALID'; END IF;
    months:=(p_data->>'contract_months')::numeric; monthly_fee:=(p_data->>'monthly_fee_cents')::numeric;
    IF months NOT BETWEEN 1 AND 60 OR monthly_fee NOT BETWEEN 1 AND 899999999999999 OR months*monthly_fee>=900000000000000 THEN RAISE EXCEPTION 'CATALOG_RECURRING_INVALID'; END IF;
   ELSIF (p_data ? 'contract_months' AND p_data->'contract_months'<>'null'::jsonb) OR (p_data ? 'monthly_fee_cents' AND p_data->'monthly_fee_cents'<>'null'::jsonb) THEN RAISE EXCEPTION 'CATALOG_RECURRING_INVALID'; END IF;
   IF method IN ('tiered','volume_discount') THEN
    IF jsonb_typeof(p_data->'discount_threshold') IS DISTINCT FROM 'number' OR (p_data->>'discount_threshold') !~ '^[0-9]+$' OR jsonb_typeof(p_data->'discount_bps') IS DISTINCT FROM 'number' OR (p_data->>'discount_bps') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'CATALOG_DISCOUNT_INVALID'; END IF;
    threshold_qty:=(p_data->>'discount_threshold')::numeric; discount_bps:=(p_data->>'discount_bps')::numeric;
    IF threshold_qty NOT BETWEEN 2 AND 1000 OR discount_bps NOT BETWEEN 1 AND 8000 THEN RAISE EXCEPTION 'CATALOG_DISCOUNT_INVALID'; END IF;
   ELSIF (p_data ? 'discount_threshold' AND p_data->'discount_threshold'<>'null'::jsonb) OR (p_data ? 'discount_bps' AND p_data->'discount_bps'<>'null'::jsonb) THEN RAISE EXCEPTION 'CATALOG_DISCOUNT_INVALID'; END IF;
   FOR a IN SELECT value FROM jsonb_array_elements(profile.activities) LOOP
    SELECT id,version,internal_cost_rate_cents,min_selling_rate_cents,standard_selling_rate_cents,effective_date INTO rate FROM rticore_enterprise_rate_cards WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND role_code=a->>'resource_role' AND status='approved' AND effective_date<=CURRENT_DATE ORDER BY effective_date DESC,version DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'CATALOG_RATE_REQUIRED'; END IF;
    md:=ceil(round(q*(a->>'resource_count')::numeric*(a->>'hours_hundredths')::numeric*matrix.factor_bps/10000)*10/800);
    IF a->>'billable'='true' THEN bmd:=bmd+md; ELSE nmd:=nmd+md; END IF;
    direct:=direct+round(md*rate.internal_cost_rate_cents::numeric/10);
    evidence:=evidence||jsonb_build_array(jsonb_build_object('activity',a,'rate_id',rate.id,'rate_version',rate.version,'rate_effective_date',rate.effective_date,'internal_rate_cents',rate.internal_cost_rate_cents,'minimum_rate_cents',rate.min_selling_rate_cents,'standard_rate_cents',rate.standard_selling_rate_cents,'mandays_tenths',md));
   END LOOP;
   IF bmd<=0 OR bmd+nmd NOT BETWEEN service.min_mandays_tenths AND service.max_mandays_tenths OR direct<=0 THEN RAISE EXCEPTION 'CATALOG_EFFORT_INVALID'; END IF;
   loaded:=direct+round(direct*overhead/10000)+round(direct*risk/10000);
   margin_price:=ceil(loaded*10000/(10000-target));
   price:=CASE WHEN method='tiered' THEN ceil(margin_price*(q*10000-greatest(q-threshold_qty+1,0)*discount_bps)/(q*10000)) WHEN method='volume_discount' THEN ceil(margin_price*(10000-CASE WHEN q>=threshold_qty THEN discount_bps ELSE 0 END)/10000) WHEN method='cost_plus' THEN ceil(loaded*(10000+target)/10000) WHEN method IN ('subscription','retainer') THEN months*monthly_fee WHEN method='fixed_price' THEN fixed_price WHEN method='time_and_material' THEN (SELECT sum(ceil(q*(x->'activity'->>'resource_count')::numeric*(x->'activity'->>'hours_hundredths')::numeric*matrix.factor_bps/10000*(x->>'standard_rate_cents')::numeric/800)) FROM jsonb_array_elements(evidence) x WHERE x->'activity'->>'billable'='true') WHEN method='mandays_based' THEN (SELECT sum(ceil((x->>'mandays_tenths')::numeric*(x->>'standard_rate_cents')::numeric/10)) FROM jsonb_array_elements(evidence) x WHERE x->'activity'->>'billable'='true') WHEN method='emergency_service' THEN ceil(ceil(loaded*10000/(10000-target))*12500/10000) ELSE ceil(loaded*10000/(10000-target)) END;
   IF method IN ('fixed_price','subscription','retainer','tiered','volume_discount') AND price<greatest(ceil(loaded*10000/(10000-minimum)),(SELECT sum(ceil((x->>'mandays_tenths')::numeric*(x->>'minimum_rate_cents')::numeric/10)) FROM jsonb_array_elements(evidence) x)) THEN RAISE EXCEPTION 'CATALOG_FIXED_PRICE_BELOW_MINIMUM'; END IF;
   price:=greatest(price,ceil(loaded*10000/(10000-minimum)),(SELECT sum(ceil((x->>'mandays_tenths')::numeric*(x->>'minimum_rate_cents')::numeric/10)) FROM jsonb_array_elements(evidence) x));
   IF price>=900000000000000 THEN RAISE EXCEPTION 'CATALOG_PRICING_INVALID'; END IF;
   calc:=jsonb_build_object('formula_version','0092-v1','discount_threshold',threshold_qty,'discount_bps',discount_bps,'undiscounted_target_cents',margin_price,'contract_months',months,'monthly_fee_cents',monthly_fee,'fixed_price_cents',fixed_price,'service_id',service.id,'service_version',service.service_version,'profile_id',profile.id,'profile_version',profile.version,'complexity_id',matrix.id,'complexity_version',matrix.version,'factor_bps',matrix.factor_bps,'quantity',q,'method',method,'overhead_bps',overhead,'risk_bps',risk,'target_bps',target,'minimum_margin_bps',minimum,'activities',evidence,'direct_cost_cents',direct,'loaded_cost_cents',loaded,'net_price_cents',price);
   INSERT INTO rticore_catalog_pricing_snapshots(id,tenant_id,legal_entity_id,service_id,profile_id,complexity_id,opportunity_id,opportunity_scope_version,quantity,pricing_method,overhead_bps,risk_bps,target_bps,minimum_margin_bps,billable_mandays_tenths,nonbillable_mandays_tenths,direct_cost_cents,loaded_cost_cents,net_price_cents,calculation,calculation_sha256,created_by)
   VALUES(rid,p_tenant,p_entity,service.id,profile.id,matrix.id,p_data->>'opportunity_id',scope_version,q,method,overhead,risk,target,minimum,bmd,nmd,direct,loaded,price,calc,encode(sha256(convert_to(calc::text,'UTF8')),'hex'),lower(p_actor));
  END IF;
 ELSE
  IF NOT rticore_catalog_finance_access(p_tenant,p_entity,p_actor,'approve') THEN RAISE EXCEPTION 'CATALOG_APPROVAL_DENIED'; END IF;
  rid:=p_id;
  IF p_action='approve_activity_profile' THEN UPDATE rticore_catalog_activity_profiles SET status='approved',approved_by=lower(p_actor),approved_at=now(),approval_notes=p_data->>'notes' WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=rid AND status='draft';
  ELSIF p_action='approve_complexity' THEN UPDATE rticore_catalog_complexity SET status='approved',approved_by=lower(p_actor),approved_at=now(),approval_notes=p_data->>'notes' WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=rid AND status='draft';
  ELSIF p_action='approve_pricing_snapshot' THEN UPDATE rticore_catalog_pricing_snapshots SET status='approved',approved_by=lower(p_actor),approved_at=now(),approval_notes=p_data->>'notes' WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=rid AND status='draft';
  ELSE RAISE EXCEPTION 'CATALOG_ACTION_INVALID'; END IF;
  GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'CATALOG_SCOPE_INVALID'; END IF;
 END IF;
 INSERT INTO rticore_operations_events(id,tenant_id,area,entity_id,action,actor_email,snapshot_json) VALUES(gen_random_uuid()::text,p_tenant,'service_catalog',rid,p_action,lower(p_actor),jsonb_build_object('legal_entity_id',p_entity)::text);
 RETURN jsonb_build_object('id',rid,'status',CASE WHEN p_action LIKE 'create_%' THEN 'draft' ELSE 'approved' END);
END $cat$;

COMMIT;
