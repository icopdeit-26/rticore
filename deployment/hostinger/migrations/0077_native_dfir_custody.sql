BEGIN;
-- A-R04: retain the canonical DFIR case, not a second incident registry.
CREATE TABLE IF NOT EXISTS rticore_native_dfir_custody (
 id text PRIMARY KEY, tenant_id text NOT NULL, legal_entity_id text NOT NULL,
 case_id text NOT NULL, evidence_tag text NOT NULL CHECK(length(evidence_tag) BETWEEN 3 AND 64),
 seq integer NOT NULL CHECK(seq>0), document_id text NOT NULL REFERENCES rticore_document_library(id),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 action text NOT NULL CHECK(action IN ('collected','transferred','analyzed','sealed','archived')),
 actor_email text NOT NULL, custodian_email text NOT NULL,
 notes text NOT NULL CHECK(length(notes) BETWEEN 12 AND 800),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,case_id,evidence_tag,seq),
 FOREIGN KEY(tenant_id,case_id) REFERENCES rticore_cyber_cases(tenant_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id)
);
CREATE OR REPLACE FUNCTION rticore_native_dfir_actor(p_tenant text,p_entity text,p_case text,p_actor text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $c$
 WITH RECURSIVE scoped(unit_id) AS (
 SELECT s.unit_id FROM rticore_erp_staff_org s JOIN rticore_erp_org_units u ON u.tenant_id=s.tenant_id AND u.id=s.unit_id AND u.active=1
 WHERE s.tenant_id=p_tenant AND lower(s.email)=lower(p_actor) AND s.status='approved'
 UNION
 SELECT u.parent_id FROM rticore_erp_org_units u JOIN scoped x ON x.unit_id=u.id JOIN rticore_erp_org_units p ON p.tenant_id=u.tenant_id AND p.id=u.parent_id AND p.active=1 WHERE u.tenant_id=p_tenant AND u.active=1
 )
 SELECT EXISTS(SELECT 1 FROM rticore_members m JOIN rticore_erp_role_capability_matrix pol ON pol.role=m.role AND pol.capability='cyber_ops' AND pol.allowed=1
 JOIN rticore_erp_capability_grants g ON lower(g.email)=lower(m.email) AND g.tenant_id=p_tenant AND g.unit_id=p_entity AND g.capability='cyber_ops' AND g.status='approved'
 JOIN rticore_cyber_cases c ON c.tenant_id=p_tenant AND c.id=p_case AND c.kind='dfir_incident'
 JOIN rticore_erp_project_scopes sc ON sc.tenant_id=c.tenant_id AND sc.project_id=c.project_id AND sc.legal_entity_id=p_entity AND sc.status='approved'
 JOIN rticore_erp_org_units u ON u.tenant_id=p_tenant AND u.id=p_entity AND u.kind='legal_entity' AND u.active=1
 WHERE lower(m.email)=lower(p_actor) AND m.active=1 AND m.role IN ('admin','defense_leader','defense_member')
 AND EXISTS(SELECT 1 FROM scoped WHERE unit_id=p_entity)
 AND (m.role<>'defense_member' OR EXISTS(SELECT 1 FROM rticore_cyber_case_assignments x WHERE x.tenant_id=p_tenant AND x.case_id=p_case AND lower(x.assignee_email)=lower(p_actor))))
$c$;
CREATE OR REPLACE FUNCTION rticore_native_dfir_custody_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $c$
DECLARE c record; prior rticore_native_dfir_custody%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CUSTODY_IMMUTABLE'; END IF;
 SELECT x.status,p.opportunity_id INTO c FROM rticore_cyber_cases x JOIN rticore_delivery_projects p ON p.tenant_id=x.tenant_id AND p.id=x.project_id
 WHERE x.tenant_id=NEW.tenant_id AND x.id=NEW.case_id AND x.kind='dfir_incident' FOR UPDATE OF x;
 IF NOT FOUND OR c.status NOT IN ('open','reviewed') OR NOT rticore_native_dfir_actor(NEW.tenant_id,NEW.legal_entity_id,NEW.case_id,NEW.actor_email) THEN RAISE EXCEPTION 'CUSTODY_SCOPE_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rticore_document_library d WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.document_id AND d.opportunity_id=c.opportunity_id AND d.kind='supporting' AND lower(d.sha256)=NEW.sha256 AND (d.retention_until IS NULL OR d.retention_until>=CURRENT_DATE::text OR d.legal_hold=1)) THEN RAISE EXCEPTION 'CUSTODY_EVIDENCE_INVALID'; END IF;
 SELECT * INTO prior FROM rticore_native_dfir_custody WHERE tenant_id=NEW.tenant_id AND case_id=NEW.case_id AND evidence_tag=NEW.evidence_tag ORDER BY seq DESC LIMIT 1;
 IF NOT FOUND THEN
  IF NEW.seq<>1 OR NEW.action<>'collected' OR lower(NEW.actor_email)<>lower(NEW.custodian_email) THEN RAISE EXCEPTION 'CUSTODY_SEQUENCE_INVALID'; END IF;
 ELSE
  IF NEW.seq<>prior.seq+1 OR prior.action='archived' OR NEW.action='collected' OR NEW.legal_entity_id<>prior.legal_entity_id OR NEW.document_id<>prior.document_id OR NEW.sha256<>prior.sha256 OR lower(NEW.actor_email)<>lower(prior.custodian_email) THEN RAISE EXCEPTION 'CUSTODY_SEQUENCE_INVALID'; END IF;
  IF NEW.action='transferred' THEN
   IF lower(NEW.actor_email)=lower(NEW.custodian_email) OR NOT rticore_native_dfir_actor(NEW.tenant_id,NEW.legal_entity_id,NEW.case_id,NEW.custodian_email) THEN RAISE EXCEPTION 'CUSTODY_RECIPIENT_INVALID'; END IF;
  ELSIF lower(NEW.actor_email)<>lower(NEW.custodian_email) THEN RAISE EXCEPTION 'CUSTODY_RECIPIENT_INVALID';
  END IF;
  IF NEW.action='archived' AND prior.action<>'sealed' THEN RAISE EXCEPTION 'CUSTODY_SEQUENCE_INVALID'; END IF;
 END IF;
 NEW.recorded_at:=clock_timestamp();
 RETURN NEW;
END $c$;
DROP TRIGGER IF EXISTS rticore_native_dfir_custody_guard ON rticore_native_dfir_custody;
CREATE TRIGGER rticore_native_dfir_custody_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_native_dfir_custody FOR EACH ROW EXECUTE FUNCTION rticore_native_dfir_custody_guard();
CREATE OR REPLACE FUNCTION rticore_native_dfir_append(p_tenant text,p_entity text,p_case text,p_actor text,p_tag text,p_document text,p_action text,p_recipient text,p_notes text,p_expected integer)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $c$
DECLARE rid text:=gen_random_uuid()::text; digest text; actual integer;
BEGIN
 PERFORM 1 FROM rticore_cyber_cases WHERE tenant_id=p_tenant AND id=p_case FOR UPDATE;
 IF NOT FOUND OR NOT rticore_native_dfir_actor(p_tenant,p_entity,p_case,p_actor) THEN RAISE EXCEPTION 'CUSTODY_SCOPE_INVALID'; END IF;
 SELECT coalesce(max(seq),0) INTO actual FROM rticore_native_dfir_custody WHERE tenant_id=p_tenant AND case_id=p_case AND evidence_tag=p_tag;
 IF p_expected IS DISTINCT FROM actual THEN RAISE EXCEPTION 'CUSTODY_SEQUENCE_INVALID'; END IF;
 SELECT lower(sha256) INTO digest FROM rticore_document_library WHERE tenant_id=p_tenant AND id=p_document;
 IF digest IS NULL THEN RAISE EXCEPTION 'CUSTODY_EVIDENCE_INVALID'; END IF;
 INSERT INTO rticore_native_dfir_custody(id,tenant_id,legal_entity_id,case_id,evidence_tag,seq,document_id,sha256,action,actor_email,custodian_email,notes)
 VALUES(rid,p_tenant,p_entity,p_case,p_tag,actual+1,p_document,digest,p_action,lower(p_actor),lower(CASE WHEN p_action='transferred' THEN p_recipient ELSE p_actor END),trim(p_notes));
 INSERT INTO rticore_operations_events(id,tenant_id,area,entity_id,action,actor_email,snapshot_json)
 VALUES(gen_random_uuid()::text,p_tenant,'cyber',p_case,'DFIR_CUSTODY_'||upper(p_action),lower(p_actor),jsonb_build_object('custody_id',rid,'seq',actual+1,'document_id',p_document,'sha256',digest)::text);
 RETURN jsonb_build_object('id',rid,'seq',actual+1,'sha256',digest);
END $c$;
COMMIT;
