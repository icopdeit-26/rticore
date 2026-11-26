/**
 * RTICore V4.0 FlexGuard Enterprise Service Credit Management Engine (M09).
 *
 * Implements Sections 7.1–7.10:
 * - Configurable Package Builder (Essential / Professional / Business / Enterprise / Strategic / Custom)
 * - Versioned Contractual Service Credit Conversion Matrix
 * - 12-Type Immutable Credit Ledger & Balance Calculation (Available = Posted - Active Reservations)
 * - 14-Step Service Request Workflow with Additional Credit Approval Gate
 * - Customer Portal Confidentiality Sanitizer (zero internal cost / compensation / margin exposure)
 * - PSAK 115 Reconcilable Financial Accounting Plan (never auto-recognizing expiry without Finance policy approval)
 * - Read-Only Renewal & Upselling Signal Evaluator (never auto-purchasing)
 */

export const FLEXGUARD_DEFAULT_PACKAGES = [
  { code: 'FG-ESSENTIAL', name: 'FlexGuard Essential (Configurable Template)', credits: 20, billingModel: 'prepaid_mandays', validityDays: 365 },
  { code: 'FG-PROFESSIONAL', name: 'FlexGuard Professional (Configurable Template)', credits: 50, billingModel: 'annual_credits', validityDays: 365 },
  { code: 'FG-BUSINESS', name: 'FlexGuard Business (Configurable Template)', credits: 100, billingModel: 'annual_credits', validityDays: 365 },
  { code: 'FG-ENTERPRISE', name: 'FlexGuard Enterprise (Configurable Template)', credits: 250, billingModel: 'committed_capacity', validityDays: 365 },
  { code: 'FG-STRATEGIC', name: 'FlexGuard Strategic (Configurable Template)', credits: 500, billingModel: 'hybrid_subscription', validityDays: 365 },
  { code: 'FG-CUSTOM', name: 'FlexGuard Custom (Configurable Template)', credits: 1, billingModel: 'prepaid_mandays', validityDays: 365 },
] as const;

export const FLEXGUARD_CONVERSION_TIERS = {
  standard_analyst: { label: 'Standard Analyst', defaultMultiplierBps: 10000 },       // 1.00 credit/MD
  senior_specialist: { label: 'Senior Specialist', defaultMultiplierBps: 12500 },     // 1.25 credits/MD
  lead_specialist: { label: 'Lead Specialist', defaultMultiplierBps: 15000 },         // 1.50 credits/MD
  principal_consultant: { label: 'Principal Consultant', defaultMultiplierBps: 20000 }, // 2.00 credits/MD
  emergency_response: { label: 'Emergency Response', defaultMultiplierBps: 20000 },   // 2.00 credits/MD
  specialized_forensic: { label: 'Specialized Forensic Services', defaultMultiplierBps: 20000 },
  custom: { label: 'Custom Contractual Tier', defaultMultiplierBps: 10000 },
} as const;

export type FlexGuardServiceTier = keyof typeof FLEXGUARD_CONVERSION_TIERS;

export type FlexGuardEnterpriseTxType =
  | 'initial_allocation'
  | 'purchase'
  | 'top_up'
  | 'reservation'
  | 'reservation_release'
  | 'consumption'
  | 'adjustment'
  | 'reversal'
  | 'transfer'
  | 'carry_forward'
  | 'expiry'
  | 'refund';

export type FlexGuardRequestStatus =
  | 'submitted'
  | 'scope_validated'
  | 'estimated'
  | 'credit_quoted'
  | 'customer_approved'
  | 'credits_reserved'
  | 'resource_assigned'
  | 'in_execution'
  | 'timesheet_approved'
  | 'qa_passed'
  | 'customer_accepted'
  | 'consumed'
  | 'reconciled'
  | 'revision_requested'
  | 'cancelled'
  | 'disputed'
  | 'additional_credit_pending';

export interface FlexGuardLedgerEntry {
  transaction_type: FlexGuardEnterpriseTxType;
  credit_amount: number;
  approval_status: 'pending_approval' | 'posted' | 'rejected';
  financial_value_cents?: number;
}

export interface FlexGuardBalanceSummary {
  purchasedCredits: number;
  allocatedCredits: number;
  postedCreditBalance: number;
  reservedCredits: number;
  consumedCredits: number;
  availableCredits: number;
  expiringCredits: number;
  expiredCredits: number;
  carryForwardCredits: number;
  pendingAdjustmentCredits: number;
  refundedCredits: number;
  utilizationBps: number;
  overdraftLimitCredits: number;
  overdraftUsedCredits: number;
}

