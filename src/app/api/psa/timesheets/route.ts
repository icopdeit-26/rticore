import {authorizeBoQ,privateHeaders} from '@/lib/boq-auth';
import {readBoundedJSON,RequestBodyError} from '@/lib/bounded-json';
import {TENANT,safeID} from '@/lib/sales-workflow';
import {buildFinanceOutboxStatement,operationalFinanceScope,operationalFinanceScopePredicate} from '@/lib/finance-docking-bridge';
import {atomicSales} from '@/lib/sales-transactions';
import {operationEvent,jakartaDate} from '@/lib/operations';
import {isOffenseRole,OFFENSE_PROJECT_SCOPE,offenseScopeArgs,offenseOnProjectId} from '@/lib/offense-team';
import {isGovernanceRole,GOVERNANCE_PROJECT_SCOPE,governanceScopeArgs,governanceOnProjectId} from '@/lib/governance-team';
import {isITDevRole,ITDEV_PROJECT_SCOPE,itdevScopeArgs,itdevOnProjectId} from '@/lib/itdev-team';

export const dynamic='force-dynamic';
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders});
const fail=(message:string,status=422)=>reply({success:false,message},status);
const reviewers=['finance','approver'];
// project_manager: sees/reviews entries only on projects where it is the assigned PM; never cost snapshots.
// offense_member: own entries on allocated Offensive Security projects only.
// offense_lead: additionally sees and reviews the team's entries on those projects (never its own, never cost).
// governance_member / governance_leader: same model on allocated GRC projects.
// defense_leader / defense_member: own entries on projects where the account has an active
// resource allocation (default "allocated" scope); review stays with PM, Finance or Approver.
const roles=['admin','presales','project_manager','offense_lead','offense_member','governance_leader','governance_member','defense_leader','defense_member','itdev_leader','itdev_member',...reviewers];
// itdev_member / itdev_leader: same model as Offense/Governance on allocated Technology & Implementation projects.
const PM_SCOPE="lower(p.pm_email)=?";
const iso=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const error=(e:unknown)=>/CONFLICT|constraint|IMMUTABLE|FOREIGN KEY|FINANCE_SCOPE_REQUIRED|could not serialize/i.test(String(e))?fail('Timesheet berubah atau melebihi alokasi. Muat ulang.',409):fail('Timesheet belum tersedia; periksa migrasi 0033.',503);

