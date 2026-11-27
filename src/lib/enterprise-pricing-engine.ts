/**
 * RTICore V4.0 Enterprise Service Catalog, Activity-Based Mandays Modeling
 * & Service Pricing Intelligence Engine.
 *
 * Monetary & Precision Rules:
 * - Zero floating-point arithmetic for monetary totals: all currency amounts are
 *   integer minor units (`_cents`, 1 IDR = 100 cents).
 * - All percentages/multipliers use integer basis points (`_bps`, 1.00 = 10000 bps, 1% = 100 bps).
 * - Mandays use integer tenths (`_tenths`, 1.0 MD = 10, 0.5 MD = 5).
 * - Hours use integer hundredths (`_hundredths`, 8.00 h = 800).
 */

export const ENTERPRISE_SERVICE_CATEGORIES = [
  { code: 'web_app_pentest', label: 'Web Application Penetration Testing', family: 'Offensive Security', defaultMinMd: 40, defaultStdMd: 80, defaultMaxMd: 200 },
  { code: 'mobile_app_pentest', label: 'Mobile Application Penetration Testing', family: 'Offensive Security', defaultMinMd: 40, defaultStdMd: 70, defaultMaxMd: 160 },
  { code: 'api_pentest', label: 'API Penetration Testing', family: 'Offensive Security', defaultMinMd: 30, defaultStdMd: 60, defaultMaxMd: 150 },
  { code: 'network_pentest', label: 'Network Penetration Testing', family: 'Offensive Security', defaultMinMd: 30, defaultStdMd: 60, defaultMaxMd: 180 },
  { code: 'infrastructure_assessment', label: 'Infrastructure Security Assessment', family: 'Offensive Security', defaultMinMd: 40, defaultStdMd: 80, defaultMaxMd: 200 },
  { code: 'cloud_security_assessment', label: 'Cloud Security Assessment', family: 'Offensive Security', defaultMinMd: 50, defaultStdMd: 100, defaultMaxMd: 250 },
  { code: 'active_directory_assessment', label: 'Active Directory Security Assessment', family: 'Offensive Security', defaultMinMd: 40, defaultStdMd: 80, defaultMaxMd: 160 },
  { code: 'wireless_security_assessment', label: 'Wireless Security Assessment', family: 'Offensive Security', defaultMinMd: 20, defaultStdMd: 40, defaultMaxMd: 100 },
  { code: 'red_team_assessment', label: 'Red Team Assessment', family: 'Offensive Security', defaultMinMd: 150, defaultStdMd: 300, defaultMaxMd: 600 },
  { code: 'purple_team_assessment', label: 'Purple Team Assessment', family: 'Offensive Security', defaultMinMd: 100, defaultStdMd: 200, defaultMaxMd: 400 },
  { code: 'vulnerability_assessment', label: 'Vulnerability Assessment', family: 'Offensive Security', defaultMinMd: 20, defaultStdMd: 40, defaultMaxMd: 100 },
  { code: 'source_code_review', label: 'Source Code Review', family: 'Offensive Security', defaultMinMd: 50, defaultStdMd: 100, defaultMaxMd: 300 },
  { code: 'soc_managed_services', label: 'SOC Managed Services', family: 'Defensive Security', defaultMinMd: 120, defaultStdMd: 240, defaultMaxMd: 1200 },
  { code: 'mdr', label: 'Managed Detection & Response (MDR)', family: 'Defensive Security', defaultMinMd: 100, defaultStdMd: 200, defaultMaxMd: 1000 },
  { code: 'siem_implementation', label: 'SIEM Implementation', family: 'Defensive Security', defaultMinMd: 100, defaultStdMd: 220, defaultMaxMd: 500 },
  { code: 'digital_forensics', label: 'Digital Forensics', family: 'DFIR', defaultMinMd: 50, defaultStdMd: 120, defaultMaxMd: 350 },
  { code: 'incident_response', label: 'Incident Response', family: 'DFIR', defaultMinMd: 40, defaultStdMd: 100, defaultMaxMd: 300 },
  { code: 'cyber_threat_intelligence', label: 'Cyber Threat Intelligence', family: 'CTI', defaultMinMd: 30, defaultStdMd: 60, defaultMaxMd: 240 },
  { code: 'threat_hunting', label: 'Threat Hunting', family: 'Defensive Security', defaultMinMd: 40, defaultStdMd: 80, defaultMaxMd: 200 },
  { code: 'grc_consulting', label: 'GRC Consulting', family: 'GRC & Advisory', defaultMinMd: 60, defaultStdMd: 150, defaultMaxMd: 400 },
  { code: 'iso_27001_consulting', label: 'ISO 27001 Consulting', family: 'GRC & Advisory', defaultMinMd: 100, defaultStdMd: 220, defaultMaxMd: 450 },
  { code: 'data_privacy_consulting', label: 'Data Privacy Consulting (UU PDP)', family: 'GRC & Advisory', defaultMinMd: 80, defaultStdMd: 180, defaultMaxMd: 400 },
  { code: 'it_risk_management', label: 'IT Risk Management', family: 'GRC & Advisory', defaultMinMd: 60, defaultStdMd: 120, defaultMaxMd: 300 },
  { code: 'security_architecture_consulting', label: 'Security Architecture Consulting', family: 'GRC & Advisory', defaultMinMd: 60, defaultStdMd: 140, defaultMaxMd: 320 },
  { code: 'cybersecurity_awareness', label: 'Cybersecurity Awareness', family: 'Training & Awareness', defaultMinMd: 10, defaultStdMd: 25, defaultMaxMd: 80 },
  { code: 'cybersecurity_training', label: 'Cybersecurity Training', family: 'Training & Awareness', defaultMinMd: 20, defaultStdMd: 50, defaultMaxMd: 150 },
  { code: 'security_tool_implementation', label: 'Security Tool Implementation', family: 'Technology & Integration', defaultMinMd: 60, defaultStdMd: 150, defaultMaxMd: 450 },
  { code: 'technology_professional_services', label: 'Technology Professional Services', family: 'Technology & Integration', defaultMinMd: 50, defaultStdMd: 120, defaultMaxMd: 400 },
  { code: 'other_configurable', label: 'Other Configurable Services', family: 'Configurable', defaultMinMd: 10, defaultStdMd: 40, defaultMaxMd: 500 },
] as const;

