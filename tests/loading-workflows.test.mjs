import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject,validateProject} from '../dist/model.js';

const win=new Window({url:'http://localhost:5173'});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
Object.defineProperty(win.navigator,'hardwareConcurrency',{value:4,configurable:true});
win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(fn,ms,...args)=>{const timer=nativeTimeout(fn,ms,...args);if(ms>=4000)timer.unref?.();return timer;};
globalThis.requestAnimationFrame=fn=>nativeTimeout(()=>fn(performance.now()),10);globalThis.cancelAnimationFrame=clearTimeout;
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
const gl=new Proxy({},{get:(_,name)=>name==='getShaderParameter'||name==='getProgramParameter'?()=>true:typeof name==='string'&&/^[A-Z0-9_]+$/.test(name)?1:()=>({})});
win.HTMLCanvasElement.prototype.getContext=function(type){return type==='webgl2'?gl:null;};

const points=[{x:0,y:0},{x:20,y:0},{x:20,y:40},{x:0,y:40}];
function fixture(id,count=2){
  return validateProject({...blankProject(),id,name:id,width:252,height:168,printMode:'solid',connectors:false,sizeLabels:false,
    modules:Array.from({length:count},(_,i)=>({id:id+'-m'+i,name:'Modul '+(i+1),x:i*84,y:0,width:84,height:84,sizeMode:'manual'})),
    tools:Array.from({length:count},(_,i)=>({id:id+'-t'+i,name:'Nástroj '+(i+1),moduleId:id+'-m'+i,points,x:i*84+20,y:20,rotation:0,depth:8,fingerGrips:[]}))});
}
const projects=['preview','preview-error','smart','export','export-cancel','export-error','analysis-error','import','library'].map(id=>fixture(id));
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify(projects));localStorage.setItem('suplik-studio-current','"preview"');
localStorage.setItem('suplik-studio-library-v1',JSON.stringify([{...projects[0].tools[0],id:'library-tool',name:'Uložený nástroj',moduleId:null,x:0,y:0}]));

