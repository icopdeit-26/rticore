# Wave 09 — Business journey traceability
Scope: repository technical tests, not signed authenticated end-to-end business UAT. A single test file or group may cover only selected steps. Every journey requires a single linked trace across the specified services, roles and persisted references before business sign-off.

| Journey | Existing technical test source | Missing or unverified business evidence |
|---|---|---|
| J1 VAPT Lead-to-Revenue | sales-lifecycle-transactions.test.cjs; service-operations.test.cjs; rticore-erp-foundation.test.cjs | One authenticated lead, tender/quotation, VAPT finding/retest, BAST, invoice, payment and posted GL chain |
| J2 SOC recurring service | service-operations.test.cjs | Linked real onboarding, SLA event, case, monthly report, billing, renewal and GL |
| J3 OEM Procure-to-Pay | rticore-erp-foundation.test.cjs; service-operations.test.cjs; rti-finance-uat-520.test.cjs | Linked approved vendor offer, PO, receipt, license fulfillment, AP and payment |
| J4 FlexGuard credit-to-revenue | flexguard-product-terms-acceptance.sql; psa-timesheets.test.cjs; service-operations.test.cjs | Native isolated purchase/consumption to GL and acknowledgement covered; real contract evidence, top-up, expiry, adjustment and per-lot reconciliation not certified |
| J5 GRC advisory | service-operations.test.cjs | Complete live control evidence, milestone/BAST, collection, actual cost and margin chain |
| J6 Workforce-to-finance | psa-timesheets.test.cjs; rti-finance-uat-520.test.cjs | Linked HR resource, expense, AP, GL closing and independent approval |
| J7 Incident-to-resolution | service-operations.test.cjs; rticore-erp-foundation.test.cjs | Actual service desk ticket, entitlement clock, escalation, resolution evidence, billing; dedicated service desk gap remains |
| Cross-system CAMSRTI-to-GL | cams-native-draft-acceptance.sql; cams-independent-review-acceptance.sql; wave09-recovery-posted-fixture.sql | Authenticated CAMS dispatch/retry/ACK across both deployed apps, actual approved scope and real independent users |

Dedicated Wave09 CI executes four existing route integration suites under synthetic SQLite/D1 fixtures and preserves TAP. Native PostgreSQL CAMS/FlexGuard and recovery run in separate native workflow. No journey is marked business PASS from those outputs.
