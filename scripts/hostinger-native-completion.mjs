import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
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
 'rticore_native_dfir_append(text,text,text,text,text,text,text,text,text,integer)',
 'rticore_native_dfir_actor(text,text,text,text)',
 'rticore_native_soc_actor(text,text,text,text)',
 'rticore_native_vapt_actor(text,text,text,text)',
 'rticore_native_vapt_finding_guard()',
 'rticore_native_vapt_finding_audit()',
 'rticore_native_cti_grc_actor(text,text,text,text)',
 'rticore_native_cti_grc_guard()',
 'cams_review_command(text,text,text,text,text,text,bigint,text)'
];
// Same signature can survive a stale migration; compare exact stored function body.
export const NATIVE_REVIEW_DEFINITIONS=[
 ['0075_flexguard_historical_review_guard.sql','rticore_fg_historical_allocation_review(text,text,text,text,text,text,text)','plpgsql','v','search_path=public, pg_catalog'],
 ['0076_flexguard_acknowledgement_guard.sql','rticore_fg_independent_posting(text,text,text,text)','sql','i','search_path=pg_catalog'],
 ['0076_flexguard_acknowledgement_guard.sql','rticore_fg_dock(text,text,text,text,text,text,text,text)','plpgsql','v','search_path=public, pg_catalog'],
 ['0076_flexguard_acknowledgement_guard.sql','rticore_fg_event_guard()','plpgsql','v','search_path=public, pg_catalog']
];
const normalizeBody=s=>s.replace(/\r\n/g,'\n').trim();
export function expectedReviewDefinitions(root=process.cwd()){
 return NATIVE_REVIEW_DEFINITIONS.map(([file,signature,language,volatility,config])=>{
  const source=readFileSync(resolve(root,'deployment/hostinger/migrations',file),'utf8');
  const name=signature.split('(')[0];
  const start=source.indexOf('CREATE OR REPLACE FUNCTION '+name+'(');
  const match=start<0?null:source.slice(start).match(/ AS \$fg\$([\s\S]*?)\$fg\$;/);
  if(!match||!match[1].trim())throw Error('Native review migration source missing: '+signature);
  return {signature,body:normalizeBody(match[1]),language,volatility,security_definer:false,config:[config]};
 });
}
export async function checkNativeCompletion(client){
 const result=await client.query("SELECT x.signature, to_regprocedure('public.'||x.signature) IS NOT NULL AS present FROM unnest($1::text[]) x(signature)",[REQUIRED_NATIVE_COMMANDS]);
 if(result.rows.length!==REQUIRED_NATIVE_COMMANDS.length||REQUIRED_NATIVE_COMMANDS.some(s=>!result.rows.some(r=>r.signature===s&&r.present===true)))throw Error('Native command inventory incomplete');
 const rows=await client.query("SELECT to_regclass('public.rticore_catalog_boq_bindings') IS NOT NULL AS boq, to_regclass('public.rticore_ai_request_budget_idx') IS NOT NULL AS budget_index, to_regclass('public.rticore_feature_change_requests') IS NOT NULL AS feature_requests, to_regclass('public.rticore_feature_change_pending') IS NOT NULL AS feature_pending_index, to_regclass('public.rticore_native_jobs') IS NOT NULL AS jobs, to_regclass('public.rticore_native_jobs_due') IS NOT NULL AS jobs_due_index, to_regclass('public.rticore_native_job_recovery') IS NOT NULL AS job_recovery, to_regclass('public.rticore_native_job_recovery_pending') IS NOT NULL AS recovery_pending_index, EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.rticore_native_job_recovery_once') AND i.indrelid=to_regclass('public.rticore_native_job_recovery') AND i.indisunique AND i.indisvalid AND i.indisready AND i.indpred IS NOT NULL) AS recovery_once_index, EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE t.tgrelid=to_regclass('public.rticore_native_job_recovery') AND t.tgname='rticore_native_recovery_guard' AND NOT t.tgisinternal AND t.tgenabled IN ('O','A') AND p.proname='rticore_native_recovery_guard' AND n.nspname='public' AND t.tgtype=27) AS recovery_guard, EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.rticore_feature_change_requests') AND tgname='rticore_feature_change_guard' AND tgenabled IN ('O','A')) AS feature_guard, EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.rticore_gl_journals') AND tgname='cams_journal_independent_review' AND tgenabled IN ('O','A')) AS journal_guard, EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.rticore_finance_journal_workflows') AND tgname='cams_workflow_independent_review' AND tgenabled IN ('O','A')) AS workflow_guard");
 if(rows.rows.length!==1||['boq','budget_index','feature_requests','feature_pending_index','jobs','jobs_due_index','job_recovery','recovery_pending_index','recovery_once_index','recovery_guard','feature_guard','journal_guard','workflow_guard'].some(k=>rows.rows[0][k]!==true))throw Error('Native migration object inventory incomplete');
 const expected=expectedReviewDefinitions();
 const actual=await client.query("SELECT x.signature,p.prosrc AS body,l.lanname AS language,p.prosecdef AS security_definer,p.provolatile AS volatility,p.proconfig AS config FROM unnest($1::text[]) x(signature) LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||x.signature) LEFT JOIN pg_language l ON l.oid=p.prolang",[expected.map(d=>d.signature)]);
 if(actual.rows.length!==expected.length||expected.some(e=>!actual.rows.some(d=>d.signature===e.signature&&typeof d.body==='string'&&normalizeBody(d.body)===e.body&&d.language===e.language&&d.security_definer===false&&d.volatility===e.volatility&&JSON.stringify(d.config)===JSON.stringify(e.config))))throw Error('Native review migration 0075–0076 definition mismatch');
 return {scope:'read_only_object_presence',source_manifest:nativeMigrationManifest(),applied_ledger_verified:false};
}

// Require two distinct active, enrolled administrator identities; unknown results fail closed.
export async function assertNativeMfaEnrollment(client){
 const result=await client.query("SELECT count(DISTINCT lower(trim(m.email)))::int AS n FROM rticore_iam_credentials c JOIN rticore_members m ON m.email=c.email WHERE c.enrolled_at IS NOT NULL AND c.password_hash IS NOT NULL AND length(c.password_hash)>0 AND length(c.totp_cipher)>0 AND c.invite_hash IS NULL AND c.invite_expires IS NULL AND m.active=1 AND m.role='admin'");
 const count=result.rows.length===1?result.rows[0].n:null;
 if(!Number.isSafeInteger(count)||count<2)throw Error('Two independently enrolled administrators required before cutover');
 return true;
}