export type EnterpriseServiceCategory = (typeof ENTERPRISE_SERVICE_CATEGORIES)[number]['code'];

export const STANDARD_ACTIVITY_PHASES = [
  { code: 'presales_assessment', order: 1, label: 'Presales Technical Assessment', defaultBillable: false },
  { code: 'scope_validation', order: 2, label: 'Scope Validation', defaultBillable: true },
  { code: 'preparation', order: 3, label: 'Preparation & Environment Setup', defaultBillable: true },
  { code: 'kickoff', order: 4, label: 'Kickoff Meeting', defaultBillable: true },
  { code: 'technical_execution', order: 5, label: 'Technical Execution', defaultBillable: true },
  { code: 'analysis', order: 6, label: 'Analysis & Validation', defaultBillable: true },
  { code: 'quality_assurance', order: 7, label: 'Quality Assurance & Peer Review', defaultBillable: true },
  { code: 'reporting', order: 8, label: 'Reporting & Remediation Guidance', defaultBillable: true },
  { code: 'presentation', order: 9, label: 'Executive & Technical Presentation', defaultBillable: true },
  { code: 'retest', order: 10, label: 'Retest & Verification', defaultBillable: true },
  { code: 'project_management', order: 11, label: 'Project Management & Governance', defaultBillable: true },
  { code: 'closure', order: 12, label: 'Project Closure & BAST Handover', defaultBillable: true },
] as const;

export type ActivityPhaseCode = (typeof STANDARD_ACTIVITY_PHASES)[number]['code'];

export const COMPLEXITY_TIER_BPS = {
  basic: 7500,     // 0.75x
  standard: 10000, // 1.00x
  medium: 12500,   // 1.25x
  high: 15000,     // 1.50x
  critical: 20000, // 2.00x
} as const;

export type ComplexityTier = keyof typeof COMPLEXITY_TIER_BPS;

export const ENTERPRISE_RESOURCE_ROLES = [
  { code: 'junior_analyst', label: 'Junior Analyst', defaultCreditMultiplierBps: 10000 },
  { code: 'analyst', label: 'Analyst', defaultCreditMultiplierBps: 10000 },
  { code: 'senior_analyst', label: 'Senior Analyst', defaultCreditMultiplierBps: 12500 },
  { code: 'consultant', label: 'Consultant', defaultCreditMultiplierBps: 10000 },
  { code: 'senior_consultant', label: 'Senior Consultant', defaultCreditMultiplierBps: 12500 },
  { code: 'specialist', label: 'Specialist', defaultCreditMultiplierBps: 12500 },
  { code: 'lead_pentester', label: 'Lead Pentester', defaultCreditMultiplierBps: 15000 },
  { code: 'principal_consultant', label: 'Principal Consultant', defaultCreditMultiplierBps: 20000 },
  { code: 'soc_analyst_l1', label: 'SOC Analyst L1', defaultCreditMultiplierBps: 10000 },
  { code: 'soc_analyst_l2', label: 'SOC Analyst L2', defaultCreditMultiplierBps: 12500 },
  { code: 'soc_analyst_l3', label: 'SOC Analyst L3', defaultCreditMultiplierBps: 15000 },
  { code: 'incident_responder', label: 'Incident Responder', defaultCreditMultiplierBps: 20000 },
  { code: 'digital_forensic_specialist', label: 'Digital Forensic Specialist', defaultCreditMultiplierBps: 20000 },
  { code: 'threat_intelligence_analyst', label: 'Threat Intelligence Analyst', defaultCreditMultiplierBps: 12500 },
  { code: 'grc_consultant', label: 'GRC Consultant', defaultCreditMultiplierBps: 12500 },
  { code: 'project_manager', label: 'Project Manager', defaultCreditMultiplierBps: 12500 },
  { code: 'solution_architect', label: 'Solution Architect', defaultCreditMultiplierBps: 15000 },
  { code: 'subject_matter_expert', label: 'Subject Matter Expert', defaultCreditMultiplierBps: 20000 },
  { code: 'external_associate', label: 'External Associate', defaultCreditMultiplierBps: 15000 },
] as const;

