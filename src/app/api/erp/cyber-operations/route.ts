import {nativeGrcRead,nativeGrcWrite,nativeGrcTransition} from '@/lib/native-cti-grc';
import {authorizeBoQ} from '@/lib/boq-auth';
import {readBoundedJSON} from '@/lib/bounded-json';
import {supportingOriginal as vaultOriginal,ServiceError} from '@/lib/service-operations';
import {TENANT} from '@/lib/sales-workflow';
import {erpReply,erpError,ERPError,erpAssert,erpId,erpText,erpOrigin,erpGrant,erpAtom,erpProjectUnit,erpPeriod,erpDate} from '@/lib/erp-core';
import {isDefenseRole,DEFENSE_CASE_KINDS,defenseProjects,hasCyberGrant} from '@/lib/defense-team';
export const dynamic='force-dynamic';
// Vault validation errors (wrong/foreign/expired document) surface as 4xx, not as a generic ERP 503.
async function supportingOriginal(...args:Parameters<typeof vaultOriginal>){try{return await vaultOriginal(...args);}catch(e){if(e instanceof ServiceError)throw new ERPError(e.message,e.status);throw e;}}
type Case={id:string;project_id:string;kind:string;status:string;version:number;created_by:string;reviewer_email:string|null;evidence_document_id:string|null;opportunity_id:string};
type Assignment={case_id:string;assignee_email:string;assigned_by:string;status:string;version:number;evidence_document_id:string|null};
// Case makers: SOC Defense Member/Leader open SOC/DFIR cases; Presales/Admin keep every kind.
const OPENERS=['presales','admin','defense_leader','defense_member'];
// Independent QA review: Approver, or the SOC Defense Leader (never the maker or the assignee).
const REVIEWERS=['approver','defense_leader'];
// Closing a reviewed case: Presales/Admin or SOC Defense Leader (never the reviewer).
const CLOSERS=['presales','admin','defense_leader'];
// Triage: who assigns, reassigns and returns SOC/DFIR investigations.
const TRIAGE=['defense_leader','admin'];
const CASE_COLS='c.id,c.project_id,c.kind,c.external_ref,c.title,c.severity,c.classification,c.status,c.version,c.created_by,c.reviewer_email,c.evidence_document_id,c.created_at,c.reviewed_at,c.closed_at,x.assignee_email,x.status AS assignment_status,x.version AS assignment_version,x.investigation_notes,x.evidence_document_id AS assignment_evidence_id,x.leader_notes,x.assigned_by,x.submitted_at';
const CASE_FROM='FROM rticore_cyber_cases c LEFT JOIN rticore_cyber_case_assignments x ON x.case_id=c.id AND x.tenant_id=c.tenant_id';

