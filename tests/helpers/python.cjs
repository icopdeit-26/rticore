const {spawnSync}=require('node:child_process');
const path=require('node:path');

function findPython(){
 const bundledWindows=path.join(process.cwd(),'.local-data','python312-embed','python.exe');
 const candidates=process.env.RTICORE_PYTHON?[{command:process.env.RTICORE_PYTHON,args:[]}]:process.platform==='win32'
  ?[{command:bundledWindows,args:[]},{command:'py',args:['-3']},{command:'python3',args:[]},{command:'python',args:[]}]
  :[{command:'python3',args:[]},{command:'python',args:[]}];
 for(const candidate of candidates){
  const result=spawnSync(candidate.command,[...candidate.args,'--version'],{encoding:'utf8',windowsHide:true});
  if(result.status===0)return candidate;
 }
 return null;
}

module.exports={findPython};
