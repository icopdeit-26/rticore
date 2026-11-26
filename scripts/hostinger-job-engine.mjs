// A transaction owns the job until its durable result is written. No external effects.
export async function processNextJob(pool,workerId){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout='15s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
  const claimed=await client.query("SELECT id,tenant_id,job_type,attempts,max_attempts FROM rticore_background_jobs WHERE status='queued' AND next_run_at<=to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED");
  if(!claimed.rowCount){await client.query('ROLLBACK');return false;}
  const job=claimed.rows[0];
  // No certified mutating handler yet: contain, never mark successful or replay.
  const result=await client.query("UPDATE rticore_background_jobs SET status='dead_letter', attempts=attempts+1, locked_by=NULL, last_error='HANDLER_NOT_CERTIFIED' WHERE id=$1 AND tenant_id=$2 AND status='queued'",[job.id,job.tenant_id]);
  if(result.rowCount!==1)throw Error('Job ownership changed');
  await client.query('COMMIT');
  return true;
 }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}
 finally{client.release();}
}
