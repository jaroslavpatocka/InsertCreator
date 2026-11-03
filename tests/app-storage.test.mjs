import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject} from '../dist/model.js';
import {addToolGroup} from '../dist/set-module.js';
import {catalogSets,catalogItems,CATEGORIES,SETS_CATEGORY} from '../dist/catalog/index.js';
import {automaticFingerGrips,pocketOutline} from '../dist/finger-grip.js';
import {validateLayout} from '../dist/geometry.js';
import {getToolSize} from '../dist/tool-size.js';
import {analyzeToolShape,findToolSets,setCoherence} from '../dist/tool-sets.js';

const win=new Window({url:'http://localhost:5173'}),html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(Date.now()),0);globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};

const catalogSet=catalogSets().find(set=>set.id==='hex-key-set-1-5-10mm');assert.ok(catalogSet);
function fixture(id,{arrangement='ordered',moduleLocked=false,toolLocked=false}={}){
  const tools=catalogSet.tools.map((item,index)=>{
    const tool={id:`${id}-${index}`,name:item.name.cs,points:structuredClone(item.points),depth:Math.min(item.depth,17.6),unit:item.unit,nominalSize:{value:item.size,unit:item.unit},x:0,y:0,rotation:0,locked:false};
    tool.fingerGrips=automaticFingerGrips(tool,{radius:9});if(index===0)tool.sizeLabel='1,5 mm';return tool;
  });
  const project=addToolGroup({...blankProject(),id,name:id,width:504,height:600,limitToBed:false},tools,{moduleId:`group-${id}`,arrangement,order:'asc',toolSet:{id:`set-${id}`,name:'Sada imbusů',layout:'shared'}}).project;
  if(moduleLocked)project.modules[0].locked=true;if(toolLocked)project.tools[3].locked=true;
  return project;
}
const projects=[fixture('storage-ordered',{arrangement:'compact'}),fixture('storage-compact'),fixture('storage-uniform'),fixture('storage-locked-module',{moduleLocked:true}),fixture('storage-locked-tool',{toolLocked:true}),{...blankProject(),id:'storage-catalog',name:'storage-catalog',width:504,height:600,limitToBed:false}];
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify(projects));localStorage.setItem('suplik-studio-current',JSON.stringify(projects[0].id));
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
const {setCatalogSource}=await import('../dist/catalog-ui.js');
setCatalogSource(async()=>({categories:CATEGORIES,items:catalogItems(),sets:[catalogSet],setsCategory:SETS_CATEGORY}));
await import('../dist/app.js');
after(async()=>{setCatalogSource(null);await win.happyDOM.close();});

const $=selector=>win.document.querySelector(selector);
const click=selector=>{const element=$(selector);assert.ok(element,'Missing '+selector);element.click();};
const action=name=>click(`#app [data-action="${name}"]`);
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(project=>project.id===JSON.parse(localStorage.getItem('suplik-studio-current')));
const logical=project=>{const next=structuredClone(project);delete next.updatedAt;return next;};
const history=()=>({undo:$('#app [data-action=undo]').disabled,redo:$('#app [data-action=redo]').disabled});
const change=(selector,value)=>{const element=$(selector);assert.ok(element,'Missing '+selector);element.value=value;element.dispatchEvent(new win.Event('change',{bubbles:true}));};
function open(id,{select=true}={}){action('projects');click(`[data-open="${id}"]`);if(select)click(`[data-select="${saved().tools[0].id}"]`);return saved();}
function apply(variant,order='desc'){
  action('arrange-current-set');change('[data-storage-variant]',variant);change('[data-storage-order]',order);click('[data-apply-set-storage]');
}
function assertRawTools(before,after){
  assert.deepEqual(after.tools.map(tool=>tool.id),before.tools.map(tool=>tool.id),'Tool identity and list order are preserved');
  for(const tool of after.tools){const original=before.tools.find(item=>item.id===tool.id);for(const key of ['points','nominalSize','sizeLabel','fingerGrips','depth','name'])assert.deepEqual(tool[key],original[key],`${tool.id}: ${key}`);}
}
const box=tool=>{const points=pocketOutline(tool,.8);return{left:Math.min(...points.map(point=>point.x)),top:Math.min(...points.map(point=>point.y)),bottom:Math.max(...points.map(point=>point.y))};};
function orderedValues(project){
  const rows=new Map();for(const tool of project.tools){const b=box(tool),key=Math.round(b.bottom*1000);if(!rows.has(key))rows.set(key,[]);rows.get(key).push({tool,b});}
  return[...rows].sort(([a],[b])=>a-b).flatMap(([,row])=>row.sort((a,b)=>a.b.left-b.b.left).map(item=>getToolSize(item.tool).mm));
}
const expectedValues=project=>project.tools.map(tool=>getToolSize(tool).mm).sort((a,b)=>b-a);
const wrap=value=>((value%360)+360)%360;
const headings=project=>new Set(project.tools.map(tool=>Math.round(wrap(tool.rotation-analyzeToolShape(tool).rotation))%360));
function assertChanged(before,variant){
  const after=saved();assert.equal($('#modal-root').children.length,0,'Applying the layout closes the dialog without a fit prompt');
  assertRawTools(before,after);assert.deepEqual(validateLayout(after),[]);
  const set=after.toolSets.find(set=>set.id===before.toolSets[0].id);assert.ok(set,'The editable set keeps its identity');
  assert.equal(set.order,'desc');assert.equal(set.layout,variant==='uniform'?'uniform':'shared');assert.equal(set.arrangement,variant==='uniform'?'ordered':variant);
  assert.deepEqual(setCoherence(after,findToolSets(after).sets).unsatisfied,[]);
  assert.equal(history().undo,false);
  return after;
}
function assertUndoRedo(before,after){action('undo');assert.deepEqual(logical(saved()),logical(before),'One undo restores tools, modules and set preferences');action('redo');assert.deepEqual(logical(saved()),logical(after));}

