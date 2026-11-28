// Normalize only exact equivalent CHECK representations observed on PostgreSQL 16 dump/restore.
// Do not remove arbitrary parentheses, constraints, definitions, or literals.
export function normalizeRestoreSchema(input){
 const pairs=[
 ['rticore_flexguard_enterprise_ledger_credit_amount_check',"((((credit_amount >= '-100000'::integer) AND (credit_amount <= 100000)) AND (credit_amount <> 0)))","(((credit_amount >= '-100000'::integer) AND (credit_amount <= 100000) AND (credit_amount <> 0)))"],
 ['rticore_flexguard_requests_credit_amount_check',"((((credit_amount >= '-100000'::integer) AND (credit_amount <= 100000)) AND (credit_amount <> 0)))","(((credit_amount >= '-100000'::integer) AND (credit_amount <= 100000) AND (credit_amount <> 0)))"],
 ['rticore_project_timesheets_minutes_check',"((((minutes >= 15) AND (minutes <= 480)) AND ((minutes % (15)::bigint) = 0)))","(((minutes >= 15) AND (minutes <= 480) AND ((minutes % (15)::bigint) = 0)))"]
 ];
 return input.split('\n').filter(l=>!/^\\(?:un)?restrict [^\s]+$/.test(l)).map(line=>{
  for(const [name,before,after] of pairs){
   if(line.trim()==='CONSTRAINT '+name+' CHECK '+before+',')return line.replace(before,after);
   if(line.trim()==='CONSTRAINT '+name+' CHECK '+before)return line.replace(before,after);
  }
  return line;
 }).join('\n');
}
if(process.argv[1]&&process.argv[1].endsWith('/normalize-restore-schema.mjs')){
 const {readFileSync}=await import('node:fs');
 process.stdout.write(normalizeRestoreSchema(readFileSync(0,'utf8')));
}
