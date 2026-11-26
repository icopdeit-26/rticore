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
 const lead=await client.query(`INSERT INTO rticore_sales_activity_alerts(alert_key,tenant_id,lead_id,recipient_email,alert_type,message)
 SELECT 'lead:sla:'||s.lead_id||':'||s.response_due_at,s.tenant_id,s.lead_id,s.owner_email,'lead_sla','SLA respons awal Lead terlewati: '||l.account_name
 FROM rticore_sales_lead_sla s JOIN rticore_marketing_leads l ON l.id=s.lead_id AND l.tenant_id=s.tenant_id
 JOIN rticore_members m ON lower(m.email)=lower(s.owner_email) AND m.active=1 AND m.role IN ('sales','admin')
 WHERE s.tenant_id=$1 AND s.first_response_at IS NULL AND l.status NOT IN ('converted','disqualified')
 AND s.response_due_at::timestamptz<=now() ON CONFLICT(alert_key) DO NOTHING`,[tenant]);
 const escalation=await client.query(`INSERT INTO rticore_sales_activity_alerts(alert_key,tenant_id,task_id,recipient_email,alert_type,message)
 SELECT 'task:manager:'||t.id||':'||t.revision,t.tenant_id,t.id,m.manager_email,'manager_escalation','Eskalasi follow-up Sales: '||t.subject
 FROM rticore_sales_activity_tasks t JOIN rticore_sales_team_managers m ON m.tenant_id=t.tenant_id AND m.sales_email=t.owner_email
 JOIN rticore_members x ON x.email=m.manager_email AND x.active=1 AND x.role='admin'
 LEFT JOIN rticore_sales_activity_policy p ON p.tenant_id=t.tenant_id
 WHERE t.tenant_id=$1 AND t.status='planned' AND t.due_at::timestamptz+coalesce(p.escalation_minutes,60)*interval '1 minute'<=now()
 ON CONFLICT(alert_key) DO NOTHING`,[tenant]);
 const leadEscalation=await client.query(`INSERT INTO rticore_sales_activity_alerts(alert_key,tenant_id,lead_id,recipient_email,alert_type,message)
 SELECT 'lead:manager:'||s.lead_id||':'||s.response_due_at,s.tenant_id,s.lead_id,m.manager_email,'manager_escalation','Eskalasi SLA Lead: '||l.account_name
 FROM rticore_sales_lead_sla s JOIN rticore_marketing_leads l ON l.id=s.lead_id AND l.tenant_id=s.tenant_id
 JOIN rticore_sales_team_managers m ON m.tenant_id=s.tenant_id AND m.sales_email=s.owner_email
 JOIN rticore_members x ON x.email=m.manager_email AND x.active=1 AND x.role='admin'
 LEFT JOIN rticore_sales_activity_policy p ON p.tenant_id=s.tenant_id
 WHERE s.tenant_id=$1 AND s.first_response_at IS NULL AND l.status NOT IN ('converted','disqualified')
 AND s.response_due_at::timestamptz+coalesce(p.escalation_minutes,60)*interval '1 minute'<=now()
 ON CONFLICT(alert_key) DO NOTHING`,[tenant]);
 return {alerts_inserted:result.rowCount+lead.rowCount+escalation.rowCount+leadEscalation.rowCount,scope:'task_lead_and_mapped_manager_alerts'};
}
