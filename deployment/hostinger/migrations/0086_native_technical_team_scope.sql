BEGIN;
-- Dedicated technical access: approved legal-entity affiliation + active project resource allocation.
CREATE OR REPLACE FUNCTION rticore_native_vapt_actor(p_tenant text,p_entity text,p_project text,p_actor text)
RETURNS text LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $s$
 WITH RECURSIVE scoped(unit_id) AS (
 SELECT s.unit_id FROM rticore_erp_staff_org s JOIN rticore_erp_org_units u ON u.tenant_id=s.tenant_id AND u.id=s.unit_id AND u.active=1 WHERE s.tenant_id=p_tenant AND lower(s.email)=lower(p_actor) AND s.status='approved'
 UNION
 SELECT u.parent_id FROM rticore_erp_org_units u JOIN scoped x ON x.unit_id=u.id JOIN rticore_erp_org_units p ON p.tenant_id=u.tenant_id AND p.id=u.parent_id AND p.active=1 WHERE u.tenant_id=p_tenant AND u.active=1
 )
 SELECT m.role FROM rticore_members m
 JOIN rticore_erp_project_scopes sc ON sc.tenant_id=p_tenant AND sc.project_id=p_project AND sc.legal_entity_id=p_entity AND sc.status='approved'
 JOIN rticore_delivery_projects p ON p.tenant_id=sc.tenant_id AND p.id=sc.project_id AND p.service_family='VAPT'
 JOIN rticore_erp_org_units u ON u.tenant_id=p_tenant AND u.id=p_entity AND u.kind='legal_entity' AND u.active=1
 WHERE lower(m.email)=lower(p_actor) AND m.active=1 AND EXISTS(SELECT 1 FROM scoped WHERE unit_id=p_entity)
 AND (((m.role IN ('admin','presales','approver')) AND EXISTS(SELECT 1 FROM rticore_erp_role_capability_matrix pol JOIN rticore_erp_capability_grants g ON lower(g.email)=lower(m.email) AND g.tenant_id=p_tenant AND g.unit_id=p_entity AND g.capability=pol.capability AND g.status='approved' WHERE pol.role=m.role AND pol.capability='cyber_ops' AND pol.allowed=1)) OR ((m.role IN ('offense_lead','offense_member')) AND p.status='active' AND EXISTS(SELECT 1 FROM rticore_resource_allocations x JOIN rticore_resource_people rp ON rp.id=x.person_id AND rp.tenant_id=x.tenant_id WHERE x.tenant_id=p.tenant_id AND x.opportunity_id=p.opportunity_id AND x.status='active' AND rp.active=1 AND lower(rp.email)=lower(m.email))))
$s$;
CREATE OR REPLACE FUNCTION rticore_native_cti_grc_actor(p_tenant text,p_entity text,p_project text,p_actor text)
RETURNS text LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $s$
 WITH RECURSIVE scoped(unit_id) AS (
 SELECT s.unit_id FROM rticore_erp_staff_org s JOIN rticore_erp_org_units u ON u.tenant_id=s.tenant_id AND u.id=s.unit_id AND u.active=1 WHERE s.tenant_id=p_tenant AND lower(s.email)=lower(p_actor) AND s.status='approved'
 UNION
 SELECT u.parent_id FROM rticore_erp_org_units u JOIN scoped x ON x.unit_id=u.id JOIN rticore_erp_org_units p ON p.tenant_id=u.tenant_id AND p.id=u.parent_id AND p.active=1 WHERE u.tenant_id=p_tenant AND u.active=1
 )
 SELECT m.role FROM rticore_members m
 JOIN rticore_erp_project_scopes sc ON sc.tenant_id=p_tenant AND sc.project_id=p_project AND sc.legal_entity_id=p_entity AND sc.status='approved'
 JOIN rticore_delivery_projects p ON p.tenant_id=sc.tenant_id AND p.id=sc.project_id AND p.service_family IN ('CTI','Digital Risk Protection','GRC','Cybersecurity Governance','GRC / Risk Management','ISO 27001 / ISMS','ISO 27701 / Privacy Management','PDP / Data Privacy','DPO as a Service','IT Audit / IT Assurance','IT Governance / IT Risk','ICOFR / Internal Control','BCM / BCP / DRP','Third Party / Vendor Risk Assessment','vCISO / Cybersecurity Advisory')
 JOIN rticore_erp_org_units u ON u.tenant_id=p_tenant AND u.id=p_entity AND u.kind='legal_entity' AND u.active=1
 WHERE lower(m.email)=lower(p_actor) AND m.active=1 AND EXISTS(SELECT 1 FROM scoped WHERE unit_id=p_entity)
 AND (((m.role IN ('admin','presales','approver','defense_leader') AND (m.role<>'defense_leader' OR p.service_family IN ('CTI','Digital Risk Protection'))) AND EXISTS(SELECT 1 FROM rticore_erp_role_capability_matrix pol JOIN rticore_erp_capability_grants g ON lower(g.email)=lower(m.email) AND g.tenant_id=p_tenant AND g.unit_id=p_entity AND g.capability=pol.capability AND g.status='approved' WHERE pol.role=m.role AND pol.capability='cyber_ops' AND pol.allowed=1)) OR ((m.role IN ('governance_leader','governance_member') AND p.service_family NOT IN ('CTI','Digital Risk Protection')) AND p.status='active' AND EXISTS(SELECT 1 FROM rticore_resource_allocations x JOIN rticore_resource_people rp ON rp.id=x.person_id AND rp.tenant_id=x.tenant_id WHERE x.tenant_id=p.tenant_id AND x.opportunity_id=p.opportunity_id AND x.status='active' AND rp.active=1 AND lower(rp.email)=lower(m.email))))
