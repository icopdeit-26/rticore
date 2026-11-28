import {authorizeBoQ} from '@/lib/boq-auth';
import {readBoundedJSON} from '@/lib/bounded-json';
import {TENANT} from '@/lib/sales-workflow';
import {erpAssert,erpError,erpId,erpOrigin,erpReply,erpText} from '@/lib/erp-core';
export const dynamic='force-dynamic';
export const runtime='nodejs';
const enabled=()=>process.env.RTICORE_RUNTIME==='hostinger'&&process.env.RTICORE_HISTORICAL_REVIEW_ENABLED==='1';
export async function GET(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{
  erpAssert(enabled(),'Historical review release gate belum aktif',503);erpAssert(!a.identity.rolePreview&&['finance','approver'].includes(a.identity.role),'Akses ditolak',403);
  const query=new URL(req.url).searchParams,entity=query.get('legal_entity_id');
  erpAssert(query.getAll('legal_entity_id').length===1&&query.getAll('mode').length<=1&&[...query.keys()].every(k=>['legal_entity_id','mode'].includes(k))&&erpId(entity),'Scope historical review tidak valid');
  const mode=query.get('mode')??'allocation';
  erpAssert(['allocation','missing_outbox'].includes(mode),'Mode review tidak valid');
  if(mode==='missing_outbox'){
   const result=await a.identity.db.prepare('SELECT * FROM rticore_fg_missing_outbox_candidates(?,?,?) ORDER BY ledger_id LIMIT 201').bind(TENANT,entity,a.identity.email).all();
   erpAssert(result.success,'Register missing outbox tidak tersedia',503);
   return erpReply({success:true,legal_entity_id:entity,mode,candidates:result.results.slice(0,200),truncated:result.results.length>200,metadata_only:true,recovery_authorized:false});
  }
  const rows=await a.identity.db.prepare('SELECT * FROM rticore_fg_historical_allocation_candidates(?,?,?) ORDER BY lot_id LIMIT 201').bind(TENANT,entity,a.identity.email).all();
  erpAssert(rows.success,'Register historical allocation tidak tersedia',503);
  return erpReply({success:true,legal_entity_id:entity,mode,candidates:rows.results.slice(0,200),truncated:rows.results.length>200,metadata_only:true,recovery_authorized:false});
 }catch(e){if(String(e).includes('FLEXGUARD_ACCESS_DENIED'))return erpReply({success:false,message:'Akses ditolak'},403);return erpError(e);}
}
export async function POST(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{
  erpAssert(enabled(),'Historical review release gate belum aktif',503);erpAssert(!a.identity.rolePreview&&['finance','approver'].includes(a.identity.role),'Akses ditolak',403);
  erpAssert(req.headers.get('origin')===process.env.RTICORE_PUBLIC_ORIGIN,'Origin tidak diizinkan',403);erpOrigin(req);
  const v=await readBoundedJSON(req,4000) as Record<string,unknown>;
  erpAssert(erpId(v.legal_entity_id)&&erpId(v.lot_id)&&['submit','approve'].includes(String(v.action))&&typeof v.invoice_sha256==='string'&&/^[0-9a-f]{64}$/.test(v.invoice_sha256)&&erpText(v.notes,12,350)&&v.original_documents_reviewed===true,'Bukti dan konfirmasi review dokumen asli wajib');
  const r=await a.identity.db.prepare('SELECT rticore_fg_historical_allocation_review(?,?,?,?,?,?,?) AS result').bind(TENANT,v.legal_entity_id,a.identity.email,String(v.action),v.lot_id,v.invoice_sha256,v.notes).first<{result:unknown}>();
  erpAssert(r,'Review tidak tersedia',503);return erpReply({success:true,result:r.result},v.action==='submit'?201:200);
 }catch(e){if(/FLEXGUARD_(ACCESS_DENIED|APPROVAL_DENIED|SELF_APPROVAL|SCOPE_INVALID)/.test(String(e)))return erpReply({success:false,message:'Kewenangan review ditolak'},403);return erpError(e);}
}
