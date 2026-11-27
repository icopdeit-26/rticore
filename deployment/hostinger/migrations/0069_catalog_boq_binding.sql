-- 0069: one approved pricing snapshot to one exact approved BoQ version.
BEGIN;
CREATE TABLE IF NOT EXISTS rticore_catalog_boq_bindings(
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,snapshot_id text NOT NULL,boq_id text NOT NULL REFERENCES rticore_boq(id),
 boq_version bigint NOT NULL,boq_edit_seq bigint NOT NULL,boq_lines_sha256 text NOT NULL CHECK(length(boq_lines_sha256)=64),price_cents bigint NOT NULL CHECK(price_cents>0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),created_by text NOT NULL,approved_by text,approval_notes text,approved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,boq_id,boq_version,boq_edit_seq),UNIQUE(tenant_id,snapshot_id),
 FOREIGN KEY(tenant_id,legal_entity_id,snapshot_id) REFERENCES rticore_catalog_pricing_snapshots(tenant_id,legal_entity_id,id),
 CHECK((status='draft' AND approved_by IS NULL AND approval_notes IS NULL AND approved_at IS NULL) OR (status='approved' AND approved_by IS NOT NULL AND lower(approved_by)<>lower(created_by) AND coalesce(length(approval_notes),0) BETWEEN 12 AND 1000 AND approved_at IS NOT NULL))
);
-- Exact positive minor units; reject unsupported malformed or non-IDR lines.
CREATE OR REPLACE FUNCTION rticore_catalog_boq_subtotal(p_lines text) RETURNS bigint LANGUAGE plpgsql IMMUTABLE AS $cat$
DECLARE a jsonb; q numeric; u numeric; subtotal numeric:=0;
BEGIN
 IF jsonb_typeof(p_lines::jsonb) IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
 IF jsonb_array_length(p_lines::jsonb) NOT BETWEEN 1 AND 1000 THEN RETURN NULL; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(p_lines::jsonb) LOOP
  IF jsonb_typeof(a->'quantity') IS DISTINCT FROM 'number' OR jsonb_typeof(a->'unit_price') IS DISTINCT FROM 'number' THEN RETURN NULL; END IF;
  q:=(a->>'quantity')::numeric;u:=(a->>'unit_price')::numeric;
  IF q<=0 OR q>100000 OR q<>round(q,3) OR u<0 OR u>9000000000000 OR u<>round(u,2) THEN RETURN NULL; END IF;
  subtotal:=subtotal+q*u*100;
 END LOOP;
 IF round(subtotal) NOT BETWEEN 1 AND 899999999999999 THEN RETURN NULL; END IF;
 RETURN round(subtotal)::bigint;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN NULL;
END $cat$;
CREATE OR REPLACE FUNCTION rticore_catalog_boq_binding_valid(p_tenant text,p_entity text,p_boq text) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $cat$
 SELECT EXISTS(SELECT 1 FROM rticore_catalog_boq_bindings b
 JOIN rticore_catalog_pricing_snapshots s ON s.id=b.snapshot_id AND s.tenant_id=b.tenant_id AND s.legal_entity_id=b.legal_entity_id AND s.status='approved' AND s.net_price_cents=b.price_cents
 JOIN rticore_boq q ON q.id=b.boq_id AND q.tenant_id=b.tenant_id AND q.opportunity_id=s.opportunity_id AND q.version=b.boq_version AND q.edit_seq=b.boq_edit_seq AND q.status='approved' AND q.currency='IDR'
 JOIN rticore_erp_opportunity_scopes o ON o.tenant_id=s.tenant_id AND o.opportunity_id=s.opportunity_id AND o.legal_entity_id=s.legal_entity_id AND o.status='approved' AND o.version=s.opportunity_scope_version
 WHERE b.tenant_id=p_tenant AND b.legal_entity_id=p_entity AND b.boq_id=p_boq AND b.status='approved' AND b.boq_lines_sha256=encode(sha256(convert_to(q.line_items_json,'UTF8')),'hex') AND rticore_catalog_boq_subtotal(q.line_items_json)=b.price_cents)
