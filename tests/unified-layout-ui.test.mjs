import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject,validateProject} from '../dist/model.js';
import {autoArrange,pocketOutline,validateLayout} from '../dist/geometry.js';
import {catalogItems} from '../dist/catalog/index.js';
import {catalogTool} from '../dist/catalog-ui.js';
import {Worker as NodeWorker} from 'node:worker_threads';

const manufacturingWorkers=new Set();
class ManufacturingWorker{
  constructor(url){
    this.native=new NodeWorker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{url:String(url)}});manufacturingWorkers.add(this);
    this.native.on('message',data=>this.onmessage?.({data}));this.native.on('error',error=>this.onerror?.({message:error.message,preventDefault(){}}));
    this.native.on('messageerror',()=>this.onmessageerror?.());this.native.unref();
  }
  postMessage(data,transfer){this.native.postMessage(data,transfer);}
  terminate(){manufacturingWorkers.delete(this);return this.native.terminate();}
}

const win=new Window({url:'http://localhost:5173'}),html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');localStorage.setItem('suplik-studio-smart-mode','"compact"');localStorage.setItem('suplik-studio-module-shape','"rectangular"');
const copy=value=>structuredClone(value),logical=project=>{const result=copy(project);delete result.updatedAt;return result;};
const items=[10,12,16,18].map(size=>{const item=catalogItems().find(item=>item.id===`socket-3-8in-${size}mm`);assert.ok(item);return item;});
function oversized(id,{parked=false}={}){
  const project={...blankProject(),id,name:id,width:840,height:630,modules:[],tools:[]};
  const add=(item,module,toolId)=>{const tool={...catalogTool(item),id:toolId,depth:Math.min(item.depth,17.6),locked:false,moduleId:module.id},points=pocketOutline(tool,project.clearance),xs=points.map(point=>point.x),ys=points.map(point=>point.y),minX=Math.min(...xs),minY=Math.min(...ys),width=Math.max(...xs)-minX,height=Math.max(...ys)-minY;tool.x=module.x+(module.width-width)/2-minX;tool.y=module.y+(module.height-height)/2-minY;project.modules.push(module);project.tools.push(tool);};
  for(const [index,item] of items.entries())add(item,{id:`socket-module-${index}`,name:`Socket ${item.size}`,x:parked&&index===0?882:index*126,y:0,width:126,height:294,sizeMode:'auto',locked:false,setId:'sockets',setLayout:'auto'},`socket-${index}`);
  add(items[0],{id:'locked',name:'Locked sample',x:672,y:0,width:84,height:84,sizeMode:'auto',locked:true},'locked-tool');
  add(items[3],{id:'manual',name:'Manual 84',x:756,y:126,width:84,height:84,sizeMode:'manual',locked:false,unit:'in'},'manual-tool');
  project.modules.push({id:'blank',name:'Explicit blank',x:756,y:0,width:84,height:84,sizeMode:'manual',locked:false});
  project.toolSets=[{id:'sockets',name:'Small sockets',toolIds:project.tools.slice(0,4).map(tool=>tool.id),layout:'auto',arrangement:'ordered',order:'asc'}];
  return validateProject(project);
}
const baseline=project=>validateProject({...project,...autoArrange(project)}),projects=['worse','no-improvement','cancel','stale','context','failure-improved','invalid-response'].map(id=>oversized(id));
projects.push(baseline(oversized('already-minimal')),baseline(oversized('failure-minimal')),baseline(oversized('target')),oversized('issue',{parked:true}),oversized('export-issue',{parked:true}));
for(const project of projects)assert.deepEqual(validateLayout(project).filter(issue=>issue.type!=='outside'),[]);
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify(projects));localStorage.setItem('suplik-studio-current','"worse"');
const created=[];
class ControlledWorker{
  constructor(url){if(String(url).endsWith('/manufacturing-worker.js'))return new ManufacturingWorker(url);this.url=String(url);this.terminated=false;created.push(this);}
  postMessage(message){this.request=copy(message);}
  terminate(){this.terminated=true;}
  reply(result,handler=this.onmessage){assert.ok(this.request);handler?.({data:{type:'result',id:this.request.id,result:copy(result)}});}
  fail(message='Test optimizer failed'){this.onmessage?.({data:{type:'error',id:this.request.id,name:'Error',message}});}
}
globalThis.Worker=ControlledWorker;
await import('../dist/app.js');
const $=selector=>win.document.querySelector(selector),click=selector=>{const el=typeof selector==='string'?$(selector):selector;assert.ok(el,'Missing '+selector);el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));},action=name=>click(`#app [data-action="${name}"]`);
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(project=>project.id===JSON.parse(localStorage.getItem('suplik-studio-current'))),state=()=>logical(saved()),history=()=>[$('#app [data-action="undo"]').disabled,$('#app [data-action="redo"]').disabled];
const tick=()=>new Promise(resolve=>nativeTimeout(resolve,0));
async function waitFor(predicate){const start=performance.now();while(!predicate()){if(performance.now()-start>5000)assert.fail('UI did not finish: '+$('#modal-root').textContent);await tick();}}
function close(){if($('[data-smart-cancel]'))click('[data-smart-cancel]');else if($('[data-smart-close]'))click('[data-smart-close]');else if($('[data-modal-close]'))click('[data-modal-close]');}
function open(id){close();action('projects');click(`[data-open="${id}"]`);}
async function start(trigger=()=>action('smart-layout')){const count=created.length,before=state(),undo=history(),stored=localStorage.getItem('suplik-studio-projects-v1');trigger();click('[data-smart-default]');assert.ok($('[data-smart-cancel]'),'one layout pipeline opens cancellable progress');await waitFor(()=>created.length===count+1&&created.at(-1).request);const worker=created.at(-1);assert.deepEqual(logical(worker.request.project),logical(baseline(before)),'the optimizer receives the real checked Auto baseline');assert.deepEqual(state(),before,'the Auto baseline is provisional while Smart is running');assert.equal(localStorage.getItem('suplik-studio-projects-v1'),stored,'starting layout does not persist even a timestamp');assert.deepEqual(history(),undo);return{worker,before,undo,stored};}
const area=project=>project.modules.reduce((sum,module)=>sum+(module.width-.5)*(module.height-.5),0);
function resultFor(project){const placed=new Set(project.modules.filter(module=>module.x>=0&&module.y>=0&&module.x+module.width<=project.width&&module.y+module.height<=project.height).map(module=>module.id));return{tools:copy(project.tools),modules:copy(project.modules),unplaced:project.tools.filter(tool=>!placed.has(tool.moduleId)).map(tool=>tool.id),stats:{changed:false,beforeArea:area(project),afterArea:area(project),savedPercent:0,beforeModules:project.modules.length,afterModules:project.modules.length,sharedModules:0,resizedModules:[]}};}
function assertPreserved(before,after){
  assert.equal(after.grid,42);for(const original of before.tools){const tool=after.tools.find(tool=>tool.id===original.id);for(const key of ['points','fingerGrips','depth','nominalSize','name','unit'])assert.deepEqual(tool[key],original[key],`${original.id}: ${key}`);}
  for(const id of ['locked','blank']){assert.deepEqual(after.modules.find(module=>module.id===id),before.modules.find(module=>module.id===id));for(const tool of before.tools.filter(tool=>tool.moduleId===id))assert.deepEqual(after.tools.find(item=>item.id===tool.id),tool);}
  const manual=after.modules.find(module=>module.id==='manual');assert.deepEqual([manual.width,manual.height,manual.sizeMode,manual.unit],[84,84,'manual','in']);assert.deepEqual(validateLayout(after),[]);
}
function assertSmallCells(project){for(const tool of project.tools.filter(tool=>tool.id.startsWith('socket-'))){const module=project.modules.find(module=>module.id===tool.moduleId),pocket=pocketOutline(tool,project.clearance),width=Math.max(...pocket.map(point=>point.x))-Math.min(...pocket.map(point=>point.x)),height=Math.max(...pocket.map(point=>point.y))-Math.min(...pocket.map(point=>point.y)),padding=2*project.wall+.5;assert.equal(module.width,Math.ceil((width+padding-1e-7)/42)*42);assert.equal(module.height,Math.ceil((height+padding-1e-7)/42)*42);}}
after(async()=>{delete globalThis.Worker;await Promise.all([...manufacturingWorkers].map(worker=>worker.terminate()));return win.happyDOM.abort();});

