import {authorizeBoQ,privateHeaders} from '@/lib/boq-auth';
import {TENANT} from '@/lib/sales-workflow';
import {erpId} from '@/lib/erp-core';

export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{...privateHeaders,Vary:'Cookie'}});
type Spec={kind:string;sql:string;href:string};
type Row={id:string;title:string;maker:string};
const operations:Spec[]=[
 {kind:'backup_drill',sql:"SELECT id,environment AS title,requested_by AS maker FROM rticore_native_backup_drill WHERE tenant_id=? AND legal_entity_id=? AND status='pending' AND lower(requested_by)<>? ORDER BY requested_at DESC,id LIMIT 101",href:'/erp/operations-center'},
 {kind:'job_recovery',sql:"SELECT x.id,j.kind AS title,x.requested_by AS maker FROM rticore_native_job_recovery x JOIN rticore_native_jobs j ON j.tenant_id=x.tenant_id AND j.legal_entity_id=x.legal_entity_id AND j.id=x.job_id WHERE x.tenant_id=? AND x.legal_entity_id=? AND x.status='pending' AND lower(x.requested_by)<>? AND j.status='dead_letter' AND j.attempts=j.max_attempts AND x.prior_attempts=j.attempts AND rticore_fg_maintenance_actor(x.tenant_id,x.legal_entity_id,x.requested_by) AND NOT EXISTS(SELECT 1 FROM rticore_native_job_recovery a WHERE a.tenant_id=x.tenant_id AND a.legal_entity_id=x.legal_entity_id AND a.job_id=x.job_id AND a.status='approved') ORDER BY x.id LIMIT 101",href:'/erp/operations-center'}
];
const feature:Spec={kind:'feature_governance',sql:"SELECT id,flag_key AS title,requested_by AS maker FROM rticore_feature_change_requests WHERE tenant_id=? AND legal_entity_id=? AND status='pending' AND lower(requested_by)<>? ORDER BY requested_at DESC,id LIMIT 101",href:'/erp/operations-center'};
const catalog:Spec[]=[
 ['service_catalog','rticore_service_catalog_v2','service_name','lifecycle_status'],
 ['rate_card','rticore_enterprise_rate_cards','role_code','status'],
 ['activity_profile','rticore_catalog_activity_profiles','service_id','status'],
 ['complexity_matrix','rticore_catalog_complexity','label','status'],
 ['pricing_snapshot','rticore_catalog_pricing_snapshots','pricing_method','status'],
 ['boq_binding','rticore_catalog_boq_bindings','boq_id','status']
].map(([kind,table,title,status])=>({kind,sql:"SELECT id,"+title+" AS title,created_by AS maker FROM "+table+" WHERE tenant_id=? AND legal_entity_id=? AND "+status+"='draft' AND lower(created_by)<>? ORDER BY created_at DESC,id LIMIT 101",href:'/erp/service-catalog'}));
// This inbox is read-only and covers only these native review registers. Each canonical
// transaction handler still validates the current status, grants, SoD, version and evidence.
export async function GET(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 const {db,role,email,rolePreview}=a.identity;
 if(rolePreview||!['approver','finance'].includes(role))return reply({success:false,message:'Akses antrean native ditolak.'},403);
 if(process.env.RTICORE_RUNTIME!=='hostinger')return reply({success:false,message:'Native runtime required.'},503);
 const entity=new URL(req.url).searchParams.get('legal_entity_id');
 if(!erpId(entity))return reply({success:false,message:'Legal entity wajib.'},422);
 const me=email.toLowerCase();
 try{
  const grant=await db.prepare('SELECT rticore_fg_actor_role(?,?,?) AS role').bind(TENANT,entity,me).first<{role:string|null}>();
  if(grant?.role!==role)return reply({success:false,message:'Legal entity di luar scope.'},403);
  const groups:Spec[]=[],excluded:string[]=[];
  if(role==='approver'){
   groups.push(...operations);
   // Match feature-governance handler: direct approved affiliation and active role.
   const direct=await db.prepare("SELECT u.id FROM rticore_erp_org_units u JOIN rticore_erp_staff_org s ON s.tenant_id=u.tenant_id AND s.unit_id=u.id JOIN rticore_members m ON lower(m.email)=lower(s.email) WHERE u.tenant_id=? AND u.id=? AND u.kind='legal_entity' AND u.active=1 AND s.status='approved' AND lower(s.email)=? AND m.active=1 AND m.role=?").bind(TENANT,entity,me,role).first();
   if(direct)groups.push(feature);else excluded.push('feature_governance');
  }else excluded.push('backup_drill','job_recovery','feature_governance');
  if(process.env.RTICORE_SERVICE_CATALOG_ENABLED==='1'){
   const access=await db.prepare("SELECT rticore_catalog_finance_access(?,?,?,'approve') AS allowed").bind(TENANT,entity,me).first<{allowed:boolean}>();
   if(access?.allowed===true)groups.push(...catalog);else excluded.push(...catalog.map(x=>x.kind));
  }else excluded.push(...catalog.map(x=>x.kind));
  const results=await Promise.all(groups.map(async g=>{
   const result=await db.prepare(g.sql).bind(TENANT,entity,me).all<Row>();
   if(!result.success)throw Error('Native source unavailable');
   return {g,rows:result.results};
  }));
  const items=results.flatMap(({g,rows})=>rows.slice(0,100).map(x=>({id:x.id,kind:g.kind,title:x.title,href:g.href})));
  return reply({success:true,legal_entity_id:entity,items:items.slice(0,250),truncated:items.length>250||results.some(x=>x.rows.length>100),included_kinds:groups.map(x=>x.kind),excluded_kinds:excluded,read_only:true,automatic_posting:false,activation:false});
 }catch{return reply({success:false,message:'Antrean native tidak tersedia; tidak ada jumlah pending yang diasumsikan.'},503);}
}
