/** Run the unmodified browser worker modules under Node for real-model tests. */
import {parentPort,workerData} from 'node:worker_threads';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

globalThis.self=globalThis;
self.postMessage=(message,transfer=[])=>parentPort.postMessage(message,transfer);
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  const url=input instanceof URL?input:new URL(typeof input==='string'?input:input.url);
  if(url.protocol!=='file:')return nativeFetch(input,init);
  try{
    const bytes=await fs.readFile(fileURLToPath(url));
    return new Response(bytes,{status:200,headers:{'content-type':url.pathname.endsWith('.wasm')?'application/wasm':'application/octet-stream'}});
  }catch{return new Response('File not found',{status:404});}
};
const waiting=[];
parentPort.on('message',data=>{if(typeof self.onmessage==='function')self.onmessage({data});else waiting.push(data);});
await import(workerData.url);
for(const data of waiting)self.onmessage({data});
