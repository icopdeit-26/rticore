import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
export function auditCatalogs(catalogs){
 const ids=new Set(),duplicates=[];
 for(const catalog of catalogs){
  if(!Array.isArray(catalog.cases))throw Error('Invalid catalog');
  for(const c of catalog.cases){
   if(typeof c.id!=='string'||!c.id.trim())throw Error('Missing UAT ID');
   if(ids.has(c.id))duplicates.push(c.id);ids.add(c.id);
  }
 }
 return {defined_unique:ids.size,duplicate_ids:duplicates,erp_catalog_target:420,remaining_erp_definitions:Math.max(0,420-ids.size),finance_target:520,certified_executions:null};
}
export function inventory(root=process.cwd()){
 const files=walk(path.join(root,'src/app')).map(p=>path.relative(root,p).split(path.sep).join('/'));
 const pages=files.filter(p=>p.endsWith('/page.tsx'));
 const apis=files.filter(p=>p.startsWith('src/app/api/')&&p.endsWith('/route.ts'));
 const catalogPaths=['docs/RTICORE_UAT_210_CATALOG.json','docs/RTICORE_ERP_UAT_210_CATALOG.json'];
 const uat=auditCatalogs(catalogPaths.map(p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))));
 return {scope:'source_inventory_only',pages:pages.sort(),apis:apis.sort(),catalogs:catalogPaths,uat,finance_grouped_suite_present:fs.existsSync(path.join(root,'tests/rti-finance-uat-520.test.cjs')),feature_activation_certified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=inventory();console.log(JSON.stringify(result,null,2));if(result.uat.duplicate_ids.length||result.uat.defined_unique!==420||!result.finance_grouped_suite_present||!result.pages.length||!result.apis.length)process.exitCode=1;
}
