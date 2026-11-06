import test from 'node:test';
import assert from 'node:assert/strict';
import {planSizeLabels,sizeLabelGlyphs} from '../dist/size-labels.js';
import {labelStyleFor,normalizeLabelStyle} from '../dist/label-style.js';
import {blankProject,validateProject} from '../dist/model.js';
import {exportSTL} from '../dist/geometry.js';
import {preparePrintBatch} from '../dist/print-batch.js';
import {materialConfig,materialSlots,zoneColor} from '../dist/print-material.js';
import {previewGeometryKey} from '../dist/preview3d.js';
import {labelGestureStyle,labelMarkup} from '../dist/size-label-ui.js';

const rectangle=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const tool=(id,x,y,extra={})=>({id,name:id,points:rectangle(30,20),x,y,rotation:0,depth:8,moduleId:'m',sizeLabel:'80',...extra});
const fixture=(style,extra={})=>({...blankProject(),id:'style',width:252,height:252,sizeLabels:true,limitToBed:false,printMode:'light',bottomMode:'plain',modules:[{id:'m',name:'M',x:42,y:42,width:126,height:126,sizeMode:'manual'}],tools:[tool('a',60,60,style?{labelStyle:style}:{})],...extra});
const signed=points=>points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a.x*b.y-b.x*a.y;},0)/2;
const area=label=>label.polygons.reduce((sum,poly)=>sum+signed(poly),0);
function closedVolume(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(80,true),edges=new Map();let volume=0;
  const key=p=>p.map(value=>Math.round(value*1e5)/1e5).join(',');
  for(let i=0;i<count;i++){
    const tri=Array.from({length:3},(_,j)=>[0,1,2].map(c=>view.getFloat32(84+i*50+12+j*12+c*4,true))),[a,b,c]=tri;
    volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    for(let j=0;j<3;j++){const s=key(tri[j]),e=key(tri[(j+1)%3]),id=s<e?s+'|'+e:e+'|'+s,entry=edges.get(id)||{count:0,direction:0};entry.count++;entry.direction+=s<e?1:-1;edges.set(id,entry);}
  }
  for(const [edge,entry] of edges){assert.equal(entry.count,2,'non-manifold edge '+edge);assert.equal(entry.direction,0,'incorrect winding '+edge);}
  return volume;
}

test('style fields survive a project round trip and invalid values never reject a project',()=>{
  assert.equal(normalizeLabelStyle(null),undefined);assert.equal(normalizeLabelStyle({size:'x',color:'red',background:1}),undefined);
  assert.deepEqual(normalizeLabelStyle({size:1,relief:99,rotation:-90,background:false,color:'#ABCDEF',dx:1,dy:2}),{size:2.8,relief:5,rotation:270,background:false,color:'#abcdef',dx:1,dy:2});
  assert.equal(normalizeLabelStyle({rotation:360}).rotation,0);
  assert.equal(normalizeLabelStyle({dx:1}),undefined,'a position needs both axes');
  const saved=validateProject(fixture({size:6,dx:0,dy:30},{sizeLabelStyle:{relief:.5,dx:9,dy:9}}));
  assert.deepEqual(saved.tools[0].labelStyle,{size:6,dx:0,dy:30});assert.deepEqual(saved.sizeLabelStyle,{relief:.5},'a drawer default has no position');
  assert.equal(Object.hasOwn(validateProject(fixture()),'sizeLabelStyle'),false);assert.equal(Object.hasOwn(validateProject(fixture()).tools[0],'labelStyle'),false);
});

test('a tool override wins over the drawer default and an unstyled project keeps the original plan',()=>{
  const merged=labelStyleFor({sizeLabelStyle:{size:5,relief:.6,background:false}},{labelStyle:{size:8}});
  assert.equal(merged.size,8);assert.equal(merged.relief,.6);assert.equal(merged.background,false);assert.equal(merged.rotation,null);assert.equal(merged.position,null);
  const label=planSizeLabels(fixture()).labels[0];
  assert.equal(label.depth,.35);assert.equal(label.top,label.baseTop+1);assert.equal(label.manual,false);assert.equal(label.displaced,false);assert.equal(label.color,null);
  assert.equal(label.width,sizeLabelGlyphs('80').width+1.6);assert.equal(label.height,3.5+1.6);
});

test('letter size scales the glyphs and the plate',()=>{
  const small=sizeLabelGlyphs('13',3.5),large=sizeLabelGlyphs('13',7);
  assert.equal(large.height,7);assert.ok(Math.abs(large.width-small.width*2)<1e-6);
  const label=planSizeLabels(fixture({size:7})).labels[0];assert.equal(label.height,7+1.6);assert.equal(label.size,7);
});

test('a hand-placed label sits at its offset from the pocket and follows the tool',()=>{
  const p=fixture({dx:0,dy:32}),label=planSizeLabels(p).labels[0];
  assert.equal(label.manual,true);assert.equal(label.displaced,false);
  assert.deepEqual(label.center,{x:label.anchor.x,y:label.anchor.y+32});
  const moved=planSizeLabels({...p,tools:[{...p.tools[0],x:p.tools[0].x+10}]}).labels[0];
  assert.equal(moved.manual,true);assert.ok(Math.abs(moved.center.x-label.center.x-10)<1e-6);
});