// Hold work at the real worker transport boundary so UI state and cancellation
// can be observed independently of a machine's geometry-computation speed.
const jobs=[];
class ControlledWorker{
  constructor(url){this.url=String(url);this.terminated=false;}
  postMessage(message){
    const handler=this.onmessage,job={worker:this,message:structuredClone(message)};jobs.push(job);
    job.reply=result=>handler?.({data:{type:'result',id:message.id,result}});
    job.progress=event=>handler?.({data:{type:'progress',id:message.id,event}});
    job.fail=text=>handler?.({data:this.url.endsWith('/mesh-worker.js')?{id:message.id,error:{message:text}}:{type:'error',id:message.id,name:'Error',message:text}});
  }
  terminate(){this.terminated=true;}
}
globalThis.Worker=win.Worker=ControlledWorker;
const downloads=[];URL.createObjectURL=()=> 'blob:http://localhost/loading-workflows';URL.revokeObjectURL=()=>{};
win.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push(this.download);};
await import('../dist/app.js');
const $=selector=>document.querySelector(selector);
const click=selector=>{const el=typeof selector==='string'?$(selector):selector;assert.ok(el,'Missing '+selector);el.click();};
const action=name=>click(`#app [data-action="${name}"]`);
const pause=(ms=5)=>new Promise(resolve=>nativeTimeout(resolve,ms));
async function until(fn,message){const start=performance.now();while(!fn()){if(performance.now()-start>5000)assert.fail(message+'; '+$('#modal-root').textContent);await pause();}}
const store=()=>localStorage.getItem('suplik-studio-projects-v1');
const saved=()=>JSON.parse(store()).find(project=>project.id===JSON.parse(localStorage.getItem('suplik-studio-current')));
const operations=operation=>jobs.filter(job=>job.message.operation===operation);
const meshJobs=id=>jobs.filter(job=>job.worker.url.endsWith('/mesh-worker.js')&&job.message.type==='mesh'&&job.message.project.id===id);
const mesh=()=>({vertices:new Float32Array(18),ranges:[{zone:'body',first:0,count:3}],facets:1,parts:1,joints:0,unjoined:0});
const analysis=()=>({issues:[],stats:{volumeMm3:12000,volumeCm3:12,solidVolumeMm3:12000,savingPercent:0,heightMm:20,effectiveBaseMm:2.4,footHeightMm:0,printMode:'solid',bottomMode:'plain',triangles:12,notes:[]},printError:'',bedError:'',labels:{count:0,skipped:[]},joints:null,jointError:''});
function close(){if($('[data-modal-close]'))click('[data-modal-close]');}
function open(id){close();action('2d');action('projects');click(`[data-open="${id}"]`);}
function status(container){
  assert.ok(container,'the loading region must be present');
  const node=container.matches('[data-loading-ui]')?container:container.querySelector('[data-loading-ui]');assert.ok(node,'a shared loading status must be present');
  assert.equal(node.getAttribute('role'),'status');assert.equal(node.getAttribute('aria-busy'),null);assert.ok(node.querySelector('.loading-ui__indicator'));
  assert.ok(node.querySelector('progress')?.getAttribute('aria-label'),'progress must have an accessible label');return node;
}
function indeterminate(node){assert.equal(node.querySelector('progress').hasAttribute('value'),false);assert.equal(node.querySelector('[data-loading-percent]').hidden,true);}
async function pendingExport(id){
  open(id);const count=operations('analyze').length;action('export');
  const region=$('[data-export-analysis]'),loader=status(region);indeterminate(loader);
  await until(()=>operations('analyze').length>count,'manufacturing analysis did not start');
  return {job:operations('analyze').at(-1),region,loader};
}
async function exporting(id){
  const {job}=await pendingExport(id);job.reply(analysis());await until(()=>!$('[data-do-export]').disabled,'analysis did not release export');
  const count=operations('export').length;click('[data-do-export]');
  const loader=status($('.modal-body'));indeterminate(loader);
  await until(()=>operations('export').length>count,'file preparation did not start');
  return {job:operations('export').at(-1),loader,bar:$('[data-print-batch-progress]'),message:$('[data-print-batch-status]')};
}
after(()=>{close();win.happyDOM.abort();});

test('3D loading preserves its animated UI and count progress until the complete model is ready',async()=>{
  action('3d');const notice=$('[data-preview-state]'),loader=status(notice),bar=loader.querySelector('progress');
  assert.equal(bar.max,2);assert.equal(bar.value,0);assert.equal($('#board-svg').getAttribute('aria-hidden'),'true');
  await until(()=>meshJobs('preview').length===2,'both mesh calculations should start');
  meshJobs('preview')[0].reply(mesh());await until(()=>bar.value===1,'completed module should advance the count');
  assert.equal(notice.querySelector('[data-loading-ui]'),loader);assert.equal(loader.querySelector('progress'),bar);
  assert.equal($('#board-svg').getAttribute('aria-hidden'),'true','a partial model stays covered');
  meshJobs('preview')[1].reply(mesh());await until(()=>$('[data-preview-state]').hidden,'all completed modules should reveal the model');
  assert.equal($('[data-preview-state] [data-loading-ui]'),null);assert.equal($('#board-area').getAttribute('data-preview-busy'),'false');
  open('preview-error');action('3d');await until(()=>meshJobs('preview-error').length===2,'error fixture meshes');
  meshJobs('preview-error')[0].fail('Ověřená chyba modelu');meshJobs('preview-error')[1].reply(mesh());
  await until(()=>$('[data-preview-state]')?.getAttribute('data-preview-busy')==='false','failed preview must settle');
  assert.equal($('[data-preview-state] [data-loading-ui]'),null);assert.match($('[data-preview-state]').textContent,/Ověřená chyba modelu/);assert.ok($('[data-action="retry-preview"]'));
  action('2d');
});

