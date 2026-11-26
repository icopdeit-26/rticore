/** Hostinger native runtime configuration. No secret values are included in errors. */
export function validateHostingerConfig(e: Record<string, string | undefined>): URL {
  if (e.RTICORE_RUNTIME !== 'hostinger' || e.RTICORE_LOCAL_MODE !== '0' ||
      (e.RTICORE_DB_ENGINE && e.RTICORE_DB_ENGINE !== 'postgres') ||
      e.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    throw new Error('Hostinger requires native runtime, external PostgreSQL and disabled local login');
  validateNativeOIDC(e);
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

/** Keycloak realm issuer and client/audience are operator-controlled, never request-derived. */
export function validateNativeOIDC(e: Record<string, string | undefined>) {
  let issuer: URL;
  try { issuer = new URL(e.RTICORE_OIDC_ISSUER || ''); }
  catch { throw new Error('Hostinger requires an HTTPS OIDC realm issuer'); }
  if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash ||
      !/^\/realms\/[A-Za-z0-9_-]+$/.test(issuer.pathname) ||
      issuer.hostname.endsWith('.cloudflareaccess.com'))
    throw new Error('Hostinger requires an independent HTTPS Keycloak realm issuer');
  const clientId = e.RTICORE_OIDC_CLIENT_ID || '';
  const audience = e.RTICORE_OIDC_AUDIENCE || '';
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(clientId) || !/^[A-Za-z0-9_.-]{1,128}$/.test(audience))
    throw new Error('Hostinger requires OIDC client ID and API audience');
  return { issuer: issuer.href, clientId, audience };
}
