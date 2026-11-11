/**
 * Read-only RTICORE platform diagnostics for the IT Developer Team (0051) and Admin.
 * - section=health (Admin, itdev_leader, itdev_member): database ping/latency, migration ledger +
 *   manifest reconciliation, pending transaction guards, active-user count per role (no emails),
 *   AI provider readiness counts (never keys), release-gate status.
 * - section=audit (Admin, itdev_leader): metadata of technical operations events only
 *   (PLATFORM_AUDIT_AREAS: area, entity, action, actor, time). Never event payloads, setting
 *   values, prices or the Sales audit trail. CSV export with format=csv.
 * There is no write path: configuration changes stay in the Admin maker-checker workflow.
 */
import {authorizeBoQ,privateHeaders} from '@/lib/boq-auth';
import {TENANT} from '@/lib/sales-workflow';
import {csvText} from '@/lib/operations';
import {evaluateSchemaReadiness,pendingMasterReleaseGates} from '@/lib/release-readiness';
import {PLATFORM_AUDIT_AREAS} from '@/lib/itdev-team';
export const dynamic='force-dynamic';
const reply=(v:unknown,status=200)=>Response.json(v,{status,headers:privateHeaders});
const fail=(message:string,status=422)=>reply({success:false,message},status);
const HEALTH_ROLES=['admin','itdev_leader','itdev_member'];
const AUDIT_ROLES=['admin','itdev_leader'];
type AuditRow={id:string;area:string;entity_id:string;action:string;actor_email:string;created_at:string};

export async function GET(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;const {db,role,email}=a.identity;
 if(!HEALTH_ROLES.includes(role))return fail('Diagnostik platform hanya untuk Admin dan IT Developer Team',403);
 const u=new URL(req.url),section=u.searchParams.get('section')||'health';
 try{
  if(section==='health'){
   const start=Date.now();const ping=await db.prepare('SELECT 1 AS ok').first<{ok:number}>();
   const latency=Date.now()-start;
   const [migrations,manifest,members,guard,providers]=await Promise.all([
    db.prepare('SELECT version,applied_at FROM rticore_schema_migrations ORDER BY version').all<{version:number|string;applied_at:string}>(),
    db.prepare('SELECT path,source_branch FROM rticore_schema_file_manifest ORDER BY path').all<{path:string}>(),
    db.prepare('SELECT role,count(*) AS active_users FROM rticore_members WHERE active=1 GROUP BY role ORDER BY role').all<{role:string;active_users:number}>(),
    db.prepare('SELECT count(*) AS pending FROM rticore_sales_tx_guards').first<{pending:number}>(),
    db.prepare('SELECT enabled,tested_ok,tested_at,CASE WHEN key_ciphertext IS NULL THEN 0 ELSE 1 END AS has_key FROM rticore_ai_providers').all<{enabled:number;tested_ok:number|null;tested_at:string|null;has_key:number}>()
   ]);
   const enabled=providers.results.filter(p=>p.enabled===1);
   return reply({success:true,role,identityEmail:email,checked_at:new Date().toISOString(),can_read_audit:AUDIT_ROLES.includes(role),
    database:{ok:ping?.ok===1,latency_ms:latency},
    schema:evaluateSchemaReadiness(migrations.results,manifest.results),
    migrations:migrations.results,
    active_users_by_role:members.results.map(r=>({role:r.role,active_users:Number(r.active_users)})),
    transaction_guards_pending:Number(guard?.pending||0),
    ai_readiness:{configured:providers.results.length,enabled:enabled.length,enabled_with_key:enabled.filter(p=>p.has_key===1).length,enabled_tested_successfully:enabled.filter(p=>p.has_key===1&&p.tested_ok===1&&!!p.tested_at).length},
    release:{production_gate:'HOLD',master_gates:pendingMasterReleaseGates(),note:'Diagnostik read-only. Status HOLD dan perubahan konfigurasi hanya melalui workflow Admin maker-checker.'}});
  }
  if(section==='audit'){
   if(!AUDIT_ROLES.includes(role))return fail('Audit trail platform hanya untuk Admin dan IT Developer Leader',403);
   const limit=100,page=Math.max(0,Number(u.searchParams.get('page')||0));if(!Number.isSafeInteger(page)||page>10000)return fail('Halaman tidak valid');
   const areas=PLATFORM_AUDIT_AREAS,marks=areas.map(()=>'?').join(',');
   const rows=await db.prepare(`SELECT id,area,entity_id,action,actor_email,created_at FROM rticore_operations_events WHERE tenant_id=? AND area IN (${marks}) ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`)
    .bind(TENANT,...areas,limit,page*limit).all<AuditRow>();
   if(u.searchParams.get('format')==='csv')return new Response(csvText(['ID','Area','Entity','Action','Actor','At'],rows.results.map(r=>[r.id,r.area,r.entity_id,r.action,r.actor_email,r.created_at])),{headers:{...privateHeaders,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="RTICORE_Platform_Audit.csv"'}});
   return reply({success:true,role,areas,items:rows.results,page,next_page:rows.results.length===limit?page+1:null});
  }
  return fail('Section tidak dikenal (health atau audit)');
 }catch{return fail('Diagnostik platform belum siap. Verifikasi migrasi 0026 dan 0051.',503);}
}
