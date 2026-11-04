import {getLang} from './i18n.js';
import {unit} from './units.js';

const MAX_CACHE_BYTES=384*1024*1024,MAX_CACHE_ENTRIES=600;
const validResult=(type,result)=>type==='plan'
  ?result&&Object.hasOwn(result,'batch')&&(result.batch===null||(typeof result.batch==='object'&&!Array.isArray(result.batch)))
  :result?.vertices instanceof Float32Array&&Array.isArray(result.ranges);

// Colours are applied at draw time, so changing them must not rebuild a mesh.
const geometrySettings=({tools,modules,id,name,updatedAt,toolSets,unplaced,multiMaterial,...settings})=>{
  const {bodyColor,floorColor,textColor,...material}=multiMaterial||{};
  return{...settings,multiMaterial:material};
};
export function hashText(text){
  let a=0xdeadbeef,b=0x41c6ce57;
  for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);a=Math.imul(a^c,2654435761);b=Math.imul(b^c,1597334677);}
  a=Math.imul(a^(a>>>16),2246822507)^Math.imul(b^(b>>>13),3266489909);b=Math.imul(b^(b>>>16),2246822507)^Math.imul(a^(a>>>13),3266489909);
  return(b>>>0).toString(36)+'-'+(a>>>0).toString(36)+'-'+text.length;
}
/** One key per module: editing a module leaves the others' meshes cached. Joints depend on the neighbours. */
export function meshKeys(project,{sharedLayout=false}={}){
  const modules=project.modules||[],tools=project.tools||[],settings=getLang()+unit()+JSON.stringify(geometrySettings(project)),projectKey=hashText(settings+JSON.stringify([modules,tools]));
  const owned=new Map();for(const tool of tools){if(!owned.has(tool.moduleId))owned.set(tool.moduleId,[]);owned.get(tool.moduleId).push(tool);}
  const modulesKey=new Map(modules.map(module=>[module.id,sharedLayout?projectKey+module.id:hashText(settings+JSON.stringify(module)+JSON.stringify(owned.get(module.id)||[]))]));
  return{projectKey,modules:modulesKey};
}

/** Small worker pool with a result cache. Results are shared, jobs nobody wants any more are dropped. */
export function createMeshPool({factory=()=>new Worker(new URL('./mesh-worker.js',import.meta.url),{type:'module',name:'suplik-mesh'}),size=Math.max(1,Math.min(3,(globalThis.navigator?.hardwareConcurrency||2)-1))}={}){
  const cache=new Map(),queue=[],idle=[],busy=new Map(),workers=new Set();let nextId=1,bytes=0,broken=null;
  const fail=(job,error)=>{cache.delete(job.key);job.reject(error);};
  const failPool=error=>{
    if(broken)return;
    broken=error;
    for(const worker of workers){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate?.();}
    workers.clear();
    for(const job of [...busy.values(),...queue.splice(0)])fail(job,error);
    busy.clear();idle.length=0;
  };
  const trim=()=>{
    for(const [key,entry] of cache){
      if(bytes<=MAX_CACHE_BYTES&&cache.size<=MAX_CACHE_ENTRIES)break;
      if(entry.result){cache.delete(key);bytes-=entry.bytes;}
    }
  };
  const spawn=()=>{
    const worker=factory();workers.add(worker);
    worker.onmessage=({data})=>{
      const job=busy.get(worker);
      // A stale or unrelated reply must not release the worker currently running this job.
      if(!job||data?.id!==job.id)return;
      if(!data.error&&!validResult(job.type,data.result)){failPool(Error('Výpočet nevrátil úplný výsledek.'));return;}
      busy.delete(worker);idle.push(worker);
      if(data.error){const error=Object.assign(Error(data.error.message),data.error.i18n?{i18n:data.error.i18n}:{});cache.delete(job.key);job.reject(error);}
      else{
        const entry=cache.get(job.key);if(entry){entry.result=data.result;entry.bytes=data.result.vertices?.byteLength||0;bytes+=entry.bytes;}
        job.resolve(data.result);trim();
      }
      pump();
    };
    worker.onerror=event=>{
      event.preventDefault?.();failPool(Error('Výpočetní vlákno se nepodařilo spustit.'));
    };
    worker.onmessageerror=()=>failPool(Error('Výsledek výpočtu se nepodařilo načíst.'));
    return worker;
  };
  const pump=()=>{
    while(queue.length&&!broken){
      let worker=idle.pop();
      if(!worker){if(workers.size>=size)return;try{worker=spawn();}catch(error){failPool(error);return;}}
      const job=queue.shift();busy.set(worker,job);
      const message={id:job.id,type:job.type,project:job.project,moduleId:job.moduleId,projectKey:job.projectKey,lang:getLang(),unit:unit()};
      if(Object.hasOwn(job,'batch'))message.batch=job.batch;
      try{worker.postMessage(message);}
      catch(error){failPool(Object.assign(Error('Projekt nelze předat výpočtu.'),{cause:error}));}
    }
  };
  return{
    /** Larger `weight` starts first, which keeps the longest module from finishing last. */
    run(type,key,project,moduleId,options={}){
      const {projectKey=key,weight=0}=options;
      const cacheKey=type+':'+key,known=cache.get(cacheKey);
      if(known){cache.delete(cacheKey);cache.set(cacheKey,known);return known.promise;}
      if(broken)return Promise.reject(broken);
      let job;const promise=new Promise((resolve,reject)=>{job={id:nextId++,key:cacheKey,type,project,moduleId,projectKey,weight,resolve,reject};});
      if(Object.hasOwn(options,'batch'))job.batch=options.batch;
      promise.catch(()=>{});cache.set(cacheKey,{promise,result:null,bytes:0});
      const at=queue.findIndex(item=>item.weight<weight);if(at<0)queue.push(job);else queue.splice(at,0,job);
      pump();return promise;
    },
    peek(type,key){return cache.get(type+':'+key)?.result??null;},
    /** Forget waiting jobs of one type that the current project no longer contains. */
    keep(type,keys){
      const wanted=new Set([...keys].map(key=>type+':'+key));
      for(let i=queue.length-1;i>=0;i--)if(queue[i].type===type&&!wanted.has(queue[i].key)){const [job]=queue.splice(i,1);cache.delete(job.key);job.reject(Object.assign(Error('cancelled'),{cancelled:true}));}
    },
    get broken(){return broken;}
  };
}
