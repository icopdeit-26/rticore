/** Role- and field-level guards for RTICORE's D1 Sales API. */
export type SalesRole='admin'|'marketing'|'sales'|'presales'|'finance'|'approver'|'legal'|'project_manager'|'offense_lead'|'offense_member'|'defense_leader'|'defense_member'|'governance_leader'|'governance_member'|'itdev_leader'|'itdev_member'|'viewer';
const sameEmail=(a:string|undefined|null,b:string|undefined|null)=>
 !!a && !!b && a.trim().toLowerCase()===b.trim().toLowerCase();
// Project Manager scope is the delivery project it is assigned to (pm_email), and Offense
// Team scope is the Offensive Security project it is allocated to, not Opportunity
// ownership. Deny by default here; delivery APIs grant it explicitly through
// pmOwnsProject()/offenseOnProject() so a forgotten role list never widens that access.
// SOC Defense Team (defense_*) scope is the SOC/DFIR project under its approved cyber_ops grant,
// granted explicitly through defenseOwnsOpportunity().
const projectScoped=(role:SalesRole)=>role==='project_manager'||role==='offense_lead'||role==='offense_member'||role==='defense_leader'||role==='defense_member'
 // Governance Team: GRC project allocation via governanceOnProject() (governance-team.ts).
 ||role==='governance_leader'||role==='governance_member'
 // IT Developer Team: Technology project allocation via itdevOnProject() (itdev-team.ts).
 ||role==='itdev_leader'||role==='itdev_member';
export const canReadDeal=(role:SalesRole,email:string,creator:string|null|undefined)=>
 !projectScoped(role)&&(role!=='sales'||sameEmail(email,creator));
// Customer roster follows the same ownership boundaries as Sales opportunities.
export const canReadAccount=(role:SalesRole,email:string,creator:string|null|undefined)=>
 !projectScoped(role)&&(role!=='sales'||sameEmail(email,creator));
export const canEditAccount=(role:SalesRole,email:string,creator:string|null|undefined)=>
 role==='admin'||(role==='sales'&&sameEmail(email,creator));
export const canChangeStage=(role:SalesRole,email:string,creator:string|null|undefined)=>
 role==='admin'||(role==='sales'&&sameEmail(email,creator));
export const PRESALES_FIELDS=new Set([
 'discovery_notes','technical_scope','technical_specifications','scope_quantity','service_level',
 'delivery_model','resourcing_model','deliverables','project_site','project_province',
 'project_postal','project_pic_name','project_pic_phone','project_pic_email',
 'implementation_timeline','contract_duration','license_or_sku','asset_profile',
 'methodology','exclusions','team_composition',
 // ICOP scoping estimator output (indication only; quotation price stays in approved BoQ).
 'scoping_product','scoping_params','scoping_estimate_md','scoping_estimate_base',
 'scoping_estimate_price','scoping_client_tier','scoping_model_version',
]);
export function canEditDeal(role:SalesRole,email:string,creator:string|null|undefined,fields:Record<string,string>,
 hasTitleOrValueChange:boolean):boolean{
 if(role==='admin')return true;
 if(role==='sales')return sameEmail(email,creator);
 if(role==='presales')return !hasTitleOrValueChange && Object.keys(fields).every(k=>PRESALES_FIELDS.has(k));
 return false;
}
