BEGIN;
CREATE TABLE IF NOT EXISTS rticore_native_credentials (
 email text PRIMARY KEY REFERENCES rticore_members(email),
 password_hash text NOT NULL,
 updated_at bigint NOT NULL,
 failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts>=0),
 locked_until bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rticore_native_challenges (
 id_hash text PRIMARY KEY,
 email text NOT NULL REFERENCES rticore_members(email),
 otp_hash text NOT NULL,
 expires_at bigint NOT NULL,
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
 consumed_at bigint
);
CREATE INDEX IF NOT EXISTS native_challenge_email_idx ON rticore_native_challenges(email,expires_at);
CREATE TABLE IF NOT EXISTS rticore_native_sessions (
 token_hash text PRIMARY KEY,
 email text NOT NULL REFERENCES rticore_members(email),
 created_at bigint NOT NULL,
 last_seen bigint NOT NULL,
 expires_at bigint NOT NULL,
 mfa_verified integer NOT NULL CHECK (mfa_verified=1),
 revoked_at bigint
);
CREATE INDEX IF NOT EXISTS native_session_email_idx ON rticore_native_sessions(email,expires_at);
CREATE TABLE IF NOT EXISTS rticore_native_auth_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 email text,
 event_type text NOT NULL,
 occurred_at bigint NOT NULL
);
COMMIT;
