// Explicit staging-only HTTP acceptance, with a disposable preconfigured fixture.
import assert from 'node:assert/strict';
const env=process.env;
if(env.CAMS_E2E_CONFIRM!=='DISPOSABLE_STAGING_FIXTURE')throw new Error('Staging confirmation required');
function origin(key){const u=new URL(env[key]||'');if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!/(^|[.-])(staging|uat|test)([.-]|$)/i.test(u.hostname)||['rticore.store','cams.rtiinstitute.id'].includes(u.hostname))throw new Error('Explicit staging host required');return u;}
const cams=origin('CAMS_E2E_ORIGIN'),rti=origin('RTICORE_E2E_ORIGIN');
const outboxId=env.CAMS_E2E_OUTBOX_ID,entity=env.RTICORE_E2E_ENTITY_ID,key=env.CAMS_E2E_IDEMPOTENCY_KEY;
if(!outboxId||!entity||!key||!env.CAMS_E2E_COOKIE||!env.RTICORE_E2E_APPROVER_COOKIE||!env.RTICORE_E2E_SERVICE_TOKEN)throw new Error('Disposable staging fixture and credentials required');
async function call(base,path,headers,body){const res=await fetch(new URL(path,base),{method:body?'POST':'GET',headers:{...headers,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});const j=await res.json();assert(res.ok&&j.ok, 'HTTP '+res.status+' '+(j.code||j.error?.code||'request failed'));return j;}
const ch={Cookie:env.CAMS_E2E_COOKIE},rh={Cookie:env.RTICORE_E2E_APPROVER_COOKIE},sh={Authorization:'Bearer '+env.RTICORE_E2E_SERVICE_TOKEN};
const d=await call(cams,'/api/v1/integrations/rticore/dispatch',ch,{action:'dispatch',outboxId});
assert.equal(d.data.status,'acknowledged');
const received=await call(rti,'/api/finance/cams-docking?idempotencyKey='+encodeURIComponent(key),sh);
assert.equal(received.status,'pending_review');assert(received.remoteJournalId);
const list=await call(rti,'/api/finance/cams-inbox?legalEntityId='+encodeURIComponent(entity),rh);
const row=list.receipts.find(x=>x.receiptId===received.receiptId);assert(row);assert.equal(row.journalStatus,'draft');
const replay=await call(rti,'/api/finance/cams-docking',sh,row.sourceJournal);
assert.equal(replay.receiptId,received.receiptId);assert.equal(replay.remoteJournalId,received.remoteJournalId);
const approved=await call(rti,'/api/finance/cams-inbox',rh,{receiptId:row.receiptId,notes:'Staging test independent approval'});
assert.equal(approved.status,'posted');
const check=await call(cams,'/api/v1/integrations/rticore/dispatch',ch,{action:'reconcile',outboxId});
assert.equal(check.data.reconciliationStatus,'reconciled');assert.equal(check.data.remoteJournalId,received.remoteJournalId);
console.log('PASS disposable staging HTTP dispatch, draft, replay, independent approval and read-back reconciliation');