/** SOC Defense board: projects in grant scope, my investigation queue and (Leader) the team triage queue. */
async function board(a:Parameters<typeof defenseProjects>[0]&{role:string}){
 const projects=await defenseProjects(a);
 const ids=projects.map(p=>p.id);
 if(!ids.length)return {success:true,role:a.role,projects:[],my_queue:[],team_queue:[],analysts:[]};
 const marks=ids.map(()=>'?').join(',');
 const mine=await a.db.prepare(`SELECT ${CASE_COLS} ${CASE_FROM} WHERE c.tenant_id=? AND c.project_id IN (${marks}) AND c.status='open' AND lower(x.assignee_email)=? ORDER BY c.created_at DESC LIMIT 250`).bind(TENANT,...ids,a.email.toLowerCase()).all();
 const team=a.role==='defense_leader'||a.role==='admin'
  ?await a.db.prepare(`SELECT ${CASE_COLS} ${CASE_FROM} WHERE c.tenant_id=? AND c.project_id IN (${marks}) AND (c.status IN ('open','reviewed')) ORDER BY CASE c.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,c.created_at LIMIT 250`).bind(TENANT,...ids).all()
  :{results:[],success:true};
 const analysts=a.role==='defense_leader'||a.role==='admin'
  ?await a.db.prepare("SELECT email,role FROM rticore_members WHERE active=1 AND role IN ('defense_leader','defense_member') ORDER BY CASE role WHEN 'defense_member' THEN 0 ELSE 1 END,email LIMIT 200").all()
  :{results:[],success:true};
 erpAssert(mine.success&&team.success&&analysts.success,'Board SOC tidak tersedia',503);
 return {success:true,role:a.role,projects,my_queue:mine.results,team_queue:team.results,analysts:analysts.results};
}
async function loadCase(db:Parameters<typeof supportingOriginal>[0],id:string){
 const c=await db.prepare('SELECT c.*,p.opportunity_id FROM rticore_cyber_cases c JOIN rticore_delivery_projects p ON p.id=c.project_id AND p.tenant_id=c.tenant_id WHERE c.tenant_id=? AND c.id=?').bind(TENANT,id).first<Case>();
 erpAssert(c,'Case tidak ditemukan',404);
 const x=await db.prepare('SELECT * FROM rticore_cyber_case_assignments WHERE tenant_id=? AND case_id=?').bind(TENANT,id).first<Assignment>();
 return {c,x};
}
export async function GET(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{
  const u=new URL(req.url);
  const technical=u.pathname==='/api/erp/technical-registers';
  const selectors=['grc_project_id','finding_project_id','vapt_project_id','sla_project_id','custody_case_id','board','project_id'];
  erpAssert(selectors.reduce((n,k)=>n+u.searchParams.getAll(k).length,0)===1,'Satu scope Cyber Operations wajib');
  erpAssert([...u.searchParams.keys()].every(k=>selectors.includes(k)),'Parameter Cyber Operations tidak dikenal');
  erpAssert(!u.searchParams.has('board')||u.searchParams.get('board')==='1','Board selector tidak valid');
  if(technical){const role=a.identity.role;const keys=[...u.searchParams.keys()];erpAssert(keys.length===1&&((['offense_lead','offense_member'].includes(role)&&['vapt_project_id','finding_project_id'].includes(keys[0]))||(['governance_leader','governance_member'].includes(role)&&keys[0]==='grc_project_id')),'Technical scope denied',403);}
  else erpAssert(!['offense_lead','offense_member','governance_leader','governance_member'].includes(a.identity.role),'Technical endpoint required',403);
  const grcProject=u.searchParams.get('grc_project_id');
  if(grcProject!==null){erpAssert(erpId(grcProject),'Project ID wajib');return await nativeGrcRead(a.identity,grcProject);}
  const findingProject=u.searchParams.get('finding_project_id');
  if(findingProject!==null){
   erpAssert(process.env.RTICORE_RUNTIME==='hostinger'&&!a.identity.rolePreview,'Native VAPT required',403);
   erpAssert(erpId(findingProject),'Project ID wajib');
   const entity=await erpProjectUnit(a.identity.db,findingProject);
   const grant=await a.identity.db.prepare('SELECT rticore_native_vapt_actor(?,?,?,?) AS role').bind(TENANT,entity,findingProject,a.identity.email).first<{role:string|null}>();
   erpAssert(grant?.role===a.identity.role,'Akses VAPT ditolak',403);
   const rows=await a.identity.db.prepare('SELECT * FROM rticore_native_vapt_finding WHERE tenant_id=? AND legal_entity_id=? AND project_id=? ORDER BY created_at DESC,id LIMIT 201').bind(TENANT,entity,findingProject).all();
   const engagements=await a.identity.db.prepare("SELECT id,engagement_code,title FROM rticore_native_vapt_engagement WHERE tenant_id=? AND legal_entity_id=? AND project_id=? AND status='roe_approved' ORDER BY created_at DESC LIMIT 200").bind(TENANT,entity,findingProject).all();
   const events=await a.identity.db.prepare('SELECT finding_id,version,status,actor_email,notes,document_id,document_sha256,recorded_at FROM rticore_native_vapt_finding_event WHERE tenant_id=? AND legal_entity_id=? AND project_id=? ORDER BY recorded_at DESC LIMIT 501').bind(TENANT,entity,findingProject).all();
   erpAssert(rows.success&&engagements.success&&events.success,'Register VAPT finding tidak tersedia',503);
   return erpReply({success:true,role:a.identity.role,entries:rows.results.slice(0,200),engagements:engagements.results,events:events.results.slice(0,500),truncated:rows.results.length>200||events.results.length>500});
  }
  const vaptProject=u.searchParams.get('vapt_project_id');
  if(vaptProject!==null){
   erpAssert(process.env.RTICORE_RUNTIME==='hostinger'&&!a.identity.rolePreview,'Native VAPT required',403);
   erpAssert(erpId(vaptProject),'Project ID wajib');
   const entity=await erpProjectUnit(a.identity.db,vaptProject);
   const grant=await a.identity.db.prepare('SELECT rticore_native_vapt_actor(?,?,?,?) AS role').bind(TENANT,entity,vaptProject,a.identity.email).first<{role:string|null}>();
   erpAssert(grant?.role===a.identity.role,'Akses VAPT ditolak',403);
   const rows=await a.identity.db.prepare('SELECT * FROM rticore_native_vapt_engagement WHERE tenant_id=? AND legal_entity_id=? AND project_id=? ORDER BY created_at DESC,id LIMIT 201').bind(TENANT,entity,vaptProject).all();
   erpAssert(rows.success,'Register cyber tidak tersedia',503);
   return erpReply({success:true,role:a.identity.role,entries:rows.results.slice(0,200),truncated:rows.results.length>200});
  }
  const slaProject=u.searchParams.get('sla_project_id');
  if(slaProject!==null){
   erpAssert(process.env.RTICORE_RUNTIME==='hostinger'&&!a.identity.rolePreview,'Native SLA required',403);
   erpAssert(erpId(slaProject),'Project ID wajib');
   const entity=await erpProjectUnit(a.identity.db,slaProject);
   const grant=await a.identity.db.prepare('SELECT rticore_native_soc_actor(?,?,?,?) AS role').bind(TENANT,entity,slaProject,a.identity.email).first<{role:string|null}>();
   erpAssert(grant?.role===a.identity.role,'Akses SOC SLA ditolak',403);
   const rows=await a.identity.db.prepare('SELECT *,round(within_sla::numeric*10000/observations)::integer AS sla_compliance_bps FROM rticore_native_soc_sla WHERE tenant_id=? AND legal_entity_id=? AND project_id=? ORDER BY period_code DESC,created_at DESC LIMIT 201').bind(TENANT,entity,slaProject).all();
   erpAssert(rows.success,'Register cyber tidak tersedia',503);
   return erpReply({success:true,role:a.identity.role,entries:rows.results.slice(0,200),truncated:rows.results.length>200,financial_posting:false});
  }
  const custodyCase=u.searchParams.get('custody_case_id');
  if(custodyCase!==null){
   erpAssert(process.env.RTICORE_RUNTIME==='hostinger'&&!a.identity.rolePreview,'Native custody required',403);
   erpAssert(erpId(custodyCase),'Case ID wajib');
   const {c}=await loadCase(a.identity.db,custodyCase);
   const entity=await erpProjectUnit(a.identity.db,c.project_id);
   const permitted=await a.identity.db.prepare('SELECT rticore_native_dfir_actor(?,?,?,?) AS allowed').bind(TENANT,entity,c.id,a.identity.email).first<{allowed:boolean}>();
   erpAssert(permitted?.allowed===true,'Akses custody ditolak',403);
   const rows=await a.identity.db.prepare('SELECT evidence_tag,seq,document_id,sha256,action,actor_email,custodian_email,notes,recorded_at FROM rticore_native_dfir_custody WHERE tenant_id=? AND legal_entity_id=? AND case_id=? ORDER BY evidence_tag,seq LIMIT 501').bind(TENANT,entity,c.id).all();
   erpAssert(rows.success,'Register custody tidak tersedia',503);
   return erpReply({success:true,entries:rows.results.slice(0,500),truncated:rows.results.length>500});
  }
  if(u.searchParams.get('board')==='1'){
   erpAssert(isDefenseRole(a.identity.role)||a.identity.role==='admin','Board SOC Defense hanya untuk Defense Team atau Admin',403);
   return erpReply(await board(a.identity));
  }
  const id=u.searchParams.get('project_id');erpAssert(erpId(id),'Project ID wajib');
  const unit=await erpProjectUnit(a.identity.db,id);await erpGrant(a.identity,'cyber_ops',unit);
  const rows=await a.identity.db.prepare(`SELECT ${CASE_COLS} ${CASE_FROM} WHERE c.tenant_id=? AND c.project_id=? ORDER BY c.created_at DESC LIMIT 250`).bind(TENANT,id).all();
  erpAssert(rows.success,'Register case tidak tersedia',503);
  return erpReply({success:true,cases:rows.results,warning:'Metadata workflow only; not a SIEM/EDR/scanner'});
 }catch(e){return erpError(e);}
}
export async function POST(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;const {db,role,email}=a.identity;
 try{
  erpAssert(!a.identity.rolePreview,'Role preview tidak diizinkan mengubah Cyber Operations',403);erpOrigin(req);const v=await readBoundedJSON(req,7000) as Record<string,unknown>;
  const technical=new URL(req.url).pathname==='/api/erp/technical-registers';
  if(technical){
   erpAssert((['offense_lead','offense_member'].includes(role)&&(v.action==='register_vapt_finding'||(v.action==='transition_vapt_finding'&&v.next_status==='retest_submitted')||(role==='offense_lead'&&v.action==='register_vapt_engagement')))||(['governance_leader','governance_member'].includes(role)&&((v.action==='native_cti_grc_register'&&typeof v.record_kind==='string'&&['grc_engagement','grc_risk','grc_control'].includes(v.record_kind))||(v.action==='native_cti_grc_transition'&&['grc_engagement','grc_risk'].includes(String(v.record_kind))&&['in_progress','submitted'].includes(String(v.status))))),'Technical mutation denied',403);
  }else erpAssert(!['offense_lead','offense_member','governance_leader','governance_member'].includes(role),'Technical endpoint required',403);
  if(v.action==='native_cti_grc_transition')return await nativeGrcTransition(a.identity,v);
  if(v.action==='native_cti_grc_register')return await nativeGrcWrite(a.identity,v);
  if(v.action==='register_vapt_finding'||v.action==='transition_vapt_finding'){
   erpAssert(process.env.RTICORE_RUNTIME==='hostinger','Native VAPT required',503);
   erpAssert(erpId(v.project_id)&&erpText(v.notes,12,800),'Project dan catatan wajib');
   const project=v.project_id;const entity=await erpProjectUnit(db,project);
   const grant=await db.prepare('SELECT rticore_native_vapt_actor(?,?,?,?) AS role').bind(TENANT,entity,project,email).first<{role:string|null}>();
   erpAssert(grant?.role===role,'Akses VAPT ditolak',403);
   const p=await db.prepare('SELECT opportunity_id FROM rticore_delivery_projects WHERE tenant_id=? AND id=?').bind(TENANT,project).first<{opportunity_id:string}>();
   erpAssert(p,'Project tidak ditemukan',404);
   if(v.action==='register_vapt_finding'){
    erpAssert(['admin','presales','offense_lead','offense_member'].includes(role),'Maker VAPT wajib',403);
    erpAssert(erpId(v.engagement_id)&&erpId(v.document_id)&&erpText(v.finding_code,3,64)&&erpText(v.title,5,200)&&erpText(v.affected_asset,3,250)&&erpText(v.remediation,12,2000)&&typeof v.cvss_tenths==='number'&&Number.isSafeInteger(v.cvss_tenths)&&v.cvss_tenths>=0&&v.cvss_tenths<=100,'Data finding tidak valid');
    const doc=await supportingOriginal(db,v.document_id,p.opportunity_id);const id=crypto.randomUUID();
    await erpAtom(a.identity,'1=1',[],[db.prepare('INSERT INTO rticore_native_vapt_finding(id,tenant_id,legal_entity_id,project_id,engagement_id,finding_code,title,cvss_tenths,affected_asset,remediation,evidence_document_id,evidence_sha256,created_by,last_actor,last_notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,TENANT,entity,project,v.engagement_id,v.finding_code.trim(),v.title.trim(),v.cvss_tenths,v.affected_asset.trim(),v.remediation.trim(),v.document_id,doc.sha256.toLowerCase(),email,email,v.notes.trim())],'cyber',id,'VAPT_FINDING_REGISTER',{engagement_id:v.engagement_id,document_id:v.document_id});
    return erpReply({success:true,id,status:'open'},201);
   }
   erpAssert(erpId(v.id)&&typeof v.version==='number'&&Number.isSafeInteger(v.version)&&v.version>=1&&typeof v.next_status==='string'&&['qa_approved','qa_rejected','retest_requested','retest_submitted','verified_fixed','still_vulnerable'].includes(v.next_status),'Status atau versi tidak valid');
   const next=v.next_status;
   erpAssert(next==='retest_submitted'?['admin','presales','offense_lead','offense_member'].includes(role):role==='approver','Maker-checker wajib',403);
   const row=await db.prepare('SELECT evidence_document_id,retest_document_id FROM rticore_native_vapt_finding WHERE tenant_id=? AND legal_entity_id=? AND project_id=? AND id=? AND version=?').bind(TENANT,entity,project,v.id,v.version).first<{evidence_document_id:string;retest_document_id:string|null}>();
   erpAssert(row,'Finding tidak ditemukan atau versi berubah',409);
   let write;
   if(next==='retest_submitted'){
    erpAssert(erpId(v.document_id),'Bukti retest asli wajib');const doc=await supportingOriginal(db,v.document_id,p.opportunity_id);
    write=db.prepare('UPDATE rticore_native_vapt_finding SET status=?,version=version+1,last_actor=?,last_notes=?,retest_document_id=?,retest_sha256=?,retest_by=? WHERE tenant_id=? AND legal_entity_id=? AND project_id=? AND id=?').bind(next,email,v.notes.trim(),v.document_id,doc.sha256.toLowerCase(),email,TENANT,entity,project,v.id);
   }else{
    const evidence=['verified_fixed','still_vulnerable'].includes(next)?row.retest_document_id:row.evidence_document_id;
    erpAssert(evidence,'Bukti asli wajib');await supportingOriginal(db,evidence,p.opportunity_id);
    write=db.prepare('UPDATE rticore_native_vapt_finding SET status=?,version=version+1,last_actor=?,last_notes=? WHERE tenant_id=? AND legal_entity_id=? AND project_id=? AND id=?').bind(next,email,v.notes.trim(),TENANT,entity,project,v.id);
   }
   await erpAtom(a.identity,"EXISTS(SELECT 1 FROM rticore_native_vapt_finding WHERE tenant_id=? AND legal_entity_id=? AND project_id=? AND id=? AND version=?)",[TENANT,entity,project,v.id,v.version],[write],'cyber',v.id,'VAPT_FINDING_TRANSITION',{next_status:next});
   return erpReply({success:true,status:next});
  }
  if(v.action==='register_vapt_engagement'||v.action==='review_vapt_roe'){
   erpAssert(process.env.RTICORE_RUNTIME==='hostinger','Native VAPT required',503);
   erpAssert(erpId(v.project_id),'Project ID wajib');
   const project=v.project_id;const entity=await erpProjectUnit(db,project);
   const grant=await db.prepare('SELECT rticore_native_vapt_actor(?,?,?,?) AS role').bind(TENANT,entity,project,email).first<{role:string|null}>();
   erpAssert(grant?.role===role,'Akses VAPT ditolak',403);
   const p=await db.prepare('SELECT opportunity_id FROM rticore_delivery_projects WHERE tenant_id=? AND id=?').bind(TENANT,project).first<{opportunity_id:string}>();
   erpAssert(p,'Project tidak ditemukan',404);
   if(v.action==='register_vapt_engagement'){
    erpAssert(['admin','presales','offense_lead'].includes(role),'Maker VAPT wajib',403);
    erpAssert(erpText(v.engagement_code,4,64)&&erpText(v.title,5,200)&&erpText(v.scope_summary,12,2000)&&erpId(v.roe_document_id),'Kode, judul, scope, RoE asli wajib');
    erpAssert(typeof v.test_type==='string'&&['web_app','mobile_app','api','network','cloud','active_directory','wireless','red_team','purple_team','source_code'].includes(v.test_type),'Test type tidak valid');
    erpAssert(erpDate(v.window_start)&&erpDate(v.window_end)&&v.window_end>=v.window_start,'Testing window tidak valid');
    const doc=await supportingOriginal(db,v.roe_document_id,p.opportunity_id);const id=crypto.randomUUID();
    await erpAtom(a.identity,'1=1',[],[db.prepare('INSERT INTO rticore_native_vapt_engagement(id,tenant_id,legal_entity_id,project_id,engagement_code,title,test_type,scope_summary,window_start,window_end,roe_document_id,roe_sha256,created_by) VALUES(?,?,?,?,?,?,?,?,CAST(? AS date),CAST(? AS date),?,?,?)').bind(id,TENANT,entity,project,v.engagement_code.trim(),v.title.trim(),v.test_type,v.scope_summary.trim(),v.window_start,v.window_end,v.roe_document_id,doc.sha256.toLowerCase(),email)],'cyber',id,'VAPT_ENGAGEMENT_REGISTER',{project_id:project,document_id:v.roe_document_id});
    return erpReply({success:true,id,status:'registered'},201);
   }
   erpAssert(role==='approver','Independent approver wajib',403);
   erpAssert(erpId(v.id)&&typeof v.approve==='boolean'&&erpText(v.notes,12,800)&&v.version===1,'Review tidak valid');
   const row=await db.prepare("SELECT roe_document_id FROM rticore_native_vapt_engagement WHERE tenant_id=? AND legal_entity_id=? AND project_id=? AND id=? AND status='registered' AND version=1").bind(TENANT,entity,project,v.id).first<{roe_document_id:string}>();
   erpAssert(row,'Engagement pending tidak ditemukan',404);await supportingOriginal(db,row.roe_document_id,p.opportunity_id);
   await erpAtom(a.identity,"EXISTS(SELECT 1 FROM rticore_native_vapt_engagement WHERE tenant_id=? AND legal_entity_id=? AND project_id=? AND id=? AND status='registered' AND version=1 AND lower(created_by)<>?)",[TENANT,entity,project,v.id,email.toLowerCase()],[db.prepare("UPDATE rticore_native_vapt_engagement SET status=?,version=version+1,reviewed_by=?,reviewed_at=now(),review_notes=? WHERE tenant_id=? AND legal_entity_id=? AND project_id=? AND id=?").bind(v.approve?'roe_approved':'roe_rejected',email,v.notes.trim(),TENANT,entity,project,v.id)],'cyber',v.id,'VAPT_ROE_REVIEW',{approved:v.approve});
   return erpReply({success:true,status:v.approve?'roe_approved':'roe_rejected'});
  }
  if(v.action==='submit_soc_sla'||v.action==='review_soc_sla'){
   erpAssert(process.env.RTICORE_RUNTIME==='hostinger','Native SLA required',503);
   erpAssert(erpId(v.project_id),'Project ID wajib');
   const project=v.project_id;const entity=await erpProjectUnit(db,project);
   const grant=await db.prepare('SELECT rticore_native_soc_actor(?,?,?,?) AS role').bind(TENANT,entity,project,email).first<{role:string|null}>();
   erpAssert(grant?.role===role,'Akses SOC SLA ditolak',403);
   const p=await db.prepare('SELECT opportunity_id FROM rticore_delivery_projects WHERE tenant_id=? AND id=?').bind(TENANT,project).first<{opportunity_id:string}>();
   erpAssert(p,'Project tidak ditemukan',404);
   if(v.action==='submit_soc_sla'){
    erpAssert(['admin','defense_leader'].includes(role),'Maker SOC SLA wajib',403);
    erpAssert(erpPeriod(v.period_code)&&erpId(v.document_id),'Periode dan dokumen wajib');
    const valid=(x:unknown,min:number,max:number):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=min&&x<=max;
    erpAssert(valid(v.observations,1,10000000)&&valid(v.within_sla,0,v.observations)&&valid(v.alerts_triaged,0,10000000)&&valid(v.incidents_escalated,0,v.alerts_triaged),'Metrik tidak valid');
    erpAssert((v.mttd_minutes===null||valid(v.mttd_minutes,0,525600))&&(v.mttr_minutes===null||valid(v.mttr_minutes,0,525600)),'MTTD/MTTR tidak valid');
    const doc=await supportingOriginal(db,v.document_id,p.opportunity_id);const id=crypto.randomUUID();
    await erpAtom(a.identity,'1=1',[],[db.prepare('INSERT INTO rticore_native_soc_sla(id,tenant_id,legal_entity_id,project_id,period_code,observations,within_sla,alerts_triaged,incidents_escalated,mttd_minutes,mttr_minutes,document_id,document_sha256,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,TENANT,entity,project,v.period_code,v.observations,v.within_sla,v.alerts_triaged,v.incidents_escalated,v.mttd_minutes,v.mttr_minutes,v.document_id,doc.sha256.toLowerCase(),email)],'cyber',id,'SOC_SLA_SUBMIT',{project_id:project,period:v.period_code,document_id:v.document_id});
    return erpReply({success:true,id,status:'pending'},201);
   }
   erpAssert(role==='approver','Independent approver wajib',403);
   erpAssert(erpId(v.id)&&typeof v.approve==='boolean'&&erpText(v.notes,12,800),'Review tidak valid');
   const row=await db.prepare("SELECT document_id FROM rticore_native_soc_sla WHERE tenant_id=? AND legal_entity_id=? AND project_id=? AND id=? AND status='pending'").bind(TENANT,entity,project,v.id).first<{document_id:string}>();
   erpAssert(row,'SLA pending tidak ditemukan',404);await supportingOriginal(db,row.document_id,p.opportunity_id);
   await erpAtom(a.identity,"EXISTS(SELECT 1 FROM rticore_native_soc_sla WHERE tenant_id=? AND legal_entity_id=? AND project_id=? AND id=? AND status='pending' AND lower(created_by)<>?)",[TENANT,entity,project,v.id,email.toLowerCase()],[db.prepare("UPDATE rticore_native_soc_sla SET status=?,reviewed_by=?,reviewed_at=now(),review_notes=? WHERE tenant_id=? AND legal_entity_id=? AND project_id=? AND id=?").bind(v.approve?'approved':'rejected',email,v.notes.trim(),TENANT,entity,project,v.id)],'cyber',v.id,'SOC_SLA_REVIEW',{approved:v.approve});
   return erpReply({success:true,status:v.approve?'approved':'rejected'});
  }
  if(v.action==='append_custody'){
   erpAssert(process.env.RTICORE_RUNTIME==='hostinger','Native custody required',503);
   erpAssert(erpId(v.id)&&erpId(v.document_id)&&erpText(v.evidence_tag,3,64)&&erpText(v.notes,12,800),'Case, dokumen, tag dan catatan wajib');
   erpAssert(typeof v.custody_action==='string'&&['collected','transferred','analyzed','sealed','archived'].includes(v.custody_action),'Custody action invalid');
   erpAssert(typeof v.expected_seq==='number'&&Number.isSafeInteger(v.expected_seq)&&v.expected_seq>=0&&v.expected_seq<1000000,'Versi custody wajib');
   const recipient=v.custody_action==='transferred'?v.recipient_email:null;
   erpAssert(v.custody_action!=='transferred'||(typeof recipient==='string'&&recipient.includes('@')&&recipient.length<=254),'Recipient wajib');
   const {c}=await loadCase(db,v.id);const entity=await erpProjectUnit(db,c.project_id);
   const permitted=await db.prepare('SELECT rticore_native_dfir_actor(?,?,?,?) AS allowed').bind(TENANT,entity,c.id,email).first<{allowed:boolean}>();
   erpAssert(permitted?.allowed===true,'Akses custody ditolak',403);
   await supportingOriginal(db,v.document_id,c.opportunity_id);
   const row=await db.prepare('SELECT rticore_native_dfir_append(?,?,?,?,?,?,?,?,?,CAST(? AS integer)) AS result').bind(TENANT,entity,c.id,email,v.evidence_tag.trim(),v.document_id,v.custody_action,typeof recipient==='string'?recipient.trim().toLowerCase():null,v.notes.trim(),v.expected_seq).first<{result:unknown}>();
   erpAssert(row,'Custody belum tersedia',503);return erpReply({success:true,result:row.result},201);
  }
  if(v.action==='open'){
   erpAssert(OPENERS.includes(role),'Case hanya dibuat oleh operator bergrant',403);
   erpAssert(erpId(v.project_id)&&erpText(v.external_ref,3,120)&&erpText(v.title,8,240)&&['vapt_finding','soc_incident','dfir_incident'].includes(String(v.kind))&&['critical','high','medium','low','informational'].includes(String(v.severity))&&['confidential','restricted'].includes(String(v.classification)),'Metadata keamanan tidak valid');
   erpAssert(!isDefenseRole(role)||DEFENSE_CASE_KINDS.includes(String(v.kind)),'Defense Team membuka case soc_incident atau dfir_incident; temuan VAPT milik tim Offense/Presales',403);
   const unit=await erpProjectUnit(db,v.project_id as string);await erpGrant(a.identity,'cyber_ops',unit);
   const id=crypto.randomUUID();
   await erpAtom(a.identity,'1=1',[],[db.prepare('INSERT INTO rticore_cyber_cases(id,tenant_id,project_id,kind,external_ref,title,severity,classification,created_by) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,TENANT,v.project_id as string,v.kind as string,(v.external_ref as string).trim(),(v.title as string).trim(),v.severity as string,v.classification as string,email)],'cyber',id,'CASE_OPEN',{project_id:v.project_id,kind:v.kind,severity:v.severity});return erpReply({success:true,id},201);
  }
  if(v.action==='assign'||v.action==='submit'||v.action==='return'){
   erpAssert(erpId(v.id),'ID case wajib');
   const {c,x}=await loadCase(db,v.id as string);
   const unit=await erpProjectUnit(db,c.project_id);await erpGrant(a.identity,'cyber_ops',unit);
   erpAssert(c.status==='open'&&DEFENSE_CASE_KINDS.includes(c.kind),'Hanya case SOC/DFIR berstatus open yang dapat ditugaskan',409);
   erpAssert(!x||v.assignment_version===x.version,'Versi penugasan berubah; muat ulang',409);
   // The parent case must remain open at the transaction boundary, not only at the pre-read.
   const openCaseGuard="EXISTS(SELECT 1 FROM rticore_cyber_cases WHERE tenant_id=? AND id=? AND version=? AND status='open')";
   const caseArgs=[TENANT,c.id,c.version];
   if(v.action==='assign'){
    erpAssert(TRIAGE.includes(role),'Penugasan investigasi hanya oleh Defense Team Leader atau Admin',403);
    const assignee=typeof v.assignee_email==='string'?v.assignee_email.trim().toLowerCase():'';
    erpAssert(assignee.includes('@')&&assignee.length<=254,'Email analis wajib');
    const member=await db.prepare("SELECT role FROM rticore_members WHERE email=? AND active=1 AND role IN ('defense_leader','defense_member')").bind(assignee).first();
    erpAssert(member,'Analis harus anggota Defense Team aktif',409);
    erpAssert(await hasCyberGrant(db,assignee,unit),'Analis belum memiliki grant cyber_ops pada legal entity proyek',409);
    erpAssert(!x||['assigned','returned'].includes(x.status),'Investigasi sudah disubmit; kembalikan dulu sebelum menugaskan ulang',409);
    const write=x
     ?db.prepare("UPDATE rticore_cyber_case_assignments SET assignee_email=?,assigned_by=?,status='assigned',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND case_id=?").bind(assignee,email,TENANT,c.id)
     :db.prepare('INSERT INTO rticore_cyber_case_assignments(tenant_id,case_id,assignee_email,assigned_by) VALUES(?,?,?,?)').bind(TENANT,c.id,assignee,email);
    await erpAtom(a.identity,openCaseGuard+" AND "+(x?"EXISTS(SELECT 1 FROM rticore_cyber_case_assignments WHERE tenant_id=? AND case_id=? AND version=? AND status IN ('assigned','returned'))":"NOT EXISTS(SELECT 1 FROM rticore_cyber_case_assignments WHERE tenant_id=? AND case_id=?)"),[...caseArgs,TENANT,c.id,...(x?[x.version]:[])],[write],'cyber',c.id,x?'CASE_REASSIGN':'CASE_ASSIGN',{assignee_email:assignee});
    return erpReply({success:true},x?200:201);
   }
   erpAssert(x,'Case belum ditugaskan',409);
   if(v.action==='submit'){
    erpAssert(isDefenseRole(role)&&x.assignee_email.toLowerCase()===email,'Hanya analis yang ditugaskan yang dapat mengirim hasil investigasi',403);
    erpAssert(['assigned','returned'].includes(x.status),'Investigasi sudah disubmit',409);
    erpAssert(erpText(v.notes,12,2000)&&erpId(v.document_id),'Catatan investigasi dan dokumen bukti asli Vault wajib');
    await supportingOriginal(db,v.document_id as string,c.opportunity_id);
    await erpAtom(a.identity,openCaseGuard+" AND EXISTS(SELECT 1 FROM rticore_cyber_case_assignments WHERE tenant_id=? AND case_id=? AND version=? AND status IN ('assigned','returned') AND lower(assignee_email)=?)",[...caseArgs,TENANT,c.id,x.version,email],[db.prepare("UPDATE rticore_cyber_case_assignments SET status='submitted',version=version+1,investigation_notes=?,evidence_document_id=?,submitted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND case_id=?").bind((v.notes as string).trim(),v.document_id as string,TENANT,c.id)],'cyber',c.id,'CASE_SUBMIT',{document_id:v.document_id});
    return erpReply({success:true});
   }
   erpAssert(TRIAGE.includes(role)&&x.assignee_email.toLowerCase()!==email,'Pengembalian investigasi oleh Defense Team Leader lain dari analis',403);
   erpAssert(x.status==='submitted'&&erpText(v.notes,12,800),'Investigasi harus berstatus submitted dan alasan pengembalian wajib',409);
   await erpAtom(a.identity,openCaseGuard+" AND EXISTS(SELECT 1 FROM rticore_cyber_case_assignments WHERE tenant_id=? AND case_id=? AND version=? AND status='submitted' AND lower(assignee_email)!=?)",[...caseArgs,TENANT,c.id,x.version,email],[db.prepare("UPDATE rticore_cyber_case_assignments SET status='returned',version=version+1,assigned_by=?,leader_notes=?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND case_id=?").bind(email,(v.notes as string).trim(),TENANT,c.id)],'cyber',c.id,'CASE_RETURN',{});
   return erpReply({success:true});
  }
  if(v.action==='review'||v.action==='close'){
   erpAssert(erpId(v.id)&&Number.isSafeInteger(v.version),'ID dan versi case wajib');
   const {c,x}=await loadCase(db,v.id as string);
   await erpGrant(a.identity,'cyber_ops',await erpProjectUnit(db,c.project_id));
   erpAssert(v.version===c.version,'Versi case berubah',409);
   erpAssert(!isDefenseRole(role)||DEFENSE_CASE_KINDS.includes(c.kind),'Defense Team hanya me-review/menutup case SOC/DFIR',403);
   if(v.action==='review'){
    erpAssert(REVIEWERS.includes(role)&&c.created_by.toLowerCase()!==email&&c.status==='open','QA harus reviewer independen',403);
    erpAssert(!x||x.status==='submitted','Investigasi yang ditugaskan belum disubmit analis',409);
    erpAssert(!x||x.assignee_email.toLowerCase()!==email,'Analis yang menyelidiki tidak boleh me-review case sendiri',403);
    // A submitted investigation already carries original Vault evidence; the reviewer may reuse it.
    const doc=erpId(v.document_id)?v.document_id as string:x?.evidence_document_id||null;
    erpAssert(typeof v.approve==='boolean'&&erpText(v.notes,12,800)&&doc,'QA dan dokumen bukti asli wajib');
    await supportingOriginal(db,doc as string,c.opportunity_id);
    await erpAtom(a.identity,"EXISTS(SELECT 1 FROM rticore_cyber_cases WHERE tenant_id=? AND id=? AND version=? AND status='open' AND lower(created_by)!=?) AND "+(x?"EXISTS(SELECT 1 FROM rticore_cyber_case_assignments WHERE tenant_id=? AND case_id=? AND version=? AND status='submitted' AND lower(assignee_email)!=?)":"NOT EXISTS(SELECT 1 FROM rticore_cyber_case_assignments WHERE tenant_id=? AND case_id=?)"),[TENANT,c.id,c.version,email,...(x?[TENANT,c.id,x.version,email]:[TENANT,c.id])],[db.prepare('UPDATE rticore_cyber_cases SET status=?,version=version+1,reviewer_email=?,review_notes=?,evidence_document_id=?,reviewed_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?').bind(v.approve?'reviewed':'rejected',email,v.notes as string,doc,TENANT,c.id)],'cyber',c.id,'CASE_REVIEW',{approved:v.approve,document_id:doc});return erpReply({success:true});
   }
   erpAssert(CLOSERS.includes(role)&&c.status==='reviewed'&&c.reviewer_email!==null&&c.reviewer_email.toLowerCase()!==email,'Penutupan perlu review independen',403);
   await supportingOriginal(db,c.evidence_document_id as string,c.opportunity_id);
   await erpAtom(a.identity,"EXISTS(SELECT 1 FROM rticore_cyber_cases WHERE tenant_id=? AND id=? AND version=? AND status='reviewed')",[TENANT,c.id,c.version],[db.prepare("UPDATE rticore_cyber_cases SET status='closed',version=version+1,closed_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?").bind(TENANT,c.id)],'cyber',c.id,'CASE_CLOSE',{evidence_document_id:c.evidence_document_id});
   return erpReply({success:true});
  }
  throw new ERPError('Aksi cybersecurity operations tidak dikenal');
 }catch(e){return erpError(e);}
}
