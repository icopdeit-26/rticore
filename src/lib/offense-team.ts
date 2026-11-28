/**
 * Offense Team roles (offense_lead = Leader, offense_member = Member), migration 0048.
 *
 * Scope: Offensive Security delivery projects (service catalog group "Offensive Security")
 * on which the account has an active resource allocation (rticore_resource_people.email).
 * Leader additionally reviews its team's timesheets there and reads Offensive Security
 * Feasibility plans (read-only). Neither role sees BoQ, HPP, contract value, invoices,
 * CRM or ERP, and neither is PM-eligible.
 */
import type {D1DB} from './boq-auth';
import {TENANT,SERVICE_CATALOG} from './sales-workflow';

export type OffenseRole='offense_lead'|'offense_member';
export const OFFENSE_ROLES:readonly OffenseRole[]=['offense_lead','offense_member'];
export const isOffenseRole=(role:string|null|undefined):role is OffenseRole=>role==='offense_lead'||role==='offense_member';
export const OFFENSE_FAMILIES:readonly string[]=SERVICE_CATALOG.filter(x=>x.group==='Offensive Security').map(x=>x.name);
export const isOffenseFamily=(family:string|null|undefined)=>!!family&&OFFENSE_FAMILIES.includes(family);
/** Technical engagement tasks the team works on. Kickoff/activation/closure stay with the PM. */
export const OFFENSE_TASKS:readonly string[]=['vapt_scope','vapt_test','vapt_report','vapt_retest'];

/**
 * APIs an Offense Team account may call at all (checked in authorizeBoQ before any handler).
 * Every listed handler still checks the role and the allocated project itself.
 */
const OFFENSE_API:readonly string[]=['/api/sales/identity','/api/sales','/api/sales/service-operations','/api/psa/timesheets','/api/sales/document-vault','/api/erp/technical-registers'];
const LEAD_API:readonly string[]=['/api/sales/feasibility'];
export function offenseRouteAllowed(path:string,role:string):boolean{
 if(!isOffenseRole(role))return true;
 const p=path.replace(/\/+$/,'')||'/';
 return OFFENSE_API.includes(p)||(role==='offense_lead'&&LEAD_API.includes(p));
}

const families=()=>'('+OFFENSE_FAMILIES.map(()=>'?').join(',')+')';
/** SQL predicate on alias p (rticore_delivery_projects): Offensive project allocated to ? (email). */
export const OFFENSE_PROJECT_SCOPE=()=>`p.service_family IN ${families()} AND EXISTS(SELECT 1 FROM rticore_resource_allocations x JOIN rticore_resource_people r ON r.id=x.person_id AND r.tenant_id=x.tenant_id WHERE x.tenant_id=p.tenant_id AND x.opportunity_id=p.opportunity_id AND x.status='active' AND r.active=1 AND lower(r.email)=?)`;
export const offenseScopeArgs=(email:string)=>[...OFFENSE_FAMILIES,email.toLowerCase()];

/** True when the Opportunity has an Offensive Security delivery project allocated to this account. */
export async function offenseOnProject(db:D1DB,email:string,opportunityId:string){
 return !!await db.prepare(`SELECT p.id FROM rticore_delivery_projects p WHERE p.tenant_id=? AND p.opportunity_id=? AND ${OFFENSE_PROJECT_SCOPE()}`)
  .bind(TENANT,opportunityId,...offenseScopeArgs(email)).first();
}
/** Same check by delivery project id (timesheets). */
export async function offenseOnProjectId(db:D1DB,email:string,projectId:string){
 return !!await db.prepare(`SELECT p.id FROM rticore_delivery_projects p WHERE p.tenant_id=? AND p.id=? AND ${OFFENSE_PROJECT_SCOPE()}`)
  .bind(TENANT,projectId,...offenseScopeArgs(email)).first();
}

type DealRow={id:string;title:string;stage:string;flow_version:number;company_name:string;data_json?:string};
/**
 * Project selector for Offense Team pages. Member: allocated Offensive delivery projects.
 * Leader: the same, plus open Offensive Security Opportunities for read-only Feasibility.
 * scope tells the UI which workspace each entry belongs to.
 */
export async function offenseDeals(db:D1DB,email:string,role:OffenseRole){
 const delivery=await db.prepare(`SELECT d.id,d.title,d.stage,d.flow_version,a.legal_name AS company_name FROM rticore_delivery_projects p JOIN rticore_sales_opportunities d ON d.id=p.opportunity_id AND d.tenant_id=p.tenant_id JOIN rticore_sales_accounts a ON a.id=d.company_id AND a.tenant_id=d.tenant_id WHERE p.tenant_id=? AND ${OFFENSE_PROJECT_SCOPE()} ORDER BY p.created_at DESC LIMIT 250`)
  .bind(TENANT,...offenseScopeArgs(email)).all<DealRow>();
 const rows=delivery.results.map(x=>({...x,scope:'delivery' as const}));
 if(role!=='offense_lead')return rows;
 const planning=await db.prepare(`SELECT d.id,d.title,d.stage,d.flow_version,a.legal_name AS company_name FROM rticore_sales_opportunities d JOIN rticore_sales_accounts a ON a.id=d.company_id AND a.tenant_id=d.tenant_id WHERE d.tenant_id=? AND d.stage NOT IN ('closed_won','closed_lost') AND json_extract(d.data_json,'$.service_family') IN ${families()} ORDER BY d.created_at DESC LIMIT 250`)
  .bind(TENANT,...OFFENSE_FAMILIES).all<DealRow>();
 const seen=new Set(rows.map(x=>x.id));
 return [...rows,...planning.results.filter(x=>!seen.has(x.id)).map(x=>({...x,scope:'feasibility' as const}))];
}
/** Leader reads Feasibility only for open Offensive Security Opportunities. */
export function offenseFeasibilityAllowed(role:string,deal:{stage:string;data_json:string}){
 if(role!=='offense_lead')return false;
 let family='';try{family=String((JSON.parse(deal.data_json||'{}') as Record<string,unknown>).service_family||'');}catch{family='';}
 return isOffenseFamily(family)&&deal.stage!=='closed_lost';
}
