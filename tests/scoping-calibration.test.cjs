const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const ts = require('typescript');
const root = join(__dirname, '..');
const source = file => readFileSync(join(root, file), 'utf8');

const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const js = ts.transpileModule(source(file), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const mod = {exports: {}};
  cache.set(file, mod.exports);
  new Function('require', 'module', 'exports', js)(name => {
    const map = {'./scoping-service-options': 'src/lib/scoping-service-options.ts', './pricing-engine': 'src/lib/pricing-engine.ts',
      './sales-workflow': 'src/lib/sales-workflow.ts', './scoping-calibration': 'src/lib/scoping-calibration.ts'};
    if (map[name]) return load(map[name]);
    if (name === './types') return {};
    throw Error('Unexpected test dependency: ' + name);
  }, mod, mod.exports);
  cache.set(file, mod.exports);
  return mod.exports;
}
const C = load('src/lib/scoping-calibration.ts');
const P = load('src/lib/scoping-pricing.ts');
const D = load('src/lib/product-delivery-profile.ts');

const vapt = (base, deal) => ({product: 'VAPT', base, deal});

test('statistical factor follows median deal/estimate with shrinkage and bounds', () => {
  const samples = [vapt(100, 90), vapt(100, 85), vapt(100, 88), vapt(100, 92), vapt(100, 80)];
  const stats = C.computeCalibration(samples);
  assert.equal(stats.products.VAPT.n, 5);
  assert.equal(stats.products.VAPT.medianRatio, 0.88);
  // 1 + (0.88-1) * 5/(5+5) = 0.94
  assert.equal(stats.products.VAPT.statFactor, 0.94);
  assert.ok(stats.products.VAPT.mapeAfter < stats.products.VAPT.mapeBefore);
  const factors = C.statisticalFactors(stats);
  assert.equal(factors.VAPT, 0.94);
  assert.equal(factors.SOC, 0.94, 'products without data use the global factor');
});

test('implausible pairs are discarded and thin data stays at 1.0', () => {
  const stats = C.computeCalibration([vapt(100, 1000), vapt(0, 50), {product: 'X', base: 1, deal: 1}, vapt(100, 70)]);
  assert.equal(stats.discarded, 3);
  assert.equal(stats.totalSamples, 1);
  assert.equal(C.statisticalFactors(stats).VAPT, 1);
});

test('AI proposals are bounded to ±0.15 of statistics and the 0.6–1.4 range', () => {
  const stats = C.computeCalibration([vapt(100, 90), vapt(100, 90), vapt(100, 90)]);
  const stat = C.statisticalFactors(stats).VAPT;
  const ai = C.parseAiProposal('Berikut hasil: {"factors":{"VAPT":0.2,"SOC":1.05},"rationale":"Diskon <b>besar</b>"}', stats);
  assert.equal(ai.factors.VAPT, Math.round((stat - 0.15) * 1000) / 1000);
  assert.ok(ai.adjusted.includes('VAPT'));
  assert.equal(ai.rationale.includes('<'), false);
  assert.throws(() => C.parseAiProposal('tidak ada json', stats));
  // SOC has no closed deals of its own: AI cannot move it away from the statistical/global factor.
  assert.equal(ai.factors.SOC, C.statisticalFactors(stats).SOC);
});

test('model table enforces unique versions in DDL and migration', () => {
  assert.match(source('src/lib/scoping-model-store.ts'), /UNIQUE INDEX IF NOT EXISTS idx_rticore_scoping_models_version/);
  assert.match(source('migrations/0046_scoping_model_calibration.sql'), /UNIQUE INDEX IF NOT EXISTS idx_rticore_scoping_models_version/);
});

test('prompt carries aggregates only', () => {
  const stats = C.computeCalibration([vapt(100, 90), vapt(120, 100), vapt(90, 95)]);
  const prompt = C.buildCalibrationPrompt(stats, {VAPT: 1});
  assert.match(prompt, /"products"/);
  assert.doesNotMatch(prompt, /@|customer|company_name|opportunity_id/i);
});

