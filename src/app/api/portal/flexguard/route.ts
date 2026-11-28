import {getRuntimeEnv} from '@/lib/runtime-env';
import type {D1DB} from '@/lib/boq-auth';
import {erpAssert,erpReply,erpError,erpId,erpText} from '@/lib/erp-core';
import {readBoundedJSON} from '@/lib/bounded-json';
import {nativeRequestOriginAllowed} from '@/lib/native-session';
import {portalEnabled,portalKey,portalSession} from '@/lib/flexguard-portal-auth';
import {TENANT} from '@/lib/sales-workflow';
export const dynamic='force-dynamic';
async function identity(req:Request){
 erpAssert(portalEnabled(),'Portal belum diaktifkan',503);portalKey();
 const {RTICORE_DB:db}=await getRuntimeEnv<{RTICORE_DB:D1DB}>();
 const email=await portalSession(db,req);erpAssert(email,'Portal MFA diperlukan',401);
 return {db,email};
}
async function scope(db:D1DB,email:string,entity:string,wallet:string){
 const g=await db.prepare('SELECT rticore_native_fg_portal_allowed(?,?,?,?) AS allowed').bind(TENANT,entity,wallet,email).first<{allowed:boolean}>();
 erpAssert(g?.allowed===true,'Akses wallet ditolak',403);
}
export async function GET(req:Request){
 try{
 const {db,email}=await identity(req);const u=new URL(req.url);const entity=u.searchParams.get('legal_entity_id'),wallet=u.searchParams.get('wallet_id');
 if(!entity&&!wallet){
  const rows=await db.prepare("SELECT g.legal_entity_id,g.wallet_id,w.contract_id,a.legal_name FROM rticore_native_fg_portal_grant g JOIN rticore_flexguard_wallets w ON w.tenant_id=g.tenant_id AND w.id=g.wallet_id JOIN rticore_sales_accounts a ON a.tenant_id=w.tenant_id AND a.id=w.customer_id WHERE g.tenant_id=? AND g.email=? AND g.status='approved' AND rticore_native_fg_portal_allowed(g.tenant_id,g.legal_entity_id,g.wallet_id,g.email) ORDER BY g.wallet_id LIMIT 100").bind(TENANT,email).all();
  return erpReply({success:true,wallets:rows.results});
 }
 erpAssert(erpId(entity)&&erpId(wallet),'Wallet wajib');await scope(db,email,entity,wallet);
 const lots=await db.prepare("SELECT l.id,l.expires_at,coalesce((SELECT sum(e.available_delta) FROM rticore_flexguard_enterprise_ledger e WHERE e.tenant_id=l.tenant_id AND e.legal_entity_id=l.legal_entity_id AND e.lot_id=l.id),0) AS available,coalesce((SELECT sum(e.reserved_delta) FROM rticore_flexguard_enterprise_ledger e WHERE e.tenant_id=l.tenant_id AND e.legal_entity_id=l.legal_entity_id AND e.lot_id=l.id),0) AS reserved FROM rticore_flexguard_credit_lots l WHERE l.tenant_id=? AND l.legal_entity_id=? AND l.wallet_id=? ORDER BY l.expires_at,l.id LIMIT 201").bind(TENANT,entity,wallet).all();
 const requests=await db.prepare('SELECT id,request_code,title,scope_summary,status,version,quoted_credits FROM rticore_native_fg_service_request WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? ORDER BY created_at DESC,id LIMIT 201').bind(TENANT,entity,wallet).all();
 const submissions=await db.prepare('SELECT id,kind,request_id,request_version,notes,recorded_at FROM rticore_native_fg_portal_submission WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? AND email=? ORDER BY recorded_at DESC LIMIT 201').bind(TENANT,entity,wallet,email).all();
 return erpReply({success:true,lots:lots.results.slice(0,200),requests:requests.results.slice(0,200),submissions:submissions.results.slice(0,200),truncated:[lots,requests,submissions].some(x=>x.results.length>200),automatic_posting:false});
 }catch(e){return erpError(e);}
}
export async function POST(req:Request){
 try{
 erpAssert(nativeRequestOriginAllowed(req,process.env.RTICORE_PUBLIC_ORIGIN||''),'Origin ditolak',403);
 const {db,email}=await identity(req);const v=await readBoundedJSON(req,4000) as Record<string,unknown>;
 erpAssert(erpId(v.legal_entity_id)&&erpId(v.wallet_id)&&erpText(v.notes,12,1000)&&erpText(v.idempotency_key,16,128),'Data tidak valid');
 erpAssert(typeof v.kind==='string'&&['service_request','quote_acceptance','delivery_acceptance'].includes(v.kind),'Action tidak valid');
 const service=v.kind==='service_request';erpAssert(service||(erpId(v.request_id)&&typeof v.request_version==='number'&&Number.isSafeInteger(v.request_version)&&v.request_version>0),'Request version wajib');
 await scope(db,email,v.legal_entity_id,v.wallet_id);
 const id=crypto.randomUUID();
 // INSERT is scoped again by a database trigger; no ledger or service status mutation.
 await db.prepare('INSERT INTO rticore_native_fg_portal_submission(id,tenant_id,legal_entity_id,wallet_id,email,kind,request_id,request_version,notes,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,TENANT,v.legal_entity_id,v.wallet_id,email,v.kind,service?null:String(v.request_id),service?null:Number(v.request_version),v.notes.trim(),v.idempotency_key).run();
 return erpReply({success:true,id,automatic_posting:false,internal_review_required:true},201);
 }catch(e){return erpError(e);}
}
