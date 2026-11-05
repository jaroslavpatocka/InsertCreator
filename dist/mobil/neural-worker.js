import {MODEL_SIZE,preprocess,normalizePrediction,validateNeuralImage} from './neural-core.js';

let sessionPromise=null,ort=null,queue=Promise.resolve();
const notify=(id,phase,progress,message)=>self.postMessage({id,type:'progress',phase,progress,message});
async function getSession(id){
  if(!sessionPromise){
    sessionPromise=(async()=>{
      notify(id,'loading',.02,'Načítám rozpoznávání…');
      ort=await import('./vendor/ort/ort.wasm.min.mjs');
      ort.env.wasm.wasmPaths=new URL('./vendor/ort/',import.meta.url).href;
      ort.env.wasm.numThreads=1;
      ort.env.wasm.proxy=false;
      ort.env.wasm.simd=true;
      const response=await fetch(new URL('./models/u2netp.onnx',import.meta.url),{credentials:'same-origin'});
      if(!response.ok)throw new Error('Model rozpoznávání se nepodařilo načíst. Zkontrolujte připojení a zkuste snímek znovu.');
      const bytes=await response.arrayBuffer();
      notify(id,'loading',.15,'Připravuji lokální neuronovou síť…');
      return ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
    })();
  }
  return sessionPromise;
}
async function run({id,width,height,buffer}){
  validateNeuralImage({width,height,data:new Uint8ClampedArray(buffer)});
  const session=await getSession(id);
  notify(id,'preprocess',.3,'Připravuji fotografii pro rozpoznávání…');
  const input=new ort.Tensor('float32',preprocess({width,height,data:new Uint8ClampedArray(buffer)}),[1,3,MODEL_SIZE,MODEL_SIZE]);
  let outputs;
  try{
    notify(id,'inference',.4,'Rozpoznávám nástroje přímo v zařízení…');
    outputs=await session.run({[session.inputNames[0]]:input});
    notify(id,'postprocess',.9,'Zpřesňuji masku nástrojů…');
    const output=outputs[session.outputNames[0]],dims=output.dims;
    const probability=normalizePrediction(output.data,dims.at(-1),dims.at(-2),width,height);
    notify(id,'postprocess',1,'Nástroje rozpoznány. Připravuji kontury…');
    self.postMessage({id,type:'result',width,height,model:'u2netp',buffer:probability.buffer},[probability.buffer]);
  }finally{
    input.dispose?.();
    if(outputs)for(const tensor of Object.values(outputs))tensor.dispose?.();
  }
}
self.onmessage=({data})=>{
  queue=queue.then(()=>run(data)).catch(error=>self.postMessage({id:data.id,type:'error',message:error?.message||'Rozpoznávání se nepodařilo dokončit.'}));
};
