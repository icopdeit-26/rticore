# RTICore Testing Strategy & Execution Evidence

## Test Pyramid & Commands
1. **Static & Type Safety:** `npm run typecheck` (`tsc --noEmit`), `node scripts/rticore-production-workflow-guard.mjs`.
2. **PostgreSQL Schema & Trigger Parity (289 Triggers):** `npm run test:pg-triggers` (SQLite `migrations/0001`–`0055` vs PostgreSQL `rticore_postgresql_schema.sql` + `rticore_postgresql_triggers.sql` on PGlite).
3. **External PostgreSQL 16 Service Integration (CI):** `node --test tests/hostinger-postgres-server.test.cjs` (runs in GitHub Actions `hostinger-candidate-ci.yml` against `postgres:16`).
4. **Hostinger Security, OIDC & Session Controls:** `node --test tests/hostinger-config.test.mjs tests/hostinger-production-safety.test.cjs tests/native-oidc.test.mjs tests/native-session.test.mjs`.
5. **1,203+ Unique Business UAT Suite:** `npm run test:uat-1200` (executes `test:finance-520` + `test:enterprise-pricing` + `test:flexguard-enterprise` + `test:uat-v4`).
6. **Encrypted Backup & Restore Rehearsal:** `npm run drill:backup-restore`.
7. **Full Legacy & Module Regression:** `test:sales-transactions`, `test:sales`, `test:modules-13-15`, `test:service-operations`, `test:psa-timesheets`, `test:erp`, `test:erp:extensions`, `test:flexguard`, `test:rticore-negative`, `tests/rticore-negative-enterprise-matrix.test.cjs`, and 28 domain suites.
8. **Production Build & Native HTTP Smoke:** `NEXT_TELEMETRY_DISABLED=1 RTICORE_BUILD_CPUS=1 npm run build` followed by `PORT=31415 npm start` verifying `/api/health/live` (200) and `/api/health/ready` (503 fail-closed without prod credentials).
