export type CloseStage = 'open'|'soft_close'|'under_review'|'approved'|'hard_close';
export type CloseState = { close_stage: CloseStage; completed_tasks_count: number; controller_reviewed_by: string|null; cfo_approved_by: string|null };
type Result = {ok:true;state:CloseState}|{ok:false;status:403|409|422;message:string};
export function nextFinanceClose(current:CloseState|null, requested:unknown, count:unknown, actor:string, role:string):Result{
 const fail=(status:403|409|422,message:string):Result=>({ok:false,status,message});
 if(!Number.isInteger(count)||Number(count)<0||Number(count)>17)return fail(422,'Jumlah checklist tidak valid');
 if(!actor.trim())return fail(403,'Identitas wajib');
 const stage=current?.close_stage||'open';
 const next=String(requested);
 const maker=role==='financial_controller';
 const cfo=role==='cfo';
 const n=Number(count);
 if(next==='soft_close'&&stage==='open'){
  if(!maker)return fail(403,'Soft close hanya Controller');
  return {ok:true,state:{close_stage:'soft_close',completed_tasks_count:n,controller_reviewed_by:null,cfo_approved_by:null}};
 }
 if(next==='under_review'&&(stage==='soft_close'||stage==='under_review')){
  if(!maker)return fail(403,'Review hanya Controller');
  return {ok:true,state:{close_stage:'under_review',completed_tasks_count:n,controller_reviewed_by:actor,cfo_approved_by:null}};
 }
 if(next==='approved'&&stage==='under_review'){
  if(!cfo||!current?.controller_reviewed_by||current.controller_reviewed_by.toLowerCase()===actor.toLowerCase())return fail(403,'CFO independen diperlukan');
  if(n!==17||current.completed_tasks_count!==17)return fail(422,'17 checklist harus selesai pada review Controller');
  return {ok:true,state:{...current,close_stage:'approved',cfo_approved_by:actor}};
 }
 if(next==='hard_close'&&stage==='approved'){
  if(!cfo||!current?.controller_reviewed_by||!current.cfo_approved_by||current.cfo_approved_by.toLowerCase()!==actor.toLowerCase()||current.controller_reviewed_by.toLowerCase()===actor.toLowerCase())return fail(403,'CFO yang menyetujui wajib melakukan lock');
  if(n!==17||current.completed_tasks_count!==17)return fail(422,'Checklist belum lengkap');
  return {ok:true,state:{...current,close_stage:'hard_close'}};
 }
 return fail(409,'Transisi periode tidak diizinkan');
}
