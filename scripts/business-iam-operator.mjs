// Internal SQL shared by the interactive operator CLI and disposable PostgreSQL tests.
// The CLI remains responsible for trusted terminal, approval, environment and email validation.
export function revokeBusinessCredential(client,email){
 return client.query("WITH removed AS (DELETE FROM rticore_iam_credentials WHERE email=$1 RETURNING email) INSERT INTO rticore_iam_audit(email,action) SELECT email,'revoke' FROM removed RETURNING email",[email]);
}
export function issueBusinessInvitation(client,email,cipher,digest){
 return client.query("WITH changed AS (INSERT INTO rticore_iam_credentials(email,totp_cipher,invite_hash,invite_expires) SELECT email,$2,$3,now()+interval '30 minutes' FROM rticore_members WHERE email=$1 AND active=1 ON CONFLICT(email) DO UPDATE SET totp_cipher=excluded.totp_cipher,invite_hash=excluded.invite_hash,invite_expires=excluded.invite_expires WHERE rticore_iam_credentials.enrolled_at IS NULL RETURNING email) INSERT INTO rticore_iam_audit(email,action) SELECT email,'invite' FROM changed RETURNING email",[email,cipher,digest]);
}
