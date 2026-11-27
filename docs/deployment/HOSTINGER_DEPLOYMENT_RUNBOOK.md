# 15. Hostinger Production Deployment Runbook (H01–H14)

## Architecture Recommendation (Evidence-Based)
**Recommended Target:** **Hostinger VPS KVM** (Ubuntu 24.04 LTS, Node.js 24 LTS) with external managed PostgreSQL 16 (TLS `sslmode=verify-full`), Nginx reverse proxy, OAuth2 Proxy + Keycloak OIDC realm (mandatory OTP MFA), and systemd-supervised Node.js + durable background worker (`rticore.service` + `rticore-worker.service`).  
*Why VPS KVM over Hostinger Shared Web Hosting:* Enterprise requirements for loopback origin isolation (`127.0.0.1`), Nginx header scrubbing (`X-RTICore-OIDC-Token`, `X-Finance-Role`), persistent background worker (`scripts/hostinger-worker.mjs`), external TLS PostgreSQL pooling, and deterministic memory allocation (`RTICORE_BUILD_CPUS=1`) are not guaranteed on shared web hosting. If shared hosting cron is required for non-persistent jobs, invoke `node scripts/hostinger-worker.mjs --once` via cron.

## Deployment Procedure (Staging First — Never Direct to Production)
1. **Provision Environment (`/etc/rticore/rticore.env`, `chmod 600`, never in Git):**
   - `RTICORE_RUNTIME=hostinger`, `RTICORE_LOCAL_MODE=0`, `HOSTNAME_BIND=127.0.0.1`, `PORT=3000`
   - `RTICORE_PUBLIC_ORIGIN=https://<canonical-domain>`
   - `RTICORE_OIDC_ISSUER=https://<keycloak-host>/realms/<realm>`, `RTICORE_OIDC_CLIENT_ID`, `RTICORE_OIDC_AUDIENCE`, `RTICORE_OIDC_CLIENT_SECRET` (>=32 chars)
   - `DATABASE_URL=postgresql://<least_priv_user>:<pass>@<pg_host>:5432/<db>?sslmode=verify-full`
   - `RTICORE_DOCUMENT_ENCRYPTION_KEY`, `RTICORE_AI_ENCRYPTION_KEY`
2. **Pre-Migration Backup & Controlled Migration (Separate Migration Account):**
   - Take encrypted `pg_dump` backup and verify SHA-256 checksum.
   - Apply `rticore_postgresql_schema.sql` and `rticore_postgresql_triggers.sql` using a dedicated migration role (never runtime role).
3. **Build & Verify:**
   - `npm ci --no-audit --no-fund`
   - `npm run typecheck && NEXT_TELEMETRY_DISABLED=1 RTICORE_BUILD_CPUS=1 npm run build`
4. **Preflight & Supervised Start:**
   - `npm run preflight:hostinger` (validates TLS, tables, 295 active triggers, non-privileged DB role, active membership — read-only).
   - Enable `deployment/hostinger/rticore.service` and `deployment/hostinger/rticore-worker.service`.
   - Deploy hardened `deployment/hostinger/nginx-rticore.conf.example` and verify `nginx -t`.
5. **Post-Deployment Validation:**
   - Verify `GET /api/health/live` → `200`, `GET /api/health/ready` → `200` (`core_ready`, correlation ID, DB latency).
   - Keep RTI Finance fail-closed (`503`) until staging reconciliation, Business UAT, Finance Controller, and Security sign-offs are recorded.
6. **Rollback Procedure:**
   - Point `/opt/rticore/current` symlink back to previous verified release, restart `rticore.service` and `rticore-worker.service`. Never overwrite newly posted financial ledger rows during application rollback.
