/** Hostinger native runtime configuration. No secret values are included in errors. */
export function validateHostingerConfig(e: Record<string, string | undefined>): URL {
  if (e.RTICORE_RUNTIME !== 'hostinger' || e.RTICORE_LOCAL_MODE !== '0' ||
      (e.RTICORE_DB_ENGINE && e.RTICORE_DB_ENGINE !== 'postgres') ||
      e.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    throw new Error('Hostinger requires native runtime, external PostgreSQL and disabled local login');
  if (!/^[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(e.RTICORE_ACCESS_TEAM_DOMAIN || '') ||
      !/^[a-fA-F0-9]{64}$/.test(e.RTICORE_ACCESS_AUD || ''))
    throw new Error('Hostinger requires valid Cloudflare Access team and application audience');
  if (!e.DATABASE_URL) throw new Error('Hostinger requires DATABASE_URL');
  let url: URL;
  try { url = new URL(e.DATABASE_URL); } catch { throw new Error('Invalid PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username ||
      !url.password || url.pathname.length < 2 || url.hash ||
      url.searchParams.getAll('sslmode').length !== 1 || url.searchParams.get('sslmode') !== 'verify-full' ||
      Array.from(url.searchParams.keys()).some(k => k !== 'sslmode'))
    throw new Error('Hostinger requires PostgreSQL URL with explicit sslmode=verify-full');
  // Do not let connection-string SSL options override the explicit verified TLS policy.
  url.search = '';
  return url;
}
