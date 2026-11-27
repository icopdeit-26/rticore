import {authorizeBoQ} from '@/lib/boq-auth';
import {readBoundedJSON} from '@/lib/bounded-json';
import {TENANT} from '@/lib/sales-workflow';
import {erpAssert,erpError,erpId,erpOrigin,erpReply,erpText,erpDate,erpPositiveCents} from '@/lib/erp-core';
import {calculateEnterpriseServicePricing} from '@/lib/enterprise-pricing-engine';
export const dynamic='force-dynamic';
export const runtime='nodejs';
const tiers=['standard_analyst','senior_specialist','lead_specialist','principal_consultant','emergency_response','specialized_forensic','custom'];
const models=['prepaid_mandays','postpaid_mandays','annual_credits','monthly_allocation','quarterly_allocation','retainer','committed_capacity','hybrid_subscription'];
const integer=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const enabled=()=>process.env.RTICORE_RUNTIME==='hostinger'&&process.env.RTICORE_FLEXGUARD_PRODUCT_ENABLED==='1';
export async function GET(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{
  erpAssert(enabled(),'Product release gate belum aktif',503);
  erpAssert(!a.identity.rolePreview,'Role preview ditolak',403);
  const {db,email,role}=a.identity;const entity=new URL(req.url).searchParams.get('legal_entity_id');
  erpAssert(erpId(entity),'Legal entity wajib');erpAssert(['finance','approver','admin'].includes(role),'Akses produk ditolak',403);
  const scope=await db.prepare('SELECT rticore_fg_actor_role(?,?,?) AS role').bind(TENANT,entity,email).first<{role:string|null}>();
  erpAssert(scope?.role===role,'Akses legal entity ditolak',403);
  const rows=await db.prepare('SELECT t.*,coalesce((SELECT jsonb_agg(jsonb_build_object(\'service_tier\',c.service_tier,\'multiplier_bps\',c.multiplier_bps) ORDER BY c.service_tier) FROM rticore_fg_product_conversions c WHERE c.tenant_id=t.tenant_id AND c.legal_entity_id=t.legal_entity_id AND c.terms_id=t.id),\'[]\'::jsonb) AS conversions FROM rticore_fg_product_terms t WHERE t.tenant_id=? AND t.legal_entity_id=? ORDER BY t.package_code,t.version DESC LIMIT 201').bind(TENANT,entity).all();
  return erpReply({success:true,products:rows.results.slice(0,200),truncated:rows.results.length>200});
 }catch(e){return erpError(e);}
}
export async function POST(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{
  erpAssert(enabled(),'Product release gate belum aktif',503);erpAssert(!a.identity.rolePreview,'Role preview ditolak',403);
  erpAssert(req.headers.get('origin')===process.env.RTICORE_PUBLIC_ORIGIN,'Origin tidak diizinkan',403);erpOrigin(req);
  const v=await readBoundedJSON(req,12000) as Record<string,unknown>;
  const {db,email,role}=a.identity;erpAssert(erpId(v.legal_entity_id),'Legal entity wajib');
  const scope=await db.prepare('SELECT rticore_fg_actor_role(?,?,?) AS role').bind(TENANT,v.legal_entity_id,email).first<{role:string|null}>();
  erpAssert(scope?.role===role&&['finance','approver'].includes(role),'Akses legal entity ditolak',403);
  if(v.action==='preview_contract_credits'){
   erpAssert(erpId(v.contract_id)&&erpId(v.terms_id)&&tiers.includes(String(v.service_tier))&&integer(v.estimated_mandays_tenths,1,1000000),'Data estimasi tidak valid');
   const p=await db.prepare("SELECT t.unit_credit_price_cents,t.credits_included,c.multiplier_bps FROM rticore_fg_product_terms t JOIN rticore_fg_product_conversions c ON c.tenant_id=t.tenant_id AND c.legal_entity_id=t.legal_entity_id AND c.terms_id=t.id JOIN rticore_service_contracts x ON x.tenant_id=t.tenant_id JOIN rticore_erp_project_scopes s ON s.tenant_id=x.tenant_id AND s.project_id=x.project_id AND s.legal_entity_id=t.legal_entity_id AND s.status='approved' WHERE t.tenant_id=? AND t.legal_entity_id=? AND t.id=? AND c.service_tier=? AND x.id=? AND x.model='FlexGuard' AND x.status='active' AND t.status='approved' AND t.effective_from<=CURRENT_DATE AND x.start_date<=CURRENT_DATE::text AND x.end_date>=CURRENT_DATE::text").bind(TENANT,v.legal_entity_id,v.terms_id,String(v.service_tier),v.contract_id).first<{unit_credit_price_cents:number;credits_included:number;multiplier_bps:number}>();
   erpAssert(p,'Kontrak atau product terms tidak disetujui',409);
   const credits=Number((BigInt(Number(v.estimated_mandays_tenths))*BigInt(p.multiplier_bps)+99999n)/100000n);
   const value=BigInt(credits)*BigInt(p.unit_credit_price_cents);
   erpAssert(credits<=Number(p.credits_included)&&value<900000000000000n,'Estimasi melebihi batas produk',422);
   return erpReply({success:true,preview_only:true,credits,estimated_value_cents:Number(value),contract_id:v.contract_id,terms_id:v.terms_id,psa_verified:false,finance_posted:false});
  }
  if(v.action==='preview_psa_credits'){
   erpAssert(erpId(v.contract_id)&&erpId(v.terms_id)&&tiers.includes(String(v.service_tier))&&Array.isArray(v.timesheet_ids)&&v.timesheet_ids.length>=1&&v.timesheet_ids.length<=100,'Kontrak, tier dan timesheet wajib');
   const ids=v.timesheet_ids as unknown[];erpAssert(ids.every(erpId)&&new Set(ids).size===ids.length,'Timesheet ID tidak valid atau duplikat');
   const rows=await db.prepare(`SELECT ts.id,ts.minutes,ts.cost_snapshot_cents,t.unit_credit_price_cents,t.credits_included,c.multiplier_bps,
    EXISTS(SELECT 1 FROM rticore_finance_integration_events e WHERE e.tenant_id=ts.tenant_id AND e.legal_entity_id=t.legal_entity_id AND e.event_type='timesheet.approved' AND e.direction='outbox' AND e.source_document_id=ts.id) AS finance_source_exists
    FROM rticore_fg_product_terms t JOIN rticore_fg_product_conversions c ON c.tenant_id=t.tenant_id AND c.legal_entity_id=t.legal_entity_id AND c.terms_id=t.id
    JOIN rticore_service_contracts x ON x.tenant_id=t.tenant_id JOIN rticore_erp_project_scopes s ON s.tenant_id=x.tenant_id AND s.project_id=x.project_id AND s.legal_entity_id=t.legal_entity_id AND s.status='approved'
    JOIN rticore_project_timesheets ts ON ts.tenant_id=x.tenant_id AND ts.project_id=x.project_id AND ts.status='approved' AND ts.billable=1 AND ts.work_date BETWEEN x.start_date AND x.end_date
    WHERE t.tenant_id=? AND t.legal_entity_id=? AND t.id=? AND c.service_tier=? AND x.id=? AND x.model='FlexGuard' AND x.status='active' AND t.status='approved' AND t.effective_from<=CURRENT_DATE AND ts.id IN (${ids.map(()=>'?').join(',')})`).bind(TENANT,v.legal_entity_id,v.terms_id,String(v.service_tier),v.contract_id,...ids.map(String)).all<{id:string;minutes:number;cost_snapshot_cents:number;unit_credit_price_cents:number;credits_included:number;multiplier_bps:number;finance_source_exists:boolean}>();
   erpAssert(rows.results.length===ids.length&&new Set(rows.results.map(r=>r.id)).size===ids.length,'Timesheet tidak lengkap, lintas scope atau belum disetujui',409);
   const first=rows.results[0];const minutes=rows.results.reduce((sum,r)=>sum+BigInt(r.minutes),0n);
   const credits=(minutes*BigInt(first.multiplier_bps)+4799999n)/4800000n;
   const value=credits*BigInt(first.unit_credit_price_cents);
   const cost=rows.results.reduce((sum,r)=>sum+BigInt(r.cost_snapshot_cents),0n);
   erpAssert(credits>0n&&credits<=BigInt(first.credits_included)&&value<900000000000000n&&cost<900000000000000n,'Nilai estimasi melebihi batas',422);
   return erpReply({success:true,preview_only:true,approved_billable_minutes:Number(minutes),credits:Number(credits),estimated_value_cents:Number(value),approved_cost_cents:Number(cost),timesheet_count:ids.length,finance_source_count:rows.results.filter(r=>r.finance_source_exists===true).length,contract_terms_binding_verified:false,finance_posted:false});
  }
  if(v.action==='preview_target_margin'){
   erpAssert(role==='finance','Finance maker wajib',403);
   erpAssert(erpPositiveCents(v.direct_labor_cost_cents)&&integer(v.target_margin_bps,0,9000),'Parameter pricing tidak valid');
   const result=calculateEnterpriseServicePricing({pricingMethod:'target_margin',directLaborCostCents:v.direct_labor_cost_cents,targetMarginBps:Number(v.target_margin_bps),taxRateBps:0});
   return erpReply({success:true,preview_only:true,pricing:result});
  }
  let data:Record<string,unknown>;let id:string|null=null;
  if(v.action==='create'){
   erpAssert(role==='finance','Finance maker wajib',403);
   erpAssert(erpText(v.package_code,3,48)&&erpText(v.package_name,3,160)&&models.includes(String(v.billing_model))&&integer(v.version,1,1000000)&&integer(v.credits_included,1,100000)&&erpPositiveCents(v.unit_credit_price_cents)&&integer(v.validity_days,30,1825)&&erpDate(v.effective_from),'Product terms tidak valid');
   erpAssert(Array.isArray(v.conversions)&&v.conversions.length>=1&&v.conversions.length<=7,'Conversion matrix wajib');
   const conversions=v.conversions.map((x:unknown)=>{erpAssert(x&&typeof x==='object'&&!Array.isArray(x),'Conversion tidak valid');const c=x as Record<string,unknown>;erpAssert(tiers.includes(String(c.service_tier))&&integer(c.multiplier_bps,5000,50000),'Conversion tidak valid');return {service_tier:c.service_tier,multiplier_bps:c.multiplier_bps};});
   erpAssert(new Set(conversions.map(c=>c.service_tier)).size===conversions.length,'Duplikasi service tier');
   erpAssert(BigInt(Number(v.credits_included))*BigInt(v.unit_credit_price_cents)<900000000000000n,'Nominal melebihi batas');
   data={package_code:v.package_code,package_name:v.package_name,version:v.version,billing_model:v.billing_model,credits_included:v.credits_included,unit_credit_price_cents:v.unit_credit_price_cents,validity_days:v.validity_days,effective_from:v.effective_from,conversions};
  }else if(v.action==='approve'){
   erpAssert(erpId(v.terms_id)&&erpText(v.notes,12,1000),'Approval tidak valid');id=v.terms_id;data={notes:v.notes};
  }else return erpReply({success:false,message:'Action tidak dikenal'},422);
  const r=await db.prepare('SELECT rticore_fg_product_command(?,?,?,?,?,CAST(? AS jsonb)) AS result').bind(TENANT,v.legal_entity_id,email,v.action,id,JSON.stringify(data)).first<{result:unknown}>();
  erpAssert(r,'Product command tidak tersedia',503);return erpReply({success:true,result:r.result},v.action==='create'?201:200);
 }catch(e){if(/FLEXGUARD_(ACCESS_DENIED|APPROVAL_DENIED|SELF_APPROVAL|SCOPE_INVALID)/.test(String(e)))return erpReply({success:false,message:'Kewenangan produk ditolak'},403);return erpError(e);}
}
