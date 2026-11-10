import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject,validateProject} from '../dist/model.js';
import {validatePrintMesh,trianglesVolume} from '../dist/print-geometry.js';

const win=new Window({url:'http://localhost:5173'}),html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
const project=(id,bottomMode='grid')=>validateProject({...blankProject(),id,name:id,width:126,height:126,grid:42,bottomMode,bedWidth:84,bedHeight:84,limitToBed:true});
const plain=project('system-control','plain'),empty=project('empty-grid'),invalid=project('invalid-insert');
invalid.modules=[{id:'outside',name:'Outside module',x:84,y:0,width:84,height:84,sizeMode:'manual',locked:false}];
invalid.tools=[{id:'outside-tool',name:'Tool',points:[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}],x:100,y:20,rotation:0,depth:8,moduleId:'outside',fingerGrips:[],locked:false}];
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([plain,empty,invalid]));localStorage.setItem('suplik-studio-current','"system-control"');
const blobs=new Map(),downloads=[];URL.createObjectURL=blob=>{const id='blob:http://localhost/gridfinity-'+blobs.size;blobs.set(id,blob);return id;};URL.revokeObjectURL=()=>{};
win.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push({name:this.download,blob:blobs.get(this.href)});};
await import('../dist/app.js');
const $=selector=>win.document.querySelector(selector),click=selector=>{const el=typeof selector==='string'?$(selector):selector;assert.ok(el,'Missing '+selector);el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));};
const action=name=>click(`#app [data-action="${name}"]`),change=(selector,value)=>{const el=$(selector);assert.ok(el,selector);el.value=String(value);el.dispatchEvent(new win.Event('change',{bubbles:true}));};
const open=id=>{action('projects');click(`[data-open="${id}"]`);action('2d');};
const state=()=>{const id=JSON.parse(localStorage.getItem('suplik-studio-current')),p=JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id===id);delete p.updatedAt;return p;};
const history=()=>[$('#app [data-action="undo"]').disabled,$('#app [data-action="redo"]').disabled];
const tick=()=>new Promise(resolve=>nativeTimeout(resolve,0));
async function waitFor(predicate){for(let i=0;i<100;i++){if(predicate())return;await tick();}assert.ok(predicate(),'asynchronous export completes');}
const visible=el=>{for(let node=el;node;node=node.parentElement)if(node.hidden||node.tagName==='DETAILS'&&!node.open)return false;return true;};
async function unzip(blob){
  const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),files=new Map();let offset=0;
  while(view.getUint32(offset,true)===0x04034b50){assert.equal(view.getUint16(offset+8,true),0,'portable ZIP stores uncompressed records');const size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),start=offset+30+nameLength+extraLength,name=new TextDecoder().decode(bytes.subarray(offset+30,offset+30+nameLength));assert.equal(files.has(name),false);files.set(name,bytes.slice(start,start+size));offset=start+size;}
  assert.equal(view.getUint32(offset,true),0x02014b50,'ZIP contains a central directory');return files;
}
function decodeSTL(bytes){const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(80,true);assert.equal(bytes.length,84+count*50);return Array.from({length:count},(_,i)=>[0,1,2].map(vertex=>[0,1,2].map(axis=>view.getFloat32(84+i*50+12+vertex*12+axis*4,true))));}
async function verifyDownload(download){
  assert.match(download.name,/-gridfinity-baseplate\.zip$/);const files=await unzip(download.blob),assembly=JSON.parse(new TextDecoder().decode(files.get('assembly.json'))),seen=new Set();
  assert.equal(assembly.units,'mm');assert.equal(assembly.pitch,42);assert.deepEqual([assembly.layout.columns,assembly.layout.rows],[3,3]);assert.equal(assembly.tiles.length,4);assert.equal(files.size,6);assert.match(new TextDecoder().decode(files.get('README.txt')),/assembly\.json/);
  for(const tile of assembly.tiles){const triangles=decodeSTL(files.get(tile.file));validatePrintMesh(triangles);assert.ok(trianglesVolume(triangles)>0);const points=triangles.flat(),width=Math.max(...points.map(p=>p[0])),height=Math.max(...points.map(p=>p[1]));assert.equal(Math.min(...points.map(p=>p[0])),0);assert.equal(Math.min(...points.map(p=>p[1])),0);assert.equal(width,tile.columns*42);assert.equal(height,tile.rows*42);assert.ok(width<=84&&height<=84);assert.equal(Math.max(...points.map(p=>p[2])),5);assert.equal(tile.xMm,tile.x*42);assert.equal(tile.yMm,tile.y*42);for(let y=tile.y;y<tile.y+tile.rows;y++)for(let x=tile.x;x<tile.x+tile.columns;x++){const key=`${x},${y}`;assert.equal(seen.has(key),false);seen.add(key);}}
  assert.equal(assembly.schemaVersion,2);assert.equal(assembly.coordinates,'physical-world');
  for(const tile of assembly.tiles){
    const matrix=tile.assemblyTransform;assert.equal(matrix.length,16);
    assert.equal(matrix[3],tile.xMm);assert.equal(matrix[7],assembly.layoutSize.height-tile.yMm-tile.rows*42);
    assert.deepEqual([matrix[0],matrix[5],matrix[10]],[1,1,1],'physical baseplate assembly uses translations without reflection');
  }
  assert.equal(seen.size,9,'all drawer cells are covered exactly once');
}
after(()=>win.happyDOM.abort());

