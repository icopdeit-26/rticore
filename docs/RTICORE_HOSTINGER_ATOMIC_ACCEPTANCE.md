> Historical PR #5 evidence only. Superseded by native Hostinger IAM (no Cloudflare Access), strict TLS, and serializable PostgreSQL batch. Do not use this as a deployment runbook.

# Native PostgreSQL acceptance
PR #5 baseline dbab148: all 13 workflows failed; sampled three jobs had no runner and zero steps. Extracted production batch helper for direct PostgreSQL 16 integration test (concurrent commit and rollback, exact persisted rows, backend PID). CI-only disposable database; no real customer data. Test not yet executed; source assertions are not runtime proof. PR #1 and #4 remain separate; reconcile before release. No merge or deploy.