export type EnterpriseResourceRole = (typeof ENTERPRISE_RESOURCE_ROLES)[number]['code'];

export const PRICING_METHODS = [
  'cost_plus',
  'target_margin',
  'fixed_price',
  'time_and_material',
  'mandays_based',
  'subscription',
  'retainer',
  'tiered',
  'volume_discount',
  'bundle',
  'value_based',
  'emergency_service',
  'flexguard_credit',
  'hybrid',
] as const;

export type EnterprisePricingMethod = (typeof PRICING_METHODS)[number];

export interface ResourceCostInput {
  monthlyCompensationCents: number;
  benefitAllocationCents?: number;
  employerContribCents?: number;
  allocatedExpenseCents?: number;
  availableWorkingDays?: number;
  targetUtilizationBps?: number;
  targetMarginBps?: number;
  minMarginBps?: number;
}

export interface ResourceCostResult {
  annualLoadedCostCents: number;
  productiveBillableMandaysHundredths: number;
  internalCostPerMandayCents: number;
  standardSellingRateCents: number;
  minSellingRateCents: number;
}

/**
 * Section 6.2 Resource Costing Formula (integer minor units, zero float error):
 * Annual Loaded Resource Cost = (Monthly Comp + Benefits + Employer Contrib + Allocated Expenses) * 12
 * Productive Billable Mandays = Available Working Days * (Target Billable Utilization / 10000)
 * Internal Cost per Manday = Annual Loaded Resource Cost / Productive Billable Mandays
 */
export function calculateLoadedResourceRate(input: ResourceCostInput): ResourceCostResult {
  const monthlyComp = assertNonNegInt(input.monthlyCompensationCents, 'monthlyCompensationCents');
  const benefits = assertNonNegInt(input.benefitAllocationCents ?? 0, 'benefitAllocationCents');
  const employer = assertNonNegInt(input.employerContribCents ?? 0, 'employerContribCents');
  const allocated = assertNonNegInt(input.allocatedExpenseCents ?? 0, 'allocatedExpenseCents');
  const availDays = assertRangeInt(input.availableWorkingDays ?? 240, 100, 300, 'availableWorkingDays');
  const utilBps = assertRangeInt(input.targetUtilizationBps ?? 7500, 3000, 9500, 'targetUtilizationBps');
  const targetMarginBps = assertRangeInt(input.targetMarginBps ?? 4500, 500, 8500, 'targetMarginBps');
  const minMarginBps = assertRangeInt(input.minMarginBps ?? 2500, 0, targetMarginBps, 'minMarginBps');

  const annualLoadedBig = BigInt(monthlyComp + benefits + employer + allocated) * 12n;
  if (annualLoadedBig <= 0n) throw new Error('Annual loaded resource cost must be positive');

  // Productive mandays in hundredths: availDays * utilBps / 100
  const productiveMdHundredths = Math.round((availDays * utilBps) / 100);
  if (productiveMdHundredths <= 0) throw new Error('Productive billable mandays must be positive');

  // Internal Cost per Manday = round(annualLoaded * 100 / productiveMdHundredths)
  const internalCostCents = Number(divRoundBigInt(annualLoadedBig * 100n, BigInt(productiveMdHundredths)));
  const standardSellingRateCents = Number(divRoundBigInt(BigInt(internalCostCents) * 10000n, BigInt(10000 - targetMarginBps)));
  const minSellingRateCents = Number(divRoundBigInt(BigInt(internalCostCents) * 10000n, BigInt(10000 - minMarginBps)));

  return {
    annualLoadedCostCents: Number(annualLoadedBig),
    productiveBillableMandaysHundredths: productiveMdHundredths,
    internalCostPerMandayCents: internalCostCents,
    standardSellingRateCents,
    minSellingRateCents,
  };
}

