import test from 'node:test';
import assert from 'node:assert/strict';
import {createMeshPool} from '../dist/mesh-client.js';

const result=()=>({vertices:new Float32Array(18),ranges:[{zone:'body',first:0,count:3}],facets:1});
const worker=()=>({posted:[],terminated:false,postMessage(message){this.posted.push(message);},terminate(){this.terminated=true;}});

test('an unrelated worker reply does not strand the active mesh or start a second job',async()=>{
  const thread=worker(),pool=createMeshPool({factory:()=>thread,size:1});
  const first=pool.run('mesh','first',{},'first'),second=pool.run('mesh','second',{},'second');
  const firstId=thread.posted[0].id;
  thread.onmessage({data:{id:firstId+999,result:result()}});
  assert.equal(thread.posted.length,1);
  thread.onmessage({data:{id:firstId,result:result()}});assert.equal((await first).facets,1);
  const secondId=thread.posted[1].id;
  thread.onmessage({data:{id:firstId,result:result()}});assert.equal(thread.posted.length,2);
  thread.onmessage({data:{id:secondId,result:result()}});assert.equal((await second).facets,1);
});

test('postMessage failure rejects the cached job without throwing out of run',async()=>{
  const cause=new DOMException('cannot clone','DataCloneError'),thread=worker();
  thread.postMessage=()=>{throw cause;};
  const pool=createMeshPool({factory:()=>thread,size:1});let pending;
  assert.doesNotThrow(()=>{pending=pool.run('mesh','broken',{},'broken');});
  await assert.rejects(pending,error=>error.cause===cause);
  assert.ok(pool.broken);assert.equal(thread.terminated,true);assert.equal(pool.peek('mesh','broken'),null);
  await assert.rejects(pool.run('mesh','broken',{},'broken'));
});

test('an unreadable mesh response rejects active and queued work and terminates workers',async()=>{
  const threads=[],pool=createMeshPool({factory:()=>{const thread=worker();threads.push(thread);return thread;},size:2});
  const pending=['a','b','c'].map(id=>pool.run('mesh',id,{},id));
  assert.equal(typeof threads[0].onmessageerror,'function');threads[0].onmessageerror({});
  for(const promise of pending)await assert.rejects(promise,/Výsledek výpočtu/);
  assert.ok(pool.broken);assert.ok(threads.every(thread=>thread.terminated));
  assert.ok(threads.every(thread=>thread.onmessage===null&&thread.onerror===null&&thread.onmessageerror===null));
});

test('a malformed matching result fails visibly instead of leaving its promise pending',async()=>{
  const thread=worker(),pool=createMeshPool({factory:()=>thread,size:1}),pending=pool.run('mesh','a',{},'a');
  thread.onmessage({data:{id:thread.posted[0].id,result:{facets:1}}});
  await assert.rejects(pending,/úplný výsledek/);assert.ok(pool.broken);assert.equal(thread.terminated,true);
});

test('failure to create another worker also settles work already running',async()=>{
  const thread=worker(),cause=Error('worker startup refused');let count=0;
  const pool=createMeshPool({factory:()=>{if(count++)throw cause;return thread;},size:2});
  const first=pool.run('mesh','a',{},'a'),second=pool.run('mesh','b',{},'b');
  await assert.rejects(first,error=>error===cause);await assert.rejects(second,error=>error===cause);
  assert.equal(thread.terminated,true);assert.equal(pool.broken,cause);
});

test('a shared plan is cached separately from module meshes and accepts an empty plan',async()=>{
  const thread=worker(),pool=createMeshPool({factory:()=>thread,size:1}),batch={plans:[{module:{id:'a'},tiles:[]}],jointPlan:{joints:[]}};
  const planned=pool.run('plan','project',{},null);
  assert.equal(pool.run('plan','project',{},null),planned);assert.equal(thread.posted[0].type,'plan');
  const planResult={batch};thread.onmessage({data:{id:thread.posted[0].id,result:planResult}});
  assert.equal(await planned,planResult);assert.equal(pool.peek('plan','project'),planResult);
  assert.equal(pool.run('plan','project',{},null),planned);assert.equal(thread.posted.length,1);
  const noPlan=pool.run('plan','plain',{},null);thread.onmessage({data:{id:thread.posted.at(-1).id,result:{batch:null}}});
  assert.deepEqual(await noPlan,{batch:null});assert.equal(pool.broken,null);
  const mesh=pool.run('mesh','project',{},'a',{batch});assert.equal(thread.posted.at(-1).type,'mesh');
  thread.onmessage({data:{id:thread.posted.at(-1).id,result:result()}});assert.equal((await mesh).facets,1);
});

test('mesh dispatch preserves an absent batch and forwards explicit null or shared plans',async()=>{
  const thread=worker(),pool=createMeshPool({factory:()=>thread,size:1}),batch={plans:[]};
  for(const [key,options,hasBatch] of [['absent',{},false],['null',{batch:null},true],['shared',{batch},true],['inherited',Object.create({batch}),false]]){
    const pending=pool.run('mesh',key,{},key,options),message=thread.posted.at(-1);
    assert.equal(Object.hasOwn(message,'batch'),hasBatch,key);
    if(hasBatch)assert.equal(message.batch,options.batch,key);
    thread.onmessage({data:{id:message.id,result:result()}});await pending;
  }
});

test('a plan reply without a batch is rejected as incomplete',async()=>{
  const thread=worker(),pool=createMeshPool({factory:()=>thread,size:1}),pending=pool.run('plan','a',{},null);
  thread.onmessage({data:{id:thread.posted[0].id,result:{plans:[]}}});
  await assert.rejects(pending,/úplný výsledek/);assert.ok(pool.broken);
});
