import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerGripOutline,fingerGripDimensions,validateFingerGrips,pocketOutline} from '../dist/finger-grip.js';
import {blankProject,validateProject} from '../dist/model.js';

const close=(actual,expected,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
const box=points=>({left:Math.min(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),right:Math.max(...points.map(p=>p.x)),bottom:Math.max(...points.map(p=>p.y))});
const area=points=>Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)/2);
function inside(point,polygon){
  let result=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const p=polygon[i],q=polygon[j];
    if((p.y>point.y)!==(q.y>point.y)&&point.x<(q.x-p.x)*(point.y-p.y)/(q.y-p.y)+p.x)result=!result;
  }
  return result;
}
const rectangle=[{x:-20,y:-30},{x:0,y:-30},{x:0,y:70},{x:-20,y:70}];
const grip=shape=>({id:shape,x:-20,y:20,shape,width:20,height:8,rotation:30,...(shape==='rounded-rect'?{cornerRadius:2}:{})});
const rotation=37*Math.PI/180,c=Math.cos(rotation),s=Math.sin(rotation);
// Independent physical placement for this exact 20 x 100 mm negative-origin tool.
// Its rotated normalized X minimum is -100 sin(37), and Y minimum is zero.
const world=point=>({x:100+(point.x+20)*c-(point.y+30)*s+100*s,y:200+(point.x+20)*s+(point.y+30)*c});
const onGripAxis=(g,u,v=0)=>{const a=g.rotation*Math.PI/180;return{x:g.x+u*Math.cos(a)-v*Math.sin(a),y:g.y+u*Math.sin(a)+v*Math.cos(a)};};

test('shape validation keeps legacy circles exact and canonicalizes documented defaults',()=>{
  const circle={id:'old',x:-2,y:40,radius:9};
  assert.deepEqual(validateFingerGrips([circle]),[circle]);
  assert.deepEqual(validateFingerGrips([{...circle,shape:'circle',rotation:37}]),[circle]);
  assert.deepEqual(fingerGripDimensions(circle),{width:18,height:18,rotation:0,cornerRadius:0});
  const legacy=fingerGripOutline(circle);assert.equal(legacy.length,68);
  for(const [index,x,y] of [[0,7,40],[17,-2,49],[34,-11,40],[51,-2,31]]){close(legacy[index].x,x);close(legacy[index].y,y);}
  assert.deepEqual(validateFingerGrips([{id:'round',x:3,y:4,shape:'rounded-rect',width:20,height:8}]),[{id:'round',x:3,y:4,shape:'rounded-rect',width:20,height:8,rotation:0,cornerRadius:2}]);
  assert.equal(validateFingerGrips([{...grip('ellipse'),rotation:-330}])[0].rotation,30);
  assert.equal(validateFingerGrips([{...grip('ellipse'),rotation:720}])[0].rotation,0);
});

test('shape validation rejects ambiguous, unknown and nonfinite imported geometry atomically',()=>{
  const source=grip('ellipse'),before=structuredClone(source);
  const bad=[{...source,shape:'triangle'},{...source,shape:null},{...source,radius:9},{...source,cornerRadius:2},
    {...source,width:3.99},{...source,height:80.01},{...source,width:[20]},{...source,height:{}},
    {...source,rotation:Infinity},{...source,rotation:null},{...source,rotation:[0]},
    {...grip('rounded-rect'),cornerRadius:-.01},{...grip('rounded-rect'),cornerRadius:4.01},
    {id:'bad',x:0,y:0,radius:9,width:18},{id:'bad',x:0,y:0,shape:'circle',width:18,height:18}];
  for(const invalid of bad)assert.throws(()=>validateFingerGrips([source,{...invalid,id:'invalid'}]),undefined,JSON.stringify(invalid));
  assert.deepEqual(source,before);
  for(const shape of ['ellipse','rectangle','rounded-rect']){
    const min={...grip(shape),width:4,height:4,rotation:0},max={...grip(shape),width:80,height:80,rotation:0};
    assert.doesNotThrow(()=>fingerGripOutline(min));assert.doesNotThrow(()=>fingerGripOutline(max));
  }
});

