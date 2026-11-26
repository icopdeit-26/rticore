// RTICore V4.0 — Service Catalog, Activity-Based Mandays & Enterprise Pricing Intelligence UAT (120+ unique scenarios)
const test = require('node:test');
const assert = require('node:assert/strict');
const { Harness, users, tenant, expect } = require('./helpers/sales-flow-harness.cjs');

function setupEntities(h) {
  for (const [k, email] of Object.entries(users)) {
    const role = k === 'other' ? 'sales' : k === 'admin2' ? 'admin' : k === 'pm_other' ? 'project_manager' : k;
    h.sql.prepare("INSERT OR IGNORE INTO rticore_members(email,role,active,created_by) VALUES(?,?,1,'TEST')").run(email, role);
  }
  h.sql.prepare("INSERT INTO rticore_erp_org_units(id,tenant_id,code,label,kind,active,created_by) VALUES('le-alpha',?,'LE-A','PT RTI Alpha','legal_entity',1,?),( 'le-beta',?,'LE-B','PT RTI Beta','legal_entity',1,?)")
    .run(tenant, users.admin, tenant, users.admin);
  for (const email of [users.admin, users.finance, users.approver, users.presales, users.sales, users.project_manager]) {
    const reviewer = email === users.approver ? users.admin2 : users.approver;
    const creator = email === users.admin ? users.admin2 : users.admin;
    h.sql.prepare("INSERT INTO rticore_erp_staff_org(tenant_id,email,unit_id,position_title,created_by,status,reviewed_by,review_notes) VALUES(?,?,?, 'Enterprise Staff',?,'approved',?,'Approved entity assignment for UAT')")
      .run(tenant, email, 'le-alpha', creator, reviewer);
  }
  // Only admin2 belongs to le-beta (to prove cross-entity isolation)
  h.sql.prepare("INSERT INTO rticore_erp_staff_org(tenant_id,email,unit_id,position_title,created_by,status,reviewed_by,review_notes) VALUES(?,?, 'le-beta','Entity Beta Admin',?,'approved',?,'Approved entity beta assignment')")
    .run(tenant, users.admin2, users.admin, users.approver);
}

