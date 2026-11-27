// Read-only queue telemetry, never replays old jobs or emits payloads.
export async function scanWorkerQueue(client){
 const {rows}=await client.query("SELECT status, count(*)::text AS count FROM public.rticore_background_jobs GROUP BY status ORDER BY status");
 const {rows:age}=await client.query("SELECT count(*)::text AS overdue FROM public.rticore_background_jobs WHERE status='queued' AND next_run_at<=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')");
 return {counts:Object.fromEntries(rows.map(r=>[r.status,r.count])),due_queued:age[0].overdue,legacy_running_requires_review:rows.find(r=>r.status==='running')?.count||'0'};
}
