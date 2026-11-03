import test from 'node:test';
import assert from 'node:assert/strict';
import {smartArrange} from '../dist/smart-layout.js';
import {autoArrange,validateLayout,exportSTL} from '../dist/geometry.js';
import {findToolSets,setCoherence,analyzeToolShape} from '../dist/tool-sets.js';
import {blankProject,validateProject} from '../dist/model.js';
import {automaticFingerGrips} from '../dist/finger-grip.js';
import {autoTraceImage} from '../dist/auto-trace.js';
import {screwdriverProject} from './fixtures/smart-tools.mjs';
import {slantedScrewdriversPhoto} from './fixtures/tool-photos.mjs';

const logical=r=>({tools:r.tools,modules:r.modules});
const policy=(p,layout)=>({...p,toolSets:[{id:'user-set',name:'Moje sada',toolIds:p.tools.map(t=>t.id),layout}]});
function preserved(before,after){
  assert.equal(after.tools.length,before.tools.length);
  for(const t of before.tools){const next=after.tools.find(n=>n.id===t.id);assert.ok(next);
    for(const key of Object.keys(t).filter(k=>!['x','y','rotation','moduleId'].includes(k)))assert.deepEqual(next[key],t[key],key+' must not change');
  }
}
function coherent(p,result,expected){
  const next={...p,...result},sets=findToolSets(p).sets,c=setCoherence(next,sets);assert.equal(c.score,expected,JSON.stringify(c));assert.deepEqual(validateLayout(next),[]);
  for(const set of sets){const own=next.tools.filter(t=>set.toolIds.includes(t.id)),headings=own.map(t=>(t.rotation-analyzeToolShape(t).rotation+720)%360);
    for(const heading of headings)assert.ok(Math.min(Math.abs(heading-headings[0]),360-Math.abs(heading-headings[0]))<2,'all set members must face the same way');
  }
  return next;
}
function inspectSTL(bytes){
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=v.getUint32(80,true),edges=new Map();let volume=0;
  assert.equal(bytes.length,84+count*50);const key=p=>p.map(n=>Math.round(n*1e5)/1e5).join(',');
  for(let i=0;i<count;i++){
    const t=Array.from({length:3},(_,j)=>[0,1,2].map(c=>v.getFloat32(84+i*50+12+j*12+c*4,true)));assert.ok(t.flat().every(Number.isFinite));
    const [a,b,c]=t;volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    for(let j=0;j<3;j++){const a=key(t[j]),b=key(t[(j+1)%3]),id=a<b?a+'|'+b:b+'|'+a,e=edges.get(id)||{count:0,direction:0};e.count++;e.direction+=a<b?1:-1;edges.set(id,e);}
  }
  for(const [id,e] of edges){assert.equal(e.count,2,'non-manifold edge '+id);assert.equal(e.direction,0,'incorrect winding '+id);}assert.ok(volume>0);
}

test('a whole screwdriver set chooses one common heading and one complete shared module',async()=>{
  const p=screwdriverProject(),snapshot=structuredClone(p),r=await smartArrange(p,{mode:'sets'}),next=coherent(p,r,6);
  assert.equal(r.modules.length,1);assert.equal(r.modules[0].setLayout,'shared');assert.equal(r.modules[0].grouped,true);assert.equal(r.unplaced.length,0);
  assert.equal(r.stats.setScoreBefore,0);assert.equal(r.stats.setScoreAfter,6);assert.equal(r.stats.setsApplied.length,1);assert.equal(r.stats.setSummary[0].applied,'shared');
  preserved(p,r);assert.deepEqual(p,snapshot);assert.ok(r.stats.afterArea<r.stats.beforeArea);
  for(const printMode of ['solid','light'])inspectSTL(exportSTL({...next,printMode}));
});

test('explicit uniform policy and ordinary Auto preserve exactly equal footprints and raw geometry',async()=>{
  const p=policy(screwdriverProject(3),'uniform');p.tools[0].fingerGrips=[];delete p.tools[1].fingerGrips;
  const r=await smartArrange(p,{mode:'sets'}),next=coherent(p,r,6);assert.equal(r.modules.length,6);
  assert.equal(new Set(r.modules.map(m=>`${m.width},${m.height}`)).size,1);assert.ok(r.modules.every(m=>m.setId==='user-set'&&m.setLayout==='uniform'&&!m.grouped));
  preserved(p,r);assert.deepEqual(r.tools[0].fingerGrips,[]);assert.equal(Object.hasOwn(r.tools[1],'fingerGrips'),false);
  const restored=validateProject(JSON.parse(JSON.stringify(next))),again={...restored,...autoArrange(restored)};
  assert.equal(new Set(again.modules.map(m=>`${m.width},${m.height}`)).size,1);assert.ok(again.modules.every(m=>m.setId==='user-set'&&m.setLayout==='uniform'));
  coherent(restored,again,6);preserved(restored,again);
});