test('the grouped module-system control enables the real 42mm baseplate in both model views, independently of guide-grid visibility',async()=>{
  const before=state(),select=$('select[data-field="bottomMode"]');assert.ok(select);assert.equal(visible(select),false,'manufacturing options start collapsed');for(const key of ['manufacturing','manufacturing-bottom']){const group=$('details[data-inspector-section="'+key+'"]');assert.ok(group);group.open=true;}assert.ok(visible(select),'the bottom choice becomes visible in its related group');assert.equal(select.value,'plain');change('select[data-field="bottomMode"]','grid');assert.equal(state().bottomMode,'grid');assert.equal(state().grid,42);
  const pattern=$('#board-svg #gridfinity-sockets');assert.ok(pattern);assert.equal(pattern.getAttribute('width'),'42');assert.equal(pattern.getAttribute('height'),'42');assert.ok($('#board-svg [data-baseplate="true"]'));
  action('grid');assert.ok($('#board-svg #gridfinity-sockets'),'hiding editing guides does not hide the physical baseplate');action('3d');await waitFor(()=>$('#board-svg polygon[data-baseplate="true"][data-face-index]'));assert.ok($('#board-svg polygon[data-baseplate="true"][data-face-index]'),'3D displays actual material faces');assert.equal($('#board-svg [data-baseplate="true"]').closest('[data-module]'),null,'baseplate is not an editable insert module');
  assert.equal(state().modules.length,0);assert.equal(state().tools.length,0);action('undo');assert.deepEqual(state(),before);assert.deepEqual(history(),[true,false]);
});

test('empty drawer baseplate export creates four manifold STL tiles and assembly records for an 84mm printer',async()=>{
  open('empty-grid');const before=state(),undo=history(),count=downloads.length;action('export-baseplate');assert.ok($('[data-baseplate-cancel]'));await waitFor(()=>downloads.length===count+1);await verifyDownload(downloads.at(-1));assert.deepEqual(state(),before);assert.deepEqual(history(),undo);
});

test('the main model settings offer independent baseplate export when insert export is invalid or empty',async()=>{
  for(const id of ['empty-grid','invalid-insert']){open(id);const before=state(),undo=history(),count=downloads.length;action('export');assert.ok($('[data-do-export]').disabled);assert.equal($('.modal [data-action="export-baseplate"]'),null,'baseplate actions belong beside the main 3D model');click('[data-model-settings]');assert.equal($('.modal'),null);const button=$('#manufacturing-settings [data-action="export-baseplate"]');assert.ok(button&&!button.disabled);click(button);await waitFor(()=>downloads.length===count+1);await verifyDownload(downloads.at(-1));assert.deepEqual(state(),before);assert.deepEqual(history(),undo);}
});

test('cancelling asynchronous baseplate preparation produces no file, project mutation or undo entry',async()=>{
  open('empty-grid');const before=state(),undo=history(),count=downloads.length;action('export-baseplate');click('[data-baseplate-cancel]');await tick();await tick();assert.equal($('.modal'),null);assert.equal(downloads.length,count);assert.deepEqual(state(),before);assert.deepEqual(history(),undo);
});

test('Gridfinity and stepped geometry cannot be corrupted by changing their shared raster',async()=>{
  open('empty-grid');const before=state(),undo=history();change('[data-field="grid"]',50);assert.deepEqual(state(),before);assert.deepEqual(history(),undo);assert.match($('#toast').textContent,/42 mm/);
  const imported=validateProject({...blankProject(),id:'stepped-grid-test',name:'Stepped grid',width:252,height:252,modules:[{id:'ell',name:'L module',x:0,y:0,width:84,height:84,sizeMode:'manual',shape:'stepped',cells:[{x:0,y:0},{x:1,y:0},{x:0,y:1}]}]}),input=$('#project-file'),oldId=state().id;
  Object.defineProperty(input,'files',{configurable:true,value:[new win.File([JSON.stringify(imported)],'stepped.json',{type:'application/json'})]});input.dispatchEvent(new win.Event('change',{bubbles:true}));await waitFor(()=>state().id!==oldId);
  const stepped=state(),steppedHistory=history();assert.ok($('#board-svg [data-module="ell"] > .module-footprint'));change('[data-field="grid"]',50);assert.deepEqual(state(),stepped);assert.deepEqual(history(),steppedHistory);assert.match($('#toast').textContent,/schodové moduly/);assert.equal(validateProject(state()).grid,42);
});
