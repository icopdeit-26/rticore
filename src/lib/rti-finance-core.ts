/**
 * RTI FINANCE — Core Enterprise Financial Domain, 25-Menu Catalog,
 * 18-Role RBAC Matrix, Double-Entry Accounting Engine, PSAK 115 Revenue Engine,
 * RTICore Docking Event Contract Validator, Indonesian Tax Engine,
 * and ICOFR Automated Control Engine.
 *
 * Monetary Precision Rule:
 * - Zero floating-point arithmetic for monetary balances.
 * - All monetary values use integer minor units (`_cents`, 1 IDR = 100 cents)
 *   or BigInt arithmetic.
 * - Tax and margin percentages use integer basis points (`_bps`, 1% = 100 bps, 100% = 10000 bps).
 * - Exchange rates use micro-rates (`_micro`, 1.000000 = 1_000_000).
 */

export const RTI_FINANCE_BRAND = {
  name: 'RTI FINANCE',
  subtitle: 'Enterprise Financial Management, Accounting, Controlling & RTICore Docking System',
  colors: {
    primary: '#2B124C',
    dark: '#050505',
    silver: '#C0C0C0',
    white: '#FFFFFF',
  },
} as const;

export type FinanceOperatingMode = 'standalone' | 'docked' | 'multi_entity';

export type FinanceRoleId =
  | 'super_admin'
  | 'ceo'
  | 'cfo'
  | 'financial_controller'
  | 'finance_manager'
  | 'accounting_officer'
  | 'ar_officer'
  | 'ap_officer'
  | 'treasury_officer'
  | 'tax_officer'
  | 'budget_officer'
  | 'procurement_officer'
  | 'project_manager'
  | 'business_unit_head'
  | 'human_capital_officer'
  | 'internal_auditor'
  | 'external_auditor'
  | 'management_viewer';

export interface FinanceRoleDefinition {
  readonly id: FinanceRoleId;
  readonly number: number;
  readonly label: string;
  readonly defaultLimitCents: number;
  readonly canMake: boolean;
  readonly canCheck: boolean;
  readonly canApprove: boolean;
  readonly canPost: boolean;
  readonly allowedMenus: readonly FinanceMenuId[];
  readonly description: string;
}

export type FinanceMenuId =
  | 'F01' | 'F02' | 'F03' | 'F04' | 'F05'
  | 'F06' | 'F07' | 'F08' | 'F09' | 'F10'
  | 'F11' | 'F12' | 'F13' | 'F14' | 'F15'
  | 'F16' | 'F17' | 'F18' | 'F19' | 'F20'
  | 'F21' | 'F22' | 'F23' | 'F24' | 'F25';

export interface FinanceMenuDefinition {
  readonly id: FinanceMenuId;
  readonly slug: string;
  readonly href: string;
  readonly title: string;
  readonly primaryFunction: string;
  readonly category: 'Executive & Foundation' | 'Core Accounting & Operations' | 'Contract, Project & Corporate Finance' | 'Closing, Governance & Intelligence';
}

