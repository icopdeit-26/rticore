import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const marker=path.join(root,'.next','rticore-local-build.sha256');
const next=path.join(root,'node_modules','next','dist','bin','next');
const buildOnly=process.argv.includes('--build-only');

function fingerprint(){
 const hash=crypto.createHash('sha256');
 hash.update(process.version);
 const visit=relative=>{
  const absolute=path.join(root,relative);
  if(!fs.existsSync(absolute)){hash.update('missing:'+relative);return;}
  if(fs.statSync(absolute).isDirectory()){
   for(const name of fs.readdirSync(absolute).sort())visit(path.join(relative,name));
  }else{hash.update(relative);hash.update(fs.readFileSync(absolute));}
 };
 // Hash build inputs, not timestamps. Secrets only contribute to the hash and are never logged.
 for(const name of ['src','public','scripts/postgres-worker.mjs','rticore_postgresql_schema.sql',
  'package.json','package-lock.json','next.config.mjs','tsconfig.json','tailwind.config.ts',
  'tailwind.config.js','postcss.config.js','postcss.config.mjs','.env','.env.local',
  '.env.production','.env.production.local','node_modules/next/package.json'])visit(name);
 hash.update(JSON.stringify(Object.entries(process.env).filter(([key])=>key.startsWith('NEXT_PUBLIC_')).sort()));
 return hash.digest('hex');
}

function run(args){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[next,...args],{cwd:root,stdio:'inherit',windowsHide:true});
  child.once('error',reject);
  child.once('exit',(code,signal)=>code===0?resolve():reject(new Error(`Next.js berhenti (${signal||code}).`)));
 });
}

async function portAvailable(){
 return new Promise((resolve,reject)=>{
  const server=net.createServer();
  server.once('error',()=>reject(new Error('Port 3000 sedang digunakan. Hentikan server lama dengan Ctrl+C, lalu jalankan ulang start-local.bat.')));
  server.listen(3000,'127.0.0.1',()=>server.close(resolve));
 });
}

try{
 if(!fs.existsSync(next))throw new Error('Dependency belum terpasang. Jalankan npm.cmd ci terlebih dahulu.');
 if(!buildOnly)await portAvailable();
 const signature=fingerprint();
 const cached=fs.existsSync(marker)?fs.readFileSync(marker,'utf8').trim():'';
 if(signature!==cached||!fs.existsSync(path.join(root,'.next','BUILD_ID'))){
  console.log('Menyiapkan build production lokal. Build berikutnya digunakan ulang selama kode tidak berubah.');
  await run(['build','--webpack']);
  fs.writeFileSync(marker,signature+'\n');
 }else console.log('Build lokal sudah terbaru; melewati kompilasi.');
 if(!buildOnly){
  console.log('RTICORE mode cepat: http://127.0.0.1:3000/login');
  await run(['start','-H','127.0.0.1','-p','3000']);
 }
}catch(error){console.error(error.message);process.exitCode=1;}
