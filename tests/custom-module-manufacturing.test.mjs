import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {createCustomModule,customModuleOptions,updateCustomModule,isCustomModule} from '../dist/custom-module.js';
import {moveModule,rotateModuleFree} from '../dist/module-edit.js';
import {exportSTL,exportSVG,validateLayout} from '../dist/geometry.js';
import {planSizeLabels} from '../dist/size-labels.js';
import {buildPrintTriangles,encodeSTL,validatePrintMesh} from '../dist/print-geometry.js';

const polygon=[{x:0,y:0},{x:60,y:0},{x:45,y:40},{x:0,y:40}];
const close=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<.005,`${message}: ${actual}, expected ${expected}`);
function fixture(shape,printMode='solid',pocketMargin=0){
  const project={...blankProject(),width:420,height:336,insertHeight:20,base:2.4,printMode,bottomMode:'plain',limitToBed:false};
  return createCustomModule(project,{name:'Own module',pocketName:'Own pocket',width:126,height:126,shape,pocketWidth:60,pocketHeight:40,cornerRadius:6,points:polygon,depth:7,pocketMargin});
}
function decode(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(80,true);
  assert.equal(bytes.byteLength,84+50*count,'actual binary STL records are complete');
  const triangles=Array.from({length:count},(_,i)=>[0,1,2].map(v=>[0,1,2].map(axis=>view.getFloat32(84+50*i+12+12*v+4*axis,true))));
  assert.ok(triangles.length>0);validatePrintMesh(triangles);
  return triangles;
}
// Independently intersect the actual exported horizontal triangle surfaces.
function surfaces(mesh,x,y){
  const found=[];
  for(const [a,b,c] of mesh){
    if(Math.abs(a[2]-b[2])>1e-5||Math.abs(a[2]-c[2])>1e-5)continue;
    const d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(d)<1e-9)continue;
    const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/d;
    const v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/d;
    if(u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7)found.push(a[2]);
  }
  return [...new Set(found.map(value=>Math.round(value*1e5)/1e5))].sort((a,b)=>a-b);
}
function world(tool,point){
  const angle=tool.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  const turn=p=>({x:p.x*c-p.y*s,y:p.x*s+p.y*c});
  const outline=tool.points.map(turn),p=turn(point);
  return{x:tool.x+p.x-Math.min(...outline.map(v=>v.x)),y:tool.y+p.y-Math.min(...outline.map(v=>v.y))};
}
function topAt(mesh,module,tool,raw){
  const p=world(tool,raw);return surfaces(mesh,p.x-module.x,module.height-(p.y-module.y)).at(-1);
}
const inside=(shape,x,y)=>{
  if(shape==='ellipse')return ((x-30)/30)**2+((y-20)/20)**2<1;
  if(shape==='rounded-rect')return Math.hypot(Math.max(0,Math.abs(x-30)-24),Math.max(0,Math.abs(y-20)-14))<6;
  if(shape==='polygon')return x>0&&x<60-15*y/40&&y>0&&y<40;
  return x>0&&x<60&&y>0&&y<40;
};

