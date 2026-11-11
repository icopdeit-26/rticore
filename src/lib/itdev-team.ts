/**
 * IT Developer Team roles (itdev_leader = Leader, itdev_member = Member), migration 0051.
 *
 * Two duties, both least-privilege:
 * 1. Implementation delivery: Technology & Implementation delivery projects (service catalog group
 *    "Technology & Implementation": Cybersecurity Technology, SIEM/SOAR, IAM/PAM, Network/Endpoint,
 *    Cloud Security, DLP, DevSecOps/Secure Code Review, OT/ICS, Security Hardening, plus the legacy
 *    'FortiSIEM' family) on which the account has an active resource allocation
 *    (rticore_resource_people.email). Member saves task progress; Leader completes tasks with Vault
 *    evidence, reviews the team's timesheets and reads Technology Feasibility plans (read-only).
 * 2. Internal platform: read-only RTICORE platform diagnostics (/api/platform/diagnostics).
 *    Member: database/migration/release readiness. Leader: additionally the system operations audit
 *    trail (technical areas only). No settings, API keys, user registry or business data.
 *
 * Neither role sees BoQ, HPP, contract value, invoices, CRM or ERP, and neither is PM-eligible.
 * Mirrors offense-team.ts / governance-team.ts so every delivery team behaves alike.
 */
import type {D1DB} from './boq-auth';
import {TENANT,SERVICE_CATALOG} from './sales-workflow';

export type ITDevRole='itdev_leader'|'itdev_member';
export const ITDEV_ROLES:readonly ITDevRole[]=['itdev_leader','itdev_member'];
export const isITDevRole=(role:string|null|undefined):role is ITDevRole=>role==='itdev_leader'||role==='itdev_member';
// 'FortiSIEM' is the legacy family name still handled by the 0027 delivery task trigger.
export const ITDEV_FAMILIES:readonly string[]=['FortiSIEM',...SERVICE_CATALOG.filter(x=>x.group==='Technology & Implementation').map(x=>x.name)];
export const isITDevFamily=(family:string|null|undefined)=>!!family&&ITDEV_FAMILIES.includes(family);
/**
 * Implementation tasks the team works on (license/entitlement → implementation & UAT → support
 * handover, prerequisites in service-workflow.ts). The 0027 trigger creates these only for
 * 'Cybersecurity Technology'/'FortiSIEM'; the other Technology families get the generic
 * service_deliverable task, which the team works on too. Kickoff/activation/closure stay with the PM.
 */
export const ITDEV_TASKS:readonly string[]=['tech_license','tech_implementation','tech_support','service_deliverable'];

/** Read-only platform diagnostics API (internal platform duty). */
export const PLATFORM_API='/api/platform/diagnostics';
/**
 * APIs an IT Developer account may call at all (checked in authorizeBoQ before any handler).
 * Every listed handler still checks the role and the allocated project itself.
 */
const ITDEV_API:readonly string[]=['/api/sales/identity','/api/sales/approval-queue','/api/sales','/api/sales/service-operations','/api/psa/timesheets','/api/sales/document-vault',PLATFORM_API];
const LEADER_API:readonly string[]=['/api/sales/feasibility'];
export function itdevRouteAllowed(path:string,role:string):boolean{
 if(!isITDevRole(role))return true;
 const p=path.replace(/\/+$/,'')||'/';
 return ITDEV_API.includes(p)||(role==='itdev_leader'&&LEADER_API.includes(p));
}

const families=()=>'('+ITDEV_FAMILIES.map(()=>'?').join(',')+')';
/** SQL predicate on alias p (rticore_delivery_projects): Technology project allocated to ? (email). */
export const ITDEV_PROJECT_SCOPE=()=>`p.service_family IN ${families()} AND EXISTS(SELECT 1 FROM rticore_resource_allocations x JOIN rticore_resource_people r ON r.id=x.person_id AND r.tenant_id=x.tenant_id WHERE x.tenant_id=p.tenant_id AND x.opportunity_id=p.opportunity_id AND x.status='active' AND r.active=1 AND lower(r.email)=?)`;
export const itdevScopeArgs=(email:string)=>[...ITDEV_FAMILIES,email.toLowerCase()];

