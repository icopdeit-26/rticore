import { NextResponse, type NextRequest } from 'next/server';

// This is a route availability gate, NOT an authorization bypass.
// Every permitted D1 handler independently validates native IAM session or signed OIDC,
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
  '/api/scoping/model',
  '/api/reference/options',
  '/api/psa/timesheets',
  // Read-only platform diagnostics for Admin and IT Developer Team (migration 0051).
  '/api/platform/diagnostics',
  // Local-mode login; refuses every write unless RTICORE_LOCAL_MODE=1 on localhost.
  '/api/local-auth',
  '/api/business-auth',
  // Public minimal probes; no business data or mutation access.
  '/api/health/live',
  '/api/health/ready',
  // RTI Finance Enterprise Suite API (migration 0052).
  '/api/finance',
]);

export function isEnabledD1ApiRoute(path: string): boolean {
  return D1_ROUTES.has(path) || path.startsWith('/api/finance/') || path.startsWith('/api/erp/') || path.startsWith('/api/boq/') || path.startsWith('/api/sales/');
}

export function middleware(request: NextRequest) {
  // Redirect anonymous native root before React streaming can turn redirect into a 200 HTML response.
  // Cookie shape is only a routing hint; the server root still verifies the actual database session.
  if (request.nextUrl.pathname === '/') {
    if (process.env.RTICORE_RUNTIME === 'hostinger' && process.env.RTICORE_AUTH_MODE === 'business') {
      const cookies=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith('__Host-rticore_session='));
      if(cookies.length!==1||!/^__Host-rticore_session=[A-Za-z0-9_-]{43}$/.test(cookies[0])){
        const response=NextResponse.redirect(new URL('/login',request.url),307);
        response.headers.set('Cache-Control','no-store');
        return response;
      }
    }
    return NextResponse.next();
  }
  if (isEnabledD1ApiRoute(request.nextUrl.pathname)) return NextResponse.next();
  return NextResponse.json(
    { success: false, message: 'API demo nonpersisten dinonaktifkan hingga migrasi otorisasi selesai.' },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );
}

export const config = { matcher: ['/', '/api/:path*'] };
