-- CAMS native stream. Existing historical journals are not modified.
BEGIN;
CREATE OR REPLACE FUNCTION cams_assert_review(p_journal text,p_actor text,p_action text)
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_catalog AS $cams$
DECLARE j rticore_gl_journals%ROWTYPE; w rticore_finance_journal_workflows%ROWTYPE;
 r rticore_cams_finance_inbox%ROWTYPE; amount numeric; expected jsonb; actual jsonb;
BEGIN
 SELECT * INTO STRICT j FROM rticore_gl_journals WHERE id=p_journal AND source_type='camsrti';
 SELECT * INTO STRICT r FROM rticore_cams_finance_inbox WHERE idempotency_key=j.source_key AND legal_entity_id=j.legal_entity_id;
 SELECT * INTO STRICT w FROM rticore_finance_journal_workflows WHERE tenant_id=j.tenant_id AND journal_id=j.id AND legal_entity_id=j.legal_entity_id;
 IF p_actor IS NULL OR lower(p_actor)=lower(j.created_by) OR w.submitted_by IS DISTINCT FROM j.created_by OR w.currency<>'IDR' OR w.exchange_rate_micro<>1000000 THEN
  RAISE EXCEPTION 'CAMS_REVIEW_IDENTITY_INVALID' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rticore_gl_periods p WHERE p.tenant_id=j.tenant_id AND p.legal_entity_id=j.legal_entity_id AND p.id=j.period_id AND p.period=r.period_code AND p.status='open' AND NOT EXISTS(SELECT 1 FROM rticore_finance_period_controls c WHERE c.tenant_id=p.tenant_id AND c.period_id=p.id AND c.close_stage<>'open')) THEN
  RAISE EXCEPTION 'CAMS_PERIOD_NOT_OPEN' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(debit_cents),0) INTO amount FROM rticore_gl_lines WHERE tenant_id=j.tenant_id AND journal_id=j.id;
 SELECT jsonb_agg(v ORDER BY v) INTO expected FROM (SELECT jsonb_build_array(l->>'accountId',l->>'costCenterId',(l->>'debit')::bigint,(l->>'credit')::bigint) v FROM jsonb_array_elements(r.mapped_lines_json) l) x;
 SELECT jsonb_agg(v ORDER BY v) INTO actual FROM (SELECT jsonb_build_array(l.account_id,d.cost_center_id,l.debit_cents,l.credit_cents) v FROM rticore_gl_lines l JOIN rticore_finance_journal_dimensions d ON d.tenant_id=l.tenant_id AND d.line_id=l.id AND d.journal_id=j.id AND d.legal_entity_id=j.legal_entity_id AND d.currency='IDR' AND d.period_code=r.period_code WHERE l.tenant_id=j.tenant_id AND l.journal_id=j.id) x;
 IF amount<=0 OR amount>=900000000000000 OR expected IS NULL OR actual IS DISTINCT FROM expected OR jsonb_array_length(actual)<2 OR jsonb_array_length(actual)<>(SELECT count(*) FROM rticore_gl_lines WHERE tenant_id=j.tenant_id AND journal_id=j.id) OR amount<>(SELECT sum(credit_cents) FROM rticore_gl_lines WHERE tenant_id=j.tenant_id AND journal_id=j.id) THEN
  RAISE EXCEPTION 'CAMS_DRAFT_MISMATCH' USING ERRCODE='23514'; END IF;
 IF p_action='approve' THEN
  IF j.status<>'draft' OR w.lifecycle_stage<>'submitted' OR NOT EXISTS(SELECT 1 FROM rticore_finance_role_assignments a JOIN rticore_members m ON lower(m.email)=lower(a.email) AND m.active=1 AND m.role IN ('finance','approver') WHERE a.tenant_id=j.tenant_id AND a.legal_entity_id=j.legal_entity_id AND lower(a.email)=lower(p_actor) AND a.status='approved' AND a.business_unit_id IS NULL AND a.department_id IS NULL AND a.finance_role IN ('cfo','financial_controller','finance_manager') AND a.can_check=1 AND a.can_approve=1 AND a.approval_limit_cents>=amount) THEN
   RAISE EXCEPTION 'CAMS_APPROVAL_DENIED' USING ERRCODE='23514'; END IF;
 ELSIF p_action='post' THEN
  IF j.status<>'approved' OR w.lifecycle_stage<>'approved' OR j.reviewed_by IS NULL OR lower(p_actor)=lower(j.reviewed_by) OR w.checked_by IS DISTINCT FROM j.reviewed_by OR w.approved_by IS DISTINCT FROM j.reviewed_by OR NOT EXISTS(SELECT 1 FROM rticore_finance_role_assignments a JOIN rticore_members m ON lower(m.email)=lower(a.email) AND m.active=1 AND m.role='finance' WHERE a.tenant_id=j.tenant_id AND a.legal_entity_id=j.legal_entity_id AND lower(a.email)=lower(p_actor) AND a.status='approved' AND a.business_unit_id IS NULL AND a.department_id IS NULL AND a.finance_role IN ('financial_controller','finance_manager','accounting_officer') AND a.can_post=1) THEN
   RAISE EXCEPTION 'CAMS_INDEPENDENT_POSTER_REQUIRED' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'CAMS_ACTION_INVALID' USING ERRCODE='23514'; END IF;