test('smart layout switches from indeterminate to actual worker progress and ignores updates after cancellation',async()=>{
  open('smart');const before=store(),count=jobs.length;action('smart-layout');click('[data-smart-choice="space"]');
  const loader=status($('.modal-body')),bar=$('[data-smart-progress]'),message=$('[data-smart-message]');indeterminate(loader);
  await until(()=>jobs.slice(count).some(job=>job.worker.url.endsWith('/smart-layout-worker.js')),'smart worker should start');
  const job=jobs.slice(count).find(job=>job.worker.url.endsWith('/smart-layout-worker.js'));
  job.progress({message:'Kontroluji skutečné kapsy…'});assert.equal(bar.hasAttribute('value'),false);
  job.progress({progress:.375,message:'Porovnávám bezpečné varianty…'});
  assert.equal($('.modal-body [data-loading-ui]'),loader);assert.equal($('[data-smart-progress]'),bar);assert.equal($('[data-smart-message]'),message);
  assert.equal(bar.value,.375);assert.match($('[data-smart-percent]').textContent,/38/);assert.match(message.textContent,/bezpečné varianty/);
  click('[data-smart-cancel]');assert.equal(job.worker.terminated,true);job.progress({progress:.9,message:'Zastaralá zpráva'});job.reply({tools:job.message.project.tools,modules:job.message.project.modules,unplaced:[]});await pause(20);
  assert.equal($('.modal'),null);assert.equal(store(),before);assert.equal($('[data-loading-ui]'),null);
});

test('file preparation keeps one status through planning, measured cuts and ZIP packaging',async()=>{
  const {job,loader,bar,message}=await exporting('export');
  job.progress({stage:'planning'});indeterminate(loader);assert.match(message.textContent,/Plánuji tiskové díly/);
  job.progress({stage:'cutting',completed:1,total:4,moduleId:'export-m0'});
  assert.equal(bar.value,1);assert.equal(bar.max,4);assert.match(message.textContent,/Vytvářím geometrii/);assert.match(loader.textContent,/Modul 1/);assert.match(loader.textContent,/1.*4/);assert.equal($('.modal-body [data-loading-ui]'),loader);
  assert.equal($('[data-print-batch-progress]'),bar);assert.equal($('[data-print-batch-status]'),message);
  job.progress({stage:'packaging',files:12});indeterminate(loader);assert.match(message.textContent,/Baluji.*ZIPu/);assert.match(loader.textContent,/12/);
  job.progress({stage:'packaged',progress:1,files:12});assert.equal(bar.value/bar.max,1);assert.match(message.textContent,/připravený ke stažení/);assert.equal(loader.querySelector('[data-loading-percent]').hidden,false);
  const count=downloads.length;job.reply({zip:new Uint8Array([80,75]),files:[]});await until(()=>downloads.length>count,'a completed ZIP should download');
  assert.equal($('.modal'),null);assert.equal($('[data-loading-ui]'),null);
});

test('file cancellation and errors remove the loader and discard queued progress and downloads',async()=>{
  let current=await exporting('export-cancel');const before=store(),count=downloads.length;
  click('[data-print-batch-cancel]');assert.equal(current.job.worker.terminated,true);
  current.job.progress({stage:'cutting',completed:4,total:4});current.job.reply({zip:new Uint8Array([80,75]),files:[]});await pause(20);
  assert.equal($('.modal'),null);assert.equal(downloads.length,count);assert.equal(store(),before);
  current=await exporting('export-error');current.job.fail('Ověřená chyba exportu');
  await until(()=>$('.modal [role="alert"]'),'export failure should replace the pending state');
  assert.equal($('.modal [data-loading-ui]'),null);assert.match($('.modal [role="alert"]').textContent,/Ověřená chyba exportu/);
  current.job.progress({stage:'packaged',progress:1,files:12});assert.equal($('.modal [data-loading-ui]'),null);assert.ok($('[data-print-batch-close]'));close();
});