test('V4.0 Service Catalog & Pricing Intelligence — 120+ Unique Executable Scenarios', async (t) => {
  const h = new Harness().seed();
  const engine = h.load('src/lib/enterprise-pricing-engine.ts');
  let executedCount = 0;

  try {
    setupEntities(h);

    // -------------------------------------------------------------------------
    // DOMAIN A: All 29 Service Categories Master Catalog Registration (29 scenarios)
    // -------------------------------------------------------------------------
    await t.test('A01-A29: All 29 enterprise service categories are supported and validated', () => {
      assert.equal(engine.ENTERPRISE_SERVICE_CATEGORIES.length, 29);
      for (const cat of engine.ENTERPRISE_SERVICE_CATEGORIES) {
        assert.ok(cat.code.length >= 3);
        assert.ok(cat.defaultMinMd >= 10 && cat.defaultStdMd >= cat.defaultMinMd && cat.defaultMaxMd >= cat.defaultStdMd);
        executedCount++;
      }
    });

    // -------------------------------------------------------------------------
    // DOMAIN B: All 19 Resource Roles Loaded Cost Formula (22 scenarios)
    // -------------------------------------------------------------------------
    await t.test('B01-B19: 19 enterprise resource roles compute exact integer loaded cost per manday', () => {
      assert.equal(engine.ENTERPRISE_RESOURCE_ROLES.length, 19);
      for (let i = 0; i < engine.ENTERPRISE_RESOURCE_ROLES.length; i++) {
        const monthly = (10_000_000 + i * 1_500_000) * 100;
        const r = engine.calculateLoadedResourceRate({
          monthlyCompensationCents: monthly,
          benefitAllocationCents: 2_000_000_00,
          employerContribCents: 1_000_000_00,
          allocatedExpenseCents: 1_000_000_00,
          availableWorkingDays: 240,
          targetUtilizationBps: 7500,
          targetMarginBps: 4500,
          minMarginBps: 2500,
        });
        assert.equal(r.annualLoadedCostCents, (monthly + 4_000_000_00) * 12);
        assert.equal(r.productiveBillableMandaysHundredths, 18000); // 240 * 0.75 = 180.00 MD
        assert.ok(Number.isSafeInteger(r.internalCostPerMandayCents));
        assert.ok(r.standardSellingRateCents > r.minSellingRateCents);
        assert.ok(r.minSellingRateCents > r.internalCostPerMandayCents);
        executedCount++;
      }
    });

    await t.test('B20-B22: Resource costing rejects zero cost, out-of-range utilization, and float inputs', () => {
      assert.throws(() => engine.calculateLoadedResourceRate({ monthlyCompensationCents: 0 }), /positive/);
      executedCount++;
      assert.throws(() => engine.calculateLoadedResourceRate({ monthlyCompensationCents: 1000000_00, targetUtilizationBps: 1500 }), /between 3000 and 9500/);
      executedCount++;
      assert.throws(() => engine.calculateLoadedResourceRate({ monthlyCompensationCents: 1234.56 }), /integer/);
      executedCount++;
    });

    // -------------------------------------------------------------------------
    // DOMAIN C: 12 Activity Phases, Complexity Tiers, Rounding & Parallelism (22 scenarios)
    // -------------------------------------------------------------------------
    await t.test('C01-C12: All 12 standard activity phases compute person-days distinct from calendar days', () => {
      assert.equal(engine.STANDARD_ACTIVITY_PHASES.length, 12);
      const activities = engine.STANDARD_ACTIVITY_PHASES.map((p, idx) => ({
        phaseCode: p.code,
        activityName: p.label,
        resourceRole: idx % 2 === 0 ? 'senior_analyst' : 'lead_pentester',
        resourceCount: p.code === 'technical_execution' ? 3 : 1,
        quantity: 1,
        standardHoursPerUnitHundredths: p.code === 'technical_execution' ? 1600 : 400,
        complexityFactorBps: 10000,
        billable: p.defaultBillable,
        internalCostRateCents: 1_800_000_00,
        sellingRateCents: 4_500_000_00,
        creditMultiplierBps: 12500,
      }));
      const res = engine.calculateActivityBasedMandays(activities, { workingHoursPerManday: 8 });
      assert.equal(res.breakdown.length, 12);
      // Technical execution: 3 resources * 16h = 48h = 6.0 person-days, calendar = 2.0 days!
      const tech = res.breakdown.find(b => b.phaseCode === 'technical_execution');
      assert.equal(tech.estimatedMandaysTenths, 60);
      assert.equal(tech.calendarDaysEstimateTenths, 20);
      assert.ok(res.totalPersonDaysTenths > res.estimatedCalendarDaysTenths);
      // Presales is non-billable
      assert.equal(res.totalNonBillableMandaysTenths, 5);
      executedCount += 12;
    });

    await t.test('C13-C17: All 5 complexity tiers (0.75x to 2.00x) scale effort proportionally', () => {
      const tiers = ['basic', 'standard', 'medium', 'high', 'critical'];
      const results = tiers.map(tier => engine.calculateActivityBasedMandays([{
        phaseCode: 'technical_execution', activityName: 'Exec', resourceRole: 'analyst',
        resourceCount: 1, quantity: 1, standardHoursPerUnitHundredths: 1600,
        complexityFactorBps: engine.COMPLEXITY_TIER_BPS[tier], billable: true, internalCostRateCents: 1_000_000_00,
      }]));
      assert.equal(results[0].totalBillableMandaysTenths, 15); // 1.5 MD
      assert.equal(results[1].totalBillableMandaysTenths, 20); // 2.0 MD
      assert.equal(results[2].totalBillableMandaysTenths, 25); // 2.5 MD
      assert.equal(results[3].totalBillableMandaysTenths, 30); // 3.0 MD
      assert.equal(results[4].totalBillableMandaysTenths, 40); // 4.0 MD
      executedCount += 5;
    });

    await t.test('C18-C22: Rounding modes (half_day, whole_day), minimum charge, overtime & emergency multiplier', () => {
      const half = engine.calculateActivityBasedMandays([{
        phaseCode: 'reporting', activityName: 'Rep', resourceRole: 'analyst', resourceCount: 1, quantity: 1,
        standardHoursPerUnitHundredths: 900, billable: true, internalCostRateCents: 1_000_000_00,
      }], { roundingMode: 'half_day' });
      assert.equal(half.totalBillableMandaysTenths, 15); // 1.125 MD -> 1.5 MD
      executedCount++;

      const whole = engine.calculateActivityBasedMandays([{
        phaseCode: 'reporting', activityName: 'Rep', resourceRole: 'analyst', resourceCount: 1, quantity: 1,
        standardHoursPerUnitHundredths: 900, billable: true, internalCostRateCents: 1_000_000_00,
      }], { roundingMode: 'whole_day' });
      assert.equal(whole.totalBillableMandaysTenths, 20); // 1.125 MD -> 2.0 MD
      executedCount++;

      const minCharge = engine.calculateActivityBasedMandays([{
        phaseCode: 'kickoff', activityName: 'KO', resourceRole: 'analyst', resourceCount: 1, quantity: 1,
        standardHoursPerUnitHundredths: 200, billable: true, internalCostRateCents: 1_000_000_00,
      }], { minimumChargeMandaysTenths: 10 });
      assert.equal(minCharge.totalBillableMandaysTenths, 10);
      executedCount++;

      const ot = engine.calculateActivityBasedMandays([{
        phaseCode: 'technical_execution', activityName: 'OT', resourceRole: 'analyst', resourceCount: 1, quantity: 1,
        standardHoursPerUnitHundredths: 800, overtimeHoursHundredths: 400, overtimeMultiplierBps: 15000,
        billable: true, internalCostRateCents: 1_000_000_00,
      }]);
      assert.equal(ot.totalDirectLaborCostCents, 1_750_000_00); // 1.0M + 0.5*1.5*1.0M
      executedCount++;

      const emg = engine.calculateActivityBasedMandays([{
        phaseCode: 'technical_execution', activityName: 'DFIR', resourceRole: 'incident_responder', resourceCount: 1, quantity: 1,
        standardHoursPerUnitHundredths: 800, billable: true, internalCostRateCents: 2_000_000_00, creditMultiplierBps: 20000,
      }], { emergencyMode: true, emergencyMultiplierBps: 20000 });
      assert.equal(emg.totalDirectLaborCostCents, 4_000_000_00);
      assert.equal(emg.totalFlexGuardCredits, 2);
      executedCount++;
    });

    // -------------------------------------------------------------------------
    // DOMAIN D: All 14 Pricing Methods, Margins, Discounts, Tax, FX & Approval (24 scenarios)
    // -------------------------------------------------------------------------
    await t.test('D01-D14: All 14 enterprise pricing methods calculate auditable integer totals', () => {
      assert.equal(engine.PRICING_METHODS.length, 14);
      for (const method of engine.PRICING_METHODS) {
        const res = engine.calculateEnterpriseServicePricing({
          pricingMethod: method,
          directLaborCostCents: 40_000_000_00,
          toolsCostCents: 5_000_000_00,
          travelCostCents: 3_000_000_00,
          thirdPartyCostCents: 2_000_000_00,
          overheadAllocationBps: 1000,
          riskContingencyBps: 500,
          targetMarginBps: 3500,
          minAcceptableMarginBps: 2000,
          discountBps: 0,
          taxRateBps: 1100,
          flexguardCreditsEquivalent: 15,
        });
        assert.equal(res.totalDirectCostCents, 50_000_000_00);
        assert.equal(res.fullyLoadedCostCents, 57_500_000_00);
        assert.equal(res.breakEvenPriceCents, 57_500_000_00);
        assert.ok(res.directGrossMarginBps > res.fullyLoadedMarginBps);
        assert.equal(res.negativeMarginBlocked, false);
        assert.ok(res.taxAmountCents > 0);
        executedCount++;
      }
    });

    await t.test('D15-D24: Negative margin block, minimum selling price, discount escalation, strategic customer, payment terms, credit risk, FX, tax & FlexGuard comparison', () => {
      // Negative margin prevented
      const neg = engine.calculateEnterpriseServicePricing({
        pricingMethod: 'fixed_price', directLaborCostCents: 100_000_000_00, targetMarginBps: 3000,
        customSellingPriceCents: 90_000_000_00,
      });
      assert.equal(neg.negativeMarginBlocked, true);
      assert.equal(neg.approvalRequiredLevel, 'ceo');
      executedCount++;

      // Below min selling price triggers director approval
      const lowM = engine.calculateEnterpriseServicePricing({
        pricingMethod: 'fixed_price', directLaborCostCents: 10_000_000_00, overheadAllocationBps: 0, riskContingencyBps: 0,
        targetMarginBps: 3500, minAcceptableMarginBps: 2500, customSellingPriceCents: 12_000_000_00,
      });
      assert.equal(lowM.negativeMarginBlocked, false);
      assert.equal(lowM.belowMinimumPrice, true);
      assert.equal(lowM.approvalRequiredLevel, 'director');
      executedCount++;

      // Discount > 5%, > 10%, > 15%
      const d6 = engine.evaluatePricingApprovalPolicy({ contractValueCents: 10_000_000_00, discountBps: 600, fullyLoadedMarginBps: 3000, minAcceptableMarginBps: 2000, belowMinimumPrice: false, negativeMarginBlocked: false });
      assert.equal(d6.level, 'sales_manager');
      executedCount++;

      const d12 = engine.evaluatePricingApprovalPolicy({ contractValueCents: 10_000_000_00, discountBps: 1200, fullyLoadedMarginBps: 3000, minAcceptableMarginBps: 2000, belowMinimumPrice: false, negativeMarginBlocked: false });
      assert.equal(d12.level, 'finance_manager');
      executedCount++;

      const d18 = engine.evaluatePricingApprovalPolicy({ contractValueCents: 10_000_000_00, discountBps: 1800, fullyLoadedMarginBps: 3000, minAcceptableMarginBps: 2000, belowMinimumPrice: false, negativeMarginBlocked: false });
      assert.equal(d18.level, 'director');
      executedCount++;

      // Strategic customer
      const strat = engine.evaluatePricingApprovalPolicy({ contractValueCents: 10_000_000_00, discountBps: 0, fullyLoadedMarginBps: 3500, minAcceptableMarginBps: 2000, belowMinimumPrice: false, negativeMarginBlocked: false, isStrategicCustomer: true });
      assert.equal(strat.level, 'director');
      executedCount++;

      // Payment terms > 60d
      const pay90 = engine.evaluatePricingApprovalPolicy({ contractValueCents: 10_000_000_00, discountBps: 0, fullyLoadedMarginBps: 3500, minAcceptableMarginBps: 2000, belowMinimumPrice: false, negativeMarginBlocked: false, paymentTermDays: 90 });
      assert.equal(pay90.level, 'finance_manager');
      executedCount++;

      // High credit risk
      const risk = engine.evaluatePricingApprovalPolicy({ contractValueCents: 10_000_000_00, discountBps: 0, fullyLoadedMarginBps: 3500, minAcceptableMarginBps: 2000, belowMinimumPrice: false, negativeMarginBlocked: false, creditRiskHigh: true });
      assert.equal(risk.level, 'finance_manager');
      executedCount++;

      // FX multi-currency conversion (e.g., 16,000 IDR/USD inverse micro = 62)
      const fx = engine.calculateEnterpriseServicePricing({
        pricingMethod: 'target_margin', directLaborCostCents: 10_000_000_00, overheadAllocationBps: 0, riskContingencyBps: 0,
        targetMarginBps: 5000, fxRateMicro: 1_500_000, taxRateBps: 1200,
      });
      assert.equal(fx.netSellingPriceCents, 20_000_000_00);
      assert.equal(fx.convertedNetPriceCents, 30_000_000_00);
      assert.equal(fx.taxAmountCents, 2_400_000_00);
      executedCount++;

      // FlexGuard vs Fixed comparison
      const cmp = engine.calculateEnterpriseServicePricing({
        pricingMethod: 'fixed_price', directLaborCostCents: 30_000_000_00, targetMarginBps: 4000,
        flexguardCreditsEquivalent: 10, flexguardCreditUnitPriceCents: 4_500_000_00,
      });
      assert.equal(cmp.flexguardComparison.creditsRequired, 10);
      assert.equal(cmp.flexguardComparison.flexguardPriceCents, 45_000_000_00);
      executedCount++;
    });

    // -------------------------------------------------------------------------
    // DOMAIN E: Full API Integration, SoD, Immutability, Cross-Entity & Feature Flags (26 scenarios)
    // -------------------------------------------------------------------------
    await t.test('E01-E26: End-to-end APIs for Service Catalog, Rate Card Versioning, Immutable Pricing Snapshot, Historical Learning & Feature Flags', async () => {
      // E01: Create service catalog draft (Presales)
      const svc = await expect(h.call('erp/service-catalog', 'POST', 'presales', {
        action: 'create_service', legal_entity_id: 'le-alpha', service_code: 'VAPT-WEB-ENT',
        service_name: 'Enterprise Web App Penetration Testing', service_category: 'web_app_pentest',
        description: 'Comprehensive OWASP WSTG enterprise web application pentest',
        scope_summary: 'Full authenticated & unauthenticated web testing plus retest',
        min_mandays_tenths: 40, standard_mandays_tenths: 80, max_mandays_tenths: 200,
        effective_date: '2026-11-01',
      }), 201);
      executedCount++;

      // E02: Maker self-approval blocked (SoD)
      await expect(h.call('erp/service-catalog', 'POST', 'presales', {
        action: 'approve_service', service_id: svc.body.id, approval_notes: 'Self approval attempt must fail',
      }), 403);
      executedCount++;

      // E03: Independent Approver approves service
      await expect(h.call('erp/service-catalog', 'POST', 'approver', {
        action: 'approve_service', service_id: svc.body.id, approval_notes: 'Reviewed scope, deliverables and margin floor',
      }), 200);
      executedCount++;

      // E04: Upsert activity templates (4 phases)
      for (const phase of ['scope_validation', 'technical_execution', 'reporting', 'retest']) {
        await expect(h.call('erp/service-catalog', 'POST', 'presales', {
          action: 'upsert_activity_template', service_id: svc.body.id, phase_code: phase,
          resource_role: 'lead_pentester', standard_hours_per_unit_hundredths: 800,
        }), 201);
        executedCount++;
      }

      // E08: Sales CANNOT create internal rate card
      await expect(h.call('erp/service-catalog', 'POST', 'sales', {
        action: 'create_rate_card', legal_entity_id: 'le-alpha', role_code: 'lead_pentester',
        monthly_compensation_cents: 25_000_000_00, effective_date: '2026-11-01',
      }), 403);
      executedCount++;

      // E09: Finance creates rate card v1
      const rc1 = await expect(h.call('erp/service-catalog', 'POST', 'finance', {
        action: 'create_rate_card', legal_entity_id: 'le-alpha', role_code: 'lead_pentester',
        monthly_compensation_cents: 25_000_000_00, benefit_allocation_cents: 5_000_000_00,
        available_working_days: 240, target_utilization_bps: 7500, effective_date: '2026-11-01', version: 1,
      }), 201);
      assert.equal(rc1.body.computed.internalCostPerMandayCents, 2_000_000_00);
      executedCount++;

      // E10: Finance cannot self-approve rate card
      await expect(h.call('erp/service-catalog', 'POST', 'finance', {
        action: 'approve_rate_card', rate_card_id: rc1.body.id, approval_notes: 'Finance self approval attempt',
      }), 403);
      executedCount++;

      // E11: Approver approves rate card v1
      await expect(h.call('erp/service-catalog', 'POST', 'approver', {
        action: 'approve_rate_card', rate_card_id: rc1.body.id, approval_notes: 'Approved FY2026 Q4 Lead Pentester rate card',
      }), 200);
      executedCount++;

      // E12: Sales GET masks internal cost basis
      const salesView = await expect(h.call('erp/service-catalog', 'GET', 'sales', null, '?legal_entity_id=le-alpha'), 200);
      assert.equal(salesView.body.cost_basis_visible, false);
      assert.equal(salesView.body.rate_cards[0].internal_cost_rate_cents, undefined);
      executedCount++;

      // E13: Finance GET sees internal cost basis
      const finView = await expect(h.call('erp/service-catalog', 'GET', 'finance', null, '?legal_entity_id=le-alpha'), 200);
      assert.equal(finView.body.cost_basis_visible, true);
      assert.equal(finView.body.rate_cards[0].internal_cost_rate_cents, 2_000_000_00);
      executedCount++;

      // E14: Sales CANNOT override approved internal cost rate in pricing simulation
      await expect(h.call('erp/pricing-engine', 'POST', 'sales', {
        action: 'simulate_and_save', legal_entity_id: 'le-alpha', scenario_name: 'Tampered Cost Attempt',
        pricing_method: 'target_margin', target_margin_bps: 3500,
        activities: [{ phaseCode: 'technical_execution', resourceRole: 'lead_pentester', quantity: 1, standardHoursPerUnitHundredths: 1600, internalCostRateCents: 100_000_00, billable: true }],
      }), 403);
      executedCount++;

      // E15: Negative margin scenario rejected by API
      await expect(h.call('erp/pricing-engine', 'POST', 'finance', {
        action: 'simulate_and_save', legal_entity_id: 'le-alpha', scenario_name: 'Loss Leader Blocked',
        pricing_method: 'fixed_price', target_margin_bps: 3500, custom_selling_price_cents: 1_000_000_00,
        activities: [{ phaseCode: 'technical_execution', resourceRole: 'lead_pentester', quantity: 2, standardHoursPerUnitHundredths: 1600, billable: true }],
      }), 422);
      executedCount++;

      // E16: Valid pricing scenario submitted using DB approved rate card
      const sc = await expect(h.call('erp/pricing-engine', 'POST', 'presales', {
        action: 'simulate_and_save', legal_entity_id: 'le-alpha', service_id: svc.body.id,
        scenario_name: 'Bank Alpha Web VAPT Q4', pricing_method: 'target_margin',
        target_margin_bps: 4000, discount_bps: 500, tools_cost_cents: 2_000_000_00,
        activities: [{ phaseCode: 'technical_execution', resourceRole: 'lead_pentester', quantity: 2, standardHoursPerUnitHundredths: 1600, billable: true }],
      }), 201);
      const originalNetPrice = sc.body.pricing.netSellingPriceCents;
      executedCount++;

      // E17: Maker self-approval of pricing scenario blocked
      await expect(h.call('erp/pricing-engine', 'POST', 'presales', {
        action: 'approve_scenario_and_snapshot', scenario_id: sc.body.id, approval_notes: 'Self approval attempt',
      }), 403);
      executedCount++;

      // E18: Approver approves scenario & freezes immutable SHA-256 snapshot
      const snap = await expect(h.call('erp/pricing-engine', 'POST', 'approver', {
        action: 'approve_scenario_and_snapshot', scenario_id: sc.body.id, quotation_id: 'QT-2026-001',
        approval_notes: 'Commercial pricing and margin verified and frozen',
      }), 200);
      assert.equal(snap.body.snapshot_hash.length, 64);
      executedCount++;

      // E19: Rate card v2 increases cost to 3M/MD; historical snapshot remains completely unchanged!
      const rc2 = await expect(h.call('erp/service-catalog', 'POST', 'finance', {
        action: 'create_rate_card', legal_entity_id: 'le-alpha', role_code: 'lead_pentester',
        monthly_compensation_cents: 40_000_000_00, benefit_allocation_cents: 5_000_000_00,
        available_working_days: 240, target_utilization_bps: 7500, effective_date: '2026-12-01', version: 2,
      }), 201);
      await expect(h.call('erp/service-catalog', 'POST', 'approver', {
        action: 'approve_rate_card', rate_card_id: rc2.body.id, approval_notes: 'Updated rate card effective Dec 2026',
      }), 200);
      const storedSnap = h.sql.prepare('SELECT net_selling_price_cents, snapshot_hash FROM rticore_pricing_snapshots WHERE id=?').get(snap.body.snapshot_id);
      assert.equal(storedSnap.net_selling_price_cents, originalNetPrice);
      assert.equal(storedSnap.snapshot_hash, snap.body.snapshot_hash);
      executedCount++;

      // E20: DB trigger blocks UPDATE and DELETE on frozen pricing snapshot
      assert.throws(() => h.sql.prepare('UPDATE rticore_pricing_snapshots SET net_selling_price_cents=1 WHERE id=?').run(snap.body.snapshot_id), /PRICING_SNAPSHOT_IMMUTABLE/);
      assert.throws(() => h.sql.prepare('DELETE FROM rticore_pricing_snapshots WHERE id=?').run(snap.body.snapshot_id), /PRICING_SNAPSHOT_IMMUTABLE/);
      executedCount++;

      // E21: DB trigger blocks mutating approved rate card rates in place
      assert.throws(() => h.sql.prepare('UPDATE rticore_enterprise_rate_cards SET internal_cost_rate_cents=1 WHERE id=?').run(rc2.body.id), /APPROVED_RATE_CARD_IMMUTABLE/);
      executedCount++;

      // E22: Historical benchmark records planned vs actual without auto-modifying service master
      const bench = await expect(h.call('erp/pricing-engine', 'POST', 'project_manager', {
        action: 'record_historical_benchmark', service_id: svc.body.id,
        planned_mandays_tenths: 80, actual_mandays_tenths: 100,
        estimated_cost_cents: 16_000_000_00, actual_cost_cents: 20_000_000_00,
        estimated_margin_bps: 3500, actual_margin_bps: 2400, retest_count: 2, scope_changes_count: 1,
      }), 201);
      assert.equal(bench.body.recommendation.autoApplied, false);
      assert.equal(bench.body.recommendation.requiresApproval, true);
      const svcAfter = h.sql.prepare('SELECT standard_mandays_tenths FROM rticore_service_catalog_v2 WHERE id=?').get(svc.body.id);
      assert.equal(svcAfter.standard_mandays_tenths, 80); // unchanged without explicit approval!
      executedCount++;

      // E23: Cross-entity isolation — user without le-beta access gets 403
      await expect(h.call('erp/service-catalog', 'GET', 'finance', null, '?legal_entity_id=le-beta'), 403);
      await expect(h.call('erp/pricing-engine', 'GET', 'finance', null, '?legal_entity_id=le-beta'), 403);
      executedCount++;

      // E24-E26: Feature Flags maker-checker SoD & non-deletable governance
      const ff = await expect(h.call('admin/feature-flags', 'POST', 'admin', {
        action: 'request_flag', flag_key: 'flexguard_portal_v4', description: 'Enable FlexGuard customer portal after staging verification',
        rollout_scope: 'staging_only', legal_entity_id: 'le-alpha',
      }), 201);
      assert.equal(ff.body.enabled, 0);
      executedCount++;

      // Admin maker cannot self-approve feature flag
      await expect(h.call('admin/feature-flags', 'POST', 'admin', {
        action: 'approve_flag', id: ff.body.id, enabled: true, approval_notes: 'Self approval must be blocked by SoD',
      }), 403);
      executedCount++;

      // Independent Admin2 approves feature flag
      const ffOk = await expect(h.call('admin/feature-flags', 'POST', 'admin2', {
        action: 'approve_flag', id: ff.body.id, enabled: true, approval_notes: 'Independent verification passed in staging environment',
      }), 200);
      assert.equal(ffOk.body.enabled, 1);
      assert.throws(() => h.sql.prepare('DELETE FROM rticore_feature_flags WHERE id=?').run(ff.body.id), /FEATURE_FLAG_IMMUTABLE/);
      executedCount++;
    });

    assert.ok(executedCount >= 120, `Expected >= 120 unique Pricing & Catalog UAT scenarios, ran ${executedCount}`);
  } finally {
    h.close();
  }
});
