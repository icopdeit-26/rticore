const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {camsDatabaseMode,camsInboxScope,camsReviewAllowed}=require('../src/lib/cams-runtime-boundary.ts');
const host={NODE_ENV:'production',RTICORE_RUNTIME:'hostinger',RTICORE_LOCAL_MODE:'0',RTICORE_DB_ENGINE:'postgres',DATABASE_URL:'fixture',CAMS_FINANCE_DOCKING_ENABLED:'true',CAMS_FINANCE_SOURCE_TENANT_ID:'source',CAMS_FINANCE_LEGAL_ENTITY_ID:'entity'};
test('native Hostinger and local runtime are separate, fail closed on inconsistent configuration',()=>{
 assert.equal(camsDatabaseMode(host),'hostinger');
 for(const patch of [{RTICORE_LOCAL_MODE:'1'},{RTICORE_DB_ENGINE:'sqlite'},{RTICORE_DB_ENGINE:undefined},{DATABASE_URL:undefined},{RTICORE_RUNTIME:undefined}] )assert.equal(camsDatabaseMode({...host,...patch}),null);
 assert.equal(camsDatabaseMode({NODE_ENV:'test',RTICORE_LOCAL_MODE:'1',DATABASE_URL:'fixture'}),'local');
 assert.equal(camsDatabaseMode({NODE_ENV:'production',RTICORE_LOCAL_MODE:'1',DATABASE_URL:'fixture'}),null);
});
test('configured CAMS source and entity mandatory; Hostinger posting never enabled by docking flag',()=>{
 assert.deepEqual(camsInboxScope(host,'entity'),{mode:'hostinger',source:'source',entity:'entity'});
 for(const [env,entity] of [[host,'other'],[host,null],[{...host,CAMS_FINANCE_DOCKING_ENABLED:'false'},'entity'],[{...host,CAMS_FINANCE_SOURCE_TENANT_ID:undefined},'entity']])assert.equal(camsInboxScope(env,entity),null);
 assert.equal(camsReviewAllowed(host),false);
 assert.equal(camsReviewAllowed({...host,RTICORE_LOCAL_MODE:'1'}),false);
 assert.equal(camsReviewAllowed({...host,CAMS_FINANCE_REVIEW_ENABLED:'true'}),false);
 const local={...host,NODE_ENV:'test',RTICORE_RUNTIME:undefined,RTICORE_LOCAL_MODE:'1'};
 assert.equal(camsReviewAllowed(local),false);assert.equal(camsReviewAllowed({...local,CAMS_FINANCE_REVIEW_ENABLED:'true'}),true);
});
test('inbox checks verified Finance role, assignment and both receipt scope fields; native mutations held',()=>{
 const s=fs.readFileSync('src/app/api/finance/cams-inbox/route.ts','utf8');
 assert.match(s,/a.identity.rolePreview/);
 assert.match(s,/business_unit_id IS NULL AND department_id IS NULL/);
 assert.match(s,/WHERE i.legal_entity_id=\? AND i.source_tenant_id=\?/);
 assert.match(s,/bind\(config.entity,config.source\)/);
 assert.match(s,/if\(!camsReviewAllowed\(process.env\)\)/);
 assert.match(fs.readFileSync('src/app/api/finance/cams-docking/route.ts','utf8'),/!camsDatabaseMode\(process.env\)/);
});

test('separate commands derive actor from session, require version and origin; never combine approve and post',()=>{const s=fs.readFileSync('src/app/api/finance/cams-inbox/route.ts','utf8');assert.match(s,/bind\(TENANT,config.entity,config.source,receiptId,email,action,expectedVersion/);assert.match(s,/req.headers.get\('origin'\)!==new URL\(req.url\).origin/);assert.doesNotMatch(s,/CAMS_JOURNAL_APPROVED_POSTED/);});
