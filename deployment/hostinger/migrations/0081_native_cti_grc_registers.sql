BEGIN;
-- A-R06–A-R09. Project and entity scoped registers, not autonomous scanning or risk acceptance.
CREATE OR REPLACE FUNCTION rticore_native_cti_grc_actor(p_tenant text,p_entity text,p_project text,p_actor text)
RETURNS text LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $s$
 WITH RECURSIVE scoped(unit_id) AS (
 SELECT s.unit_id FROM rticore_erp_staff_org s JOIN rticore_erp_org_units u ON u.tenant_id=s.tenant_id AND u.id=s.unit_id AND u.active=1 WHERE s.tenant_id=p_tenant AND lower(s.email)=lower(p_actor) AND s.status='approved'
 UNION
 SELECT u.parent_id FROM rticore_erp_org_units u JOIN scoped x ON x.unit_id=u.id JOIN rticore_erp_org_units p ON p.tenant_id=u.tenant_id AND p.id=u.parent_id AND p.active=1 WHERE u.tenant_id=p_tenant AND u.active=1
 )
 SELECT m.role FROM rticore_members m
 JOIN rticore_erp_role_capability_matrix pol ON pol.role=m.role AND pol.capability='cyber_ops' AND pol.allowed=1
 JOIN rticore_erp_capability_grants g ON lower(g.email)=lower(m.email) AND g.tenant_id=p_tenant AND g.unit_id=p_entity AND g.capability='cyber_ops' AND g.status='approved'
 JOIN rticore_erp_project_scopes sc ON sc.tenant_id=p_tenant AND sc.project_id=p_project AND sc.legal_entity_id=p_entity AND sc.status='approved'
 JOIN rticore_delivery_projects p ON p.tenant_id=sc.tenant_id AND p.id=sc.project_id AND p.service_family IN ('CTI','Digital Risk Protection','GRC','Cybersecurity Governance','GRC / Risk Management','ISO 27001 / ISMS','ISO 27701 / Privacy Management','PDP / Data Privacy','DPO as a Service','IT Audit / IT Assurance','IT Governance / IT Risk','ICOFR / Internal Control','BCM / BCP / DRP','Third Party / Vendor Risk Assessment','vCISO / Cybersecurity Advisory')
 JOIN rticore_erp_org_units u ON u.tenant_id=p_tenant AND u.id=p_entity AND u.kind='legal_entity' AND u.active=1
 WHERE lower(m.email)=lower(p_actor) AND m.active=1 AND m.role IN ('admin','presales','approver','defense_leader') AND (m.role<>'defense_leader' OR p.service_family IN ('CTI','Digital Risk Protection')) AND EXISTS(SELECT 1 FROM scoped WHERE unit_id=p_entity)
$s$;


