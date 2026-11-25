const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {readdirSync} = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const versions = readdirSync(path.join(root, 'migrations'))
  .filter(name => /^\d{4}_.*\.sql$/.test(name))
  .map(name => Number(name.slice(0, 4)));
const schema = {
  status: 'reconciled',
  latest_applied_version: Math.max(...versions),
  applied_versions: versions,
};

function runSmoke(status, health) {
  const payload = Buffer.from(JSON.stringify({exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url');
  const session = 'test.' + payload + '.test';
  const mock = `
    globalThis.fetch = async (url, options) => {
      if (options.redirect !== 'manual' || options.headers.cookie !== ${JSON.stringify('CF_Authorization=' + session)}) {
        throw Error('Missing Access authentication or redirect protection');
      }
      if (url.pathname === '/login') return new Response('<html></html>', {headers:{'content-type':'text/html'}});
      return Response.json(${JSON.stringify(health)}, {status:${status}});
    };
  `;
  return spawnSync(process.execPath, [
    '--import', 'data:text/javascript,' + encodeURIComponent(mock),
    'scripts/release/verify-production-http.mjs',
  ], {
    cwd: root,
    env: {...process.env, BASE_URL:'https://smoke.invalid', ACCESS_SESSION:session},
    encoding: 'utf8',
  });
}

test('production smoke requires authenticated HTTP 200 and reconciled D1 ledger', () => {
  const health = {success:true, database:{ok:true}, schema};
  const valid = runSmoke(200, health);
  assert.equal(valid.status, 0, valid.stderr);
  for (const status of [302, 401, 404]) {
    const denied = runSmoke(status, health);
    assert.equal(denied.status, 1, denied.stdout);
    assert.match(denied.stderr, new RegExp('HTTP ' + status));
  }
  const incomplete = runSmoke(200, {...health, schema:{...schema, applied_versions:versions.slice(1)}});
  assert.equal(incomplete.status, 1, incomplete.stdout);
  assert.match(incomplete.stderr, /did not confirm the expected D1 schema/);
});
