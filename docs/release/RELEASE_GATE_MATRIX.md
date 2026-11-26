# RTICore Release Gate Matrix (V4.0 — Post-Batch 18)

Status legend: `PASS` | `FAIL` | `PENDING` | `BLOCKED` | `NOT VERIFIED`

**Updated:** 2026-11-26  
**Branch:** `feature/hostinger-finance-docking` (lineage from `main` `e5e7ace26ca6063812d0ce9299e97a28970487d5`)

---

## Gate A — Safe Merge Readiness (`feature/hostinger-finance-docking` → `main`)

| # | Gate Criterion | Status | Evidence / Notes |
|---|---|---|---|
| A01 | Current SHA verified | PASS | Verified on `feature/hostinger-finance-docking` with clean batch commits |
| A02 | No unresolved merge conflicts | PASS | Clean lineage from `main` (`e5e7ace`) |
| A03 | Required reviews completed | PENDING | Requires human PR review on GitHub PR #1 after push |
| A04 | PR ready for review | PENDING | Local commits ready; push to `origin/feature/hostinger-finance-docking` pending operator instruction/review |
| A05 | Node.js compatibility PASS | PASS | Verified on Node `v26.13.0`; all CI workflows standardized on Node `24` LTS |
| A06 | Typecheck PASS | PASS | `npm run typecheck` exited 0 |
| A07 | Production build PASS | PASS | `NEXT_TELEMETRY_DISABLED=1 RTICORE_BUILD_CPUS=1 npm run build` exited 0 |
| A08 | PostgreSQL integration PASS | PARTIAL (`NOT VERIFIED` external PG locally) | 12/12 SQLite↔PGlite trigger parity across all 289 triggers (`0001`–`0055`) PASS; external `postgres:16` server test (`tests/hostinger-postgres-server.test.cjs`) runs in GitHub Actions `postgres-server` job |
| A09 | Native HTTP smoke PASS | PASS | `GET /api/health/live` → 200, `GET /api/health/ready` → 503 (fail-closed without prod credentials + correlation ID) |
| A10 | Finance UAT 520 PASS | PASS | `npm run test:finance-520` (520/520 PASS) |
| A11 | Sales multirole PASS | PASS | `npm run test:sales` & `test:sales-transactions` (27/27) PASS |
| A12 | All-role simulation PASS | PARTIAL | All automated API/DB role matrices PASS; Playwright browser matrix requires CI Ubuntu 24.04 run |
| A13 | Modules 13–15 PASS | PASS | `npm run test:modules-13-15` (65/65 PASS after REM-001 fix) |
| A14 | Pricing engine tests PASS | PASS | `npm run test:enterprise-pricing` (123 unique scenarios PASS) |
| A15 | FlexGuard critical tests PASS | PASS | `npm run test:flexguard-enterprise` (150+ unique scenarios incl. all 26 critical scenarios PASS) + `test:flexguard` PASS |
| A16 | Security regression PASS | PASS | `test:rticore-negative` (44/44), `rticore-negative-enterprise-matrix` (44/44), `hostinger-production-safety`/`native-oidc`/`native-session` (41/41), `UAT-SEC-001..080` (80/80) PASS |
| A17 | Comprehensive regression PASS | PASS | `npm run test:uat-1200` (1,203+ unique scenarios PASS) + all baseline regression suites PASS |
| A18 | No unresolved critical/high vulnerabilities | PASS | `npm audit`: 0 critical, 0 high (1 moderate transitive advisory documented in Known Issues) |
| A19 | Migration review completed | PASS | Additive migrations `0053`–`0056` synced to `rticore_postgresql_schema.sql` (191 tables) & 295 triggers in `rticore_postgresql_triggers.sql` |
| A20 | No unauthorized RBAC changes | PASS | Server-side RBAC, `x-finance-role` rejected (`403`), Finance Hostinger guard (`503`) preserved |

**Gate A Recommendation:** **NO-GO (Technical Local Checks PASS; Pending Push to PR #1, GitHub Actions External PostgreSQL & Playwright CI Green, and Human PR Review).**

---

## Gate B — Hostinger Deployment Readiness

| # | Gate Criterion | Status | Evidence / Notes |
|---|---|---|---|
| B01 | Gate A PASS | BLOCKED | Dependent on Gate A PR review & CI green |
| B02 | Target Hostinger plan verified | NOT VERIFIED | Hostinger VPS KVM recommended (see `docs/deployment/HOSTINGER_DEPLOYMENT_RUNBOOK.md`) |
| B03 | Runtime verified on target host | NOT VERIFIED | Requires live Hostinger staging VPS |
| B04 | Production environment variables configured | BLOCKED | Must be provisioned securely on server (`/etc/rticore/rticore.env`), never in Git |
| B05 | PostgreSQL production connectivity verified | NOT VERIFIED | Requires external TLS PostgreSQL 16 (`sslmode=verify-full`) + least-privilege runtime role |
| B06 | Production authentication verified | NOT VERIFIED | Requires live Keycloak OIDC realm (OTP MFA) + OAuth2 Proxy + Nginx |
| B07 | Legal entity isolation verified (live) | PENDING | Automated tests PASS across all entities; live staging verification pending |
| B08 | Background job compatibility verified | PASS (CODE) / NOT VERIFIED (LIVE) | `scripts/hostinger-worker.mjs` supports both VPS systemd & `--once` cron mode; live staging execution pending |
| B09 | Persistent storage verified | NOT VERIFIED | Verify persistent volume / object storage on target Hostinger plan |
| B10 | SSL and domain configuration verified | NOT VERIFIED | Requires live DNS & TLS certificate |
| B11 | Migration rehearsal PASS | PASS (REHEARSAL) / PENDING (STAGING) | 56 migrations rehearsed in `drill:backup-restore` & PGlite; staging PG rehearsal pending |
| B12 | Backup restore drill PASS | PASS (REHEARSAL) / PENDING (LIVE) | `npm run drill:backup-restore` PASS (AES-256-GCM, 371ms RTO rehearsal); live production DB drill pending |
| B13 | Monitoring and alerting active | NOT VERIFIED | Structured logging & `/api/health/ready` correlation IDs implemented; host alerting stack pending |
| B14 | Rollback procedure validated | PENDING | Documented in `docs/deployment/HOSTINGER_DEPLOYMENT_RUNBOOK.md`; staging rehearsal pending |
| B15 | Staging E2E PASS | NOT VERIFIED | Requires staging deployment |
| B16 | Performance acceptance criteria PASS | NOT VERIFIED | Requires staging load test |
| B17 | Business UAT sign-off | PENDING | 1,203+ automated UAT PASS; human Business Owner sign-off required |
| B18 | Finance sign-off | PENDING | Required before lifting Hostinger Finance fail-closed (`503`) guard |
| B19 | Security sign-off | PENDING | Independent security sign-off required |
| B20 | Explicit production release approval | BLOCKED | No merge to `main` or production deployment without explicit approval |

**Gate B Recommendation:** **NO-GO (Infrastructure Provisioning, Live Staging Verification, and Explicit Human Sign-Offs Required).**
