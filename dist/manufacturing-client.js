// Keep manufacturing work away from the browser event loop. One client owns one
// lazy worker and at most one active plus one latest queued preview request.
let nextId=0;
const abortError=()=>new DOMException('Výpočet byl zrušen.','AbortError');
const unavailable=()=>new Error('Pro tento výpočet použijte prohlížeč s podporou výpočtů na pozadí.');
const operations=new Set(['analyze','labels','export','joint-fit','preview','fit-stl','fit-pdf','svg','dxf','baseplate','connectors','zip']);
const validResult=(operation,result)=>{
  if(!result||typeof result!=='object')return false;
  if(operation==='analyze')return Array.isArray(result.issues)&&Number.isFinite(result.labels?.count)&&Array.isArray(result.labels.skipped);
  if(operation==='labels')return Array.isArray(result.labels)&&Array.isArray(result.skipped);
  if(operation==='preview')return typeof result.html==='string'&&typeof result.viewBox==='string'&&result.stats&&typeof result.stats==='object';
  if(operation==='fit-pdf'||operation==='svg'||operation==='dxf')return result.data instanceof Uint8Array;
  if(operation==='zip')return result.zip instanceof Uint8Array;
  if(operation==='connectors')return typeof result.fits==='boolean'&&Array.isArray(result.project?.tools)&&Array.isArray(result.project.modules);
  return Array.isArray(result.files)||result.zip instanceof Uint8Array;
};
const fileSize=files=>(files||[]).reduce((sum,file)=>sum+(typeof file?.data==='string'?file.data.length*2:file?.data?.byteLength||0),0);
function smallEnough(project,options){
  const tools=project?.tools||[],modules=project?.modules||[];
  return tools.length<=6&&modules.length<=12&&tools.reduce((sum,tool)=>sum+(tool.points?.length||0),0)<=600&&fileSize(options.files)+fileSize(options.extraFiles)<=2*1024*1024;
}

export function createManufacturingClient({workerFactory,timeoutMs=120000}={}){
  let worker=null,active=null,queued=null,disposed=false,fallbackCache=null;
  const terminate=()=>{if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();worker=null;}};
  const detach=job=>{clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.abort);};
  const settle=(job,error,result)=>{if(job.settled)return;job.settled=true;detach(job);error?job.reject(error):job.resolve(result);};
  const next=()=>{if(queued){const job=queued;queued=null;start(job);}};
  const complete=(job,error,result)=>{
    if(active!==job)return;
    active=null;detach(job);settle(job,error,result);
    if(worker){worker.onmessage=null;worker.onmessageerror=null;worker.onerror=()=>terminate();}
    next();
  };
  const cancel=()=>{
    const current=active,pending=queued;active=null;queued=null;terminate();
    if(current){current.controller.abort();detach(current);settle(current,abortError());}if(pending){pending.controller.abort();settle(pending,abortError());}
  };
  function start(job){
    if(disposed){settle(job,abortError());return;}
    if(job.signal?.aborted){settle(job,abortError());next();return;}
    job.signal?.removeEventListener('abort',job.abort);
    active=job;
    job.abort=()=>{
      if(queued===job){queued=null;settle(job,abortError());return;}
      if(active===job){job.controller.abort();terminate();complete(job,abortError());}
    };
    job.signal?.addEventListener('abort',job.abort,{once:true});
    job.timer=setTimeout(()=>{
      if(active!==job)return;
      job.controller.abort();terminate();const error=new Error('Výpočet trval příliš dlouho. Zkuste menší výběr dílů.');error.name='TimeoutError';complete(job,error);
    },job.timeoutMs);
    try{
      if(!worker)worker=workerFactory?workerFactory():typeof Worker==='function'?new Worker(new URL('./manufacturing-worker.js',import.meta.url),{type:'module',name:'insertcreator-manufacturing'}):null;
    }catch{worker=null;}
    if(!worker){
      if(!smallEnough(job.project,job.options)){complete(job,unavailable());return;}
      // Even small fallback calculations get a rendering opportunity first.
      setTimeout(async()=>{
        if(active!==job||job.signal?.aborted)return;
        try{
          const {executeManufacturingTask,createManufacturingTaskCache}=await import('./manufacturing-worker.js');
          if(active!==job||job.signal?.aborted)return;
          fallbackCache??=createManufacturingTaskCache();
          const result=await executeManufacturingTask(job.operation,job.project,job.options,{signal:job.controller.signal,onProgress:event=>{if(active===job&&!job.settled)try{job.onProgress?.(event);}catch{}},cache:fallbackCache});
          if(active===job)complete(job,null,result);
        }catch(error){complete(job,error);}
      },0);
      return;
    }
    worker.onmessage=({data})=>{
      if(active!==job||data?.id!==job.id)return;
      if(data.type==='progress'){if(!job.settled)try{job.onProgress?.(data.event);}catch{}return;}
      if(data.type==='result'){
        if(!validResult(job.operation,data.result)){terminate();complete(job,new Error('Výpočet nevrátil úplný výsledek.'));return;}
        complete(job,null,data.result);return;
      }
      if(data.type==='error'){
        const error=new Error(data.message||'Výpočet se nepodařilo dokončit.');error.name=data.name||'Error';if(data.i18n)error.i18n=data.i18n;complete(job,error);
      }
    };
    worker.onerror=event=>{event.preventDefault?.();terminate();complete(job,new Error('Výpočet na pozadí se nepodařilo spustit. Zkuste to znovu.'));};
    worker.onmessageerror=()=>{terminate();complete(job,new Error('Výsledek výpočtu se nepodařilo načíst.'));};
    try{worker.postMessage({type:'run',id:job.id,operation:job.operation,project:job.project,options:job.options});}
    catch(error){terminate();const failure=new Error('Projekt nelze předat výpočtu.');failure.cause=error;complete(job,failure);}
  }
  function run(operation,project={},options={}){
    if(disposed)return Promise.reject(abortError());
    if(!operations.has(operation))return Promise.reject(new Error('Neznámý výrobní výpočet.'));
    if(options.signal?.aborted)return Promise.reject(abortError());
    const {signal,onProgress,queueLatest=false,timeoutMs:limit=timeoutMs,...payload}=options;
    // A fake/test worker must observe the same snapshot isolation as postMessage.
    let snapshot;try{snapshot=typeof structuredClone==='function'?structuredClone(project):JSON.parse(JSON.stringify(project));}catch{return Promise.reject(new Error('Projekt nelze předat výpočtu.'));}
    return new Promise((resolve,reject)=>{
      const job={id:++nextId,operation,project:snapshot,options:payload,signal,onProgress,timeoutMs:Math.max(1,Number(limit)||timeoutMs),resolve,reject,settled:false,timer:null,abort:null,controller:new AbortController()};
      if(active&&queueLatest&&operation==='preview'&&active.operation==='preview'){
        if(queued)settle(queued,abortError());
        queued=job;
        // Keep the in-flight worker and its deadline. Only its stale promise is
        // rejected; its scene cache is useful to the latest queued camera.
        if(!active.settled){active.settled=true;active.signal?.removeEventListener('abort',active.abort);active.reject(abortError());}
        job.abort=()=>{if(queued===job){queued=null;settle(job,abortError());}};signal?.addEventListener('abort',job.abort,{once:true});
      }else{if(active||queued)cancel();start(job);}
    });
  }
  return{run,cancel,dispose(){cancel();fallbackCache=null;disposed=true;}};
}
