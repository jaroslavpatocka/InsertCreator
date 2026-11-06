import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject,validateProject} from '../dist/model.js';
import {catalogItems} from '../dist/catalog/index.js';
import {catalogTool} from '../dist/catalog-ui.js';
import {bounds,zipFiles} from '../dist/geometry.js';

const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(fn,ms,...args)=>{const timer=nativeTimeout(fn,ms,...args);if(ms>=4000)timer.unref?.();return timer;};
globalThis.requestAnimationFrame=fn=>nativeTimeout(()=>fn(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');

const catalogue=catalogItems().map(catalogTool).filter(tool=>{const b=bounds(tool);return b.width<80&&b.height<80;});
function fixture(id){
  const modules=[],tools=[];
  for(let i=0;i<95;i++){
    const source=structuredClone(catalogue[i%catalogue.length]),box=bounds(source),x=(i%10)*126,y=Math.floor(i/10)*126;
    modules.push({id:'m'+i,name:'Modul '+i,x,y,width:126,height:126,sizeMode:'manual',locked:true});
    tools.push({...source,id:'t'+i,moduleId:'m'+i,x:x+(126-box.width)/2,y:y+(126-box.height)/2,rotation:0,depth:8,fingerGrips:[]});
  }
  // Real catalogue contours model a large drawer, while controlled worker replies
  // let us hold CPU work indefinitely and exercise the interactive UI boundary.
  if(id==='scope-subset')tools.at(-1).depth=99;
  const base=2.4+['shell','coalesce','stale','close','invalid','export-cancel','switch','worker-error','close-timer','bfcache','connectors-race','format-stats','scope-subset'].indexOf(id)/10;
  return validateProject({...blankProject(),id,name:id,width:1260,height:1260,base,modules,tools,printMode:'light',connectors:true,sizeLabels:false,bedWidth:256,bedHeight:220});
}
const projects=['shell','coalesce','stale','close','invalid','export-cancel','switch','worker-error','close-timer','bfcache','connectors-race','format-stats','scope-subset'].map(fixture);
projects.push(validateProject({...blankProject(),id:'target',name:'Target'}));
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify(projects));localStorage.setItem('suplik-studio-current','"shell"');

const jobs=[],workers=[];
class ControlledWorker{
  constructor(url){this.url=String(url);this.listeners=new Map();this.terminated=false;workers.push(this);}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  postMessage(message){
    const handlers=[this.onmessage,...(this.listeners.get('message')||[])].filter(Boolean);
    const job={worker:this,message:structuredClone(message),modalAtPost:!!document.querySelector('.modal'),handlers};jobs.push(job);
    job.reply=result=>{for(const handler of handlers)handler({data:{type:'result',id:message.id,result}});};
    job.progress=event=>{for(const handler of handlers)handler({data:{type:'progress',id:message.id,event}});};
    job.fail=errorMessage=>{for(const handler of handlers)handler({data:{type:'error',id:message.id,name:'Error',message:errorMessage}});};
  }
  terminate(){this.terminated=true;}
}
globalThis.Worker=ControlledWorker;win.Worker=ControlledWorker;
const downloads=[],blobs=new Map();
URL.createObjectURL=blob=>{const id='blob:http://localhost/responsive-export-'+blobs.size;blobs.set(id,blob);return id;};URL.revokeObjectURL=()=>{};
win.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push({name:this.download,blob:blobs.get(this.href)});};
await import('../dist/app.js');

const $=selector=>document.querySelector(selector);
const click=selector=>{const el=typeof selector==='string'?$(selector):selector;assert.ok(el,'Missing '+selector);el.click();};
const action=name=>click(`#app [data-action="${name}"]`);
const pause=ms=>new Promise(resolve=>nativeTimeout(resolve,ms));
const analyses=()=>jobs.filter(job=>job.message.operation==='analyze'&&job.modalAtPost);
const exports=()=>jobs.filter(job=>job.message.operation==='export');
const store=()=>localStorage.getItem('suplik-studio-projects-v1');
const saved=()=>JSON.parse(store()).find(project=>project.id===JSON.parse(localStorage.getItem('suplik-studio-current')));
async function waitFor(predicate,message){const start=performance.now();while(!predicate()){if(performance.now()-start>5000)assert.fail(message+'; modal='+$('#modal-root').textContent);await pause(5);}}
function close(){if($('[data-print-batch-cancel]'))click('[data-print-batch-cancel]');else if($('[data-modal-close]'))click('[data-modal-close]');}
function open(id){close();action('projects');click(`[data-open="${id}"]`);action('export');if($('[data-format="stl"]'))click('[data-format="stl"]');}
function change(selector,value){const el=$(selector);assert.ok(el,selector);if(el.type==='checkbox')el.checked=Boolean(value);else el.value=String(value);el.dispatchEvent(new win.Event('change',{bubbles:true}));}
const analysis=(volume=12)=>({issues:[],stats:{volumeMm3:volume*1000,volumeCm3:volume,solidVolumeMm3:volume*1000,savingPercent:0,heightMm:20,effectiveBaseMm:2.4,footHeightMm:0,printMode:'light',bottomMode:'plain',triangles:1000,notes:[]},printError:'',bedError:'',labels:{count:0,skipped:[]},joints:{count:12,cutCount:0,moduleCount:12,skipped:0,unjoined:[],unsupported:false},jointError:''});
const completedExport=()=>({zip:zipFiles([{name:'assembly.json',data:'{}'}]),fileCount:1,parts:[],manifest:{joints:{unjoined:[]}},joints:0});
async function openPending(id){const count=analyses().length;open(id);await waitFor(()=>analyses().length>count,'a background analysis must start');return analyses().at(-1);}
async function finish(job,result=analysis()){job.reply(result);await waitFor(()=>$('[data-export-analysis]')?.getAttribute('data-analysis-busy')!=='true','analysis must finish');}
after(()=>{close();win.happyDOM.abort();});