export interface ActivityEffortItem {
  phaseCode: ActivityPhaseCode;
  activityName: string;
  resourceRole: EnterpriseResourceRole;
  resourceCount: number;
  quantity: number;
  standardHoursPerUnitHundredths: number; // e.g., 800 = 8.00 hours
  minEffortHoursHundredths?: number;
  complexityFactorBps?: number;           // default 10000 (1.00x)
  environmentFactorBps?: number;          // default 10000 (1.00x)
  otherApprovedFactorBps?: number;        // default 10000 (1.00x)
  billable: boolean;
  overtimeHoursHundredths?: number;
  overtimeMultiplierBps?: number;         // default 15000 (1.50x)
  internalCostRateCents: number;          // per manday (8h or configured)
  sellingRateCents?: number;              // per manday
  creditMultiplierBps?: number;           // for FlexGuard equivalent credits
}

export interface ActivityMandaysConfig {
  workingHoursPerManday?: number;         // default 8
  roundingMode?: 'tenth' | 'half_day' | 'whole_day';
  minimumChargeMandaysTenths?: number;   // e.g., 10 = 1.0 MD minimum
  emergencyMode?: boolean;
  emergencyMultiplierBps?: number;        // default 20000 (2.00x)
}

export interface ActivityEffortBreakdownRow {
  phaseCode: ActivityPhaseCode;
  activityName: string;
  resourceRole: EnterpriseResourceRole;
  resourceCount: number;
  billable: boolean;
  baseEffortHoursHundredths: number;
  adjustedEffortHoursHundredths: number;
  estimatedMandaysTenths: number;
  calendarDaysEstimateTenths: number;
  directLaborCostCents: number;
  baselineSellingCents: number;
  flexguardCreditsHundredths: number;
}

export interface ActivityMandaysResult {
  workingHoursPerManday: number;
  totalBaseHoursHundredths: number;
  totalAdjustedHoursHundredths: number;
  totalBillableMandaysTenths: number;
  totalNonBillableMandaysTenths: number;
  totalPersonDaysTenths: number;
  estimatedCalendarDaysTenths: number;
  totalDirectLaborCostCents: number;
  totalBaselineSellingCents: number;
  totalFlexGuardCredits: number;
  breakdown: ActivityEffortBreakdownRow[];
}

/**
 * Section 5.3 Activity-Based Mandays Estimation:
 * Base Effort Hours = Quantity * Standard Hours per Unit * Resource Count (person-hours)
 * Adjusted Effort Hours = Base Effort Hours * Complexity * Environment * Other Approved Factors
 * Estimated Mandays = Adjusted Effort Hours / Working Hours per Manday (person-days, NOT calendar duration)
 */
