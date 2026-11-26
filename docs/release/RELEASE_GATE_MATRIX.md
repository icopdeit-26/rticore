# RTICore Release Gate Matrix (V4.0)

Status legend: `PASS` | `FAIL` | `PENDING` | `BLOCKED` | `NOT VERIFIED`

**Updated:** 2026-11-26 (Batch 00 Baseline — will be updated at each batch completion)

---

## Gate A — Safe Merge Readiness (`feature/hostinger-finance-docking` → `main`)

| # | Gate Criterion | Status | Evidence / Notes |
|---|---|---|---|
| A01 | Current SHA verified | PASS | Baseline `75d99ba` verified; Batch 00 remediation in progress |
| A02 | No unresolved merge conflicts | PASS | Clean fast-forward lineage from `main` (`e5e7ace`) |
| A03 | Required reviews completed | PENDING | Requires human PR review on GitHub PR #1 |
| A04 | PR ready for review | PENDING | Pending completion of development batches & push |
| A05 | Node.js compatibility PASS | PASS | Verified on Node `v26.13.0`; CI workflows standardized on Node `24` LTS |
| A06 | Typecheck PASS | PASS | `npm run typecheck` exited 0 |
| A07 | Production build PASS | PASS | `npm run build` exited 0 (Next.js 16.4.2 webpack, 55 static pages) |
| A08 | PostgreSQL integration PASS | PARTIAL (`NOT VERIFIED` external PG locally) | 12/12 SQLite↔PGlite trigger parity PASS; external PostgreSQL 16 server test (`tests/hostinger-postgres-server.test.cjs`) runs in GitHub Actions `postgres-server` job |
| A09 | Native HTTP smoke PASS | PASS | `GET /api/health/live` → 200, `GET /api/health/ready` → 503 (fail-closed without prod creds) |
| A10 | Finance UAT 520 PASS | PASS | `npm run test:finance-520` PASS |
| A11 | Sales multirole PASS | PASS | `npm run test:sales` & `test:sales-transactions` (27/27) PASS |
| A12 | All-role simulation PASS | PENDING | Core automated suites PASS after `src/middleware.ts` fix; Playwright browser matrix requires CI Ubuntu 24.04 run |
| A13 | Modules 13–15 PASS | PASS | `npm run test:modules-13-15` PASS after REM-001 fix |
| A14 | Pricing engine tests PASS | PENDING | Baseline `test:pricing` PASS; V4.0 120+ scenario Pricing & Mandays suite scheduled in Batch 02–03 |
| A15 | FlexGuard critical tests PASS | PENDING | Baseline `test:flexguard` PASS; V4.0 150+ scenario FlexGuard suite scheduled in Batch 04–05 |
| A16 | Security regression PASS | PASS | `test:rticore-negative` (44/44), `rticore-negative-enterprise-matrix` (44/44), `hostinger-production-safety`, `native-oidc`, `native-session` PASS |
| A17 | Comprehensive regression PASS | PASS | All 42 local non-browser test suites PASS |
| A18 | No unresolved critical/high vulnerabilities | PASS | `npm audit` reported 0 critical, 0 high (1 moderate only) |
| A19 | Migration review completed | PASS (0001–0052) | Will re-verify upon adding `0053`–`0055` |
| A20 | No unauthorized RBAC changes | PASS | Server-side RBAC, `x-finance-role` blocked (403), Finance Hostinger guard preserved |

**Gate A Recommendation (Batch 00):** **NO-GO** (Pending PR #1 CI execution on GitHub, external PostgreSQL job confirmation, human review, and V4.0 batches).

---

## Gate B — Hostinger Deployment Readiness

| # | Gate Criterion | Status | Evidence / Notes |
|---|---|---|---|
| B01 | Gate A PASS | BLOCKED | Dependent on Gate A |
| B02 | Target Hostinger plan verified | NOT VERIFIED | Hostinger VPS KVM recommended over shared Web Hosting for Node 24, loopback Nginx+OAuth2-Proxy, persistent worker & external TLS PostgreSQL |
| B03 | Runtime verified on target host | NOT VERIFIED | Requires live Hostinger staging environment |
| B04 | Production environment variables configured | BLOCKED | Secrets must be provisioned out-of-band on server (`/etc/rticore/rticore.env`), never in Git |
| B05 | PostgreSQL production connectivity verified | NOT VERIFIED | Requires managed external PostgreSQL with `sslmode=verify-full` and least-privilege role |
| B06 | Production authentication verified | NOT VERIFIED | Requires live Keycloak OIDC realm + mandatory OTP + OAuth2 Proxy + Nginx loopback gateway |
| B07 | Legal entity isolation verified (live) | PENDING | Automated unit/integration PASS; live staging verification pending |
| B08 | Background job compatibility verified | PENDING | Durable DB job queue + worker scheduled in Batch 15 |
| B09 | Persistent storage verified | NOT VERIFIED | Verify external object storage / persistent volume on Hostinger target |
| B10 | SSL and domain configuration verified | NOT VERIFIED | Requires live DNS + TLS certificate on production domain |
| B11 | Migration rehearsal PASS | PENDING | Automated PGlite/SQLite rehearsal PASS; staging PostgreSQL rehearsal pending |
| B12 | Backup restore drill PASS | PENDING | Automated local drill script scheduled in Batch 15; live RPO ≤ 1h / RTO ≤ 4h drill pending target DB |
| B13 | Monitoring and alerting active | NOT VERIFIED | Requires target host observability stack |
| B14 | Rollback procedure validated | PENDING | Runbook scheduled in Batch 15–18; live rehearsal pending staging |
| B15 | Staging E2E PASS | NOT VERIFIED | Requires staging deployment |
| B16 | Performance acceptance criteria PASS | NOT VERIFIED | Requires staging load test |
| B17 | Business UAT sign-off | PENDING | Automated 1,200+ UAT suite scheduled in Batch 16; human business owner sign-off required |
| B18 | Finance sign-off | PENDING | Required before lifting Hostinger Finance fail-closed guard |
| B19 | Security sign-off | PENDING | Independent security sign-off required |
| B20 | Explicit production release approval | BLOCKED | Never deploy or merge to `main` without explicit operator approval |

**Gate B Recommendation:** **NO-GO** (Infrastructure provisioning, live Keycloak/PostgreSQL validation, staging rehearsal, and explicit approvals required).
