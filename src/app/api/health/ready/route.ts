import { getRuntimeEnv } from '@/lib/runtime-env';
import type { D1DB } from '@/lib/boq-auth';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const correlationId = req.headers.get('x-request-id')?.slice(0, 64) || crypto.randomUUID();
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Request-Id': correlationId,
  };
  const started = Date.now();
  try {
    const env = await getRuntimeEnv<{ RTICORE_DB?: D1DB }>();
    if (!env.RTICORE_DB) throw new Error('database missing');
    await env.RTICORE_DB.prepare('SELECT 1 FROM rticore_members LIMIT 1').first();
    return Response.json(
      {
        status: 'core_ready',
        finance: 'not_certified',
        db_latency_ms: Date.now() - started,
        correlation_id: correlationId,
      },
      { headers },
    );
  } catch {
    return Response.json(
      { status: 'not_ready', correlation_id: correlationId },
      { status: 503, headers },
    );
  }
}
