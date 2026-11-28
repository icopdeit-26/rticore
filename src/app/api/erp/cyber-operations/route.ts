import {authorizeBoQ} from '@/lib/boq-auth';
import {readBoundedJSON} from '@/lib/bounded-json';
import {supportingOriginal as vaultOriginal,ServiceError} from '@/lib/service-operations';
import {TENANT} from '@/lib/sales-workflow';
import {erpReply,erpError,ERPError,erpAssert,erpId,erpText,erpOrigin,erpGrant,erpAtom,erpProjectUnit} from '@/lib/erp-core';
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
  :{results:[]};
 const analysts=a.role==='defense_leader'||a.role==='admin'
  ?await a.db.prepare("SELECT email,role FROM rticore_members WHERE active=1 AND role IN ('defense_leader','defense_member') ORDER BY CASE role WHEN 'defense_member' THEN 0 ELSE 1 END,email LIMIT 200").all()
  :{results:[]};
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
  if(u.searchParams.get('board')==='1'){
   erpAssert(isDefenseRole(a.identity.role)||a.identity.role==='admin','Board SOC Defense hanya untuk Defense Team atau Admin',403);
   return erpReply(await board(a.identity));
  }
  const id=u.searchParams.get('project_id');erpAssert(erpId(id),'Project ID wajib');
  const unit=await erpProjectUnit(a.identity.db,id);await erpGrant(a.identity,'cyber_ops',unit);
  const rows=await a.identity.db.prepare(`SELECT ${CASE_COLS} ${CASE_FROM} WHERE c.tenant_id=? AND c.project_id=? ORDER BY c.created_at DESC LIMIT 250`).bind(TENANT,id).all();
  return erpReply({success:true,cases:rows.results,warning:'Metadata workflow only; not a SIEM/EDR/scanner'});
 }catch(e){return erpError(e);}
}
export async function POST(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;const {db,role,email}=a.identity;
 try{
  erpAssert(!a.identity.rolePreview,'Role preview tidak diizinkan mengubah Cyber Operations',403);erpOrigin(req);const v=await readBoundedJSON(req,7000) as Record<string,unknown>;
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