export function calculateActivityBasedMandays(
  activities: readonly ActivityEffortItem[],
  config: ActivityMandaysConfig = {},
): ActivityMandaysResult {
  if (!activities.length) throw new Error('At least one activity is required for mandays estimation');
  const hoursPerMd = assertRangeInt(config.workingHoursPerManday ?? 8, 4, 12, 'workingHoursPerManday');
  const rounding = config.roundingMode ?? 'tenth';
  const minChargeTenths = assertNonNegInt(config.minimumChargeMandaysTenths ?? 0, 'minimumChargeMandaysTenths');
  const emergencyMultBps = config.emergencyMode
    ? assertRangeInt(config.emergencyMultiplierBps ?? 20000, 10000, 40000, 'emergencyMultiplierBps')
    : 10000;

  let totalBaseHoursH = 0;
  let totalAdjHoursH = 0;
  let totalBillableTenths = 0;
  let totalNonBillableTenths = 0;
  let totalCalendarTenths = 0;
  let totalLaborCostCents = 0n;
  let totalSellingCents = 0n;
  let totalCreditsH = 0n;

  const breakdown: ActivityEffortBreakdownRow[] = [];

  for (const act of activities) {
    const resCount = assertRangeInt(act.resourceCount, 1, 50, 'resourceCount');
    const qty = assertNonNegInt(act.quantity, 'quantity');
    const stdHrsH = assertNonNegInt(act.standardHoursPerUnitHundredths, 'standardHoursPerUnitHundredths');
    const minHrsH = assertNonNegInt(act.minEffortHoursHundredths ?? 0, 'minEffortHoursHundredths');
    const cBps = assertRangeInt(act.complexityFactorBps ?? 10000, 5000, 40000, 'complexityFactorBps');
    const eBps = assertRangeInt(act.environmentFactorBps ?? 10000, 5000, 30000, 'environmentFactorBps');
    const oBps = assertRangeInt(act.otherApprovedFactorBps ?? 10000, 5000, 30000, 'otherApprovedFactorBps');
    const otHrsH = assertNonNegInt(act.overtimeHoursHundredths ?? 0, 'overtimeHoursHundredths');
    const otMultBps = assertRangeInt(act.overtimeMultiplierBps ?? 15000, 10000, 30000, 'overtimeMultiplierBps');
    const costRate = assertNonNegInt(act.internalCostRateCents, 'internalCostRateCents');
    const sellRate = assertNonNegInt(act.sellingRateCents ?? costRate, 'sellingRateCents');
    const creditMultBps = assertRangeInt(act.creditMultiplierBps ?? 10000, 5000, 40000, 'creditMultiplierBps');

    const baseHoursH = qty * stdHrsH * resCount;
    const rawAdj = Number(
      divRoundBigInt(
        BigInt(baseHoursH) * BigInt(cBps) * BigInt(eBps) * BigInt(oBps),
        10000n * 10000n * 10000n,
      ),
    );
    const adjustedHoursH = Math.max(rawAdj, minHrsH);
    const rawTenths = Math.ceil((adjustedHoursH * 10) / (hoursPerMd * 100));
    const mandaysTenths = roundMandaysTenths(rawTenths, rounding);
    const calendarTenths = Math.ceil(mandaysTenths / resCount);

    // Direct labor cost = regular mandays * costRate + overtime equivalent * costRate * otMult
    const regularCost = divRoundBigInt(BigInt(mandaysTenths) * BigInt(costRate) * BigInt(emergencyMultBps), 10n * 10000n);
    const overtimeCost = otHrsH > 0
      ? divRoundBigInt(BigInt(otHrsH) * BigInt(costRate) * BigInt(otMultBps), BigInt(hoursPerMd * 100) * 10000n)
      : 0n;
    const lineCost = regularCost + overtimeCost;

    const lineSell = act.billable
      ? divRoundBigInt(BigInt(mandaysTenths) * BigInt(sellRate) * BigInt(emergencyMultBps), 10n * 10000n) +
        (otHrsH > 0 ? divRoundBigInt(BigInt(otHrsH) * BigInt(sellRate) * BigInt(otMultBps), BigInt(hoursPerMd * 100) * 10000n) : 0n)
      : 0n;

    // FlexGuard credits (hundredths): billable mandays * creditMultiplier * emergencyMultiplier
    const effectiveCreditMultBps = Math.max(creditMultBps, emergencyMultBps);
    const lineCreditsH = act.billable
      ? divRoundBigInt(BigInt(mandaysTenths) * 10n * BigInt(effectiveCreditMultBps), 10000n)
      : 0n;

    totalBaseHoursH += baseHoursH;
    totalAdjHoursH += adjustedHoursH;
    if (act.billable) totalBillableTenths += mandaysTenths;
    else totalNonBillableTenths += mandaysTenths;
    totalCalendarTenths += calendarTenths;
    totalLaborCostCents += lineCost;
    totalSellingCents += lineSell;
    totalCreditsH += lineCreditsH;

    breakdown.push({
      phaseCode: act.phaseCode,
      activityName: act.activityName,
      resourceRole: act.resourceRole,
      resourceCount: resCount,
      billable: act.billable,
      baseEffortHoursHundredths: baseHoursH,
      adjustedEffortHoursHundredths: adjustedHoursH,
      estimatedMandaysTenths: mandaysTenths,
      calendarDaysEstimateTenths: calendarTenths,
      directLaborCostCents: Number(lineCost),
      baselineSellingCents: Number(lineSell),
      flexguardCreditsHundredths: Number(lineCreditsH),
    });
  }

  const finalBillableTenths = Math.max(totalBillableTenths, minChargeTenths);
  const totalPersonDaysTenths = finalBillableTenths + totalNonBillableTenths;
  const totalFlexGuardCredits = Math.ceil(Number(totalCreditsH) / 100);

  return {
    workingHoursPerManday: hoursPerMd,
    totalBaseHoursHundredths: totalBaseHoursH,
    totalAdjustedHoursHundredths: totalAdjHoursH,
    totalBillableMandaysTenths: finalBillableTenths,
    totalNonBillableMandaysTenths: totalNonBillableTenths,
    totalPersonDaysTenths,
    estimatedCalendarDaysTenths: totalCalendarTenths,
    totalDirectLaborCostCents: Number(totalLaborCostCents),
    totalBaselineSellingCents: Number(totalSellingCents),
    totalFlexGuardCredits,
    breakdown,
  };
}

export interface EnterprisePricingInput {
  pricingMethod: EnterprisePricingMethod;
  directLaborCostCents: number;
  toolsCostCents?: number;
  licenseCostCents?: number;
  travelCostCents?: number;
  thirdPartyCostCents?: number;
  otherDirectCostCents?: number;
  overheadAllocationBps?: number;       // applied to direct cost, avoiding utilization double count
  riskContingencyBps?: number;          // applied to direct cost
  targetMarginBps: number;              // e.g., 3500 = 35%
  minAcceptableMarginBps?: number;      // e.g., 2000 = 20%
  discountBps?: number;                 // e.g., 500 = 5%
  taxRateBps?: number;                  // e.g., 1100 = 11% PPN (configurable)
  fxRateMicro?: number;                 // 1_000_000 = 1.000000
  customSellingPriceCents?: number;     // for fixed_price / value_based override
  flexguardCreditsEquivalent?: number;
  flexguardCreditUnitPriceCents?: number;
  isStrategicCustomer?: boolean;
  paymentTermDays?: number;
  creditRiskHigh?: boolean;
  exceptionalTerms?: boolean;
}

