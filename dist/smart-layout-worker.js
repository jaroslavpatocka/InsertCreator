import {smartArrange} from './smart-layout.js';

const jobs=new Map();
self.onmessage=async({data})=>{
  if(data?.type==='cancel'){jobs.get(data.id)?.abort();return;}
  if(data?.type!=='arrange')return;
  const controller=new AbortController();jobs.set(data.id,controller);
  try{
    const result=await smartArrange(data.project,{mode:data.mode==='sets'?'sets':'compact',signal:controller.signal,onProgress:event=>{if(!controller.signal.aborted)self.postMessage({type:'progress',id:data.id,event});}});
    if(!controller.signal.aborted)self.postMessage({type:'result',id:data.id,result});
  }catch(error){self.postMessage({type:'error',id:data.id,name:error?.name||'Error',message:error?.message||'Chytré rozvržení se nepodařilo dokončit.'});}
  finally{jobs.delete(data.id);}
};