test('due after 30 days or when no model is active', () => {
  assert.equal(C.isCalibrationDue(null), true);
  assert.equal(C.isCalibrationDue(new Date().toISOString()), false);
  assert.equal(C.isCalibrationDue(new Date(Date.now() - 31 * 86400000).toISOString()), true);
});

test('calibration changes Standard but never below Floor; base kept for learning', () => {
  const ctx = {...P.defaultCommercialContext(), total_md: '20'};
  const plain = P.estimateScopingPrice({service: 'GRC', ctx});
  const up = P.estimateScopingPrice({service: 'GRC', ctx, calibrationFactor: 1.2});
  assert.equal(up.baseStandard, plain.standard);
  assert.equal(up.standard, Math.round(plain.standard * 1.2));
  const down = P.estimateScopingPrice({service: 'GRC', ctx: {...ctx, costs: {D: '400000000'}}, calibrationFactor: 0.6});
  assert.ok(down.standard >= down.floor);
  const soc = P.estimateScopingPrice({service: 'SOC', ctx: P.defaultCommercialContext(), socBaseMrc: 50000000, socMonths: 12, calibrationFactor: 0.9});
  assert.deepEqual(P.contractTotals(soc), {base: 600000000, calibrated: 540000000});
});

test('deal fields produce samples from base estimate and PO value', () => {
  const s = C.sampleFromDealFields({scoping_product: 'SOC', scoping_estimate_base: '600000000', po_amount_before_vat: '540000000'});
  assert.ok(C.validSample(s));
  assert.equal(s.deal / s.base, 0.9);
});

test('section 02 adapts per product without hiding gate-required fields', () => {
  assert.deepEqual(D.productsForFamily('SOC/MDR'), ['SOC']);
  assert.deepEqual(D.productsForFamily('Incident Response/DFIR'), ['DFIR', 'IR']);
  assert.equal(D.tierFromSegment('Pemerintah Daerah'), 'D');
  for (const p of ['VAPT','SOC','CTI','ISO','PDP','Hardening','IR','GRC','DFIR','TECHNOLOGY','TRAINING','Lainnya']) {
    for (const key of D.deliveryProfile(p).notApplicable) assert.ok(!D.ALWAYS_VISIBLE.has(key), p + ' hides ' + key);
  }
  const W = load('src/lib/sales-workflow.ts');
  for (const k of D.SCOPING_ESTIMATE_KEYS) assert.ok(W.DEAL_KEYS.has(k), k);
  assert.throws(() => W.cleanFields({scoping_params: '[1]'}, W.DEAL_KEYS));
  assert.equal(W.cleanFields({scoping_params: JSON.stringify({v: 1, x: 'a'.repeat(5000)})}, W.DEAL_KEYS).scoping_params.length > 3500, true);
  const access = source('src/lib/sales-access.ts');
  for (const k of D.SCOPING_ESTIMATE_KEYS) assert.match(access, new RegExp("'" + k + "'"));
});

test('admin menu, API gate and pipeline wiring', () => {
  assert.match(source('src/lib/enterprise-navigation.ts'), /'\/settings\/scoping-model',\['admin'\]/);
  assert.match(source('src/components/admin/AdminNavigation.tsx'), /\/settings\/scoping-model/);
  const mw = source('src/middleware.ts');
  assert.match(mw, /'\/api\/admin\/scoping-model'/);
  assert.match(mw, /'\/api\/scoping\/model'/);
  const api = source('src/app/api/admin/scoping-model/route.ts');
  assert.match(api, /role !== 'admin'/);
  assert.match(api, /reserveAIRequest/);
  assert.match(api, /parseAiProposal/);
  assert.match(api, /status === undefined|activateModel/);
  const pipeline = source('src/app/sales/pipeline/page.tsx');
  assert.match(pipeline, /ProductScopingEstimator/);
  assert.match(pipeline, /deliveryProfile\(product\)/);
  const estimator = source('src/components/sales/ProductScopingEstimator.tsx');
  assert.match(estimator, /HPP \(ctx\.costs\) is intentionally NOT persisted/);
});
