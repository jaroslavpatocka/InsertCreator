import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {scaleTool} from '../dist/set-module.js';
import {resizeToolDimensions} from '../dist/tool-dimensions.js';
import {smartArrange} from '../dist/smart-layout.js';
import {validateLayout,exportSTL,exportSVG} from '../dist/geometry.js';
import {preparePrintBatch} from '../dist/print-batch.js';

const radians=degrees=>degrees*Math.PI/180;
const rectangle=(x,y,width,height)=>[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}];
const kinds=['circle','ellipse','rectangle','rounded-rect'];
const grip=kind=>kind==='circle'?{id:'g',x:43,y:11,radius:9}:{id:'g',x:43,y:11,shape:kind,width:20,height:12,rotation:37,...(kind==='rounded-rect'?{cornerRadius:3}:{})};
const tool=kind=>({id:'t',name:'Shaped finger access',moduleId:'m',x:30,y:30,rotation:37,depth:7,points:rectangle(-7,11,100,20),fingerGrips:[grip(kind)]});
const project=(kind,margin=0,printMode='solid')=>({...blankProject(),id:'shaped-grip-test',width:252,height:210,printMode,bottomMode:'plain',insertHeight:20,base:2.4,clearance:3,sizeLabels:false,limitToBed:false,
  modules:[{id:'m',x:0,y:0,width:168,height:126,sizeMode:'manual',pocketMargin:margin}],tools:[tool(kind)]});
const near=(actual,expected,message,tolerance=.02)=>assert.ok(Math.abs(actual-expected)<tolerance,`${message}: ${actual}, expected ${expected}`);
const dot=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function hits(mesh,origin,direction){
  const values=[];
  for(const [a,b,c] of mesh){
    const e1=sub(b,a),e2=sub(c,a),h=cross(direction,e2),det=dot(e1,h);if(Math.abs(det)<1e-10)continue;
    const inv=1/det,s=sub(origin,a),u=inv*dot(s,h);if(u< -1e-8||u>1+1e-8)continue;
    const q=cross(s,e1),v=inv*dot(direction,q);if(v< -1e-8||u+v>1+1e-8)continue;
    values.push(inv*dot(e2,q));
  }
  return values.sort((a,b)=>a-b).filter((value,i,sorted)=>!i||Math.abs(value-sorted[i-1])>1e-5);
}
function stl(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(80,true);
  assert.equal(bytes.byteLength,84+50*count);
  const mesh=Array.from({length:count},(_,i)=>[0,1,2].map(j=>[0,1,2].map(k=>view.getFloat32(84+i*50+12+j*12+k*4,true)))),edges=new Map();
  const key=point=>point.map(value=>Math.round(value*1e5)/1e5).join(',');let volume=0;
  for(const triangle of mesh){
    assert.ok(triangle.flat().every(Number.isFinite));volume+=dot(triangle[0],cross(triangle[1],triangle[2]))/6;
    for(let i=0;i<3;i++){
      const a=key(triangle[i]),b=key(triangle[(i+1)%3]),name=a<b?a+'|'+b:b+'|'+a,edge=edges.get(name)||{count:0,winding:0};
      edge.count++;edge.winding+=a<b?1:-1;edges.set(name,edge);
    }
  }
  for(const [key,edge]of edges){assert.equal(edge.count,2,'closed manufactured STL edge '+key);assert.equal(edge.winding,0,'opposing STL face winding '+key);}
  assert.ok(volume>0,'manufactured STL encloses positive volume');return mesh;
}
function color3mf(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),entries=new Map();
  for(let at=0;at+30<bytes.length&&view.getUint32(at,true)===0x04034b50;){
    const method=view.getUint16(at+8,true),size=view.getUint32(at+18,true),length=view.getUint16(at+26,true),extra=view.getUint16(at+28,true),start=at+30+length+extra;
    assert.equal(method,0,'native 3MF ZIP uses stored production XML');entries.set(new TextDecoder().decode(bytes.slice(at+30,at+30+length)),new TextDecoder().decode(bytes.slice(start,start+size)));at=start+size;
  }
  const xml=entries.get('3D/Objects/object_1.model');assert.ok(xml);assert.match(xml,/<model unit="millimeter"/);
  const triangles=[];
  for(const mesh of xml.matchAll(/<mesh>(.*?)<\/mesh>/gs)){
    const vertices=[...mesh[1].matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].map(m=>m.slice(1).map(Number));
    for(const t of mesh[1].matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g))triangles.push(t.slice(1).map(i=>vertices[+i]));
  }
  return triangles;
}
const transform=(mesh,m)=>mesh.map(triangle=>triangle.map(p=>[m[0]*p[0]+m[1]*p[1]+m[2]*p[2]+m[3],m[4]*p[0]+m[5]*p[1]+m[6]*p[2]+m[7],m[8]*p[0]+m[9]*p[1]+m[10]*p[2]+m[11]]));
// Independent fixture coordinates: raw origin (-7,11), tool rotation 37 degrees.
// The lower rotated x bound is -20*sin(37); the lower y bound is zero.
function world(raw){const c=Math.cos(radians(37)),s=Math.sin(radians(37));return{x:30+(raw.x+7)*c-(raw.y-11)*s+20*s,y:30+(raw.x+7)*s+(raw.y-11)*c};}
function shapePoint(kind,u,v){const g=grip(kind),angle=radians(kind==='circle'?37:g.rotation),c=Math.cos(angle),s=Math.sin(angle);return{x:g.x+u*c-v*s,y:g.y+u*s+v*c};}
const insideShape=(kind,u,v)=>{
  if(kind==='circle')return u*u+v*v<81;
  if(kind==='ellipse')return(u/10)**2+(v/6)**2<1;
  if(kind==='rectangle')return Math.abs(u)<10&&Math.abs(v)<6;
  return Math.hypot(Math.max(0,Math.abs(u)-7),Math.max(0,Math.abs(v)-3))<3;
};
const outsideDistance=(kind,u,v)=>{
  if(kind==='circle')return Math.hypot(u,v)-9;
  if(kind==='ellipse'){const radial=Math.hypot(u/10,v/6);return Math.hypot(u,v)*(1-1/radial);}
  if(kind==='rectangle')return Math.hypot(Math.max(0,Math.abs(u)-10),Math.max(0,Math.abs(v)-6));
  return Math.hypot(Math.max(0,Math.abs(u)-7),Math.max(0,Math.abs(v)-3))-3;
};
function svgPolygon(svg){const d=svg.match(/<path id="t"[^>]* d="([^"]+)"/)?.[1];assert.ok(d);return[...d.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].map(m=>({x:+m[1],y:+m[2]}));}
function inside(point,polygon){let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}