test('a 95-tool export opens a live loading shell before background manufacturing work starts',async()=>{
  const before=store(),count=analyses().length;action('export');
  assert.ok($('.modal'),'the form must be present immediately');
  const status=$('[data-export-analysis]');assert.ok(status,'the export has a persistent status region');
  assert.equal(status.querySelector('[data-loading-ui]').getAttribute('role'),'status');assert.equal(status.getAttribute('role'),null);assert.equal(status.getAttribute('data-analysis-busy'),'true');
  let heartbeat=false;nativeTimeout(()=>heartbeat=true,0);await pause(20);
  assert.equal(heartbeat,true,'the event loop remains available while the job is pending');
  await waitFor(()=>analyses().length>count,'worker analysis did not start');
  const job=analyses().at(-1);assert.equal(job.modalAtPost,true);assert.equal(job.message.project.tools.length,95);
  assert.equal($('#export-scope').disabled,false,'selection controls stay usable while analysis is pending');
  await finish(job);assert.equal(store(),before,'viewing manufacturing analysis cannot edit the drawer');close();
});

test('rapid printer values coalesce to the latest snapshot and do not rebuild the editor under the modal',async()=>{
  const count=analyses().length;open('coalesce');const board=$('#board-svg');
  change('.modal [data-field="bedWidth"]',280);change('.modal [data-field="bedWidth"]',300);change('.modal [data-field="bedWidth"]',320);
  assert.equal($('#board-svg'),board,'printer controls must not rebuild a hidden 2D/3D editor');
  await waitFor(()=>analyses().length>count,'latest analysis did not start');await pause(130);
  const next=analyses().slice(count);assert.equal(next.length,1,'intermediate input snapshots are never calculated');
  assert.equal(next[0].message.project.bedWidth,320);assert.equal(saved().bedWidth,320);await finish(next[0]);close();
});

test('a superseded worker is terminated and its late result cannot replace the new analysis',async()=>{
  const old=await openPending('stale'),count=analyses().length;
  change('.modal [data-field="bedWidth"]',280);
  await waitFor(()=>analyses().length>count,'replacement analysis did not start');const latest=analyses().at(-1);
  assert.equal(old.worker.terminated,true,'cancel must stop CPU work rather than only hide a result');
  await finish(latest,analysis(321));old.reply(analysis(999));await pause(20);
  assert.equal($('[data-do-export]').disabled,false);assert.doesNotMatch($('.modal').textContent,/999/);assert.equal($('.modal .print-summary'),null,'statistics belong beside the main 3D preview');
  assert.equal(Number($('.modal [data-field="bedWidth"]').value),280);close();
});

test('closing the form cancels an active worker and ignores an already queued result',async()=>{
  const job=await openPending('close'),before=store(),count=downloads.length;close();
  assert.equal(job.worker.terminated,true);job.reply(analysis(999));await pause(120);
  assert.equal($('.modal'),null);assert.equal(downloads.length,count);assert.equal(store(),before);
});

test('closing before the debounce expires never starts an orphaned analysis',async()=>{
  const count=analyses().length;open('close-timer');assert.ok($('[data-export-analysis]'));close();await pause(180);
  assert.equal(analyses().length,count);assert.equal($('.modal'),null);
});

test('invalid printer input does not schedule geometry or mutate the stored project',async()=>{
  const job=await openPending('invalid');await finish(job);const count=analyses().length,before=store();
  change('.modal [data-field="bedWidth"]',1);await pause(180);
  assert.equal(analyses().length,count);assert.equal(store(),before);assert.match($('#toast').textContent,/Zadejte|hodnotu/);close();
});

test('a worker failure leaves the form usable and a corrected request can finish',async()=>{
  const job=await openPending('worker-error');job.fail('Kontrolní chyba výpočtu');
  await waitFor(()=>$('[data-export-analysis]')?.getAttribute('data-analysis-busy')!=='true','a failed job must not leave a permanent loading state');
  assert.match($('.modal').textContent,/Kontrolní chyba výpočtu/);assert.equal($('.modal [data-field="bedWidth"]').disabled,false);
  const count=analyses().length;change('.modal [data-field="bedWidth"]',310);
  await waitFor(()=>analyses().length>count,'editing after a failure must allow a new job');await finish(analyses().at(-1));close();
});

