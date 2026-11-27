// UI affordance only. The native command and database guards independently authorize every mutation.
type Assignment={finance_role:string;can_check:number|string;can_approve:number|string;can_post:number|string;approval_limit_cents:number|string};
type Receipt={journal_status:string|null;journal_version:number|null;created_by:string|null;reviewed_by:string|null;period_open:number|string|null;amount_cents:number|string|null};
export function camsReviewActions(input:{enabled:boolean;role:string;email:string;assignments:Assignment[];row:Receipt}):('approve'|'post')[]{
 const {enabled,role,email,assignments,row}=input;
 const actor=email.trim().toLowerCase(),maker=row.created_by?.trim().toLowerCase(),reviewer=row.reviewed_by?.trim().toLowerCase(),amount=Number(row.amount_cents);
 if(!enabled||!actor||!maker||actor===maker||Number(row.period_open)!==1||!Number.isSafeInteger(row.journal_version)||Number(row.journal_version)<1||!Number.isSafeInteger(amount)||amount<=0||amount>=900000000000000)return [];
 if(row.journal_status==='draft'&&['finance','approver'].includes(role)&&assignments.some(a=>['cfo','financial_controller','finance_manager'].includes(a.finance_role)&&Number(a.can_check)===1&&Number(a.can_approve)===1&&Number(a.approval_limit_cents)>=amount))return ['approve'];
 if(row.journal_status==='approved'&&role==='finance'&&reviewer&&actor!==reviewer&&assignments.some(a=>['financial_controller','finance_manager','accounting_officer'].includes(a.finance_role)&&Number(a.can_post)===1))return ['post'];
 return [];
}
