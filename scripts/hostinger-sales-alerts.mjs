// Native PostgreSQL subset of the existing sales cron; no external delivery.
export async function salesActivityAlerts(client,tenant){
 const result=await client.query(`INSERT INTO rticore_sales_activity_alerts(alert_key,tenant_id,task_id,recipient_email,alert_type,message)
 SELECT 'task:'||a.kind||':'||t.id||':'||t.revision,t.tenant_id,t.id,t.owner_email,a.kind,a.message||t.subject
 FROM rticore_sales_activity_tasks t
 JOIN rticore_members m ON lower(m.email)=lower(t.owner_email) AND m.active=1 AND m.role IN ('sales','admin')
 CROSS JOIN LATERAL (SELECT CASE WHEN t.due_at::timestamptz<=now() THEN 'overdue' ELSE 'reminder' END AS kind,
 CASE WHEN t.due_at::timestamptz<=now() THEN 'Follow-up terlambat: ' ELSE 'Pengingat: ' END AS message) a
 WHERE t.tenant_id=$1 AND t.status='planned' AND (t.due_at::timestamptz<=now() OR t.reminder_at::timestamptz<=now())
 ON CONFLICT(alert_key) DO NOTHING`,[tenant]);
 return {alerts_inserted:result.rowCount,scope:'task_reminder_overdue_only'};
}
