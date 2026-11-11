/**
 * SOC Defense Team (Blue Team) roles: defense_leader (Leader) and defense_member (Member / SOC analyst).
 * Scope = ERP capability cyber_ops: an independently approved staff placement plus an approved
 * cyber_ops grant on the legal unit of an approved SOC/DFIR delivery project scope (migration 0049).
 * The role alone opens nothing: no CRM, BoQ, pricing, billing, approvals, reports or other ERP desks.
 */
import type {BoQIdentity,D1DB} from './boq-auth';
import {TENANT} from './sales-workflow';
import {erpGrant} from './erp-core';

export {DEFENSE_ROLES,isDefenseRole,defenseRouteAllowed,type DefenseRole} from './defense-routes';
/** Delivery service families handled by the SOC Defense Team (mirrors trigger rticore_cyber_case_scope). */
export const DEFENSE_FAMILIES:readonly string[]=['SOC/MDR','DFIR','Incident Response','Managed Security'];
/** Case kinds a Defense account may open; vapt_finding belongs to the Offense/VAPT team. */
export const DEFENSE_CASE_KINDS:readonly string[]=['soc_incident','dfir_incident'];

export const isLeader=(role:string)=>role==='defense_leader';

export type DefenseProject={id:string;opportunity_id:string;title:string;service_family:string;status:string;start_date:string|null;end_date:string|null;legal_entity_id:string;deal_title:string;stage:string;flow_version:number;company_name:string|null};
const familyList=DEFENSE_FAMILIES.map(()=>'?').join(',');
const PROJECT_SQL=`SELECT p.id,p.opportunity_id,p.title,p.service_family,p.status,p.start_date,p.end_date,s.legal_entity_id,
 d.title AS deal_title,d.stage,d.flow_version,a.legal_name AS company_name
 FROM rticore_delivery_projects p
 JOIN rticore_erp_project_scopes s ON s.project_id=p.id AND s.tenant_id=p.tenant_id AND s.status='approved'
 JOIN rticore_sales_opportunities d ON d.id=p.opportunity_id AND d.tenant_id=p.tenant_id
 LEFT JOIN rticore_sales_accounts a ON a.id=d.company_id AND a.tenant_id=d.tenant_id
 WHERE p.tenant_id=? AND p.service_family IN (${familyList})`;

/** True when the account holds an approved cyber_ops grant on the unit (or an ancestor). */
export async function hasCyberGrant(db:D1DB,email:string,unitId:string){
 try{await erpGrant({db,email:email.toLowerCase(),role:'defense_member',assignedRole:'defense_member',rolePreview:false} as BoQIdentity,'cyber_ops',unitId);return true;}
 catch{return false;}
}

/** SOC/DFIR delivery projects whose approved legal entity the account holds cyber_ops on. */
export async function defenseProjects(a:Pick<BoQIdentity,'db'|'email'>):Promise<DefenseProject[]>{
 const rows=await a.db.prepare(PROJECT_SQL+' ORDER BY p.created_at DESC LIMIT 250').bind(TENANT,...DEFENSE_FAMILIES).all<DefenseProject>();
 const units=new Map<string,boolean>();
 for(const r of rows.results)if(!units.has(r.legal_entity_id))units.set(r.legal_entity_id,await hasCyberGrant(a.db,a.email,r.legal_entity_id));
 return rows.results.filter(r=>units.get(r.legal_entity_id));
}

/** Defense scope for Opportunity-keyed APIs (Vault): the Opportunity's SOC/DFIR project is under the account's grant. */
export async function defenseOwnsOpportunity(db:D1DB,email:string,opportunityId:string){
 const row=await db.prepare(PROJECT_SQL+' AND p.opportunity_id=? LIMIT 1').bind(TENANT,...DEFENSE_FAMILIES,opportunityId).first<DefenseProject>();
 return !!row&&await hasCyberGrant(db,email,row.legal_entity_id);
}
