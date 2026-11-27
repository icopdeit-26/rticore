/** SOC Defense Team role ids and API allow-list. Dependency-free: imported by boq-auth. */
export type DefenseRole='defense_leader'|'defense_member';
export const DEFENSE_ROLES:readonly DefenseRole[]=['defense_leader','defense_member'];
export const isDefenseRole=(role:string|null|undefined):role is DefenseRole=>role==='defense_leader'||role==='defense_member';
/**
 * APIs a Defense Team account may call at all (checked in authorizeBoQ before any handler), so
 * handlers written as deny-lists never widen Defense access. Each handler still authorizes object scope.
 */
const DEFENSE_API:readonly string[]=['/api/sales/identity','/api/sales/approval-queue','/api/sales','/api/erp/cyber-operations','/api/erp/security-integrations','/api/erp/cyber-delivery','/api/erp/cyber-grc-cti','/api/psa/timesheets','/api/sales/document-vault'];
export function defenseRouteAllowed(path:string,role:string):boolean{
 if(!isDefenseRole(role))return true;
 const p=path.replace(/\/+$/,'')||'/';
 return DEFENSE_API.includes(p);
}