export const RTI_FINANCE_MENUS: readonly FinanceMenuDefinition[] = [
  { id: 'F01', slug: 'dashboard', href: '/finance/F01', title: 'Executive Finance Dashboard', primaryFunction: 'Financial performance monitoring (CEO, CFO, PM, Finance Ops)', category: 'Executive & Foundation' },
  { id: 'F02', slug: 'master-data', href: '/finance/F02', title: 'Financial Master Data', primaryFunction: 'Entity, Hierarchical COA, Currency, Cost & Profit Center', category: 'Executive & Foundation' },
  { id: 'F03', slug: 'general-ledger', href: '/finance/F03', title: 'General Ledger', primaryFunction: '16 Journal types, 13 Dimensions, Posting Rules, Ledger & Trial Balance', category: 'Core Accounting & Operations' },
  { id: 'F04', slug: 'accounts-receivable', href: '/finance/F04', title: 'Accounts Receivable', primaryFunction: 'Customer receivables, payment allocation, aging & collection', category: 'Core Accounting & Operations' },
  { id: 'F05', slug: 'accounts-payable', href: '/finance/F05', title: 'Accounts Payable', primaryFunction: 'Vendor liabilities, bank dual-control, 3-way match & payment batch', category: 'Core Accounting & Operations' },
  { id: 'F06', slug: 'billing-invoicing', href: '/finance/F06', title: 'Billing & Invoicing', primaryFunction: 'Milestone, recurring, advance, progress billing & credit/debit notes', category: 'Core Accounting & Operations' },
  { id: 'F07', slug: 'treasury-cash', href: '/finance/F07', title: 'Treasury & Cash Management', primaryFunction: 'Bank, petty cash, 13-week & 12-month cash flow forecast & liquidity', category: 'Core Accounting & Operations' },
  { id: 'F08', slug: 'bank-reconciliation', href: '/finance/F08', title: 'Bank Reconciliation', primaryFunction: 'Bank statement import, automated matching & reconciliation sign-off', category: 'Core Accounting & Operations' },
  { id: 'F09', slug: 'revenue-recognition', href: '/finance/F09', title: 'Revenue Recognition (PSAK 115)', primaryFunction: '5-Step PSAK 115 contract revenue, SSP allocation, Contract Asset/Liability', category: 'Contract, Project & Corporate Finance' },
  { id: 'F10', slug: 'project-accounting', href: '/finance/F10', title: 'Project Accounting', primaryFunction: 'Project budget, 7 cost buckets, resource rates, ETC/EAC & profitability', category: 'Contract, Project & Corporate Finance' },
  { id: 'F11', slug: 'procurement-finance', href: '/finance/F11', title: 'Procurement Finance', primaryFunction: 'Procure-to-Pay financial control, commitment & GR/IR accrual', category: 'Contract, Project & Corporate Finance' },
  { id: 'F12', slug: 'budget-management', href: '/finance/F12', title: 'Budget Management', primaryFunction: 'Multi-dimensional budget preparation, soft/hard limit & reservation', category: 'Contract, Project & Corporate Finance' },
  { id: 'F13', slug: 'fpa', href: '/finance/F13', title: 'FP&A', primaryFunction: 'Rolling forecast, Base/Optimistic/Pessimistic scenarios & EBITDA analysis', category: 'Contract, Project & Corporate Finance' },
  { id: 'F14', slug: 'expense-management', href: '/finance/F14', title: 'Expense Management', primaryFunction: 'Employee expense claims, cash advances & project reimbursement', category: 'Contract, Project & Corporate Finance' },
  { id: 'F15', slug: 'payroll-accounting', href: '/finance/F15', title: 'Payroll Accounting', primaryFunction: 'Privacy-preserving payroll batch posting, BPJS, PPh 21 & project allocation', category: 'Contract, Project & Corporate Finance' },
  { id: 'F16', slug: 'tax-management', href: '/finance/F16', title: 'Tax Management', primaryFunction: 'Configurable PPN, PPh 21/22/23/25/26/4(2) rules, Faktur & reconciliation', category: 'Contract, Project & Corporate Finance' },
  { id: 'F17', slug: 'fixed-assets', href: '/finance/F17', title: 'Fixed Asset Management', primaryFunction: 'Asset acquisition, capitalization, depreciation schedule & disposal', category: 'Contract, Project & Corporate Finance' },
  { id: 'F18', slug: 'inventory-licenses', href: '/finance/F18', title: 'Inventory & License Accounting', primaryFunction: 'Hardware, software, appliance & cloud subscription amortization', category: 'Contract, Project & Corporate Finance' },
  { id: 'F19', slug: 'flexguard-subscription', href: '/finance/F19', title: 'FlexGuard & Subscription Finance', primaryFunction: 'Credit monetary valuation, contract liability & recurring revenue bridge', category: 'Contract, Project & Corporate Finance' },
  { id: 'F20', slug: 'financial-closing', href: '/finance/F20', title: 'Financial Closing', primaryFunction: '17-point period-end close checklist, 5-stage lock & controlled reopen', category: 'Closing, Governance & Intelligence' },
  { id: 'F21', slug: 'financial-reporting', href: '/finance/F21', title: 'Financial Reporting', primaryFunction: '8 Statutory PSAK reports & 17 Management reports with drill-down & export', category: 'Closing, Governance & Intelligence' },
  { id: 'F22', slug: 'financial-consolidation', href: '/finance/F22', title: 'Financial Consolidation', primaryFunction: 'Multi-entity group reporting & intercompany elimination', category: 'Closing, Governance & Intelligence' },
  { id: 'F23', slug: 'icofr-compliance', href: '/finance/F23', title: 'ICOFR & Financial Compliance', primaryFunction: 'COSO Risk & Control Matrix, ToD/ToE & 15 automated exception monitors', category: 'Closing, Governance & Intelligence' },
  { id: 'F24', slug: 'ai-intelligence', href: '/finance/F24', title: 'AI Financial Intelligence', primaryFunction: 'Read-only financial decision support, natural-language queries & early warning', category: 'Closing, Governance & Intelligence' },
  { id: 'F25', slug: 'admin-docking', href: '/finance/F25', title: 'System Administration & Docking', primaryFunction: 'RTICore Docking Management Center, 18-role RBAC & event outbox/inbox/DLQ', category: 'Closing, Governance & Intelligence' },
] as const;

const ALL_MENU_IDS: readonly FinanceMenuId[] = RTI_FINANCE_MENUS.map(m => m.id);

