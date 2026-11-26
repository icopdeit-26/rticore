# Batch 01–04 reconciliation — 2026-11-26

Main baseline: e5e7ace26ca6063812d0ce9299e97a28970487d5. Candidate: 4bfdc3d0a13a76f6f6f86b52f0f52a5bde1c685a (38 commits ahead, zero behind). Dedicated feature branch fast-forwarded to candidate; main untouched.

## Evidence and dispositions
- Local-mode branch identical to main. Project-manager-role diverged (17 ahead, 13 behind), overlapping migration numbers 0046–0051; do not merge blindly. Local PM release diverged (1 ahead, 6 behind), activities page change requires manual review.
- Finance API rejects client-selected role header; persisted assignments, entity checks and preview denial present. Hostinger Finance remains fail-closed (503); do not lift until certification.
- Native Hostinger runtime, OIDC configuration, PostgreSQL pooled transaction and no runtime DDL are present in candidate. Actual target infrastructure not verified.
- Existing candidate documentation reports local tests; these are historical claims, not independent execution evidence on this repository.
- Candidate CI uses Node 24, disposable PostgreSQL 16, native smoke, finance and regression suites; request fresh PR-triggered checks. No production deployment or data migration authorized by this change.

## Mandatory release hold
NO-GO until fresh CI on exact head, review of divergent changes, independent security and finance acceptance, staging PostgreSQL migration/restore rehearsal, authentication and live end-to-end validation. Do not merge or deploy. See RELEASE_GATE_MATRIX.md for full gates.
