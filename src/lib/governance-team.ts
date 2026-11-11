/**
 * Governance Team roles (governance_leader = Leader, governance_member = Member), migration 0050.
 *
 * Scope: Governance, Risk & Compliance delivery projects (service catalog group
 * "Governance, Risk & Compliance") on which the account has an active resource allocation
 * (rticore_resource_people.email). Leader additionally reviews its team's timesheets there and
 * reads GRC Feasibility plans (read-only). Neither role sees BoQ, HPP, contract value, invoices,
 * CRM or ERP, and neither is PM-eligible. Mirrors offense-team.ts so both teams behave alike.
 */
import type {D1DB} from './boq-auth';
import {TENANT,SERVICE_CATALOG} from './sales-workflow';

export type GovernanceRole='governance_leader'|'governance_member';
export const GOVERNANCE_ROLES:readonly GovernanceRole[]=['governance_leader','governance_member'];
export const isGovernanceRole=(role:string|null|undefined):role is GovernanceRole=>role==='governance_leader'||role==='governance_member';
// 'GRC' is the legacy family name still handled by the 0027 delivery task trigger.
export const GOVERNANCE_FAMILIES:readonly string[]=['GRC',...SERVICE_CATALOG.filter(x=>x.group==='Governance, Risk & Compliance').map(x=>x.name)];
export const isGovernanceFamily=(family:string|null|undefined)=>!!family&&GOVERNANCE_FAMILIES.includes(family);
/**
 * GRC engagement tasks the team works on (assessment & evidence → gap analysis → remediation
 * action plan, prerequisites in service-workflow.ts). The 0027 trigger creates these only for
 * 'Cybersecurity Governance'/'GRC'; the other GRC families (ISO 27001, PDP, IT Audit, BCM, ...)
 * get the generic service_deliverable task, which the team works on too.
 * Kickoff/activation/closure stay with the PM.
 */
export const GOVERNANCE_TASKS:readonly string[]=['grc_assessment','grc_gap','grc_remediation','service_deliverable'];

/**
 * APIs a Governance Team account may call at all (checked in authorizeBoQ before any handler).
 * Every listed handler still checks the role and the allocated project itself.
 */
// approval-queue is not listed: its handler answers 403 for project-scoped roles (no queue count).
const GOVERNANCE_API:readonly string[]=['/api/sales/identity','/api/sales','/api/sales/service-operations','/api/psa/timesheets','/api/sales/document-vault'];
const LEADER_API:readonly string[]=['/api/sales/feasibility'];
export function governanceRouteAllowed(path:string,role:string):boolean{
 if(!isGovernanceRole(role))return true;
 const p=path.replace(/\/+$/,'')||'/';
 return GOVERNANCE_API.includes(p)||(role==='governance_leader'&&LEADER_API.includes(p));
}

const families=()=>'('+GOVERNANCE_FAMILIES.map(()=>'?').join(',')+')';
/** SQL predicate on alias p (rticore_delivery_projects): GRC project allocated to ? (email). */
export const GOVERNANCE_PROJECT_SCOPE=()=>`p.service_family IN ${families()} AND EXISTS(SELECT 1 FROM rticore_resource_allocations x JOIN rticore_resource_people r ON r.id=x.person_id AND r.tenant_id=x.tenant_id WHERE x.tenant_id=p.tenant_id AND x.opportunity_id=p.opportunity_id AND x.status='active' AND r.active=1 AND lower(r.email)=?)`;
export const governanceScopeArgs=(email:string)=>[...GOVERNANCE_FAMILIES,email.toLowerCase()];

/** True when the Opportunity has a GRC delivery project allocated to this account. */
export async function governanceOnProject(db:D1DB,email:string,opportunityId:string){
 return !!await db.prepare(`SELECT p.id FROM rticore_delivery_projects p WHERE p.tenant_id=? AND p.opportunity_id=? AND ${GOVERNANCE_PROJECT_SCOPE()}`)
  .bind(TENANT,opportunityId,...governanceScopeArgs(email)).first();
}
/** Same check by delivery project id (timesheets). */
export async function governanceOnProjectId(db:D1DB,email:string,projectId:string){
 return !!await db.prepare(`SELECT p.id FROM rticore_delivery_projects p WHERE p.tenant_id=? AND p.id=? AND ${GOVERNANCE_PROJECT_SCOPE()}`)
  .bind(TENANT,projectId,...governanceScopeArgs(email)).first();
}

type DealRow={id:string;title:string;stage:string;flow_version:number;company_name:string;data_json?:string};
/**
 * Project selector for Governance Team pages. Member: allocated GRC delivery projects.
 * Leader: the same, plus open GRC Opportunities for read-only Feasibility.
 * scope tells the UI which workspace each entry belongs to.
 */
export async function governanceDeals(db:D1DB,email:string,role:GovernanceRole){
 const delivery=await db.prepare(`SELECT d.id,d.title,d.stage,d.flow_version,a.legal_name AS company_name FROM rticore_delivery_projects p JOIN rticore_sales_opportunities d ON d.id=p.opportunity_id AND d.tenant_id=p.tenant_id JOIN rticore_sales_accounts a ON a.id=d.company_id AND a.tenant_id=d.tenant_id WHERE p.tenant_id=? AND ${GOVERNANCE_PROJECT_SCOPE()} ORDER BY p.created_at DESC LIMIT 250`)
  .bind(TENANT,...governanceScopeArgs(email)).all<DealRow>();
 const rows=delivery.results.map(x=>({...x,scope:'delivery' as const}));
 if(role!=='governance_leader')return rows;
 const planning=await db.prepare(`SELECT d.id,d.title,d.stage,d.flow_version,a.legal_name AS company_name FROM rticore_sales_opportunities d JOIN rticore_sales_accounts a ON a.id=d.company_id AND a.tenant_id=d.tenant_id WHERE d.tenant_id=? AND d.stage NOT IN ('closed_won','closed_lost') AND json_extract(d.data_json,'$.service_family') IN ${families()} ORDER BY d.created_at DESC LIMIT 250`)
  .bind(TENANT,...GOVERNANCE_FAMILIES).all<DealRow>();
 const seen=new Set(rows.map(x=>x.id));
 return [...rows,...planning.results.filter(x=>!seen.has(x.id)).map(x=>({...x,scope:'feasibility' as const}))];
}
/** Leader reads Feasibility only for open GRC Opportunities. */
export function governanceFeasibilityAllowed(role:string,deal:{stage:string;data_json:string}){
 if(role!=='governance_leader')return false;
 let family='';try{family=String((JSON.parse(deal.data_json||'{}') as Record<string,unknown>).service_family||'');}catch{family='';}
 return isGovernanceFamily(family)&&deal.stage!=='closed_lost';
}
