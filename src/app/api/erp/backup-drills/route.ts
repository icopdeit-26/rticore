import {authorizeBoQ} from '@/lib/boq-auth';
import {readBoundedJSON} from '@/lib/bounded-json';
import {TENANT} from '@/lib/sales-workflow';
import {erpAssert,erpError,erpId,erpReply,erpText,erpOrigin} from '@/lib/erp-core';
export const dynamic='force-dynamic';
const sha=(x:unknown,n:number):x is string=>typeof x==='string'&&x.length===n&&/^[a-f0-9]+$/.test(x);
const integer=(x:unknown,min:number,max:number):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=min&&x<=max;
const date=(x:unknown):x is string=>typeof x==='string'&&x.length<=32&&/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()=== (x.length===20?x.slice(0,-1)+'.000Z':x);
export async function GET(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{
  erpAssert(process.env.RTICORE_RUNTIME==='hostinger','Native runtime required',503);
  const {db,email,role,rolePreview}=a.identity;const q=new URL(req.url).searchParams,entity=q.get('legal_entity_id');
  erpAssert(q.getAll('legal_entity_id').length===1,'Legal entity wajib dan tidak ambigu');
  erpAssert(!rolePreview&&['admin','finance','approver'].includes(role)&&erpId(entity),'Akses drill ditolak',403);
  const grant=await db.prepare('SELECT rticore_fg_actor_role(?,?,?) AS role').bind(TENANT,entity,email).first<{role:string|null}>();
  erpAssert(grant?.role===role,'Legal entity di luar scope',403);
  const rows=await db.prepare('SELECT * FROM rticore_native_backup_drill WHERE tenant_id=? AND legal_entity_id=? ORDER BY requested_at DESC LIMIT 201').bind(TENANT,entity).all();
  erpAssert(rows.success,'Register backup drill tidak tersedia',503);
  return erpReply({success:true,drills:rows.results.slice(0,200),truncated:rows.results.length>200,production_certification:false});
 }catch(e){return erpError(e);}
}
export async function POST(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{
  erpAssert(process.env.RTICORE_RUNTIME==='hostinger','Native runtime required',503);erpOrigin(req);
  const {db,email,role,rolePreview}=a.identity;const v=await readBoundedJSON(req,8000) as Record<string,unknown>;const entity=v.legal_entity_id;
  erpAssert(!rolePreview&&['admin','approver'].includes(role)&&erpId(entity),'Akses drill ditolak',403);
  const grant=await db.prepare('SELECT rticore_fg_actor_role(?,?,?) AS role').bind(TENANT,entity,email).first<{role:string|null}>();
  erpAssert(grant?.role===role,'Legal entity di luar scope',403);
  if(v.action==='record'){
   erpAssert(role==='admin','Maker admin wajib',403);
   erpAssert((v.environment==='staging'||v.environment==='production')&&sha(v.source_sha,40)&&sha(v.evidence_sha256,64)&&sha(v.backup_sha256,64)&&date(v.backup_at)&&date(v.restore_completed_at)&&erpText(v.notes,12,800),'Evidence drill tidak valid');
   erpAssert(Date.parse(v.restore_completed_at)>=Date.parse(v.backup_at),'Urutan waktu backup dan restore tidak valid');
   erpAssert(integer(v.backup_bytes,1,Number.MAX_SAFE_INTEGER)&&integer(v.compared_tables,1,100000)&&integer(v.rto_seconds,0,2147483647)&&integer(v.rpo_seconds,0,2147483647)&&integer(v.rto_target_seconds,1,2147483647)&&integer(v.rpo_target_seconds,0,2147483647),'Ukuran atau waktu tidak valid');
   erpAssert(typeof v.row_match==='boolean'&&typeof v.privileges_verified==='boolean'&&typeof v.isolated_restore==='boolean','Hasil pemeriksaan wajib');
   const row=await db.prepare('INSERT INTO rticore_native_backup_drill(id,tenant_id,legal_entity_id,environment,source_sha,evidence_sha256,backup_sha256,backup_at,restore_completed_at,backup_bytes,compared_tables,rto_seconds,rpo_seconds,rto_target_seconds,rpo_target_seconds,row_match,privileges_verified,isolated_restore,requested_by,notes) VALUES(?,?,?,?,?,?,?,?::timestamptz,?::timestamptz,?,?,?,?,?,?,?::boolean,?::boolean,?::boolean,?,?) RETURNING id,status').bind(crypto.randomUUID(),TENANT,entity,v.environment,v.source_sha,v.evidence_sha256,v.backup_sha256,v.backup_at,v.restore_completed_at,v.backup_bytes,v.compared_tables,v.rto_seconds,v.rpo_seconds,v.rto_target_seconds,v.rpo_target_seconds,String(v.row_match),String(v.privileges_verified),String(v.isolated_restore),email,v.notes.trim()).first();
   erpAssert(row,'Drill tidak tersimpan',503);return erpReply({success:true,result:row,production_certification:false},201);
  }
  erpAssert(role==='approver'&&(v.action==='verified'||v.action==='rejected')&&erpId(v.id)&&sha(v.evidence_sha256,64)&&erpText(v.notes,12,800),'Review tidak valid',403);
  const row=await db.prepare("UPDATE rticore_native_backup_drill SET status=?,reviewed_by=?,review_notes=?,review_evidence_sha256=? WHERE tenant_id=? AND legal_entity_id=? AND id=? AND status='pending' RETURNING id,status").bind(v.action,email,v.notes.trim(),v.evidence_sha256,TENANT,entity,v.id).first();
  erpAssert(row,'Drill tidak tersedia',409);return erpReply({success:true,result:row,production_certification:false});
 }catch(e){return erpError(e);}
}