test('all four custom shapes remain actual closed STL cavities after JSON reload and 37 degree rotation',{timeout:60000},async t=>{
  for(const mode of ['solid','light'])for(const shape of ['rectangle','rounded-rect','ellipse','polygon'])await t.test(`${mode} / ${shape}`,()=>{
    const made=fixture(shape,mode),reloaded=validateProject(JSON.parse(JSON.stringify(made.project)));
    assert.ok(isCustomModule(reloaded,made.moduleId));assert.equal(reloaded.tools[0].customPocket,true);
    assert.equal(customModuleOptions(reloaded,made.moduleId).shape,shape,'same primitive stays editable after reload');
    const rotated=rotateModuleFree(reloaded,made.moduleId,37,{keepInside:true}),snapshot=structuredClone(rotated);
    const {project:edited}=updateCustomModule(rotated,made.moduleId,{pocketName:'Renamed pocket'});
    assert.equal(edited.tools[0].id,made.toolId);assert.equal(edited.tools[0].moduleId,made.moduleId);
    assert.equal(edited.tools[0].rotation,37);assert.deepEqual(edited.tools[0].points,reloaded.tools[0].points);
    assert.deepEqual(validateLayout(edited),[]);
    const module=edited.modules[0],tool=edited.tools[0],mesh=decode(exportSTL(edited,{moduleId:made.moduleId,checkBed:false}));
    const floor=mode==='solid'?13:2.4;
    for(const [x,y] of [[30,20],[.5,.5],[55,35],[15,10],[50,5]]){
      const interior=inside(shape,x,y),actual=topAt(mesh,module,tool,{x,y});
      if(interior)close(actual,floor,`${shape} actual pocket floor at ${x},${y}`);
      else if(mode==='solid')close(actual,20,`${shape} actual body outside contour at ${x},${y}`);
    }
    // Just outside the rightmost midpoint remains inside the physical wall.
    const right=shape==='polygon'?52.5:60;
    close(topAt(mesh,module,tool,{x:right+1,y:20}),floor+7,`${shape} actual seven millimetre wall`);
    assert.deepEqual(rotated,snapshot,'editing and manufacturing leave their input snapshot intact');
    assert.match(exportSVG(edited,{moduleId:made.moduleId}),/data-depth-mm="7"/);
  });
});

test('explicit zero and nonzero custom clearance alter the actual STL floor boundary exactly once',()=>{
  for(const margin of [0,.8]){
    const {project,moduleId}=fixture('rectangle','solid',margin),module=project.modules[0],tool=project.tools[0];
    project.clearance=3;
    const mesh=decode(exportSTL(project,{moduleId,checkBed:false}));
    close(topAt(mesh,module,tool,{x:-.4,y:20}),margin===0?20:13,'custom margin overrides global clearance');
    close(topAt(mesh,module,tool,{x:-1,y:20}),20,'clearance is not applied twice');
    const roundtrip=validateProject(JSON.parse(JSON.stringify(project)));
    assert.equal(roundtrip.tools[0].pocketMargin,margin);assert.equal(roundtrip.modules[0].pocketMargin,margin);
  }
});

test('moving, rotating and updating a restored custom module preserve identity and unrelated modules',()=>{
  const first=fixture('ellipse'),second=createCustomModule(first.project,{width:84,height:84,pocketWidth:40,pocketHeight:40,shape:'rectangle'});
  const source=validateProject(JSON.parse(JSON.stringify(second.project))),snapshot=structuredClone(source);
  const companion=structuredClone(source.modules.find(module=>module.id===second.moduleId)),companionTool=structuredClone(source.tools.find(tool=>tool.id===second.toolId));
  const moved=moveModule(source,first.moduleId,{x:42,y:168});
  const rotated=rotateModuleFree(moved,first.moduleId,37,{keepInside:true});
  const result=updateCustomModule(rotated,first.moduleId,{depth:8,label:'M6'}).project;
  const own=result.tools.find(tool=>tool.id===first.toolId);
  assert.equal(own.rotation,37);assert.equal(own.moduleId,first.moduleId);assert.equal(own.depth,8);assert.equal(own.sizeLabel,'M6');
  assert.ok(isCustomModule(result,first.moduleId));assert.deepEqual(validateLayout(result),[]);
  assert.deepEqual(result.modules.find(module=>module.id===second.moduleId),companion);
  assert.deepEqual(result.tools.find(tool=>tool.id===second.toolId),companionTool);assert.deepEqual(source,snapshot);
  decode(exportSTL(result,{moduleId:first.moduleId,checkBed:false}));
});

