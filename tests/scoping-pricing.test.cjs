const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const ts = require('typescript');
const root = join(__dirname, '..');
const source = file => readFileSync(join(root, file), 'utf8');

// Compile the real TypeScript modules (ICOP pricing engine + scoping profile).
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const js = ts.transpileModule(source(file), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
  }).outputText;
  const mod = {exports: {}};
  cache.set(file, mod.exports);
  new Function('require', 'module', 'exports', js)(name => {
    if (name === './pricing-engine') return load('src/lib/pricing-engine.ts');
    if (name === './types' || name === './scoping-service-options') return {};
    throw Error('Unexpected test dependency: ' + name);
  }, mod, mod.exports);
  cache.set(file, mod.exports);
  return mod.exports;
}
const P = load('src/lib/scoping-pricing.ts');
const ctx = patch => ({...P.defaultCommercialContext(), ...patch});

test('every product type has an ICOP pricing profile with role shares summing to 1', () => {
  for (const service of ['VAPT','SOC','CTI','ISO','PDP','Hardening','IR','GRC','DFIR','TECHNOLOGY','TRAINING','Lainnya']) {
    const p = P.PRODUCT_PRICING[service];
    assert.ok(p, service);
    const sum = p.roles.reduce((s, r) => s + r.share, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, service + ' shares = ' + sum);
  }
  assert.equal(P.PRODUCT_PRICING.SOC.model, 'soc_mrc');
  assert.equal(P.PRODUCT_PRICING.CTI.model, 'cti_mrc');
  assert.ok(P.PRODUCT_PRICING.DFIR.roles.some(r => r.role === 'forensic'));
});

test('VAPT MD flows into component A via ICOP rate card and 3 ranges', () => {
  const e = P.estimateScopingPrice({service: 'VAPT', ctx: ctx({}), vaptTotalMd: 20});
  assert.ok(e.ready);
  // 20 MD: PM 3 x1.5jt + Lead 5 x2jt + Senior 8 x1jt + Junior 4 x0.5jt = 24.5jt
  assert.equal(e.costs.A, 24500000);
  assert.equal(e.costs.C, 2000000, 'default dokumen Rp 2jt');
  assert.equal(e.totalInternalCost, 26500000);
  assert.equal(e.floor, Math.round(26500000 / 0.8));
  assert.ok(e.standard >= e.floor);
  assert.equal(e.premium, Math.round(e.standard * 1.25));
});

test('client tier, overseas rate and urgency change the indication', () => {
  const base = P.estimateScopingPrice({service: 'GRC', ctx: ctx({total_md: '20'})});
  const tierS = P.estimateScopingPrice({service: 'GRC', ctx: ctx({total_md: '20', client_tier: 'S'})});
  const rush = P.estimateScopingPrice({service: 'GRC', ctx: ctx({total_md: '20', urgency: 'rush'})});
  const overseas = P.estimateScopingPrice({service: 'GRC', ctx: ctx({total_md: '20', location_type: 'overseas'})});
  assert.ok(tierS.standard > base.standard);
  assert.ok(rush.dai > base.dai);
  assert.ok(overseas.costs.A > base.costs.A);
});

test('manual role MD overrides auto allocation; missing MD is not priced', () => {
  const e = P.estimateScopingPrice({service: 'ISO', ctx: ctx({total_md: '10', role_md: {lead: '8'}})});
  assert.equal(e.staffing.find(s => s.role === 'lead').mandays, 8);
  assert.equal(e.staffing.find(s => s.role === 'lead').manual, true);
  const none = P.estimateScopingPrice({service: 'ISO', ctx: ctx({})});
  assert.equal(none.ready, false);
  assert.deepEqual(P.hppSuggestion(none), []);
});

test('SOC MRC uses tier and floor only when monthly HPP exists', () => {
  const noHpp = P.estimateScopingPrice({service: 'SOC', ctx: ctx({client_tier: 'S'}), socBaseMrc: 50000000, socMonths: 12});
  assert.equal(noHpp.floor, null);
  assert.equal(noHpp.standard, 70000000);
  assert.equal(noHpp.contractValueStandard, 840000000);
  const withHpp = P.estimateScopingPrice({service: 'SOC', ctx: ctx({costs: {A: '30000000'}}), socBaseMrc: 50000000, socMonths: 12});
  assert.equal(withHpp.floor, 37500000);
  assert.equal(withHpp.marginAtStandard, 40);
  assert.deepEqual(P.hppSuggestion(withHpp), [{code: 'A', amount: 360000000}]);
});

test('CTI footprint follows pricing_cti_inputs and BRD A.3 bands', () => {
  const small = P.calculateCtiFootprint({cti_domains: '2', cti_brand_monitoring: 'Tidak', cti_threat_level: 'Medium'});
  assert.equal(small.tier, 'basic');
  assert.ok(small.baseMrc >= 10000000 && small.baseMrc <= 20000000);
  const big = P.calculateCtiFootprint({cti_domains: '20', cti_subsidiaries: '10', cti_executives: '15',
    cti_mobile_apps: '4', cti_brand_monitoring: 'Ya', cti_threat_level: 'Critical'});
  assert.equal(big.tier, 'elite');
  assert.ok(big.baseMrc <= 150000000);
});

test('commercial validation rejects bad values', () => {
  assert.deepEqual(P.validateCommercialContext(ctx({})), []);
  assert.ok(P.validateCommercialContext(ctx({client_tier: 'Z'})).length);
  assert.ok(P.validateCommercialContext(ctx({costs: {D: '-1'}})).length);
  assert.ok(P.validateCommercialContext(ctx({total_md: 'abc'})).length);
});

test('scoping never transfers a unit price; BoQ only prefills HPP suggestion', () => {
  const scoping = source('src/app/scoping/page.tsx');
  const boq = source('src/app/boq/page.tsx');
  assert.match(scoping, /hppSuggestion\(estimate\)/);
  assert.doesNotMatch(scoping, /unit_price/);
  assert.match(boq, /pricing_context\?\.hpp/);
  assert.match(boq, /unit_price:0/);
  assert.match(boq, /if\(isFinance\)/);
});
