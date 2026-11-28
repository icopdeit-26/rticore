import {authorizeBoQ} from '@/lib/boq-auth';
import {TENANT} from '@/lib/sales-workflow';
import {erpAssert,erpError,erpId,erpReply} from '@/lib/erp-core';
export const dynamic='force-dynamic';
export const runtime='nodejs';
// Read the canonical frozen calculation; never recalculate or mutate a snapshot here.
export async function GET(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{
  erpAssert(process.env.RTICORE_RUNTIME==='hostinger'&&process.env.RTICORE_SERVICE_CATALOG_ENABLED==='1','Pricing release gate belum aktif',503);
  const {db,email,role,rolePreview}=a.identity;
  erpAssert(!rolePreview&&['finance','approver'].includes(role),'Akses ditolak',403);
  const q=new URL(req.url).searchParams,entity=q.get('legal_entity_id'),id=q.get('snapshot_id');
  erpAssert(q.getAll('legal_entity_id').length===1&&q.getAll('snapshot_id').length===1&&[...q.keys()].every(k=>['legal_entity_id','snapshot_id'].includes(k))&&erpId(entity)&&erpId(id),'Entity dan snapshot wajib');
  const row=await db.prepare(`SELECT s.id,s.status,s.calculation,s.calculation_sha256,
   s.calculation_sha256=encode(sha256(convert_to(s.calculation::text,'UTF8')),'hex') AS digest_valid
   FROM rticore_catalog_pricing_snapshots s WHERE s.tenant_id=? AND s.legal_entity_id=? AND s.id=?
   AND rticore_fg_actor_role(s.tenant_id,s.legal_entity_id,?)=?
   AND (rticore_catalog_finance_access(s.tenant_id,s.legal_entity_id,?,'make') OR rticore_catalog_finance_access(s.tenant_id,s.legal_entity_id,?,'approve'))`).bind(TENANT,entity,id,email,role,email,email).first<Record<string,unknown>>();
  erpAssert(row,'Snapshot tidak tersedia dalam scope',403);
  erpAssert(row.digest_valid===true&&typeof row.calculation_sha256==='string'&&/^[a-f0-9]{64}$/.test(row.calculation_sha256),'Integritas snapshot gagal',409);
  return erpReply({success:true,legal_entity_id:entity,snapshot_id:id,status:row.status,calculation:row.calculation,calculation_sha256:row.calculation_sha256,read_only:true,automatic_posting:false});
 }catch(e){return erpError(e);}
}
