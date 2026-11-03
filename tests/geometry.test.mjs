import test from 'node:test';
import assert from 'node:assert/strict';
import {bounds, transformedPoints, autoArrange,validateLayout,exportSVG,exportDXF,exportSTL,zipFiles,createDemoProject} from '../dist/geometry.js';

test('rotation keeps x and y as rotated bounding box origin; clearance expands in mm',()=>{
  const t={id:'t',points:[{x:10,y:20},{x:30,y:20},{x:30,y:30},{x:10,y:30}],x:50,y:60,rotation:90};
  const b=bounds(t);assert.ok(Math.abs(b.x-50)<1e-8);assert.ok(Math.abs(b.y-60)<1e-8);assert.ok(Math.abs(b.width-10)<1e-8);assert.ok(Math.abs(b.height-20)<1e-8);
  const p=transformedPoints(t,1);assert.equal(Math.min(...p.map(p=>p.x)),49);assert.equal(Math.max(...p.map(p=>p.y)),81);
});
test('demo packs all tools without collisions; all modules follow 42mm grid',()=>{
  const p=createDemoProject();assert.equal(p.tools.length,6);assert.equal(p.modules.length,6);assert.deepEqual(validateLayout(p),[]);
  for(const m of p.modules)for(const key of ['x','y','width','height'])assert.equal(m[key]%42,0);
  assert.ok(p.tools.every(t=>t.rotation===0));const packed=autoArrange(p);assert.equal(packed.unplaced.length,0);assert.deepEqual(validateLayout({...p,...packed}),[]);
});
test('locked tool and module remain unchanged when adding a tool or extending drawer',()=>{
  const p=createDemoProject();p.tools[0].locked=true;p.modules[1].locked=true;
  const locked=[p.tools[0].moduleId,p.modules[1].id],before=p.modules.filter(m=>locked.includes(m.id));
  const t={...structuredClone(p.tools[2]),id:'additional',name:'New',locked:false,moduleId:null};p.tools.push(t);p.height+=84;
  const after=autoArrange(p);assert.deepEqual(after.modules.filter(m=>locked.includes(m.id)),before);assert.deepEqual(after.tools[0],p.tools[0]);assert.equal(after.unplaced.length,0);
});
test('unlocked user-created empty modules persist as obstacles during packing',()=>{
  const p=createDemoProject(),filler={id:'filler',name:'Výplň',x:336,y:168,width:84,height:84,locked:false};p.modules.push(filler);
  const result=autoArrange(p);assert.deepEqual(result.modules.find(m=>m.id==='filler'),filler);assert.deepEqual(validateLayout({...p,...result}),[]);
  const repacked=autoArrange({...p,...result},{preserveLocked:false});assert.deepEqual(repacked.modules.find(m=>m.id==='filler'),filler);
});
test('packing reports oversized tools and does not create phantom modules',()=>{
  const p=createDemoProject();p.width=42;p.height=42;const result=autoArrange(p);assert.equal(result.unplaced.length,p.tools.length);assert.equal(result.modules.length,0);assert.ok(result.tools.every(t=>t.moduleId===null&&t.x>p.width));
  const y=result.tools.map(t=>t.y);assert.equal(new Set(y).size,y.length,'unplaced tools must not stack at stale drawer coordinates');
});
test('validation identifies overlapping, outside and overdeep geometry',()=>{
  const p=createDemoProject();p.modules[1].x=p.modules[0].x;p.modules[1].y=p.modules[0].y;p.tools[0].depth=100;p.modules[2].x=-1;
  const issues=validateLayout(p);assert.ok(issues.some(i=>i.type==='overlap'));assert.ok(issues.some(i=>i.type==='outside'));assert.ok(issues.some(i=>i.type==='depth'));assert.throws(()=>exportSTL(p));
});
test('SVG and DXF use millimetres and escape project text',()=>{
  const p=createDemoProject();p.name='<test & "project">';const svg=exportSVG(p),dxf=exportDXF(p);
  assert.ok(svg.includes('width="420mm"'));assert.ok(svg.includes('&lt;test &amp; &quot;project&quot;&gt;'));assert.ok(svg.includes('data-depth-mm="13"'));
  assert.ok(dxf.includes('$INSUNITS\r\n70\r\n4'));assert.equal((dxf.match(/LWPOLYLINE/g)||[]).length,12);
  const m=p.modules[0];assert.ok(exportSVG(p,{moduleId:m.id}).includes(`width="${m.width}mm"`));
});
function inspectSTL(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(80,true),edges=new Map();let volume=0,minZ=Infinity,maxZ=-Infinity;
  assert.equal(bytes.length,84+count*50);
  const key=p=>p.map(x=>Math.round(x*1e5)/1e5).join(',');
  for(let i=0;i<count;i++){
    const offset=84+i*50,vertices=[];
    for(let v=0;v<3;v++){const p=[];for(let c=0;c<3;c++)p.push(view.getFloat32(offset+12+v*12+c*4,true));vertices.push(p);minZ=Math.min(minZ,p[2]);maxZ=Math.max(maxZ,p[2]);}
    const [a,b,c]=vertices;volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    const normal=[0,1,2].map(c=>view.getFloat32(offset+c*4,true));assert.ok(Math.abs(Math.hypot(...normal)-1)<1e-5,'facet normal must be unit length');
    for(let j=0;j<3;j++){const a=key(vertices[j]),b=key(vertices[(j+1)%3]),edge=a<b?`${a}|${b}`:`${b}|${a}`,entry=edges.get(edge)||{count:0,direction:0};entry.count++;entry.direction+=a<b?1:-1;edges.set(edge,entry);}
  }
  for(const [edge,v] of edges){assert.equal(v.count,2,`edge ${edge} is not shared by two facets`);assert.equal(v.direction,0,`edge ${edge} has inconsistent winding`);}
  return {count,volume,minZ,maxZ};
}
test('every STL is watertight, consistently oriented, and contains a real pocket',()=>{
  const p=createDemoProject();const all=inspectSTL(exportSTL(p));assert.equal(all.minZ,0);assert.equal(all.maxZ,20);assert.ok(all.volume>0);
  for(const m of p.modules){const mesh=inspectSTL(exportSTL(p,{moduleId:m.id}));assert.ok(mesh.volume>0);assert.ok(mesh.volume<(m.width-.5)*(m.height-.5)*p.insertHeight,'pocket must remove volume');}
});
test('STL rectangular pocket removes expected material and retains minimum floor',()=>{
  const p={width:42,height:42,grid:42,clearance:1,wall:2,base:2,insertHeight:20,modules:[{id:'m',x:0,y:0,width:42,height:42}],tools:[{id:'t',name:'test',x:10,y:10,rotation:0,moduleId:'m',depth:8,points:[{x:0,y:0},{x:20,y:0},{x:20,y:10},{x:0,y:10}]}]};
  // Expanding a rectangle by a 1mm disk creates four round corners.
  const mesh=inspectSTL(exportSTL(p));assert.ok(Math.abs(mesh.volume-(41.5*41.5*20-(200+60+Math.PI)*8))<1);
});
test('clearance safely closes a narrow concave slot and still exports a watertight pocket',()=>{
  const points=[[0,0],[9,0],[9,25],[10,25],[10,0],[20,0],[20,40],[0,40]].map(([x,y])=>({x,y}));
  const p={width:84,height:84,grid:42,clearance:1,wall:2.4,base:2.4,insertHeight:20,tools:[{id:'concave',name:'Narrow slot',points,x:0,y:0,rotation:0,depth:10,moduleId:null}],modules:[]};
  Object.assign(p,autoArrange(p));assert.deepEqual(validateLayout(p),[]);const mesh=inspectSTL(exportSTL(p));assert.ok(mesh.volume>0);
});
test('raw crossing and self-touching contours are rejected before clearance can hide them',()=>{
  for(const coords of [[[0,0],[20,20],[0,20],[20,0]],[[0,0],[20,0],[20,20],[10,10],[0,20],[10,10]]]){
    const p={width:84,height:84,clearance:1,wall:2,base:2,insertHeight:20,modules:[{id:'m',x:0,y:0,width:84,height:84}],tools:[{id:'bad',name:'Bad',x:20,y:20,moduleId:'m',depth:8,points:coords.map(([x,y])=>({x,y}))}]};
    assert.ok(validateLayout(p).some(i=>i.type==='overlap'&&i.ids.includes('bad')));assert.throws(()=>exportSTL(p));
  }
});
function twoPocketProject(x,y,{clearance=0}={}){
  const points=[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}];
  return {width:84,height:84,grid:42,clearance,wall:2.4,base:2.4,insertHeight:20,modules:[{id:'m',x:0,y:0,width:84,height:84}],tools:[
    {id:'a',name:'A',points,x:10,y:10,rotation:0,depth:8,moduleId:'m'},
    {id:'b',name:'B',points,x,y,rotation:0,depth:12,moduleId:'m'}
  ]};
}
test('pockets touching along an edge or at a vertex block every manufacturing export',()=>{
  for(const [x,y] of [[30,10],[30,30]]){
    const p=twoPocketProject(x,y);
    assert.ok(validateLayout(p).some(i=>i.type==='overlap'&&i.ids.includes('a')&&i.ids.includes('b')&&/dotýkají/.test(i.message)));
    for(const exporter of [exportSTL,exportSVG,exportDXF]){
      assert.throws(()=>exporter(p),/dotýkají/);
      assert.throws(()=>exporter(p,{moduleId:'m'}),/dotýkají/);
    }
  }
});
test('minimum internal wall is measured between the pockets after clearance',()=>{
  const p=twoPocketProject(32,10,{clearance:.5});
  assert.ok(validateLayout(p).some(i=>i.ids.includes('a')&&i.ids.includes('b')&&/stěnu 2.4 mm/.test(i.message)));
  for(const exporter of [exportSTL,exportSVG,exportDXF])assert.throws(()=>exporter(p),/stěnu/);
  p.tools[1].x=33.4;
  assert.deepEqual(validateLayout(p),[]);
  assert.ok(inspectSTL(exportSTL(p)).volume>0);
  assert.ok(exportSVG(p));assert.ok(exportDXF(p));
});
test('diagonal pocket spacing uses contour distance rather than bounding box padding',()=>{
  const p=twoPocketProject(31.6,31.6);
  assert.ok(validateLayout(p).some(i=>/stěnu/.test(i.message)));
  p.tools[1].x=31.8;p.tools[1].y=31.8;
  assert.deepEqual(validateLayout(p),[]);
  assert.ok(inspectSTL(exportSTL(p)).volume>0);
});
test('increasing clearance beyond module wall blocks manufacturing export',()=>{
  const p=createDemoProject();p.clearance=30;assert.ok(validateLayout(p).some(i=>i.type==='outside'));assert.throws(()=>exportSTL(p));
});
test('full export cannot silently omit unplaced tools; single valid module can be exported',()=>{
  const p=createDemoProject(),moduleId=p.modules[0].id;
  p.tools.push({...structuredClone(p.tools[0]),id:'unplaced',moduleId:null,x:600});
  assert.throws(()=>exportSTL(p),/nemá umístěný modul/);assert.throws(()=>exportSVG(p));assert.throws(()=>exportDXF(p));
  assert.ok(exportSTL(p,{moduleId}).length>84);
});
test('ZIP archive carries real local and central records with UTF8 filenames',()=>{
  const bytes=zipFiles([{name:'kleště.svg',data:'abc'},{name:'mesh.stl',data:new Uint8Array([1,2,3,4])}]),v=new DataView(bytes.buffer);
  assert.equal(v.getUint32(0,true),0x04034b50);assert.equal(v.getUint32(bytes.length-22,true),0x06054b50);assert.equal(v.getUint16(bytes.length-14,true),2);assert.equal(v.getUint16(6,true),0x800);
  const size=v.getUint16(26,true);assert.equal(new TextDecoder().decode(bytes.slice(30,30+size)),'kleště.svg');assert.equal(v.getUint32(22,true),3);assert.equal(v.getUint32(14,true),0x352441c2);
});

