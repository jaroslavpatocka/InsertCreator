import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {autoArrange,resizeModule,pocketOutline,validateLayout,exportSTL,exportFitSTL,exportSVG,exportDXF} from '../dist/geometry.js';

const rectangle=(width,height)=>[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
function sharedProject(){
  return {...blankProject(),name:'Společný modul',width:420,height:336,printMode:'solid',limitToBed:false,
    modules:[{id:'shared-a-b',name:'Dva nástroje',x:42,y:42,width:168,height:168,locked:false,sizeMode:'auto',grouped:true}],
    tools:[
      {id:'a',name:'A',points:rectangle(20,60),x:60,y:60,rotation:0,depth:8,moduleId:'shared-a-b',locked:false,fingerGrips:[{id:'a-grip',x:0,y:30,radius:7}]},
      {id:'b',name:'B',points:rectangle(20,40),x:110,y:70,rotation:90,depth:12,moduleId:'shared-a-b',locked:false,fingerGrips:[{id:'b-grip',x:20,y:20,radius:6}]}
    ]};
}
const own=project=>project.tools.filter(t=>t.moduleId==='shared-a-b');
const group=project=>project.modules.find(m=>m.id==='shared-a-b');
function preserved(before,after){
  assert.equal(own(after).length,own(before).length);
  for(const t of own(before)){
    const next=after.tools.find(next=>next.id===t.id);
    for(const key of ['points','rotation','depth','fingerGrips','moduleId','locked','name'])assert.deepEqual(next[key],t[key],key+' must survive rigid group packing');
  }
  const a=own(before),b=own(after);
  for(let i=1;i<a.length;i++){
    assert.ok(Math.abs((a[i].x-a[0].x)-(b[i].x-b[0].x))<.001);
    assert.ok(Math.abs((a[i].y-a[0].y)-(b[i].y-b[0].y))<.001);
  }
}
function inspect(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(80,true),edges=new Map(),zs=new Set();let volume=0;
  assert.equal(bytes.length,84+count*50);
  const key=p=>p.map(n=>Math.round(n*1e5)/1e5).join(',');
  for(let i=0;i<count;i++){
    const vertices=Array.from({length:3},(_,j)=>[0,1,2].map(c=>view.getFloat32(84+i*50+12+j*12+c*4,true)));
    assert.ok(vertices.flat().every(Number.isFinite));vertices.forEach(p=>zs.add(Math.round(p[2]*1e4)/1e4));
    const [a,b,c]=vertices;volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    for(let j=0;j<3;j++){const a=key(vertices[j]),b=key(vertices[(j+1)%3]),k=a<b?a+'|'+b:b+'|'+a,e=edges.get(k)||{count:0,direction:0};e.count++;e.direction+=a<b?1:-1;edges.set(k,e);}
  }
  for(const [key,e] of edges){assert.equal(e.count,2,'non-manifold edge '+key);assert.equal(e.direction,0,'incorrect facet winding '+key);}
  assert.ok(volume>0);return{zs,volume};
}

test('shared metadata and all existing metric, print and tool settings survive JSON reload',()=>{
  const p={...sharedProject(),printMode:'light',bottomMode:'magnet',bedWidth:256,bedHeight:180,magnetDiameter:6.4,magnetDepth:2.5};
  const restored=validateProject(JSON.parse(JSON.stringify({schemaVersion:1,project:p})));
  assert.equal(group(restored).grouped,true);assert.deepEqual(restored.tools,p.tools);assert.deepEqual(restored.modules,p.modules);
  for(const key of ['width','height','grid','clearance','gap','wall','base','insertHeight','printMode','bottomMode','bedWidth','bedHeight','limitToBed','magnetDiameter','magnetDepth'])assert.equal(restored[key],p[key]);
  for(const value of [undefined,false,'true',1]){
    const legacy=sharedProject();if(value===undefined)delete legacy.modules[0].grouped;else legacy.modules[0].grouped=value;
    assert.equal(Object.hasOwn(validateProject(legacy).modules[0],'grouped'),false,'legacy modules must not acquire grouped:false');
  }
});

test('normal Auto packs shared modules as rigid groups and refits their full finger pockets',()=>{
  const source=sharedProject(),snapshot=structuredClone(source),packed={...source,...autoArrange(source)},m=group(packed);
  assert.equal(packed.modules.length,1);assert.equal(m.grouped,true);assert.equal(m.sizeMode,'auto');assert.equal(m.name,'Dva nástroje');
  assert.equal(m.width,126);assert.equal(m.height,84);assert.ok(m.x!==42||m.y!==42);
  preserved(source,packed);assert.deepEqual(source,snapshot);assert.deepEqual(validateLayout(packed),[]);
  const points=packed.tools.flatMap(t=>pocketOutline(t,packed.clearance)),xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  assert.ok(Math.min(...xs)>=m.x+packed.wall+.25-.001);assert.ok(Math.max(...xs)<=m.x+m.width-packed.wall-.25+.001);
  assert.ok(Math.min(...ys)>=m.y+packed.wall+.25-.001);assert.ok(Math.max(...ys)<=m.y+m.height-packed.wall-.25+.001);
  const again={...packed,...autoArrange(packed)};assert.deepEqual(group(again),m);preserved(packed,again);assert.deepEqual(validateLayout(again),[]);
});

test('editing or deleting a shared member refits the group without splitting or scaling survivors',()=>{
  const packed={...sharedProject(),...autoArrange(sharedProject())},edited=structuredClone(packed);edited.tools[0].fingerGrips[0].radius=40;
  const expanded={...edited,...autoArrange(edited)};
  assert.equal(group(expanded).grouped,true);assert.ok(group(expanded).width>group(packed).width);preserved(edited,expanded);assert.deepEqual(validateLayout(expanded),[]);
  const reduced={...packed,tools:packed.tools.filter(t=>t.id==='a')},result={...reduced,...autoArrange(reduced)};
  assert.equal(result.modules.length,1);assert.equal(group(result).id,'shared-a-b');assert.equal(group(result).grouped,true);assert.equal(group(result).width,42);assert.equal(group(result).height,84);
  preserved(reduced,result);assert.deepEqual(validateLayout(result),[]);
});

test('manual sizes, module or member locks and explicit fillers keep their existing meaning',()=>{
  const original=sharedProject(),manual=resizeModule(original,'shared-a-b',{width:151.5,height:139.25,mode:'manual'});
  manual.modules.push({id:'filler',name:'Výplň',x:0,y:0,width:42,height:42,locked:false});
  const packed={...manual,...autoArrange(manual)};
  assert.equal(group(packed).width,151.5);assert.equal(group(packed).height,139.25);assert.equal(group(packed).sizeMode,'manual');assert.equal(group(packed).grouped,true);
  preserved(manual,packed);assert.deepEqual(packed.modules.find(m=>m.id==='filler'),manual.modules[1]);assert.deepEqual(validateLayout(packed),[]);
  for(const variant of ['module','member']){
    const fixed=sharedProject();if(variant==='module')fixed.modules[0].locked=true;else fixed.tools[0].locked=true;
    const result=autoArrange(fixed);assert.deepEqual(result.modules,fixed.modules);assert.deepEqual(result.tools,fixed.tools);
  }
});

test('an oversized shared group remains reloadable and recovers without losing members or metadata',()=>{
  const source={...sharedProject(),width:42,height:42},result=autoArrange(source);
  assert.deepEqual([...result.unplaced].sort(),['a','b']);assert.equal(result.modules.length,1);assert.equal(result.modules[0].grouped,true);assert.equal(result.modules[0].name,'Dva nástroje');
  const restored=validateProject(JSON.parse(JSON.stringify({...source,...result}))),larger={...restored,width:420,height:336},packed={...larger,...autoArrange(larger)};
  assert.equal(group(packed).grouped,true);assert.equal(packed.unplaced.length,0);preserved(source,packed);assert.deepEqual(validateLayout(packed),[]);
  const bedLimited={...packed,limitToBed:true,bedWidth:100,bedHeight:100},bedResult=autoArrange(bedLimited);
  assert.deepEqual([...bedResult.unplaced].sort(),['a','b']);assert.equal(bedResult.modules.length,1);preserved(packed,{...bedLimited,...bedResult});
  assert.throws(()=>exportSTL(bedLimited),/tiskovou plochu/);
});

test('an invalid member cannot detach or discard the rest of a shared group',()=>{
  const source=sharedProject();source.tools[0].fingerGrips=[{id:'detached',x:500,y:500,radius:9}];
  const snapshot=structuredClone(source),result=autoArrange(source),after={...source,...result};
  assert.deepEqual([...result.unplaced].sort(),['a','b']);assert.equal(result.modules.length,1);assert.equal(group(after).grouped,true);assert.equal(group(after).name,'Dva nástroje');
  preserved(source,after);assert.deepEqual(source,snapshot);
  const restored=validateProject(JSON.parse(JSON.stringify(after)));assert.equal(group(restored).grouped,true);assert.equal(own(restored).length,2);
  assert.ok(validateLayout(restored).some(issue=>issue.ids.includes('a')&&/Výřezy pro prsty/.test(issue.message)));
});

test('shared cavities preserve per-tool depths, real finger spacing and watertight manufacturing exports',()=>{
  const p={...sharedProject(),...autoArrange(sharedProject())};
  const svg=exportSVG(p),dxf=exportDXF(p);
  assert.match(svg,/data-depth-mm="8"/);assert.match(svg,/data-depth-mm="12"/);assert.equal((svg.match(/<path id=/g)||[]).length,2);assert.equal((dxf.match(/LWPOLYLINE/g)||[]).length,3);
  for(const printMode of ['solid','light'])for(const bottomMode of ['plain','grid','magnet','adhesive']){
    const mesh=inspect(exportSTL({...p,printMode,bottomMode}));
    const base=bottomMode==='magnet'?Math.max(p.base,p.magnetDepth+1.2):p.base,foot=bottomMode==='grid'?4.75:0;
    const expected=printMode==='solid'?[foot+p.insertHeight+(base-p.base)-8,foot+p.insertHeight+(base-p.base)-12]:[foot+base+8,foot+base+12];
    for(const z of expected)assert.ok(mesh.zs.has(Math.round(z*1e4)/1e4),`${printMode}/${bottomMode}: each pocket keeps its own depth`);
  }
  const fit=inspect(exportFitSTL(p));assert.deepEqual([...fit.zs].sort((a,b)=>a-b),[0,1]);
  const tooClose=sharedProject();tooClose.tools[1].x=82;
  assert.ok(validateLayout(tooClose).some(i=>i.type==='overlap'&&i.ids.includes('a')&&i.ids.includes('b')),'a shared module must retain the minimum wall between expanded finger pockets');
});
