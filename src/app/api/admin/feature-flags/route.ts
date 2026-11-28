import {authorizeBoQ,type BoQIdentity} from '@/lib/boq-auth';
import {readBoundedJSON} from '@/lib/bounded-json';
import {TENANT} from '@/lib/sales-workflow';
import {erpAssert,erpError,erpId,erpOrigin,erpReply,erpText,erpAtom} from '@/lib/erp-core';
export const dynamic='force-dynamic';
async function scope(a:BoQIdentity,entity:string){
 erpAssert(!a.rolePreview&&['admin','approver'].includes(a.role),'Akses governance ditolak',403);
 const row=await a.db.prepare("SELECT u.id FROM rticore_erp_org_units u JOIN rticore_erp_staff_org s ON s.tenant_id=u.tenant_id AND s.unit_id=u.id JOIN rticore_members m ON lower(m.email)=lower(s.email) WHERE u.tenant_id=? AND u.id=? AND u.kind='legal_entity' AND u.active=1 AND s.status='approved' AND lower(s.email)=? AND m.active=1 AND m.role=?").bind(TENANT,entity,a.email.toLowerCase(),a.role).first();
 erpAssert(row,'Legal entity di luar scope',403);
}
export async function GET(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{erpAssert(process.env.RTICORE_RUNTIME==='hostinger','Native runtime required',503);
 const entity=new URL(req.url).searchParams.get('legal_entity_id');erpAssert(erpId(entity),'Legal entity wajib');
 await scope(a.identity,entity);
 const rows=await a.identity.db.prepare('SELECT * FROM rticore_feature_change_requests WHERE tenant_id=? AND legal_entity_id=? ORDER BY requested_at DESC,id LIMIT 100').bind(TENANT,entity).all();
 return erpReply({success:true,requests:rows.results,activation:false});
 }catch(e){return erpError(e);}
}
export async function POST(req:Request){
 const a=await authorizeBoQ(req);if(!a.ok)return a.response;
 try{erpAssert(process.env.RTICORE_RUNTIME==='hostinger','Native runtime required',503);erpOrigin(req);
 const v=await readBoundedJSON(req,8000) as Record<string,unknown>;const entity=v.legal_entity_id;erpAssert(erpId(entity),'Legal entity wajib');await scope(a.identity,entity);
 const {db,email,role}=a.identity;
 if(v.action==='request'){
 erpAssert(role==='admin','Admin maker required',403);
 erpAssert(typeof v.flag_key==='string'&&['service_catalog','flexguard_enterprise','flexguard_product'].includes(v.flag_key)&&typeof v.enabled==='boolean'&&erpText(v.reason,12,800),'Data request tidak valid');
 const id=crypto.randomUUID();
 await erpAtom(a.identity,'1=1',[],[db.prepare('INSERT INTO rticore_feature_change_requests(id,tenant_id,legal_entity_id,flag_key,requested_enabled,reason,requested_by) VALUES(?,?,?,?,CAST(? AS boolean),?,?)').bind(id,TENANT,entity,v.flag_key,String(v.enabled),v.reason.trim(),email)],'feature_governance',id,'FEATURE_REQUEST',{entity,flag_key:v.flag_key});
 return erpReply({success:true,id,status:'pending',activation:false},201);
 }
 if(v.action==='review'){
 erpAssert(role==='approver','Independent approver required',403);
 erpAssert(erpId(v.id)&&typeof v.approve==='boolean'&&erpText(v.notes,12,800),'Review tidak valid');
 await erpAtom(a.identity,"EXISTS(SELECT 1 FROM rticore_feature_change_requests WHERE tenant_id=? AND legal_entity_id=? AND id=? AND status='pending' AND lower(requested_by)<>?)",[TENANT,entity,v.id,email.toLowerCase()],[db.prepare("UPDATE rticore_feature_change_requests SET status=?,reviewed_by=?,reviewed_at=now(),review_notes=? WHERE tenant_id=? AND legal_entity_id=? AND id=?").bind(v.approve?'approved':'rejected',email,v.notes.trim(),TENANT,entity,v.id)],'feature_governance',v.id,'FEATURE_REVIEW',{entity,approved:v.approve});
 return erpReply({success:true,status:v.approve?'approved':'rejected',activation:false});
 }
 return erpReply({success:false,message:'Action tidak dikenal'},422);
 }catch(e){return erpError(e);}
}
