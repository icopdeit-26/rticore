#!/usr/bin/env bash
# Disposable CI only. Never run against staging or production.
set -euo pipefail
[[ "${CI:-}" == true && "${PGHOST:-}" == 127.0.0.1 && "${PGPORT:-}" == 5432 && "${PGUSER:-}" == cams_ci && "${PGDATABASE:-}" == cams_docking_ci && -z "${PGSERVICE:-}" && -z "${PGHOSTADDR:-}" ]]
q() { psql -X -v ON_ERROR_STOP=1 "$@"; }
[[ "$(q -Atc 'SELECT current_database()')" == cams_docking_ci ]]
dir=deployment/hostinger/migrations
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
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
q -f rticore_postgresql_triggers.sql
# Apply all approved native streams, and replay to detect unsafe DDL changes.
for pass in 1 2; do
  for f in 0053_finance_vendor_bank_entity_scope 0054_finance_entity_constraints 0057_flexguard_native_enterprise 0058_flexguard_finance_receiver 0059_flexguard_wallet_onboarding 0060_flexguard_allocation_and_journal_controls 0061_flexguard_maintenance_queue 0062_business_iam 0063_flexguard_product_terms 0064_flexguard_product_commands 0065_flexguard_contract_binding 0066_flexguard_psa_bridge; do
    q -f "$dir/$f.sql"
  done
  q -f sql/native-postgres/0053_cams_finance_inbox.sql
  q -f sql/native-postgres/0054_cams_draft.sql
done
q -f tests/cams-native-draft-acceptance.sql
q -f tests/flexguard-product-terms-acceptance.sql
# Use a separate local database for a real logical backup/restore rehearsal.
pg_dump --format=custom --file="$tmp/rticore.dump"
createdb cams_docking_restore_ci
pg_restore --exit-on-error --no-owner --no-privileges --dbname=cams_docking_restore_ci "$tmp/rticore.dump"
export PGDATABASE=cams_docking_restore_ci
[[ "$(q -Atc "SELECT count(*) FROM rticore_erp_org_units WHERE id IN ('p0-rehearsal-a','p0-rehearsal-b')")" == 2 ]]
[[ "$(q -Atc "SELECT count(*) FROM pg_constraint WHERE conname LIKE 'p0\\_%\\_entity\\_fk' AND contype='f' AND convalidated")" == 16 ]]
[[ "$(q -Atc "SELECT to_regclass('public.rticore_iam_credentials') IS NOT NULL AND to_regclass('public.rticore_iam_sessions') IS NOT NULL")" == t ]]
q -f tests/cams-native-draft-acceptance.sql
q -f tests/flexguard-product-terms-acceptance.sql
echo 'PASS: disposable migration rejection, replay, CAMS acceptance and logical restore (not production certification)'
