BEGIN;
-- A-R11. Service request approval does not post, reserve or consume credits.
CREATE TABLE IF NOT EXISTS rticore_native_fg_service_request (
 id text PRIMARY KEY,tenant_id text NOT NULL,legal_entity_id text NOT NULL,wallet_id text NOT NULL,
 project_id text NOT NULL,contract_id text NOT NULL,customer_id text NOT NULL,
 request_code text NOT NULL CHECK(length(request_code) BETWEEN 4 AND 64),
 title text NOT NULL CHECK(length(title) BETWEEN 5 AND 200),scope_summary text NOT NULL CHECK(length(scope_summary) BETWEEN 12 AND 2000),
 status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','scope_quoted','scope_approved','in_delivery','qa_passed','accepted','closed','rejected')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),quoted_credits integer CHECK(quoted_credits BETWEEN 1 AND 100000),
 reservation_id text,consumption_id text,
 created_by text NOT NULL,last_actor text NOT NULL,last_notes text NOT NULL CHECK(length(last_notes) BETWEEN 12 AND 1000),
 last_document_id text NOT NULL REFERENCES rticore_document_library(id),last_document_sha256 text NOT NULL CHECK(last_document_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,legal_entity_id,wallet_id,request_code),UNIQUE(tenant_id,legal_entity_id,wallet_id,id),
 UNIQUE(tenant_id,reservation_id),UNIQUE(tenant_id,consumption_id),
 FOREIGN KEY(tenant_id,wallet_id) REFERENCES rticore_flexguard_wallets(tenant_id,id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES rticore_delivery_projects(tenant_id,id),
 FOREIGN KEY(tenant_id,contract_id) REFERENCES rticore_service_contracts(tenant_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id,wallet_id,reservation_id) REFERENCES rticore_flexguard_enterprise_ledger(tenant_id,legal_entity_id,wallet_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id,wallet_id,consumption_id) REFERENCES rticore_flexguard_enterprise_ledger(tenant_id,legal_entity_id,wallet_id,id)
);
CREATE TABLE IF NOT EXISTS rticore_native_fg_service_event (
 tenant_id text NOT NULL,legal_entity_id text NOT NULL,wallet_id text NOT NULL,request_id text NOT NULL,version integer NOT NULL,
 status text NOT NULL,actor_email text NOT NULL,notes text NOT NULL,document_id text NOT NULL,document_sha256 text NOT NULL,
 quoted_credits integer,reservation_id text,consumption_id text,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,request_id,version),
 FOREIGN KEY(tenant_id,legal_entity_id,wallet_id,request_id) REFERENCES rticore_native_fg_service_request(tenant_id,legal_entity_id,wallet_id,id)
);
CREATE OR REPLACE FUNCTION rticore_native_fg_service_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $s$
DECLARE w record; actor_role text; reserved bigint; remaining bigint; consumed bigint;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FLEXGUARD_SERVICE_IMMUTABLE'; END IF;
 SELECT c.project_id,c.id AS contract_id,c.customer_id,p.opportunity_id INTO w
 FROM rticore_flexguard_wallets x JOIN rticore_service_contracts c ON c.tenant_id=x.tenant_id AND c.id=x.contract_id AND c.customer_id=x.customer_id
 JOIN rticore_delivery_projects p ON p.tenant_id=c.tenant_id AND p.id=c.project_id AND p.customer_id=c.customer_id
 JOIN rticore_erp_project_scopes sc ON sc.tenant_id=p.tenant_id AND sc.project_id=p.id AND sc.legal_entity_id=NEW.legal_entity_id AND sc.status='approved'
 JOIN rticore_fg_contract_terms b ON b.tenant_id=c.tenant_id AND b.legal_entity_id=NEW.legal_entity_id AND b.contract_id=c.id AND b.contract_version=c.version AND b.status='approved'
 WHERE x.tenant_id=NEW.tenant_id AND x.id=NEW.wallet_id AND x.status='active' AND c.model='FlexGuard' AND c.status='active' AND c.start_date<=CURRENT_DATE::text AND c.end_date>=CURRENT_DATE::text AND rticore_fg_contract_binding_valid(c.tenant_id,NEW.legal_entity_id,c.id,b.terms_id) FOR UPDATE OF x;
 IF NOT FOUND OR NEW.project_id<>w.project_id OR NEW.contract_id<>w.contract_id OR NEW.customer_id<>w.customer_id THEN RAISE EXCEPTION 'FLEXGUARD_SERVICE_SCOPE_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM rticore_flexguard_events WHERE tenant_id=NEW.tenant_id AND wallet_id=NEW.wallet_id) THEN RAISE EXCEPTION 'FLEXGUARD_SERVICE_LEGACY_BLOCKED'; END IF;
 actor_role:=rticore_fg_actor_role(NEW.tenant_id,NEW.legal_entity_id,NEW.last_actor);
 IF actor_role IS NULL OR actor_role NOT IN ('admin','finance','approver') THEN RAISE EXCEPTION 'FLEXGUARD_SERVICE_ACCESS_DENIED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rticore_document_library d WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.last_document_id AND d.opportunity_id=w.opportunity_id AND d.kind='supporting' AND lower(d.sha256)=NEW.last_document_sha256 AND (d.retention_until IS NULL OR d.retention_until>=CURRENT_DATE::text OR d.legal_hold=1)) THEN RAISE EXCEPTION 'FLEXGUARD_SERVICE_EVIDENCE_INVALID'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'submitted' OR NEW.version<>1 OR actor_role NOT IN ('admin','finance') OR lower(NEW.created_by)<>lower(NEW.last_actor) OR NEW.quoted_credits IS NOT NULL OR NEW.reservation_id IS NOT NULL OR NEW.consumption_id IS NOT NULL THEN RAISE EXCEPTION 'FLEXGUARD_SERVICE_INVALID'; END IF;
  NEW.created_at:=clock_timestamp();RETURN NEW;
 END IF;
 IF NEW.version<>OLD.version+1 OR (to_jsonb(NEW)-ARRAY['status','version','quoted_credits','reservation_id','consumption_id','last_actor','last_notes','last_document_id','last_document_sha256']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','quoted_credits','reservation_id','consumption_id','last_actor','last_notes','last_document_id','last_document_sha256']) THEN RAISE EXCEPTION 'FLEXGUARD_SERVICE_IMMUTABLE'; END IF;
 IF OLD.status='submitted' AND NEW.status='scope_quoted' THEN
  IF actor_role NOT IN ('admin','finance') OR NEW.quoted_credits IS NULL THEN RAISE EXCEPTION 'FLEXGUARD_SERVICE_QUOTE_INVALID'; END IF;
 ELSIF OLD.status='scope_quoted' AND NEW.status IN ('scope_approved','rejected') THEN
  IF actor_role<>'approver' OR lower(NEW.last_actor) IN (lower(OLD.created_by),lower(OLD.last_actor)) OR NEW.last_document_id=OLD.last_document_id THEN RAISE EXCEPTION 'FLEXGUARD_SERVICE_APPROVAL_INVALID'; END IF;
 ELSIF OLD.status='scope_approved' AND NEW.status='in_delivery' THEN
  IF actor_role NOT IN ('admin','finance') OR NEW.reservation_id IS NULL THEN RAISE EXCEPTION 'FLEXGUARD_SERVICE_RESERVATION_INVALID'; END IF;
  SELECT credit_amount INTO reserved FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=NEW.tenant_id AND legal_entity_id=NEW.legal_entity_id AND wallet_id=NEW.wallet_id AND id=NEW.reservation_id AND transaction_type='reservation';
  IF NOT FOUND OR reserved<>NEW.quoted_credits THEN RAISE EXCEPTION 'FLEXGUARD_SERVICE_RESERVATION_INVALID'; END IF;
  SELECT coalesce(sum(reserved_delta),0) INTO remaining FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=NEW.tenant_id AND legal_entity_id=NEW.legal_entity_id AND wallet_id=NEW.wallet_id AND (id=NEW.reservation_id OR source_tx_id=NEW.reservation_id);
  IF remaining<>reserved THEN RAISE EXCEPTION 'FLEXGUARD_SERVICE_RESERVATION_INVALID'; END IF;
 ELSIF OLD.status='in_delivery' AND NEW.status='qa_passed' THEN
  IF actor_role<>'approver' OR lower(NEW.last_actor) IN (lower(OLD.created_by),lower(OLD.last_actor)) OR NEW.last_document_id=OLD.last_document_id THEN RAISE EXCEPTION 'FLEXGUARD_SERVICE_QA_INVALID'; END IF;
 ELSIF OLD.status='qa_passed' AND NEW.status='accepted' THEN
  -- Recorded customer acceptance: original Vault evidence, not simulated customer identity.
  IF actor_role<>'approver' OR lower(NEW.last_actor)=lower(OLD.created_by) OR NEW.last_document_id=OLD.last_document_id THEN RAISE EXCEPTION 'FLEXGUARD_SERVICE_ACCEPTANCE_INVALID'; END IF;
 ELSIF OLD.status='accepted' AND NEW.status='closed' THEN
  IF actor_role<>'approver' OR lower(NEW.last_actor)=lower(OLD.created_by) OR NEW.consumption_id IS NULL THEN RAISE EXCEPTION 'FLEXGUARD_SERVICE_CLOSE_INVALID'; END IF;
  SELECT l.credit_amount INTO consumed FROM rticore_flexguard_enterprise_ledger l JOIN rticore_delivery_milestones m ON m.tenant_id=l.tenant_id AND m.id=l.milestone_id AND m.project_id=NEW.project_id AND m.status='accepted'
   JOIN rticore_finance_integration_events e ON e.tenant_id=l.tenant_id AND e.legal_entity_id=l.legal_entity_id AND e.id=l.finance_outbox_event_id AND e.status='processed'
   WHERE l.tenant_id=NEW.tenant_id AND l.legal_entity_id=NEW.legal_entity_id AND l.wallet_id=NEW.wallet_id AND l.id=NEW.consumption_id AND l.transaction_type='consumption' AND l.source_tx_id=NEW.reservation_id;
  IF NOT FOUND OR consumed>NEW.quoted_credits THEN RAISE EXCEPTION 'FLEXGUARD_SERVICE_CONSUMPTION_INVALID'; END IF;
  SELECT coalesce(sum(reserved_delta),0) INTO remaining FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=NEW.tenant_id AND legal_entity_id=NEW.legal_entity_id AND wallet_id=NEW.wallet_id AND (id=NEW.reservation_id OR source_tx_id=NEW.reservation_id);
  IF remaining<>0 OR (SELECT count(*) FROM rticore_flexguard_enterprise_ledger WHERE tenant_id=NEW.tenant_id AND wallet_id=NEW.wallet_id AND source_tx_id=NEW.reservation_id AND transaction_type='consumption')<>1 THEN RAISE EXCEPTION 'FLEXGUARD_SERVICE_RECONCILIATION_REQUIRED'; END IF;
 ELSE RAISE EXCEPTION 'FLEXGUARD_SERVICE_TRANSITION_INVALID'; END IF;
 IF (NEW.status<>'scope_quoted' AND NEW.quoted_credits IS DISTINCT FROM OLD.quoted_credits) OR (NEW.status<>'in_delivery' AND NEW.reservation_id IS DISTINCT FROM OLD.reservation_id) OR (NEW.status<>'closed' AND NEW.consumption_id IS DISTINCT FROM OLD.consumption_id) THEN RAISE EXCEPTION 'FLEXGUARD_SERVICE_IMMUTABLE'; END IF;
 RETURN NEW;
END $s$;
DROP TRIGGER IF EXISTS rticore_native_fg_service_guard ON rticore_native_fg_service_request;
CREATE TRIGGER rticore_native_fg_service_guard BEFORE INSERT OR UPDATE OR DELETE ON rticore_native_fg_service_request FOR EACH ROW EXECUTE FUNCTION rticore_native_fg_service_guard();
CREATE OR REPLACE FUNCTION rticore_native_fg_service_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $s$
BEGIN
 INSERT INTO rticore_native_fg_service_event(tenant_id,legal_entity_id,wallet_id,request_id,version,status,actor_email,notes,document_id,document_sha256,quoted_credits,reservation_id,consumption_id)
 VALUES(NEW.tenant_id,NEW.legal_entity_id,NEW.wallet_id,NEW.id,NEW.version,NEW.status,NEW.last_actor,NEW.last_notes,NEW.last_document_id,NEW.last_document_sha256,NEW.quoted_credits,NEW.reservation_id,NEW.consumption_id);
 RETURN NEW;
END $s$;
DROP TRIGGER IF EXISTS rticore_native_fg_service_audit ON rticore_native_fg_service_request;
CREATE TRIGGER rticore_native_fg_service_audit AFTER INSERT OR UPDATE ON rticore_native_fg_service_request FOR EACH ROW EXECUTE FUNCTION rticore_native_fg_service_audit();
CREATE OR REPLACE FUNCTION rticore_native_fg_service_event_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $s$
BEGIN RAISE EXCEPTION 'FLEXGUARD_SERVICE_EVENT_IMMUTABLE'; END $s$;
DROP TRIGGER IF EXISTS rticore_native_fg_service_event_immutable ON rticore_native_fg_service_event;
CREATE TRIGGER rticore_native_fg_service_event_immutable BEFORE UPDATE OR DELETE ON rticore_native_fg_service_event FOR EACH ROW EXECUTE FUNCTION rticore_native_fg_service_event_immutable();
COMMIT;