test('layout issues follow the active language and display unit, exports stay metric',async()=>{
  const {setLang}=await import('../dist/i18n.js'),{setAppUnit}=await import('../dist/units.js'),{errorText}=await import('../dist/i18n.js');
  const p=twoPocketProject(32,10,{clearance:.5});
  setLang('en',{save:false});setAppUnit('in',{save:false});
  try{
    const issue=validateLayout(p).find(i=>i.ids.includes('a')&&i.ids.includes('b'));
    assert.match(issue.message,/not enough room for a 0\.094 in wall between pockets/);
    assert.throws(()=>exportSTL(p),/0\.094 in wall/);
    const outside=createDemoProject();outside.modules[0].x=400;
    assert.ok(validateLayout(outside).some(i=>/extends beyond the drawer/.test(i.message)));
    assert.match(createDemoProject().tools[0].name,/Combination pliers/);
    const ok=createDemoProject();assert.match(exportSVG(ok),/width="420mm"/);assert.match(exportSVG(ok),/Dimensions in mm/);
    let error;try{exportSTL(p);}catch(e){error=e;}
    setLang('cs',{save:false});setAppUnit('mm',{save:false});
    assert.match(errorText(error),/Mezi kapsami .* stěnu 0\.094 in/,'re-translation keeps the parameters captured at creation');
    assert.match(validateLayout(p).find(i=>i.ids.includes('a')).message,/stěnu 2,4 mm/);
  }finally{setLang('cs',{save:false});setAppUnit('mm',{save:false});}
});
