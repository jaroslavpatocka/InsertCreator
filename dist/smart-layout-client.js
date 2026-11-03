const abortError=()=>new DOMException('Chytré rozvržení bylo zrušeno.','AbortError');
const copy=value=>typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));
let nextId=0;

/** One isolated worker per run; no project state is owned by the transport. */
export function runSmartLayout(project,{mode='compact',signal,onProgress,workerFactory,fallback}={}){
  if(!['compact','sets'].includes(mode))return Promise.reject(new Error('Neplatný režim chytrého rozvržení.'));
  if(signal?.aborted)return Promise.reject(abortError());
  let input;try{input=copy(project);}catch{return Promise.reject(new Error('Projekt nelze předat chytrému rozvržení.'));}
  const id=++nextId;
  return new Promise((resolve,reject)=>{
    let worker=null,finished=false;
    const finish=(error,result)=>{
      if(finished)return;finished=true;signal?.removeEventListener('abort',cancel);
      if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();}
      error?reject(error):resolve(result);
    };
    const cancel=()=>finish(abortError());
    const progress=event=>{if(!finished&&!signal?.aborted){try{onProgress?.(event);}catch{}}};
    signal?.addEventListener('abort',cancel,{once:true});
    const local=async()=>{
      // Bound the UI-thread fallback; larger projects need the worker backend.
      if((input.tools?.length||0)>20||(input.tools||[]).reduce((n,t)=>n+(t.points?.length||0),0)>20000){finish(new Error('Pro tento velký projekt použijte prohlížeč s podporou výpočtů na pozadí.'));return;}
      try{
        await new Promise(resolve=>setTimeout(resolve,0));if(finished)return;
        const arrange=fallback||(await import('./smart-layout.js')).smartArrange;
        const result=await arrange(input,{mode,signal,onProgress:progress});
        if(!signal?.aborted)finish(null,result);else cancel();
      }catch(error){finish(error);}
    };
    try{
      if(workerFactory)worker=workerFactory();
      else if(typeof Worker==='function')worker=new Worker(new URL('./smart-layout-worker.js',import.meta.url),{type:'module',name:'suplik-smart-layout'});
    }catch{worker=null;}
    if(!worker){local();return;}
    worker.onmessage=({data})=>{
      if(finished||signal?.aborted||data?.id!==id)return;
      if(data.type==='progress'){progress(data.event);return;}
      if(data.type==='error'){const error=new Error(data.message||'Chytré rozvržení se nepodařilo dokončit.');error.name=data.name||'Error';finish(error);return;}
      if(data.type==='result'){
        if(!Array.isArray(data.result?.tools)||!Array.isArray(data.result?.modules)||!Array.isArray(data.result?.unplaced)){finish(new Error('Chytré rozvržení nevrátilo úplnou sestavu.'));return;}
        finish(null,data.result);
      }
    };
    worker.onerror=event=>{event.preventDefault?.();finish(new Error('Chytré rozvržení se nepodařilo spustit. Zkuste to znovu.'));};
    worker.onmessageerror=()=>finish(new Error('Výsledek chytrého rozvržení se nepodařilo načíst.'));
    try{worker.postMessage({type:'arrange',id,mode,project:input});}catch(error){finish(new Error('Projekt nelze předat chytrému rozvržení. '+error.message));}
  });
}
