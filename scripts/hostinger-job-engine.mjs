import {salesActivityAlerts} from './hostinger-sales-alerts.mjs';
import {randomUUID} from 'node:crypto';
// A transaction owns the job until its durable result is written. No external effects.
export async function processNextJob(pool,workerId,{enableSalesAlerts=false}={}){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout='15s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
  const claimed=await client.query("SELECT id,tenant_id,legal_entity_id,job_type,attempts,max_attempts FROM rticore_background_jobs WHERE status='queued' AND next_run_at<=to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED");
  if(!claimed.rowCount){await client.query('ROLLBACK');return false;}
  const job=claimed.rows[0];
  // Only an explicitly enabled, tenant-wide internal alert subset may run. Scoped jobs stay quarantined.
  if(enableSalesAlerts && job.job_type==='sales_activity_sla' && job.legal_entity_id===null){
   const evidence=await salesActivityAlerts(client,job.tenant_id);
   await client.query("INSERT INTO rticore_operations_events(id,tenant_id,area,entity_id,action,actor_email,snapshot_json) VALUES($1,$2,'system_operations',$3,'BG_JOB_ALERTS_GENERATED','worker@system.invalid',$4)",[randomUUID(),job.tenant_id,job.id,JSON.stringify(evidence)]);
   const done=await client.query("UPDATE rticore_background_jobs SET status='completed',attempts=attempts+1,locked_by=NULL,last_error=NULL,completed_at=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') WHERE id=$1 AND tenant_id=$2 AND status='queued'",[job.id,job.tenant_id]);
   if(done.rowCount!==1)throw Error('Job ownership changed');
   await client.query('COMMIT');return true;
  }
  // Uncertified handlers remain contained.
  const result=await client.query("UPDATE rticore_background_jobs SET status='dead_letter', attempts=attempts+1, locked_by=NULL, last_error='HANDLER_NOT_CERTIFIED' WHERE id=$1 AND tenant_id=$2 AND status='queued'",[job.id,job.tenant_id]);
  if(result.rowCount!==1)throw Error('Job ownership changed');
  await client.query('COMMIT');
  return true;
 }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}
 finally{client.release();}
}