test('normalization, uniform tool scale and intrinsic resize preserve physical shaped grip sizes',()=>{
  for(const kind of kinds){
    const source=tool(kind),snapshot=structuredClone(source),g=source.fingerGrips[0],scaled=scaleTool(source,1.2),resized=resizeToolDimensions(source,{length:120,width:30});
    assert.deepEqual(scaled.fingerGrips[0],{...g,x:g.x*1.2,y:g.y*1.2});
    assert.deepEqual(resized.fingerGrips[0],{...g,x:60,y:0});
    const normalized=validateProject(project(kind)),retained=normalized.tools[0].fingerGrips[0];
    assert.deepEqual(retained,{...g,x:50,y:0});
    const reloaded=validateProject(JSON.parse(JSON.stringify({schemaVersion:1,project:normalized})));
    assert.deepEqual(reloaded.tools[0].fingerGrips,normalized.tools[0].fingerGrips);assert.deepEqual(source,snapshot);
  }
});

test('tool scaling rejects detached explicit shapes without replacing them with automatic circles',()=>{
  for(const kind of kinds.filter(kind=>kind!=='circle')){
    const source={...tool(kind),rotation:0,points:rectangle(0,0,100,20),fingerGrips:[{...grip(kind),x:105,y:10,width:12,height:8,rotation:0,...(kind==='rounded-rect'?{cornerRadius:2}:{})}]},before=structuredClone(source);
    assert.throws(()=>scaleTool(source,2),/Výřez|výřez|kaps/);assert.deepEqual(source,before);
  }
});