CREATE TABLE IF NOT EXISTS rticore_native_cti_case (
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,project_id text NOT NULL,
 code text NOT NULL CHECK(length(code) BETWEEN 4 AND 64),title text NOT NULL CHECK(length(title) BETWEEN 5 AND 200),
 request_type text NOT NULL CHECK(request_type IN ('intelligence_request','threat_monitoring','brand_monitoring','incident_support')),
 tlp text NOT NULL CHECK(tlp IN ('TLP:CLEAR','TLP:GREEN','TLP:AMBER','TLP:AMBER+STRICT','TLP:RED')),
 severity text NOT NULL CHECK(severity IN ('informational','low','medium','high','critical')),
 summary text NOT NULL CHECK(length(summary) BETWEEN 12 AND 2000),
 document_id text NOT NULL REFERENCES rticore_document_library(id),document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[0-9a-f]{64}$'),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,legal_entity_id,project_id,code),UNIQUE(tenant_id,legal_entity_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES rticore_delivery_projects(tenant_id,id),FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS rticore_native_cti_ioc (
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,project_id text NOT NULL,case_id text NOT NULL,
 ioc_type text NOT NULL CHECK(ioc_type IN ('domain','ipv4','ipv6','url','sha256','email')),
 indicator_value text NOT NULL CHECK(length(indicator_value) BETWEEN 3 AND 512),
 confidence integer NOT NULL CHECK(confidence BETWEEN 0 AND 100),
 document_id text NOT NULL REFERENCES rticore_document_library(id),document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[0-9a-f]{64}$'),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,case_id,ioc_type,indicator_value),
 FOREIGN KEY(tenant_id,legal_entity_id,project_id,case_id) REFERENCES rticore_native_cti_case(tenant_id,legal_entity_id,project_id,id)
);
CREATE TABLE IF NOT EXISTS rticore_native_grc_engagement (
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,project_id text NOT NULL,
 code text NOT NULL CHECK(length(code) BETWEEN 4 AND 64),title text NOT NULL CHECK(length(title) BETWEEN 5 AND 200),
 framework text NOT NULL CHECK(length(framework) BETWEEN 3 AND 120),scope_summary text NOT NULL CHECK(length(scope_summary) BETWEEN 12 AND 2000),
 document_id text NOT NULL REFERENCES rticore_document_library(id),document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[0-9a-f]{64}$'),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,legal_entity_id,project_id,code),UNIQUE(tenant_id,legal_entity_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES rticore_delivery_projects(tenant_id,id),FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS rticore_native_grc_risk (
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,project_id text NOT NULL,engagement_id text NOT NULL,
 code text NOT NULL CHECK(length(code) BETWEEN 3 AND 48),title text NOT NULL CHECK(length(title) BETWEEN 5 AND 200),
 risk_domain text NOT NULL CHECK(length(risk_domain) BETWEEN 3 AND 120),
 description text NOT NULL CHECK(length(description) BETWEEN 12 AND 2000),
 inherent_likelihood integer NOT NULL CHECK(inherent_likelihood BETWEEN 1 AND 5),inherent_impact integer NOT NULL CHECK(inherent_impact BETWEEN 1 AND 5),
 residual_likelihood integer NOT NULL CHECK(residual_likelihood BETWEEN 1 AND 5),residual_impact integer NOT NULL CHECK(residual_impact BETWEEN 1 AND 5),
 kri_metric text NOT NULL CHECK(length(kri_metric) BETWEEN 3 AND 250),kri_threshold text NOT NULL CHECK(length(kri_threshold) BETWEEN 1 AND 250),
 treatment_plan text NOT NULL CHECK(length(treatment_plan) BETWEEN 12 AND 2000),
 document_id text NOT NULL REFERENCES rticore_document_library(id),document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[0-9a-f]{64}$'),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,engagement_id,code),UNIQUE(tenant_id,legal_entity_id,project_id,engagement_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id,project_id,engagement_id) REFERENCES rticore_native_grc_engagement(tenant_id,legal_entity_id,project_id,id)
);
CREATE TABLE IF NOT EXISTS rticore_native_grc_control (
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,project_id text NOT NULL,engagement_id text NOT NULL,risk_id text NOT NULL,
 code text NOT NULL CHECK(length(code) BETWEEN 3 AND 48),title text NOT NULL CHECK(length(title) BETWEEN 5 AND 200),
 regulatory_ref text NOT NULL CHECK(length(regulatory_ref) BETWEEN 3 AND 250),
 control_type text NOT NULL CHECK(control_type IN ('preventive','detective','corrective')),
 control_description text NOT NULL CHECK(length(control_description) BETWEEN 12 AND 2000),
 document_id text NOT NULL REFERENCES rticore_document_library(id),document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[0-9a-f]{64}$'),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,engagement_id,code),UNIQUE(tenant_id,legal_entity_id,project_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id,project_id,engagement_id,risk_id) REFERENCES rticore_native_grc_risk(tenant_id,legal_entity_id,project_id,engagement_id,id)
);
CREATE TABLE IF NOT EXISTS rticore_native_grc_control_test (
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,project_id text NOT NULL,control_id text NOT NULL,
 test_type text NOT NULL CHECK(test_type IN ('design','operating_effectiveness')),
 assessment_status text NOT NULL CHECK(assessment_status IN ('effective','partially_effective','ineffective')),
 test_notes text NOT NULL CHECK(length(test_notes) BETWEEN 12 AND 1000),
 document_id text NOT NULL REFERENCES rticore_document_library(id),document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[0-9a-f]{64}$'),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,legal_entity_id,project_id,control_id) REFERENCES rticore_native_grc_control(tenant_id,legal_entity_id,project_id,id)
);
CREATE OR REPLACE FUNCTION rticore_native_cti_grc_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $g$
DECLARE p record; actor_role text; owner_email text; ip inet;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CTI_GRC_REGISTER_IMMUTABLE'; END IF;
 SELECT opportunity_id,service_family INTO p FROM rticore_delivery_projects WHERE tenant_id=NEW.tenant_id AND id=NEW.project_id AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CTI_GRC_PROJECT_INVALID'; END IF;
 IF (TG_TABLE_NAME IN ('rticore_native_cti_case','rticore_native_cti_ioc')) IS DISTINCT FROM (p.service_family IN ('CTI','Digital Risk Protection')) THEN RAISE EXCEPTION 'CTI_GRC_PROJECT_INVALID'; END IF;
 actor_role:=rticore_native_cti_grc_actor(NEW.tenant_id,NEW.legal_entity_id,NEW.project_id,NEW.created_by);
 IF actor_role IS NULL THEN RAISE EXCEPTION 'CTI_GRC_SCOPE_INVALID'; END IF;
 IF TG_TABLE_NAME='rticore_native_grc_control_test' THEN
  SELECT created_by INTO owner_email FROM rticore_native_grc_control WHERE tenant_id=NEW.tenant_id AND legal_entity_id=NEW.legal_entity_id AND project_id=NEW.project_id AND id=NEW.control_id;
  IF NOT FOUND OR actor_role<>'approver' OR lower(owner_email)=lower(NEW.created_by) THEN RAISE EXCEPTION 'GRC_INDEPENDENT_TEST_REQUIRED'; END IF;
 ELSE
  IF actor_role NOT IN ('admin','presales','defense_leader') THEN RAISE EXCEPTION 'CTI_GRC_MAKER_INVALID'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM rticore_document_library d WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.document_id AND d.opportunity_id=p.opportunity_id AND d.kind='supporting' AND lower(d.sha256)=NEW.document_sha256 AND (d.retention_until IS NULL OR d.retention_until>=CURRENT_DATE::text OR d.legal_hold=1)) THEN RAISE EXCEPTION 'CTI_GRC_EVIDENCE_INVALID'; END IF;
 IF TG_TABLE_NAME='rticore_native_cti_ioc' THEN
  IF NOT EXISTS(SELECT 1 FROM rticore_native_cti_case c WHERE c.tenant_id=NEW.tenant_id AND c.legal_entity_id=NEW.legal_entity_id AND c.project_id=NEW.project_id AND c.id=NEW.case_id AND (c.tlp<>'TLP:RED' OR lower(c.created_by)=lower(NEW.created_by))) THEN RAISE EXCEPTION 'CTI_CASE_SCOPE_INVALID'; END IF;
  IF NEW.ioc_type IN ('ipv4','ipv6') THEN
   BEGIN ip:=NEW.indicator_value::inet; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'CTI_IOC_INVALID'; END;
   IF (NEW.ioc_type='ipv4' AND (family(ip)<>4 OR masklen(ip)<>32)) OR (NEW.ioc_type='ipv6' AND (family(ip)<>6 OR masklen(ip)<>128)) THEN RAISE EXCEPTION 'CTI_IOC_INVALID'; END IF;
   NEW.indicator_value:=host(ip);
  ELSIF NEW.ioc_type='sha256' THEN
   NEW.indicator_value:=lower(NEW.indicator_value);
   IF NEW.indicator_value !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'CTI_IOC_INVALID'; END IF;
  ELSIF NEW.ioc_type='domain' THEN
   NEW.indicator_value:=lower(NEW.indicator_value);
   IF NEW.indicator_value !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$' OR NEW.indicator_value LIKE '%..%' THEN RAISE EXCEPTION 'CTI_IOC_INVALID'; END IF;
  ELSIF NEW.ioc_type='url' AND NEW.indicator_value !~ '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION 'CTI_IOC_INVALID';
  ELSIF NEW.ioc_type='email' AND NEW.indicator_value !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'CTI_IOC_INVALID'; END IF;
 END IF;
 NEW.created_at:=clock_timestamp();RETURN NEW;