test('an impossible spot falls back to a safe automatic place and says so',()=>{
  for(const [dx,dy] of [[0,0],[0,500]]){
    const label=planSizeLabels(fixture({dx,dy})).labels[0];
    assert.ok(label,'the label is kept');assert.equal(label.manual,false);assert.equal(label.displaced,true);
  }
});

test('an automatic neighbour cannot take a hand-placed spot',()=>{
  const p=fixture(null,{tools:[tool('a',60,60),tool('b',60,110,{labelStyle:{dx:0,dy:-22}})]}),plan=planSizeLabels(p);
  assert.equal(plan.labels.length,2);assert.equal(plan.labels.find(label=>label.toolId==='b').manual,true);
});

test('any rotation turns the plate and the letters together and keeps them inside the module',()=>{
  for(const rotation of [0,30,45,90,135,180,270,333]){
    const label=planSizeLabels(fixture({rotation,dx:0,dy:32})).labels[0];
    assert.equal(label.rotation,rotation);assert.equal(label.manual,true,`${rotation}° fits`);assert.equal(label.plate.length,4);
    assert.ok(signed(label.plate)>0,'the plate keeps its winding');
    assert.ok(Math.abs(signed(label.plate)-label.plateWidth*label.plateDepth)<.01,'turning does not change the plate area');
    for(const point of label.screenPolygons.flat())assert.ok(Math.abs(point.x-label.center.x)<label.width/2+1e-6&&Math.abs(point.y-label.center.y)<label.height/2+1e-6);
  }
  const ninety=planSizeLabels(fixture({rotation:90})).labels[0];assert.equal(ninety.width,planSizeLabels(fixture({rotation:90,size:3.5})).labels[0].width);
});

test('relief sets the engraving depth and thickens the plaque only when it has to',()=>{
  const light=planSizeLabels(fixture({relief:.6})).labels[0];assert.equal(light.depth,.6);assert.ok(Math.abs(light.top-light.baseTop-1.25)<1e-6);
  const shallow=planSizeLabels(fixture({relief:.2})).labels[0];assert.equal(shallow.depth,.2);assert.equal(shallow.top,shallow.baseTop+1);
  const solid=planSizeLabels(fixture({relief:1.5},{printMode:'solid'})).labels[0],plain=planSizeLabels(fixture(null,{printMode:'solid'})).labels[0];
  assert.equal(solid.depth,1.5);assert.equal(solid.top,plain.top,'an engraving never changes the top surface');
});

test('relief cannot break through the base of a low insert',()=>{
  const low={insertHeight:4,tools:[tool('a',60,60,{depth:1,labelStyle:{relief:5}})]};
  for(const printMode of ['solid','light']){
    const p=fixture(null,{...low,printMode}),label=planSizeLabels(p).labels[0];
    assert.ok(label.top-label.depth>=label.baseTop+.3-1e-6,printMode);closedVolume(exportSTL(p,{moduleId:'m'}));
  }
});

test('without a background a light label is raised letters standing on the base',()=>{
  const p=fixture({background:false,relief:1.5}),label=planSizeLabels(p).labels[0];
  assert.equal(label.raised,true);assert.equal(label.background,false);assert.equal(label.depth,1.5);assert.equal(label.top,label.baseTop+1.5);
  const plain=closedVolume(exportSTL({...p,sizeLabels:false},{moduleId:'m'})),actual=closedVolume(exportSTL(p,{moduleId:'m'}));
  assert.ok(Math.abs(actual-plain-area(label)*1.5)<.03,'only the letters are added');
  assert.equal(planSizeLabels(fixture({background:false})).labels[0].depth,1,'raised letters default to 1 mm');
});

test('a solid body ignores the background switch: there is nothing to remove under an engraving',()=>{
  const label=planSizeLabels(fixture({background:false},{printMode:'solid'})).labels[0];
  assert.equal(label.raised,false);assert.equal(label.background,false);assert.equal(label.depth,.35);
});

test('every combination stays a closed printable mesh',()=>{
  const tools=[tool('a',60,60,{sizeLabel:'80'}),tool('b',60,105,{sizeLabel:'8B'})];
  for(const printMode of ['solid','light'])for(const style of [{rotation:33,size:6,dx:0,dy:30},{background:false,rotation:45,dx:0,dy:30},{background:false,size:9,relief:2.4},{relief:3,size:5}]){
    const p=fixture(null,{printMode,tools:tools.map(item=>({...item,labelStyle:style}))});
    assert.equal(planSizeLabels(p).labels.length,2);closedVolume(exportSTL(p,{moduleId:'m'}));
  }
});