$cat$;
CREATE OR REPLACE FUNCTION rticore_catalog_boq_binding_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $cat$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CATALOG_IMMUTABLE'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' OR NOT rticore_catalog_finance_access(NEW.tenant_id,NEW.legal_entity_id,NEW.created_by,'make') THEN RAISE EXCEPTION 'CATALOG_ACCESS_DENIED'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status<>'draft' OR NEW.status<>'approved' OR (to_jsonb(OLD)-ARRAY['status','approved_by','approval_notes','approved_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','approved_by','approval_notes','approved_at']) THEN RAISE EXCEPTION 'CATALOG_IMMUTABLE'; END IF;
 IF lower(NEW.approved_by)=lower(OLD.created_by) OR NOT rticore_catalog_finance_access(NEW.tenant_id,NEW.legal_entity_id,NEW.approved_by,'approve') OR NOT EXISTS(SELECT 1 FROM rticore_finance_role_assignments f WHERE f.tenant_id=NEW.tenant_id AND f.legal_entity_id=NEW.legal_entity_id AND lower(f.email)=lower(NEW.approved_by) AND f.status='approved' AND f.can_check=1 AND f.can_approve=1 AND f.finance_role IN ('cfo','financial_controller') AND f.business_unit_id IS NULL AND f.department_id IS NULL AND f.approval_limit_cents>=NEW.price_cents) THEN RAISE EXCEPTION 'CATALOG_APPROVAL_DENIED'; END IF;
 RETURN NEW;