test('a printer that cannot fit the entire shared set falls back to coherent uniform modules',async()=>{
  const p=screwdriverProject(5,{bed:220}),r=await smartArrange(p,{mode:'sets'});coherent(p,r,6);
  assert.equal(r.modules.length,6);assert.ok(r.modules.every(m=>m.setLayout==='uniform'));assert.ok(r.modules.every(m=>m.width-.5<=220&&m.height-.5<=220));preserved(p,r);
  const explicit=policy(p,'shared'),unavailable=await smartArrange(explicit,{mode:'sets'});
  assert.deepEqual(logical(unavailable),logical(explicit),'an unavailable explicit shared policy must not silently create opposite pairs');
  assert.ok(unavailable.stats.warnings.length);assert.equal(unavailable.stats.setSummary[0].status,'unavailable');
});

test('set-aware mode dissolves old automatic opposite pairs and reorganizes all members together',async()=>{
  const p=screwdriverProject(7),compact=await smartArrange(p,{mode:'compact'}),old={...p,...compact};assert.ok(old.modules.some(m=>m.grouped));
  const r=await smartArrange(old,{mode:'sets'});coherent(old,r,6);assert.equal(r.modules.length,1);assert.equal(r.tools.filter(t=>t.moduleId===r.modules[0].id).length,6);preserved(old,r);
});

test('explicit membership overrides similarity and protects locks and manually sized modules',async()=>{
  const p={...blankProject(),width:420,height:336,limitToBed:false,tools:[
    {id:'wide',name:'Široký',points:[{x:0,y:0},{x:70,y:0},{x:70,y:20},{x:0,y:20}],x:0,y:0,rotation:0,depth:9,moduleId:null,locked:false,fingerGrips:[]},
    {id:'long',name:'Dlouhý',points:[{x:0,y:0},{x:10,y:0},{x:10,y:100},{x:0,y:100}],x:0,y:0,rotation:0,depth:12,moduleId:null,locked:false,fingerGrips:[]}
  ]};Object.assign(p,autoArrange(p));p.toolSets=[{id:'manual-family',name:'Vlastní různé nástroje',toolIds:['wide','long'],layout:'uniform'}];
  const r=await smartArrange(p,{mode:'sets'});coherent(p,r,2);assert.equal(r.modules.length,2);preserved(p,r);
  const fixed=screwdriverProject(9);fixed.modules[0].locked=true;fixed.tools.find(t=>t.moduleId===fixed.modules[0].id).locked=true;fixed.modules[1].sizeMode='manual';
  const result=await smartArrange(fixed,{mode:'sets'});assert.deepEqual(logical(result),logical(fixed));assert.ok(result.stats.warnings.length);
});

test('explicitly deleted grips remain deleted and cannot silently enable a shared family',async()=>{
  const p=screwdriverProject(11);p.tools.forEach(t=>t.fingerGrips=[]);
  const r=await smartArrange(p,{mode:'sets'});coherent(p,r,6);assert.ok(r.modules.every(m=>m.setLayout==='uniform'));assert.ok(r.tools.every(t=>t.fingerGrips.length===0));
});

test('raster-derived photo contours form a complete set with mixed pocket depths and legacy grip absence',async()=>{
  const im=slantedScrewdriversPhoto(),trace=await autoTraceImage(im,{pxPerMm:2,kind:'paper'});assert.equal(trace.contours.length,6);
  const p={...blankProject(),width:1100,height:700,limitToBed:false,printMode:'light',tools:trace.contours.map((c,i)=>{
    const x=Math.min(...c.points.map(p=>p.x)),y=Math.min(...c.points.map(p=>p.y)),t={id:`photo-${i}`,name:`Foto ${i+1}`,points:c.points.map(p=>({x:(p.x-x)/2,y:(p.y-y)/2})),x:0,y:0,rotation:0,depth:8+i,moduleId:null,locked:false};
    if(i<2)t.fingerGrips=automaticFingerGrips(t);return t;
  })};Object.assign(p,autoArrange(p));
  const r=await smartArrange(p,{mode:'sets'}),next=coherent(p,r,6);
  assert.ok(r.modules.length===1||r.modules.length===6,'a complete shared set or identical separate modules must replace arbitrary pairs');
  for(const old of p.tools){const tool=r.tools.find(t=>t.id===old.id);assert.deepEqual(tool.points,old.points);assert.equal(tool.depth,old.depth);if(r.modules.length===1)assert.ok(tool.fingerGrips.length>0);else if(Object.hasOwn(old,'fingerGrips'))assert.deepEqual(tool.fingerGrips,old.fingerGrips);else assert.equal(Object.hasOwn(tool,'fingerGrips'),false);}
  if(r.modules.length===6)assert.ok(r.stats.warnings.some(w=>/vyrobit/.test(w)),'a manufacturing fallback must explain why it uses uniform modules');
  for(const printMode of ['solid','light'])inspectSTL(exportSTL({...next,printMode}));
});

test('set mode cancellation is abortable and the bounded limit leaves the source unchanged',async()=>{
  const p=screwdriverProject(),snapshot=structuredClone(p),controller=new AbortController();
  await assert.rejects(smartArrange(p,{mode:'sets',signal:controller.signal,onProgress:()=>controller.abort()}),{name:'AbortError'});assert.deepEqual(p,snapshot);
  const large=screwdriverProject(13,{count:25,width:1260,height:1260}),r=await smartArrange(large,{mode:'sets'});assert.deepEqual(logical(r),logical(large));assert.ok(r.stats.warnings.length);
});