type Row={id:string;tenant_id:string;project_id:string;person_id:string;allocation_id:string;work_date:string;minutes:number;billable:number;description:string;status:string;version:number;created_by:string;reviewed_by:string|null;review_notes:string|null;cost_snapshot_cents:number};
export async function GET(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 const {db,email,role}=a.identity;if(!roles.includes(role))return fail('Akses timesheet ditolak',403);
 try{
  const u=new URL(req.url),id=u.searchParams.get('project_id');
  const privileged=reviewers.includes(role),pm=role==='project_manager',offense=isOffenseRole(role),governance=isGovernanceRole(role),itdev=isITDevRole(role),lead=role==='offense_lead'||role==='governance_leader'||role==='itdev_leader';
  const allocated='EXISTS(SELECT 1 FROM rticore_resource_allocations x JOIN rticore_resource_people r ON r.id=x.person_id AND r.tenant_id=x.tenant_id WHERE x.tenant_id=p.tenant_id AND x.opportunity_id=p.opportunity_id AND x.status=\'active\' AND r.active=1 AND lower(r.email)=?)';
  const scope=privileged?'1=1':pm?PM_SCOPE+' OR '+allocated:offense?OFFENSE_PROJECT_SCOPE():governance?GOVERNANCE_PROJECT_SCOPE():itdev?ITDEV_PROJECT_SCOPE():allocated;
  const scopeArgs=privileged?[]:pm?[email,email]:offense?offenseScopeArgs(email):governance?governanceScopeArgs(email):itdev?itdevScopeArgs(email):[email];
  const projects=await db.prepare(`SELECT p.id,p.title,p.status,p.start_date,p.end_date,lower(coalesce(p.pm_email,''))=? AS managed FROM rticore_delivery_projects p
   WHERE p.tenant_id=? AND (${scope}) ORDER BY p.created_at DESC LIMIT 100`).bind(email,TENANT,...scopeArgs).all<{id:string;managed:number|boolean}>();
  // A PM reviews its own project's team; other allocated projects behave like a team member.
  // An Offense Team Leader reviews the team on every Offensive project it is allocated to.
  const managed=(pid:string)=>pm&&projects.results.some(p=>p.id===pid&&!!Number(p.managed));
  const leadProjects=lead?projects.results.map(p=>p.id):[];
  if(!id)return reply({success:true,role,reviewer:privileged,pm_projects:pm?projects.results.filter(p=>!!Number(p.managed)).map(p=>p.id):[],lead_projects:leadProjects,projects:projects.results,items:[],allocations:[]});
  if(!safeID(id)||!projects.results.some(p=>p.id===id))return fail('Proyek tidak tersedia untuk akun ini',404);
  const seesAll=privileged||managed(id)||leadProjects.includes(id);
  const [entries,allocations]=await Promise.all([
   db.prepare(`SELECT t.id,t.project_id,t.work_date,t.minutes,t.billable,t.description,t.status,t.version,t.created_by,t.reviewed_by,t.review_notes,${privileged?'t.cost_snapshot_cents':'0 AS cost_snapshot_cents'} FROM rticore_project_timesheets t WHERE t.tenant_id=? AND t.project_id=? ${seesAll?'':'AND lower(t.created_by)=?'} ORDER BY t.work_date DESC,t.created_at DESC LIMIT 500`).bind(TENANT,id,...(seesAll?[]:[email])).all<Row>(),
   db.prepare("SELECT x.id,x.allocation_month,x.person_days,r.display_name FROM rticore_resource_allocations x JOIN rticore_resource_people r ON r.id=x.person_id AND r.tenant_id=x.tenant_id JOIN rticore_delivery_projects p ON p.opportunity_id=x.opportunity_id AND p.tenant_id=x.tenant_id WHERE p.tenant_id=? AND p.id=? AND x.status='active' AND lower(r.email)=? ORDER BY x.allocation_month").bind(TENANT,id,email).all()
  ]);
  return reply({success:true,role,reviewer:seesAll,lead_projects:leadProjects,pm_projects:pm?projects.results.filter(p=>!!Number(p.managed)).map(p=>p.id):[],projects:projects.results,items:entries.results,allocations:allocations.results});
 }catch(e){return error(e);}
}
export async function POST(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 const {db,email,role}=a.identity;if(!roles.includes(role))return fail('Akses timesheet ditolak',403);
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return fail('Origin ditolak',403);
 let v:Record<string,unknown>;try{v=await readBoundedJSON(req,5000);}catch(e){return fail(e instanceof Error?e.message:'JSON tidak valid',e instanceof RequestBodyError?e.status:400);}
 try{
  if(v.action==='submit'){
   if(!safeID(v.project_id)||!safeID(v.allocation_id)||!iso(v.work_date)||typeof v.minutes!=='number'||!Number.isInteger(v.minutes)||v.minutes<15||v.minutes>480||v.minutes%15||typeof v.billable!=='boolean'||typeof v.description!=='string'||v.description.trim().length<12||v.description.length>1000)return fail('Proyek, alokasi, tanggal, jam kerja dan deskripsi wajib valid');
   const projectId=v.project_id as string,allocationId=v.allocation_id as string,workDate=v.work_date as string,minutes=v.minutes as number,description=(v.description as string).trim();
   if(workDate>jakartaDate())return fail('Tanggal kerja tidak boleh di masa depan');
   if(isOffenseRole(role)&&!await offenseOnProjectId(db,email,projectId))return fail('Offense Team hanya mencatat jam pada engagement Offensive Security yang dialokasikan',403);
   if(isGovernanceRole(role)&&!await governanceOnProjectId(db,email,projectId))return fail('Governance Team hanya mencatat jam pada engagement GRC yang dialokasikan',403);
   if(isITDevRole(role)&&!await itdevOnProjectId(db,email,projectId))return fail('IT Developer Team hanya mencatat jam pada proyek Technology & Implementation yang dialokasikan',403);
   const id=crypto.randomUUID();
   await atomicSales(db,`EXISTS(SELECT 1 FROM rticore_delivery_projects p JOIN rticore_resource_allocations x ON x.tenant_id=p.tenant_id AND x.opportunity_id=p.opportunity_id AND x.id=? JOIN rticore_resource_people r ON r.id=x.person_id AND r.tenant_id=x.tenant_id WHERE p.tenant_id=? AND p.id=? AND p.status='active' AND x.status='active' AND r.active=1 AND x.daily_cost_snapshot>=0 AND x.daily_cost_snapshot<=90071992547409 AND lower(r.email)=? AND substr(?,1,7)=x.allocation_month AND ? BETWEEN p.start_date AND p.end_date)`,[allocationId,TENANT,projectId,email,workDate,workDate],[
    db.prepare('INSERT INTO rticore_project_timesheets(id,tenant_id,project_id,person_id,allocation_id,work_date,minutes,billable,description,cost_snapshot_cents,created_by) SELECT ?,p.tenant_id,p.id,x.person_id,x.id,?,?,?,?,CAST(round(x.daily_cost_snapshot*100*?/480) AS INTEGER),? FROM rticore_delivery_projects p JOIN rticore_resource_allocations x ON x.tenant_id=p.tenant_id AND x.opportunity_id=p.opportunity_id WHERE p.tenant_id=? AND p.id=? AND x.id=?').bind(id,workDate,minutes,v.billable?1:0,description,minutes,email,TENANT,projectId,allocationId),
    operationEvent(db,'timesheet',id,'SUBMIT',email,{project_id:projectId,work_date:workDate,minutes})
   ]);return reply({success:true,id},201);
  }
  if(v.action==='review'){
   if(!reviewers.includes(role)&&role!=='project_manager'&&role!=='offense_lead'&&role!=='governance_leader'&&role!=='itdev_leader')return fail('Review hanya untuk Finance, Approver, PM proyek, Offense, Governance atau IT Developer Team Leader',403);
   if(!safeID(v.id)||!Number.isInteger(v.version)||typeof v.approve!=='boolean'||typeof v.notes!=='string'||v.notes.trim().length<12||v.notes.length>1000)return fail('ID, versi, keputusan dan alasan review wajib valid');
   const row=await db.prepare('SELECT * FROM rticore_project_timesheets WHERE tenant_id=? AND id=?').bind(TENANT,v.id).first<Row>();
   if(!row)return fail('Timesheet tidak ditemukan',404);
   if(role==='project_manager'&&!await db.prepare('SELECT id FROM rticore_delivery_projects p WHERE p.tenant_id=? AND p.id=? AND '+PM_SCOPE).bind(TENANT,row.project_id,email).first())
    return fail('PM hanya mereview timesheet tim pada proyek yang ditugaskan kepadanya',403);
   if(role==='offense_lead'&&!await offenseOnProjectId(db,email,row.project_id))
    return fail('Offense Team Leader hanya mereview timesheet tim pada engagement Offensive Security yang dialokasikan kepadanya',403);
   if(role==='governance_leader'&&!await governanceOnProjectId(db,email,row.project_id))
    return fail('Governance Team Leader hanya mereview timesheet tim pada engagement GRC yang dialokasikan kepadanya',403);
   if(role==='itdev_leader'&&!await itdevOnProjectId(db,email,row.project_id))
    return fail('IT Developer Leader hanya mereview timesheet tim pada proyek Technology & Implementation yang dialokasikan kepadanya',403);
   if(row.created_by.toLowerCase()===email)return fail('Maker tidak boleh menyetujui sendiri',403);
   if(row.status!=='submitted'||row.version!==v.version)return fail('Versi/status timesheet berubah',409);
   if(v.approve&&(!Number.isSafeInteger(Number(row.cost_snapshot_cents))||Number(row.cost_snapshot_cents)<0||row.cost_snapshot_cents===null))return fail('Snapshot biaya timesheet tidak valid; rekonsiliasi wajib',409);
   const scopeByRole={
    project_manager:{sql:PM_SCOPE,args:[email]},
    offense_lead:{sql:OFFENSE_PROJECT_SCOPE(),args:offenseScopeArgs(email)},
    governance_leader:{sql:GOVERNANCE_PROJECT_SCOPE(),args:governanceScopeArgs(email)},
    itdev_leader:{sql:ITDEV_PROJECT_SCOPE(),args:itdevScopeArgs(email)},
   };
   const scope=scopeByRole[role as keyof typeof scopeByRole];
   const projectGuard=scope?` AND EXISTS(SELECT 1 FROM rticore_delivery_projects p
    WHERE p.tenant_id=t.tenant_id AND p.id=t.project_id AND (${scope.sql}))`:'';
   const entity=v.approve?await operationalFinanceScope(db,row.project_id):null;
   const docking=entity?await buildFinanceOutboxStatement(db,{legalEntityId:entity,eventType:'timesheet.approved',sourceDocumentId:row.id,idempotencyKey:'PSA-APPROVED:'+row.id,payload:{project_id:row.project_id,timesheet_id:row.id,allocation_id:row.allocation_id,person_id:row.person_id,work_date:row.work_date,minutes:Number(row.minutes),billable:Boolean(Number(row.billable)),cost_snapshot_cents:String(row.cost_snapshot_cents),approved_by:email}}):null;
   const financeGuard=entity?' AND '+operationalFinanceScopePredicate:'';
   await atomicSales(db,`EXISTS(SELECT 1 FROM rticore_project_timesheets t
    WHERE t.tenant_id=? AND t.id=? AND t.version=? AND t.status='submitted' AND lower(t.created_by)!=?${projectGuard})${financeGuard}`,
   [TENANT,row.id,row.version,email,...(scope?.args??[]),...(entity?[TENANT,row.project_id,entity]:[])],[
    db.prepare('UPDATE rticore_project_timesheets SET status=?,version=version+1,reviewed_by=?,review_notes=?,reviewed_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?').bind(v.approve?'approved':'rejected',email,v.notes.trim(),TENANT,row.id),
    operationEvent(db,'timesheet',row.id,v.approve?'APPROVE':'REJECT',email,{version:row.version,notes:v.notes.trim()}),
    ...(docking?[docking.stmt]:[])
   ]);return reply({success:true,...(docking?{finance_event_id:docking.eventId}:{})});
  }
  return fail('Aksi tidak dikenal');
 }catch(e){return error(e);}
}
