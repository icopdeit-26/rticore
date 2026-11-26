# 16. Backup & Disaster Recovery Runbook (H11)

**Target SLA (Pending Live Production Drill Certification):**
- **RPO Target:** ≤ 60 minutes (continuous WAL archiving / hourly encrypted logical dumps)
- **RTO Target:** ≤ 240 minutes (4 hours)

## Automated Rehearsal Drill Tooling
Run locally or in CI:
```bash
npm run drill:backup-restore
```
`scripts/hostinger-backup-restore-drill.mjs` performs:
1. Full 56-migration schema snapshot (`0001`–`0055`) with representative data.
2. AES-256-GCM authenticated encryption + SHA-256 checksum verification.
3. Decryption and isolated restoration into a clean database instance.
4. Automated foreign-key check (`PRAGMA foreign_key_check`), integrity check, and row-count reconciliation.

## Production PostgreSQL DR Procedure
1. **Automated Backup:** Schedule hourly `pg_dump --format=custom` encrypted with AES-256-GCM / age / KMS and replicated to off-site object storage (minimum 35-day retention + immutable WORM bucket for financial period closes).
2. **Encryption Keys Continuity:** Store `RTICORE_DOCUMENT_ENCRYPTION_KEY`, `RTICORE_AI_ENCRYPTION_KEY`, and backup decryption keys in an independent enterprise secrets manager (never inside the database backup).
3. **Restore Verification & SoD Sign-Off:**
   - Restore to an isolated staging PostgreSQL database.
   - Verify schema tables, 289 active triggers, GL trial balance equality (`sum(debit_cents) = sum(credit_cents)`), and FlexGuard credit ledger reconciliation.
   - Record drill evidence via `POST /api/erp/operations-jobs` (`action: 'record_backup_drill'`) and obtain independent SoD sign-off (`action: 'verify_backup_drill'`, `verified_by != executed_by`).
