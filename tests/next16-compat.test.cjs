const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const nextConfig = fs.readFileSync(path.join(root, 'next.config.mjs'), 'utf8');

test('Next.js 16.4.2 and React 19 use pinned matching versions', () => {
  assert.equal(pkg.dependencies.next, '16.4.2');
  assert.equal(pkg.dependencies.react, '19.2.0');
  assert.equal(pkg.dependencies['react-dom'], '19.2.0');
  assert.match(pkg.devDependencies['@types/react'], /^\^19\./);
  assert.match(pkg.devDependencies['@types/react-dom'], /^\^19\./);
});

test('Next.js 16 builds with webpack while custom webpack config remains', () => {
  assert.match(nextConfig, /webpack\s*:/);
  assert.equal(pkg.scripts.build, 'node scripts/build-hostinger.mjs');
  const wrapper = fs.readFileSync(path.join(root, 'scripts/build-hostinger.mjs'), 'utf8');
  assert.match(wrapper, /require\.resolve\('next\/dist\/bin\/next'\),\s*'build',\s*'--webpack'/);
  assert.match(wrapper, /spawnSync\(process\.execPath/);
  assert.match(wrapper, /TOKIO_WORKER_THREADS:\s*'1'/);
  assert.match(wrapper, /RAYON_NUM_THREADS:\s*'1'/);
  assert.match(wrapper, /UV_THREADPOOL_SIZE:\s*'2'/);
  assert.match(wrapper, /process\.exitCode\s*=\s*result\.status\s*\?\?\s*1/);
  assert.equal(pkg.scripts.dev, 'next dev --webpack');
});

test('enterprise build retains regression gates and uses native Next.js', () => {
  assert.match(pkg.scripts['build:enterprise'], /test:runtime-compat/);
  assert.match(pkg.scripts['build:enterprise'], /npm run typecheck && npm run build$/);
  assert.doesNotMatch(pkg.scripts['build:enterprise'], /opennextjs-cloudflare|wrangler/);
  const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
  for(const name of ['@opennextjs/cloudflare','wrangler']) {
    assert.equal(pkg.devDependencies[name],undefined);
    assert.equal(lock.packages['node_modules/'+name],undefined);
  }
  assert.ok(!fs.existsSync(path.join(root,'open-next.config.ts')));
});


test('Hostinger build worker limits are active without environment overrides', async () => {
  const { default: config } = await import(require('node:url').pathToFileURL(path.join(root, 'next.config.mjs')).href);
  assert.equal(config.experimental.cpus, 1);
  assert.equal(config.experimental.workerThreads, false);
  assert.equal(config.experimental.staticGenerationMaxConcurrency, 1);
});
