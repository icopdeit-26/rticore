#!/usr/bin/env bash
# Disposable CI only. Never run against staging or production.
set -euo pipefail
[[ "${CI:-}" == true && "${PGHOST:-}" == 127.0.0.1 && "${PGPORT:-}" == 5432 && "${PGUSER:-}" == cams_ci && "${PGDATABASE:-}" == cams_docking_ci && -z "${PGSERVICE:-}" && -z "${PGHOSTADDR:-}" ]]
q() { psql -X -v ON_ERROR_STOP=1 "$@"; }
# Real independent PostgreSQL sessions, disposable databases only. All 40 contenders
# use the same actor; exactly 20 must reserve successfully.
ai_concurrency() {
  local tag="$1" actor
  [[ "$tag" == original || "$tag" == restored ]]
  actor="ai-concurrency-${tag}@example.invalid"
  q -c "INSERT INTO rticore_members(email,role,active,created_by) VALUES('$actor','admin',1,'ci')"
  local i
  for i in $(seq 1 40); do
    q -Atc "SELECT rticore_reserve_ai_request('ai-concurrency-$tag-$i','defendit360','$actor','chat')" >"$tmp/ai-$tag-$i" &
    if (( i % 8 == 0 )); then
      # Each worker must return exactly one boolean. Failure is detected below.
      wait
    fi
  done
  [[ "$(grep -hxc 't' "$tmp"/ai-"$tag"-* | awk '{s+=$1} END{print s}')" == 20 ]]
  [[ "$(grep -hxc 'f' "$tmp"/ai-"$tag"-* | awk '{s+=$1} END{print s}')" == 20 ]]
  [[ "$(q -Atc "SELECT count(*) FROM rticore_sales_ai_audit WHERE actor_email='$actor' AND provider_id='request'")" == 20 ]]
}

[[ "$(q -Atc 'SELECT current_database()')" == cams_docking_ci ]]
dir=deployment/hostinger/migrations
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
node scripts/native-migration-manifest.mjs --paths >"$tmp/native-paths"
q -f "$dir/0053_finance_vendor_bank_entity_scope.sql"
# Reproduce a legacy cross-entity period reference on the real pre-0054 schema.
q <<'SQL'
INSERT INTO rticore_erp_org_units(id,tenant_id,code,label,kind,created_by) VALUES
 ('p0-rehearsal-a','defendit360','P0-REHEARSAL-A','Rehearsal A','legal_entity','ci'),
 ('p0-rehearsal-b','defendit360','P0-REHEARSAL-B','Rehearsal B','legal_entity','ci');
INSERT INTO rticore_gl_periods(id,tenant_id,legal_entity_id,period,created_by)
 VALUES('p0-rehearsal-period','defendit360','p0-rehearsal-a','2026-11','ci');
INSERT INTO rticore_gl_journals(id,tenant_id,legal_entity_id,period_id,source_type,source_key,memo,created_by)
 VALUES('p0-rehearsal-bad','defendit360','p0-rehearsal-b','p0-rehearsal-period','ci','p0-rehearsal-bad','Synthetic invalid historic journal','ci');
SQL
if q -f "$dir/0054_finance_entity_constraints.sql" >"$tmp/rejected.log" 2>&1; then
  echo 'ERROR: migration accepted invalid historical row' >&2; exit 1
fi
grep -q 'p0_journal_period_entity_fk' "$tmp/rejected.log"
[[ "$(q -Atc "SELECT count(*) FROM pg_constraint WHERE conname='p0_journal_period_entity_fk'")" == 0 ]]
[[ "$(q -Atc "SELECT count(*) FROM rticore_gl_journals WHERE id='p0-rehearsal-bad'")" == 1 ]]
# Remove ONLY the intentional synthetic fixture; no real data is used.
q -c "DELETE FROM rticore_gl_journals WHERE id='p0-rehearsal-bad'"
q -f "$dir/0054_finance_entity_constraints.sql"
q -f tests/flexguard-commercial-fixture.sql
q -f rticore_postgresql_triggers.sql
# Apply all approved native streams, and replay to detect unsafe DDL changes.
for pass in 1 2; do
  while IFS= read -r migration; do
    q -f "$migration"
  done <"$tmp/native-paths"
