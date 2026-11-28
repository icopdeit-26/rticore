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
mkdir -p artifacts/wave09
node scripts/native-migration-manifest.mjs > artifacts/wave09/native-migration-manifest.json
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
 # Enumerate application tables from the actual source/restored database, not a partial fixed list.
 local tables
 tables="$(q -Atc "SELECT tablename FROM pg_tables WHERE schemaname='public' AND (left(tablename,8)='rticore_' OR left(tablename,5)='cams_') ORDER BY tablename COLLATE \"C\"")"
 [[ -n "$tables" ]]
 while IFS= read -r table; do
  [[ "$table" =~ ^(rticore_|cams_)[a-z0-9_]+$ ]]
  count="$(q -Atc "SELECT count(*) FROM public.$table")"
  hash="$(q -Atc "SELECT row_to_json(t)::text FROM public.$table t ORDER BY row_to_json(t)::text COLLATE \"C\"" | sha256sum | cut -d ' ' -f1)"
  printf '%s\t%s\t%s\n' "$table" "$count" "$hash" >>"$target"
 done <<< "$tables"
}
# Verify sequence state independently: matching table rows alone cannot detect
# a reset identity sequence and subsequent duplicate-key errors.
sequence_fingerprint() {
 local target="$1" sequence state
 : >"$target"
 local sequences
 sequences="$(q -Atc "SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename COLLATE \"C\"")"
 [[ -n "$sequences" ]]
 while IFS= read -r sequence; do
  [[ "$sequence" =~ ^[a-z_][a-z0-9_]*$ ]]
  state="$(q -Atc "SELECT last_value::text || ':' || is_called::text FROM public.$sequence")"
  [[ "$state" =~ ^-?[0-9]+:(true|false)$ ]]
  printf '%s\t%s\n' "$sequence" "$state" >>"$target"
 done <<< "$sequences"
}
schema_fingerprint() {
 # pg_dump may emit a random psql restrict key; strip only those two metacommands.
 # Ownership and ACLs are deliberately excluded, as this is a logical restore.
 pg_dump --schema-only --no-owner --no-privileges | sed -E '/^\\(un)?restrict [^[:space:]]+$/d' >"$1"
 [[ -s "$1" ]]
}
fingerprint "$tmp/before.tsv"
sequence_fingerprint "$tmp/sequences-before.tsv"
schema_fingerprint "$tmp/schema-before.sql"
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
sequence_fingerprint "$tmp/sequences-after.tsv"
schema_fingerprint "$tmp/schema-after.sql"
# Compare deterministic row counts and content digests before any post-restore writes.
diff -u "$tmp/before.tsv" "$tmp/after.tsv"
diff -u "$tmp/sequences-before.tsv" "$tmp/sequences-after.tsv"
diff -u "$tmp/schema-before.sql" "$tmp/schema-after.sql"
[[ "$(q -Atc "SELECT count(*) FROM rticore_gl_journals j JOIN rticore_finance_journal_workflows w ON w.tenant_id=j.tenant_id AND w.journal_id=j.id WHERE j.source_key='OUTBOX-JRN-recovery' AND j.status='posted' AND j.reviewed_by='cams-recovery-check@example.invalid' AND j.posted_by='cams-recovery-post@example.invalid' AND w.lifecycle_stage='posted'")" == 1 ]]
[[ "$(q -Atc "SELECT count(*) FROM rticore_operations_events e JOIN rticore_gl_journals j ON j.tenant_id=e.tenant_id AND j.id=e.entity_id WHERE j.source_key='OUTBOX-JRN-recovery' AND e.action IN ('CAMS_JOURNAL_APPROVED','CAMS_JOURNAL_POSTED')")" == 2 ]]
cp "$tmp/before.tsv" artifacts/wave09/restore-table-digests.tsv
cp "$tmp/sequences-before.tsv" artifacts/wave09/restore-sequence-state.tsv
schema_hash="$(sha256sum "$tmp/schema-before.sql" | cut -d ' ' -f1)"
node -e 'const [backupMs,restoreMs,bytes,hash,sha,tableCount,sequenceCount,schemaHash]=process.argv.slice(1);const fs=require("node:fs");fs.writeFileSync("artifacts/wave09/restore-evidence.json",JSON.stringify({scope:"disposable_logical_restore",source_sha:sha,backup_ms:Number(backupMs),restore_ms:Number(restoreMs),backup_bytes:Number(bytes),backup_sha256:hash,compared_tables:Number(tableCount),row_content_match:true,compared_sequences:Number(sequenceCount),sequence_state_match:true,schema_definition_match:true,schema_sha256:schemaHash,posted_journal_and_audit_match:true,production_rto_rpo_certified:false,privilege_restore_verified:false},null,2)+"\n")' "$backup_ms" "$restore_ms" "$backup_bytes" "$backup_hash" "$(git rev-parse HEAD)" "$(wc -l < "$tmp/before.tsv")" "$(wc -l < "$tmp/sequences-before.tsv")" "$schema_hash"
[[ "$(q -Atc "SELECT count(*) FROM rticore_erp_org_units WHERE id IN ('p0-rehearsal-a','p0-rehearsal-b')")" == 2 ]]
[[ "$(q -Atc "SELECT count(*) FROM pg_constraint WHERE conname LIKE 'p0\\_%\\_entity\\_fk' AND contype='f' AND convalidated")" == 16 ]]
[[ "$(q -Atc "SELECT to_regclass('public.rticore_iam_credentials') IS NOT NULL AND to_regclass('public.rticore_iam_sessions') IS NOT NULL")" == t ]]
q -f tests/cams-native-draft-acceptance.sql
q -f tests/cams-independent-review-acceptance.sql
q -f tests/native-ai-budget-acceptance.sql
q -f tests/native-feature-governance-acceptance.sql
q -f tests/native-operations-queue-acceptance.sql
node --test tests/native-preflight-postgres.test.mjs
ai_concurrency restored
q -f tests/flexguard-product-terms-acceptance.sql
[[ "$(q -Atc "SELECT to_regprocedure('public.rticore_fg_psa_submit(text,text,text,text,text,text,text,text,jsonb,text,text)') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.rticore_fg_psa_consumption_evidence'::regclass AND c.contype='p' AND c.convalidated AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord)=ARRAY['tenant_id','timesheet_id'])")" == t ]]
echo 'PASS: disposable migration rejection, replay, CAMS acceptance and logical restore (not production certification)'
