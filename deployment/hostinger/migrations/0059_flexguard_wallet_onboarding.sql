-- 0059: scoped wallet onboarding for native FlexGuard; independent entitlement approval.
BEGIN;
CREATE OR REPLACE FUNCTION rticore_fg_wallet_command(p_tenant text,p_entity text,p_actor text,p_action text,p_id text,p_units bigint,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $fg$
DECLARE role text; c record; w rticore_flexguard_wallets%ROWTYPE; wid text; today text:=to_char(CURRENT_DATE,'YYYY-MM-DD');
BEGIN
 role:=rticore_fg_actor_role(p_tenant,p_entity,p_actor);
 IF role IS NULL THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
 IF p_action='create' THEN
  IF role<>'finance' OR NOT EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=p_tenant AND a.legal_entity_id=p_entity AND lower(a.email)=lower(p_actor) AND a.status='approved' AND a.can_make=1 AND a.finance_role IN ('financial_controller','finance_manager','accounting_officer') AND a.business_unit_id IS NULL AND a.department_id IS NULL) THEN RAISE EXCEPTION 'FLEXGUARD_ACCESS_DENIED'; END IF;
  IF p_units IS NULL OR p_units NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'FLEXGUARD_ENTITLEMENT_INVALID'; END IF;
  SELECT x.* INTO c FROM rticore_service_contracts x JOIN rticore_erp_project_scopes s ON s.tenant_id=x.tenant_id AND s.project_id=x.project_id AND s.legal_entity_id=p_entity AND s.status='approved'
   JOIN rticore_delivery_projects p ON p.tenant_id=x.tenant_id AND p.id=x.project_id AND p.customer_id=x.customer_id
   WHERE x.tenant_id=p_tenant AND x.id=p_id AND x.status='active' AND x.model='FlexGuard' AND x.end_date>=today AND x.start_date<=today FOR UPDATE OF x;
  IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_SCOPE_INVALID'; END IF;
  SELECT * INTO w FROM rticore_flexguard_wallets WHERE tenant_id=p_tenant AND contract_id=c.id;
  IF FOUND THEN
   IF lower(w.created_by)=lower(p_actor) AND w.entitlement_units=p_units THEN RETURN jsonb_build_object('id',w.id,'status',w.status,'replayed',true); END IF;
   RAISE EXCEPTION 'FLEXGUARD_WALLET_EXISTS';
  END IF;
  wid:=gen_random_uuid()::text;
  INSERT INTO rticore_flexguard_wallets(id,tenant_id,customer_id,contract_id,entitlement_units,created_by) VALUES(wid,p_tenant,c.customer_id,c.id,p_units,lower(p_actor));
  INSERT INTO rticore_operations_events(id,tenant_id,area,entity_id,action,actor_email,snapshot_json) VALUES(gen_random_uuid()::text,p_tenant,'flexguard',wid,'WALLET_REQUEST',lower(p_actor),jsonb_build_object('contract_id',c.id,'entitlement_units',p_units)::text);
  RETURN jsonb_build_object('id',wid,'status','draft');
 END IF;
 IF p_action<>'approve' OR role NOT IN ('approver','finance') OR length(coalesce(p_notes,'')) NOT BETWEEN 12 AND 1000 OR NOT EXISTS(SELECT 1 FROM rticore_finance_role_assignments a WHERE a.tenant_id=p_tenant AND a.legal_entity_id=p_entity AND lower(a.email)=lower(p_actor) AND a.status='approved' AND a.finance_role IN ('cfo','financial_controller') AND a.can_approve=1 AND a.can_check=1 AND a.business_unit_id IS NULL AND a.department_id IS NULL) THEN RAISE EXCEPTION 'FLEXGUARD_APPROVAL_DENIED'; END IF;
 SELECT x.* INTO w FROM rticore_flexguard_wallets x JOIN rticore_service_contracts c ON c.tenant_id=x.tenant_id AND c.id=x.contract_id AND c.customer_id=x.customer_id AND c.status='active' AND c.model='FlexGuard' AND c.end_date>=today
 JOIN rticore_erp_project_scopes s ON s.tenant_id=c.tenant_id AND s.project_id=c.project_id AND s.legal_entity_id=p_entity AND s.status='approved'
 WHERE x.tenant_id=p_tenant AND x.id=p_id FOR UPDATE OF x;
 IF NOT FOUND THEN RAISE EXCEPTION 'FLEXGUARD_SCOPE_INVALID'; END IF;
 IF lower(w.created_by)=lower(p_actor) THEN RAISE EXCEPTION 'FLEXGUARD_SELF_APPROVAL'; END IF;
 IF w.status<>'draft' THEN RAISE EXCEPTION 'FLEXGUARD_WALLET_ALREADY_REVIEWED'; END IF;
 UPDATE rticore_flexguard_wallets SET status='active',approved_by=lower(p_actor),approved_at=CURRENT_TIMESTAMP::text,approved_notes=p_notes WHERE tenant_id=p_tenant AND id=w.id;
 INSERT INTO rticore_operations_events(id,tenant_id,area,entity_id,action,actor_email,snapshot_json) VALUES(gen_random_uuid()::text,p_tenant,'flexguard',w.id,'WALLET_APPROVED',lower(p_actor),jsonb_build_object('entitlement_units',w.entitlement_units,'approval_notes',p_notes)::text);
 RETURN jsonb_build_object('id',w.id,'status','active');
END $fg$;
COMMIT;