export const RTI_FINANCE_ROLES: readonly FinanceRoleDefinition[] = [
  {
    id: 'super_admin',
    number: 1,
    label: 'Super Administrator',
    defaultLimitCents: 0,
    canMake: false,
    canCheck: false,
    canApprove: false, // Rule 22: System admin does not automatically have authority to approve journals or payments
    canPost: false,
    allowedMenus: ['F01', 'F02', 'F23', 'F25'],
    description: 'System configuration, RBAC assignment request, and RTICore Docking administration. Cannot approve journals or payments.',
  },
  {
    id: 'ceo',
    number: 2,
    label: 'Chief Executive Officer (CEO)',
    defaultLimitCents: 500_000_000_000_00, // Rp 500 Miliar
    canMake: false,
    canCheck: true,
    canApprove: true,
    canPost: false,
    allowedMenus: ['F01', 'F10', 'F12', 'F13', 'F21', 'F22', 'F23', 'F24'],
    description: 'Executive performance oversight, consolidated profitability, strategic budget & high-value escalation approval.',
  },
  {
    id: 'cfo',
    number: 3,
    label: 'Chief Financial Officer (CFO)',
    defaultLimitCents: 250_000_000_000_00, // Rp 250 Miliar
    canMake: false,
    canCheck: true,
    canApprove: true,
    canPost: true,
    allowedMenus: ALL_MENU_IDS,
    description: 'Full financial governance, final period close approval, policy sign-off, treasury release, and statutory reporting.',
  },
  {
    id: 'financial_controller',
    number: 4,
    label: 'Financial Controller',
    defaultLimitCents: 50_000_000_000_00, // Rp 50 Miliar
    canMake: true,
    canCheck: true,
    canApprove: true,
    canPost: true,
    allowedMenus: ALL_MENU_IDS.filter(id => id !== 'F25'),
    description: 'Accounting policy enforcement, PSAK 115 control, closing cockpit review, consolidation, and ICOFR monitoring.',
  },
  {
    id: 'finance_manager',
    number: 5,
    label: 'Finance Manager',
    defaultLimitCents: 10_000_000_000_00, // Rp 10 Miliar
    canMake: true,
    canCheck: true,
    canApprove: true,
    canPost: true,
    allowedMenus: ['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08', 'F09', 'F10', 'F11', 'F12', 'F13', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19', 'F20', 'F21', 'F24'],
    description: 'Day-to-day financial operations review, journal approval within limit, and subledger reconciliation.',
  },
  {
    id: 'accounting_officer',
    number: 6,
    label: 'Accounting Officer',
    defaultLimitCents: 0,
    canMake: true,
    canCheck: true,
    canApprove: false,
    canPost: true,
    allowedMenus: ['F01', 'F02', 'F03', 'F09', 'F10', 'F15', 'F17', 'F18', 'F19', 'F20', 'F21'],
    description: 'Prepares general journals, accruals, depreciation, revenue schedules, and posts independently approved journals.',
  },
  {
    id: 'ar_officer',
    number: 7,
    label: 'Accounts Receivable Officer',
    defaultLimitCents: 0,
    canMake: true,
    canCheck: true,
    canApprove: false,
    canPost: false,
    allowedMenus: ['F01', 'F04', 'F06', 'F09', 'F19', 'F21'],
    description: 'Manages customer billing, tax invoices, payment allocation, collection workflow, aging, and customer statements.',
  },
  {
    id: 'ap_officer',
    number: 8,
    label: 'Accounts Payable Officer',
    defaultLimitCents: 0,
    canMake: true,
    canCheck: true,
    canApprove: false,
    canPost: false,
    allowedMenus: ['F01', 'F05', 'F11', 'F14', 'F16', 'F21'],
    description: 'Manages vendor invoices, 3-way matching, vendor advances, expense claim verification, and payment batch drafting.',
  },
  {
    id: 'treasury_officer',
    number: 9,
    label: 'Treasury Officer',
    defaultLimitCents: 2_500_000_000_00, // Rp 2,5 Miliar
    canMake: true,
    canCheck: true,
    canApprove: false,
    canPost: false,
    allowedMenus: ['F01', 'F04', 'F05', 'F07', 'F08', 'F21'],
    description: 'Manages bank accounts, cash position, petty cash, payment scheduling, bank statement import, and 13-week cash forecast.',
  },
  {
    id: 'tax_officer',
    number: 10,
    label: 'Tax Officer',
    defaultLimitCents: 0,
    canMake: true,
    canCheck: true,
    canApprove: false,
    canPost: false,
    allowedMenus: ['F01', 'F02', 'F04', 'F05', 'F06', 'F15', 'F16', 'F20', 'F21'],
    description: 'Manages PPN, PPh 21/22/23/25/26/4(2) tax rules, Faktur Pajak, withholding certificates, and tax reconciliation.',
  },
  {
    id: 'budget_officer',
    number: 11,
    label: 'Budget & FP&A Officer',
    defaultLimitCents: 1_000_000_000_00,
    canMake: true,
    canCheck: true,
    canApprove: false,
    canPost: false,
    allowedMenus: ['F01', 'F02', 'F10', 'F11', 'F12', 'F13', 'F21', 'F24'],
    description: 'Manages multi-dimensional budgets, budget reservations/transfers, variance analysis, and FP&A scenario modeling.',
  },
  {
    id: 'procurement_officer',
    number: 12,
    label: 'Procurement Finance Officer',
    defaultLimitCents: 500_000_000_00,
    canMake: true,
    canCheck: true,
    canApprove: false,
    canPost: false,
    allowedMenus: ['F05', 'F10', 'F11', 'F12', 'F17', 'F18'],
    description: 'Manages purchase requisitions, purchase commitments, goods receipts, service acceptances, and vendor master data.',
  },
  {
    id: 'project_manager',
    number: 13,
    label: 'Project Manager',
    defaultLimitCents: 250_000_000_00,
    canMake: true,
    canCheck: true,
    canApprove: false,
    canPost: false,
    allowedMenus: ['F01', 'F06', 'F10', 'F12', 'F14', 'F19'],
    description: 'Monitors project budget, actual & committed cost, ETC/EAC, billing milestones, and project gross margin.',
  },
  {
    id: 'business_unit_head',
    number: 14,
    label: 'Business Unit Head',
    defaultLimitCents: 5_000_000_000_00,
    canMake: false,
    canCheck: true,
    canApprove: true,
    canPost: false,
    allowedMenus: ['F01', 'F10', 'F11', 'F12', 'F13', 'F14', 'F21', 'F24'],
    description: 'Approves business unit budgets, requisitions, expense claims, and reviews BU profit and loss.',
  },
  {
    id: 'human_capital_officer',
    number: 15,
    label: 'Human Capital & Payroll Officer',
    defaultLimitCents: 0,
    canMake: true,
    canCheck: true,
    canApprove: false,
    canPost: false,
    allowedMenus: ['F10', 'F12', 'F14', 'F15', 'F16'],
    description: 'Manages effective-dated resource cost rate bands, headcount planning inputs, and aggregated payroll accounting batches.',
  },
  {
    id: 'internal_auditor',
    number: 16,
    label: 'Internal Auditor',
    defaultLimitCents: 0,
    canMake: false,
    canCheck: true,
    canApprove: false,
    canPost: false,
    allowedMenus: ['F01', 'F02', 'F03', 'F04', 'F05', 'F07', 'F08', 'F09', 'F10', 'F11', 'F12', 'F16', 'F17', 'F19', 'F20', 'F21', 'F22', 'F23', 'F25'],
    description: 'Independent read-only audit access across all ledgers, executes ICOFR Test of Design & Effectiveness, and tracks exceptions.',
  },
  {
    id: 'external_auditor',
    number: 17,
    label: 'External Auditor',
    defaultLimitCents: 0,
    canMake: false,
    canCheck: false,
    canApprove: false,
    canPost: false,
    allowedMenus: ['F03', 'F08', 'F09', 'F16', 'F17', 'F20', 'F21', 'F22', 'F23'],
    description: 'Scoped read-only statutory audit access to General Ledger, Trial Balance, Financial Statements, and audit evidence.',
  },
  {
    id: 'management_viewer',
    number: 18,
    label: 'Management Viewer',
    defaultLimitCents: 0,
    canMake: false,
    canCheck: false,
    canApprove: false,
    canPost: false,
    allowedMenus: ['F01', 'F13', 'F21', 'F24'],
    description: 'Read-only access to executive dashboards, financial reports, and AI financial intelligence.',
  },
] as const;

/** Maps existing RTICore login role (`BoQRole`) to default RTI Finance persona when no explicit override row exists. */
export function mapRTICoreRoleToFinanceRole(rticoreRole: string): FinanceRoleId {
  switch (rticoreRole) {
    case 'admin': return 'super_admin';
    case 'finance': return 'financial_controller';
    case 'approver': return 'cfo';
    case 'project_manager': return 'project_manager';
    case 'presales': return 'procurement_officer';
    case 'sales':
    case 'marketing': return 'business_unit_head';
    case 'legal': return 'internal_auditor';
    default: return 'management_viewer';
  }
}

export function getFinanceRoleDefinition(roleId: FinanceRoleId): FinanceRoleDefinition {
  const found = RTI_FINANCE_ROLES.find(r => r.id === roleId);
  if (!found) throw new Error(`Unknown finance role: ${roleId}`);
  return found;
}

export function canFinanceRoleAccessMenu(roleId: FinanceRoleId, menuId: FinanceMenuId): boolean {
  const def = RTI_FINANCE_ROLES.find(r => r.id === roleId);
  return !!def && def.allowedMenus.includes(menuId);
}

/**
 * Enforces Maker-Checker (Segregation of Duties) and Tiered Approval Limit.
 */
export function validateFinanceApprovalAuthority(params: {
  makerEmail: string;
  approverEmail: string;
  approverRole: FinanceRoleId;
  customApprovalLimitCents?: number;
  transactionAmountCents: number;
  requireMakerChecker?: boolean;
}): { ok: true } | { ok: false; code: string; message: string } {
  const { makerEmail, approverEmail, approverRole, customApprovalLimitCents, transactionAmountCents, requireMakerChecker = true } = params;
  const roleDef = getFinanceRoleDefinition(approverRole);

  if (!roleDef.canApprove) {
    return {
      ok: false,
      code: 'FIN_ROLE_NO_APPROVAL_AUTHORITY',
      message: `Role ${roleDef.label} tidak memiliki kewenangan menyetujui transaksi keuangan.`,
    };
  }
  if (requireMakerChecker && makerEmail.trim().toLowerCase() === approverEmail.trim().toLowerCase()) {
    return {
      ok: false,
      code: 'FIN_SOD_SELF_APPROVAL_FORBIDDEN',
      message: 'Pelanggaran Segregation of Duties (Maker-Checker): Pembuat transaksi dilarang menyetujui transaksinya sendiri.',
    };
  }
  const effectiveLimit = customApprovalLimitCents !== undefined ? customApprovalLimitCents : roleDef.defaultLimitCents;
  if (transactionAmountCents > effectiveLimit) {
    return {
      ok: false,
      code: 'FIN_APPROVAL_LIMIT_EXCEEDED',
      message: `Nilai transaksi (${transactionAmountCents} sen) melebihi batas otorisasi ${roleDef.label} (${effectiveLimit} sen). Eskalasi ke CFO/CEO diperlukan.`,
    };
  }
  return { ok: true };
}

// =============================================================================
// SECTION 8: DOUBLE-ENTRY ACCOUNTING ENGINE & CONFIGURABLE POSTING RULES
// =============================================================================

export type AccountClassification =
  | 'asset'
  | 'liability'
  | 'equity'
  | 'revenue'
  | 'cost_of_revenue'
  | 'operating_expense'
  | 'other_income'
  | 'other_expense'
  | 'tax_expense'
  | 'contra_account';

export type JournalType =
  | 'general'
  | 'sales'
  | 'purchase'
  | 'cash_receipt'
  | 'cash_disbursement'
  | 'revenue_recognition'
  | 'accrual'
  | 'prepaid_expense'
  | 'depreciation'
  | 'payroll'
  | 'tax'
  | 'adjustment'
  | 'reclassification'
  | 'reversal'
  | 'intercompany'
  | 'closing';

export type JournalLifecycleStage = 'draft' | 'submitted' | 'reviewed' | 'approved' | 'posted' | 'reversed' | 'rejected';

export interface AccountingDimensions {
  legal_entity_id: string;
  business_unit_id?: string | null;
  department_id?: string | null;
  cost_center_id?: string | null;
  profit_center_id?: string | null;
  project_id?: string | null;
  contract_id?: string | null;
  customer_id?: string | null;
  vendor_id?: string | null;
  product_code?: string | null;
  service_category?: string | null;
  currency: string;
  period_code: string;
}

export interface JournalLineInput {
  account_id: string;
  debit_cents: number;
  credit_cents: number;
  description: string;
  dimensions?: Partial<AccountingDimensions>;
}

/**
 * Validates double-entry journal integrity using exact BigInt minor-unit arithmetic.
 */
export function validateDoubleEntryJournal(params: {
  lines: readonly JournalLineInput[];
  periodStatus: 'open' | 'soft_close' | 'under_review' | 'approved' | 'hard_close' | 'closed';
  journalType: JournalType;
  exchangeRateMicro?: number;
  activeAccountIds?: ReadonlySet<string>;
  headerOnlyAccountIds?: ReadonlySet<string>;
}): { ok: true; totalDebitCents: number; totalCreditCents: number } | { ok: false; code: string; message: string } {
  const { lines, periodStatus, exchangeRateMicro = 1_000_000, activeAccountIds, headerOnlyAccountIds } = params;

  if (periodStatus !== 'open') {
    return { ok: false, code: 'FIN_PERIOD_CLOSED', message: `Periode akuntansi berstatus '${periodStatus}'. Posting ke periode tertutup ditolak.` };
  }
  if (!Number.isSafeInteger(exchangeRateMicro) || exchangeRateMicro <= 0) {
    return { ok: false, code: 'FIN_INVALID_EXCHANGE_RATE', message: 'Kurs mata uang tidak valid.' };
  }
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > 200) {
    return { ok: false, code: 'FIN_JOURNAL_LINE_COUNT', message: 'Jurnal double-entry wajib memiliki minimal 2 baris.' };
  }

  let totalDebit = 0n;
  let totalCredit = 0n;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.account_id || typeof line.account_id !== 'string') {
      return { ok: false, code: 'FIN_LINE_ACCOUNT_MISSING', message: `Baris #${i + 1} tidak memiliki akun COA.` };
    }
    if (activeAccountIds && !activeAccountIds.has(line.account_id)) {
      return { ok: false, code: 'FIN_ACCOUNT_INACTIVE', message: `Akun ${line.account_id} tidak aktif atau tidak terdaftar pada Legal Entity ini.` };
    }
    if (headerOnlyAccountIds && headerOnlyAccountIds.has(line.account_id)) {
      return { ok: false, code: 'FIN_HEADER_ACCOUNT_POSTING_FORBIDDEN', message: `Akun induk (header) ${line.account_id} tidak boleh menerima posting langsung.` };
    }
    if (!Number.isSafeInteger(line.debit_cents) || !Number.isSafeInteger(line.credit_cents)) {
      return { ok: false, code: 'FIN_NON_INTEGER_CENTS', message: `Baris #${i + 1} wajib menggunakan integer minor unit (sen), bukan floating-point.` };
    }
    if (line.debit_cents < 0 || line.credit_cents < 0) {
      return { ok: false, code: 'FIN_NEGATIVE_LINE_AMOUNT', message: `Baris #${i + 1} memiliki nilai negatif.` };
    }
    if ((line.debit_cents > 0 && line.credit_cents > 0) || (line.debit_cents === 0 && line.credit_cents === 0)) {
      return { ok: false, code: 'FIN_LINE_SINGLE_SIDED', message: `Baris #${i + 1} harus mengisi salah satu: Debit atau Kredit (tidak boleh keduanya atau nol).` };
    }
    totalDebit += BigInt(line.debit_cents);
    totalCredit += BigInt(line.credit_cents);
  }

  if (totalDebit <= 0n || totalDebit !== totalCredit) {
    return {
      ok: false,
      code: 'FIN_UNBALANCED_JOURNAL',
      message: `Jurnal tidak seimbang: Total Debit (${totalDebit.toString()} sen) != Total Kredit (${totalCredit.toString()} sen).`,
    };
  }
  if (totalDebit > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, code: 'FIN_AMOUNT_OVERFLOW', message: 'Total jurnal melebihi batas integer aman.' };
  }

  return { ok: true, totalDebitCents: Number(totalDebit), totalCreditCents: Number(totalCredit) };
}

