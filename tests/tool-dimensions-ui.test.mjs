import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject,validateProject} from '../dist/model.js';
import {bounds,validateLayout} from '../dist/geometry.js';

const win=new Window({url:'http://localhost:5173'});
const html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');

const rectangle=[{x:0,y:0},{x:20,y:0},{x:20,y:120},{x:0,y:120}];
const screwdriver=[[8,0],[12,0],[12,78],[18,82],[20,90],[20,115],[16,120],[4,120],[0,115],[0,90],[2,82],[8,78]].map(([x,y])=>({x,y}));
function fixture(id,collision=false){
  return validateProject({...blankProject(),id,name:id,width:840,height:630,limitToBed:true,bedWidth:220,bedHeight:220,
    modules:[{id:'shared',name:'Moje sada',x:0,y:0,width:420,height:336,sizeMode:'manual',grouped:true,setId:'set',setLayout:'shared'}],
    tools:[{id:'one',name:'Klíč 13 mm',points:rectangle,x:collision?60:70,y:100,rotation:0,depth:8,moduleId:'shared',fingerGrips:[],nominalSize:{value:13,unit:'mm'},sizeLabel:'13 mm'},
      {id:'two',name:'Šroubovák PH2',points:screwdriver,x:collision?110:240,y:100,rotation:0,depth:9,moduleId:'shared',sizeLabel:'PH2',unit:'mm',
        fingerGrips:[{id:'left',x:1.35,y:100,radius:7},{id:'right',x:18.65,y:100,radius:7}]}],
    toolSets:[{id:'set',name:'Moje sada',toolIds:['one','two'],layout:'shared',arrangement:'ordered',order:'asc'}]});
}
const initial=fixture('dimensions-main'),collision=fixture('dimensions-collision',true);
assert.deepEqual(validateLayout(initial),[]);assert.deepEqual(validateLayout(collision),[]);
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([initial,collision]));localStorage.setItem('suplik-studio-current','"dimensions-main"');
const blobs=new Map(),downloads=[];
URL.createObjectURL=blob=>{const url='blob:http://localhost/dimensions-'+blobs.size;blobs.set(url,blob);return url;};URL.revokeObjectURL=()=>{};
win.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push({name:this.download,blob:blobs.get(this.href)});};
await import('../dist/app.js');

const $=selector=>win.document.querySelector(selector);
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id===JSON.parse(localStorage.getItem('suplik-studio-current')));
const state=()=>{const p=saved();delete p.updatedAt;return p;};
const click=selector=>{const el=typeof selector==='string'?$(selector):selector;assert.ok(el,'Missing control '+selector);el.dispatchEvent(new win.MouseEvent('click',{bubbles:true}));};
const action=name=>click(`#app [data-action="${name}"]`);
const change=(selector,value)=>{const el=$(selector);assert.ok(el,'Missing field '+selector);el.value=String(value);el.dispatchEvent(new win.Event('change',{bubbles:true}));};
const select=()=>click('#board-svg .tool-outline[data-tool="two"]');
const span=(tool,key)=>Math.max(...tool.points.map(p=>p[key]))-Math.min(...tool.points.map(p=>p[key]));
const near=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-6,`${message}: expected ${expected}, got ${actual}`);
const unchangedSiblings=(before,next)=>{assert.deepEqual(next.tools[0],before.tools[0]);assert.deepEqual(next.modules,before.modules);assert.deepEqual(next.toolSets,before.toolSets);};
const noHistory=()=>assert.ok($('#app [data-action="undo"]').disabled,'read-only or rejected operations create no history');
const undoTo=before=>{action('undo');assert.deepEqual(state(),before,'one undo restores the entire dimension edit');};
const visible=el=>{for(let node=el;node;node=node.parentElement)if(node.hidden||(node.tagName==='DETAILS'&&!node.open))return false;return true;};
const closeReview=()=>{if($('.modal'))click('[data-modal-close]');};
function open(id){action('projects');click(`[data-open="${id}"]`);}
after(()=>win.happyDOM.abort());

