# RTICore Existing System Audit Report (Batch 00 — Phase Zero)

**Audit Date:** 2026-11-26  
**Repository:** `https://github.com/serayamg/RTICore`  
**Audited Development Branch:** `feature/hostinger-finance-docking` (baseline SHA `75d99ba27927744cd82883cbfbec2758fa3d0c56`)  
**Production Branch (`main`):** `e5e7ace26ca6063812d0ce9299e97a28970487d5`  
**Pull Request Reference:** PR #1 (`feature/hostinger-finance-docking` → `main`)  
**Local Verification Environment:** Windows, Node.js `v26.13.0`, npm `11.20.0`, Next.js `16.4.2`, SQLite `node:sqlite` + embedded `@electric-sql/pglite` `0.5.15`.  

---

## 1. Repository & Branch Verification

| Item | Verified Baseline State | Status |
|---|---|---|
| `main` | `e5e7ace26ca6063812d0ce9299e97a28970487d5` (RTI Finance WP00–WP10, 0052) | VERIFIED |
| `feature/hostinger-finance-docking` | `75d99ba27927744cd82883cbfbec2758fa3d0c56` (46 files changed vs `main`: +1,045 / -204) | VERIFIED |
| `feat/rticore-local-mode` | `e5e7ace26ca6063812d0ce9299e97a28970487d5` (identical to `main`) | VERIFIED |
| GitHub API / PR #1 live check-run logs | Repository is private; unauthenticated GitHub API returns HTTP 404 and `gh` CLI is not installed locally. Root causes were reproduced directly against all 31 `.github/workflows/*.yml` definitions and local test execution. | LIMITED_ACCESS |
| External PostgreSQL 16 Server | `psql` and `docker` are not installed locally; embedded `@electric-sql/pglite` verified 267 triggers & parity; external `postgres-server` test (`tests/hostinger-postgres-server.test.cjs`) runs in GitHub Actions `hostinger-candidate-ci.yml`. | PARTIAL (CI_ONLY) |

---

## 2. CI Failure Root Cause Analysis (15 PR #1 Workflows)

Of 31 workflow files in `.github/workflows/`, **15 workflows trigger on PR #1 (`feature/hostinger-finance-docking` → `main`)**.

### Confirmed Root Causes