function pointInside(point,polygon){
  let contained=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)contained=!contained;
  }
  return contained;
}
test('a custom text label is physically engraved in the exported module',()=>{
  const made=fixture('rectangle'),{project}=updateCustomModule(made.project,made.moduleId,{label:'M6'}),module=project.modules[0];
  const plan=planSizeLabels(project);assert.equal(plan.labels.length,1);assert.deepEqual(plan.skipped,[]);
  const label=plan.labels[0],mesh=decode(exportSTL(project,{moduleId:made.moduleId,checkBed:false}));
  let found=null;
  for(let x=label.x+.03;x<label.x+label.width&&!found;x+=.13)for(let y=label.y+.03;y<label.y+label.height;y+=.13){
    if(label.polygons.some(polygon=>pointInside({x,y},polygon))){found={x,y};break;}
  }
  assert.ok(found,'an interior point lies in a manufactured glyph');
  const actual=surfaces(mesh,found.x-module.x,module.height-(found.y-module.y)).at(-1);
  close(actual,20-label.depth,'actual engraved text surface matches its chosen relief');
});

const dot=(a,b)=>a.reduce((sum,value,index)=>sum+value*b[index],0);
const minus=(a,b)=>a.map((value,index)=>value-b[index]);
const cross3=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function rayDistances(mesh,origin,direction){
  const distances=[];
  for(const [a,b,c] of mesh){
    const e1=minus(b,a),e2=minus(c,a),p=cross3(direction,e2),det=dot(e1,p);if(Math.abs(det)<1e-10)continue;
    const inverse=1/det,s=minus(origin,a),u=inverse*dot(s,p);if(u< -1e-8||u>1+1e-8)continue;
    const q=cross3(s,e1),v=inverse*dot(direction,q);if(v< -1e-8||u+v>1+1e-8)continue;
    const distance=inverse*dot(e2,q);if(distance>1e-5)distances.push(distance);
  }
  return distances.sort((a,b)=>a-b).filter((value,index,sorted)=>!index||Math.abs(value-sorted[index-1])>1e-5);
}
// These equations are the requested physical profiles, independent of the
// production terrace generator. Its 0.2 mm print-layer approximation must lie
// inside the requested cavity and within one horizontal step of that surface.
function requestedOffset(wall,depth,h){
  if(wall.type==='vertical')return 0;
  if(wall.type==='draft')return h*Math.tan(wall.value*Math.PI/180);
  if(wall.type==='chamfer')return Math.max(0,h-depth+wall.value);
  const radius=wall.value;
  if(wall.type==='roundTop')return h<=depth-radius?0:radius-Math.sqrt(radius**2-(h-depth+radius)**2);
  return h>=radius?0:Math.sqrt(radius**2-(radius-h)**2)-radius;
}
test('custom pocket wall profiles survive Save/reload and appear in real STL sections at their physical heights',{timeout:120000},async t=>{
  const profiles=[{type:'vertical'},{type:'draft',value:12},{type:'chamfer',value:1.5},{type:'roundTop',value:2},{type:'roundBottom',value:2}];
  for(const mode of ['solid','light'])for(const shape of ['rectangle','rounded-rect','ellipse','polygon'])for(const pocketWall of profiles)await t.test(`${mode} / ${shape} / ${pocketWall.type}`,()=>{
    const source={...blankProject(),width:420,height:336,insertHeight:20,base:2.4,printMode:mode,bottomMode:'plain',limitToBed:false};
    const made=createCustomModule(source,{name:'Profile module',pocketName:'Profile cavity',width:126,height:126,shape,pocketWidth:60,pocketHeight:40,cornerRadius:6,points:polygon,depth:7,pocketMargin:0,pocketWall,label:'M6'});
    const restored=validateProject(JSON.parse(JSON.stringify(made.project))),tool=restored.tools[0],module=restored.modules[0];
    assert.equal(tool.customPocket,true);assert.equal(tool.sizeLabel,'M6');assert.equal(restored.sizeLabels,true);
    if(pocketWall.type==='vertical')assert.equal(tool.pocketWall??null,null,'vertical stays backward compatible');
    else assert.deepEqual(tool.pocketWall,pocketWall,'profile and physical value survive project import');
    const renamed=updateCustomModule(restored,made.moduleId,{name:'Renamed profile module'}).project;
    assert.deepEqual(renamed.tools[0].pocketWall??null,tool.pocketWall??null,'unrelated Save retains profile');
    assert.equal(renamed.tools[0].sizeLabel,'M6');assert.deepEqual(validateLayout(renamed),[]);
    assert.equal(planSizeLabels(renamed).labels.length,1,'real label remains manufacturable beside this profile');
    const mesh=decode(exportSTL(renamed,{moduleId:made.moduleId,checkBed:false})),floor=mode==='solid'?13:2.4;
    close(topAt(mesh,module,tool,{x:30,y:20}),floor,'profile keeps the centre floor at the specified seven millimetre depth');
    const centre=world(tool,{x:30,y:20}),half=shape==='polygon'?22.5:30,normalFactor=shape==='polygon'?Math.hypot(1,.375):1;
    for(const h of [.07,.53,1.27,3.13,5.43,6.73]){
      const distance=rayDistances(mesh,[centre.x-module.x,module.height-(centre.y-module.y),floor+h],[1,0,0])[0];
      assert.ok(Number.isFinite(distance),'actual cavity wall intersects the horizontal STL ray');
      const expected=half+normalFactor*requestedOffset(pocketWall,7,h);
      if(pocketWall.type==='vertical')close(distance,expected,'baseline perpendicular wall stays unchanged');
      else {
        assert.ok(distance<=expected+.006,`manufactured ${pocketWall.type} cavity does not exceed the requested profile at h=${h}: ${distance} > ${expected}`);
        assert.ok(distance>=expected-.201*normalFactor-.006,`manufactured ${pocketWall.type} is within one print-layer step at h=${h}: ${distance} < ${expected}`);
      }
    }
  });
});

