# Foundation certification V5 — WP01–WP10
Baseline 3ca65eef90fb1b21fb086e5312177bae1e96cb39: 20/20 CI PASS on 2026-11-26; main 11613564e6cc8daf5718f7cef363984252998ac8. Evidence belongs to that SHA only. New commits require fresh CI. Draft PR #1; release HOLD.

| WP | Repository deliverable | Remaining acceptance |
|---|---|---|
| WP01 | This baseline and existing R01–R08 register | Exact head CI and approved reviews |
| WP02 | Independent review checklist below | External reviewer and signed report |
| WP03 | Read-only historical digest and journal invariants | Actual source/ledger reconciliation, disposition of processed events without journal (some event types are nonposting), Finance approval |
| WP04 | Existing staging handoff and preflight | Isolated Hostinger access, verified DNS/TLS/OIDC |
| WP05 | PostgreSQL CI and aggregate journal checks | Actual migration rehearsal, privileges, schema and data integrity |
| WP06 | Quarantine unimplemented worker handlers instead of false completion | Real handlers, retries, leases/crash recovery, alerts, live certification |
| WP07 | Existing synthetic backup drill | Actual encrypted PostgreSQL restore in isolated environment and measured RTO/RPO |
| WP08 | Read-only page/API inventory | Map 30 domains, role/object authorization and end-to-end activation |
| WP09 | Deduplicate two existing 210-case catalogs | Map remaining scenarios and link 2,000 distinct executed cases to evidence; no implied certification |
| WP10 | Release hold and sign-off requirements | Staging, business, Finance, independent security and explicit release authority |

## Independent evidence and release procedure
Reviewer separate from implementer must record exact source SHA, staging deployment SHA, scope, actor, execution time, test method, expected/actual, evidence location, unresolved findings and explicit decision. Test authentication/MFA, tenant/entity isolation, maker-checker, approval amounts, API authorization, integrity/replay, secrets, dependencies, TLS, worker and restore. No self-certification. Finance Controller independently compares approved source documents, event IDs, journal entries, trial balances and FlexGuard wallet records. Report nonposting event types separately. Never rehash or replay historical processed events to hide exceptions. No production writes or automatic deployment by this package.

The inventory reports definitions, not executed cases. A zero-row database or clean digest scan is not evidence of historical completeness. The worker has no certified handlers; do not enable it in actual staging until an operator accepts the quarantine behavior or actual handlers are implemented. No merge, guard removal, or Wave 02 activation while mandatory gates are open.
