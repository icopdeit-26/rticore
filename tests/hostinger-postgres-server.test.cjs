const test=require('node:test'),assert=require('node:assert/strict');
const {Pool}=require('pg'),fs=require('node:fs'),ts=require('typescript');
const config={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true};
function load(file){
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:config}).outputText;
 const m={exports:{}};
 new Function('require','module','exports',code)(p=>p==='./hostinger-config'?load('src/lib/hostinger-config.ts'):require(p),m,m.exports);
 return m.exports;
}
const {runPostgresBatch}=load('src/lib/postgres-db.ts');
test('real PostgreSQL: schema, triggers, transaction atomicity and independent concurrent batches',async()=>{
 const connectionString=process.env.RTICORE_TEST_PG_URL;
 assert.ok(connectionString,'isolated CI PostgreSQL URL required');
 const url=new URL(connectionString);
 assert.equal(url.hostname,'127.0.0.1');
 assert.equal(url.pathname,'/rticore_ci');
 const pool=new Pool({connectionString,max:5});
 try{
  // This URL is restricted to an ephemeral CI service. No production credentials or data.
  await pool.query(fs.readFileSync('rticore_postgresql_schema.sql','utf8'));
  await pool.query(fs.readFileSync('rticore_postgresql_triggers.sql','utf8'));
  const counts=await pool.query("SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled IN ('O','A')");
  assert.ok(counts.rows[0].n>=267,'canonical business triggers must exist');
  const {scanJournalIntegrity,scanTimesheetSources}=await import('../scripts/finance-historical-reconciliation.mjs');
  const snapshot=await pool.connect();
  try {
   await snapshot.query('BEGIN READ ONLY');
   const result=await scanJournalIntegrity(snapshot);
   assert.deepEqual(Object.keys(result).sort(),['duplicate_event_keys','invalid_account_scope','invalid_journal_links','processed_without_journal_review','unbalanced_posted_journals']);
   assert.ok(Object.values(result).every(v=>v==='0'));
   assert.deepEqual(await scanTimesheetSources(snapshot),{total:'0',missing_source:'0',invalid_project_scope:'0',source_mismatch:'0',processed_cost_ledger_review:'0'});
   await snapshot.query('ROLLBACK');
  }finally{snapshot.release();}
  await pool.query("INSERT INTO rticore_erp_org_units(id,tenant_id,code,label,kind,created_by) VALUES('ci-fin-entity','ci-fin','CI-FIN','CI Finance','legal_entity','ci@example.invalid')");
  const missingPayload=JSON.stringify({timesheet_id:'missing-ts',project_id:'missing-project',minutes:60,cost_snapshot_cents:1000,approved_by:'ci@example.invalid'});
  const missingDigest=require('node:crypto').createHash('sha256').update(missingPayload).digest('hex');
  await pool.query("INSERT INTO rticore_finance_integration_events(id,tenant_id,legal_entity_id,direction,event_type,source_system,source_document_id,correlation_id,idempotency_key,payload_json,payload_sha256,status,event_timestamp) VALUES('ci-missing-ts','ci-fin','ci-fin-entity','outbox','timesheet.approved','RTICORE','missing-ts','ci-correlation','ci-missing-ts-key',$1,$2,'validated','2026-01-01T00:00:00Z')",[missingPayload,missingDigest]);
  assert.deepEqual(await scanTimesheetSources(pool),{total:'1',missing_source:'1',invalid_project_scope:'0',source_mismatch:'0',processed_cost_ledger_review:'0'});
  const {processNextJob}=await import('../scripts/hostinger-job-engine.mjs');
  await pool.query("INSERT INTO rticore_background_jobs(id,tenant_id,job_type,idempotency_key,created_by) VALUES('ci-job','ci-tenant','report_generation','ci-job-key','ci@example.invalid')");
  const claims=await Promise.all([processNextJob(pool,'ci-a'),processNextJob(pool,'ci-b')]);
  assert.deepEqual(claims.sort(),[false,true]);
  assert.deepEqual((await pool.query("SELECT status,attempts,last_error FROM rticore_background_jobs WHERE id='ci-job'")).rows,[{status:'dead_letter',attempts:'1',last_error:'HANDLER_NOT_CERTIFIED'}]);
  await pool.query("INSERT INTO rticore_background_jobs(id,tenant_id,job_type,idempotency_key,created_by) VALUES('ci-alert-job','ci-tenant','sales_activity_sla','ci-alert-key','ci@example.invalid')");
  assert.equal(await processNextJob(pool,'ci-alert-worker',{enableSalesAlerts:true}),true);
  assert.deepEqual((await pool.query("SELECT status,attempts FROM rticore_background_jobs WHERE id='ci-alert-job'")).rows,[{status:'completed',attempts:'1'}]);
  const evidence=(await pool.query("SELECT snapshot_json FROM rticore_operations_events WHERE entity_id='ci-alert-job' AND action='BG_JOB_ALERTS_GENERATED'")).rows;
  assert.equal(evidence.length,1);
  assert.deepEqual(JSON.parse(evidence[0].snapshot_json),{alerts_inserted:0,scope:'task_lead_mapped_manager_and_nurture_alerts'});
  // Populated fixtures: tenant-scoped task, lead and mapped manager alerts.
  await pool.query("INSERT INTO rticore_members(email,role) VALUES('ci-sales@example.invalid','sales'),('ci-manager@example.invalid','admin')");
  await pool.query("INSERT INTO rticore_marketing_leads(id,tenant_id,lead_number,account_name,source,service_family,assigned_sales_email,created_by,updated_by) VALUES('ci-lead','ci-tenant','CI-L1','CI customer','test','VAPT','ci-sales@example.invalid','ci-sales@example.invalid','ci-sales@example.invalid'),('ci-other-lead','ci-other','CI-L2','Other customer','test','VAPT','ci-sales@example.invalid','ci-sales@example.invalid','ci-sales@example.invalid')");
  await pool.query("UPDATE rticore_sales_lead_sla SET response_due_at='2020-01-01T00:00:00Z' WHERE tenant_id IN ('ci-tenant','ci-other')");
  await pool.query("INSERT INTO rticore_sales_team_managers(tenant_id,sales_email,manager_email,assigned_by) VALUES('ci-tenant','ci-sales@example.invalid','ci-manager@example.invalid','ci-manager@example.invalid')");
  await pool.query("INSERT INTO rticore_sales_activity_tasks(id,tenant_id,lead_id,owner_email,kind,subject,start_at,due_at,reminder_at,created_by) VALUES('ci-task','ci-tenant','ci-lead','ci-sales@example.invalid','call','CI follow-up','2020-01-01T00:00:00Z','2020-01-01T01:00:00Z','2020-01-01T00:00:00Z','ci-sales@example.invalid')");
  await pool.query("INSERT INTO rticore_lead_nurture_plans(lead_id,tenant_id,state,cadence_days,channel,next_touch_at,created_by,updated_by) VALUES('ci-lead','ci-tenant','active',14,'follow_up','2020-01-01','ci-sales@example.invalid','ci-sales@example.invalid'),('ci-other-lead','ci-other','active',14,'follow_up','2020-01-01','ci-sales@example.invalid','ci-sales@example.invalid')");
  for(const id of ['ci-alert-populated','ci-alert-repeat']){
   await pool.query("INSERT INTO rticore_background_jobs(id,tenant_id,job_type,idempotency_key,created_by) VALUES($1,'ci-tenant','sales_activity_sla',$1,'ci@example.invalid')",[id]);
   assert.equal(await processNextJob(pool,'ci-alert-worker',{enableSalesAlerts:true}),true);
  }
  assert.deepEqual((await pool.query("SELECT alert_type,count(*)::int n FROM rticore_sales_activity_alerts WHERE tenant_id='ci-tenant' GROUP BY alert_type ORDER BY alert_type")).rows,[{alert_type:'lead_sla',n:1},{alert_type:'manager_escalation',n:2},{alert_type:'overdue',n:1},{alert_type:'reminder',n:1}]);
  assert.equal((await pool.query("SELECT count(*)::int n FROM rticore_sales_activity_alerts WHERE tenant_id='ci-other'")).rows[0].n,0);
  const repeated=(await pool.query("SELECT snapshot_json FROM rticore_operations_events WHERE entity_id='ci-alert-repeat'")).rows[0];
  assert.equal(JSON.parse(repeated.snapshot_json).alerts_inserted,0);
  await pool.query("UPDATE rticore_lead_nurture_plans SET version=2 WHERE lead_id='ci-lead'");
  await pool.query("INSERT INTO rticore_sales_activity_alerts(alert_key,tenant_id,lead_id,recipient_email,alert_type,message) VALUES('nurture:ci-lead:2','ci-tenant','ci-lead','ci-sales@example.invalid','reminder','Legacy reminder')");
  await pool.query("INSERT INTO rticore_background_jobs(id,tenant_id,job_type,idempotency_key,created_by) VALUES('ci-alert-legacy','ci-tenant','sales_activity_sla','ci-alert-legacy','ci@example.invalid')");
  assert.equal(await processNextJob(pool,'ci-alert-worker',{enableSalesAlerts:true}),true);
  assert.equal((await pool.query("SELECT count(*)::int n FROM rticore_sales_activity_alerts WHERE alert_key LIKE 'lead:nurture:ci-lead:2:%'")).rows[0].n,0);
  // Inject a transient failure after earlier alert statements; verify savepoint rollback and bounded retry.
  await pool.query("UPDATE rticore_sales_activity_tasks SET revision=revision+1 WHERE id='ci-task'");
  await pool.query("CREATE FUNCTION ci_fail_alert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.alert_type='manager_escalation' THEN RAISE EXCEPTION 'synthetic transient failure' USING ERRCODE='55P03'; END IF; RETURN NEW; END $$");
  await pool.query("CREATE TRIGGER ci_fail_alert BEFORE INSERT ON rticore_sales_activity_alerts FOR EACH ROW EXECUTE FUNCTION ci_fail_alert()");
  await pool.query("INSERT INTO rticore_background_jobs(id,tenant_id,job_type,idempotency_key,created_by,max_attempts) VALUES('ci-retry','ci-tenant','sales_activity_sla','ci-retry-key','ci@example.invalid',2)");
  assert.equal(await processNextJob(pool,'ci-alert-worker',{enableSalesAlerts:true}),true);
  assert.deepEqual((await pool.query("SELECT status,attempts,last_error FROM rticore_background_jobs WHERE id='ci-retry'")).rows,[{status:'queued',attempts:'1',last_error:'TRANSIENT_HANDLER_FAILURE'}]);
  assert.equal((await pool.query("SELECT count(*)::int n FROM rticore_sales_activity_alerts WHERE alert_key='task:overdue:ci-task:2'")).rows[0].n,0);
  assert.equal(await processNextJob(pool,'ci-alert-worker',{enableSalesAlerts:true}),false);
  await pool.query("UPDATE rticore_background_jobs SET next_run_at='2020-01-01 00:00:00' WHERE id='ci-retry'");
  assert.equal(await processNextJob(pool,'ci-alert-worker',{enableSalesAlerts:true}),true);
  assert.deepEqual((await pool.query("SELECT status,attempts,last_error FROM rticore_background_jobs WHERE id='ci-retry'")).rows,[{status:'dead_letter',attempts:'2',last_error:'HANDLER_FAILED'}]);
  await pool.query("DROP TRIGGER ci_fail_alert ON rticore_sales_activity_alerts");
  await pool.query("DROP FUNCTION ci_fail_alert()");
  const {scanWorkerQueue}=await import('../scripts/hostinger-worker-telemetry.mjs');
  await pool.query("INSERT INTO rticore_background_jobs(id,tenant_id,job_type,idempotency_key,created_by,status,attempts,max_attempts) VALUES('ci-legacy-running','ci-tenant','finance_outbox_dispatch','ci-legacy-running','ci@example.invalid','running',1,2),('ci-exhausted','ci-tenant','report_generation','ci-exhausted','ci@example.invalid','queued',2,2)");
  const queueBefore=await scanWorkerQueue(pool);
  assert.equal(queueBefore.legacy_running_requires_review,'1');
  assert.equal(queueBefore.due_queued,'1');
  assert.equal(await processNextJob(pool,'ci-containment'),true);
  assert.deepEqual((await pool.query("SELECT status,attempts FROM rticore_background_jobs WHERE id='ci-exhausted'")).rows,[{status:'dead_letter',attempts:'2'}]);
  assert.equal((await pool.query("SELECT status FROM rticore_background_jobs WHERE id='ci-legacy-running'")).rows[0].status,'running');
  assert.equal((await scanWorkerQueue(pool)).due_queued,'0');
  await pool.query('CREATE TABLE hostinger_batch_probe (id text PRIMARY KEY, amount bigint NOT NULL CHECK(amount>0))');
  const insert=(id,amount)=>({sql:'INSERT INTO hostinger_batch_probe(id,amount) VALUES($1,$2)',args:[id,amount]});
  await assert.rejects(runPostgresBatch(pool,[insert('rollback-a',10),insert('rollback-b',-1)]));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM hostinger_batch_probe")).rows[0].n,0);
  const out=await Promise.allSettled([
   runPostgresBatch(pool,[insert('good-a',100),insert('good-b',200)]),
   runPostgresBatch(pool,[insert('bad-a',300),insert('bad-b',0)])
  ]);
  assert.equal(out[0].status,'fulfilled');assert.equal(out[1].status,'rejected');
  assert.deepEqual((await pool.query('SELECT id,amount FROM hostinger_batch_probe ORDER BY id')).rows,[{id:'good-a',amount:'100'},{id:'good-b',amount:'200'}]);
 }finally{await pool.end();}
});