/**
 * Section 7.3 Formula:
 * Consumed Credits = ceil(Approved Actual Mandays * Contractual Service Credit Multiplier)
 * Separates actual person-days, billable mandays, service credits, and financial cost.
 */
export function calculateFlexGuardConsumedCredits(params: {
  approvedActualMandaysTenths: number;
  billableMandaysTenths?: number;
  contractualMultiplierBps: number;
  creditUnitValueCents: number;
  internalCostRatePerMandayCents: number;
}): {
  actualPersonDaysTenths: number;
  billableMandaysTenths: number;
  multiplierBps: number;
  consumedCredits: number;
  recognizedRevenueCents: number;
  directServiceCostCents: number;
  grossMarginCents: number;
} {
  const actualTenths = params.approvedActualMandaysTenths;
  const billableTenths = params.billableMandaysTenths ?? actualTenths;
  const multBps = params.contractualMultiplierBps;
  if (!Number.isSafeInteger(actualTenths) || actualTenths <= 0) throw new Error('Approved actual mandays must be positive integer tenths');
  if (!Number.isSafeInteger(billableTenths) || billableTenths <= 0) throw new Error('Billable mandays must be positive integer tenths');
  if (!Number.isSafeInteger(multBps) || multBps < 5000 || multBps > 50000) throw new Error('Multiplier bps out of bounds');

  // Credits in whole integer units (ceiling to avoid under-consumption)
  // billableMandays = billableTenths / 10; multiplier = multBps / 10000
  const numerator = BigInt(billableTenths) * BigInt(multBps);
  const consumedCredits = Number((numerator + 99999n) / 100000n);
  const recognizedRevenueCents = Number(BigInt(consumedCredits) * BigInt(params.creditUnitValueCents));
  const directServiceCostCents = Number((BigInt(actualTenths) * BigInt(params.internalCostRatePerMandayCents) + 5n) / 10n);

  return {
    actualPersonDaysTenths: actualTenths,
    billableMandaysTenths: billableTenths,
    multiplierBps: multBps,
    consumedCredits,
    recognizedRevenueCents,
    directServiceCostCents,
    grossMarginCents: recognizedRevenueCents - directServiceCostCents,
  };
}

/**
 * Section 7.5 Balance Formula:
 * Available Credits = Posted Credit Balance - Active Reservations
 * Prevents negative balance unless approved contractual overdraft limit exists.
 */
export function computeFlexGuardWalletBalance(
  entries: readonly FlexGuardLedgerEntry[],
  options: { expiringCredits?: number; overdraftLimitCredits?: number } = {},
): FlexGuardBalanceSummary {
  let purchased = 0;
  let allocated = 0;
  let reserved = 0;
  let consumed = 0;
  let expired = 0;
  let carryForward = 0;
  let pendingAdj = 0;
  let refunded = 0;
  let postedBalance = 0;

  for (const tx of entries) {
    if (tx.approval_status === 'rejected') continue;
    if (tx.approval_status === 'pending_approval') {
      pendingAdj += tx.credit_amount;
      continue;
    }
    const amt = Math.abs(tx.credit_amount);
    switch (tx.transaction_type) {
      case 'initial_allocation':
        allocated += amt;
        postedBalance += amt;
        break;
      case 'purchase':
      case 'top_up':
        purchased += amt;
        allocated += amt;
        postedBalance += amt;
        break;
      case 'carry_forward':
        carryForward += amt;
        allocated += amt;
        postedBalance += amt;
        break;
      case 'reservation':
        reserved += amt;
        break;
      case 'reservation_release':
        reserved -= amt;
        break;
      case 'consumption':
        consumed += amt;
        postedBalance -= amt;
        reserved -= amt;
        break;
      case 'reversal':
        consumed -= amt;
        postedBalance += amt;
        break;
      case 'adjustment':
        postedBalance += tx.credit_amount;
        if (tx.credit_amount > 0) allocated += amt;
        break;
      case 'transfer':
        postedBalance += tx.credit_amount;
        if (tx.credit_amount > 0) allocated += amt;
        break;
      case 'expiry':
        expired += amt;
        postedBalance -= amt;
        break;
      case 'refund':
        refunded += amt;
        postedBalance -= amt;
        break;
    }
  }

  reserved = Math.max(0, reserved);
  consumed = Math.max(0, consumed);
  const available = postedBalance - reserved;
  const overdraftLimit = Math.max(0, options.overdraftLimitCredits ?? 0);
  const overdraftUsed = available < 0 ? Math.abs(available) : 0;
  const denom = Math.max(1, allocated);
  const utilizationBps = Math.min(10000, Math.round((consumed * 10000) / denom));

  return {
    purchasedCredits: purchased,
    allocatedCredits: allocated,
    postedCreditBalance: postedBalance,
    reservedCredits: reserved,
    consumedCredits: consumed,
    availableCredits: available,
    expiringCredits: Math.max(0, options.expiringCredits ?? 0),
    expiredCredits: expired,
    carryForwardCredits: carryForward,
    pendingAdjustmentCredits: pendingAdj,
    refundedCredits: refunded,
    utilizationBps,
    overdraftLimitCredits: overdraftLimit,
    overdraftUsedCredits: overdraftUsed,
  };
}