test('the toolbar exposes one primary layout action without a separate Auto choice',()=>{
  const buttons=[...win.document.querySelectorAll('.board-toolbar [data-action="smart-layout"]')];assert.equal(buttons.length,1);assert.equal(buttons[0].textContent.trim(),'Rozložit nástroje');assert.equal($('.board-toolbar [data-action="auto"]'),null);
});

test('a worse Smart response retains actual Auto minima and the entire combined layout is one undo step',async()=>{
  open('worse');const {worker,before}=await start(),expected=logical(baseline(before));worker.reply(resultFor(before));await waitFor(()=>$('[data-smart-close]'));const after=state();assert.deepEqual(after,expected);assertSmallCells(after);assertPreserved(before,after);assert.ok(worker.terminated);click('[data-smart-close]');action('undo');assert.deepEqual(state(),before);assert.equal(history()[0],true,'one undo restores all original oversized cells');
});

test('no extra Smart improvement still commits a useful Auto baseline, while an already minimal drawer stays unchanged',async()=>{
  open('no-improvement');let run=await start(),expected=logical(baseline(run.before));run.worker.reply(resultFor(expected));await waitFor(()=>$('[data-smart-close]'));assert.deepEqual(state(),expected);assertSmallCells(state());assertPreserved(run.before,state());click('[data-smart-close]');action('undo');assert.deepEqual(state(),run.before);assert.equal(history()[0],true);
  open('already-minimal');run=await start();const worse=oversized('already-minimal');run.worker.reply(resultFor(worse));await waitFor(()=>$('[data-smart-close]'));assert.deepEqual(state(),run.before);assert.deepEqual(history(),run.undo);assertSmallCells(state());click('[data-smart-close]');
});

