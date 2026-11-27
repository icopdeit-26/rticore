# 12. Segregation of Duties (SoD) Matrix

All maker-checker controls below are enforced **both in API handlers AND via PostgreSQL/SQLite `CHECK` constraints / triggers** so they cannot be bypassed:

| Transaction / Control Area | Maker Role(s) | Checker / Approver Role(s) | Database / Trigger Enforcement |
|---|---|---|---|
| **Service Catalog Approval (`0053`)** | Admin, Presales, Finance | Independent Admin, Approver, Finance | `CHECK(approved_by IS NULL OR lower(approved_by) != lower(created_by))` |
| **19-Role Rate Card Approval (`0053`)** | Admin, Finance | Independent Admin, Approver | `CHECK(approved_by != created_by)` + `APPROVED_RATE_CARD_IMMUTABLE` trigger |
| **Pricing Scenario & Snapshot Freeze (`0053`)** | Presales, Sales, Finance, Admin | Independent Approver, Finance, Admin | `CHECK(approved_by != created_by)` + `PRICING_SNAPSHOT_IMMUTABLE` trigger |
| **FlexGuard Package Approval (`0054`)** | Finance, Presales, Admin | Independent Approver, Admin | `CHECK(approved_by != created_by)` |
| **FlexGuard Credit Adjustment (`0054`)** | Finance, Admin | Independent Approver, Admin | `rticore_fg_ent_ledger_no_tamper` rejects `approved_by = actor_email` |
| **FlexGuard Wallet Entitlement (`0030`)** | Finance, Admin | Independent Approver, Admin | `CHECK(lower(approved_by) != lower(created_by))` |
| **Feature Flag Activation (`0053`)** | Admin | Independent Admin2, Approver | `CHECK(approved_by != requested_by)` |
| **Enterprise Control Effectiveness Test (`0055`)** | Control Owner | Independent Auditor / Approver / GRC | `CHECK(tested_by IS NULL OR lower(tested_by) != lower(control_owner_email))` |
| **Backup & Restore Drill Sign-Off (`0055`)** | Admin (Executor) | Independent Approver / Admin2 | `CHECK(verified_by IS NULL OR lower(verified_by) != lower(executed_by))` |
| **Journal Posting, Payment Release, Period Reopen, PO Verification (`0012`–`0052`)** | Finance / Accounting / Sales | Independent Checker / Approver / Legal | Enforced in `0012`, `0035`, `0041`, `0052` triggers & APIs |
