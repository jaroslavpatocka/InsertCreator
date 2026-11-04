import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject} from '../dist/model.js';
import {exportSTL,validateLayout} from '../dist/geometry.js';
import {printConfig,validatePrintMesh} from '../dist/print-geometry.js';
import {planSizeLabels} from '../dist/size-labels.js';
import {automaticFingerGrips,pocketOutline} from '../dist/finger-grip.js';
import {catalogSets} from '../dist/catalog/index.js';
import {analyzeToolShape} from '../dist/tool-sets.js';

const rectangle=(width,height)=>[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
const area=points=>points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)/2;
function surface(bytes,{edges=true}={}){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(80,true),triangles=[],boundary=new Map();let volume=0;
  const key=point=>point.map(value=>Math.round(value*1e5)).join(',');
  for(let i=0;i<count;i++){
    const triangle=Array.from({length:3},(_,j)=>[0,1,2].map(axis=>view.getFloat32(84+i*50+12+j*12+axis*4,true)));triangles.push(triangle);
    assert.ok(triangle.flat().every(Number.isFinite));const [a,b,c]=triangle;
    volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    if(edges)for(let j=0;j<3;j++){const a=key(triangle[j]),b=key(triangle[(j+1)%3]);assert.notEqual(a,b,'STL edges remain distinct at QA precision');const edge=a<b?a+'|'+b:b+'|'+a,entry=boundary.get(edge)||{count:0,direction:0};entry.count++;entry.direction+=a<b?1:-1;boundary.set(edge,entry);}
  }
  if(edges)for(const [edge,entry] of boundary){assert.equal(entry.count,2,'edge must have two incident facets: '+edge);assert.equal(entry.direction,0,'edge winding must be opposite: '+edge);}
  assert.ok(volume>0);return{triangles,count,volume};
}
function materialAt(mesh,x,y,z){
  const hits=[];
  for(const [a,b,c] of mesh.triangles){
    const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-10)continue;
    const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den,w=1-u-v;
    if(Math.min(u,v,w)<-1e-8)continue;const hit=u*a[2]+v*b[2]+w*c[2];if(hit>z+1e-5&&!hits.some(other=>Math.abs(other-hit)<1e-5))hits.push(hit);
  }
  return hits.length%2===1;
}
function inside(point,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}
function glyphPoint(label){
  for(let y=label.y+.113;y<label.y+label.height;y+=.17)for(let x=label.x+.137;x<label.x+label.width;x+=.17){const point={x,y};if(label.polygons.reduce((sum,poly)=>sum+(inside(point,poly)?Math.sign(area(poly)):0),0))return point;}
  assert.fail('Expected an engraved glyph sample');
}
function sparse(){
  const project={...blankProject(),width:336,height:252,limitToBed:false,modules:[{id:'m',name:'Mixed depths',x:42,y:42,width:252,height:126,sizeMode:'manual',grouped:true}]};
  project.tools=[7,11,15].map((depth,index)=>({id:'t'+index,name:'Tool '+index,nominalSize:{value:10+index,unit:'mm'},points:rectangle(20,40),x:72+index*70,y:77,rotation:0,depth,moduleId:'m',fingerGrips:[{id:'left-'+index,x:0,y:20,radius:7},{id:'right-'+index,x:20,y:20,radius:7}]}));
  return project;
}
const output=project=>exportSTL(project,{moduleId:'m'});