export type PricingApprovalLevel = 'none' | 'sales_manager' | 'pricing_manager' | 'finance_manager' | 'director' | 'ceo';

export interface EnterprisePricingResult {
  pricingMethod: EnterprisePricingMethod;
  directLaborCostCents: number;
  totalDirectCostCents: number;
  overheadCents: number;
  riskContingencyCents: number;
  fullyLoadedCostCents: number;
  breakEvenPriceCents: number;
  minSellingPriceCents: number;
  targetSellingPriceCents: number;
  grossSellingPriceCents: number;
  discountAmountCents: number;
  netSellingPriceCents: number;
  taxAmountCents: number;
  totalWithTaxCents: number;
  // Separate margin bases per Section 6.3
  directGrossProfitCents: number;
  directGrossMarginBps: number;
  fullyLoadedProfitCents: number;
  fullyLoadedMarginBps: number;
  convertedNetPriceCents: number;
  negativeMarginBlocked: boolean;
  belowMinimumPrice: boolean;
  approvalRequiredLevel: PricingApprovalLevel;
  approvalReasons: string[];
  flexguardComparison: {
    creditsRequired: number;
    flexguardPriceCents: number;
    savingsVsFixedCents: number;
  };
}

/**
 * Section 6.3, 6.4, 6.5 Enterprise Service Pricing Engine:
 * Total Direct Cost = Direct Labor + Tools + License + Travel + Third Party + Other Direct
 * Fully Loaded Cost = Total Direct Cost + Allocated Overhead + Risk Contingency
 * Target Selling Price = Fully Loaded Cost / (1 - Target Margin)
 * Separates Direct Gross Margin from Fully Loaded Contribution Margin.
 */
