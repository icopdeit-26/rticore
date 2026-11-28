// Run from a restricted Hostinger cron/service account; never an automatic approval/posting job.
import pg from 'pg';
import {randomUUID} from 'node:crypto';
const {Client}=pg;
const env=process.env;
if(env.RTICORE_FG_MAINTENANCE_ENABLED!=='1'||!env.RTICORE_FG_MAINTENANCE_DATABASE_URL||!env.RTICORE_FG_MAINTENANCE_EXPECTED_DATABASE||!env.RTICORE_FG_MAINTENANCE_TENANT||!env.RTICORE_FG_MAINTENANCE_ENTITY||!env.RTICORE_FG_MAINTENANCE_ACTOR||env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error('Explicit FlexGuard maintenance configuration required');
const u=new URL(env.RTICORE_FG_MAINTENANCE_DATABASE_URL);
if(!['postgres:','postgresql:'].includes(u.protocol)||u.searchParams.getAll('sslmode').length!==1||u.searchParams.get('sslmode')!=='verify-full'||[...u.searchParams.keys()].some(k=>k!=='sslmode')||decodeURIComponent(u.pathname.slice(1))!==env.RTICORE_FG_MAINTENANCE_EXPECTED_DATABASE)throw Error('Database scope or TLS invalid');
u.search='';
const db=new Client({connectionString:u.toString(),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000,statement_timeout:30000});
try {
 await db.connect();
 const identity=(await db.query('SELECT current_database() AS db,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
 if(!identity||identity.db!==env.RTICORE_FG_MAINTENANCE_EXPECTED_DATABASE||identity.rolsuper||identity.rolcreatedb||identity.rolcreaterole||identity.rolbypassrls)throw Error('Unexpected or privileged maintenance role');
 const args=[env.RTICORE_FG_MAINTENANCE_TENANT,env.RTICORE_FG_MAINTENANCE_ENTITY,env.RTICORE_FG_MAINTENANCE_ACTOR];
 if(env.RTICORE_NATIVE_JOB_QUEUE_ENABLED!=='1')throw Error('Explicit native job queue enablement required');
 const auth=(await db.query('SELECT rticore_fg_maintenance_actor($1,$2,$3) AS allowed',args)).rows[0];
 if(auth?.allowed!==true)throw Error('Maintenance authorization denied');
 // Five minute idempotency window; repeated cron invocations do not duplicate work.
 const bucket=Math.floor(Date.now()/300000);
 for(const kind of ['flexguard_retry','flexguard_expiry']){
  await db.query("INSERT INTO rticore_native_jobs(id,tenant_id,legal_entity_id,kind,idempotency_key,requested_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,legal_entity_id,kind,idempotency_key) DO NOTHING",[randomUUID(),args[0],args[1],kind,'scheduled-'+kind+'-'+bucket,args[2]]);
 }
 const outcomes=[];
 for(let i=0;i<2;i++){
  const token=randomUUID();
  const job=(await db.query('SELECT * FROM rticore_native_job_claim($1,$2,$3,$4)',[...args,token])).rows[0];
  if(!job)break;
  try{
   await db.query('BEGIN');
   // Lock the claimed row during side effects; a stale worker must not execute.
   const owned=(await db.query("SELECT id FROM rticore_native_jobs WHERE tenant_id=$1 AND legal_entity_id=$2 AND id=$3 AND lease_token=$4 AND status='running' AND lease_until>clock_timestamp() FOR UPDATE",[args[0],args[1],job.job_id,token])).rows[0];
   if(!owned)throw Error('Lease lost');
   if(job.job_kind==='flexguard_retry')await db.query('SELECT * FROM rticore_fg_retry_due($1,$2,$3,$4,25)',[...args,env.RTICORE_FG_MAINTENANCE_PERIOD||null]);
   else if(job.job_kind==='flexguard_expiry')await db.query('SELECT * FROM rticore_fg_expiry_due($1,$2,$3,25)',args);
   else throw Error('Unsupported job kind');
   const done=(await db.query('SELECT rticore_native_job_finish($1,$2,$3,$4,$5,true) AS ok',[...args,job.job_id,token])).rows[0];
   if(done?.ok!==true)throw Error('Job finish rejected');
   await db.query('COMMIT');outcomes.push('succeeded');
  }catch{
   await db.query('ROLLBACK');
   const failed=(await db.query('SELECT rticore_native_job_finish($1,$2,$3,$4,$5,false) AS ok',[...args,job.job_id,token])).rows[0];
   outcomes.push(failed?.ok===true?'retry_or_dead_letter':'lease_lost');
  }
 }
 console.log(JSON.stringify({outcomes,automatic_approval:false,automatic_posting:false}));
}finally{await db.end()}
