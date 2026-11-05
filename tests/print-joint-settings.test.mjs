import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject,validateProject} from '../dist/model.js';

const win=new Window({url:'http://localhost:5173'}),html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
globalThis.requestAnimationFrame=callback=>nativeTimeout(()=>callback(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"in"');
const rectangle=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const fixture=(id,extra={})=>validateProject({...blankProject(),id,name:id,width:336,height:252,unit:'in',connectors:true,printMode:'solid',bottomMode:'plain',bedWidth:100,bedHeight:100,
  modules:[{id:'m',name:'Sada',x:0,y:0,width:168,height:84,locked:true,sizeMode:'manual'}],
  tools:[{id:'t',name:'Nástroj',moduleId:'m',x:20,y:20,points:rectangle(20,20),rotation:0,depth:8,fingerGrips:[]}],...extra});
const projects=['invalid','inch','roundtrip','coupon','cut-status'].map(id=>fixture(id));
projects.push(fixture('off',{connectors:false}),fixture('grid',{bottomMode:'grid'}),fixture('magnet',{bottomMode:'magnet'}));
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify(projects));localStorage.setItem('suplik-studio-current','"invalid"');
const blobs=new Map(),downloads=[];
URL.createObjectURL=blob=>{const id='blob:http://localhost/joint-settings-'+blobs.size;blobs.set(id,blob);return id;};URL.revokeObjectURL=()=>{};
win.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push({name:this.download,blob:blobs.get(this.href)});};
await import('../dist/app.js');
after(()=>win.happyDOM.abort());

const $=selector=>win.document.querySelector(selector);
const click=selector=>{const element=typeof selector==='string'?$(selector):selector;assert.ok(element,'Missing '+selector);element.click();};
const action=name=>click(`#app [data-action="${name}"]`);
const store=()=>localStorage.getItem('suplik-studio-projects-v1');
const saved=()=>JSON.parse(store()).find(project=>project.id===JSON.parse(localStorage.getItem('suplik-studio-current')));
const history=()=>[$('#app [data-action="undo"]').disabled,$('#app [data-action="redo"]').disabled];
const pause=ms=>new Promise(resolve=>nativeTimeout(resolve,ms));
async function waitFor(predicate){const started=performance.now();while(!predicate()){if(performance.now()-started>10000)assert.fail('UI did not finish: '+$('#modal-root').textContent+' '+$('#toast').textContent);await pause(2);}}
function change(selector,value){const element=$(selector);assert.ok(element,'Missing '+selector);element.value=String(value);element.dispatchEvent(new win.Event('change',{bubbles:true}));}
function close(){if($('[data-modal-close]'))click('[data-modal-close]');}
const analysisReady=()=>waitFor(()=>$('[data-export-analysis]')?.getAttribute('data-analysis-busy')!=='true');
async function open(id){close();action('projects');click(`[data-open="${id}"]`);action('export');click('[data-format="stl"]');await analysisReady();}
async function downloadedFrom(selector){await analysisReady();const count=downloads.length;click(selector);await waitFor(()=>downloads.length===count+1);assert.ok(downloads.at(-1).blob);return downloads.at(-1);}
function assertReadOnly(before,undo){assert.equal(store(),before,'this action must preserve the whole persisted project, including updatedAt');assert.deepEqual(history(),undo,'this action must not add undo history');}
async function unzip(blob){
  const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),files=new Map();let offset=0;
  while(view.getUint32(offset,true)===0x04034b50){
    assert.equal(view.getUint16(offset+8,true),0);const length=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),start=offset+30+nameLength+extraLength;
    files.set(new TextDecoder().decode(bytes.subarray(offset+30,offset+30+nameLength)),bytes.slice(start,start+length));offset=start+length;
  }
  assert.equal(view.getUint32(offset,true),0x02014b50);return files;
}

test('joint clearance defaults for older projects and survives the JSON model boundary with inclusive limits',()=>{
  assert.equal(validateProject({...blankProject(),jointClearance:undefined}).jointClearance,.2);
  for(const value of [0,.2,.375,1]){
    const project=fixture('model',{jointClearance:value});
    assert.equal(project.jointClearance,value);assert.equal(validateProject(JSON.parse(JSON.stringify({schemaVersion:1,project}))).jointClearance,value);
  }
  for(const value of [-.001,1.001,NaN,Infinity,'invalid'])assert.throws(()=>fixture('bad',{jointClearance:value}),/Neplatná hodnota/);
});

