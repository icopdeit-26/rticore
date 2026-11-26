import { NextResponse, type NextRequest } from 'next/server';

// This is a route availability gate, NOT an authorization bypass.
// Every permitted D1 handler independently validates Cloudflare Access JWT,
// membership, role, object ownership and transaction permissions server-side.
// Legacy demo APIs remain disabled until explicitly migrated and reviewed.
const D1_ROUTES = new Set([
  '/api/boq',
  '/api/ai/config',
  '/api/ai/generate',
  '/api/ai/assist',
  '/api/scoping/upload',
  '/api/reference/postal',
  '/api/marketing/leads',
  '/api/marketing/campaigns',
  '/api/marketing/lead-intelligence',
  '/api/sales',
  // Enterprise modules introduced with canonical migration 0026.
  // Previously unreachable due to an outdated middleware allowlist.
  '/api/partners',
  '/api/reports',
  '/api/admin/system',
  '/api/admin/options',
  '/api/admin/scoping-model',
  '/api/admin/feature-flags',
  '/api/scoping/model',
  '/api/reference/options',
  '/api/psa/timesheets',
  // Read-only platform diagnostics for Admin and IT Developer Team (migration 0051).
  '/api/platform/diagnostics',
  // Local-mode login; refuses every write unless RTICORE_LOCAL_MODE=1 on localhost.
  '/api/local-auth',
  '/api/health/live',
  '/api/health/ready',
  // RTI Finance Enterprise Suite API (migration 0052).
  '/api/finance',
]);

export function isEnabledD1ApiRoute(path: string): boolean {
  return D1_ROUTES.has(path) || path.startsWith('/api/finance/') || path.startsWith('/api/erp/') || path.startsWith('/api/boq/') || path.startsWith('/api/sales/');
}

export function middleware(request: NextRequest) {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  if (env?.RTICORE_RUNTIME === 'hostinger' && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = env.RTICORE_PUBLIC_ORIGIN;
    if (!origin || request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') {
      return NextResponse.json(
        { success: false, message: 'Origin tidak diizinkan.' },
        { status: 403, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
      );
    }
  }
  if (isEnabledD1ApiRoute(request.nextUrl.pathname)) return NextResponse.next();
  return NextResponse.json(
    { success: false, message: 'API demo nonpersisten dinonaktifkan hingga migrasi otorisasi selesai.' },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );
}

export const config = { matcher: ['/api/:path*'] };
