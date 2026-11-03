import test from 'node:test';
import assert from 'node:assert/strict';
import {runSmartLayout} from '../dist/smart-layout-client.js';

function worker(){return{sent:[],terminated:0,postMessage(message){this.sent.push(message);},terminate(){this.terminated++;},emit(data){this.onmessage?.({data});}};}
const project=()=>({id:'client-test',name:'Původní šuplík',tools:[],modules:[],custom:{retained:true}});
const result=()=>({tools:[],modules:[],unplaced:[],stats:{changed:false}});

test('worker transport isolates input and ignores responses belonging to another job',async()=>{
  const w=worker(),input=project(),events=[],promise=runSmartLayout(input,{workerFactory:()=>w,onProgress:event=>events.push(event)}),id=w.sent[0].id;
  w.sent[0].project.custom.retained=false;assert.equal(input.custom.retained,true);
  w.emit({type:'progress',id:id+1,event:{progress:.2}});w.emit({type:'result',id:id+1,result:result()});
  assert.equal(w.terminated,0);w.emit({type:'progress',id,event:{progress:.5,message:'Pracuji'}});assert.equal(events.length,1);
  const expected=result();w.emit({type:'result',id,result:expected});assert.deepEqual(await promise,expected);assert.equal(w.terminated,1);
});

test('cancellation terminates work and late result or progress cannot escape',async()=>{
  const w=worker(),controller=new AbortController(),events=[],promise=runSmartLayout(project(),{workerFactory:()=>w,signal:controller.signal,onProgress:event=>events.push(event)}),id=w.sent[0].id,late=w.onmessage;
  controller.abort();await assert.rejects(promise,{name:'AbortError'});assert.equal(w.terminated,1);
  late({data:{type:'progress',id,event:{progress:1}}});late({data:{type:'result',id,result:result()}});assert.deepEqual(events,[]);assert.equal(w.terminated,1);
});

test('worker load, message and malformed-result failures reject without hanging',async()=>{
  for(const failure of ['error','messageerror','malformed']){
    const w=worker(),promise=runSmartLayout(project(),{workerFactory:()=>w}),id=w.sent[0].id;
    if(failure==='error')w.onerror({preventDefault(){}});else if(failure==='messageerror')w.onmessageerror();else w.emit({type:'result',id,result:{tools:[]}});
    await assert.rejects(promise);assert.equal(w.terminated,1);
  }
});

test('unsupported workers use an asynchronous bounded fallback and respect abort',async()=>{
  let started=false;const input=project(),events=[],promise=runSmartLayout(input,{workerFactory:()=>{throw Error('Workers unavailable');},onProgress:event=>events.push(event),fallback:async(copy,{signal,onProgress})=>{started=true;copy.name='Copy only';assert.equal(signal?.aborted,false);onProgress({progress:.4});await new Promise(resolve=>setTimeout(resolve,0));return result();},signal:new AbortController().signal});
  assert.equal(started,false,'The progress UI must get a rendering opportunity before fallback work starts');await promise;assert.equal(input.name,'Původní šuplík');assert.equal(events.length,1);
  const controller=new AbortController();let called=false;
  const cancelled=runSmartLayout(input,{workerFactory:()=>null,signal:controller.signal,fallback:async()=>{called=true;return result();}});controller.abort();await assert.rejects(cancelled,{name:'AbortError'});await new Promise(resolve=>setTimeout(resolve,3));assert.equal(called,false);
});

test('already aborted work never constructs a worker and oversized fallback does not run',async()=>{
  const controller=new AbortController();controller.abort();let called=false;
  await assert.rejects(runSmartLayout(project(),{signal:controller.signal,workerFactory:()=>{called=true;return worker();}}),{name:'AbortError'});assert.equal(called,false);
  await assert.rejects(runSmartLayout({...project(),tools:Array.from({length:21},()=>({points:[]}))},{workerFactory:()=>null,fallback:async()=>{called=true;return result();}}),/velký projekt/);assert.equal(called,false);
});
