// Run from a restricted Hostinger cron/service account; never an automatic approval/posting job.
import pg from 'pg';
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
 const retry=await db.query('SELECT outcome,count(*)::int AS count FROM rticore_fg_retry_due($1,$2,$3,$4,25) GROUP BY outcome',[...args,env.RTICORE_FG_MAINTENANCE_PERIOD||null]);
 const expiry=await db.query('SELECT count(*)::int AS count FROM rticore_fg_expiry_due($1,$2,$3,25)',args);
 console.log(JSON.stringify({retry:retry.rows,expiry_requests:expiry.rows[0].count,automatic_approval:false,automatic_posting:false}));
}finally{await db.end()}
