import { randomUUID } from 'node:crypto';
import { getLocalPostgresDB } from '@/lib/postgres-db';
import { TENANT } from '@/lib/sales-workflow';
import { readBoundedJSON, RequestBodyError } from '@/lib/bounded-json';
import { DockingError, journalEnvelope,envelopeHash,minorUnits,validToken,lineSignature } from '@/lib/cams-journal-contract';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type MappedLine={accountId:string;debit:string;credit:string;costCenterId?:string|null};
type Receipt={id:string;source_tenant_id:string;source_journal_id:string;idempotency_key:string;payload_hash:string;legal_entity_id:string;period_code:string;mapped_lines_json:MappedLine[]|string};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function context(req:Request){
 if(process.env.CAMS_FINANCE_DOCKING_ENABLED!=='true'||!((process.env.RTICORE_RUNTIME==='hostinger'&&process.env.RTICORE_LOCAL_MODE==='0'&&process.env.RTICORE_DB_ENGINE!=='sqlite')||(process.env.NODE_ENV!=='production'&&process.env.RTICORE_LOCAL_MODE==='1'))||!process.env.DATABASE_URL||process.env.RTICORE_DB_ENGINE==='sqlite')throw new DockingError('DOCKING_DISABLED',503);
 if(!validToken(req.headers.get('authorization'),process.env.CAMS_FINANCE_SERVICE_TOKEN))throw new DockingError('UNAUTHORIZED',401);
 const source=process.env.CAMS_FINANCE_SOURCE_TENANT_ID,entity=process.env.CAMS_FINANCE_LEGAL_ENTITY_ID;
 if(!source||!entity||!process.env.CAMS_FINANCE_COA_MAP_JSON)throw new DockingError('MAPPING_NOT_CONFIGURED',503);
 let map:Record<string,unknown>;
 try{map=JSON.parse(process.env.CAMS_FINANCE_COA_MAP_JSON);if(!map||typeof map!=='object'||Array.isArray(map))throw Error();}catch{throw new DockingError('MAPPING_NOT_CONFIGURED',503);}
 let costMap:Record<string,unknown>={};
 try{costMap=JSON.parse(process.env.CAMS_FINANCE_COST_CENTER_MAP_JSON||'{}');if(!costMap||typeof costMap!=='object'||Array.isArray(costMap))throw Error();}catch{throw new DockingError('COST_CENTER_MAPPING_INVALID',503);}
 return {db:getLocalPostgresDB(),source,entity,map,costMap};
}
function err(e:unknown){return e instanceof DockingError?reply({ok:false,code:e.code},e.status):e instanceof RequestBodyError?reply({ok:false,code:'INVALID_BODY'},e.status):reply({ok:false,code:'DOCKING_UNAVAILABLE'},503);}
function receipt(r:Receipt,status='received',remoteJournalId:string|null=null){return {ok:true,receiptId:r.id,tenantId:r.source_tenant_id,journalId:r.source_journal_id,idempotencyKey:r.idempotency_key,payloadHash:r.payload_hash,status,remoteJournalId};}
async function load(db:ReturnType<typeof getLocalPostgresDB>,key:string){return db.prepare('SELECT * FROM rticore_cams_finance_inbox WHERE idempotency_key=?').bind(key).first<Receipt>();}
async function draftReceipt(db:ReturnType<typeof getLocalPostgresDB>,r:Receipt){
 const row=await db.prepare('SELECT cams_create_finance_draft(?) AS journal_id').bind(r.id).first<{journal_id:string}>();
 if(!row?.journal_id)throw new DockingError('DRAFT_CREATION_UNAVAILABLE',503);
 return receipt(r,'pending_review',row.journal_id);
}
export async function POST(req:Request){
 try{
  const {db,source,entity,map,costMap}=context(req);const e=journalEnvelope(await readBoundedJSON(req,128000));
  if(e.tenantId!==source)throw new DockingError('TENANT_MISMATCH',403);
  const hash=envelopeHash(e),prior=await load(db,e.idempotencyKey);
  if(prior){if(prior.source_tenant_id!==source||prior.legal_entity_id!==entity||prior.payload_hash!==hash)throw new DockingError('IDEMPOTENCY_CONFLICT',409);return reply(await draftReceipt(db,prior));}
  const legal=await db.prepare("SELECT id FROM rticore_erp_org_units WHERE tenant_id=? AND id=? AND kind='legal_entity' AND active=1").bind(TENANT,entity).first();if(!legal)throw new DockingError('LEGAL_ENTITY_INVALID',409);
  const period=await db.prepare("SELECT p.id FROM rticore_gl_periods p WHERE p.tenant_id=? AND p.legal_entity_id=? AND p.period=? AND p.status='open' AND NOT EXISTS(SELECT 1 FROM rticore_finance_period_controls c WHERE c.tenant_id=p.tenant_id AND c.period_id=p.id AND c.close_stage<>'open')").bind(TENANT,entity,e.period).first();if(!period)throw new DockingError('PERIOD_NOT_OPEN',409);
  const mapped:MappedLine[]=[];
  for(const line of e.lines){
   let costCenterId:string|null=null;
   if(line.costCenterId!==null){
    const target=Object.prototype.hasOwnProperty.call(costMap,line.costCenterId)?costMap[line.costCenterId]:undefined;
    if(typeof target!=='string'||!target)throw new DockingError('COST_CENTER_MAPPING_REQUIRED',409);
    const cc=await db.prepare("WITH RECURSIVE scope AS (SELECT id,parent_id,kind,active FROM rticore_erp_org_units WHERE tenant_id=? AND id=? UNION SELECT u.id,u.parent_id,u.kind,u.active FROM rticore_erp_org_units u JOIN scope s ON u.parent_id=s.id WHERE u.tenant_id=? AND u.active=1) SELECT id FROM scope WHERE id=? AND kind='legal_entity' AND active=1 AND EXISTS(SELECT 1 FROM scope WHERE id=? AND kind='cost_center' AND active=1)").bind(TENANT,entity,TENANT,entity,target).first();
    if(!cc)throw new DockingError('COST_CENTER_SCOPE_INVALID',409);
    costCenterId=target;
   }
   const code=Object.prototype.hasOwnProperty.call(map,line.accountCode)?map[line.accountCode]:undefined;
   if(typeof code!=='string'||!code)throw new DockingError('COA_MAPPING_REQUIRED',409);
   const a=await db.prepare("SELECT a.id FROM rticore_gl_accounts a WHERE a.tenant_id=? AND a.legal_entity_id=? AND a.code=? AND a.active=1 AND NOT EXISTS(SELECT 1 FROM rticore_finance_coa_hierarchy h WHERE h.tenant_id=a.tenant_id AND h.legal_entity_id=a.legal_entity_id AND h.account_id=a.id AND h.is_header=1)").bind(TENANT,entity,code).first<{id:string}>();
   if(!a)throw new DockingError('COA_MAPPING_INVALID',409);
   mapped.push({accountId:a.id,costCenterId,debit:minorUnits(line.debitAmount).toString(),credit:minorUnits(line.creditAmount).toString()});
  }
  await db.prepare('INSERT INTO rticore_cams_finance_inbox(id,source_tenant_id,source_journal_id,idempotency_key,payload_hash,legal_entity_id,period_code,payload_json,mapped_lines_json) VALUES(?,?,?,?,?,?,?,CAST(? AS jsonb),CAST(? AS jsonb)) ON CONFLICT DO NOTHING').bind(randomUUID(),source,e.journalId,e.idempotencyKey,hash,entity,e.period,JSON.stringify(e),JSON.stringify(mapped)).run();
  const saved=await load(db,e.idempotencyKey);if(!saved||saved.source_tenant_id!==source||saved.legal_entity_id!==entity||saved.payload_hash!==hash)throw new DockingError('IDEMPOTENCY_CONFLICT',409);
  return reply(await draftReceipt(db,saved),201);
 }catch(e){return err(e);}
}
export async function GET(req:Request){
 try{const {db,source,entity}=context(req);const key=new URL(req.url).searchParams.get('idempotencyKey');if(!key||!/^OUTBOX-JRN-[0-9a-f-]{36}$/i.test(key))throw new DockingError('INVALID_IDEMPOTENCY');
 const r=await load(db,key);if(!r||r.source_tenant_id!==source||r.legal_entity_id!==entity)throw new DockingError('RECEIPT_NOT_FOUND',404);
 const j=await db.prepare("SELECT j.id,j.status,p.period FROM rticore_gl_journals j JOIN rticore_gl_periods p ON p.tenant_id=j.tenant_id AND p.id=j.period_id WHERE j.tenant_id=? AND j.legal_entity_id=? AND j.source_type='camsrti' AND j.source_key=?").bind(TENANT,r.legal_entity_id,key).first<{id:string;status:string;period:string}>();
 if(!j)return reply(receipt(r));if(j.status!=='posted')return reply(receipt(r,j.status==='rejected'?'rejected':'pending_review',j.id));
 const lines=await db.prepare('SELECT l.account_id,l.debit_cents,l.credit_cents,d.cost_center_id FROM rticore_gl_lines l LEFT JOIN rticore_finance_journal_dimensions d ON d.tenant_id=l.tenant_id AND d.line_id=l.id WHERE l.tenant_id=? AND l.journal_id=?').bind(TENANT,j.id).all<{account_id:string;debit_cents:string|number;credit_cents:string|number;cost_center_id:string|null}>();
 const mapped=typeof r.mapped_lines_json==='string'?JSON.parse(r.mapped_lines_json) as MappedLine[]:r.mapped_lines_json;
 const w=await db.prepare('SELECT currency,exchange_rate_micro FROM rticore_finance_journal_workflows WHERE tenant_id=? AND journal_id=?').bind(TENANT,j.id).first<{currency:string;exchange_rate_micro:number|string}>();
 const matches=j.period===r.period_code&&w?.currency==='IDR'&&Number(w.exchange_rate_micro)===1000000&&lineSignature(mapped)===lineSignature(lines.results.map(l=>({accountId:l.account_id,costCenterId:l.cost_center_id,debit:String(l.debit_cents),credit:String(l.credit_cents)})));
 return reply(receipt(r,matches?'reconciled':'mismatch',j.id));
 }catch(e){return err(e);}
}
