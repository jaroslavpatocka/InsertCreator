import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {resizeModule,transformedPoints,autoArrange,validateLayout,exportSTL} from '../dist/geometry.js';

const rectangle=(width,height)=>[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
function groupProject(){
  return {...blankProject(),width:420,height:336,printMode:'solid',limitToBed:false,
    modules:[{id:'group',name:'Dva nástroje',x:42,y:42,width:168,height:168,locked:false,sizeMode:'auto'}],
    tools:[
      {id:'a',name:'A',points:rectangle(20,80),x:65,y:65,rotation:30,depth:10,locked:false,moduleId:'group'},
      {id:'b',name:'B',points:rectangle(20,40),x:135,y:95,rotation:90,depth:10,locked:false,moduleId:'group'}
    ]};
}
const group=project=>project.modules.find(m=>m.id==='group');
const own=project=>project.tools.filter(t=>t.moduleId==='group');
function footprint(tools,clearance){
  const points=tools.flatMap(t=>transformedPoints(t,clearance)),xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  const x=Math.min(...xs),y=Math.min(...ys);
  return {x,y,width:Math.max(...xs)-x,height:Math.max(...ys)-y};
}
function assertContoursPreserved(before,after){
  for(const t of before.tools){
    const result=after.tools.find(item=>item.id===t.id);
    assert.deepEqual(result.points,t.points);assert.equal(result.rotation,t.rotation);
    assert.equal(result.locked,t.locked);assert.equal(result.moduleId,t.moduleId);
  }
  assert.ok(Math.abs((after.tools[1].x-after.tools[0].x)-(before.tools[1].x-before.tools[0].x))<1e-8);
  assert.ok(Math.abs((after.tools[1].y-after.tools[0].y)-(before.tools[1].y-before.tools[0].y))<1e-8);
}

test('manual dimensions use nominal mm and center a group without scaling its tools',()=>{
  const source=groupProject(),snapshot=structuredClone(source);
  source.modules[0].locked=true;
  const result=resizeModule(source,'group',{width:151.5,height:139.25,mode:'manual'}),m=group(result),b=footprint(own(result),result.clearance);
  assert.notEqual(result,source);assert.equal(m.width,151.5);assert.equal(m.height,139.25);
  assert.equal(m.x,42);assert.equal(m.y,42);assert.equal(m.locked,true);assert.equal(m.sizeMode,'manual');
  assert.ok(Math.abs(b.x+b.width/2-(m.x+m.width/2))<.001);
  assert.ok(Math.abs(b.y+b.height/2-(m.y+m.height/2))<.001);
  assertContoursPreserved(source,result);assert.deepEqual(validateLayout(result),[]);
  assert.deepEqual(source,{...snapshot,modules:[{...snapshot.modules[0],locked:true}]});
  assert.ok(exportSTL(result).length>84);
});

test('automatic size fits the rotated group, clearance and wall rounded up to the grid',()=>{
  const source=groupProject(),snapshot=structuredClone(source),b=footprint(own(source),source.clearance),padding=source.wall+.25;
  const result=resizeModule(source,'group',{mode:'auto'}),m=group(result);
  assert.equal(m.width,Math.ceil((b.width+2*padding)/source.grid)*source.grid);
  assert.equal(m.height,Math.ceil((b.height+2*padding)/source.grid)*source.grid);
  assert.equal(m.sizeMode,'auto');assert.equal(m.x,42);assert.equal(m.y,42);
  assertContoursPreserved(source,result);assert.deepEqual(validateLayout(result),[]);assert.deepEqual(source,snapshot);
});

test('invalid resizing never mutates the source and unrelated unplaced tools do not block it',()=>{
  const source=groupProject();
  source.modules.push({id:'neighbour',name:'Vedlejší',x:210,y:42,width:84,height:168,locked:true});
  const snapshot=structuredClone(source);
  for(const options of [{width:20,height:20},{width:500,height:160},{width:210,height:160},{width:NaN,height:160},{width:151,height:Infinity},{width:4,height:160},{width:3001,height:160}]){
    assert.throws(()=>resizeModule(source,'group',options));assert.deepEqual(source,snapshot);
  }
  assert.throws(()=>resizeModule(source,'missing',{width:100,height:100}),/neexistuje/);
  assert.throws(()=>resizeModule(source,'group',{mode:'unknown'}),/ruční nebo automatickou/);
  source.tools.push({id:'unplaced',name:'Čekající',points:rectangle(10,20),x:600,y:0,rotation:0,depth:10,locked:false,moduleId:null});
  assert.doesNotThrow(()=>resizeModule(source,'group',{width:151.5,height:139.25}));
});

test('empty modules have manual dimensions and cannot infer automatic size',()=>{
  const source={...groupProject(),tools:[]},snapshot=structuredClone(source);
  assert.throws(()=>resizeModule(source,'group',{mode:'auto'}),/prázdného modulu/);
  const result=resizeModule(source,'group',{width:77.5,height:99});
  assert.equal(group(result).width,77.5);assert.equal(group(result).sizeMode,'manual');assert.deepEqual(source,snapshot);
});

test('manual groups keep dimensions, relative tool positions and identity through repeated packing',()=>{
  const source=resizeModule(groupProject(),'group',{width:151.5,height:139.25});
  source.modules.push({id:'fixed',name:'Zamčený',x:0,y:0,width:84,height:84,locked:true});
  source.tools.push({id:'new',name:'Nový',points:rectangle(12,50),x:0,y:0,rotation:0,depth:10,locked:false,moduleId:null});
  const arranged={...source,...autoArrange(source)},m=group(arranged),before=group(source);
  assert.equal(m.width,before.width);assert.equal(m.height,before.height);assert.equal(m.sizeMode,'manual');assert.equal(m.locked,false);
  assert.notDeepEqual({x:m.x,y:m.y},{x:before.x,y:before.y},'manual size must not act as a position lock');
  assert.deepEqual(arranged.modules.find(m=>m.id==='fixed'),source.modules.find(m=>m.id==='fixed'));
  for(const t of own(source)){
    const moved=arranged.tools.find(item=>item.id===t.id);
    assert.ok(Math.abs((moved.x-m.x)-(t.x-before.x))<1e-8);
    assert.ok(Math.abs((moved.y-m.y)-(t.y-before.y))<1e-8);
    assert.deepEqual(moved.points,t.points);assert.equal(moved.rotation,t.rotation);
  }
  assert.deepEqual(validateLayout(arranged),[]);
  const again={...arranged,...autoArrange(arranged)};
  assert.deepEqual(group(again),m);assert.deepEqual(own(again),own(arranged));assert.deepEqual(validateLayout(again),[]);
});

test('an unplaced manual group survives JSON reload and packs after enlarging its drawer',()=>{
  const source=resizeModule(groupProject(),'group',{width:151.5,height:139.25}),small={...source,width:42,height:42};
  const result=autoArrange(small);assert.deepEqual(result.unplaced.sort(),['a','b']);
  assert.equal(result.modules.length,1);assert.equal(result.modules[0].id,'group');
  assert.ok(result.modules[0].x>small.width);
  const restored=validateProject(JSON.parse(JSON.stringify({...small,...result})));
  const expanded={...restored,width:420,height:336},packed={...expanded,...autoArrange(expanded)};
  assert.equal(group(packed).width,151.5);assert.equal(group(packed).height,139.25);assert.equal(group(packed).sizeMode,'manual');
  assert.equal(own(packed).length,2);assertContoursPreserved(source,packed);assert.deepEqual(validateLayout(packed),[]);
});

test('resizing ignores the print bed, preserves printing settings and keeps Gridfinity constraints',()=>{
  const source=groupProject();source.limitToBed=true;source.bedWidth=220;source.bedHeight=220;
  const enlarged=resizeModule(source,'group',{width:240,height:160});
  assert.equal(group(enlarged).width,240);assert.deepEqual(validateLayout(enlarged),[]);
  for(const key of ['limitToBed','bedWidth','bedHeight','printMode','bottomMode'])assert.equal(enlarged[key],source[key]);
  assert.throws(()=>exportSTL(enlarged),/tiskovou plochu/,'the same oversized part is checked when exported');
  const simple={...source,bottomMode:'grid',modules:[{id:'group',name:'Grid',x:0,y:0,width:84,height:84,locked:false}],tools:[{id:'one',name:'Nástroj',points:rectangle(20,40),x:10,y:10,rotation:0,depth:10,moduleId:'group',locked:false}]};
  assert.throws(()=>resizeModule(simple,'group',{width:73,height:84}),/násobcích 42/);
  assert.throws(()=>resizeModule({...simple,grid:30},'group',{mode:'auto'}),/rastr přesně 42/);
  const resized=resizeModule(simple,'group',{mode:'auto'});
  assert.equal(group(resized).width,42);assert.equal(group(resized).height,84);assert.equal(resized.bottomMode,'grid');assert.equal(resized.printMode,source.printMode);
  assert.ok(exportSTL(resized).length>84);
});
