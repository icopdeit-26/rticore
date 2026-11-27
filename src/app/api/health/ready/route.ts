import { getRuntimeEnv } from '@/lib/runtime-env';
import type { D1DB } from '@/lib/boq-auth';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Core-only readiness. Never implies Finance or production certification.
export async function GET() {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  try {
    const env = await getRuntimeEnv<{ RTICORE_DB?: D1DB }>();
    if (!env.RTICORE_DB) throw new Error('database unavailable');
    const active = await env.RTICORE_DB.prepare('SELECT 1 AS ok FROM rticore_members WHERE active=1 LIMIT 1').first();
    if (!active) throw new Error('membership unavailable');
    return Response.json({ status: 'core_ready', finance: 'not_certified' }, { headers });
  } catch {
    return Response.json({ status: 'not_ready' }, { status: 503, headers });
  }
}
