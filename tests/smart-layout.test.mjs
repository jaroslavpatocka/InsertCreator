import test from 'node:test';
import assert from 'node:assert/strict';
import {smartArrange} from '../dist/smart-layout.js';
import {autoArrange,pocketOutline,validateLayout} from '../dist/geometry.js';
import {blankProject} from '../dist/model.js';
import {automaticFingerGrips} from '../dist/finger-grip.js';
import {screwdriverProject} from './fixtures/smart-tools.mjs';

const rectangle=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const moduleArea=modules=>modules.reduce((sum,m)=>sum+(m.width-.5)*(m.height-.5),0);
const box=points=>({minX:Math.min(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxX:Math.max(...points.map(p=>p.x)),maxY:Math.max(...points.map(p=>p.y))});
function distanceToSegment(p,a,b){const x=b.x-a.x,y=b.y-a.y,l=x*x+y*y,t=l?Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/l)):0;return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y);}
function contourDistance(a,b){let distance=Infinity;for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++)distance=Math.min(distance,distanceToSegment(a[i],b[j],b[(j+1)%b.length]),distanceToSegment(b[j],a[i],a[(i+1)%a.length]));return distance;}
function assertPreserved(source,result){
  assert.equal(result.tools.length,source.tools.length);assert.equal(new Set(result.tools.map(t=>t.id)).size,source.tools.length);assert.equal(new Set(result.modules.map(m=>m.id)).size,result.modules.length);
  for(const original of source.tools){
    const tool=result.tools.find(t=>t.id===original.id);
    for(const key of Object.keys(original).filter(key=>!['x','y','rotation','moduleId'].includes(key)))assert.deepEqual(tool[key],original[key],`${original.id}: ${key}`);
  }
}
function assertPocketAir(project,result){
  const combined={...project,...result};assert.deepEqual(validateLayout(combined),[]);
  for(const module of result.modules){const own=result.tools.filter(t=>t.moduleId===module.id);for(let i=0;i<own.length;i++)for(let j=i+1;j<own.length;j++){
    assert.ok(contourDistance(pocketOutline(own[i],project.clearance),pocketOutline(own[j],project.clearance))>=Math.max(project.wall,project.gap)-.001,'whole pockets including finger bays must retain the requested material separation');
  }}
}

test('six slanted screwdrivers genuinely interleave with finger access and save at least a quarter of individual module area',async()=>{
  const project=screwdriverProject(),snapshot=structuredClone(project),result=await smartArrange(project);
  assert.equal(result.unplaced.length,0);assert.ok(result.stats.sharedModules>=2);assert.ok(result.stats.savedPercent>=25);assert.equal(result.stats.beforeArea,moduleArea(project.modules));assert.equal(result.stats.afterArea,moduleArea(result.modules));
  assertPreserved(project,result);assertPocketAir(project,result);assert.deepEqual(project,snapshot);
  let interleaved=0;
  for(const module of result.modules.filter(m=>m.grouped)){
    assert.equal(module.sizeMode,'auto');const own=result.tools.filter(t=>t.moduleId===module.id);assert.ok(own.length>=2);
    const a=box(pocketOutline(own[0],project.clearance)),b=box(pocketOutline(own[1],project.clearance));
    if(Math.min(a.maxX,b.maxX)>Math.max(a.minX,b.minX)&&Math.min(a.maxY,b.maxY)>Math.max(a.minY,b.minY))interleaved++;
  }
  assert.ok(interleaved>=2,'disjoint outlines must overlap their bounding boxes: this is shape nesting, not box concatenation');
  const json=JSON.parse(JSON.stringify({...project,tools:result.tools,modules:result.modules}));
  assert.deepEqual(json.tools,result.tools);assert.deepEqual(json.modules,result.modules);
});

test('seeded sizes, straight contours and repeat runs are deterministic without growing or dissolving groups',async()=>{
  for(const seed of [2,7,19]){
    const project=screwdriverProject(seed,{slanted:seed!==7}),first=await smartArrange(project),again=await smartArrange(project);
    assert.deepEqual(first,again);assert.ok(first.stats.savedPercent>=25);assert.ok(first.stats.sharedModules>0);assertPocketAir(project,first);
    const repeated=await smartArrange({...project,tools:first.tools,modules:first.modules});
    assert.deepEqual(repeated.tools,first.tools);assert.deepEqual(repeated.modules,first.modules);assert.equal(repeated.stats.changed,false);
  }
});

