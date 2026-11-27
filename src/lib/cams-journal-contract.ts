import { createHash, timingSafeEqual } from 'node:crypto';

export type JournalLine = {accountCode:string;costCenterId:string|null;debitAmount:string;creditAmount:string};
export type JournalEnvelope = {schemaVersion:'cams-journal/1';sourceSystem:'CAMSRTI';tenantId:string;journalId:string;idempotencyKey:string;period:string;currency:'IDR';sourceType:string;journalNumber:string;lines:JournalLine[];totalDebit:string;totalCredit:string};
export class DockingError extends Error {code:string;status:number;constructor(code:string,status=422){super(code);this.code=code;this.status=status;}}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const obj=(x:unknown):Record<string,unknown>=>{if(!x||typeof x!=='object'||Array.isArray(x))throw new DockingError('INVALID_OBJECT');return x as Record<string,unknown>;};
const str=(x:unknown,re:RegExp):string=>{if(typeof x!=='string'||!re.test(x))throw new DockingError('INVALID_FIELD');return x;};
export function minorUnits(x:unknown):bigint {const s=str(x,/^(0|[1-9][0-9]{0,12})\.[0-9]{2}$/);return BigInt(s.replace('.',''));}
export function journalEnvelope(x:unknown):JournalEnvelope {
 const a=obj(x);if(a.schemaVersion!=='cams-journal/1'||a.sourceSystem!=='CAMSRTI'||a.currency!=='IDR')throw new DockingError('INVALID_CONTRACT');
 const tenantId=str(a.tenantId,uuid),journalId=str(a.journalId,uuid),idempotencyKey=str(a.idempotencyKey,/^OUTBOX-JRN-[0-9a-f-]{36}$/i);
 if(idempotencyKey!=='OUTBOX-JRN-'+journalId)throw new DockingError('INVALID_IDEMPOTENCY');
 if(!Array.isArray(a.lines)||a.lines.length<2||a.lines.length>200)throw new DockingError('INVALID_LINES');
 let d=0n,c=0n;
 const lines=a.lines.map(raw=>{const l=obj(raw),debitAmount=str(l.debitAmount,/^(0|[1-9][0-9]{0,12})\.[0-9]{2}$/),creditAmount=str(l.creditAmount,/^(0|[1-9][0-9]{0,12})\.[0-9]{2}$/);const dl=minorUnits(debitAmount),cl=minorUnits(creditAmount);if((dl>0n)===(cl>0n))throw new DockingError('INVALID_LINE_SIDES');d+=dl;c+=cl;return {accountCode:str(l.accountCode,/^[A-Za-z0-9_.-]{1,32}$/),costCenterId:l.costCenterId===null?null:str(l.costCenterId,uuid),debitAmount,creditAmount};});
 if(d!==c||d<=0n||d>=900000000000000n||d!==minorUnits(a.totalDebit)||c!==minorUnits(a.totalCredit))throw new DockingError('UNBALANCED_JOURNAL');
 return {schemaVersion:'cams-journal/1',sourceSystem:'CAMSRTI',tenantId,journalId,idempotencyKey,period:str(a.period,/^20[0-9]{2}-(0[1-9]|1[0-2])$/),currency:'IDR',sourceType:str(a.sourceType,/^[A-Za-z0-9_.-]{1,64}$/),journalNumber:str(a.journalNumber,/^[A-Za-z0-9_.-]{1,64}$/),lines,totalDebit:String(a.totalDebit),totalCredit:String(a.totalCredit)};
}
export function envelopeHash(e:JournalEnvelope){return createHash('sha256').update(JSON.stringify(e)).digest('hex');}
export function validToken(received:string|null,secret:string|undefined){if(!secret||secret.length<32||!received?.startsWith('Bearer '))return false;const a=createHash('sha256').update(received.slice(7)).digest(),b=createHash('sha256').update(secret).digest();return timingSafeEqual(a,b);}
export function lineSignature(lines:{accountId:string;debit:string;credit:string;costCenterId?:string|null}[]){return JSON.stringify(lines.map(l=>[l.accountId,l.costCenterId??null,BigInt(l.debit).toString(),BigInt(l.credit).toString()]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));}

// Historical posted rows without independent lifecycle evidence are not reconciled.
export function independentPostingEvidence(j:{created_by:string;reviewed_by:string|null;posted_by:string|null;reviewed_at:string|null;posted_at:string|null},w:{lifecycle_stage:string;submitted_by:string|null;checked_by:string|null;approved_by:string|null;posted_by:string|null;checked_at:string|null;approved_at:string|null;posted_at:string|null}|null|undefined){
 const norm=(v:string|null|undefined)=>v?.trim().toLowerCase()||'';
 const maker=norm(j.created_by),checker=norm(j.reviewed_by),poster=norm(j.posted_by);
 return !!(maker&&checker&&poster&&new Set([maker,checker,poster]).size===3&&j.reviewed_at&&j.posted_at&&w?.lifecycle_stage==='posted'&&norm(w.submitted_by)===maker&&norm(w.checked_by)===checker&&norm(w.approved_by)===checker&&norm(w.posted_by)===poster&&w.checked_at&&w.approved_at&&w.posted_at);
}
