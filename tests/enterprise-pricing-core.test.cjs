const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const engine={};
new Function('exports',ts.transpileModule(fs.readFileSync('src/lib/enterprise-pricing-engine.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(engine);

test('PR1 pricing and catalog reference/calculation reconciliation',async t=>{
 let executedCount=0;
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


 assert.equal(executedCount,97);
});
test('integer precision overflow, invalid identifiers and fractional credits fail closed',()=>{
 const base={pricingMethod:'target_margin',directLaborCostCents:10000,targetMarginBps:3500};
 assert.throws(()=>engine.calculateLoadedResourceRate({monthlyCompensationCents:Number.MAX_SAFE_INTEGER}),/precision/);
 assert.throws(()=>engine.calculateEnterpriseServicePricing({...base,directLaborCostCents:Number.MAX_SAFE_INTEGER,toolsCostCents:1}),/precision/);
 assert.throws(()=>engine.calculateEnterpriseServicePricing({...base,flexguardCreditsEquivalent:2,flexguardCreditUnitPriceCents:Number.MAX_SAFE_INTEGER}),/precision/);
 assert.throws(()=>engine.calculateEnterpriseServicePricing({...base,flexguardCreditsEquivalent:1.5}),/integer/);
 assert.throws(()=>engine.calculateEnterpriseServicePricing({...base,pricingMethod:'unknown'}),/method/);
 const act={phaseCode:'technical_execution',resourceRole:'analyst',activityName:'Test',resourceCount:1,quantity:1,standardHoursPerUnitHundredths:800,billable:true,internalCostRateCents:100};
 assert.throws(()=>engine.calculateActivityBasedMandays([{...act,resourceRole:'unknown'}]),/role/);
 assert.throws(()=>engine.calculateActivityBasedMandays([{...act,quantity:Number.MAX_SAFE_INTEGER}]),/precision/);
 assert.throws(()=>engine.calculateActivityBasedMandays([act],{roundingMode:'unknown'}),/rounding/);
});
test('minimum selling price rounds up to protect margin floor',()=>{
 const r=engine.calculateEnterpriseServicePricing({pricingMethod:'target_margin',directLaborCostCents:101,overheadAllocationBps:0,riskContingencyBps:0,targetMarginBps:3500,minAcceptableMarginBps:2000});
 assert.equal(r.minSellingPriceCents,127);
});
