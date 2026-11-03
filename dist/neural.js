import {validateNeuralImage} from './neural-core.js';
export {preprocess,normalizePrediction} from './neural-core.js';

let worker=null,nextId=0;
const pending=new Map();
const abortError=()=>typeof DOMException==='function'?new DOMException('Rozpoznávání bylo zrušeno.','AbortError'):Object.assign(new Error('Rozpoznávání bylo zrušeno.'),{name:'AbortError'});
function finish(id,error,result){
  const job=pending.get(id);if(!job)return;
  pending.delete(id);clearTimeout(job.timeout);job.signal?.removeEventListener('abort',job.abort);
  if(error)job.reject(error);else job.resolve(result);
}
function stop(error){
  worker?.terminate();worker=null;
  for(const id of [...pending.keys()])finish(id,error);
}
function getWorker(){
  if(worker)return worker;
  if(typeof Worker!=='function')throw new Error('Tento prohlížeč nepodporuje lokální rozpoznávání. Použijte aktuální Chrome, Edge, Firefox nebo Safari.');
  worker=new Worker(new URL('./neural-worker.js',import.meta.url),{type:'module',name:'suplik-neural'});
  worker.onmessage=({data})=>{
    const job=pending.get(data.id);if(!job)return;
    if(data.type==='progress'){try{job.onProgress?.({phase:data.phase,stage:data.phase,progress:data.progress,message:data.message});}catch{}return;}
    if(data.type==='error'){stop(new Error(data.message));return;}
    if(data.type==='result'){
      const probability=new Float32Array(data.buffer);
      if(probability.length!==data.width*data.height){stop(new Error('Rozpoznávání nevrátilo úplnou masku.'));return;}
      finish(data.id,null,{probability,width:data.width,height:data.height,model:'u2netp'});
    }
  };
  worker.onerror=event=>{event.preventDefault();stop(new Error('Lokální rozpoznávání se nepodařilo spustit. Obnovte stránku a zkuste snímek znovu.'));};
  worker.onmessageerror=()=>stop(new Error('Masku rozpoznaných nástrojů se nepodařilo předat. Zkuste snímek znovu.'));
  return worker;
}

/** Local CPU/WASM segmentation. Cancellation releases its shared worker and queued jobs. */
export function segmentNeural(imageData,{onProgress,signal}={}){
  try{validateNeuralImage(imageData);}catch(error){return Promise.reject(error);}
  if(signal?.aborted)return Promise.reject(abortError());
  let current;try{current=getWorker();}catch(error){return Promise.reject(error);}
  const id=++nextId;
  return new Promise((resolve,reject)=>{
    const abort=()=>stop(abortError());
    const timeout=setTimeout(()=>stop(new Error('Rozpoznávání trvalo příliš dlouho. Zkuste menší snímek nebo novější zařízení.')),60000);
    pending.set(id,{resolve,reject,onProgress,signal,abort,timeout});signal?.addEventListener('abort',abort,{once:true});
    // Copy before transfer so cancellation never detaches the caller's photo data.
    const data=new Uint8ClampedArray(imageData.data);
    try{current.postMessage({id,width:imageData.width,height:imageData.height,buffer:data.buffer},[data.buffer]);}catch(error){stop(new Error('Fotografii nelze předat rozpoznávání. '+error.message));}
  });
}