test('raised letters survive a module split across print parts',async()=>{
  const settings={bedWidth:60,bedHeight:200,limitToBed:true,connectors:false},cuts=(await preparePrintBatch(fixture(null,settings))).parts.map(part=>part.clip.x).filter(x=>x>42);
  assert.ok(cuts.length,'the module is cut');
  // Centre the letters on a real cut, so it runs through them and not beside them.
  const anchor=planSizeLabels(fixture()).labels[0].anchor,p=fixture({background:false,size:8,dx:cuts[0]-anchor.x,dy:32},settings),label=planSizeLabels(p).labels[0];
  assert.equal(label.manual,true);assert.ok(label.x<cuts[0]&&label.x+label.width>cuts[0]);
  const result=await preparePrintBatch(p);
  for(const part of result.parts)closedVolume(result.files.find(file=>file.name===part.file).data);
});

test('own label colours become separate text zones and filaments',async()=>{
  const tools=[tool('a',60,60,{labelStyle:{color:'#ff0000'}}),tool('b',60,105),tool('c',105,105,{labelStyle:{color:'#ffffff'}})];
  const p=fixture(null,{tools,multiMaterial:{enabled:true,floor:false,textColor:'#ffffff'}}),result=await preparePrintBatch(p);
  assert.deepEqual(result.manifest.colors.filaments,['#2f3a45','#ffffff','#ff0000']);
  assert.deepEqual(result.manifest.colors.zones,{body:1,text:2,'text:#ff0000':3});
  assert.deepEqual(Object.keys(result.parts[0].colorFiles).sort(),['body','text','text:#ff0000']);
  assert.ok(result.files.some(file=>file.name.endsWith('-text-ff0000.stl')));
  assert.equal(zoneColor('text:#ff0000',materialConfig(p)),'#ff0000');assert.equal(zoneColor('text',materialConfig(p)),'#ffffff');
  assert.deepEqual(materialSlots({...materialConfig(p),floor:false,text:false,labelColors:['#ff0000']}).colors,['#2f3a45'],'no text zone, no extra filament');
});

test('raised letters in colour are not built twice',async()=>{
  const p=fixture({background:false,relief:1.5},{multiMaterial:{enabled:true,floor:false}}),label=planSizeLabels(p).labels[0];
  const result=await preparePrintBatch(p),part=result.parts[0],mono=await preparePrintBatch({...p,multiMaterial:{enabled:false}});
  const volume=name=>closedVolume(result.files.find(file=>file.name===part.colorFiles[name]).data);
  assert.ok(Math.abs(volume('text')-area(label)*1.5)<.03);
  assert.ok(Math.abs(volume('body')+volume('text')-mono.parts[0].volumeMm3)<.05,'body + text equals the one-colour model');
});

test('changing a label rebuilds the 3D preview',()=>{
  const base=fixture();
  assert.notEqual(previewGeometryKey(base),previewGeometryKey(fixture({size:6})));
  assert.notEqual(previewGeometryKey(base),previewGeometryKey({...base,sizeLabelStyle:{size:6}}));
});

test('a gesture pins position and angle and reports the same change it draws',()=>{
  const label={center:{x:100,y:50},anchor:{x:80,y:50},rotation:90,size:4},start={x:110,y:50};
  const moved=labelGestureStyle({mode:'move',label,start},{x:115,y:42});
  assert.deepEqual(moved.style,{dx:25,dy:-8,rotation:90},'a label placed automatically keeps its chosen angle');
  assert.equal(moved.transform,'translate(5 -8)');
  const turned=labelGestureStyle({mode:'rotate',label,start},{x:100,y:60});
  assert.equal(turned.style.rotation,180);assert.equal(turned.style.dx,20);
  assert.equal(labelGestureStyle({mode:'rotate',label,start},{x:100,y:40}).style.rotation,0,'angles wrap around');
  assert.equal(labelGestureStyle({mode:'rotate',label,start},{x:108,y:55},{step:15}).style.rotation,120,'Shift snaps to 15 degrees');
  assert.equal(labelGestureStyle({mode:'size',label,start},{x:120,y:50}).style.size,8);
  assert.equal(labelGestureStyle({mode:'size',label,start},{x:100.1,y:50}).style.size,2.8,'size stays printable');
  assert.equal(labelGestureStyle({mode:'size',label,start},{x:900,y:50}).style.size,30);
});

test('board markup offers all four handles, and a background only when one is built',()=>{
  const label=planSizeLabels(fixture({color:'#123456'})).labels[0],html=labelMarkup(label);
  for(const kind of ['move','rotate','size','color'])assert.ok(html.includes(`data-label-gesture="${kind}"`),kind);
  assert.ok(html.includes('class="label-plate"'));assert.ok(html.includes('fill="#123456"'));assert.equal(html.includes('model-size-label active'),false);
  assert.ok(labelMarkup(label,{active:true}).includes('model-size-label active'));
  assert.equal(labelMarkup(planSizeLabels(fixture({background:false})).labels[0]).includes('class="label-plate"'),false);
  assert.equal(labelMarkup(planSizeLabels(fixture(null,{printMode:'solid'})).labels[0]).includes('class="label-plate"'),false);
});