/** True when the Opportunity has a Technology delivery project allocated to this account. */
export async function itdevOnProject(db:D1DB,email:string,opportunityId:string){
 return !!await db.prepare(`SELECT p.id FROM rticore_delivery_projects p WHERE p.tenant_id=? AND p.opportunity_id=? AND ${ITDEV_PROJECT_SCOPE()}`)
  .bind(TENANT,opportunityId,...itdevScopeArgs(email)).first();
}
/** Same check by delivery project id (timesheets). */
export async function itdevOnProjectId(db:D1DB,email:string,projectId:string){
 return !!await db.prepare(`SELECT p.id FROM rticore_delivery_projects p WHERE p.tenant_id=? AND p.id=? AND ${ITDEV_PROJECT_SCOPE()}`)
  .bind(TENANT,projectId,...itdevScopeArgs(email)).first();
}

type DealRow={id:string;title:string;stage:string;flow_version:number;company_name:string;data_json?:string};
/**
 * Project selector for IT Developer pages. Member: allocated Technology delivery projects.
 * Leader: the same, plus open Technology Opportunities for read-only Feasibility.
 * scope tells the UI which workspace each entry belongs to.
 */
export async function itdevDeals(db:D1DB,email:string,role:ITDevRole){
 const delivery=await db.prepare(`SELECT d.id,d.title,d.stage,d.flow_version,a.legal_name AS company_name FROM rticore_delivery_projects p JOIN rticore_sales_opportunities d ON d.id=p.opportunity_id AND d.tenant_id=p.tenant_id JOIN rticore_sales_accounts a ON a.id=d.company_id AND a.tenant_id=d.tenant_id WHERE p.tenant_id=? AND ${ITDEV_PROJECT_SCOPE()} ORDER BY p.created_at DESC LIMIT 250`)
  .bind(TENANT,...itdevScopeArgs(email)).all<DealRow>();
 const rows=delivery.results.map(x=>({...x,scope:'delivery' as const}));
 if(role!=='itdev_leader')return rows;
 const planning=await db.prepare(`SELECT d.id,d.title,d.stage,d.flow_version,a.legal_name AS company_name FROM rticore_sales_opportunities d JOIN rticore_sales_accounts a ON a.id=d.company_id AND a.tenant_id=d.tenant_id WHERE d.tenant_id=? AND d.stage NOT IN ('closed_won','closed_lost') AND json_extract(d.data_json,'$.service_family') IN ${families()} ORDER BY d.created_at DESC LIMIT 250`)
  .bind(TENANT,...ITDEV_FAMILIES).all<DealRow>();
 const seen=new Set(rows.map(x=>x.id));
 return [...rows,...planning.results.filter(x=>!seen.has(x.id)).map(x=>({...x,scope:'feasibility' as const}))];
}
/** Leader reads Feasibility only for open Technology & Implementation Opportunities. */
export function itdevFeasibilityAllowed(role:string,deal:{stage:string;data_json:string}){
 if(role!=='itdev_leader')return false;
 let family='';try{family=String((JSON.parse(deal.data_json||'{}') as Record<string,unknown>).service_family||'');}catch{family='';}
 return isITDevFamily(family)&&deal.stage!=='closed_lost';
}
/**
 * Operations-event areas that are platform/technical, shown in the Leader's audit view (metadata
 * only: area, entity, action, actor, time; never the event payload). Commercial areas (setting
 * values, catalog prices, numbering, actual cost, partner, sales audit) are excluded.
 */
export const PLATFORM_AUDIT_AREAS:readonly string[]=['delivery','timesheet','member','admin_options','report'];