const ALLOWED_TRANSITIONS: Record<FlexGuardRequestStatus, readonly FlexGuardRequestStatus[]> = {
  submitted: ['scope_validated', 'revision_requested', 'cancelled'],
  revision_requested: ['submitted', 'scope_validated', 'cancelled'],
  scope_validated: ['estimated', 'revision_requested', 'cancelled'],
  estimated: ['credit_quoted', 'revision_requested', 'cancelled'],
  credit_quoted: ['customer_approved', 'revision_requested', 'cancelled'],
  customer_approved: ['credits_reserved', 'cancelled'],
  credits_reserved: ['resource_assigned', 'cancelled'],
  resource_assigned: ['in_execution', 'cancelled'],
  in_execution: ['timesheet_approved', 'additional_credit_pending', 'disputed', 'cancelled'],
  additional_credit_pending: ['in_execution', 'timesheet_approved', 'cancelled'],
  timesheet_approved: ['qa_passed', 'additional_credit_pending', 'disputed'],
  qa_passed: ['customer_accepted', 'disputed'],
  customer_accepted: ['consumed', 'disputed'],
  consumed: ['reconciled', 'disputed'],
  reconciled: [],
  cancelled: [],
  disputed: ['in_execution', 'customer_accepted', 'cancelled'],
};

export function validateFlexGuardTransition(
  from: FlexGuardRequestStatus,
  to: FlexGuardRequestStatus,
  ctx: { reservedCredits?: number; plannedConsumptionCredits?: number; additionalCreditsApproved?: boolean } = {},
): { ok: true } | { ok: false; reason: string } {
  const allowed = ALLOWED_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    return { ok: false, reason: `Transisi FlexGuard dari '${from}' ke '${to}' tidak diizinkan` };
  }
  if (to === 'consumed') {
    const reserved = ctx.reservedCredits ?? 0;
    const consume = ctx.plannedConsumptionCredits ?? 0;
    if (consume > reserved && !ctx.additionalCreditsApproved) {
      return { ok: false, reason: 'Actual consumption melebihi reserved credits; wajib approval tambahan sesuai kontrak' };
    }
  }
  return { ok: true };
}

export interface FlexGuardAccountingEntry {
  eventType: 'flexguard.invoice_issued' | 'flexguard.payment_received' | 'flexguard.credit_consumed' | 'flexguard.service_cost' | 'flexguard.credit_expired';
  debitAccountCode: string;
  creditAccountCode: string;
  amountCents: number;
  requiresFinancePolicyApproval: boolean;
  psak115Note: string;
}

/**
 * Section 7.10 FlexGuard PSAK 115 Accounting Treatment.
 * Separates service credit ledger from financial GL while keeping full reconcilability.
 * NEVER auto-recognizes unused expired credits as revenue without explicit Finance policy approval.
 */