test('background analysis clears its compact status on failure and can retry without a stuck loader',async()=>{
  const {job,loader,region}=await pendingExport('analysis-error');assert.equal(region.contains(loader),true);
  job.fail('Ověřená chyba analýzy');await until(()=>region.getAttribute('data-analysis-busy')==='false','analysis failure should settle');
  assert.equal(region.querySelector('[data-loading-ui]'),null);assert.match(region.textContent,/Ověřená chyba analýzy/);
  const count=operations('analyze').length;click(region.querySelector('button'));indeterminate(status(region));
  await until(()=>operations('analyze').length>count,'analysis retry should start');const retry=operations('analyze').at(-1);retry.reply(analysis());
  await until(()=>region.getAttribute('data-analysis-busy')==='false','analysis retry should complete');assert.equal(region.querySelector('[data-loading-ui]'),null);
  assert.equal($('[data-do-export]').disabled,false);close();
});

test('project import shows its work before reading and ignores a cancelled file',async()=>{
  open('import');let read,started=false;const before=store(),input=$('#project-file');
  const file=new win.File(['pending'],'drawer.json',{type:'application/json'});file.text=()=>{started=true;return new Promise(resolve=>read=resolve);};
  Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new win.Event('change'));
  const region=$('[data-project-import-progress]');assert.ok(region);indeterminate(status(region));assert.equal(started,false,'the import UI must paint before file processing');
  await until(()=>read,'the project file should be read');close();read(JSON.stringify(fixture('cancelled-import')));await pause(30);
  assert.equal(store(),before);assert.equal(saved().id,'import');assert.equal($('.modal'),null);assert.equal($('[data-loading-ui]'),null);
});

test('project import removes loading on an invalid JSON and opens a valid project on retry',async()=>{
  open('import');const before=store(),input=$('#project-file');
  const submit=text=>{Object.defineProperty(input,'files',{configurable:true,value:[new win.File([text],'drawer.json',{type:'application/json'})]});input.dispatchEvent(new win.Event('change'));};
  submit('{');assert.ok($('[data-project-import-progress]'));
  await until(()=>$('.modal [role="alert"]'),'invalid JSON must finish with an error');
  assert.equal($('.modal [data-loading-ui]'),null);assert.match($('.modal [role="alert"]').textContent,/Projekt nelze otevřít/);assert.equal(store(),before);close();
  const imported=fixture('valid-import');submit(JSON.stringify(imported));
  await until(()=>saved().name==='valid-import','valid JSON must open its project');
  assert.notEqual(saved().id,imported.id,'an imported project must receive its own local identity');
  assert.equal($('.modal'),null);assert.equal($('[data-loading-ui]'),null);assert.deepEqual(saved().tools,imported.tools);
});

test('adding an owned library contour acknowledges work before insertion and closes after completion',async()=>{
  open('library');const before=saved().tools.length;action('library');
  const mine=$('[data-library-folder="mine"]');assert.ok(mine);if(mine.getAttribute('aria-selected')!=='true')click(mine);
  click('[data-library-add="0"]');const operation=$('[data-library-operation]');assert.ok(operation);indeterminate(status(operation));
  assert.equal(saved().tools.length,before,'the operation must yield before inserting the contour');
  await until(()=>saved().tools.length===before+1,'the library contour should be inserted');assert.equal($('.modal'),null);
});

test('closing an owned-library operation before its first paint cancels insertion',async()=>{
  open('library');const before=store();action('library');
  const mine=$('[data-library-folder="mine"]');if(mine.getAttribute('aria-selected')!=='true')click(mine);
  click('[data-library-add="0"]');assert.ok($('[data-library-operation]'));close();await pause(60);
  assert.equal(store(),before);assert.equal($('.modal'),null);assert.equal($('[data-loading-ui]'),null);
});
