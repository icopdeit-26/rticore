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
  const query=new URL(req.url).searchParams,entity=query.get('legal_entity_id');
  erpAssert(query.getAll('legal_entity_id').length<=1,'Parameter legal entity ambigu');
  if(!entity){
   const units=await db.prepare("SELECT id,code,label FROM rticore_erp_org_units u WHERE u.tenant_id=? AND u.kind='legal_entity' AND u.active=1 AND rticore_fg_actor_role(u.tenant_id,u.id,?)=? ORDER BY code LIMIT 201").bind(TENANT,email,role).all();
   erpAssert(units.success,'Register legal entity tidak tersedia',503);
   return erpReply({success:true,entities:units.results.slice(0,200),truncated:units.results.length>200});
  }
  erpAssert(erpId(entity),'Legal entity wajib');
  const scope=await db.prepare('SELECT rticore_fg_actor_role(?,?,?) AS role').bind(TENANT,entity,email).first<{role:string|null}>();
  erpAssert(scope?.role===role,'Akses legal entity ditolak',403);
  const finance=await db.prepare("SELECT rticore_catalog_finance_access(?,?,?,'make') AS can_make,rticore_catalog_finance_access(?,?,?,'approve') AS can_approve").bind(TENANT,entity,email,TENANT,entity,email).first<{can_make:boolean;can_approve:boolean}>();
  const privileged=['finance','approver'].includes(role)&&(finance?.can_make===true||finance?.can_approve===true);
  const services=await db.prepare("SELECT id,service_code,service_name,service_category,description,scope_summary,complexity_level,min_mandays_tenths,standard_mandays_tenths,max_mandays_tenths,effective_date,service_version,lifecycle_status FROM rticore_service_catalog_v2 WHERE tenant_id=? AND legal_entity_id=?"+(privileged?'':" AND lifecycle_status='approved' AND effective_date<=CURRENT_DATE")+" ORDER BY service_code,service_version DESC LIMIT 201").bind(TENANT,entity).all();
  const rates=await db.prepare("SELECT id,role_code,standard_selling_rate_cents,effective_date,version,status"+(privileged?",internal_cost_rate_cents,min_selling_rate_cents,annual_loaded_cost_cents":"")+" FROM rticore_enterprise_rate_cards WHERE tenant_id=? AND legal_entity_id=?"+(privileged?'':" AND status='approved' AND effective_date<=CURRENT_DATE")+" ORDER BY role_code,effective_date DESC,version DESC LIMIT 201").bind(TENANT,entity).all();
  const profiles=await db.prepare("SELECT id,service_id,version,activities,status FROM rticore_catalog_activity_profiles WHERE tenant_id=? AND legal_entity_id=?"+(privileged?'':" AND status='approved'")+" ORDER BY version DESC,id LIMIT 201").bind(TENANT,entity).all();
  const matrices=await db.prepare("SELECT id,matrix_code,label,version,factor_bps,status FROM rticore_catalog_complexity WHERE tenant_id=? AND legal_entity_id=?"+(privileged?'':" AND status='approved'")+" ORDER BY matrix_code,version DESC LIMIT 201").bind(TENANT,entity).all();
  // Pricing evidence is available only to explicitly assigned Finance makers/checkers.
  const snapshots=privileged?await db.prepare("SELECT id,service_id,profile_id,complexity_id,opportunity_id,quantity,pricing_method,billable_mandays_tenths,nonbillable_mandays_tenths,direct_cost_cents,loaded_cost_cents,net_price_cents,calculation_sha256,status FROM rticore_catalog_pricing_snapshots WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 201").bind(TENANT,entity).all():{results:[],success:true};
  const bindings=privileged?await db.prepare("SELECT id,snapshot_id,boq_id,boq_version,boq_edit_seq,price_cents,status FROM rticore_catalog_boq_bindings WHERE tenant_id=? AND legal_entity_id=? ORDER BY created_at DESC LIMIT 201").bind(TENANT,entity).all():{results:[],success:true};
  erpAssert([services,rates,profiles,matrices,snapshots,bindings].every(x=>x.success),'Register service catalog tidak tersedia',503);
  return erpReply({success:true,boq_bindings:bindings.results.slice(0,200),activity_profiles:profiles.results.slice(0,200),complexity_matrices:matrices.results.slice(0,200),pricing_snapshots:snapshots.results.slice(0,200),workflow_truncated:[profiles,matrices,snapshots,bindings].some(x=>x.results.length>200),services:services.results.slice(0,200),rate_cards:rates.results.slice(0,200),truncated:services.results.length>200||rates.results.length>200,cost_basis_visible:privileged,can_make:privileged&&finance?.can_make===true,can_approve:privileged&&finance?.can_approve===true,reference:{categories:ENTERPRISE_SERVICE_CATEGORIES,activity_phases:STANDARD_ACTIVITY_PHASES,resource_roles:ENTERPRISE_RESOURCE_ROLES,complexity_tiers:COMPLEXITY_TIER_BPS}});
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
  if(v.action==='create_boq_binding'||v.action==='approve_boq_binding'){
   if(v.action==='create_boq_binding'){erpAssert(erpId(v.snapshot_id)&&erpId(v.boq_id),'Snapshot dan BoQ wajib');data={snapshot_id:v.snapshot_id,boq_id:v.boq_id};}
   else{erpAssert(erpId(v.id)&&erpText(v.notes,12,1000),'Approval tidak valid');id=v.id;data={notes:v.notes};}
   const r=await a.identity.db.prepare('SELECT rticore_catalog_boq_binding_command(?,?,?,?,?,CAST(? AS jsonb)) AS result').bind(TENANT,v.legal_entity_id,a.identity.email,String(v.action),id,JSON.stringify(data)).first<{result:unknown}>();
   erpAssert(r,'Binding tidak tersedia',503);return erpReply({success:true,result:r.result},v.action==='create_boq_binding'?201:200);
  }
  const workflowActions=['create_activity_profile','approve_activity_profile','create_complexity','approve_complexity','create_pricing_snapshot','approve_pricing_snapshot'];
  if(workflowActions.includes(String(v.action))){
   if(v.action==='create_activity_profile'){
    erpAssert(erpId(v.service_id)&&int(v.version,1,1000000)&&Array.isArray(v.activities)&&v.activities.length>=1&&v.activities.length<=60,'Profil aktivitas tidak valid');
    const activities=v.activities.map((x:unknown)=>{erpAssert(x&&typeof x==='object'&&!Array.isArray(x),'Aktivitas tidak valid');const a=x as Record<string,unknown>;erpAssert(STANDARD_ACTIVITY_PHASES.some(p=>p.code===a.phase_code)&&ENTERPRISE_RESOURCE_ROLES.some(r=>r.code===a.resource_role)&&erpText(a.activity_name,3,160)&&int(a.resource_count,1,50)&&int(a.hours_hundredths,1,100000)&&typeof a.billable==='boolean','Aktivitas tidak valid');return {phase_code:a.phase_code,resource_role:a.resource_role,activity_name:a.activity_name,resource_count:a.resource_count,hours_hundredths:a.hours_hundredths,billable:a.billable};});
    data={service_id:v.service_id,version:v.version,activities};
   }else if(v.action==='create_complexity'){
    erpAssert(erpText(v.matrix_code,3,64)&&erpText(v.label,3,160)&&int(v.version,1,1000000)&&int(v.factor_bps,5000,40000),'Complexity tidak valid');
    data={matrix_code:v.matrix_code,label:v.label,version:v.version,factor_bps:v.factor_bps};
   }else if(v.action==='create_pricing_snapshot'){
    erpAssert([v.service_id,v.profile_id,v.complexity_id,v.opportunity_id].every(erpId)&&int(v.quantity,1,1000)&&['target_margin','cost_plus','mandays_based','emergency_service','fixed_price','time_and_material'].includes(String(v.pricing_method))&&int(v.overhead_bps,0,6000)&&int(v.risk_bps,0,5000)&&int(v.target_bps,0,8500)&&int(v.minimum_margin_bps,0,8500),'Pricing snapshot tidak valid');
    erpAssert(v.pricing_method==='fixed_price'?int(v.fixed_price_cents,1,899999999999999):v.fixed_price_cents===undefined||v.fixed_price_cents===null,'Fixed price input tidak valid');
    data=Object.fromEntries(['service_id','profile_id','complexity_id','opportunity_id','quantity','pricing_method','overhead_bps','risk_bps','target_bps','minimum_margin_bps','fixed_price_cents'].map(k=>[k,v[k]]));
   }else{erpAssert(erpId(v.id)&&erpText(v.notes,12,1000),'Approval tidak valid');id=v.id;data={notes:v.notes};}
   const r=await a.identity.db.prepare('SELECT rticore_catalog_workflow_command(?,?,?,?,?,CAST(? AS jsonb)) AS result').bind(TENANT,v.legal_entity_id,a.identity.email,String(v.action),id,JSON.stringify(data)).first<{result:unknown}>();
   erpAssert(r,'Workflow tidak tersedia',503);return erpReply({success:true,result:r.result},String(v.action).startsWith('create_')?201:200);
  }
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
