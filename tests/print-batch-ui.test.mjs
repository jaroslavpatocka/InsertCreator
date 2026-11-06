import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject,validateProject} from '../dist/model.js';
import {exportSTL,validateLayout} from '../dist/geometry.js';
import {validatePrintMesh,trianglesVolume} from '../dist/print-geometry.js';

const win=new Window({url:'http://localhost:5173'}),html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
let holdFrames=false,nextFrame=-1;const heldFrames=new Map();
globalThis.requestAnimationFrame=callback=>{if(holdFrames){const id=nextFrame--;heldFrames.set(id,callback);return id;}return nativeTimeout(()=>callback(performance.now()),0);};
globalThis.cancelAnimationFrame=id=>{if(heldFrames.has(id))heldFrames.delete(id);else clearTimeout(id);};
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
const rectangle=(width,height)=>[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
function fixture(id,{long=false,invalid=false}={}){
  const project={...blankProject(),id,name:id,width:630,height:420,printMode:'solid',bedWidth:84,bedHeight:84,limitToBed:true,modules:[
    {id:'pair',name:'Pair',x:0,y:0,width:252,height:126,sizeMode:'manual',grouped:true,locked:false,setId:'pair-set',setLayout:'shared'},
    {id:'triple',name:'Triple',x:0,y:168,width:long?504:378,height:126,sizeMode:'manual',grouped:true,locked:false,setId:'triple-set',setLayout:'shared'},
    {id:'locked',name:'Locked untouched',x:546,y:0,width:84,height:84,sizeMode:'manual',locked:true,unit:'in'}
  ],tools:[],toolSets:[]};
  for(const [group,count,y] of [['pair',2,30],['triple',3,198]]){
    const ids=[];for(let index=0;index<count;index++){const id=`${group}-${index}`,width=long&&group==='triple'&&index===2?180:60;project.tools.push({id,name:`${group} tool ${index}`,points:rectangle(width,60),x:20+index*126,y,rotation:0,depth:invalid&&group==='triple'&&index===2?99:8+index,moduleId:group,fingerGrips:[],locked:false,unit:'mm',nominalSize:{value:10+index,unit:'mm'},sizeLabel:String(10+index)});ids.push(id);}project.toolSets.push({id:group+'-set',name:group,toolIds:ids,layout:'shared',arrangement:'ordered',order:'asc'});
  }
  project.tools.push({id:'locked-tool',name:'Locked tool',points:rectangle(60,60),x:558,y:12,rotation:0,depth:8,moduleId:'locked',fingerGrips:[],locked:true});
  return validateProject(project);
}
const projects=['selection','success','locked-only','cancel','stale'].map(id=>fixture(id));projects.push(fixture('long-tool',{long:true}),fixture('invalid-depth',{invalid:true}),validateProject({...blankProject(),id:'target',name:'Target'}));
for(const project of projects)assert.deepEqual(validateLayout(project).filter(issue=>issue.type!=='depth'),[]);
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify(projects));localStorage.setItem('suplik-studio-current','"selection"');
const blobs=new Map(),downloads=[];URL.createObjectURL=blob=>{const id='blob:http://localhost/print-batch-'+blobs.size;blobs.set(id,blob);return id;};URL.revokeObjectURL=()=>{};
win.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push({name:this.download,blob:blobs.get(this.href)});};
await import('../dist/app.js');
const $=selector=>win.document.querySelector(selector),all=selector=>[...win.document.querySelectorAll(selector)],click=selector=>{const element=typeof selector==='string'?$(selector):selector;assert.ok(element,'Missing '+selector);element.click();},action=name=>click(`#app [data-action="${name}"]`);
const store=()=>localStorage.getItem('suplik-studio-projects-v1'),saved=()=>JSON.parse(store()).find(project=>project.id===JSON.parse(localStorage.getItem('suplik-studio-current'))),history=()=>[$('#app [data-action="undo"]').disabled,$('#app [data-action="redo"]').disabled];
const tick=()=>new Promise(resolve=>nativeTimeout(resolve,0)),pause=ms=>new Promise(resolve=>nativeTimeout(resolve,ms));
async function waitFor(predicate){const started=performance.now();while(!predicate()){if(performance.now()-started>15000)assert.fail('UI did not finish: '+$('#modal-root').textContent+' '+$('#toast').textContent);await pause(2);}}
const selected=()=>all('.modal [data-export-module]:checked').map(element=>element.dataset.exportModule).sort();
function choose(ids){const wanted=new Set(ids),known=all('.modal [data-export-module]').map(box=>box.dataset.exportModule);for(const id of known){const box=$(`.modal [data-export-module="${id}"]`);if(box.checked!==wanted.has(id)){box.checked=wanted.has(id);box.dispatchEvent(new win.Event('change',{bubbles:true}));}}}
function change(selector,value){const element=$(selector);assert.ok(element,selector);element.value=String(value);element.dispatchEvent(new win.Event('change',{bubbles:true}));}
function close(){if($('[data-print-batch-cancel]'))click('[data-print-batch-cancel]');else if($('[data-modal-close]'))click('[data-modal-close]');}
const analysisReady=()=>waitFor(()=>$('[data-export-analysis]')?.getAttribute('data-analysis-busy')!=='true');
async function open(id){holdFrames=false;close();action('projects');click(`[data-open="${id}"]`);action('export');await analysisReady();assert.ok($('[data-do-export]'));assert.equal(all('.modal [data-export-module]').length,3);}
function assertReadOnly(before,undo){assert.equal(store(),before,'printing must not change even persisted timestamps, IDs, positions or contours');assert.deepEqual(history(),undo,'printing must not add or remove undo history');}
async function unzip(blob){const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),files=new Map();let offset=0;while(view.getUint32(offset,true)===0x04034b50){assert.equal(view.getUint16(offset+8,true),0);const length=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),start=offset+30+nameLength+extraLength,name=new TextDecoder().decode(bytes.subarray(offset+30,offset+30+nameLength));assert.equal(files.has(name),false);files.set(name,bytes.slice(start,start+length));offset=start+length;}assert.equal(view.getUint32(offset,true),0x02014b50);return files;}
function decodeSTL(bytes){const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(80,true);assert.equal(bytes.length,84+count*50);return Array.from({length:count},(_,i)=>[0,1,2].map(vertex=>[0,1,2].map(axis=>view.getFloat32(84+i*50+12+vertex*12+axis*4,true))));}
const bounds=triangles=>{const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const triangle of triangles)for(const point of triangle)for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],point[axis]);max[axis]=Math.max(max[axis],point[axis]);}return{min,max};};
const near=(actual,expected,tolerance,label)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${label}: ${actual} != ${expected}`);
async function verifyZIP(download,source,moduleIds,expectedParts){
  assert.match(download.name,/-tiskove-dily\.zip$/);const files=await unzip(download.blob),manifest=JSON.parse(new TextDecoder().decode(files.get('assembly.json'))),parts=manifest.parts;
  assert.equal(manifest.units,'mm');assert.equal(manifest.coordinates,'physical-world');assert.equal(manifest.schemaVersion,2);assert.equal(manifest.layoutHeightMm,source.height);assert.deepEqual(JSON.parse(new TextDecoder().decode(files.get('projekt.json'))).project,source,'portable project keeps the original complete drawer');assert.match(new TextDecoder().decode(files.get('README.txt')),/assembly\.json/);assert.ok(Array.isArray(parts));assert.equal(parts.length,expectedParts);assert.deepEqual([...new Set(parts.map(part=>part.moduleId))].sort(),[...moduleIds].sort());assert.equal([...files.keys()].filter(name=>name.endsWith('.stl')).length,parts.length);
  for(const moduleId of moduleIds){const module=source.modules.find(module=>module.id===moduleId),original=decodeSTL(exportSTL(source,{moduleId,checkBed:false})),originalBounds=bounds(original),originalVolume=trianglesVolume(original),own=parts.filter(part=>part.moduleId===moduleId),world=[];let volume=0;
    for(const part of own){assert.ok(files.has(part.file),part.file);const triangles=decodeSTL(files.get(part.file));validatePrintMesh(triangles);const box=bounds(triangles),width=box.max[0]-box.min[0],height=box.max[1]-box.min[1],partVolume=trianglesVolume(triangles);assert.ok(partVolume>0);assert.ok(width<=source.bedWidth+.001&&height<=source.bedHeight+.001||height<=source.bedWidth+.001&&width<=source.bedHeight+.001,'every closed physical part fits the printer');near(box.min[0],0,.001,'local STL X origin');near(box.min[1],0,.001,'local STL Y origin');near(part.bounds.width,width,.001,'manifest width');near(part.bounds.height,height,.001,'manifest height');assert.equal(part.triangles,triangles.length);near(part.volumeMm3,partVolume,Math.max(1,partVolume*1e-5),'manifest material volume');volume+=partVolume;const matrix=part.assemblyTransform;assert.equal(matrix.length,16);for(const triangle of triangles)world.push(triangle.map(point=>[0,1,2].map(axis=>matrix[axis*4]*point[0]+matrix[axis*4+1]*point[1]+matrix[axis*4+2]*point[2]+matrix[axis*4+3])));}
    const assembled=bounds(world);for(let axis=0;axis<3;axis++){const shift=axis===0?module.x:axis===1?source.height-module.y-module.height:0;near(assembled.min[axis],originalBounds.min[axis]+shift,.001,'reassembled minimum '+axis);near(assembled.max[axis],originalBounds.max[axis]+shift,.001,'reassembled maximum '+axis);}near(volume,originalVolume,Math.max(1,originalVolume*1e-5),'cut parts preserve the original whole-model volume');
    for(let i=0;i<own.length;i++)for(let j=i+1;j<own.length;j++){const a=own[i].clip,b=own[j].clip;assert.ok(a.x>=b.x+b.width-.001||a.x+a.width<=b.x+.001||a.y>=b.y+b.height-.001||a.y+a.height<=b.y+.001,'physical clipping rectangles do not overlap');}
  }
  return manifest;
}
async function exportSelected(ids){choose(ids);await analysisReady();assert.deepEqual(selected(),[...ids].sort());const button=$('[data-do-export]');assert.ok(!button.disabled,'oversized modules are printable by clipping, without manual repacking');const before=store(),undo=history(),source=saved(),count=downloads.length;click(button);await waitFor(()=>downloads.length===count+1);assertReadOnly(before,undo);assert.equal(saved().modules.length,3);return{download:downloads.at(-1),source};}
async function flushHeld(){holdFrames=false;const callbacks=[...heldFrames.values()];heldFrames.clear();for(const callback of callbacks)callback(performance.now());await pause(75);}
after(()=>win.happyDOM.abort());

test('module checkboxes offer all/none, do not edit the project and survive print-bottom and bed changes',async()=>{
  await open('selection');assert.deepEqual(selected(),['locked','pair','triple']);assert.match($('[data-do-export]').textContent,/Připravit.*stáhnout.*ZIP/);const before=store(),undo=history();click('[data-export-select="none"]');assert.deepEqual(selected(),[]);assert.ok($('[data-do-export]').disabled);assertReadOnly(before,undo);click('[data-export-select="all"]');assert.deepEqual(selected(),['locked','pair','triple']);choose(['pair','triple']);assertReadOnly(before,undo);
  assert.equal($('.modal #print-bottom'),null);close();await tick();change('#print-bottom','grid');action('export');await analysisReady();assert.deepEqual(selected(),['pair','triple']);assert.equal(saved().bottomMode,'grid');change('.modal [data-field="bedWidth"]',126);assert.deepEqual(selected(),['pair','triple']);change('.modal [data-field="bedHeight"]',126);assert.deepEqual(selected(),['pair','triple']);assert.deepEqual([saved().bedWidth,saved().bedHeight],[126,126]);close();
});

test('one ZIP contains the clipped selected modules, conserves geometry and leaves the entire drawer bytewise untouched',async()=>{
  await open('success');const {download,source}=await exportSelected(['pair','triple']);await verifyZIP(download,source,['pair','triple'],16);assert.equal(saved().modules.length,3);assert.deepEqual(saved().modules.find(module=>module.id==='locked'),source.modules.find(module=>module.id==='locked'));assert.deepEqual(saved().tools.find(tool=>tool.id==='locked-tool'),source.tools.find(tool=>tool.id==='locked-tool'));
});

test('a locked module can be exported alone as a ZIP while unselected oversized modules remain untouched',async()=>{
  await open('locked-only');const {download,source}=await exportSelected(['locked']);await verifyZIP(download,source,['locked'],1);
});

test('a single tool and its pocket spanning several printer tiles are physically cut without relocating or scaling it',async()=>{
  await open('long-tool');const {download,source}=await exportSelected(['triple']);const manifest=await verifyZIP(download,source,['triple'],12);assert.ok(manifest.parts.length>1);assert.equal(Math.max(...saved().tools.find(tool=>tool.id==='triple-2').points.map(point=>point.x)),180);
});

test('an invalid selected pocket is blocked without preparing a partial ZIP or changing layout/history',async()=>{
  await open('invalid-depth');const before=store(),undo=history(),count=downloads.length;assert.ok($('[data-do-export]').disabled);assert.match($('.modal').textContent,/Hloubka|hloubka/);click($('[data-do-export]'));await pause(40);assert.equal(downloads.length,count);assertReadOnly(before,undo);close();
});

test('cancelling queued preparation drops every part without a file or project/history change',async()=>{
  await open('cancel');choose(['pair','triple']);await analysisReady();const before=store(),undo=history(),count=downloads.length;holdFrames=true;click('[data-do-export]');assert.ok($('[data-print-batch-progress]'));assert.ok($('[data-print-batch-cancel]'));click('[data-print-batch-cancel]');await flushHeld();assert.equal(downloads.length,count);assertReadOnly(before,undo);assert.equal($('.modal'),null);
});

test('switching drawers before queued preparation completes cannot download or alter either drawer',async()=>{
  await open('stale');choose(['pair','triple']);await analysisReady();const source=saved(),count=downloads.length;holdFrames=true;click('[data-do-export]');assert.ok($('[data-print-batch-progress]'));action('projects');click('[data-open="target"]');const afterSwitch=store(),undo=history();await flushHeld();assert.equal(downloads.length,count);assertReadOnly(afterSwitch,undo);assert.equal(saved().id,'target');const old=JSON.parse(store()).find(project=>project.id==='stale');delete old.updatedAt;delete source.updatedAt;assert.deepEqual(old,source,'switching preserves all source layout data');
});