test('returning from the browser page cache can start a fresh calculation after cancelling old work',async()=>{
  const old=await openPending('bfcache');win.dispatchEvent(new win.Event('pagehide'));
  assert.equal(old.worker.terminated,true);close();
  const restored=new win.Event('pageshow');Object.defineProperty(restored,'persisted',{value:true});win.dispatchEvent(restored);
  const count=analyses().length;action('export');await waitFor(()=>analyses().length>count,'a restored page must not retain permanently disposed clients');
  await finish(analyses().at(-1));old.reply(analysis(999));assert.doesNotMatch($('.modal').textContent,/999/);close();
});

test('changing puzzle connectors in main settings prevents export until the rearrangement has completed',async()=>{
  const count=analyses().length,requests=jobs.length;open('connectors-race');assert.equal($('.modal #export-connectors'),null);click('[data-model-settings]');change('#export-connectors',false);
  await waitFor(()=>jobs.slice(requests).some(job=>job.message.operation==='connectors'),'connector preparation must run in the background');
  const rearranging=jobs.slice(requests).find(job=>job.message.operation==='connectors');await pause(160);
  assert.equal(analyses().length,count,'the old 90 ms analysis timer must not run during connector preparation');
  assert.equal($('.modal'),null);assert.equal($('#manufacturing-settings fieldset').disabled,true);action('export');assert.equal($('.modal'),null,'export cannot open while connector geometry is changing');
  const next=structuredClone(rearranging.message.project);next.connectors=false;rearranging.reply({fits:true,project:next});
  await waitFor(()=>!$('#manufacturing-settings fieldset').disabled,'connector preparation should release main settings');action('export');await waitFor(()=>analyses().length>count,'the final geometry must receive a new analysis');const latest=analyses().at(-1);
  assert.equal(latest.message.project.connectors,false);await finish(latest,{...analysis(),joints:null});close();
});

test('a cached STL statistics error cannot disable valid SVG or DXF manufacturing exports',async()=>{
  const first=await openPending('format-stats');await finish(first,{...analysis(),stats:null,printError:'Kontrolní chyba geometrie STL'});
  assert.match($('.modal').textContent,/Kontrolní chyba geometrie STL/);
  for(const format of ['svg','dxf']){
    const count=analyses().length;click(`[data-format="${format}"]`);
    await waitFor(()=>analyses().length>count,format+' must receive its own analysis instead of the failed STL cache entry');
    const next=analyses().at(-1);assert.equal(next.message.options.stats,false,'2D formats must not request expensive STL statistics');
    await finish(next,{...analysis(),stats:null,joints:null,printError:''});
    assert.equal($('[data-do-export]').disabled,false,format+' remains downloadable');
    assert.doesNotMatch($('.modal').textContent,/Kontrolní chyba geometrie STL/);
  }
  close();
});

test('selected SVG analysis excludes invalid tools in other modules before posting work',async()=>{
  const count=analyses().length;open('scope-subset');assert.equal(saved().tools.at(-1).depth,99,'the unselected module is deliberately invalid');
  click('[data-format="svg"]');change('#export-scope','selected');
  await waitFor(()=>analyses().length>count,'selected SVG analysis must start');const job=analyses().at(-1);
  assert.deepEqual(job.message.project.modules.map(module=>module.id),['m0']);
  assert.deepEqual(job.message.project.tools.map(tool=>tool.id),['t0']);
  assert.equal(job.message.project.tools[0].depth,8);
  await finish(job,{...analysis(),stats:null,joints:null,printError:''});assert.equal($('[data-do-export]').disabled,false);close();
});

test('cancelling an in-flight manufacturing export prevents a late worker result from downloading',async()=>{
  const job=await openPending('export-cancel');await finish(job);const count=exports().length,before=store(),filesBefore=downloads.length;
  click('[data-do-export]');await waitFor(()=>exports().length>count,'export must run in the background');const exporting=exports().at(-1);
  assert.ok($('[data-print-batch-cancel]'));exporting.progress({stage:'cutting',progress:.25,completed:1,total:4});
  click('[data-print-batch-cancel]');assert.equal(exporting.worker.terminated,true);
  exporting.reply(completedExport());await pause(40);
  assert.equal(downloads.length,filesBefore);assert.equal(store(),before);assert.equal($('.modal'),null);
});

test('switching drawers while exporting discards every result from the old drawer',async()=>{
  const job=await openPending('switch');await finish(job);const count=exports().length,filesBefore=downloads.length;
  click('[data-do-export]');await waitFor(()=>exports().length>count,'export must start');const exporting=exports().at(-1);
  action('projects');click('[data-open="target"]');const before=store();
  assert.equal(exporting.worker.terminated,true);exporting.reply(completedExport());await pause(40);
  assert.equal(saved().id,'target');assert.equal(downloads.length,filesBefore);assert.equal(store(),before);
});