export interface PostingRuleRecord {
  id: string;
  rule_code: string;
  business_event: string;
  journal_type: JournalType;
  service_category: string;
  tax_treatment: string;
  debit_account_id: string;
  credit_account_id: string;
  policy_reference: string;
  effective_from: string;
  effective_to?: string | null;
  status: 'draft' | 'approved' | 'superseded';
}

/**
 * Resolves configurable posting rule without hardcoding COA numbers in transaction code.
 */
export function resolvePostingRule(
  rules: readonly PostingRuleRecord[],
  criteria: {
    business_event: string;
    service_category?: string;
    tax_treatment?: string;
    transaction_date: string;
  },
): PostingRuleRecord | null {
  const candidates = rules.filter(r => {
    if (r.status !== 'approved') return false;
    if (r.business_event !== criteria.business_event) return false;
    if (r.effective_from > criteria.transaction_date) return false;
    if (r.effective_to && r.effective_to < criteria.transaction_date) return false;
    const catMatch = r.service_category === '*' || r.service_category === (criteria.service_category || '*');
    const taxMatch = r.tax_treatment === '*' || r.tax_treatment === (criteria.tax_treatment || '*');
    return catMatch && taxMatch;
  });
  // Prefer most specific rule (exact service_category & tax_treatment before wildcard '*')
  candidates.sort((a, b) => {
    const scoreA = (a.service_category !== '*' ? 2 : 0) + (a.tax_treatment !== '*' ? 1 : 0);
    const scoreB = (b.service_category !== '*' ? 2 : 0) + (b.tax_treatment !== '*' ? 1 : 0);
    return scoreB - scoreA;
  });
  return candidates[0] || null;
}

