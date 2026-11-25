# Hostinger deployment decision — candidate only

Baseline: e5e7ace26ca6063812d0ce9299e97a28970487d5. Preserve existing RTI Finance routes and migration 0052; do not import a second ledger.

## Runtime findings
- Native Next.js build/start scripts and PostgreSQL adapter already exist.
- getRuntimeEnv currently selects native PostgreSQL only in local mode. Local authentication is passwordless and restricted to loopback; never expose that mode publicly or bypass its restriction. Production needs separate native-runtime selection with verified Cloudflare Access JWT or enterprise OIDC. Keep existing Cloudflare deployment path.
- Configure external PostgreSQL (TLS with verified certificates), least-privilege credentials, migrations as a separately approved step. Do not use embedded PGlite for shared production or migrate D1 automatically.
- Finance API currently accepts client x-finance-role override for admin/finance/approver, and GET loads some tenant-wide data even for entity-specific requests. Remove client-controlled elevation, authorize every entity/action server-side, restrict response fields and test cross-entity access and maker-checker before any staging with actual data.
- Existing 520-scenario suite is automated/simulated, not business owner UAT.

## Hostinger candidate
Recommend VPS, Node 24, npm ci, npm run build, npm start behind HTTPS reverse proxy. Keep RTICORE_LOCAL_MODE=0 for public traffic; native production auth/database adapter is not yet implemented. Provision secrets via server configuration only. Do not run local:setup against production. Disable automatic production deployment until all gates pass.

## Release gates
H01 native CI; H02 PostgreSQL adapter parity; H03 integration contracts; H04 external authentication; H05 secure config; H06 durable encrypted storage; H07 scheduled jobs; H08 preserve existing Finance and test docking; H09 hardened container/process deployment; H10 gated CI; H11 authenticated readiness/monitoring; H12 tested backups/restore/rollback; H13 role/entity scope and security testing; H14 staging reconciliation, business sign-off and production smoke test. All are required; source or CI alone is not production evidence.

## Batch 04 — native runtime and regression controls

- Seven browser CI workflows pin Ubuntu 24.04; Playwright 1.55.1 does not support the observed Ubuntu 26.04 runner.
- Native runtime uses `RTICORE_RUNTIME=hostinger`, `RTICORE_LOCAL_MODE=0`, external `DATABASE_URL`, `RTICORE_ACCESS_TEAM_DOMAIN`, and `RTICORE_ACCESS_AUD`. Store encryption keys in the Hostinger secret configuration, not in Git. Use a TLS-verified PostgreSQL connection and private networking.
- Public traffic must pass a configured Cloudflare Access application; API authorization still validates its signed JWT and active membership. Never expose the origin as an alternate unauthenticated access path.
- External PostgreSQL batches now lease one pool client for BEGIN, all statements, COMMIT/ROLLBACK. Native production runtime no longer automatically initializes schema or triggers.
- Finance header-based persona selection removed. Existing 520 simulated UAT tests that assumed header role switching need independent persisted role fixtures; do not treat an old pass as current evidence. The Finance API is deliberately disabled on native hosting pending entity isolation, authorization of all action references, menu-specific response minimization and business reconciliation.
- New negative tests exercise client role rejection and native local-mode protection.

### Deployment sequence
1. Provision isolated Hostinger staging VPS, Node.js 24, private PostgreSQL with verified TLS, Cloudflare Access and HTTPS reverse proxy.
2. Restore sanitized, approved staging data; apply versioned schema/triggers using a separate migration account. Compare D1 and PostgreSQL row counts, financial control totals and source references. Do not run local:setup on this target.
3. Run npm ci, npm run typecheck, npm run build, all CI and PostgreSQL transaction/constraint tests. Start using npm start under supervised non-root service.
4. Configure persistent encrypted backups, verify restoration to a separate database and rehearse application rollback without overwriting new financial postings.
5. Complete Finance scope remediation, live integration, UAT and owner approval before enabling Finance. Validate anonymous denial, JWT audience/expiry, wrong entity rejection, maker-checker, duplicate-event handling and reconciliation.
6. Deploy the exact approved commit; verify health, logs and transaction integrity. No automatic production deployment until approval gates are satisfied.