test('ellipse, rectangle and rounded rectangle have independent physical bounds and analytic area',()=>{
  for(const [shape,expected] of [['ellipse',Math.PI*10*4],['rectangle',160],['rounded-rect',160-(4-Math.PI)*4]]){
    const g={...grip(shape),x:12,y:34,rotation:0},before=structuredClone(g),polygon=fingerGripOutline(g),bounds=box(polygon);
    close(bounds.left,2);close(bounds.right,22);close(bounds.top,30);close(bounds.bottom,38);
    close(area(polygon),expected,shape==='rectangle'?1e-8:.25);
    assert.deepEqual(fingerGripDimensions(g),{width:20,height:8,rotation:0,cornerRadius:shape==='rounded-rect'?2:0});
    assert.deepEqual(g,before,'drawing and dimensions do not alter stored cutouts');
  }
  for(const cornerRadius of [0,.001,4]){
    const polygon=fingerGripOutline({...grip('rounded-rect'),rotation:0,cornerRadius}),bounds=box(polygon);
    close(bounds.right-bounds.left,20);close(bounds.bottom-bounds.top,8);
    assert.ok(polygon.length>=4&&polygon.every(p=>Number.isFinite(p.x+p.y)));
    close(area(polygon),160-(4-Math.PI)*cornerRadius**2,.25);
  }
  const ellipse=fingerGripOutline({id:'arc-error',x:0,y:0,shape:'ellipse',width:80,height:4,rotation:0});
  for(let i=0;i<ellipse.length;i++){
    const a=ellipse[i],b=ellipse[(i+1)%ellipse.length],first=Math.atan2(a.y/2,a.x/40),last=Math.atan2(b.y/2,b.x/40),angle=(first+(last>first?last:last+2*Math.PI))/2;
    const middle={x:Math.cos(angle)*40,y:Math.sin(angle)*2},dx=b.x-a.x,dy=b.y-a.y,t=((middle.x-a.x)*dx+(middle.y-a.y)*dy)/(dx*dx+dy*dy);
    const distance=Math.hypot(middle.x-a.x-Math.max(0,Math.min(1,t))*dx,middle.y-a.y-Math.max(0,Math.min(1,t))*dy);
    assert.ok(distance<=.010001,'elliptical arc error stays below 0.01 mm even for 80 x 4 mm cutouts');
  }
});

test('local shape rotation composes with tool rotation and never gains the manufacturing margin',()=>{
  for(const shape of ['ellipse','rectangle','rounded-rect'])for(const margin of [0,2]){
    const g=grip(shape),tool={id:'placed',points:rectangle,x:100,y:200,rotation:37,fingerGrips:[g]},before=structuredClone(tool);
    const cavity=pocketOutline(tool,margin),tip=world(onGripAxis(g,-9)),outside=world(onGripAxis(g,-11));
    assert.equal(inside(tip,cavity),true,`${shape}: the rotated long end is an actual cavity`);
    assert.equal(inside(outside,cavity),false,`${shape}: the cutout does not grow with the tool clearance`);
    assert.deepEqual(tool,before,'export geometry leaves raw mm, rotation and dimensions unchanged');
  }
});

test('new shapes must connect by positive area and cannot create disconnected pockets',()=>{
  const u=[{x:0,y:0},{x:40,y:0},{x:40,y:50},{x:30,y:50},{x:30,y:10},{x:10,y:10},{x:10,y:50},{x:0,y:50}];
  for(const shape of ['ellipse','rectangle','rounded-rect']){
    const tool={id:'connected',points:rectangle,x:100,y:200,rotation:37};
    assert.throws(()=>pocketOutline({...tool,fingerGrips:[{...grip(shape),x:-60}]},0),/navazovat/);
    assert.throws(()=>pocketOutline({...tool,fingerGrips:[{...grip(shape),x:-30,rotation:0}]},0),/navazovat/,'tangent contact is not a usable opening');
    assert.doesNotThrow(()=>pocketOutline({...tool,fingerGrips:[grip(shape)]},0));
    assert.throws(()=>pocketOutline({points:u,fingerGrips:[{id:'hole',x:20,y:42,shape,width:30,height:12,rotation:0,...(shape==='rounded-rect'?{cornerRadius:3}:{})}]},0),/jednoznačnou/,'a cutout cannot close a real opening into an unmanufacturable island');
  }
});

test('negative-origin normalization and JSON roundtrips preserve full shaped cutouts',()=>{
  for(const shape of ['ellipse','rectangle','rounded-rect']){
    const original={id:'original-'+shape,name:shape,points:rectangle,x:100,y:200,rotation:37,depth:12,fingerGrips:[grip(shape)]},before=structuredClone(original);
    let project=validateProject({...blankProject(),tools:[original]}),normalized=project.tools[0];
    assert.deepEqual(normalized.fingerGrips,[{...grip(shape),x:0,y:50}]);
    assert.deepEqual(pocketOutline(normalized,.8),pocketOutline(original,.8));
    for(let i=0;i<3;i++){
      const restored=validateProject(JSON.parse(JSON.stringify({schemaVersion:1,project})));
      assert.deepEqual(restored,project,'import cannot drop shape fields or shift centers twice');project=restored;
    }
    assert.deepEqual(original,before);
  }
});