test('cancellation discards the provisional Auto baseline and ignores a queued Smart result',async()=>{
  open('cancel');const run=await start(),queued=run.worker.onmessage;click('[data-smart-cancel]');assert.ok(run.worker.terminated);run.worker.reply(resultFor(baseline(run.before)),queued);await tick();await tick();assert.deepEqual(state(),run.before);assert.equal(localStorage.getItem('suplik-studio-projects-v1'),run.stored);assert.deepEqual(history(),run.undo);assert.equal($('.modal'),null);
});

test('optimizer failure or an invalid response can keep useful Auto progress without ever changing tool contours',async()=>{
  for(const id of ['failure-improved','invalid-response']){open(id);const run=await start(),expected=logical(baseline(run.before));if(id==='failure-improved')run.worker.fail();else{const corrupt=copy(expected);corrupt.tools[0].points[0].x+=1;run.worker.reply(resultFor(corrupt));}await waitFor(()=>$('[data-smart-close]'));assert.deepEqual(state(),expected);assertSmallCells(state());assertPreserved(run.before,state());click('[data-smart-close]');action('undo');assert.deepEqual(state(),run.before);assert.equal(history()[0],true);}
  open('failure-minimal');const run=await start();run.worker.fail();await waitFor(()=>$('[data-smart-close]'));assert.deepEqual(state(),run.before);assert.equal(localStorage.getItem('suplik-studio-projects-v1'),run.stored);assert.deepEqual(history(),run.undo);click('[data-smart-close]');
});

test('switching drawers while layout is pending ignores both its baseline and a stale queued result',async()=>{
  open('stale');const run=await start(),queued=run.worker.onmessage;action('projects');click('[data-open="target"]');const target=state(),undo=history();run.worker.reply(resultFor(baseline(run.before)),queued);await tick();await tick();assert.deepEqual(state(),target);assert.deepEqual(history(),undo);const original=JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(project=>project.id==='stale');assert.deepEqual(logical(original),run.before);
});

test('issue-list, background context and export-repack entries all start the same provisional Auto-plus-Smart pipeline',async()=>{
  open('issue');const issueButton=[...win.document.querySelectorAll('.workspace-col .issue-box [data-action]')].find(button=>/Rozložit|Přepočítat/.test(button.textContent));assert.ok(issueButton);let run=await start(()=>click(issueButton));run.worker.reply(resultFor(baseline(run.before)));await waitFor(()=>$('[data-smart-close]'));assertSmallCells(state());assertPreserved(run.before,state());click('[data-smart-close]');action('undo');assert.deepEqual(state(),run.before);
  open('context');$('#board-svg').dispatchEvent(new win.MouseEvent('contextmenu',{button:2,buttons:0,clientX:400,clientY:300,bubbles:true,cancelable:true}));const entry=$('[data-context-action="smart-layout"]');assert.ok(entry);assert.equal(entry.textContent.trim(),'Rozložit nástroje');run=await start(()=>click(entry));run.worker.reply(resultFor(baseline(run.before)));await waitFor(()=>$('[data-smart-close]'));assertSmallCells(state());assertPreserved(run.before,state());click('[data-smart-close]');action('undo');assert.deepEqual(state(),run.before);
  open('export-issue');action('export');await waitFor(()=>$('[data-export-analysis]')?.getAttribute('aria-busy')!=='true');const repack=$('.modal [data-repack]');assert.ok(repack);run=await start(()=>click(repack));run.worker.reply(resultFor(baseline(run.before)));await waitFor(()=>$('[data-smart-close]'));assertSmallCells(state());assertPreserved(run.before,state());click('[data-smart-close]');action('undo');assert.deepEqual(state(),run.before);
});
