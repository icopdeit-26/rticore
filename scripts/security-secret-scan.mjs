import {execFileSync} from 'node:child_process';
import {readFileSync,lstatSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
// High-confidence signatures only; no values printed, no claims about repository history.
const signatures=[
 ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=]{24,}/],
 ['github-token',/\b(?:ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
 ['openai-key',/\bsk-(?:proj-|svcacct-)[A-Za-z0-9_-]{40,}\b/],
 ['aws-access-id',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
];
export function secretKinds(text){return signatures.filter(([,rx])=>rx.test(text)).map(([name])=>name);}
export function scanTracked(root=process.cwd()){
 const paths=execFileSync('git',['ls-files','-z'],{cwd:root,maxBuffer:16*1024*1024}).toString().split('\0').filter(Boolean);
 const findings=[];let scanned=0,skipped=0;
 for(const path of paths){
  const file=root+'/'+path,st=lstatSync(file);
  if(!st.isFile()||st.size>2*1024*1024){skipped++;continue;}
  const bytes=readFileSync(file);if(bytes.includes(0)){skipped++;continue;}
  scanned++;
  for(const kind of secretKinds(bytes.toString('utf8')))findings.push({path,kind});
 }
 return {scope:'tracked-text-snapshot-only',scanned,skipped,findings};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=scanTracked();console.log(JSON.stringify(result,null,2));if(result.findings.length)process.exitCode=1;
}
