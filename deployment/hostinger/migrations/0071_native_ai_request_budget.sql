-- Native quota: serialize admission per tenant + normalized actor, including failed attempts.
BEGIN;
CREATE INDEX IF NOT EXISTS rticore_ai_request_budget_idx ON rticore_sales_ai_audit(tenant_id,lower(actor_email),created_at) WHERE provider_id='request';
CREATE OR REPLACE FUNCTION rticore_reserve_ai_request(p_id text,p_tenant text,p_email text,p_purpose text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SET search_path=public,pg_catalog AS $ai$
DECLARE actor text:=lower(trim(p_email)); cutoff text;
BEGIN
 IF p_id IS NULL OR p_tenant IS NULL OR actor IS NULL OR actor='' OR p_purpose IS NULL OR length(p_purpose)>80 THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM rticore_members WHERE lower(email)=actor AND active=1 AND role IN ('admin','sales','presales','finance','approver')) THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('rticore-ai:'||p_tenant||':'||actor,0));
 cutoff:=to_char((clock_timestamp()-interval '1 hour') AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS');
 IF (SELECT count(*) FROM rticore_sales_ai_audit WHERE tenant_id=p_tenant AND lower(actor_email)=actor AND provider_id='request' AND created_at>=cutoff)>=20 THEN RETURN false; END IF;
 INSERT INTO rticore_sales_ai_audit(id,tenant_id,opportunity_id,purpose,provider_id,model,actor_email,created_at)
 VALUES(p_id,p_tenant,NULL,p_purpose,'request','pending',actor,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'));
 RETURN true;
END $ai$;
COMMIT;