test('rectangles with no useful contour-saving arrangement remain individual instead of being blindly merged',async()=>{
  const tools=Array.from({length:2},(_,i)=>{const tool={id:'rect-'+i,name:'Obdélník',points:rectangle(100,100),x:0,y:0,rotation:0,depth:10,moduleId:null};return{...tool,fingerGrips:automaticFingerGrips(tool)};});
  const source={...blankProject(),width:378,height:252,limitToBed:false,tools},project={...source,...autoArrange(source)},result=await smartArrange(project);
  assert.equal(result.stats.sharedModules,0);assert.equal(result.modules.length,2);assert.ok(result.stats.afterArea<=result.stats.beforeArea);assertPreserved(project,result);assertPocketAir(project,result);
});

test('locks, manual groups, fill modules and their units retain all protected geometry and metadata',async()=>{
  const project=screwdriverProject(3,{width:840,height:630});project.modules[0].locked=true;project.tools.find(t=>t.moduleId===project.modules[1].id).locked=true;
  project.modules.push({id:'manual',name:'Moje dvojice',unit:'in',x:0,y:420,width:126,height:126,sizeMode:'manual',grouped:true,locked:false},{id:'filler',name:'Výplň',unit:'mm',x:756,y:588,width:42,height:42,sizeMode:'manual',locked:false});
  project.tools.push({id:'manual-a',name:'A',unit:'mm',points:rectangle(20,40),x:16,y:436,rotation:0,depth:10,moduleId:'manual',fingerGrips:[]},{id:'manual-b',name:'B',unit:'in',points:rectangle(20,40),x:70,y:446,rotation:0,depth:10,moduleId:'manual',fingerGrips:[]});
  const fixedIds=[project.modules[0].id,project.modules[1].id,'filler'],result=await smartArrange(project);assert.equal(result.unplaced.length,0);assertPreserved(project,result);
  for(const id of fixedIds){assert.deepEqual(result.modules.find(m=>m.id===id),project.modules.find(m=>m.id===id));for(const tool of project.tools.filter(t=>t.moduleId===id))assert.deepEqual(result.tools.find(t=>t.id===tool.id),tool);}
  const before=project.modules.find(m=>m.id==='manual'),after=result.modules.find(m=>m.id==='manual');
  for(const key of Object.keys(before).filter(key=>!['x','y'].includes(key)))assert.deepEqual(after[key],before[key]);
  for(const tool of project.tools.filter(t=>t.moduleId==='manual')){const moved=result.tools.find(t=>t.id===tool.id);assert.ok(Math.abs((moved.x-after.x)-(tool.x-before.x))<1e-9);assert.ok(Math.abs((moved.y-after.y)-(tool.y-before.y))<1e-9);}
  assertPocketAir(project,result);
});

test('explicitly deleted finger bays remain deleted and separate; legacy absence may gain access only in accepted new groups',async()=>{
  const explicit=screwdriverProject(5);explicit.tools[0].fingerGrips=[];const result=await smartArrange(explicit),deleted=result.tools.find(t=>t.id===explicit.tools[0].id);
  assert.deepEqual(deleted.fingerGrips,[]);assert.equal(result.tools.filter(t=>t.moduleId===deleted.moduleId).length,1);assertPocketAir(explicit,result);
  let legacy=screwdriverProject(6,{grips:false,slanted:false});
  legacy.tools=legacy.tools.map(tool=>({...tool,points:tool.points.map(p=>({x:p.x*1.8,y:p.y})),x:0,y:0,moduleId:null}));legacy.modules=[];legacy={...legacy,...autoArrange(legacy)};
  const snapshot=structuredClone(legacy),arranged=await smartArrange(legacy);
  assert.ok(arranged.stats.sharedModules>0);assert.deepEqual(legacy,snapshot);
  for(const tool of arranged.tools)if(Object.hasOwn(tool,'fingerGrips')){assert.equal(tool.fingerGrips.length,2);assert.ok(arranged.modules.find(m=>m.id===tool.moduleId).grouped);assert.ok(tool.fingerGrips.every(g=>g.radius===9));}
  assertPocketAir(legacy,arranged);
});