done
q -f tests/cams-native-draft-acceptance.sql
q -f tests/cams-independent-review-acceptance.sql
q -f tests/native-ai-budget-acceptance.sql
q -f tests/native-feature-governance-acceptance.sql
q -f tests/native-operations-queue-acceptance.sql
q -f tests/native-dfir-custody-acceptance.sql
q -f tests/native-soc-sla-acceptance.sql
node --test tests/native-preflight-postgres.test.mjs
ai_concurrency original
[[ "$(q -Atc "SELECT to_regprocedure('public.rticore_fg_psa_submit(text,text,text,text,text,text,text,text,jsonb,text,text)') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.rticore_fg_psa_consumption_evidence'::regclass AND c.contype='p' AND c.convalidated AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord)=ARRAY['tenant_id','timesheet_id'])")" == t ]]
q -f tests/flexguard-product-terms-acceptance.sql
# Persist a separate synthetic CAMS journal and audit trail before logical backup.
q -f tests/wave09-recovery-posted-fixture.sql
mkdir -p artifacts/wave09
fingerprint() {
 local target="$1" table count hash
 : >"$target"
 for table in rticore_members rticore_erp_org_units rticore_sales_ai_audit rticore_delivery_projects rticore_billing_invoices rticore_gl_journals rticore_gl_lines rticore_finance_journal_workflows rticore_operations_events rticore_cams_finance_inbox rticore_iam_credentials rticore_iam_sessions rticore_flexguard_enterprise_ledger; do
  count="$(q -Atc "SELECT count(*) FROM public.$table")"
  hash="$(q -Atc "SELECT row_to_json(t)::text FROM public.$table t ORDER BY row_to_json(t)::text COLLATE \"C\"" | sha256sum | cut -d ' ' -f1)"
  printf '%s\t%s\t%s\n' "$table" "$count" "$hash" >>"$target"
 done
}
fingerprint "$tmp/before.tsv"
start="$(date +%s%3N)"
pg_dump --format=custom --file="$tmp/rticore.dump"
backup_ms=$(( $(date +%s%3N) - start ))
backup_bytes="$(stat -c %s "$tmp/rticore.dump")"
backup_hash="$(sha256sum "$tmp/rticore.dump" | cut -d ' ' -f1)"
start="$(date +%s%3N)"
createdb cams_docking_restore_ci
pg_restore --exit-on-error --no-owner --no-privileges --dbname=cams_docking_restore_ci "$tmp/rticore.dump"
restore_ms=$(( $(date +%s%3N) - start ))
export PGDATABASE=cams_docking_restore_ci
fingerprint "$tmp/after.tsv"
# Compare deterministic row counts and content digests before any post-restore writes.
diff -u "$tmp/before.tsv" "$tmp/after.tsv"
[[ "$(q -Atc "SELECT count(*) FROM rticore_gl_journals j JOIN rticore_finance_journal_workflows w ON w.tenant_id=j.tenant_id AND w.journal_id=j.id WHERE j.source_key='OUTBOX-JRN-recovery' AND j.status='posted' AND j.reviewed_by='cams-recovery-check@example.invalid' AND j.posted_by='cams-recovery-post@example.invalid' AND w.lifecycle_stage='posted'")" == 1 ]]
[[ "$(q -Atc "SELECT count(*) FROM rticore_operations_events e JOIN rticore_gl_journals j ON j.tenant_id=e.tenant_id AND j.id=e.entity_id WHERE j.source_key='OUTBOX-JRN-recovery' AND e.action IN ('CAMS_JOURNAL_APPROVED','CAMS_JOURNAL_POSTED')")" == 2 ]]
cp "$tmp/before.tsv" artifacts/wave09/restore-table-digests.tsv
node -e 'const [backupMs,restoreMs,bytes,hash,sha]=process.argv.slice(1);const fs=require("node:fs");fs.writeFileSync("artifacts/wave09/restore-evidence.json",JSON.stringify({scope:"disposable_logical_restore",source_sha:sha,backup_ms:Number(backupMs),restore_ms:Number(restoreMs),backup_bytes:Number(bytes),backup_sha256:hash,compared_tables:13,row_content_match:true,posted_journal_and_audit_match:true,production_rto_rpo_certified:false,privilege_restore_verified:false},null,2)+"\n")' "$backup_ms" "$restore_ms" "$backup_bytes" "$backup_hash" "$(git rev-parse HEAD)"
[[ "$(q -Atc "SELECT count(*) FROM rticore_erp_org_units WHERE id IN ('p0-rehearsal-a','p0-rehearsal-b')")" == 2 ]]
[[ "$(q -Atc "SELECT count(*) FROM pg_constraint WHERE conname LIKE 'p0\\_%\\_entity\\_fk' AND contype='f' AND convalidated")" == 16 ]]
[[ "$(q -Atc "SELECT to_regclass('public.rticore_iam_credentials') IS NOT NULL AND to_regclass('public.rticore_iam_sessions') IS NOT NULL")" == t ]]
q -f tests/cams-native-draft-acceptance.sql
q -f tests/cams-independent-review-acceptance.sql
q -f tests/native-ai-budget-acceptance.sql
q -f tests/native-feature-governance-acceptance.sql
q -f tests/native-operations-queue-acceptance.sql
q -f tests/native-dfir-custody-acceptance.sql
q -f tests/native-soc-sla-acceptance.sql
node --test tests/native-preflight-postgres.test.mjs
ai_concurrency restored
q -f tests/flexguard-product-terms-acceptance.sql
[[ "$(q -Atc "SELECT to_regprocedure('public.rticore_fg_psa_submit(text,text,text,text,text,text,text,text,jsonb,text,text)') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.rticore_fg_psa_consumption_evidence'::regclass AND c.contype='p' AND c.convalidated AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord)=ARRAY['tenant_id','timesheet_id'])")" == t ]]
echo 'PASS: disposable migration rejection, replay, CAMS acceptance and logical restore (not production certification)'
