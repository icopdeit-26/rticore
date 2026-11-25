'use client';

import {useEffect,useState} from 'react';
import {PRODUCT_PRICING,type estimateScopingPrice,type ScopingPriceEstimate} from './scoping-pricing';

type Input=Omit<Parameters<typeof estimateScopingPrice>[0],'calibrationFactor'|'sellingOnly'>;
type Result={estimate:ScopingPriceEstimate;canViewCost:boolean;modelVersion:number|null};

export function useScopingEstimate(input:Input,enabled:boolean){
 const key=enabled?JSON.stringify(input):'';
 const [result,setResult]=useState<{key:string;data?:Result;error?:string}>();
 useEffect(()=>{
  if(!key)return;
  const controller=new AbortController();
  const timer=setTimeout(async()=>{
   try{
    const response=await fetch('/api/scoping/model',{method:'POST',
     headers:{'Content-Type':'application/json'},body:key,signal:controller.signal});
    const data=await response.json();
    if(!response.ok||!data.success)throw Error(data.message||'Estimasi scoping tidak tersedia untuk akun ini.');
    if(!controller.signal.aborted)setResult({key,data});
   }catch(error){
    if(!controller.signal.aborted)setResult({key,error:error instanceof Error?error.message:'Estimasi scoping belum tersedia.'});
   }
  },250);
  return ()=>{clearTimeout(timer);controller.abort();};
 },[key]);
 const current=result?.key===key?result:undefined;
 const model=PRODUCT_PRICING[input.service].model;
 const pending:ScopingPriceEstimate={
  model,periodLabel:model==='md'?'':'/bulan',ready:false,
  reason:current?.error||(enabled?'Menghitung estimasi…':'Lengkapi parameter untuk menghitung estimasi.'),
  tierMultiplier:1,dai:1,totalMd:0,staffing:[],costs:{A:0,B:0,C:0,D:0,E:0},
  totalInternalCost:0,floor:null,standard:0,premium:0,marginAtStandard:null,
  marginWarning:false,calibrationFactor:1,baseStandard:0,heldAtFloor:false,
 };
 return {estimate:current?.data?.estimate??pending,canViewCost:!!result?.data?.canViewCost,
  modelVersion:current?.data?.modelVersion??null};
}