test('disjoint mixed-depth walls join one base, keep exact additive volume and preserve every bottom mode with labels on or off',()=>{
  for(const printMode of ['light','solid'])for(const bottomMode of ['plain','grid','magnet','adhesive']){
    const project={...sparse(),printMode,bottomMode,sizeLabels:false},cfg=printConfig(project),module=project.modules[0];
    assert.deepEqual(validateLayout(project),[]);
    const empty=surface(output({...project,tools:[]}),{edges:false}),singles=project.tools.map(tool=>surface(output({...project,tools:[tool]}),{edges:false}));
    const expected=empty.volume+singles.reduce((sum,mesh)=>sum+mesh.volume-empty.volume,0);
    for(const sizeLabels of [false,true]){
      const p={...project,sizeLabels},plan=planSizeLabels(p),mesh=surface(output(p));
      assert.equal(plan.labels.length,sizeLabels?3:0);assert.deepEqual(plan.skipped,[]);
      const lettering=plan.labels.reduce((sum,label)=>sum+(printMode==='light'?area(label.plate)*(label.top-label.baseTop):0)-label.polygons.reduce((s,poly)=>s+area(poly),0)*label.depth,0);
      assert.ok(Math.abs(mesh.volume-expected-lettering)<.05,`${printMode}/${bottomMode}/${sizeLabels}: components add only their own volume`);
      const baseTop=cfg.footHeight+cfg.effectiveBaseMm,H=cfg.footHeight+cfg.height+cfg.extraBase;
      for(const tool of p.tools){
        const x=tool.x-module.x+10.137,y=module.height-(tool.y-module.y+5.113);
        assert.equal(materialAt(mesh,x,y,baseTop-.1),true,'The shared base remains under every pocket');
        if(printMode==='light'){
          assert.equal(materialAt(mesh,x,y,baseTop+.2),false,'The pocket stays open above the base');
          assert.equal(materialAt(mesh,tool.x-module.x-1.7,y,baseTop+tool.depth-.2),true,'Each ring reaches its own depth');
          assert.equal(materialAt(mesh,tool.x-module.x-1.7,y,baseTop+tool.depth+.2),false,'Other tools do not extend this ring upwards');
        }else{
          assert.equal(materialAt(mesh,x,y,H-tool.depth+.2),false,'Each solid pocket has its own cavity depth');
          assert.equal(materialAt(mesh,x,y,H-tool.depth-.2),true,'Material remains immediately below each pocket floor');
        }
      }
      for(const label of plan.labels){const point=glyphPoint(label),x=point.x-module.x,y=module.height-(point.y-module.y);assert.equal(materialAt(mesh,x,y,label.top-.15),false,'The label is really recessed');assert.equal(materialAt(mesh,x,y,label.top-label.depth-.15),true,'The engraving retains its supporting material');assert.equal(materialAt(mesh,x,y,baseTop-.1),true,'No engraving thins the common base');}
      if(bottomMode==='magnet'){const xy=.25+cfg.magnetDiameter/2+cfg.wall;assert.equal(materialAt(mesh,xy,xy,cfg.magnetDepth-.2),false);assert.equal(materialAt(mesh,xy,xy,cfg.magnetDepth+.2),true,'The original magnet roof remains intact');}
      if(bottomMode==='grid')assert.equal(materialAt(mesh,21.137,21.113,.3),true,'Gridfinity feet remain part of the same closed object');
    }
  }
});

test('touching and overlapping wall rings retain a closed mixed-depth surface with the original slab path',()=>{
  for(const gap of [4.8,3.8])for(const printMode of ['light','solid'])for(const sizeLabels of [false,true]){
    const p={...sparse(),printMode,sizeLabels,bottomMode:'plain'};
    p.tools=p.tools.map((tool,index)=>({...tool,x:72+index*(21.6+gap),fingerGrips:[]}));
    assert.deepEqual(validateLayout(p),[]);surface(output(p));
  }
});

function realWrenches(){
  const project={...blankProject(),width:1008,height:840,limitToBed:false},set=catalogSets().find(set=>set.id==='combination-wrench-set-6-32mm');
  const bounds=poly=>{const xs=poly.map(p=>p.x),ys=poly.map(p=>p.y),minX=Math.min(...xs),minY=Math.min(...ys);return{minX,minY,width:Math.max(...xs)-minX,height:Math.max(...ys)-minY};};
  const items=set.tools.map((item,index)=>{let tool={id:'t'+index,name:item.name.cs,nominalSize:{value:item.size,unit:item.unit},points:structuredClone(item.points),depth:Math.min(item.depth,17.6),x:0,y:0,rotation:0,moduleId:'m'};tool.fingerGrips=automaticFingerGrips(tool,{radius:9});tool.rotation=analyzeToolShape(tool).rotation;return{tool,bounds:bounds(pocketOutline(tool,project.clearance))};});
  const gap=2*project.wall+.2,padding=project.wall+.25,rows=[];let row=[],width=0;
  for(const item of items){if(row.length&&width+gap+item.bounds.width>project.width-2*padding){rows.push(row);row=[];width=0;}width+=(row.length?gap:0)+item.bounds.width;row.push(item);}if(row.length)rows.push(row);
  const tools=[];let y=padding;
  for(const row of rows){let x=padding;const height=Math.max(...row.map(item=>item.bounds.height));for(const {tool,bounds:b} of row){tools.push({...tool,x:x-b.minX,y:y+height-b.height-b.minY});x+=b.width+gap;}y+=height+gap;}
  assert.ok(y-padding-gap<project.height);return{...project,tools,modules:[{id:'m',name:'Wrenches 6–32',x:0,y:0,width:1008,height:840,sizeMode:'manual',grouped:true}]};
}

test('all 26 real wrench outlines with original mixed depths fit the unchanged STL facet limit in solid and light construction',()=>{
  const project=realWrenches(),depths=project.tools.map(tool=>tool.depth);assert.ok(new Set(depths).size>10,'Use original catalogue depths, not an equal-depth shortcut');assert.deepEqual(validateLayout(project),[]);
  for(const printMode of ['light','solid'])for(const sizeLabels of [false,true]){
    const p={...project,printMode,sizeLabels};if(sizeLabels){const plan=planSizeLabels(p);assert.equal(plan.labels.length,26);assert.deepEqual(plan.skipped,[]);}
    const mesh=surface(output(p));assert.ok(mesh.count<120000,`${printMode}/${sizeLabels}: ${mesh.count} facets`);assert.doesNotThrow(()=>validatePrintMesh(mesh.triangles));
    assert.deepEqual(project.tools.map(tool=>tool.depth),depths,'Manufacturing never changes original pocket depths');
  }
});
