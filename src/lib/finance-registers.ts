import type { FinanceMenuId } from './rti-finance-core';

// Deliberately allowlist display fields: never export raw payloads, bank details,
// webhook hashes, payroll personal records, or other unrestricted object keys.
export const FINANCE_REGISTERS: Record<FinanceMenuId, readonly string[]> = {
  F01: [], F02: ['accounts','coaHierarchy','profitCenters','fxRates'],
  F03: ['trialBalance','journals','postingRules','periods'],
  F04: ['arInvoices','arPayments','arAdjustments'],
  F05: ['apInvoices','apExtensions','vendorBanks'],
  F06: ['arInvoices'], F07: ['treasuryAccounts','treasuryPayments','cashForecasts'],
  F08: ['bankStatements','reconciliations'], F09: ['obligations','revenueSchedules'],
  F10: ['projects','projectCosts','projectSnapshots'], F11: ['apInvoices'],
  F12: ['budgets'], F13: ['fpaScenarios','cashForecasts'], F14: ['expenseClaims'],
  F15: ['payrollBatches'], F16: ['taxRules','taxTransactions'],
  F17: ['fixedAssets'], F18: ['licenses'], F19: ['flexguardWallets','flexguardValuations'],
  F20: ['periods','periodControls','reconciliations'], F21: ['trialBalance','accounts'],
  F22: ['eliminations'], F23: ['icofrControls','exceptions','reconciliations'],
  F24: [], F25: ['dockingConnections','integrationMappings','integrationEvents','roleAssignments'],
};
type FinanceRecord = Record<string, unknown>;
export type RegisterRow = { reference:string; description:string; status:string; debit:string; credit:string };
function first(row:FinanceRecord, keys:readonly string[]):string {
  for(const key of keys) {
    const v=row[key];
    if(typeof v==='string' || typeof v==='number') return String(v);
  }
  return '';
}
export function registerRows(rows:readonly FinanceRecord[]):RegisterRow[] {
  return rows.map(row=>({
    reference:first(row,['code','id','rule_code','period_code','period','event_id']),
    description:first(row,['name','label','title','memo','category','project_title','account_group','event_type','control_code','operating_mode']),
    status:first(row,['status','category','close_stage','connection_status','control_mode','finance_role']),
    debit:first(row,['total_debit_cents','debit_cents','amount_cents','allocated_transaction_price_cents','current_approved_cents','recognized_to_date_cents','acquisition_cost_cents','actual_cost_cents']),
    credit:first(row,['total_credit_cents','credit_cents','actual_realized_cents','billed_to_date_cents']),
  }));
}
// RFC 4180 quoting and neutralization of spreadsheet formulas in untrusted text.
// Keep monetary integer strings intact; only text fields need formula protection.
function csvCell(value:string, protect:boolean):string {
  const safe=protect && /^[\s\u0000-\u001f]*[=+@-]/.test(value) ? "'"+value : value;
  return '"'+safe.replace(/"/g,'""')+'"';
}
export function registerCSV(rows:readonly RegisterRow[]):string {
  return ['Reference,Description,Status,Debit_or_Value_Cents,Credit_or_Realization_Cents',
    ...rows.map(r=>[csvCell(r.reference,true),csvCell(r.description,true),csvCell(r.status,true),
      csvCell(r.debit,!/^-?\d+$/.test(r.debit)),csvCell(r.credit,!/^-?\d+$/.test(r.credit))].join(','))].join('\r\n');
}
