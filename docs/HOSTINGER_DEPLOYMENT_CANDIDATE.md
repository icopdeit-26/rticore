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