// =============================================================================
// SECTION 12: PSAK 115 REVENUE RECOGNITION ENGINE (5-STEP MODEL)
// =============================================================================

export interface PerformanceObligationInput {
  obligation_code: string;
  title: string;
  ssp_cents: number;
}

export interface AllocatedPerformanceObligation extends PerformanceObligationInput {
  allocated_transaction_price_cents: number;
  allocation_share_bps: number;
}

/**
 * PSAK 115 Step 4: Allocates contract transaction price across performance obligations
 * proportionally to their Standalone Selling Prices (SSP) using exact integer cents
 * and largest-remainder distribution so sum(allocated) === transactionPriceCents.
 */
export function allocatePSAK115TransactionPrice(
  transactionPriceCents: number,
  obligations: readonly PerformanceObligationInput[],
): AllocatedPerformanceObligation[] {
  if (!Number.isSafeInteger(transactionPriceCents) || transactionPriceCents <= 0) {
    throw new Error('PSAK115_INVALID_TRANSACTION_PRICE');
  }
  if (!obligations.length) {
    throw new Error('PSAK115_NO_OBLIGATIONS');
  }
  let totalSsp = 0n;
  for (const ob of obligations) {
    if (!Number.isSafeInteger(ob.ssp_cents) || ob.ssp_cents <= 0) {
      throw new Error('PSAK115_INVALID_SSP');
    }
    totalSsp += BigInt(ob.ssp_cents);
  }

  const price = BigInt(transactionPriceCents);
  const provisional = obligations.map((ob, index) => {
    const num = price * BigInt(ob.ssp_cents);
    const floorCents = Number(num / totalSsp);
    const remainder = num % totalSsp;
    const shareBps = Number((BigInt(ob.ssp_cents) * 10000n) / totalSsp);
    return { index, ob, floorCents, remainder, shareBps };
  });

  let allocatedSum = provisional.reduce((acc, item) => acc + item.floorCents, 0);
  let diff = transactionPriceCents - allocatedSum;

  const byRemainder = [...provisional].sort((a, b) => (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : a.index - b.index));
  for (let i = 0; i < diff; i++) {
    byRemainder[i % byRemainder.length].floorCents += 1;
  }

  return provisional.map(p => ({
    ...p.ob,
    allocated_transaction_price_cents: p.floorCents,
    allocation_share_bps: p.shareBps,
  }));
}

