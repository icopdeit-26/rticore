import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {duplicateMigrationVersions} from './hostinger-schema-inventory.mjs';
export function validateManifest(manifest,readDirectory){
 const dirs=['deployment/hostinger/migrations','sql/native-postgres'];
 if(!Array.isArray(manifest.streams)||manifest.streams.length!==dirs.length)throw Error('Invalid native streams');
 return manifest.streams.flatMap((stream,i)=>{
  if(stream.directory!==dirs[i]||!Array.isArray(stream.files)||!stream.files.length)throw Error('Native stream missing or reordered');
  const actual=readDirectory(stream.directory).filter(f=>/^\d{4}_.+\.sql$/.test(f)).sort();
  if(duplicateMigrationVersions(actual,stream.directory).length)throw Error('Migration version collision: '+stream.directory);
  if(JSON.stringify(stream.files)!==JSON.stringify(actual))throw Error('Native migration manifest drift: '+stream.directory);
  return stream.files.map(f=>stream.directory+'/'+f);
 });
}
export function nativeMigrationManifest(root=process.cwd()){
 const data=JSON.parse(readFileSync(join(root,'deployment/hostinger/native-migration-manifest.json'),'utf8'));
 return validateManifest(data,d=>readdirSync(join(root,d))).map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const rows=nativeMigrationManifest();
 if(process.argv.includes('--paths'))console.log(rows.map(r=>r.path).join('\n'));
 else console.log(JSON.stringify({scope:'source_manifest_only',migrations:rows,production_applied:null},null,2));
}