test('printer limits are enforced without newly abandoning any previously placed tool',async()=>{
  const project=screwdriverProject(9,{bed:210}),result=await smartArrange(project);assert.equal(result.unplaced.length,0);
  for(const module of result.modules)assert.ok((module.width-.5<=210&&module.height-.5<=210)||(module.width-.5<=210&&module.height-.5<=210));
  assertPocketAir(project,result);
  const small=screwdriverProject(9,{bed:120}),unchanged=await smartArrange(small);assert.deepEqual(unchanged.tools,small.tools);assert.deepEqual(unchanged.modules,small.modules);assert.equal(unchanged.stats.changed,false);
});

test('new group IDs avoid fixed-ID collisions and inherit the deterministic first source module unit',async()=>{
  const project=screwdriverProject(10,{count:2}),first=await smartArrange(project),id=first.modules.find(m=>m.grouped).id;
  const firstTool=[...project.tools].sort((a,b)=>a.id.localeCompare(b.id))[0];project.modules.find(m=>m.id===firstTool.moduleId).unit='in';project.unit='mm';
  const filler={id,name:'Kolizní identifikátor',x:0,y:378,width:42,height:42,unit:'mm'};project.modules.push(filler);
  const result=await smartArrange(project),group=result.modules.find(m=>m.grouped);assert.ok(group);assert.notEqual(group.id,id);assert.equal(group.unit,'in');assert.deepEqual(result.modules.find(m=>m.id===id),filler);assertPreserved(project,result);assertPocketAir(project,result);
});

test('already unplaced locked modules survive exactly and are reported consistently',async()=>{
  const project=screwdriverProject(12,{count:2}),module={id:'offscreen',name:'Zamčený mimo šuplík',x:672,y:0,width:84,height:84,locked:true,sizeMode:'manual',unit:'in'};
  const tool={id:'offscreen-tool',name:'Mimo',points:rectangle(20,20),x:682,y:10,rotation:0,depth:10,moduleId:module.id,locked:true,unit:'mm'};project.modules.push(module);project.tools.push(tool);
  const result=await smartArrange(project);assert.deepEqual(result.modules.find(m=>m.id===module.id),module);assert.deepEqual(result.tools.find(t=>t.id===tool.id),tool);assert.deepEqual(result.unplaced,[tool.id]);
});

test('different group memberships cannot collide when tool IDs contain separator characters',async()=>{
  let project=screwdriverProject(15,{count:4,slanted:false});const ids=['a','b|c','a|b','c'];
  project.tools=project.tools.map((tool,i)=>{const length=Math.max(...tool.points.map(p=>p.y)),scale=(i<2?190:120)/length;return{...tool,id:ids[i],moduleId:null,x:0,y:0,points:tool.points.map(p=>({x:p.x,y:p.y*scale})),fingerGrips:tool.fingerGrips.map(grip=>({...grip,y:grip.y*scale}))};});
  project.modules=[];project={...project,...autoArrange(project)};
  const result=await smartArrange(project);assert.ok(result.stats.sharedModules>=2);assertPreserved(project,result);assertPocketAir(project,result);
});

test('invalid inputs reject clearly, large inputs retain their baseline and cancellation never mutates a project',async()=>{
  const project=screwdriverProject(11),snapshot=structuredClone(project),invalid=structuredClone(project);invalid.tools[0].points=rectangle(20,20);invalid.tools[0].fingerGrips=[{id:'far',x:300,y:300,radius:9}];
  await assert.rejects(()=>smartArrange(invalid),/výřez|Výřez/);
  const duplicate=structuredClone(project);duplicate.tools[1].id=duplicate.tools[0].id;await assert.rejects(()=>smartArrange(duplicate),/identifik/);
  const large={...blankProject(),tools:Array.from({length:25},(_,i)=>({id:'large-'+i,name:'Velký projekt',points:rectangle(20,20),x:0,y:0,moduleId:null,depth:10}))};const retained=await smartArrange(large);assert.deepEqual(retained.tools,large.tools);assert.equal(retained.stats.changed,false);assert.equal(retained.unplaced.length,25);
  const aborted=new AbortController();aborted.abort();await assert.rejects(()=>smartArrange(project,{signal:aborted.signal}),{name:'AbortError'});
  const controller=new AbortController();let progress=false;await assert.rejects(()=>smartArrange(project,{signal:controller.signal,onProgress:event=>{if(event.stage==='nesting'){progress=true;controller.abort();}}}),{name:'AbortError'});assert.ok(progress);assert.deepEqual(project,snapshot);
});