/**
 * Separates Contract Value, Billed Invoice, Cash Received, AR, Contract Asset (Unbilled Revenue),
 * Contract Liability (Deferred Revenue), and Recognized Revenue (Section 9 & 12).
 */
export function computeContractRevenuePosition(params: {
  contractValueCents: number;
  billedToDateCents: number;
  cashCollectedCents: number;
  recognizedRevenueCents: number;
}) {
  const { contractValueCents, billedToDateCents, cashCollectedCents, recognizedRevenueCents } = params;
  if (recognizedRevenueCents > contractValueCents) {
    throw new Error('PSAK115_RECOGNIZED_EXCEEDS_CONTRACT');
  }
  const accountsReceivableCents = Math.max(0, billedToDateCents - cashCollectedCents);
  const unallocatedAdvanceCents = Math.max(0, cashCollectedCents - billedToDateCents);
  // Contract Asset (Unbilled Revenue) occurs when recognized revenue > billed amount
  const contractAssetCents = Math.max(0, recognizedRevenueCents - billedToDateCents);
  // Contract Liability (Deferred Revenue) occurs when billed amount > recognized revenue
  const contractLiabilityCents = Math.max(0, billedToDateCents - recognizedRevenueCents);
  const remainingBacklogCents = Math.max(0, contractValueCents - recognizedRevenueCents);

  return {
    contractValueCents,
    billedToDateCents,
    cashCollectedCents,
    recognizedRevenueCents,
    accountsReceivableCents,
    unallocatedAdvanceCents,
    contractAssetCents,
    contractLiabilityCents,
    remainingBacklogCents,
  };
}

// =============================================================================
// SECTION 13 & 14: PROJECT ACCOUNTING & FLEXGUARD MONETARY RECONCILIATION
// =============================================================================