test('a widened light-mode wall ring cannot fill an adjacent active pocket cavity',()=>{
  const rectangle=[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}],module={id:'adjacent-rings',name:'Adjacent rings',x:0,y:0,width:126,height:84,sizeMode:'manual'};
  const tools=[{id:'sloped',name:'Sloped',moduleId:module.id,x:20,y:20,rotation:0,depth:8,points:rectangle,pocketMargin:0,pocketWall:{type:'draft',value:45}},
    {id:'neighbour',name:'Neighbour',moduleId:module.id,x:48.5,y:20,rotation:0,depth:8,points:rectangle,pocketMargin:0}];
  const project={...blankProject(),width:126,height:84,printMode:'light',bottomMode:'plain',base:2.4,wall:2.4,clearance:0,sizeLabels:false,modules:[module],tools};
  // This intentionally exercises the lower-level Boolean mesher: high-level
  // layout correctly rejects the 0.5 mm space between the widest openings.
  assert.ok(validateLayout(project).some(issue=>issue.type==='overlap'&&issue.ids.includes('sloped')&&issue.ids.includes('neighbour')));
  const prepared=tools.map(tool=>({...tool,poly:tool.points.map(point=>({x:point.x+tool.x,y:point.y+tool.y}))})),snapshot=structuredClone(project);
  for(const clip of [null,{x:0,y:0,width:84,height:84}]){
    const actual=decode(encodeSTL(buildPrintTriangles(project,[module],prepared,{x:0,y:0},clip?{clip}:{})));
    // Actual binary STL remains closed, with only the 2.4 mm base below the
    // neighbour's cavity even where the other ring's exterior reaches it.
    close(surfaces(actual,49.13,30.07).at(-1),2.4,'overlapping rings leave the real neighbour floor exposed');
    for(const h of [.53,2.13,5.53,7.73]){
      const origin=[49.13,30.07,2.4+h];
      assert.equal(rayDistances(actual,origin,[0,0,1]).length%2,0,'the neighbouring active opening stays void at height '+h);
      close(rayDistances(actual,origin,[1,0,0])[0],68.5-49.13,'the first real wall remains the neighbour far edge at height '+h);
    }
  }
  assert.deepEqual(project,snapshot,'mesh Boolean corrections never rewrite project geometry');
});
