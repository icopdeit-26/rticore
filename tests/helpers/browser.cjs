const {chromium}=require('playwright');

async function launchBrowser(options={}){
 try{return await chromium.launch(options);}
 catch(error){
  const missingDefault=error?.message?.includes('Executable doesn\'t exist');
  if(process.platform==='win32'&&missingDefault&&!options.channel)
   return chromium.launch({...options,channel:'msedge'});
  throw error;
 }
}

module.exports={launchBrowser};