export function computeProjectProfitabilityMetrics(params: {
  contractValueCents: number;
  approvedBudgetCents: number;
  recognizedRevenueCents: number;
  billedAmountCents: number;
  cashCollectedCents: number;
  directCostCents: number;
  indirectCostCents: number;
  committedCostCents: number;
  estimateToCompleteCents: number;
  isCloseCertified: boolean;
}) {
  const totalActualCostCents = params.directCostCents + params.indirectCostCents;
  const grossProfitCents = params.recognizedRevenueCents - totalActualCostCents;
  const grossMarginBps = params.recognizedRevenueCents > 0
    ? Math.round((grossProfitCents * 10000) / params.recognizedRevenueCents)
    : 0;
  const estimateAtCompletionCents = totalActualCostCents + params.estimateToCompleteCents;
  const budgetVarianceCents = params.approvedBudgetCents - estimateAtCompletionCents;
  const costOverrunCents = Math.max(0, estimateAtCompletionCents - params.approvedBudgetCents);
  const expectedProjectProfitCents = params.contractValueCents - estimateAtCompletionCents;
  const cashConversionBps = params.billedAmountCents > 0
    ? Math.round((params.cashCollectedCents * 10000) / params.billedAmountCents)
    : 0;

  return {
    ...params,
    totalActualCostCents,
    grossProfitCents,
    grossMarginBps,
    grossMarginPct: grossMarginBps / 100,
    estimateAtCompletionCents,
    budgetVarianceCents,
    costOverrunCents,
     isOverrun: costOverrunCents > 0,
    expectedProjectProfitCents,
    cashConversionBps,
    statusLabel: params.isCloseCertified ? 'CERTIFIED' : 'PROVISIONAL',
  };
}

/**
 * FlexGuard Operational-to-Financial Reconciliation:
 * Opening + Purchase - Consumption +/- Adjustment = Closing
 */
export function reconcileFlexGuardLedger(params: {
  openingUnits: number;
  purchasedUnits: number;
  consumedUnits: number;
  expiredUnits: number;
  adjustmentUnits: number;
  unitRateCents: number;
  glContractLiabilityCents: number;
}) {
  const closingUnits = params.openingUnits + params.purchasedUnits - params.consumedUnits - params.expiredUnits + params.adjustmentUnits;
  if (closingUnits < 0) {
    throw new Error('FLEXGUARD_NEGATIVE_CLOSING_BALANCE');
  }
  const expectedContractLiabilityCents = closingUnits * params.unitRateCents;
  const recognizedFromConsumptionCents = (params.consumedUnits + params.expiredUnits) * params.unitRateCents;
  const varianceCents = expectedContractLiabilityCents - params.glContractLiabilityCents;

  return {
    openingUnits: params.openingUnits,
    purchasedUnits: params.purchasedUnits,
    consumedUnits: params.consumedUnits,
    expiredUnits: params.expiredUnits,
    adjustmentUnits: params.adjustmentUnits,
    closingUnits,
    unitRateCents: params.unitRateCents,
    expectedContractLiabilityCents,
    glContractLiabilityCents: params.glContractLiabilityCents,
    recognizedFromConsumptionCents,
    varianceCents,
    reconciled: varianceCents === 0,
  };
}

// =============================================================================
// SECTION 16: CONFIGURABLE INDONESIAN TAX ENGINE
// =============================================================================

export interface TaxRuleConfig {
  id: string;
  tax_code: string;
  tax_type: 'PPN' | 'PPH21' | 'PPH22' | 'PPH23' | 'PPH25' | 'PPH26' | 'PPH4_2';
  rate_bps: number;
  tax_base_ratio_bps: number;
  is_withholding: boolean;
  is_exempt: boolean;
  effective_from: string;
  effective_to?: string | null;
  status: 'draft' | 'approved' | 'superseded';
}

export function calculateConfigurableTax(params: {
  grossAmountCents: number;
  transactionDate: string;
  rule: TaxRuleConfig;
}): { taxBaseCents: number; taxAmountCents: number; netSettlementCents: number } {
  const { grossAmountCents, transactionDate, rule } = params;
  if (!Number.isSafeInteger(grossAmountCents) || grossAmountCents < 0) {
    throw new Error('TAX_INVALID_GROSS_AMOUNT');
  }
  if (rule.status !== 'approved') {
    throw new Error('TAX_RULE_NOT_APPROVED');
  }
  if (rule.effective_from > transactionDate || (rule.effective_to && rule.effective_to < transactionDate)) {
    throw new Error('TAX_RULE_OUTSIDE_EFFECTIVE_DATE');
  }
  if (rule.is_exempt || rule.rate_bps === 0) {
    return { taxBaseCents: grossAmountCents, taxAmountCents: 0, netSettlementCents: grossAmountCents };
  }
  const gross = BigInt(grossAmountCents);
  const taxBase = (gross * BigInt(rule.tax_base_ratio_bps) + 5000n) / 10000n;
  const taxAmount = (taxBase * BigInt(rule.rate_bps) + 5000n) / 10000n;
  const taxBaseCents = Number(taxBase);
  const taxAmountCents = Number(taxAmount);
  const netSettlementCents = rule.is_withholding
    ? grossAmountCents - taxAmountCents
    : grossAmountCents + taxAmountCents;

  return { taxBaseCents, taxAmountCents, netSettlementCents };
}

// =============================================================================
// SECTION 6.4: RTICORE DOCKING EVENT CONTRACT CATALOG & VALIDATOR
// =============================================================================

export const RTICORE_DOCKING_EVENT_TYPES = [
  'customer.created',
  'customer.updated',
  'contract.approved',
  'contract.amended',
  'project.created',
  'project.milestone_accepted',
  'project.completed',
  'timesheet.approved',
  'resource.cost_allocated',
  'procurement.requested',
  'purchase_order.approved',
  'goods.received',
  'service.accepted',
  'vendor_invoice.approved',
  'customer_invoice.approved',
  'customer.payment_received',
  'vendor.payment_completed',
  'flexguard.credit_purchased',
  'flexguard.credit_consumed',
  'subscription.activated',
  'subscription.renewed',
  'subscription.terminated',
] as const;

export type RTICoreDockingEventType = (typeof RTICORE_DOCKING_EVENT_TYPES)[number];

