import {nativeMigrationManifest} from './native-migration-manifest.mjs';
export const REQUIRED_NATIVE_COMMANDS=[
 'rticore_catalog_boq_binding_valid(text,text,text)',
 'rticore_catalog_boq_binding_command(text,text,text,text,text,jsonb)',
 'rticore_catalog_bind_priced_contract(text,text,text,text,text,text,text)',
 'rticore_fg_historical_allocation_candidates(text,text,text)',
 'rticore_fg_historical_allocation_review(text,text,text,text,text,text,text)',
 'rticore_reserve_ai_request(text,text,text,text)',
 'rticore_native_job_claim(text,text,text,text)',
 'rticore_native_job_finish(text,text,text,text,text,boolean)',
 'rticore_native_recovery_command(text,text,text,text,text,text,text)',
 'cams_review_command(text,text,text,text,text,text,bigint,text)'
];
export async function checkNativeCompletion(client){
 const result=await client.query("SELECT x.signature, to_regprocedure('public.'||x.signature) IS NOT NULL AS present FROM unnest($1::text[]) x(signature)",[REQUIRED_NATIVE_COMMANDS]);
 if(result.rows.length!==REQUIRED_NATIVE_COMMANDS.length||REQUIRED_NATIVE_COMMANDS.some(s=>!result.rows.some(r=>r.signature===s&&r.present===true)))throw Error('Native command inventory incomplete');
 const rows=await client.query("SELECT to_regclass('public.rticore_catalog_boq_bindings') IS NOT NULL AS boq, to_regclass('public.rticore_ai_request_budget_idx') IS NOT NULL AS budget_index, to_regclass('public.rticore_feature_change_requests') IS NOT NULL AS feature_requests, to_regclass('public.rticore_feature_change_pending') IS NOT NULL AS feature_pending_index, to_regclass('public.rticore_native_jobs') IS NOT NULL AS jobs, to_regclass('public.rticore_native_jobs_due') IS NOT NULL AS jobs_due_index, to_regclass('public.rticore_native_job_recovery') IS NOT NULL AS job_recovery, to_regclass('public.rticore_native_job_recovery_pending') IS NOT NULL AS recovery_pending_index, EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.rticore_native_job_recovery_once') AND i.indrelid=to_regclass('public.rticore_native_job_recovery') AND i.indisunique AND i.indisvalid AND i.indisready AND i.indpred IS NOT NULL) AS recovery_once_index, EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE t.tgrelid=to_regclass('public.rticore_native_job_recovery') AND t.tgname='rticore_native_recovery_guard' AND NOT t.tgisinternal AND t.tgenabled IN ('O','A') AND p.proname='rticore_native_recovery_guard' AND n.nspname='public' AND t.tgtype=27) AS recovery_guard, EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.rticore_feature_change_requests') AND tgname='rticore_feature_change_guard' AND tgenabled IN ('O','A')) AS feature_guard, EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.rticore_gl_journals') AND tgname='cams_journal_independent_review' AND tgenabled IN ('O','A')) AS journal_guard, EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.rticore_finance_journal_workflows') AND tgname='cams_workflow_independent_review' AND tgenabled IN ('O','A')) AS workflow_guard");
 if(rows.rows.length!==1||['boq','budget_index','feature_requests','feature_pending_index','jobs','jobs_due_index','job_recovery','recovery_pending_index','recovery_once_index','recovery_guard','feature_guard','journal_guard','workflow_guard'].some(k=>rows.rows[0][k]!==true))throw Error('Native migration object inventory incomplete');
 return {scope:'read_only_object_presence',source_manifest:nativeMigrationManifest(),applied_ledger_verified:false};
}

// Require two distinct active, enrolled administrator identities; unknown results fail closed.
export async function assertNativeMfaEnrollment(client){
 const result=await client.query("SELECT count(DISTINCT lower(trim(m.email)))::int AS n FROM rticore_iam_credentials c JOIN rticore_members m ON m.email=c.email WHERE c.enrolled_at IS NOT NULL AND c.password_hash IS NOT NULL AND length(c.password_hash)>0 AND length(c.totp_cipher)>0 AND c.invite_hash IS NULL AND c.invite_expires IS NULL AND m.active=1 AND m.role='admin'");
 const count=result.rows.length===1?result.rows[0].n:null;
 if(!Number.isSafeInteger(count)||count<2)throw Error('Two independently enrolled administrators required before cutover');
 return true;
}