END $cams$;
CREATE OR REPLACE FUNCTION cams_journal_review_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $cams$
BEGIN
 IF OLD.source_type<>'camsrti' THEN RETURN NEW; END IF;
 IF NEW.status='approved' AND OLD.status='draft' AND NEW.posted_by IS NULL THEN
  PERFORM cams_assert_review(OLD.id,NEW.reviewed_by,'approve');
 ELSIF NEW.status='posted' AND OLD.status='approved' AND NEW.reviewed_by IS NOT DISTINCT FROM OLD.reviewed_by AND NEW.review_notes IS NOT DISTINCT FROM OLD.review_notes AND NEW.reviewed_at IS NOT DISTINCT FROM OLD.reviewed_at THEN
  PERFORM cams_assert_review(OLD.id,NEW.posted_by,'post');
 ELSE RAISE EXCEPTION 'CAMS_TRANSITION_DENIED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $cams$;
DROP TRIGGER IF EXISTS cams_journal_independent_review ON rticore_gl_journals;
CREATE TRIGGER cams_journal_independent_review BEFORE UPDATE ON rticore_gl_journals FOR EACH ROW EXECUTE FUNCTION cams_journal_review_guard();
CREATE OR REPLACE FUNCTION cams_workflow_review_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $cams$
DECLARE j rticore_gl_journals%ROWTYPE;
BEGIN
 SELECT * INTO j FROM rticore_gl_journals WHERE tenant_id=OLD.tenant_id AND id=OLD.journal_id AND source_type='camsrti';
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF NEW.version<>OLD.version+1 OR (to_jsonb(NEW)-ARRAY['version','lifecycle_stage','checked_by','checked_at','approved_by','approved_at','posted_by','posted_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','lifecycle_stage','checked_by','checked_at','approved_by','approved_at','posted_by','posted_at']) THEN
  RAISE EXCEPTION 'CAMS_WORKFLOW_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF OLD.lifecycle_stage='submitted' AND NEW.lifecycle_stage='approved' AND j.status='approved' AND NEW.checked_by=j.reviewed_by AND NEW.approved_by=j.reviewed_by AND NEW.checked_at IS NOT NULL AND NEW.approved_at IS NOT NULL AND NEW.posted_by IS NULL THEN RETURN NEW; END IF;
 IF OLD.lifecycle_stage='approved' AND NEW.lifecycle_stage='posted' AND j.status='posted' AND NEW.posted_by=j.posted_by AND NEW.posted_at IS NOT NULL AND NEW.checked_by IS NOT DISTINCT FROM OLD.checked_by AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by AND NEW.checked_at IS NOT DISTINCT FROM OLD.checked_at AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'CAMS_WORKFLOW_TRANSITION_DENIED' USING ERRCODE='23514';
END $cams$;
DROP TRIGGER IF EXISTS cams_workflow_independent_review ON rticore_finance_journal_workflows;
CREATE TRIGGER cams_workflow_independent_review BEFORE UPDATE ON rticore_finance_journal_workflows FOR EACH ROW EXECUTE FUNCTION cams_workflow_review_guard();
CREATE OR REPLACE FUNCTION cams_review_command(p_tenant text,p_entity text,p_source text,p_receipt text,p_actor text,p_action text,p_version bigint,p_notes text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_catalog AS $cams$
DECLARE j rticore_gl_journals%ROWTYPE; stamp text:=CURRENT_TIMESTAMP::text; next_status text;
BEGIN
 IF p_action NOT IN ('approve','post') OR p_action IS NULL OR p_actor IS NULL OR length(trim(coalesce(p_notes,''))) NOT BETWEEN 12 AND 500 THEN RAISE EXCEPTION 'CAMS_ACTION_INVALID' USING ERRCODE='23514'; END IF;
 SELECT g.* INTO j FROM rticore_gl_journals g JOIN rticore_cams_finance_inbox r ON r.idempotency_key=g.source_key AND r.legal_entity_id=g.legal_entity_id WHERE r.id=p_receipt AND r.source_tenant_id=p_source AND g.tenant_id=p_tenant AND g.legal_entity_id=p_entity AND g.source_type='camsrti' FOR UPDATE OF g;
 IF NOT FOUND OR j.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'CAMS_SCOPE_OR_VERSION_INVALID' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM rticore_gl_periods WHERE tenant_id=j.tenant_id AND id=j.period_id FOR UPDATE;
 PERFORM cams_assert_review(j.id,p_actor,p_action);
 IF p_action='approve' THEN
  UPDATE rticore_gl_journals SET status='approved',version=version+1,reviewed_by=lower(p_actor),review_notes=trim(p_notes),reviewed_at=stamp WHERE id=j.id;
  UPDATE rticore_finance_journal_workflows SET lifecycle_stage='approved',version=version+1,checked_by=lower(p_actor),approved_by=lower(p_actor),checked_at=stamp,approved_at=stamp WHERE tenant_id=j.tenant_id AND journal_id=j.id;
  next_status:='approved';
 ELSE
  UPDATE rticore_gl_journals SET status='posted',version=version+1,posted_by=lower(p_actor),posted_at=stamp WHERE id=j.id;
  UPDATE rticore_finance_journal_workflows SET lifecycle_stage='posted',version=version+1,posted_by=lower(p_actor),posted_at=stamp WHERE tenant_id=j.tenant_id AND journal_id=j.id;
  next_status:='posted';
 END IF;
 INSERT INTO rticore_operations_events(id,tenant_id,area,entity_id,action,actor_email,snapshot_json) VALUES(gen_random_uuid()::text,j.tenant_id,'rti_finance',j.id,'CAMS_JOURNAL_'||upper(next_status),lower(p_actor),jsonb_build_object('receiptId',p_receipt,'notes',trim(p_notes),'version',j.version+1)::text);
 RETURN jsonb_build_object('journalId',j.id,'status',next_status,'version',j.version+1);
END $cams$;
COMMIT;
