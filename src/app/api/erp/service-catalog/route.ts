import {authorizeBoQ} from '@/lib/boq-auth';
import {readBoundedJSON} from '@/lib/bounded-json';
import {TENANT} from '@/lib/sales-workflow';
import {erpAssert,erpError,erpId,erpReply,erpText,erpDate,erpOrigin} from '@/lib/erp-core';
import {ENTERPRISE_SERVICE_CATEGORIES,ENTERPRISE_RESOURCE_ROLES,STANDARD_ACTIVITY_PHASES,COMPLEXITY_TIER_BPS} from '@/lib/enterprise-pricing-engine';
export const dynamic='force-dynamic';
export const runtime='nodejs';
const enabled=()=>process.env.RTICORE_RUNTIME==='hostinger'&&process.env.RTICORE_SERVICE_CATALOG_ENABLED==='1';
const roles=['finance','approver','admin','sales','presales','project_manager','legal'];
const int=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
export async function GET(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{
  erpAssert(enabled(),'Service Catalog release gate belum aktif',503);
  const {db,email,role,rolePreview}=a.identity;erpAssert(!rolePreview&&roles.includes(role),'Akses ditolak',403);
  const entity=new URL(req.url).searchParams.get('legal_entity_id');erpAssert(erpId(entity),'Legal entity wajib');
  const scope=await db.prepare('SELECT rticore_fg_actor_role(?,?,?) AS role').bind(TENANT,entity,email).first<{role:string|null}>();
  erpAssert(scope?.role===role,'Akses legal entity ditolak',403);
  const finance=await db.prepare("SELECT rticore_catalog_finance_access(?,?,?,'make') OR rticore_catalog_finance_access(?,?,?,'approve') AS allowed").bind(TENANT,entity,email,TENANT,entity,email).first<{allowed:boolean}>();
  const privileged=finance?.allowed===true;
  const services=await db.prepare("SELECT id,service_code,service_name,service_category,description,scope_summary,complexity_level,min_mandays_tenths,standard_mandays_tenths,max_mandays_tenths,effective_date,service_version,lifecycle_status FROM rticore_service_catalog_v2 WHERE tenant_id=? AND legal_entity_id=?"+(privileged?'':" AND lifecycle_status='approved' AND effective_date<=CURRENT_DATE")+" ORDER BY service_code,service_version DESC LIMIT 201").bind(TENANT,entity).all();
  const rates=await db.prepare("SELECT id,role_code,standard_selling_rate_cents,effective_date,version,status"+(privileged?",internal_cost_rate_cents,min_selling_rate_cents,annual_loaded_cost_cents":"")+" FROM rticore_enterprise_rate_cards WHERE tenant_id=? AND legal_entity_id=?"+(privileged?'':" AND status='approved' AND effective_date<=CURRENT_DATE")+" ORDER BY role_code,effective_date DESC,version DESC LIMIT 201").bind(TENANT,entity).all();
  return erpReply({success:true,services:services.results.slice(0,200),rate_cards:rates.results.slice(0,200),truncated:services.results.length>200||rates.results.length>200,cost_basis_visible:privileged,reference:{categories:ENTERPRISE_SERVICE_CATEGORIES,activity_phases:STANDARD_ACTIVITY_PHASES,resource_roles:ENTERPRISE_RESOURCE_ROLES,complexity_tiers:COMPLEXITY_TIER_BPS}});
 }catch(e){return erpError(e);}
}
export async function POST(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{
  erpAssert(enabled(),'Service Catalog release gate belum aktif',503);erpAssert(!a.identity.rolePreview&&['finance','approver'].includes(a.identity.role),'Akses ditolak',403);
  erpAssert(req.headers.get('origin')===process.env.RTICORE_PUBLIC_ORIGIN,'Origin tidak diizinkan',403);erpOrigin(req);
  const v=await readBoundedJSON(req,12000) as Record<string,unknown>;
  erpAssert(erpId(v.legal_entity_id),'Legal entity wajib');
  let data:Record<string,unknown>;let id:string|null=null;
  if(v.action==='create_service'){
   erpAssert(erpText(v.service_code,3,48)&&erpText(v.service_name,3,160)&&ENTERPRISE_SERVICE_CATEGORIES.some(c=>c.code===v.service_category)&&erpText(v.description,8,1000)&&erpText(v.scope_summary,8,2000)&&Object.prototype.hasOwnProperty.call(COMPLEXITY_TIER_BPS,String(v.complexity_level))&&int(v.min_mandays_tenths,5,100000)&&int(v.standard_mandays_tenths,Number(v.min_mandays_tenths),100000)&&int(v.max_mandays_tenths,Number(v.standard_mandays_tenths),100000)&&erpDate(v.effective_date)&&int(v.service_version,1,1000000),'Service master tidak valid');
   data=Object.fromEntries(['service_code','service_name','service_category','description','scope_summary','complexity_level','min_mandays_tenths','standard_mandays_tenths','max_mandays_tenths','effective_date','service_version'].map(k=>[k,v[k]]));
  }else if(v.action==='create_rate_card'){
   const money=['monthly_compensation_cents','benefit_allocation_cents','employer_contrib_cents','allocated_expense_cents'];
   erpAssert(ENTERPRISE_RESOURCE_ROLES.some(r=>r.code===v.role_code)&&money.every(k=>int(v[k],0,1000000000000))&&money.some(k=>Number(v[k])>0)&&int(v.available_working_days,100,300)&&int(v.target_utilization_bps,3000,9500)&&int(v.target_margin_bps,500,8500)&&int(v.min_margin_bps,0,Number(v.target_margin_bps))&&erpDate(v.effective_date)&&int(v.version,1,1000000),'Rate card tidak valid');
   data=Object.fromEntries([...money,'role_code','available_working_days','target_utilization_bps','target_margin_bps','min_margin_bps','effective_date','version'].map(k=>[k,v[k]]));
  }else if(v.action==='approve_service'||v.action==='approve_rate_card'){
   erpAssert(erpId(v.id)&&erpText(v.notes,12,1000),'Approval tidak valid');id=v.id;data={notes:v.notes};
  }else return erpReply({success:false,message:'Action tidak dikenal'},422);
  const r=await a.identity.db.prepare('SELECT rticore_catalog_command(?,?,?,?,?,CAST(? AS jsonb)) AS result').bind(TENANT,v.legal_entity_id,a.identity.email,String(v.action),id,JSON.stringify(data)).first<{result:unknown}>();
  erpAssert(r,'Catalog command tidak tersedia',503);return erpReply({success:true,result:r.result},String(v.action).startsWith('create_')?201:200);
 }catch(e){if(/CATALOG_(ACCESS_DENIED|APPROVAL_DENIED|SCOPE_INVALID)/.test(String(e)))return erpReply({success:false,message:'Kewenangan katalog ditolak'},403);return erpError(e);}
}