export function calculateEnterpriseServicePricing(input: EnterprisePricingInput): EnterprisePricingResult {
  const labor = assertNonNegInt(input.directLaborCostCents, 'directLaborCostCents');
  const tools = assertNonNegInt(input.toolsCostCents ?? 0, 'toolsCostCents');
  const license = assertNonNegInt(input.licenseCostCents ?? 0, 'licenseCostCents');
  const travel = assertNonNegInt(input.travelCostCents ?? 0, 'travelCostCents');
  const thirdParty = assertNonNegInt(input.thirdPartyCostCents ?? 0, 'thirdPartyCostCents');
  const otherDirect = assertNonNegInt(input.otherDirectCostCents ?? 0, 'otherDirectCostCents');
  const overheadBps = assertRangeInt(input.overheadAllocationBps ?? 1000, 0, 6000, 'overheadAllocationBps');
  const contingencyBps = assertRangeInt(input.riskContingencyBps ?? 500, 0, 5000, 'riskContingencyBps');
  const targetMarginBps = assertRangeInt(input.targetMarginBps, 0, 9000, 'targetMarginBps');
  const minMarginBps = assertRangeInt(input.minAcceptableMarginBps ?? 2000, 0, 8500, 'minAcceptableMarginBps');
  const discountBps = assertRangeInt(input.discountBps ?? 0, 0, 8000, 'discountBps');
  const taxRateBps = assertRangeInt(input.taxRateBps ?? 1100, 0, 5000, 'taxRateBps');
  const fxMicro = assertRangeInt(input.fxRateMicro ?? 1_000_000, 1, 100_000_000_000, 'fxRateMicro');

  const totalDirectCostCents = labor + tools + license + travel + thirdParty + otherDirect;
  if (totalDirectCostCents <= 0) throw new Error('Total direct cost must be positive');

  const overheadCents = Number(divRoundBigInt(BigInt(totalDirectCostCents) * BigInt(overheadBps), 10000n));
  const riskContingencyCents = Number(divRoundBigInt(BigInt(totalDirectCostCents) * BigInt(contingencyBps), 10000n));
  const fullyLoadedCostCents = totalDirectCostCents + overheadCents + riskContingencyCents;
  const breakEvenPriceCents = fullyLoadedCostCents;

  const targetSellingPriceCents = input.pricingMethod === 'cost_plus'
    ? Number(divRoundBigInt(BigInt(fullyLoadedCostCents) * BigInt(10000 + targetMarginBps), 10000n))
    : Number(divRoundBigInt(BigInt(fullyLoadedCostCents) * 10000n, BigInt(10000 - targetMarginBps)));

  const minSellingPriceCents = Number(divRoundBigInt(BigInt(fullyLoadedCostCents) * 10000n, BigInt(10000 - minMarginBps)));

  let grossSellingPriceCents = targetSellingPriceCents;
  if (input.customSellingPriceCents !== undefined) {
    grossSellingPriceCents = assertNonNegInt(input.customSellingPriceCents, 'customSellingPriceCents');
    if (grossSellingPriceCents <= 0) throw new Error('Custom selling price must be positive');
  } else if (input.pricingMethod === 'emergency_service') {
    grossSellingPriceCents = Number(divRoundBigInt(BigInt(targetSellingPriceCents) * 12500n, 10000n));
  }

  const discountAmountCents = Number(divRoundBigInt(BigInt(grossSellingPriceCents) * BigInt(discountBps), 10000n));
  const netSellingPriceCents = grossSellingPriceCents - discountAmountCents;

  const directGrossProfitCents = netSellingPriceCents - totalDirectCostCents;
  const directGrossMarginBps = netSellingPriceCents > 0
    ? Number(divRoundBigInt(BigInt(directGrossProfitCents) * 10000n, BigInt(netSellingPriceCents)))
    : -10000;

  const fullyLoadedProfitCents = netSellingPriceCents - fullyLoadedCostCents;
  const fullyLoadedMarginBps = netSellingPriceCents > 0
    ? Number(divRoundBigInt(BigInt(fullyLoadedProfitCents) * 10000n, BigInt(netSellingPriceCents)))
    : -10000;

  const negativeMarginBlocked = fullyLoadedProfitCents < 0 || netSellingPriceCents < breakEvenPriceCents;
  const belowMinimumPrice = netSellingPriceCents < minSellingPriceCents;

  const taxAmountCents = Number(divRoundBigInt(BigInt(netSellingPriceCents) * BigInt(taxRateBps), 10000n));
  const totalWithTaxCents = netSellingPriceCents + taxAmountCents;
  const convertedNetPriceCents = Number(divRoundBigInt(BigInt(netSellingPriceCents) * BigInt(fxMicro), 1_000_000n));

  const approval = evaluatePricingApprovalPolicy({
    contractValueCents: netSellingPriceCents,
    discountBps,
    fullyLoadedMarginBps,
    minAcceptableMarginBps: minMarginBps,
    belowMinimumPrice,
    negativeMarginBlocked,
    isStrategicCustomer: Boolean(input.isStrategicCustomer),
    paymentTermDays: input.paymentTermDays ?? 30,
    creditRiskHigh: Boolean(input.creditRiskHigh),
    exceptionalTerms: Boolean(input.exceptionalTerms),
  });

  const creditsReq = Math.max(0, Math.round(input.flexguardCreditsEquivalent ?? 0));
  const creditPrice = Math.max(0, Math.round(input.flexguardCreditUnitPriceCents ?? 450_000_000)); // default Rp 4.5M/credit
  const flexguardPriceCents = creditsReq * creditPrice;

  return {
    pricingMethod: input.pricingMethod,
    directLaborCostCents: labor,
    totalDirectCostCents,
    overheadCents,
    riskContingencyCents,
    fullyLoadedCostCents,
    breakEvenPriceCents,
    minSellingPriceCents,
    targetSellingPriceCents,
    grossSellingPriceCents,
    discountAmountCents,
    netSellingPriceCents,
    taxAmountCents,
    totalWithTaxCents,
    directGrossProfitCents,
    directGrossMarginBps,
    fullyLoadedProfitCents,
    fullyLoadedMarginBps,
    convertedNetPriceCents,
    negativeMarginBlocked,
    belowMinimumPrice,
    approvalRequiredLevel: approval.level,
    approvalReasons: approval.reasons,
    flexguardComparison: {
      creditsRequired: creditsReq,
      flexguardPriceCents,
      savingsVsFixedCents: netSellingPriceCents - flexguardPriceCents,
    },
  };
}

export interface ApprovalPolicyInput {
  contractValueCents: number;
  discountBps: number;
  fullyLoadedMarginBps: number;
  minAcceptableMarginBps: number;
  belowMinimumPrice: boolean;
  negativeMarginBlocked: boolean;
  isStrategicCustomer?: boolean;
  paymentTermDays?: number;
  creditRiskHigh?: boolean;
  exceptionalTerms?: boolean;
}

const LEVEL_RANK: Record<PricingApprovalLevel, number> = {
  none: 0,
  sales_manager: 1,
  pricing_manager: 2,
  finance_manager: 3,
  director: 4,
  ceo: 5,
};

