const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');

test('local fast launcher reuses a matching build, rebuilds changed inputs and never accepts a failed build',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rticore-fast-'));
 try{
  fs.mkdirSync(path.join(root,'scripts'),{recursive:true});
  fs.mkdirSync(path.join(root,'src'),{recursive:true});
  fs.mkdirSync(path.join(root,'node_modules/next/dist/bin'),{recursive:true});
  fs.copyFileSync(path.resolve(__dirname,'../scripts/start-local-fast.mjs'),path.join(root,'scripts/start-local-fast.mjs'));
  fs.writeFileSync(path.join(root,'node_modules/next/package.json'),'{}');
  fs.writeFileSync(path.join(root,'src/page.tsx'),'first');
  fs.writeFileSync(path.join(root,'node_modules/next/dist/bin/next'),`
   const fs=require('node:fs');
   fs.appendFileSync('build-count','build\\n');
   if(fs.existsSync('fail-build'))process.exit(1);
   fs.mkdirSync('.next',{recursive:true});fs.writeFileSync('.next/BUILD_ID','fixture');
  `);
  const run=()=>spawnSync(process.execPath,['scripts/start-local-fast.mjs','--build-only'],{cwd:root,encoding:'utf8',windowsHide:true});
  assert.equal(run().status,0);
  assert.equal(run().status,0);
  assert.equal(fs.readFileSync(path.join(root,'build-count'),'utf8').trim().split('\n').length,1);
  fs.writeFileSync(path.join(root,'src/page.tsx'),'changed');
  assert.equal(run().status,0);
  assert.equal(fs.readFileSync(path.join(root,'build-count'),'utf8').trim().split('\n').length,2);
  const marker=fs.readFileSync(path.join(root,'.next/rticore-local-build.sha256'),'utf8');
  fs.writeFileSync(path.join(root,'src/page.tsx'),'broken');
  fs.writeFileSync(path.join(root,'fail-build'),'1');
  assert.notEqual(run().status,0);
  assert.equal(fs.readFileSync(path.join(root,'.next/rticore-local-build.sha256'),'utf8'),marker);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
