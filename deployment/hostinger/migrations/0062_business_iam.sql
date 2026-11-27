-- Operator-reviewed PostgreSQL migration. No runtime DDL.
BEGIN;
CREATE TABLE IF NOT EXISTS rticore_iam_credentials (
 email text PRIMARY KEY REFERENCES rticore_members(email) ON DELETE CASCADE,
 password_hash text, totp_cipher text NOT NULL,
 last_totp_step bigint NOT NULL DEFAULT -1,
 invite_hash text UNIQUE, invite_expires timestamptz,
 enrolled_at timestamptz,
 CHECK ((password_hash IS NULL AND enrolled_at IS NULL AND invite_hash IS NOT NULL AND invite_expires IS NOT NULL)
 OR (password_hash IS NOT NULL AND enrolled_at IS NOT NULL AND invite_hash IS NULL AND invite_expires IS NULL))
);
CREATE TABLE IF NOT EXISTS rticore_iam_sessions (
 token_hash text PRIMARY KEY, email text NOT NULL REFERENCES rticore_iam_credentials(email) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, last_seen timestamptz NOT NULL DEFAULT now(),
 CHECK (expires_at>created_at)
);
CREATE INDEX IF NOT EXISTS rticore_iam_sessions_email ON rticore_iam_sessions(email);
CREATE TABLE IF NOT EXISTS rticore_iam_rate (
 bucket text PRIMARY KEY, window_id bigint NOT NULL, attempts integer NOT NULL CHECK(attempts>0)
);
CREATE TABLE IF NOT EXISTS rticore_iam_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, email text NOT NULL,
 action text NOT NULL CHECK(action IN ('invite','enrolled','login','logout','revoke')), occurred_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
