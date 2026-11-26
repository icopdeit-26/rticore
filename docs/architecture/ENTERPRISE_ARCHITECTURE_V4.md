# 1. RTICore Enterprise Architecture Document (V4.0)

**Platform:** RTICore Enterprise ERP, Cybersecurity PSA, Service Pricing Intelligence & FlexGuard Management System  
**Runtime:** Next.js 16.4.2 (App Router) on Node.js 24 LTS  
**Primary Database:** PostgreSQL 16 (production, `sslmode=verify-full`) with canonical versioned migrations `0001`–`0055` (`rticore_postgresql_schema.sql` + 289 translated PL/pgSQL triggers in `rticore_postgresql_triggers.sql`) and local SQLite/PGlite parity.

## Logical Architecture
1. **Identity & Ingress Layer (Hostinger VPS KVM Target):**
   - HTTPS Reverse Proxy (Nginx, TLS 1.2/1.3, HSTS, OWASP headers, rate limiting) → OAuth2 Proxy → Keycloak OIDC Realm (RS256, mandatory OTP MFA, 15m token max lifetime).
   - Loopback-only Node.js origin (`127.0.0.1:$PORT`), server-side JWT signature + active session introspection (`src/lib/native-oidc.ts`, `src/lib/native-session.ts`), strict Origin/CSRF verification (`src/middleware.ts`, `src/lib/boq-auth.ts`).
2. **Application & Domain Layer (M01–M30):**
   - Commercial & CRM (`M03`, `M04`, `M07`, `M08`): `/api/sales/*`, `/api/marketing/*`, `/api/boq/*`.
   - Service Catalog & Pricing Intelligence (`M05`, `M06`): `src/lib/enterprise-pricing-engine.ts`, `/api/erp/service-catalog`, `/api/erp/pricing-engine`, `/erp/service-catalog`, `/erp/pricing-simulator`.
   - FlexGuard Enterprise Suite & Customer Portal (`M09`): `src/lib/flexguard-enterprise.ts`, `/api/sales/flexguard`, `/api/erp/flexguard-enterprise`, `/api/portal/flexguard`, `/erp/flexguard-enterprise`, `/portal/flexguard`.
   - PSA & Cybersecurity Operations (`M10`–`M17`): `/api/sales/service-operations`, `/api/psa/timesheets`, `/api/erp/cyber-operations`, `/api/erp/security-integrations`, `/api/erp/cyber-grc-cti`, `/erp/cyber-grc-cti`.
   - RTI Finance Enterprise Suite (`M21`–`M26`): `src/lib/rti-finance-core.ts`, `/api/finance` (`F01`–`F25`), `RTIFinanceWorkstation.tsx` (fail-closed on Hostinger until certification gate passes).
   - Executive BI, Risk, Operations & Governance (`M01`, `M27`–`M30`): `/api/erp/executive-command`, `/api/erp/operations-jobs`, `/api/admin/feature-flags`, `/erp/executive-command`, `/erp/operations-center`, `scripts/hostinger-worker.mjs`, `scripts/hostinger-backup-restore-drill.mjs`.
3. **Data & Integrity Layer:**
   - All financial values stored as integer minor units (`_cents`), percentages/multipliers as basis points (`_bps`), mandays as integer tenths (`_tenths`).
   - Legal entity isolation enforced server-side on every query and mutation (`rticore_erp_org_units`, `rticore_erp_staff_org`, `rticore_finance_role_assignments`).
   - Immutable audit trails (`rticore_operations_events`, `rticore_sales_audit`, `rticore_audit_log`) and DB-level `NO DELETE` / `NO TAMPER` / SoD triggers across critical tables.
