-- Apply explicitly on native PostgreSQL, after RTICore GL migrations.
BEGIN;
CREATE TABLE IF NOT EXISTS rticore_cams_finance_inbox (
 id text PRIMARY KEY, source_tenant_id text NOT NULL, source_journal_id text NOT NULL,
 idempotency_key text NOT NULL UNIQUE, payload_hash text NOT NULL,
 legal_entity_id text NOT NULL, period_code text NOT NULL,
 payload_json jsonb NOT NULL, mapped_lines_json jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_tenant_id, source_journal_id)
);
COMMIT;
