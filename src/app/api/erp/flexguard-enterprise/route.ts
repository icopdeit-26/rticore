import {authorizeBoQ} from '@/lib/boq-auth';
import {readBoundedJSON} from '@/lib/bounded-json';
import {TENANT} from '@/lib/sales-workflow';
import {erpAssert,erpError,erpId,erpOrigin,erpReply,erpText} from '@/lib/erp-core';
export const dynamic='force-dynamic';
function enabled(){return process.env.RTICORE_RUNTIME==='hostinger'&&process.env.RTICORE_FLEXGUARD_ENTERPRISE_ENABLED==='1';}
const nullableId=(v:unknown)=>v===undefined||v===null||v===''?null:erpId(v)?v:undefined;
export async function GET(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{
  erpAssert(enabled(),'FlexGuard Enterprise release gate belum diaktifkan',503);
  erpAssert(!a.identity.rolePreview,'Role preview ditolak',403);
  const {db,email,role}=a.identity;const u=new URL(req.url);const entity=u.searchParams.get('legal_entity_id'),wallet=u.searchParams.get('wallet_id');
  erpAssert(erpId(entity)&&erpId(wallet),'Legal entity dan wallet wajib');
  erpAssert(['finance','approver','admin'].includes(role),'Akses nilai moneter Finance ditolak',403);
  const allowed=await db.prepare("SELECT rticore_fg_actor_role(?,?,?) AS role").bind(TENANT,entity,email).first<{role:string|null}>();
  erpAssert(allowed?.role===role,'Akses legal entity ditolak',403);
  const scope=await db.prepare("SELECT w.id FROM rticore_flexguard_wallets w JOIN rticore_service_contracts c ON c.tenant_id=w.tenant_id AND c.id=w.contract_id JOIN rticore_erp_project_scopes p ON p.tenant_id=c.tenant_id AND p.project_id=c.project_id AND p.status='approved' WHERE w.tenant_id=? AND p.legal_entity_id=? AND w.id=?").bind(TENANT,entity,wallet).first();
  erpAssert(scope,'Wallet di luar scope',403);
  const [lots,ledger,requests]=await Promise.all([
   db.prepare("SELECT l.*,coalesce((SELECT sum(e.available_delta) FROM rticore_flexguard_enterprise_ledger e WHERE e.tenant_id=l.tenant_id AND e.lot_id=l.id),0) AS available,coalesce((SELECT sum(e.reserved_delta) FROM rticore_flexguard_enterprise_ledger e WHERE e.tenant_id=l.tenant_id AND e.lot_id=l.id),0) AS reserved FROM rticore_flexguard_credit_lots l WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? ORDER BY expires_at,id LIMIT 201").bind(TENANT,entity,wallet).all(),
   db.prepare("SELECT l.*,e.status AS docking_status FROM rticore_flexguard_enterprise_ledger l LEFT JOIN rticore_finance_integration_events e ON e.tenant_id=l.tenant_id AND e.id=l.finance_outbox_event_id WHERE l.tenant_id=? AND l.legal_entity_id=? AND l.wallet_id=? ORDER BY l.created_at DESC,l.id LIMIT 201").bind(TENANT,entity,wallet).all(),
   db.prepare("SELECT * FROM rticore_flexguard_requests WHERE tenant_id=? AND legal_entity_id=? AND wallet_id=? ORDER BY created_at DESC,id LIMIT 201").bind(TENANT,entity,wallet).all()
  ]);
  const legacy=await db.prepare("SELECT id FROM rticore_flexguard_events WHERE tenant_id=? AND wallet_id=? LIMIT 1").bind(TENANT,wallet).first();
  return erpReply({success:true,lots:lots.results.slice(0,200),ledger:ledger.results.slice(0,200),requests:requests.results.slice(0,200),truncated:[lots,ledger,requests].some(x=>x.results.length>200),legacy_reconciliation_required:!!legacy});
 }catch(e){return erpError(e);}
}
export async function POST(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{
  erpAssert(enabled(),'FlexGuard Enterprise release gate belum diaktifkan',503);
  erpAssert(!a.identity.rolePreview,'Role preview ditolak',403);erpOrigin(req);
  const v=await readBoundedJSON(req,8000) as Record<string,unknown>;
  const {db,email}=a.identity;erpAssert(erpId(v.legal_entity_id),'Legal entity wajib');
  if(v.action==='submit'){
   erpAssert(erpId(v.wallet_id)&&typeof v.transaction_type==='string'&&Number.isSafeInteger(v.credit_amount)&&erpText(v.idempotency_key,16,128)&&erpText(v.reason,12,1000),'Parameter transaksi tidak valid');
   const refs=[v.invoice_id,v.lot_id,v.source_tx_id,v.milestone_id].map(nullableId);erpAssert(refs.every(x=>x!==undefined),'Referensi tidak valid');
   const row=await db.prepare("SELECT rticore_fg_submit(?,?,?,?,?,CAST(? AS bigint),?,?,?,?,?,?) AS result").bind(TENANT,v.legal_entity_id,email,v.wallet_id,v.transaction_type,Number(v.credit_amount),refs[0]??null,refs[1]??null,refs[2]??null,refs[3]??null,v.idempotency_key,v.reason).first<{result:unknown}>();
   erpAssert(row,'Transaksi tidak tersedia',503);return erpReply({success:true,result:row.result},201);
  }
  if(v.action==='review'){
   erpAssert(erpId(v.request_id)&&typeof v.approve==='boolean'&&erpText(v.notes,12,1000),'Review tidak valid');
   const row=await db.prepare("SELECT rticore_fg_review(?,?,?,?,CAST(? AS boolean),?) AS result").bind(TENANT,v.legal_entity_id,email,v.request_id,v.approve?'true':'false',v.notes).first<{result:unknown}>();
   erpAssert(row,'Review tidak tersedia',503);return erpReply({success:true,result:row.result});
  }
  if(v.action==='dock'){
   erpAssert(erpId(v.event_id)&&['draft','link_purchase','ack'].includes(String(v.docking_action)),'Docking action tidak valid');
   const refs=[v.rule_id,v.period_id,v.journal_id].map(nullableId);erpAssert(refs.every(x=>x!==undefined),'Referensi tidak valid');
   const row=await db.prepare("SELECT rticore_fg_dock(?,?,?,?,?,?,?,?) AS result").bind(TENANT,v.legal_entity_id,email,v.event_id,String(v.docking_action),refs[0]??null,refs[1]??null,refs[2]??null).first<{result:unknown}>();
   erpAssert(row,'Finance docking tidak tersedia',503);return erpReply({success:true,result:row.result});
  }
  return erpReply({success:false,message:'Action tidak dikenal'},422);
 }catch(e){
  const m=String(e);if(/FLEXGUARD_(ACCESS_DENIED|APPROVAL_DENIED|SCOPE_INVALID|SELF_APPROVAL|APPROVAL_LIMIT)/.test(m))return erpReply({success:false,message:'Kewenangan FlexGuard ditolak'},403);
  if(/FLEXGUARD_/.test(m))return erpReply({success:false,message:'Transaksi ditolak oleh saldo, bukti, scope, idempotency atau status ledger'},409);
  return erpError(e);
 }
}
