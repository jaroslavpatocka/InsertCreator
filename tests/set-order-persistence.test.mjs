import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {autoArrange,validateLayout} from '../dist/geometry.js';
import {addToolGroup} from '../dist/set-module.js';
import {smartArrange} from '../dist/smart-layout.js';
import {catalogSets} from '../dist/catalog/index.js';
import {automaticFingerGrips,pocketOutline} from '../dist/finger-grip.js';
import {findToolSets,setCoherence,analyzeToolShape} from '../dist/tool-sets.js';
import {getToolSize} from '../dist/tool-size.js';

const base=()=>({...blankProject(),width:1008,height:840,limitToBed:false});
function toolsOf(id){
  const set=catalogSets().find(s=>s.id===id);assert.ok(set,id);
  return set.tools.map((item,index)=>{
    const tool={id:'tool-'+index,name:item.name.cs,points:structuredClone(item.points),depth:Math.min(item.depth,17.6),unit:item.unit,nominalSize:{value:item.size,unit:item.unit},x:0,y:0,rotation:0,locked:false,moduleId:null};
    tool.fingerGrips=automaticFingerGrips(tool,{radius:9});return tool;
  });
}
const expected=(tools,order='desc')=>tools.map(t=>getToolSize(t).mm).sort((a,b)=>order==='desc'?b-a:a-b);
function uniformValues(project,ids=project.tools.map(t=>t.id)){
  const members=new Set(ids);
  return [...project.modules].filter(m=>project.tools.some(t=>t.moduleId===m.id&&members.has(t.id))).sort((a,b)=>a.y-b.y||a.x-b.x).map(m=>getToolSize(project.tools.find(t=>t.moduleId===m.id&&members.has(t.id))).mm);
}
function pocketBounds(tool,clearance){const points=pocketOutline(tool,clearance);return{left:Math.min(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};}
function regularValues(project){
  const rows=[];
  for(const tool of project.tools){
    const bounds=pocketBounds(tool,project.clearance);let row=rows.find(row=>Math.abs(row.bottom-bounds.bottom)<.01);
    if(!row){row={bottom:bounds.bottom,items:[]};rows.push(row);}row.items.push({tool,left:bounds.left});
  }
  return rows.sort((a,b)=>a.bottom-b.bottom).flatMap(row=>row.items.sort((a,b)=>a.left-b.left).map(item=>getToolSize(item.tool).mm));
}
const assertRaw=(before,after)=>{for(const tool of before.tools){const actual=after.tools.find(t=>t.id===tool.id);for(const field of ['points','fingerGrips','depth','name','nominalSize'])assert.deepEqual(actual[field],tool[field],`${tool.id} ${field}`);}};

test('ordinary Auto retains explicit descending size order for 12 uniform wrench modules and after adding another tool',()=>{
  const tools=toolsOf('combination-wrench-set-8-19mm'),p=addToolGroup(base(),tools,{arrangement:'ordered',order:'desc',toolSet:{id:'wrenches',layout:'uniform'}}).project,snapshot=structuredClone(p),values=expected(tools);
  assert.deepEqual(uniformValues(p),values);
  const once={...p,...autoArrange(p)},twice={...once,...autoArrange(once)};
  assert.deepEqual(uniformValues(once),values);assert.deepEqual(uniformValues(twice),values);assert.deepEqual(validateLayout(twice),[]);assertRaw(p,twice);assert.deepEqual(p,snapshot);
  const extra={id:'extra',name:'Další nástroj',points:[{x:0,y:0},{x:20,y:0},{x:20,y:30},{x:0,y:30}],depth:8,x:0,y:0,rotation:0,moduleId:null,fingerGrips:[]};
  const extended={...twice,tools:[...twice.tools,extra]},arranged={...extended,...autoArrange(extended)};
  assert.deepEqual(uniformValues(arranged,tools.map(t=>t.id)),values);assert.deepEqual(validateLayout(arranged),[]);
});

test('hashed module IDs produced by Smart sets do not replace nominal order during subsequent Auto or JSON reload',async()=>{
  const tools=toolsOf('hex-key-set-1-5-10mm'),p={...base(),tools,toolSets:[{id:'hex',name:'Imbusy',toolIds:tools.map(t=>t.id),layout:'uniform',arrangement:'ordered',order:'desc'}]};
  Object.assign(p,autoArrange(p));const snapshot=structuredClone(p),result=await smartArrange(p,{mode:'sets'}),smart={...p,...result};
  assert.equal(result.stats.setScoreAfter,tools.length);assert.deepEqual(uniformValues(smart),expected(tools));
  const restored=validateProject(JSON.parse(JSON.stringify(smart))),again={...restored,...autoArrange(restored)};
  assert.deepEqual(uniformValues(again),expected(tools));assert.deepEqual(validateLayout(again),[]);assertRaw(p,again);assert.deepEqual(p,snapshot);
});

test('Smart sets applies a changed shared order even when headings, footprint and placement already satisfy the old order',async()=>{
  const tools=toolsOf('hex-key-set-1-5-10mm'),p=addToolGroup(base(),tools,{arrangement:'ordered',order:'asc',toolSet:{id:'hex',layout:'shared'}}).project;
  assert.deepEqual(regularValues(p),expected(tools,'asc'));p.toolSets[0].order='desc';const snapshot=structuredClone(p);
  assert.equal(setCoherence(p,findToolSets(p).sets).score,0,'opposite physical order is no longer credited as satisfied');
  const result=await smartArrange(p,{mode:'sets'}),next={...p,...result};
  assert.equal(result.stats.changed,true);assert.equal(result.stats.setScoreBefore,0);assert.equal(result.stats.setScoreAfter,tools.length);assert.deepEqual(result.stats.warnings,[]);
  assert.deepEqual(regularValues(next),expected(tools));assert.deepEqual(validateLayout(next),[]);assertRaw(p,next);assert.deepEqual(p,snapshot);
});

test('compact order changes remain preference-aware while allowing opposing headings and keeping the source untouched',async()=>{
  const tools=toolsOf('hex-key-set-1-5-10mm'),p=addToolGroup(base(),tools,{arrangement:'compact',order:'asc',toolSet:{id:'hex',layout:'shared'}}).project;
  assert.deepEqual(setCoherence(p,findToolSets(p).sets).satisfied,['hex']);p.toolSets[0].order='desc';const snapshot=structuredClone(p);
  const result=await smartArrange(p,{mode:'sets'}),next={...p,...result};
  assert.equal(result.stats.changed,true);assert.equal(result.stats.setScoreAfter,tools.length);assert.deepEqual(validateLayout(next),[]);
  const largest=next.tools.find(t=>t.nominalSize.value===10),smallest=next.tools.find(t=>t.nominalSize.value===1.5),middle=next.tools.filter(t=>t!==largest&&t!==smallest);
  assert.ok(middle.every(t=>pocketBounds(largest,next.clearance).top<pocketBounds(t,next.clearance).top),'descending compact storage starts with the largest size');
  assert.ok(middle.every(t=>pocketBounds(smallest,next.clearance).bottom>=pocketBounds(t,next.clearance).bottom-.001),'the smallest size is in the last row of compact storage');
  assert.deepEqual(result.stats.warnings,[],'a rejected candidate does not label the successfully applied set as unavailable');
  assertRaw(p,next);assert.deepEqual(p,snapshot);
});

test('a requested order never overrides module locks, locked pockets or manual module dimensions',async()=>{
  for(const protection of ['module','tool','manual']){
    const p=addToolGroup(base(),toolsOf('hex-key-set-1-5-10mm'),{arrangement:'ordered',order:'asc',toolSet:{id:'hex',layout:'shared'}}).project;
    if(protection==='module')p.modules[0].locked=true;if(protection==='tool')p.tools[3].locked=true;if(protection==='manual')p.modules[0].sizeMode='manual';p.toolSets[0].order='desc';const snapshot=structuredClone(p);
    const result=await smartArrange(p,{mode:'sets'});assert.deepEqual(result.modules,p.modules);assert.deepEqual(result.tools,p.tools);assert.deepEqual(p,snapshot);assert.ok(result.stats.warnings.some(w=>/zamčené nebo ručně/.test(w)),'protected set reports why its order was not changed');
  }
});

test('legacy coherence ignores positional size order, still rejects opposite headings, and compact explicitly permits 180 degrees',()=>{
  // Predicate fixture: deliberately reverse one pocket. Whether the packer chooses a flip is a separate optimisation.
  const tools=[8,10,13].map((value,index)=>({id:'tool-'+index,name:'Tool '+value,nominalSize:{value,unit:'mm'},points:[{x:0,y:0},{x:20,y:0},{x:20,y:60},{x:0,y:60}],x:index*168+40,y:30,rotation:0,depth:8,moduleId:'m'+index,fingerGrips:[]}));
  for(const tool of tools)tool.rotation=analyzeToolShape(tool).rotation;tools[1].rotation+=180;
  const p={...base(),tools,modules:tools.map((tool,index)=>({id:tool.moduleId,x:index*168,y:0,width:126,height:126,sizeMode:'manual'})),toolSets:[{id:'hex',name:'Predicate',toolIds:tools.map(t=>t.id),layout:'uniform',arrangement:'compact',order:'asc'}]};
  assert.deepEqual(validateLayout(p),[],'the deliberately opposing pockets remain valid in their separate modules');
  const compact=findToolSets(p).sets[0];assert.equal(setCoherence(p,[compact]).score,tools.length);assert.equal(setCoherence(p,[compact]).details[0].orderAligned,true);
  const legacy={...compact};delete legacy.arrangement;delete legacy.order;
  assert.equal(setCoherence(p,[legacy]).score,0,'compact opposing rows do not weaken legacy heading strictness');
  const common=structuredClone(p);common.tools.forEach(t=>t.rotation=analyzeToolShape(t).rotation);assert.equal(setCoherence(common,[legacy]).score,tools.length,'legacy sets still only require membership, footprint and headings');
});