export function evaluatePricingApprovalPolicy(p: ApprovalPolicyInput): { level: PricingApprovalLevel; reasons: string[] } {
  let level: PricingApprovalLevel = 'none';
  const reasons: string[] = [];
  const bump = (next: PricingApprovalLevel, reason: string) => {
    reasons.push(reason);
    if (LEVEL_RANK[next] > LEVEL_RANK[level]) level = next;
  };

  if (p.negativeMarginBlocked) bump('ceo', 'Negative margin below break-even is blocked by policy');
  if (p.belowMinimumPrice || p.fullyLoadedMarginBps < p.minAcceptableMarginBps) {
    bump('director', `Fully loaded margin (${(p.fullyLoadedMarginBps / 100).toFixed(2)}%) below minimum acceptable floor (${(p.minAcceptableMarginBps / 100).toFixed(2)}%)`);
  }
  if (p.discountBps > 1500) bump('director', `Discount ${(p.discountBps / 100).toFixed(2)}% exceeds 15% threshold`);
  else if (p.discountBps > 1000) bump('finance_manager', `Discount ${(p.discountBps / 100).toFixed(2)}% exceeds 10% threshold`);
  else if (p.discountBps > 500) bump('sales_manager', `Discount ${(p.discountBps / 100).toFixed(2)}% exceeds 5% threshold`);

  // Contract value thresholds (IDR minor units: 100 cents = 1 IDR)
  if (p.contractValueCents >= 5_000_000_000_00) bump('ceo', 'Contract value >= Rp 5 Billion requires CEO approval');
  else if (p.contractValueCents >= 1_000_000_000_00) bump('director', 'Contract value >= Rp 1 Billion requires Director approval');
  else if (p.contractValueCents >= 250_000_000_00) bump('finance_manager', 'Contract value >= Rp 250 Million requires Finance Manager approval');
  else if (p.contractValueCents >= 50_000_000_00) bump('pricing_manager', 'Contract value >= Rp 50 Million requires Pricing Manager review');

  if (p.isStrategicCustomer) bump('director', 'Strategic customer pricing requires Director sign-off');
  if ((p.paymentTermDays ?? 30) > 60) bump('finance_manager', `Payment terms (${p.paymentTermDays} days) exceed 60-day standard`);
  if (p.creditRiskHigh) bump('finance_manager', 'High customer credit risk requires Finance Manager review');
  if (p.exceptionalTerms) bump('director', 'Exceptional commercial terms require Director approval');

  return { level, reasons };
}

export interface HistoricalBenchmarkInput {
  plannedMandaysTenths: number;
  actualMandaysTenths: number;
  estimatedCostCents: number;
  actualCostCents: number;
  estimatedMarginBps: number;
  actualMarginBps: number;
  retestCount?: number;
  scopeChangesCount?: number;
}

/**
 * Section 5.5 Historical Learning — computes bounded shrinkage recommendation
 * WITHOUT mutating any active standard mandays or rate card automatically.
 */
export function computeHistoricalEffortRecommendation(
  currentStandardMandaysTenths: number,
  samples: readonly HistoricalBenchmarkInput[],
): {
  sampleCount: number;
  avgVarianceBps: number;
  avgCostVarianceBps: number;
  recommendedMandaysTenths: number;
  requiresApproval: true;
  autoApplied: false;
} {
  if (!samples.length) {
    return {
      sampleCount: 0,
      avgVarianceBps: 0,
      avgCostVarianceBps: 0,
      recommendedMandaysTenths: currentStandardMandaysTenths,
      requiresApproval: true,
      autoApplied: false,
    };
  }
  let sumVarBps = 0;
  let sumCostVarBps = 0;
  for (const s of samples) {
    const mdVar = Math.round(((s.actualMandaysTenths - s.plannedMandaysTenths) * 10000) / Math.max(1, s.plannedMandaysTenths));
    const cVar = Math.round(((s.actualCostCents - s.estimatedCostCents) * 10000) / Math.max(1, s.estimatedCostCents));
    sumVarBps += mdVar;
    sumCostVarBps += cVar;
  }
  const avgVarianceBps = Math.round(sumVarBps / samples.length);
  const avgCostVarianceBps = Math.round(sumCostVarBps / samples.length);
  // Empirical Bayes shrinkage weight: n / (n + 5), bounded to [-30%, +40%]
  const weight = samples.length / (samples.length + 5);
  const boundedDeltaBps = Math.max(-3000, Math.min(4000, Math.round(avgVarianceBps * weight)));
  const recommendedMandaysTenths = Math.max(5, Math.round((currentStandardMandaysTenths * (10000 + boundedDeltaBps)) / 10000));

  return {
    sampleCount: samples.length,
    avgVarianceBps,
    avgCostVarianceBps,
    recommendedMandaysTenths,
    requiresApproval: true,
    autoApplied: false,
  };
}

function roundMandaysTenths(rawTenths: number, mode: 'tenth' | 'half_day' | 'whole_day'): number {
  if (rawTenths <= 0) return 0;
  if (mode === 'half_day') return Math.ceil(rawTenths / 5) * 5;
  if (mode === 'whole_day') return Math.ceil(rawTenths / 10) * 10;
  return rawTenths;
}

function divRoundBigInt(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new Error('Division by zero');
  const sign = (num < 0n) !== (den < 0n) ? -1n : 1n;
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  return sign * ((a + b / 2n) / b);
}

function assertNonNegInt(n: number, name: string): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

function assertRangeInt(n: number, min: number, max: number, name: string): number {
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return n;
}
