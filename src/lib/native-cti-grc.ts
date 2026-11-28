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
  erpAssert(rows.success,'Register CTI/GRC tidak tersedia',503);
  registers[k]=rows.results.slice(0,200);truncated ||= rows.results.length>200;
 }
 const lifecycle=await a.db.prepare("SELECT l.* FROM rticore_native_cti_grc_lifecycle l WHERE l.tenant_id=? AND l.legal_entity_id=? AND l.project_id=? AND (l.record_kind<>'cti_case' OR EXISTS(SELECT 1 FROM rticore_native_cti_case c WHERE c.tenant_id=l.tenant_id AND c.legal_entity_id=l.legal_entity_id AND c.project_id=l.project_id AND c.id=l.record_id AND (c.tlp<>'TLP:RED' OR lower(c.created_by)=?))) ORDER BY l.record_kind,l.record_id,l.version DESC LIMIT 501").bind(TENANT,entity,project,a.email.toLowerCase()).all();
 erpAssert(lifecycle.success,'Lifecycle CTI/GRC tidak tersedia',503);
 return erpReply({success:true,role:a.role,registers,lifecycle:lifecycle.results.slice(0,500),truncated:truncated||lifecycle.results.length>500,scope:cti?'cti':'grc'});
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
 // Check independent control testing before reading any Vault evidence; the SQL trigger repeats this under lock.
 if(k==='grc_control_test'){
  const parent=await a.db.prepare('SELECT created_by FROM rticore_native_grc_control WHERE tenant_id=? AND legal_entity_id=? AND project_id=? AND id=?').bind(TENANT,entity,v.project_id,String(v.control_id)).first<{created_by:string}>();
  erpAssert(parent&&parent.created_by.toLowerCase()!==a.email.toLowerCase(),'Pengujian kontrol independen diperlukan',403);
 }
 // Reject inaccessible parent CTI cases before reading evidence or attempting mutation.
 if(k==='cti_ioc'){
  const parent=await a.db.prepare("SELECT id FROM rticore_native_cti_case WHERE tenant_id=? AND legal_entity_id=? AND project_id=? AND id=? AND (tlp<>'TLP:RED' OR lower(created_by)=?)").bind(TENANT,entity,v.project_id,String(v.case_id),a.email.toLowerCase()).first();
  erpAssert(parent,'Akses CTI case ditolak',403);
 }
 const doc=await supportingOriginal(a.db,v.document_id,opportunity).catch(e=>{if(e instanceof ServiceError)throw new ERPError(e.message,e.status);throw e;});const rid=crypto.randomUUID();
 const columns=['id','tenant_id','legal_entity_id','project_id',...fields[k].map(f=>f.name),'document_id','document_sha256','created_by'];
 const write=a.db.prepare('INSERT INTO rticore_native_'+k+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').bind(rid,TENANT,entity,v.project_id,...vals,v.document_id,doc.sha256.toLowerCase(),a.email);
 await erpAtom(a,'1=1',[],[write],'cyber',rid,'NATIVE_'+k.toUpperCase(),{project_id:v.project_id,document_id:v.document_id});
 return erpReply({success:true,id:rid},201);
}

export async function nativeGrcTransition(a:BoQIdentity,v:Record<string,unknown>){
 erpAssert(erpId(v.project_id)&&erpId(v.record_id)&&erpId(v.document_id)&&erpText(v.notes,12,1000),'Project, register, bukti dan catatan wajib');
 erpAssert(typeof v.record_kind==='string'&&['cti_case','grc_engagement','grc_risk'].includes(v.record_kind)&&typeof v.status==='string'&&['in_progress','submitted','reviewed','returned','closed'].includes(v.status)&&typeof v.expected_version==='number'&&Number.isSafeInteger(v.expected_version)&&v.expected_version>=0&&v.expected_version<2147483647,'Lifecycle data invalid');
 const {entity,opportunity,cti}=await nativeGrcScope(a,v.project_id);
 erpAssert((v.record_kind==='cti_case')===cti,'Scope invalid',403);
 erpAssert(['reviewed','returned','closed'].includes(v.status)?a.role==='approver':['admin','presales','defense_leader','governance_leader','governance_member'].includes(a.role),'Maker-checker wajib',403);
 // The record kind is allowlisted above. Deny foreign/missing records and TLP:RED before Vault access.
 const table=v.record_kind==='cti_case'?'rticore_native_cti_case':v.record_kind==='grc_engagement'?'rticore_native_grc_engagement':'rticore_native_grc_risk';
 const restricted=v.record_kind==='cti_case';
 const parent=await a.db.prepare('SELECT created_by FROM '+table+' WHERE tenant_id=? AND legal_entity_id=? AND project_id=? AND id=?'+(restricted?" AND (tlp<>'TLP:RED' OR lower(created_by)=?)":'')).bind(TENANT,entity,v.project_id,v.record_id,...(restricted?[a.email.toLowerCase()]:[])).first<{created_by:string}>();
 erpAssert(parent,'Akses register lifecycle ditolak',403);
 const reviewing=['reviewed','returned','closed'].includes(v.status);
 erpAssert(!reviewing||parent.created_by.toLowerCase()!==a.email.toLowerCase(),'Maker tidak boleh melakukan review sendiri',403);
 const prior=await a.db.prepare('SELECT status,version,actor_email FROM rticore_native_cti_grc_lifecycle WHERE tenant_id=? AND legal_entity_id=? AND project_id=? AND record_kind=? AND record_id=? ORDER BY version DESC LIMIT 1').bind(TENANT,entity,v.project_id,v.record_kind,v.record_id).first<{status:string;version:number;actor_email:string}>();
 const previous=prior?.status??'open';
 erpAssert(Number(prior?.version??0)===v.expected_version,'Versi lifecycle berubah; muat ulang register',409);
 erpAssert(((previous==='open'||previous==='returned')&&v.status==='in_progress')||(previous==='in_progress'&&v.status==='submitted')||(previous==='submitted'&&['reviewed','returned'].includes(v.status))||(previous==='reviewed'&&v.status==='closed'),'Transisi lifecycle tidak valid',409);
 erpAssert(!reviewing||previous!=='submitted'||prior?.actor_email.toLowerCase()!==a.email.toLowerCase(),'Reviewer harus berbeda dari submitter',403);
 // SQL trigger remains authoritative for concurrent scope, evidence, version and transition checks.
 const doc=await supportingOriginal(a.db,v.document_id,opportunity).catch(e=>{if(e instanceof ServiceError)throw new ERPError(e.message,e.status);throw e;});
 const id=crypto.randomUUID();
 const write=a.db.prepare('INSERT INTO rticore_native_cti_grc_lifecycle(id,tenant_id,legal_entity_id,project_id,record_kind,record_id,version,status,actor_email,notes,document_id,document_sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,TENANT,entity,v.project_id,v.record_kind,v.record_id,v.expected_version+1,v.status,a.email,v.notes.trim(),v.document_id,doc.sha256.toLowerCase());
 await erpAtom(a,'1=1',[],[write],'cyber',v.record_id,'CTI_GRC_LIFECYCLE_TRANSITION',{status:v.status,version:v.expected_version+1,document_id:v.document_id});
 return erpReply({success:true,status:v.status,version:v.expected_version+1},201);
}
