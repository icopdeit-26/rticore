// Read-only privilege certification. Runtime must not own or administer application schema.
export async function assertRuntimeLeastPrivilege(client){
 const {rows}=await client.query(`SELECT
 EXISTS(SELECT 1 FROM pg_roles r WHERE pg_has_role(current_user,r.oid,'MEMBER') AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication)) AS privileged_role,
 has_schema_privilege(current_user,'public','CREATE') AS schema_create,
 EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname='public' AND pg_has_role(current_user,n.nspowner,'MEMBER')) AS schema_owner,
 EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (left(c.relname,8)='rticore_' OR left(c.relname,5)='cams_') AND pg_has_role(current_user,c.relowner,'MEMBER')) AS object_owner,
 EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND (left(c.relname,8)='rticore_' OR left(c.relname,5)='cams_') AND has_table_privilege(current_user,c.oid,'TRUNCATE')) AS truncate_grant,
 EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (left(p.proname,8)='rticore_' OR left(p.proname,5)='cams_') AND pg_has_role(current_user,p.proowner,'MEMBER')) AS function_owner,
 EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN ('pg_read_all_data','pg_write_all_data','pg_read_server_files','pg_write_server_files','pg_execute_server_program','pg_signal_backend','pg_checkpoint','pg_maintain','pg_create_subscription') AND pg_has_role(current_user,r.oid,'MEMBER')) AS broad_builtin_role,
 EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND (left(c.relname,8)='rticore_' OR left(c.relname,5)='cams_') AND (has_table_privilege(current_user,c.oid,'SELECT WITH GRANT OPTION') OR has_table_privilege(current_user,c.oid,'INSERT WITH GRANT OPTION') OR has_table_privilege(current_user,c.oid,'UPDATE WITH GRANT OPTION') OR has_table_privilege(current_user,c.oid,'DELETE WITH GRANT OPTION') OR has_table_privilege(current_user,c.oid,'REFERENCES WITH GRANT OPTION') OR has_table_privilege(current_user,c.oid,'TRIGGER'))) AS excessive_table_grant`);
 const keys=['privileged_role','schema_create','schema_owner','object_owner','truncate_grant','function_owner','broad_builtin_role','excessive_table_grant'];
 if(rows.length!==1||!keys.every(k=>rows[0][k]===false))throw new Error('Runtime database privilege certification failed');
 return true;
}

// A cron must target its explicitly approved database and authenticated login.
// This check performs SELECT only and must precede advisory locks or mutations.
export async function assertCronDatabaseIdentity(client,expectedDatabase,expectedRole){
 if(typeof expectedDatabase!=='string'||!expectedDatabase.trim()||typeof expectedRole!=='string'||!expectedRole.trim())throw Error('Explicit cron database identity required');
 const {rows}=await client.query('SELECT current_database() AS db, current_user AS role, session_user AS login_role');
 if(rows.length!==1||rows[0].db!==expectedDatabase||rows[0].role!==expectedRole||rows[0].login_role!==expectedRole)throw Error('Cron database identity mismatch');
 await assertRuntimeLeastPrivilege(client);
 return true;
}