test('rearranging a selected tool into descending ordered rows preserves IDs, shapes, nominal labels and one undo step',()=>{
  const before=open('storage-ordered');apply('ordered');const after=assertChanged(before,'ordered');
  assert.deepEqual(orderedValues(after),expectedValues(after));assert.equal(headings(after).size,1);
  assertUndoRedo(before,after);
});

test('compact storage keeps a safe footprint and numeric order, using opposing headings only when they save area',()=>{
  const before=open('storage-compact');apply('compact');const after=assertChanged(before,'compact');
  const area=project=>project.modules.reduce((sum,module)=>sum+module.width*module.height,0);
  assert.ok(area(after)<=area(before));const directions=[...headings(after)];assert.ok(directions.length===1||directions.length===2);
  if(directions.length===2){assert.ok(area(after)<area(before),'opposing rows must have a strict area benefit');assert.equal(wrap(directions[0]-directions[1]),180);}
  const tools=[...after.tools].sort((a,b)=>getToolSize(b).mm-getToolSize(a).mm);assert.ok(box(tools[0]).top<box(tools.at(-1)).top,'The descending series starts with the largest tool in the upper row');
  assertUndoRedo(before,after);
});

test('uniform storage rebuilds equal modules in descending physical reading order and remains one undo step',()=>{
  const before=open('storage-uniform');apply('uniform');const after=assertChanged(before,'uniform');
  assert.equal(after.modules.length,before.tools.length);assert.equal(new Set(after.modules.map(module=>`${module.width}x${module.height}`)).size,1);
  const physical=[...after.modules].sort((a,b)=>a.y-b.y||a.x-b.x).map(module=>getToolSize(after.tools.find(tool=>tool.moduleId===module.id)).mm);
  assert.deepEqual(physical,expectedValues(after));assertUndoRedo(before,after);
});

test('a locked module or set member rejects rearrangement without project or history changes',()=>{
  for(const id of ['storage-locked-module','storage-locked-tool']){
    const before=open(id),undo=history();apply('compact');
    assert.deepEqual(logical(saved()),logical(before));assert.deepEqual(history(),undo);assert.match($('#toast').textContent,/odemkněte všechny moduly sady/);
    assert.ok($('[data-apply-set-storage]'),'The dialog remains available for correcting the lock');click('[data-modal-close]');
  }
});

test('a whole catalogue group selected immediately after insertion exposes the same storage dialog',async()=>{
  open('storage-catalog',{select:false});action('library');click('[data-library-folder="catalog"]');
  const waitFor=async fn=>{const start=Date.now();while(!fn()){if(Date.now()-start>5000)throw Error('Catalogue did not load');await new Promise(resolve=>setTimeout(resolve,10));}};
  await waitFor(()=>$('[data-catalog-category="sets"]'));click('[data-catalog-category="sets"]');
  change(`[data-set-layout="${catalogSet.id}"]`,'group');change(`[data-set-arrangement="${catalogSet.id}"]`,'ordered');change(`[data-set-order="${catalogSet.id}"]`,'asc');click(`[data-set-add="${catalogSet.id}"]`);
  assert.equal(win.document.querySelectorAll('.tool-row.selected').length,0,'The whole module is selected, rather than one tool');
  const before=saved();assert.equal(before.tools.length,catalogSet.tools.length);assert.equal(before.modules.length,1);
  apply('compact');const after=assertChanged(before,'compact');assertUndoRedo(before,after);
});

test('an existing shared module without a saved set can adopt ordered storage in one undo step',()=>{
  open('storage-catalog');action('tool-sets');
  const oldSet=saved().toolSets[0];assert.ok(oldSet);
  click(`[data-set-delete="${oldSet.id}"]`);click('[data-modal-close]');
  const before=saved();assert.equal(before.toolSets.length,0);assert.equal(before.modules.length,1);
  assert.ok($('#app [data-action=arrange-current-set]'),'A shared module exposes storage even without saved membership');
  apply('ordered');const after=saved();assertRawTools(before,after);
  assert.equal(after.toolSets.length,1);assert.equal(after.toolSets[0].order,'desc');assert.equal(after.toolSets[0].arrangement,'ordered');
  assert.deepEqual(new Set(after.toolSets[0].toolIds),new Set(before.tools.map(t=>t.id)));assert.deepEqual(validateLayout(after),[]);
  assertUndoRedo(before,after);
});
