# RTICORE — rehearsal 0053–0054, 27 November 2026
Scope: dedicated synthetic PostgreSQL 16 project `empty-bar-45943236`, branch `br-bitter-pine-bfr9rkuz`, database `rticore_rehearsal`. No production/staging business rows or secrets were copied. Baseline candidate SHA 8b8974c12b45598eeff30279bc16d89f4ac24345. Schema blob 83e821ea8dfe5cb18917bda33d0d78884a4fcaec, excluding appended 0053; 364 SQL statements loaded successfully. 0053 blob dbad08510201452065dd65977a9280f0c72edbd3; 0054 blob c5f45011d6db1e2be817e49d84c14eacb8bbfdc7. Migration 0054 statements ran in the connector's enclosing SQL transaction rather than nested BEGIN/COMMIT. No production mutations.

| Test | Actual result |
|---|---|
| 0053 apply / reapply | PASS / PASS |
| Legacy account quarantine | 1 unmapped synthetic record retained, no inferred ownership |
| Dirty 0054 | SQLSTATE 23503 on p0_journal_period_entity_fk |
| Atomic rollback | 0 new validated FKs, 0 new parent indexes; 2 original journals preserved |
| Synthetic reconciliation | Corrected intentionally wrong period reference of one synthetic journal only |
| Clean 0054 apply / reapply | PASS / PASS |
| Validated FK and indexes | 16 / 6 |
| Cross-entity update after migration | rejected 23503 |
| Orphan/mismatch scan for all 16 FK relationships | 0 after synthetic correction |
| Scoped vendor fixture | one valid linked bank account, one unassigned legacy account with no evidence-backed candidate |
| Integration digest | 2 synthetic events; 1 valid, 1 mismatch (processed) |
| Settlement evidence | 1 processed without journal; 1 missing processing metadata; not repaired or replayed |
| Timesheet, procurement, contract source scans | executed but 0 matching events, NO DATA (not reconciliation PASS) |
| FlexGuard source scan | blocked: SQLSTATE 42P01; enterprise ledger not in candidate schema |

**NO-GO**: Historical RTICORE business data not accessible; no source owner sign-off, backup/restore of real data or full deployment acceptance. Do not backfill vendor ownership from candidate counts or rehash altered events. Reconcile each real exception with source documents and independent Finance Controller review. Missing FlexGuard enterprise ledger requires canonical schema and migration reconciliation, not a placeholder table. Full trigger application, all individual FK negative paths and full Finance UAT remain unverified. The synthetic project is retained for inspection.
