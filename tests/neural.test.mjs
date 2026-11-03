import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as ort from '../dist/vendor/ort/ort.wasm.min.mjs';
import {MODEL_SIZE,preprocess,normalizePrediction} from '../dist/neural-core.js';
import {segmentNeural} from '../dist/neural.js';

function image(width,height,rgb=[255,255,255]){
  const data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<width*height;i++)data.set([...rgb,255],i*4);
  return {width,height,data};
}
function rectangle(im,x,y,w,h,color){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const i=(yy*im.width+xx)*4;im.data.set([...color,255],i);}}
function meanRegion(mask,width,x,y,w,h){let sum=0;for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)sum+=mask[yy*width+xx];return sum/(w*h);}

test('preprocessing produces finite CHW RGB with image-maximum normalization',()=>{
  const source=image(2,2,[255,128,0]),values=preprocess(source,2);
  assert.equal(values.length,12);assert.ok(Math.abs(values[0]-(1-.485)/.229)<1e-5);assert.ok(Math.abs(values[4]-(128/255-.456)/.224)<1e-5);assert.ok(Math.abs(values[8]-(0-.406)/.225)<1e-5);
  const black=preprocess(image(2,2,[0,0,0]),2);assert.ok(black.every(Number.isFinite));
  const transparent=image(2,2,[0,0,0]);for(let i=3;i<transparent.data.length;i+=4)transparent.data[i]=0;
  assert.deepEqual(preprocess(transparent,2),preprocess(image(2,2),2),'transparent pixels must composite onto white');
});
test('prediction normalization restores dimensions with bilinear edges and handles flat masks',()=>{
  const mask=normalizePrediction(new Float32Array([2,4,2,4]),2,2,4,4);
  assert.equal(mask.length,16);assert.equal(mask[0],0);assert.equal(mask[3],1);assert.ok(Math.abs(mask[1]-.25)<1e-7);assert.ok(Math.abs(mask[2]-.75)<1e-7);
  assert.ok(normalizePrediction(new Float32Array(4).fill(.5),2,2).every(v=>v===0));
  assert.throws(()=>normalizePrediction(new Float32Array([NaN,1,1,1]),2,2));
  assert.throws(()=>preprocess({width:2,height:2,data:new Uint8Array(1)}));
});
test('aborted work fails before creating a worker',async()=>{
  const controller=new AbortController();controller.abort();await assert.rejects(segmentNeural(image(2,2),{signal:controller.signal}),{name:'AbortError'});
});
test('bundled model checksum and runtime WASM are genuine release assets',async()=>{
  const model=await fs.readFile(new URL('../dist/models/u2netp.onnx',import.meta.url));
  assert.equal(createHash('md5').update(model).digest('hex'),'8e83ca70e441ab06c318d82300c84806');
  assert.ok(model.length>4000000&&model.length<6000000);
  const wasm=await fs.readFile(new URL('../dist/vendor/ort/ort-wasm-simd-threaded.wasm',import.meta.url));assert.deepEqual([...wasm.subarray(0,4)],[0,97,115,109]);assert.ok(wasm.length<25*1024*1024);
});
test('real local ONNX WASM inference detects tools in single and multiple-object rasters',async t=>{
  ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths=new URL('../dist/vendor/ort/',import.meta.url).href;
  const session=await ort.InferenceSession.create(await fs.readFile(new URL('../dist/models/u2netp.onnx',import.meta.url)),{executionProviders:['wasm'],graphOptimizationLevel:'all'});
  assert.equal(session.inputNames.length,1);assert.ok(session.outputNames.length>=1);
  try{
    for(const multiple of [false,true]){
      const source=image(480,480,[247,248,245]);
      // A long screwdriver with a steel shaft, flared red handle and slight shading.
      rectangle(source,200,40,14,215,[65,71,76]);rectangle(source,180,245,54,135,[159,40,35]);rectangle(source,187,255,8,110,[184,63,56]);
      if(multiple){rectangle(source,320,80,18,255,[60,66,72]);rectangle(source,304,80,50,30,[67,72,75]);rectangle(source,309,316,40,38,[66,70,74]);}
      const input=new ort.Tensor('float32',preprocess(source),[1,3,MODEL_SIZE,MODEL_SIZE]);const start=performance.now(),outputs=await session.run({[session.inputNames[0]]:input});
      try{
        const prediction=outputs[session.outputNames[0]],mask=normalizePrediction(prediction.data,320,320,source.width,source.height),handle=meanRegion(mask,480,190,270,25,80),background=meanRegion(mask,480,30,30,50,50);
        t.diagnostic(`${multiple?'multiple':'single'} raster: ${Math.round(performance.now()-start)}ms, handle=${handle.toFixed(3)}, background=${background.toFixed(3)}`);
        assert.equal(mask.length,source.width*source.height);assert.ok(mask.every(v=>Number.isFinite(v)&&v>=0&&v<=1));assert.ok(handle>.65&&handle>background+.4,'real foreground must score higher than paper');
        if(multiple){const second=meanRegion(mask,480,323,120,10,150);t.diagnostic(`second tool=${second.toFixed(3)}`);assert.ok(second>.5,'second separate tool must remain in mask');}
      }finally{input.dispose?.();for(const output of Object.values(outputs))output.dispose?.();}
    }
  }finally{await session.release();}
});