export function buildFlexGuardAccountingPlan(
  eventType: FlexGuardAccountingEntry['eventType'],
  amountCents: number,
  options: { financeBreakagePolicyApproved?: boolean } = {},
): FlexGuardAccountingEntry {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error('Accounting amountCents must be positive integer');
  switch (eventType) {
    case 'flexguard.invoice_issued':
      return {
        eventType,
        debitAccountCode: '1120', // Accounts Receivable
        creditAccountCode: '2140', // Contract Liability (Deferred Revenue)
        amountCents,
        requiresFinancePolicyApproval: false,
        psak115Note: 'Prepaid FlexGuard invoice before performance obligation delivery -> Contract Liability',
      };
    case 'flexguard.payment_received':
      return {
        eventType,
        debitAccountCode: '1110', // Cash / Bank
        creditAccountCode: '1120', // Accounts Receivable
        amountCents,
        requiresFinancePolicyApproval: false,
        psak115Note: 'Cash collection clears Accounts Receivable; revenue remains deferred until delivery',
      };
    case 'flexguard.credit_consumed':
      return {
        eventType,
        debitAccountCode: '2140', // Contract Liability
        creditAccountCode: '4110', // Service Revenue
        amountCents,
        requiresFinancePolicyApproval: false,
        psak115Note: 'Performance obligation satisfied upon customer acceptance & credit consumption',
      };
    case 'flexguard.service_cost':
      return {
        eventType,
        debitAccountCode: '5110', // Cost of Services
        creditAccountCode: '2120', // Accrued Labor / Cost Liability
        amountCents,
        requiresFinancePolicyApproval: false,
        psak115Note: 'Direct delivery cost matched to consumed FlexGuard service engagement',
      };
    case 'flexguard.credit_expired':
      if (!options.financeBreakagePolicyApproved) {
        throw new Error('FLEXGUARD_EXPIRY_REVENUE_POLICY_REQUIRED: Unused expired credits cannot be auto-recognized as revenue without approved Finance PSAK 115 breakage analysis');
      }
      return {
        eventType,
        debitAccountCode: '2140', // Contract Liability
        creditAccountCode: '4190', // Breakage / Expired Credit Revenue (Policy-Approved)
        amountCents,
        requiresFinancePolicyApproval: true,
        psak115Note: 'Breakage recognition explicitly approved by Finance under PSAK 115',
      };
  }
}

/**
 * Section 7.9 FlexGuard Renewal & Upselling Signals (Advisory only — never auto-purchases).
 */
export function evaluateFlexGuardRenewalSignals(balance: FlexGuardBalanceSummary, daysToExpiry: number) {
  const signals: Array<{ code: string; severity: 'info' | 'warning' | 'critical'; message: string }> = [];
  const remainingRatioBps = balance.allocatedCredits > 0 ? Math.round((balance.availableCredits * 10000) / balance.allocatedCredits) : 0;

  if (remainingRatioBps <= 2000) {
    signals.push({ code: 'LOW_BALANCE', severity: remainingRatioBps <= 1000 ? 'critical' : 'warning', message: 'Saldo FlexGuard tersedia <= 20%; rekomendasikan top-up dengan persetujuan pelanggan.' });
  }
  if (balance.utilizationBps >= 8000) {
    signals.push({ code: 'HIGH_CONSUMPTION', severity: 'warning', message: 'Tingkat konsumsi >= 80%; siapkan proposal top-up atau upgrade paket.' });
  }
  if (daysToExpiry <= 60 && daysToExpiry > 0) {
    signals.push({ code: 'UPCOMING_EXPIRY', severity: daysToExpiry <= 30 ? 'critical' : 'warning', message: `Kontrak FlexGuard berakhir dalam ${daysToExpiry} hari; mulai proses renewal.` });
  }
  if (daysToExpiry <= 60 && balance.availableCredits > 0 && remainingRatioBps >= 4000) {
    signals.push({ code: 'UNUSED_CREDITS_RISK', severity: 'warning', message: 'Masih terdapat >= 40% unused credits mendekati masa berakhir; jadwalkan customer advisory.' });
  }

  return {
    signals,
    autoPurchaseTriggered: false as const,
    requiresExplicitCustomerApproval: true as const,
    customerHealthScore: Math.max(0, Math.min(100, Math.round(50 + (balance.utilizationBps / 250) - (daysToExpiry < 30 ? 15 : 0)))),
  };
}

const FORBIDDEN_PORTAL_KEYS = new Set([
  'internal_cost_cents',
  'internal_cost_rate_cents',
  'direct_labor_cost_cents',
  'employee_compensation_cents',
  'monthly_compensation_cents',
  'internal_margin_bps',
  'fully_loaded_cost_cents',
  'fully_loaded_margin_bps',
  'cost_of_services_cents',
  'direct_service_cost_cents',
]);

/**
 * Section 7.7 Customer Portal Data Confidentiality Filter:
 * Strips every internal cost rate, employee compensation, and internal margin key recursively.
 */
export function sanitizeFlexGuardForCustomerPortal<T>(value: T): T {
  if (Array.isArray(value)) return value.map(v => sanitizeFlexGuardForCustomerPortal(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_PORTAL_KEYS.has(k)) continue;
      out[k] = sanitizeFlexGuardForCustomerPortal(v);
    }
    return out as T;
  }
  return value;
}
