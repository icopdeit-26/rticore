import { getRuntimeEnv } from '@/lib/runtime-env';
import type { D1DB } from '@/lib/boq-auth';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const env = await getRuntimeEnv<{RTICORE_DB?:D1DB}>();
    if (!env.RTICORE_DB) throw new Error('database missing');
    await env.RTICORE_DB.prepare('SELECT 1 FROM rticore_members LIMIT 1').first();
    return Response.json({ status: 'core_ready', finance: 'not_certified' }, { headers });
  } catch {
    return Response.json({ status: 'not_ready' }, { status: 503, headers });
  }
}