test('Smart packing preserves and uses actual noncircle grips instead of radius-only eligibility',{timeout:30000},async()=>{
  const source={...blankProject(),width:126,height:84,limitToBed:false,modules:[],tools:Array.from({length:3},(_,i)=>({id:'bar-'+i,name:'Bar '+i,x:0,y:0,rotation:0,moduleId:null,depth:8,points:rectangle(0,0,80,12),fingerGrips:[0,12].map((y,j)=>({id:`g-${i}-${j}`,x:40,y,shape:'ellipse',width:18,height:12,rotation:0}))}))},before=structuredClone(source);
  const result=await smartArrange(source);
  assert.deepEqual(result.unplaced,[]);assert.deepEqual(validateLayout({...source,...result}),[]);
  assert.ok(result.modules.some(module=>result.tools.filter(tool=>tool.moduleId===module.id).length>1),'actual shaped access participates in a shared packing candidate');
  for(const tool of result.tools)assert.deepEqual(tool.fingerGrips,source.tools.find(old=>old.id===tool.id).fingerGrips);
  assert.deepEqual(source,before);
});

test('actual STL, native 3MF and SVG preserve each grip shape, composed rotation, dimensions and depth',{timeout:60000},async t=>{
  for(const mode of ['solid','light'])for(const kind of kinds)for(const margin of [0,.8])await t.test(`${mode}, ${kind}, margin ${margin} mm`,async()=>{
    const source=project(kind,margin,mode),before=structuredClone(source),direct=stl(exportSTL(source)),svg=svgPolygon(exportSVG(source));
    const colored={...source,multiMaterial:{enabled:true,floor:true,text:false,floorThickness:.6}},batch=await preparePrintBatch(colored),part=batch.parts[0],file=batch.files.find(file=>file.name===part.file);
    assert.match(file.name,/\.3mf$/);const native=transform(color3mf(file.data),part.layoutTransform);
    const g=grip(kind),width=kind==='circle'?18:20,height=kind==='circle'?18:12,centre=world(g),a=radians(kind==='circle'?74:g.rotation+37),baseFloor=mode==='solid'?13:2.4;
    for(const [name,mesh,flipped] of [['STL',direct,true],['3MF',native,false]]){
      // In light mode the optional 0.6 mm color inlay is additional floor
      // material; it raises both floor and wall top while preserving depth.
      const floorExpected=baseFloor+(mode==='light'&&name==='3MF'?.6:0),topExpected=floorExpected+7,sectionZ=(floorExpected+topExpected)/2;
      const y=flipped?source.height-centre.y:centre.y,origin=[centre.x,y,sectionZ];
      for(const [axis,distance]of [[[-Math.cos(a),-Math.sin(a)],width/2],[[Math.sin(a),-Math.cos(a)],height/2]]){
        const direction=[axis[0],flipped?-axis[1]:axis[1],0],hit=hits(mesh,origin,direction).find(value=>value>1e-5);near(hit,distance,`${name} real grip half-dimension`);
      }
      const point=world(shapePoint(kind,0,-3)),outside=world(shapePoint(kind,0,-height/2-2));
      const floor=hits(mesh,[point.x,flipped?source.height-point.y:point.y,0],[0,0,1]).at(-1),top=hits(mesh,[outside.x,flipped?source.height-outside.y:outside.y,0],[0,0,1]).at(-1);
      near(floor,floorExpected,`${name} cavity floor`);near(top,topExpected,`${name} wall height`);near(top-floor,7,`${name} cavity depth`);
      for(const [u,v]of [[0,-3],[0,-height/2-1],[-7,-3],[-9,-5],[-11,-7]]){
        const raw=shapePoint(kind,u,v);if(raw.y>=11-margin-.25)continue;
        const p=world(raw),material=hits(mesh,[p.x,flipped?source.height-p.y:p.y,sectionZ],[0,0,1]).filter(value=>value>1e-5).length%2===1;
        const expected=insideShape(kind,u,v);
        // A material-saving body's exterior is also air beyond its thin wall.
        // Only probe outside the cavity where the independent shape distance
        // guarantees the point remains within the 2.4 mm wall.
        if(mode==='solid'||expected||outsideDistance(kind,u,v)<2)assert.equal(!material,expected,`${name} true ${kind} at own-frame ${u},${v}`);
        assert.equal(inside(p,svg),expected,`SVG true ${kind} at own-frame ${u},${v}`);
      }
    }
    assert.deepEqual(source,before,'manufacturing cannot change stored geometry or size');
  });
});