test('invalid joint-clearance text cannot change project data or history',async()=>{
  await open('invalid');const before=store(),undo=history();
  assert.equal(Number($('#export-joint-clearance').value),.2);
  for(const value of ['abc','','-0.01','1.01','Infinity','0.3 in']){
    change('#export-joint-clearance',value);assertReadOnly(before,undo);assert.equal(saved().jointClearance,.2);
    assert.match($('#toast').textContent,/vůl|0.*1|platn/i);
  }
});

test('Czech decimal input remains millimetres in an inch drawer and persists when the dialog and drawer reopen',async()=>{
  await open('inch');const original=saved();
  assert.equal(original.unit,'in');assert.equal($('#export-joint-clearance').type,'text');
  assert.match($('#export-joint-clearance').closest('label').textContent,/mm/);
  change('#export-joint-clearance','0,35');assert.equal(saved().jointClearance,.35);
  assert.deepEqual(saved().modules,original.modules);assert.deepEqual(saved().tools,original.tools);
  const before=store(),undo=history();close();action('export');assert.equal(Number($('#export-joint-clearance').value),.35);assertReadOnly(before,undo);
  await open('inch');assert.equal(Number($('#export-joint-clearance').value),.35);assert.equal(saved().unit,'in');
});

test('downloaded project JSON carries the chosen clearance without converting it to the drawer display unit',async()=>{
  await open('roundtrip');change('#export-joint-clearance','0,375');
  const before=store(),undo=history(),source=saved();click('[data-format="json"]');
  const download=await downloadedFrom('[data-do-export]');assert.match(download.name,/\.json$/);
  const backup=JSON.parse(await download.blob.text());assert.equal(backup.app,'InsertCreator');assert.equal(backup.project.jointClearance,.375);assert.equal(backup.project.unit,'in');
  assert.deepEqual(backup.project,source);assert.equal(validateProject(backup).jointClearance,.375);assertReadOnly(before,undo);
});

test('export status counts joints between bed-cut pieces even when the drawer has only one original module',async()=>{
  await open('cut-status');const before=store(),undo=history(),status=$('[data-joint-status]').textContent;
  assert.match(status,/1/);assert.match(status,/propojuje díly rozdělené podle podložky/);
  assert.doesNotMatch(status,/nemají společnou hranu/);assertReadOnly(before,undo);
});

test('the joint fit-test button downloads a small two-piece STL ZIP without editing the user drawer',async()=>{
  await open('coupon');change('#export-joint-clearance','0,35');await analysisReady();
  // The editor is deliberately not redrawn behind an open manufacturing form.
  // Reopen once so the undo controls reflect the preceding preference change.
  close();await waitFor(()=>history()[0]===false);action('export');await analysisReady();const before=store(),undo=history();
  assert.equal($('#export-joint-fit').disabled,false);const download=await downloadedFrom('#export-joint-fit');assert.match(download.name,/\.zip$/);
  const files=await unzip(download.blob),models=[...files.keys()].filter(name=>name.endsWith('.stl'));assert.equal(models.length,2);
  const assembly=JSON.parse(new TextDecoder().decode(files.get('assembly.json')));assert.equal(assembly.joints.clearance,.35,'the actual downloaded coupon uses the chosen millimetre clearance');
  assert.deepEqual(assembly.parts.map(part=>part.moduleId).sort(),['joint-fit-socket','joint-fit-tab'],'the fit test exports its coupons instead of the user\'s drawer');
  for(const name of models){const bytes=files.get(name),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(80,true);assert.ok(count>0);assert.equal(bytes.length,84+count*50);}
  assertReadOnly(before,undo);assert.equal(saved().jointClearance,.35);
});

test('disabled connectors and unsupported Gridfinity bottoms do not offer clearance or a misleading fit test',async()=>{
  for(const id of ['off','grid']){
    await open(id);const before=store(),undo=history();assert.equal($('#export-joint-clearance'),null);assert.equal($('#export-joint-fit'),null);
    assert.equal($('#export-connectors').disabled,id==='grid');assertReadOnly(before,undo);
  }
});

test('magnet bottoms allow puzzle joints, clearance settings and an actual joined print ZIP',async()=>{
  await open('magnet');const before=store(),undo=history();
  assert.equal($('#export-connectors').disabled,false);assert.equal($('#export-connectors').checked,true);
  assert.ok($('#export-joint-clearance'));assert.equal($('#export-joint-fit').disabled,false);
  const download=await downloadedFrom('[data-do-export]'),files=await unzip(download.blob);
  const assembly=JSON.parse(new TextDecoder().decode(files.get('assembly.json')));
  assert.ok(assembly.joints.count>0,'the downloaded magnet model must contain real puzzle connections');
  assert.ok(assembly.joints.cutCount>0);assert.equal(assembly.schemaVersion,2);assertReadOnly(before,undo);
});