export interface DockingEventEnvelope {
  event_id: string;
  event_type: RTICoreDockingEventType;
  source_system: 'RTICORE' | 'RTI_FINANCE';
  tenant_id: string;
  legal_entity_id: string;
  source_document_id: string;
  correlation_id: string;
  schema_version: string;
  timestamp: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
}

export function validateDockingEventEnvelope(
  raw: Record<string, unknown>,
  nowMs = Date.now(),
  maxDriftSeconds = 300,
): { ok: true; envelope: DockingEventEnvelope } | { ok: false; code: string; message: string } {
  const requiredStrings = [
    'event_id', 'event_type', 'source_system', 'tenant_id',
    'legal_entity_id', 'source_document_id', 'correlation_id',
    'schema_version', 'timestamp', 'idempotency_key',
  ] as const;

  for (const field of requiredStrings) {
    if (typeof raw[field] !== 'string' || String(raw[field]).trim().length < 2) {
      return { ok: false, code: 'DOCKING_MISSING_FIELD', message: `Field wajib '${field}' tidak valid pada event contract.` };
    }
  }

  const eventType = String(raw.event_type) as RTICoreDockingEventType;
  if (!RTICORE_DOCKING_EVENT_TYPES.includes(eventType)) {
    return { ok: false, code: 'DOCKING_UNKNOWN_EVENT_TYPE', message: `Event type '${eventType}' tidak terdaftar dalam katalog 22 kontrak event.` };
  }

  if (raw.source_system !== 'RTICORE' && raw.source_system !== 'RTI_FINANCE') {
    return { ok: false, code: 'DOCKING_INVALID_SOURCE_SYSTEM', message: 'Source system harus RTICORE atau RTI_FINANCE.' };
  }

  if (String(raw.idempotency_key).trim().length < 8) {
    return { ok: false, code: 'DOCKING_INVALID_IDEMPOTENCY_KEY', message: 'Idempotency key minimal 8 karakter.' };
  }

  const ts = Date.parse(String(raw.timestamp));
  if (Number.isNaN(ts)) {
    return { ok: false, code: 'DOCKING_INVALID_TIMESTAMP', message: 'Timestamp event tidak valid.' };
  }
  if (maxDriftSeconds > 0 && Math.abs(nowMs - ts) > maxDriftSeconds * 1000) {
    return { ok: false, code: 'DOCKING_TIMESTAMP_REPLAY_REJECTED', message: 'Timestamp event berada di luar batas toleransi replay protection.' };
  }

  if (!raw.payload || typeof raw.payload !== 'object' || Array.isArray(raw.payload)) {
    return { ok: false, code: 'DOCKING_INVALID_PAYLOAD', message: 'Payload event wajib berupa objek JSON.' };
  }

  return {
    ok: true,
    envelope: {
      event_id: String(raw.event_id).trim(),
      event_type: eventType,
      source_system: raw.source_system,
      tenant_id: String(raw.tenant_id).trim(),
      legal_entity_id: String(raw.legal_entity_id).trim(),
      source_document_id: String(raw.source_document_id).trim(),
      correlation_id: String(raw.correlation_id).trim(),
      schema_version: String(raw.schema_version).trim(),
      timestamp: String(raw.timestamp).trim(),
      idempotency_key: String(raw.idempotency_key).trim(),
      payload: raw.payload as Record<string, unknown>,
    },
  };
}

// =============================================================================
// SECTION 18 & 21: 17-POINT CLOSING CHECKLIST & 15 AUTOMATED ICOFR CONTROLS
// =============================================================================

export const FINANCIAL_CLOSING_17_CHECKLIST = [
  { code: 'CL01', label: 'AR reconciliation (Subledger to GL)' },
  { code: 'CL02', label: 'AP reconciliation (Subledger to GL)' },
  { code: 'CL03', label: 'Bank reconciliation (All active bank accounts)' },
  { code: 'CL04', label: 'Cash & petty cash verification' },
  { code: 'CL05', label: 'Revenue reconciliation (PSAK 115 schedule to GL)' },
  { code: 'CL06', label: 'Project cost reconciliation (PSA & P2P to GL)' },
  { code: 'CL07', label: 'Payroll reconciliation (Payroll batch to GL)' },
  { code: 'CL08', label: 'Tax reconciliation (PPN & PPh registers to GL)' },
  { code: 'CL09', label: 'Fixed asset & depreciation reconciliation' },
  { code: 'CL10', label: 'Accrual review & GR/IR clearing' },
  { code: 'CL11', label: 'Prepayment & license amortization review' },
  { code: 'CL12', label: 'Inventory & security appliance valuation reconciliation' },
  { code: 'CL13', label: 'Intercompany balance matching & elimination' },
  { code: 'CL14', label: 'Trial balance equilibrium & contra-account review' },
  { code: 'CL15', label: 'Statutory financial statement review' },
  { code: 'CL16', label: 'Controller & CFO management approval' },
  { code: 'CL17', label: 'Hard period locking & snapshot certification' },
] as const;

export const ICOFR_15_AUTOMATED_CONTROLS = [
  'unbalanced_journal',
  'duplicate_invoice',
  'duplicate_payment',
  'unauthorized_posting',
  'closed_period_posting',
  'suspicious_manual_journal',
  'unsupported_transaction',
  'vendor_bank_change',
  'budget_overrun',
  'unreconciled_balance',
  'negative_policy_balance',
  'sod_conflict',
  'missing_approval',
  'revenue_recognition_exception',
  'integration_failure',
] as const;

export type ICOFRAutomatedControlKind = (typeof ICOFR_15_AUTOMATED_CONTROLS)[number];