test('a selected set member groups length and width and length changes only that tool',()=>{
  const before=state();click('#board-svg [data-module="shared"] > rect');
  click('.module-members [data-select="two"]');
  assert.equal($('[data-field="name"]').value,'Šroubovák PH2');
  const group=$('[data-inspector-section=tool-shape]');assert.ok(group);assert.equal(group.open,false,'dimension settings start collapsed');group.open=true;
  for(const field of ['toolLength','toolBreadth']){const el=$(`[data-field="${field}"]`);assert.ok(el);assert.ok(visible(el),field+' is visible in its expanded settings group');}
  near(Number($('[data-field="toolLength"]').value),120,'initial length');near(Number($('[data-field="toolBreadth"]').value),20,'initial width');
  const oldBounds=bounds(before.tools[1]);change('[data-field="toolLength"]','160 mm');
  const next=state(),tool=next.tools[1],box=bounds(tool);near(span(tool,'y'),160,'new actual length');near(span(tool,'x'),20,'width remains unchanged');
  near(box.x+box.width/2,oldBounds.x+oldBounds.width/2,'horizontal center');near(box.y+box.height/2,oldBounds.y+oldBounds.height/2,'vertical center');
  unchangedSiblings(before,next);assert.equal(tool.id,'two');assert.equal(tool.moduleId,'shared');assert.equal(tool.depth,9);assert.equal(tool.sizeLabel,'PH2');
  assert.deepEqual(tool.fingerGrips.map(g=>g.radius),[7,7]);assert.deepEqual(validateLayout(next),[]);
  undoTo(before);noHistory();
});

test('width can be changed independently without changing the selected set member length',()=>{
  const before=state();select();change('[data-field="toolBreadth"]','30 mm');
  const next=state();near(span(next.tools[1],'x'),30,'new width');near(span(next.tools[1],'y'),120,'length remains unchanged');
  unchangedSiblings(before,next);assert.deepEqual(validateLayout(next),[]);undoTo(before);noHistory();
});

test('dimension fields use the tool axes at arbitrary placement angles and remain undoable',()=>{
  const before=state();select();change('[data-field="rotation"]',37);const rotated=state();
  near(Number($('[data-field="toolLength"]').value),120,'37-degree length is independent of world bounds');
  near(Number($('[data-field="toolBreadth"]').value),20,'37-degree width is independent of world bounds');
  change('[data-field="toolLength"]',170);const longer=state();near(span(longer.tools[1],'y'),170,'actual length at 37 degrees');near(span(longer.tools[1],'x'),20,'actual width at 37 degrees');
  assert.equal(longer.tools[1].rotation,37);unchangedSiblings(rotated,longer);assert.deepEqual(validateLayout(longer),[]);undoTo(rotated);undoTo(before);
  change('[data-field="rotation"]',90);near(Number($('[data-field="toolLength"]').value),120,'90-degree length');near(Number($('[data-field="toolBreadth"]').value),20,'90-degree width');
  undoTo(before);noHistory();
});

test('explicit inch length and per-tool display unit survive portable JSON without scaling width',async()=>{
  const before=state();select();change('[data-field="unit"][data-scope="tool"]','in');const inchDisplay=state();
  change('[data-field="toolLength"]','6 1/2 in');const next=state();near(span(next.tools[1],'y'),165.1,'inch input is stored in millimetres');near(span(next.tools[1],'x'),20,'inch length does not scale width');
  assert.equal(next.tools[1].unit,'in');unchangedSiblings(inchDisplay,next);assert.deepEqual([next.limitToBed,next.bedWidth,next.bedHeight],[true,220,220]);
  action('save-project');const download=downloads.at(-1);assert.ok(download?.blob,'a portable JSON file is generated');
  const portable=JSON.parse(await download.blob.text()),restored=validateProject(portable);near(span(restored.tools[1],'y'),165.1,'JSON length');near(span(restored.tools[1],'x'),20,'JSON width');
  assert.equal(restored.tools[1].unit,'in');assert.deepEqual(restored.modules,next.modules);assert.deepEqual(restored.toolSets,next.toolSets);
  undoTo(inchDisplay);undoTo(before);noHistory();
});

test('invalid or oversized member dimensions are rejected without partial changes or history',()=>{
  select();const before=state(),stored=localStorage.getItem('suplik-studio-projects-v1');
  for(const [field,value] of [['toolLength','nonsense'],['toolLength',0],['toolLength',3001],['toolBreadth',1],['toolLength',500]]){
    change(`[data-field="${field}"]`,value);assert.deepEqual(state(),before,`${field}=${value} is atomic`);
    assert.equal(localStorage.getItem('suplik-studio-projects-v1'),stored,'rejected edits do not persist a new timestamp');noHistory();closeReview();
  }
});

test('a member resize colliding with another tool is rejected without moving the sibling or container',()=>{
  open('dimensions-collision');select();const before=state(),stored=localStorage.getItem('suplik-studio-projects-v1');
  try{change('[data-field="toolBreadth"]',100);assert.deepEqual(state(),before);assert.equal(localStorage.getItem('suplik-studio-projects-v1'),stored);noHistory();closeReview();}
  finally{open('dimensions-main');}
});