END $g$;
DROP TRIGGER IF EXISTS rticore_native_cti_grc_guard ON rticore_native_cti_case;
CREATE TRIGGER rticore_native_cti_grc_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_native_cti_case FOR EACH ROW EXECUTE FUNCTION rticore_native_cti_grc_guard();
DROP TRIGGER IF EXISTS rticore_native_cti_grc_guard ON rticore_native_cti_ioc;
CREATE TRIGGER rticore_native_cti_grc_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_native_cti_ioc FOR EACH ROW EXECUTE FUNCTION rticore_native_cti_grc_guard();
DROP TRIGGER IF EXISTS rticore_native_cti_grc_guard ON rticore_native_grc_engagement;
CREATE TRIGGER rticore_native_cti_grc_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_native_grc_engagement FOR EACH ROW EXECUTE FUNCTION rticore_native_cti_grc_guard();
DROP TRIGGER IF EXISTS rticore_native_cti_grc_guard ON rticore_native_grc_risk;
CREATE TRIGGER rticore_native_cti_grc_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_native_grc_risk FOR EACH ROW EXECUTE FUNCTION rticore_native_cti_grc_guard();
DROP TRIGGER IF EXISTS rticore_native_cti_grc_guard ON rticore_native_grc_control;
CREATE TRIGGER rticore_native_cti_grc_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_native_grc_control FOR EACH ROW EXECUTE FUNCTION rticore_native_cti_grc_guard();
DROP TRIGGER IF EXISTS rticore_native_cti_grc_guard ON rticore_native_grc_control_test;
CREATE TRIGGER rticore_native_cti_grc_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_native_grc_control_test FOR EACH ROW EXECUTE FUNCTION rticore_native_cti_grc_guard();
COMMIT;