1. **Source Code Defect — `ReferenceError: process is not defined` in `src/middleware.ts:43` (Breaks 8 of 15 PR #1 Workflows)**
   - **Evidence:** Commit `75d99ba` added `if(process.env.RTICORE_RUNTIME==='hostinger' ...)` without guarding `typeof process !== 'undefined'`.
   - **Impact:** `tests/middleware-route-gate.test.cjs` executes `src/middleware.ts` inside `vm.runInNewContext` without `process`, causing 2/3 tests to throw `ReferenceError: process is not defined`. This fails `npm run test:modules-13-15`, `npm run build:cf`, `npm run gate:automated`, and `npm run test:all`, cascading to 8 PR #1 workflows: `rticore-automated-functional-gate.yml`, `rticore-bid-readiness-ci.yml`, `rticore-customer-delivery-ci.yml`, `rticore-erp-integration-ci.yml`, `rticore-modules-13-15-ci.yml`, `rticore-p1-p2-integration-ci.yml`, `rticore-positive-all-roles-ci.yml`, `sales-multirole-uat-ci.yml`.
   - **Category:** Source code error (Edge/VM sandbox safety).
   - **Remediation:** Guard `const env = typeof process !== 'undefined' ? process.env : undefined;` while preserving full Hostinger origin/CSRF validation.

2. **Cross-OS SQL Line Endings — `test:pg-triggers` Failure on Windows**
   - **Evidence:** `rticore_postgresql_triggers.sql` was checked out with CRLF (`\r\n`) on Windows while `scripts/generate-postgres-triggers.mjs` generates LF (`\n`).
   - **Category:** Repository `.gitattributes` configuration error.
   - **Remediation:** Enforce `*.sql text eol=lf` and `*.sh text eol=lf` in `.gitattributes` and regenerate `rticore_postgresql_triggers.sql` in LF.

3. **Workflow Runtime / Runner Drift**
   - **Evidence:** `campaign-browser-uat.yml` and `rticore-ai-chat-browser-uat.yml` still used `runs-on: ubuntu-latest` with Playwright 1.55.1 (which fails on Ubuntu 26.04 runners). `rticore-branding-ci.yml` and `rticore-erp-uat-catalog-ci.yml` still pinned `node-version: '22'`, and `rticore-branding-ci.yml` invoked `tests/quotation-docx.test.cjs` without `--experimental-strip-types`.
   - **Category:** Workflow configuration error / runtime incompatibility.
   - **Remediation:** Pin both browser workflows to `ubuntu-24.04`, standardize remaining CI workflows on Node.js `24`, and add `--experimental-strip-types`.

---

## 3. Security, Isolation & Architecture Verification

| Control Area | Verification Evidence | Status |
|---|---|---|
| `x-finance-role` privilege escalation | Actively rejected with HTTP `403` on both `GET` (`src/app/api/finance/route.ts:79`) and `POST` (`:416`). Verified by `tests/hostinger-production-safety.test.cjs` and `tests/rti-finance-uat-520.test.cjs`. Zero client override paths remain. | PASS (REMEDIATED) |
| Legal Entity Isolation (Finance & ERP) | `financeEntities()` restricts access to approved `rticore_erp_staff_org` or unrestricted `rticore_finance_role_assignments`. `POST` resolves authoritative target `legal_entity_id` server-side from DB before resolving role. `erpGrant()` enforces recursive approved staff-org + capability matrix. | PASS (AUTOMATED) |
| Production Authentication (Hostinger) | `validateHostingerConfig()` enforces `RTICORE_RUNTIME=hostinger`, `RTICORE_LOCAL_MODE=0`, loopback `HOSTNAME_BIND`, HTTPS `RTICORE_PUBLIC_ORIGIN`, confidential OIDC secret (>=32 chars), and `sslmode=verify-full`. `verifyNativeOIDCToken()` enforces RS256, 15m max lifetime, verified email, `azp`, `sid`. `requireActiveNativeSession()` introspects active session without caching. | PASS (UNIT) / PENDING LIVE IDP |
| Finance Hostinger Fail-Closed Guard | `src/app/api/finance/route.ts` returns HTTP `503` on `RTICORE_RUNTIME === 'hostinger'` until business scope certification, live PostgreSQL reconciliation, and explicit sign-off complete. | ACTIVE (INTENTIONAL) |
| Legacy Demo API Containment | `src/middleware.ts` fail-closes `/api/approvals`, `/api/wallets`, `/api/opportunities`, `/api/proposals`, `/api/tenders` with HTTP `503`. | PASS |
| Database Schema & Triggers | 53 SQL files (`migrations/0001`–`0052`), 164 tables in `rticore_postgresql_schema.sql`, 267 triggers in `rticore_postgresql_triggers.sql`. All 12 parity tests pass against SQLite + PGlite. | PASS |
| Production Workflow Guard | `scripts/rticore-production-workflow-guard.mjs` scanned all 31 workflows: 0 push-triggered production mutations. | PASS |

---

## 4. Baseline Test Execution Summary (Post-Batch 00 Remediation)

- **TypeScript (`npm run typecheck`):** PASS (0 errors)
- **Production Build (`npm run build`):** PASS (55 static pages, all API/app routes compiled)
- **Native HTTP Smoke (`PORT=31415`):** PASS (`/api/health/live` → 200 `{"status":"alive"}`, `/api/health/ready` → 503 without production DB creds)
- **Hostinger Config / OIDC / Session / Safety:** PASS (41/41 tests)
- **RTI Finance UAT 520 (`test:finance-520`):** PASS (all 520 automated scenarios)
- **Sales Lifecycle Transactions (`test:sales-transactions`):** PASS (27/27)
- **ERP Foundation & Extensions (`test:erp`, `test:erp:extensions`):** PASS
- **FlexGuard Immutable Ledger (`test:flexguard`):** PASS
- **Negative Enterprise Matrix (`tests/rticore-negative-enterprise-matrix.test.cjs`):** PASS (44/44)
- **Negative Security & API (`test:rticore-negative`):** PASS (44/44)
- **PostgreSQL Trigger Parity (`test:pg-triggers`):** PASS (12/12 after LF normalization)
- **Modules 13–15 (`test:modules-13-15`):** PASS (after `src/middleware.ts` fix)
- **All 28 Additional Domain Suites** (`executive`, `consolidation`, `layout`, `boq*`, `quotation-docx`, `post-po`, `ai`, `scoping-upload`, `marketing`, `runtime-compat`, `activities`, `p1-p2`, `bid-readiness`, `document-vault`, `feasibility`, `menu-approval`, `postal`, `project-manager`, `governance-team`, `offense-team`, `defense-team`, `itdev-team`, `d1-rename`, `release-controls`, `admin`, `branding`): **28/28 PASS**.
