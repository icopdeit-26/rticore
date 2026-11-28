import {type BoQIdentity} from '@/lib/boq-auth';
import {TENANT} from '@/lib/sales-workflow';
import {erpAssert,erpReply,erpAtom,erpId,erpText,erpProjectUnit,ERPError} from '@/lib/erp-core';
import {supportingOriginal,ServiceError} from '@/lib/service-operations';
type Kind='cti_case'|'cti_ioc'|'grc_engagement'|'grc_risk'|'grc_control'|'grc_control_test';
type Field={name:string;min?:number;max?:number;choices?:readonly string[];number?:boolean;id?:boolean};
const text=(name:string,min:number,max:number):Field=>({name,min,max});
const num=(name:string,min:number,max:number):Field=>({name,min,max,number:true});
const choice=(name:string,choices:readonly string[]):Field=>({name,choices});
const id=(name:string):Field=>({name,id:true});
const fields:Record<Kind,Field[]>={
 cti_case:[text('code',4,64),text('title',5,200),choice('request_type',['intelligence_request','threat_monitoring','brand_monitoring','incident_support']),choice('tlp',['TLP:CLEAR','TLP:GREEN','TLP:AMBER','TLP:AMBER+STRICT','TLP:RED']),choice('severity',['informational','low','medium','high','critical']),text('summary',12,2000)],
 cti_ioc:[id('case_id'),choice('ioc_type',['domain','ipv4','ipv6','url','sha256','email']),text('indicator_value',3,512),num('confidence',0,100)],
 grc_engagement:[text('code',4,64),text('title',5,200),text('framework',3,120),text('scope_summary',12,2000)],
 grc_risk:[id('engagement_id'),text('code',3,48),text('title',5,200),text('risk_domain',3,120),text('description',12,2000),num('inherent_likelihood',1,5),num('inherent_impact',1,5),num('residual_likelihood',1,5),num('residual_impact',1,5),text('kri_metric',3,250),text('kri_threshold',1,250),text('treatment_plan',12,2000)],
 grc_control:[id('engagement_id'),id('risk_id'),text('code',3,48),text('title',5,200),text('regulatory_ref',3,250),choice('control_type',['preventive','detective','corrective']),text('control_description',12,2000)],
 grc_control_test:[id('control_id'),choice('test_type',['design','operating_effectiveness']),choice('assessment_status',['effective','partially_effective','ineffective']),text('test_notes',12,1000)]
};
const kinds=Object.keys(fields) as Kind[];
export async function nativeGrcScope(a:BoQIdentity,project:string){
 erpAssert(process.env.RTICORE_RUNTIME==='hostinger'&&!a.rolePreview,'Native CTI/GRC required',403);
 const entity=await erpProjectUnit(a.db,project);
 const grant=await a.db.prepare('SELECT rticore_native_cti_grc_actor(?,?,?,?) AS role').bind(TENANT,entity,project,a.email).first<{role:string|null}>();
 erpAssert(grant?.role===a.role,'Akses CTI/GRC ditolak',403);
 const p=await a.db.prepare('SELECT opportunity_id,service_family FROM rticore_delivery_projects WHERE tenant_id=? AND id=?').bind(TENANT,project).first<{opportunity_id:string;service_family:string}>();
 erpAssert(p,'Project tidak ditemukan',404);
 return {entity,opportunity:p.opportunity_id,cti:['CTI','Digital Risk Protection'].includes(p.service_family)};
}
export async function nativeGrcRead(a:BoQIdentity,project:string){
 const {entity,cti}=await nativeGrcScope(a,project);
 const allowed=kinds.filter(k=>k.startsWith('cti_')===cti);
 const registers:Record<string,unknown[]>= {};let truncated=false;
 for(const k of allowed){
  const redFilter=k==='cti_case'?" AND (tlp<>'TLP:RED' OR lower(created_by)=?)":k==='cti_ioc'?" AND EXISTS(SELECT 1 FROM rticore_native_cti_case c WHERE c.tenant_id=rticore_native_cti_ioc.tenant_id AND c.legal_entity_id=rticore_native_cti_ioc.legal_entity_id AND c.project_id=rticore_native_cti_ioc.project_id AND c.id=rticore_native_cti_ioc.case_id AND (c.tlp<>'TLP:RED' OR lower(c.created_by)=?))":'';
  const rows=await a.db.prepare('SELECT * FROM rticore_native_'+k+' WHERE tenant_id=? AND legal_entity_id=? AND project_id=?'+redFilter+' ORDER BY created_at DESC,id LIMIT 201').bind(TENANT,entity,project,...(redFilter?[a.email.toLowerCase()]:[])).all();
  registers[k]=rows.results.slice(0,200);truncated ||= rows.results.length>200;
 }
 return erpReply({success:true,role:a.role,registers,truncated,scope:cti?'cti':'grc'});
}
export async function nativeGrcWrite(a:BoQIdentity,v:Record<string,unknown>){
 erpAssert(erpId(v.project_id)&&erpId(v.document_id),'Project dan bukti asli wajib');
 const k=kinds.find(x=>x===v.record_kind);erpAssert(k,'Register tidak valid');
 const {entity,opportunity,cti}=await nativeGrcScope(a,v.project_id);
 erpAssert(k.startsWith('cti_')===cti,'Register di luar service family',403);
 erpAssert(k==='grc_control_test'?a.role==='approver':['admin','presales','defense_leader','governance_leader','governance_member'].includes(a.role),'Kewenangan maker/checker tidak valid',403);
 const vals:(string|number)[]=[];
 for(const f of fields[k]){
  const value=v[f.name];
  if(f.id){erpAssert(erpId(value),'Referensi '+f.name+' wajib');vals.push(value);}
  else if(f.number){erpAssert(typeof value==='number'&&Number.isSafeInteger(value)&&value>=(f.min??0)&&value<=(f.max??1000000),'Angka '+f.name+' tidak valid');vals.push(value);}
  else if(f.choices){erpAssert(typeof value==='string'&&f.choices.includes(value),'Pilihan '+f.name+' tidak valid');vals.push(value);}
  else {erpAssert(erpText(value,f.min??1,f.max??2000),'Data '+f.name+' tidak valid');vals.push(value.trim());}
 }
 const doc=await supportingOriginal(a.db,v.document_id,opportunity).catch(e=>{if(e instanceof ServiceError)throw new ERPError(e.message,e.status);throw e;});const rid=crypto.randomUUID();
 const columns=['id','tenant_id','legal_entity_id','project_id',...fields[k].map(f=>f.name),'document_id','document_sha256','created_by'];
 const write=a.db.prepare('INSERT INTO rticore_native_'+k+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').bind(rid,TENANT,entity,v.project_id,...vals,v.document_id,doc.sha256.toLowerCase(),a.email);
 await erpAtom(a,'1=1',[],[write],'cyber',rid,'NATIVE_'+k.toUpperCase(),{project_id:v.project_id,document_id:v.document_id});
 return erpReply({success:true,id:rid},201);
}
