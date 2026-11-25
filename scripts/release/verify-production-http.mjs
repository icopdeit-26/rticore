import {readdirSync} from 'node:fs';

const origin = new URL(process.env.BASE_URL);
const session = process.env.ACCESS_SESSION;
if (origin.protocol !== 'https:' || origin.href !== origin.origin + '/' ||
    !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(session ?? '')) {
  throw Error('Expected HTTPS origin and a Cloudflare Access session JWT');
}
let exp;
try {
  ({exp} = JSON.parse(Buffer.from(session.split('.')[1], 'base64url').toString('utf8')));
} catch {
  throw Error('Invalid Cloudflare Access JWT payload');
}
const preflight = process.argv.includes('--preflight');
const minimumLifetime = preflight ? 45 * 60 : 0;
if (!Number.isFinite(exp) || exp <= Date.now() / 1000 + minimumLifetime) {
  throw Error('Cloudflare Access session expires before the release check can finish');
}

const versions = readdirSync(new URL('../../migrations/', import.meta.url))
  .filter(name => /^\d{4}_.*\.sql$/.test(name))
  .map(name => Number(name.slice(0, 4)));
const expected = Math.max(...versions);

async function request(path, contentType) {
  const response = await fetch(new URL(path, origin), {
    redirect: 'manual',
    headers: {cookie: 'CF_Authorization=' + session, 'cache-control': 'no-cache'},
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 200 || !response.headers.get('content-type')?.includes(contentType)) {
    throw Error(`Release check failed at ${path} (HTTP ${response.status})`);
  }
  return response;
}

await (await request('/login', 'text/html')).body?.cancel();
if (preflight) {
  console.log('Release target returned the login page and the Access session has sufficient lifetime');
} else {
  const health = await (await request('/api/platform/diagnostics?section=health', 'application/json')).json();
  if (health?.success !== true || health.database?.ok !== true ||
      health.schema?.status !== 'reconciled' || health.schema.latest_applied_version !== expected ||
      !Array.isArray(health.schema.applied_versions) ||
      !versions.every(version => health.schema.applied_versions.includes(version))) {
    throw Error('Authenticated Worker diagnostics did not confirm the expected D1 schema');
  }
  console.log(`Authenticated Worker diagnostics verified D1 schema ${expected}`);
}