END $cat$;
DROP TRIGGER IF EXISTS rticore_catalog_boq_binding_guard ON rticore_catalog_boq_bindings;
CREATE TRIGGER rticore_catalog_boq_binding_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_catalog_boq_bindings FOR EACH ROW EXECUTE FUNCTION rticore_catalog_boq_binding_guard();
CREATE OR REPLACE FUNCTION rticore_catalog_boq_binding_command(p_tenant text,p_entity text,p_actor text,p_action text,p_id text,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $cat$
DECLARE rid text; ev record; old_binding rticore_catalog_boq_bindings%ROWTYPE; bid text; sid text;
BEGIN
 IF p_action='create_boq_binding' THEN
  IF NOT rticore_catalog_finance_access(p_tenant,p_entity,p_actor,'make') THEN RAISE EXCEPTION 'CATALOG_ACCESS_DENIED'; END IF;
  bid:=p_data->>'boq_id';sid:=p_data->>'snapshot_id';rid:=gen_random_uuid()::text;
 ELSIF p_action='approve_boq_binding' THEN
  IF NOT rticore_catalog_finance_access(p_tenant,p_entity,p_actor,'approve') THEN RAISE EXCEPTION 'CATALOG_APPROVAL_DENIED'; END IF;
  SELECT * INTO old_binding FROM rticore_catalog_boq_bindings WHERE tenant_id=p_tenant AND legal_entity_id=p_entity AND id=p_id FOR UPDATE;
  IF NOT FOUND OR old_binding.status<>'draft' THEN RAISE EXCEPTION 'CATALOG_SCOPE_INVALID'; END IF;
  bid:=old_binding.boq_id;sid:=old_binding.snapshot_id;rid:=old_binding.id;
 ELSE RAISE EXCEPTION 'CATALOG_ACTION_INVALID'; END IF;
 SELECT q.version,q.edit_seq,encode(sha256(convert_to(q.line_items_json,'UTF8')),'hex') AS lines_hash,s.net_price_cents INTO ev
 FROM rticore_catalog_pricing_snapshots s JOIN rticore_boq q ON q.tenant_id=s.tenant_id AND q.opportunity_id=s.opportunity_id AND q.status='approved' AND q.currency='IDR'
 JOIN rticore_erp_opportunity_scopes o ON o.tenant_id=s.tenant_id AND o.opportunity_id=s.opportunity_id AND o.legal_entity_id=s.legal_entity_id AND o.status='approved' AND o.version=s.opportunity_scope_version
 WHERE s.tenant_id=p_tenant AND s.legal_entity_id=p_entity AND s.id=sid AND s.status='approved' AND q.id=bid AND rticore_catalog_boq_subtotal(q.line_items_json)=s.net_price_cents FOR SHARE OF q,o;
 IF NOT FOUND THEN RAISE EXCEPTION 'CATALOG_BOQ_PRICE_MISMATCH'; END IF;
 IF p_action='create_boq_binding' THEN
  INSERT INTO rticore_catalog_boq_bindings(id,tenant_id,legal_entity_id,snapshot_id,boq_id,boq_version,boq_edit_seq,boq_lines_sha256,price_cents,created_by)
  VALUES(rid,p_tenant,p_entity,sid,bid,ev.version,ev.edit_seq,ev.lines_hash,ev.net_price_cents,lower(p_actor));
 ELSE
  IF old_binding.boq_version<>ev.version OR old_binding.boq_edit_seq<>ev.edit_seq OR old_binding.boq_lines_sha256<>ev.lines_hash OR old_binding.price_cents<>ev.net_price_cents THEN RAISE EXCEPTION 'CATALOG_BOQ_STALE'; END IF;
  UPDATE rticore_catalog_boq_bindings SET status='approved',approved_by=lower(p_actor),approved_at=now(),approval_notes=p_data->>'notes' WHERE id=rid;
  IF NOT rticore_catalog_boq_binding_valid(p_tenant,p_entity,bid) THEN RAISE EXCEPTION 'CATALOG_BOQ_STALE'; END IF;
 END IF;
 INSERT INTO rticore_operations_events(id,tenant_id,area,entity_id,action,actor_email,snapshot_json) VALUES(gen_random_uuid()::text,p_tenant,'service_catalog',rid,p_action,lower(p_actor),jsonb_build_object('legal_entity_id',p_entity,'boq_id',bid,'snapshot_id',sid)::text);
 RETURN jsonb_build_object('id',rid,'status',CASE WHEN p_action='create_boq_binding' THEN 'draft' ELSE 'approved' END);
END $cat$;
-- Atomic strict commercial release check before native contract binding.
CREATE OR REPLACE FUNCTION rticore_catalog_bind_priced_contract(p_tenant text,p_entity text,p_actor text,p_action text,p_contract text,p_terms text,p_notes text) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $cat$
DECLARE bid text;
BEGIN
 SELECT q.id INTO bid FROM rticore_service_contracts c
 JOIN rticore_delivery_projects p ON p.tenant_id=c.tenant_id AND p.id=c.project_id
 JOIN rticore_sales_releases r ON r.tenant_id=p.tenant_id AND r.id=p.release_id AND r.status='approved' AND r.opportunity_id=p.opportunity_id
 JOIN rticore_boq q ON q.tenant_id=r.tenant_id AND q.id=r.boq_id AND q.version=r.boq_version AND q.edit_seq=r.boq_edit_seq
 JOIN rticore_catalog_boq_bindings b ON b.tenant_id=q.tenant_id AND b.boq_id=q.id AND b.legal_entity_id=p_entity AND b.status='approved' AND b.price_cents=p.contract_cents
 JOIN rticore_fg_product_terms t ON t.tenant_id=c.tenant_id AND t.legal_entity_id=p_entity AND t.id=p_terms AND t.status='approved' AND t.package_price_cents=b.price_cents
 WHERE c.tenant_id=p_tenant AND c.id=p_contract AND rticore_catalog_boq_binding_valid(p_tenant,p_entity,q.id) FOR UPDATE OF c;
 IF NOT FOUND THEN RAISE EXCEPTION 'CATALOG_PRICED_CONTRACT_REQUIRED'; END IF;
 RETURN rticore_fg_bind_contract(p_tenant,p_entity,p_actor,p_action,p_contract,p_terms,p_notes);
END $cat$;
COMMIT;
