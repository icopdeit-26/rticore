// Read-only release inventory. Separate migration directories are separate streams.
export function duplicateMigrationVersions(files, stream = '') {
  const versions = new Map();
  for (const file of files) {
    const m = /^(\d{4})_.+\.sql$/.exec(file);
    if (!m) continue;
    const group = versions.get(m[1]) || [];
    group.push(file);
    versions.set(m[1], group);
  }
  return [...versions.entries()].filter(([version, names]) => {
    if(names.length < 2) return false;
    // Existing baseline has two 0002 files: AI setup does not record a schema
    // version; BoQ alone records version 2. Never rename applied history.
    const legacyPair=['0002_ai_connections.sql','0002_rticore_boq_edit_seq.sql'];
    return !(stream==='migrations' && version==='0002' && names.length===2 && [...names].sort().every((name,i)=>name===legacyPair[i]));
  });
}
export function schemaInventory(schema, triggers, migrationSQL = '') {
  const tables = [...new Set([...(schema+'\n'+triggers+'\n'+migrationSQL).matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_][a-z0-9_]*)/gi)].map(m=>m[1]))];
  const rules = [...triggers.matchAll(/CREATE TRIGGER\s+(\w+)\s+[\s\S]*?\bON\s+(\w+)\s+FOR EACH ROW EXECUTE FUNCTION\s+(\w+)\(\)/gi)]
    .map(m=>({name:m[1],table:m[2],function:m[3]}));
  const triggerCount = [...triggers.matchAll(/CREATE TRIGGER\s+/gi)].length;
  if (!tables.length || !rules.length || rules.length !== triggerCount)
    throw new Error('Missing or unparseable schema inventory');
  return {tables,rules};
}
const triggerKey = r => JSON.stringify([r.table,r.name,r.function]);
const fkKey = r => JSON.stringify([r.table,r.columns,r.target,r.target_columns]);
export const vendorScopeFKs = [
  {table:'rticore_finance_vendor_bank_scopes',columns:['tenant_id','bank_account_id'],target:'rticore_finance_vendor_bank_accounts',target_columns:['tenant_id','id']},
  {table:'rticore_finance_vendor_bank_scopes',columns:['tenant_id','legal_entity_id'],target:'rticore_erp_org_units',target_columns:['tenant_id','id']},
  {table:'rticore_finance_vendor_bank_scopes',columns:['tenant_id','purchase_order_id'],target:'rticore_purchase_orders',target_columns:['tenant_id','id']},
];
export function checkSchemaInventory(expected, actual) {
  const tables = new Set(actual.tables);
  const rules = new Set(actual.triggers.filter(r=>['O','A'].includes(r.enabled)&&r.function_schema==='public').map(triggerKey));
  const fks = new Set(actual.foreignKeys.filter(r=>r.validated===true&&r.target_schema==='public').map(fkKey));
  return {
    missingTables:expected.tables.filter(t=>!tables.has(t)),
    missingTriggers:expected.rules.filter(r=>!rules.has(triggerKey(r))),
    missingVendorScopeFKs:vendorScopeFKs.filter(r=>!fks.has(fkKey(r))),
    unvalidatedForeignKeys:actual.foreignKeys.filter(r=>r.validated!==true).map(r=>({table:r.table,name:r.name})),
  };
}

// The native ledger is authoritative. Do not install the incompatible legacy
// FlexGuard 0054 tables under the same names in the PostgreSQL schema.
export function nativeLedgerCollisions(canonicalSql, nativeSql) {
  const names=s=>new Set([...s.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi)].map(m=>m[1].toLowerCase()));
  const legacy=names(canonicalSql), native=names(nativeSql);
  return ['rticore_flexguard_credit_lots','rticore_flexguard_enterprise_ledger'].filter(name=>legacy.has(name)&&native.has(name));
}
