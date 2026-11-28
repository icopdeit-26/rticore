import {nativeMigrationManifest} from './native-migration-manifest.mjs';
export const REQUIRED_NATIVE_COMMANDS=[
 'rticore_catalog_boq_binding_valid(text,text,text)',
 'rticore_catalog_boq_binding_command(text,text,text,text,text,jsonb)',
 'rticore_catalog_bind_priced_contract(text,text,text,text,text,text,text)',
 'rticore_fg_historical_allocation_candidates(text,text,text)',
 'rticore_fg_historical_allocation_review(text,text,text,text,text,text,text)',
 'rticore_reserve_ai_request(text,text,text,text)',
 'cams_review_command(text,text,text,text,text,text,bigint,text)'
];
export async function checkNativeCompletion(client){
 const result=await client.query("SELECT x.signature, to_regprocedure('public.'||x.signature) IS NOT NULL AS present FROM unnest($1::text[]) x(signature)",[REQUIRED_NATIVE_COMMANDS]);
 if(result.rows.length!==REQUIRED_NATIVE_COMMANDS.length||REQUIRED_NATIVE_COMMANDS.some(s=>!result.rows.some(r=>r.signature===s&&r.present===true)))throw Error('Native command inventory incomplete');
 const rows=await client.query("SELECT to_regclass('public.rticore_catalog_boq_bindings') IS NOT NULL AS boq, to_regclass('public.rticore_ai_request_budget_idx') IS NOT NULL AS budget_index, EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.rticore_gl_journals') AND tgname='cams_journal_independent_review' AND tgenabled IN ('O','A')) AS journal_guard, EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.rticore_finance_journal_workflows') AND tgname='cams_workflow_independent_review' AND tgenabled IN ('O','A')) AS workflow_guard");
 if(rows.rows.length!==1||['boq','budget_index','journal_guard','workflow_guard'].some(k=>rows.rows[0][k]!==true))throw Error('Native migration object inventory incomplete');
 return {scope:'read_only_object_presence',source_manifest:nativeMigrationManifest(),applied_ledger_verified:false};
}
