import type {D1DB} from './boq-auth';
import {TENANT} from './sales-workflow';
/** One atomic write reserves outbound capacity, including failed provider calls.
 * No prompts, responses or credentials are retained. D1 serializes the INSERT.
 * Reservations are append-only so retries/concurrent requests cannot evade quota.
 */
export const RESERVE_AI_REQUEST_SQL=`INSERT INTO rticore_sales_ai_audit
 (id,tenant_id,opportunity_id,purpose,provider_id,model,actor_email)
 SELECT ?,?,NULL,?,'request','pending',?
 WHERE (SELECT count(*) FROM rticore_sales_ai_audit WHERE tenant_id=?
 AND actor_email=? AND provider_id='request' AND created_at>=datetime('now','-1 hour'))<20
 RETURNING id`;
export async function reserveAIRequest(db:D1DB,email:string,purpose:string){
 const id=crypto.randomUUID();
 if(typeof process!=='undefined'&&process.env.RTICORE_RUNTIME==='hostinger')return !!(await db.prepare('SELECT rticore_reserve_ai_request(?,?,?,?) AS allowed').bind(id,TENANT,email,purpose).first<{allowed:boolean|number}>())?.allowed;
 return !!await db.prepare(RESERVE_AI_REQUEST_SQL).bind(id,TENANT,purpose,email,TENANT,email).first<{id:string}>();
}
