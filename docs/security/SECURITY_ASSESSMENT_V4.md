# 13. Enterprise Security Assessment (V4.0)

**Aligned Standard:** OWASP ASVS Level 2 / Zero-Trust Principles  
**Last Verified:** 2026-11-26 (Branch `feature/hostinger-finance-docking`)

## Verified Security Controls
1. **Authentication & Session Security:**
   - Hostinger production mode enforces Keycloak RS256 OIDC JWT verification (`src/lib/native-oidc.ts`: 15-minute max lifetime, `email_verified=true`, strict `iss`/`aud`/`azp`/`sid`), real-time uncached token introspection (`src/lib/native-session.ts`), and mandatory OTP MFA in `deployment/hostinger/keycloak-realm.template.json`.
   - Local passwordless login is hard-disabled whenever `RTICORE_RUNTIME === 'hostinger'` (`isLocalMode()` returns `false`).
2. **Privilege Escalation & Spoofing Prevention:**
   - `x-finance-role` header is actively rejected (`HTTP 403`) on `GET` and `POST` in `/api/finance` AND stripped at Nginx (`proxy_set_header X-Finance-Role ""`).
   - Role preview cookies are strictly Admin-downscope-only and rejected (`403`) on Finance and all V4.0 Enterprise mutation APIs.
3. **Cross-Entity & Cross-Customer Isolation:**
   - Every V4.0 ERP API resolves `authorizedEntities()` from approved DB assignments (`rticore_erp_staff_org` / `rticore_finance_role_assignments`) and rejects unauthorized entity queries/writes with `403`.
   - `/api/portal/flexguard` enforces single-customer `rticore_flexguard_portal_grants` and recursively strips internal cost, compensation, and margin fields.
4. **CSRF, Transport & Header Hardening:**
   - Strict Origin and `Sec-Fetch-Site !== 'cross-site'` enforced in `src/middleware.ts`, `src/lib/boq-auth.ts`, and `erpOrigin()`.
   - `deployment/hostinger/nginx-rticore.conf.example` enforces TLS 1.2/1.3, HSTS `includeSubDomains`, CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and API/Auth rate limiting.
   - PostgreSQL connections enforce `sslmode=verify-full` and reject `NODE_TLS_REJECT_UNAUTHORIZED=0` and privileged DB accounts (`rolsuper`/`rolbypassrls`).
5. **Automated Security Verification:**
   - `test:rticore-negative` (44/44 PASS), `rticore-negative-enterprise-matrix` (44/44 PASS), `hostinger-production-safety` + `native-oidc` + `native-session` (41/41 PASS), `UAT-SEC-001..080` (80/80 PASS).
   - `npm audit`: 0 Critical, 0 High vulnerabilities (1 Moderate transitive advisory tracked in Known Issues).
