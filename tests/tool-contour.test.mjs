import test from 'node:test';
import assert from 'node:assert/strict';
import {smoothToolContour} from '../dist/tool-contour.js';
import {regularizeContour,CONTOUR_SMOOTHING_MM} from '../dist/contour-smoothing.js';
import {blankProject,clone,validateProject} from '../dist/model.js';
import {transformedPoints,validateLayout,exportSTL} from '../dist/geometry.js';
import {pocketOutline} from '../dist/finger-grip.js';
import {validatePrintMesh,trianglesVolume} from '../dist/print-geometry.js';

function noisyShaft(){
  const points=[{x:0,y:0},{x:20,y:0}];
  for(let y=1;y<80;y++)points.push({x:20+.22*Math.sin(y*1.8),y});
  points.push({x:20,y:80},{x:0,y:80});
  for(let y=79;y>0;y--)points.push({x:.22*Math.sin(y*1.5),y});
  return points;
}
function drawer(extra={}){
  return validateProject({...blankProject(),width:588,height:420,limitToBed:false,
    modules:[{id:'shared',name:'shared',x:0,y:0,width:252,height:210,sizeMode:'manual',locked:false,grouped:true}],
    tools:[{id:'rough',name:'Nástroj z fotografie',points:noisyShaft(),x:40,y:35,rotation:37,depth:8,locked:false,moduleId:'shared',sizeLabel:'13',nominalSize:{value:13,unit:'mm'},category:'wrenches',fingerGrips:[{id:'bay',x:1,y:40,radius:5}]},
      {id:'sibling',name:'sibling',points:[{x:0,y:0},{x:12,y:0},{x:12,y:60},{x:0,y:60}],x:170,y:35,rotation:0,depth:8,moduleId:'shared',locked:false,fingerGrips:[]}],...extra});
}
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} should equal ${expected}`);
function worldPoint(tool,point){
  const angle=tool.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),rotate=p=>({x:p.x*c-p.y*s,y:p.x*s+p.y*c});
  const rotated=tool.points.map(rotate),p=rotate(point);
  return{x:p.x-Math.min(...rotated.map(q=>q.x))+tool.x,y:p.y-Math.min(...rotated.map(q=>q.y))+tool.y};
}

test('repair smooths one existing tool without shifting its world frame, manual bay, module or siblings',()=>{
  for(const rotation of [0,37,90,183]){
    const project=drawer();project.tools[0].rotation=rotation;
    const before=clone(project),source=project.tools[0],expected=regularizeContour(source.points,CONTOUR_SMOOTHING_MM),next=smoothToolContour(project,'rough'),tool=next.tools[0];
    assert.notDeepEqual(tool.points,source.points,'the noisy contour must actually change');
    assert.equal(tool.points.length,expected.length);
    const actual=transformedPoints(tool);
    for(let i=0;i<expected.length;i++){const target=worldPoint(source,expected[i]);close(actual[i].x,target.x);close(actual[i].y,target.y);}
    const oldBay=worldPoint(source,source.fingerGrips[0]),newBay=worldPoint(tool,tool.fingerGrips[0]);
    close(newBay.x,oldBay.x);close(newBay.y,oldBay.y);assert.equal(tool.fingerGrips[0].radius,5);
    assert.deepEqual(next.modules,project.modules);assert.deepEqual(next.tools[1],project.tools[1]);
    for(const key of ['id','name','rotation','depth','locked','moduleId','sizeLabel','nominalSize','category'])assert.deepEqual(tool[key],source[key]);
    assert.deepEqual(validateLayout(next),[]);assert.deepEqual(project,before);
    next.tools[0].points[0].x+=1;assert.deepEqual(project,before,'returned geometry is an independent copy');
  }
});

test('repair preserves absent or explicitly cleared bays and is a clone at zero tolerance',()=>{
  for(const hasBays of [false,true]){
    const project=drawer();if(hasBays)project.tools[0].fingerGrips=[];else delete project.tools[0].fingerGrips;
    const next=smoothToolContour(project,'rough');assert.equal(Object.hasOwn(next.tools[0],'fingerGrips'),hasBays);if(hasBays)assert.deepEqual(next.tools[0].fingerGrips,[]);
    const unchanged=smoothToolContour(project,'rough',0);assert.deepEqual(unchanged,project);assert.notEqual(unchanged,project);assert.notEqual(unchanged.tools[0].points,project.tools[0].points);
  }
});

test('tool and module locks reject repair atomically; a locked sibling does not block a local repair',()=>{
  for(const lock of ['tool','module']){
    const project=drawer();if(lock==='tool')project.tools[0].locked=true;else project.modules[0].locked=true;
    const before=clone(project);assert.throws(()=>smoothToolContour(project,'rough'),/odemkněte/);assert.deepEqual(project,before);
  }
  const project=drawer();project.tools[1].locked=true;const next=smoothToolContour(project,'rough');assert.deepEqual(next.tools[1],project.tools[1]);
});

test('existing unrelated layout or depth errors remain editable while the selected pocket must be valid',()=>{
  const project=drawer();project.tools[1].moduleId=null;project.tools[1].depth=99;project.tools[0].depth=99;
  const next=smoothToolContour(project,'rough');assert.equal(next.tools[0].depth,99);assert.deepEqual(next.tools[1],project.tools[1]);
  for(const invalid of [p=>p.tools[0].x=0,p=>{p.tools[1].x=50;p.tools[1].y=60;},p=>p.tools[0].moduleId=null]){
    const project=drawer();invalid(project);const before=clone(project);
    assert.throws(()=>smoothToolContour(project,'rough'),error=>!!error.i18n);assert.deepEqual(project,before);
  }
});

test('manual finger bay that would detach from a smoothed spur rejects the entire repair',()=>{
  const project=drawer(),tool=project.tools[0];tool.rotation=0;
  tool.points=[{x:0,y:0},{x:20,y:0},...Array.from({length:79},(_,i)=>({x:i===39?20.3:20,y:i+1})),{x:20,y:80},{x:0,y:80}];
  tool.fingerGrips=[{id:'edge',x:22.25,y:40,radius:2}];
  assert.ok(pocketOutline(tool,0).length>3);const before=clone(project);
  assert.throws(()=>smoothToolContour(project,'rough'),/plošně navazovat/);assert.deepEqual(project,before);
});

test('smoothing a shallow notch cannot consume the required wall next to an initially valid neighbour',()=>{
  const project=drawer();project.wall=1;project.clearance=0;
  const tool=project.tools[0];tool.rotation=0;tool.x=40;tool.y=35;tool.fingerGrips=[];
  tool.points=[{x:0,y:0},{x:20,y:0},{x:20,y:39},{x:19.7,y:39.8},{x:19.7,y:40.2},{x:20,y:41},{x:20,y:80},{x:0,y:80}];
  Object.assign(project.tools[1],{x:60.98,y:74.95,points:[{x:0,y:0},{x:2,y:0},{x:2,y:.1},{x:0,y:.1}]});
  assert.deepEqual(validateLayout(project),[]);const before=clone(project);
  assert.throws(()=>smoothToolContour(project,'rough'),/stěnu/);assert.deepEqual(project,before,'an unsafe repair does not change either pocket');
});

test('invalid tolerances and unknown selections fail without modifying the project',()=>{
  const project=drawer(),before=clone(project);
  for(const tolerance of [NaN,Infinity,-1,1.01,null,true,'0.35',{},[]])assert.throws(()=>smoothToolContour(project,'rough',tolerance),error=>!!error.i18n);
  assert.throws(()=>smoothToolContour(project,'missing'),/neexistuje/);assert.deepEqual(project,before);
});

test('repeated repair retains an already smooth contour exactly instead of cumulatively shrinking it',()=>{
  const project=drawer(),tool=project.tools[0];tool.rotation=37;tool.fingerGrips=[];
  tool.points=Array.from({length:360},(_,i)=>{const angle=i*Math.PI/180,radius=10+.15*Math.sin(i*3);return{x:20+radius*Math.cos(angle),y:20+radius*Math.sin(angle)};});
  const once=smoothToolContour(project,'rough');assert.notDeepEqual(once.tools[0].points,tool.points);
  let current=once;for(let i=0;i<20;i++)current=smoothToolContour(current,'rough');
  assert.deepEqual(current,once,'subsequent clicks must leave the first repaired contour unchanged');
});

test('a repaired, rotated contour and manual bay export as one closed positive-volume STL with real pockets',()=>{
  const project=smoothToolContour({...drawer(),printMode:'solid'},'rough'),before=clone(project),bytes=exportSTL(project,{moduleId:'shared'}),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(80,true);
  assert.equal(bytes.length,84+50*count);
  const triangles=Array.from({length:count},(_,i)=>Array.from({length:3},(_,v)=>Array.from({length:3},(_,axis)=>view.getFloat32(84+i*50+12+v*12+axis*4,true))));
  assert.doesNotThrow(()=>validatePrintMesh(triangles));
  const module=project.modules[0],area=points=>Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)/2),pocketVolume=project.tools.reduce((sum,tool)=>sum+area(pocketOutline(tool,project.clearance))*tool.depth,0),expected=(module.width-.5)*(module.height-.5)*project.insertHeight-pocketVolume;
  assert.ok(Math.abs(trianglesVolume(triangles)-expected)<2,'both contours and the manual finger bay remove the expected pocket volume');
  assert.deepEqual(project,before,'manufacturing export must not change the repaired project');
});