$s$;
CREATE OR REPLACE FUNCTION rticore_native_vapt_engagement_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $v$
DECLARE opp text; role text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'VAPT_ENGAGEMENT_IMMUTABLE'; END IF;
 SELECT opportunity_id INTO opp FROM rticore_delivery_projects WHERE tenant_id=NEW.tenant_id AND id=NEW.project_id AND service_family='VAPT' AND status='active' FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM rticore_document_library d WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.roe_document_id AND d.opportunity_id=opp AND d.kind='supporting' AND lower(d.sha256)=NEW.roe_sha256 AND (d.retention_until IS NULL OR d.retention_until>=CURRENT_DATE::text OR d.legal_hold=1)) THEN RAISE EXCEPTION 'VAPT_ROE_EVIDENCE_INVALID'; END IF;
 role:=rticore_native_vapt_actor(NEW.tenant_id,NEW.legal_entity_id,NEW.project_id,NEW.created_by);
 IF role IS NULL OR role NOT IN ('admin','presales','offense_lead') THEN RAISE EXCEPTION 'VAPT_SCOPE_INVALID'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'registered' OR NEW.version<>1 OR NEW.window_end<CURRENT_DATE THEN RAISE EXCEPTION 'VAPT_REGISTRATION_INVALID'; END IF;
  NEW.created_at:=clock_timestamp();RETURN NEW;
 END IF;
 IF OLD.status<>'registered' OR NEW.status NOT IN ('roe_approved','roe_rejected') OR NEW.version<>OLD.version+1 OR (to_jsonb(NEW)-ARRAY['status','version','reviewed_by','reviewed_at','review_notes']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','reviewed_by','reviewed_at','review_notes']) THEN RAISE EXCEPTION 'VAPT_ENGAGEMENT_IMMUTABLE'; END IF;
 IF lower(NEW.reviewed_by)=lower(OLD.created_by) OR rticore_native_vapt_actor(NEW.tenant_id,NEW.legal_entity_id,NEW.project_id,NEW.reviewed_by) IS DISTINCT FROM 'approver' OR (NEW.status='roe_approved' AND NEW.window_end<CURRENT_DATE) THEN RAISE EXCEPTION 'VAPT_ROE_REVIEW_INVALID'; END IF;
 NEW.reviewed_at:=clock_timestamp();RETURN NEW;
END $v$;
CREATE OR REPLACE FUNCTION rticore_native_vapt_finding_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $v$
DECLARE e record; actor_role text; doc text; digest text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'VAPT_FINDING_IMMUTABLE'; END IF;
 SELECT x.status,x.window_start,x.window_end,p.opportunity_id INTO e FROM rticore_native_vapt_engagement x JOIN rticore_delivery_projects p ON p.tenant_id=x.tenant_id AND p.id=x.project_id WHERE x.tenant_id=NEW.tenant_id AND x.legal_entity_id=NEW.legal_entity_id AND x.project_id=NEW.project_id AND x.id=NEW.engagement_id AND p.status='active' FOR UPDATE OF x;
 IF NOT FOUND OR e.status<>'roe_approved' THEN RAISE EXCEPTION 'VAPT_ROE_REQUIRED'; END IF;
 actor_role:=rticore_native_vapt_actor(NEW.tenant_id,NEW.legal_entity_id,NEW.project_id,NEW.last_actor);
 IF actor_role IS NULL THEN RAISE EXCEPTION 'VAPT_FINDING_SCOPE_INVALID'; END IF;
 doc:=NEW.evidence_document_id;digest:=NEW.evidence_sha256;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'open' OR NEW.version<>1 OR actor_role NOT IN ('admin','presales','offense_lead','offense_member') OR lower(NEW.created_by)<>lower(NEW.last_actor) OR NEW.retest_document_id IS NOT NULL OR CURRENT_DATE NOT BETWEEN e.window_start AND e.window_end THEN RAISE EXCEPTION 'VAPT_FINDING_REGISTRATION_INVALID'; END IF;
  NEW.created_at:=clock_timestamp();
 ELSE
  IF NEW.version<>OLD.version+1 OR (to_jsonb(NEW)-ARRAY['status','version','last_actor','last_notes','retest_document_id','retest_sha256','retest_by']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','last_actor','last_notes','retest_document_id','retest_sha256','retest_by']) THEN RAISE EXCEPTION 'VAPT_FINDING_IMMUTABLE'; END IF;
  IF OLD.status='open' AND NEW.status IN ('qa_approved','qa_rejected') THEN
   IF actor_role<>'approver' OR lower(NEW.last_actor)=lower(OLD.created_by) THEN RAISE EXCEPTION 'VAPT_QA_REVIEW_INVALID'; END IF;
  ELSIF OLD.status IN ('qa_approved','still_vulnerable') AND NEW.status='retest_requested' THEN
   IF actor_role<>'approver' OR lower(NEW.last_actor)=lower(OLD.created_by) THEN RAISE EXCEPTION 'VAPT_QA_REVIEW_INVALID'; END IF;
  ELSIF OLD.status='retest_requested' AND NEW.status='retest_submitted' THEN
   IF actor_role NOT IN ('admin','presales','offense_lead','offense_member') OR lower(NEW.last_actor)=lower(OLD.last_actor) OR NEW.retest_document_id IS NULL OR NEW.retest_document_id=OLD.evidence_document_id OR NEW.retest_document_id IS NOT DISTINCT FROM OLD.retest_document_id OR lower(NEW.retest_by) IS DISTINCT FROM lower(NEW.last_actor) THEN RAISE EXCEPTION 'VAPT_RETEST_INVALID'; END IF;
   doc:=NEW.retest_document_id;digest:=NEW.retest_sha256;
  ELSIF OLD.status='retest_submitted' AND NEW.status IN ('verified_fixed','still_vulnerable') THEN
   IF actor_role<>'approver' OR lower(NEW.last_actor) IN (lower(OLD.created_by),lower(OLD.retest_by)) THEN RAISE EXCEPTION 'VAPT_RETEST_REVIEW_INVALID'; END IF;
   doc:=OLD.retest_document_id;digest:=OLD.retest_sha256;
  ELSE RAISE EXCEPTION 'VAPT_FINDING_TRANSITION_INVALID'; END IF;
  IF NEW.status<>'retest_submitted' AND (NEW.retest_document_id IS DISTINCT FROM OLD.retest_document_id OR NEW.retest_sha256 IS DISTINCT FROM OLD.retest_sha256 OR NEW.retest_by IS DISTINCT FROM OLD.retest_by) THEN RAISE EXCEPTION 'VAPT_FINDING_IMMUTABLE'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM rticore_document_library d WHERE d.tenant_id=NEW.tenant_id AND d.id=doc AND d.opportunity_id=e.opportunity_id AND d.kind='supporting' AND lower(d.sha256)=digest AND (d.retention_until IS NULL OR d.retention_until>=CURRENT_DATE::text OR d.legal_hold=1)) THEN RAISE EXCEPTION 'VAPT_FINDING_EVIDENCE_INVALID'; END IF;
 RETURN NEW;
END $v$;
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
  IF actor_role NOT IN ('admin','presales','defense_leader','governance_leader','governance_member') THEN RAISE EXCEPTION 'CTI_GRC_MAKER_INVALID'; END IF;
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
COMMIT;
