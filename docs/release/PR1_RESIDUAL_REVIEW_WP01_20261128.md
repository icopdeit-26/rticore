# PR1 residual review — work packet 01 (HOLD)

Baseline candidate d3e027d1530053c5bb43056663562d8ccbc2f9e4; original PR1 source 57b0c3230623b8f122359df13eabe305d60a4e55. The exact candidate inventory CI reported 66 semantic and 25 native-port review required. No independent disposition is asserted here.

## Source comparison performed
- campaign-browser-uat.yml and rticore-ai-chat-browser-uat.yml: old tag-based checkout/setup references replaced by full SHA; fixture startup explicitly binds loopback via Next CLI instead of production npm start. Browser fixture coverage still needs exact-SHA review where these workflows did not trigger.
- hostinger-node22-build.yml: retained build gate, added runner preflight, isolated PostgreSQL atomicity/Finance/Business IAM tests and SHA pins. Candidate native build passed; actual managed launcher acceptance still required.
- rticore-branding-ci.yml: additional command-palette regression, Node 22 target, SHA pins. Candidate branding passed.
- rticore-erp-uat-catalog-ci.yml: SHA pins and Node 22; catalog integrity is not individual business UAT.
- IDENTITY-SETUP.md, keycloak-realm.template.json, nginx-rticore.conf.example and oauth2-proxy.cfg.example: later VPS/OIDC hardening is present, but these are not the Business Web Hosting deployment profile. Do not restore Keycloak, Redis, Nginx or systemd as mandatory prerequisites. Use BUSINESS-HOSTING.md; optional VPS profile review remains open.
- next.config.mjs: removed webpackMemoryOptimizations, added browser security headers. Native build passed; live browser/managed hosting verification required.
- start-hostinger.mjs: managed bind intentionally differs from loopback-only VPS; configuration validation remains. Actual managed launch, preflight and origin boundary must be demonstrated.
These are preliminary comparisons, not independent closure. All 91 unresolved dispositions remain subject to evidence review.

## Production gate hardening
The existing signed native receipt now additionally requires a typed PR1 disposition record among functional_completion evidence. Use schema rticore-pr1-residual-disposition-v1, release_sha, source_sha, inventory_sha256, and files (each path, source_sha, current_sha or null, disposition, rationale, reviewer_subject, evidence). Each unresolved file must match the exact candidate bytes and original inventory; reviewer must be an approved receipt signoff and at least one separate hash-verified trace is required. Missing or stale dispositions fail closed. No real reviewer identity or evidence is created by this change.

## Blockers
GitHub branch main reported protected:false and no enforced checks; branch protection endpoint returned 403 to the integration. Owner must configure and verify protections. Live staging, actual migration ledger, authenticated individual UAT, target backup/restore, approvals and production deployment remain unverified. No production mutation.
