import test from 'node:test';
import assert from 'node:assert/strict';
import {getToolDimensions,resizeToolDimensions} from '../dist/tool-dimensions.js';
import {bounds} from '../dist/geometry.js';
import {automaticFingerGrips,pocketOutline} from '../dist/finger-grip.js';
import {catalogItems} from '../dist/catalog/index.js';
import {blankProject,validateProject} from '../dist/model.js';
import {setLang,getLang} from '../dist/i18n.js';

const rectangle=(length=120,width=20)=>[{x:0,y:0},{x:length,y:0},{x:length,y:width},{x:0,y:width}];
const fixture=(extra={})=>({id:'dimension-tool',name:'Klíč 13 mm',points:rectangle(),x:160,y:180,rotation:0,depth:9,unit:'mm',moduleId:null,nominalSize:{value:13,unit:'mm'},sizeLabel:'13 mm',...extra});
const clone=value=>JSON.parse(JSON.stringify(value));
const close=(actual,expected,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} should equal ${expected}`);
const center=tool=>{const b=bounds(tool);return{x:b.x+b.width/2,y:b.y+b.height/2};};
const dimensions=(tool,length,width)=>{const d=getToolDimensions(tool);close(d.length,length);close(d.width,width);};
const rotatePoints=(points,degrees)=>{const angle=degrees*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);return points.map(p=>({x:p.x*c-p.y*s,y:p.x*s+p.y*c}));};

test('length and width are independent of placement and change only their requested intrinsic dimension',()=>{
  for(const rotation of [0,37,90,180]){
    const source=fixture({rotation}),before=clone(source),originalCenter=center(source);
    dimensions(source,120,20);
    const longer=resizeToolDimensions(source,{length:180}),wider=resizeToolDimensions(source,{width:25});
    dimensions(longer,180,20);dimensions(wider,120,25);
    for(const tool of [longer,wider]){close(center(tool).x,originalCenter.x);close(center(tool).y,originalCenter.y);assert.equal(tool.rotation,rotation);assert.equal(tool.depth,9);assert.deepEqual(tool.nominalSize,source.nominalSize);assert.equal(tool.sizeLabel,'13 mm');}
    assert.deepEqual(source,before);
  }
});

test('an intrinsically slanted silhouette retains its true shaft dimensions rather than its rotated bounding box',()=>{
  const source=fixture({points:rotatePoints(rectangle(),37),rotation:91}),before=clone(source),oldCenter=center(source);
  dimensions(source,120,20);assert.ok(Math.max(bounds(source).width,bounds(source).height)<120);
  const next=resizeToolDimensions(source,{length:160,width:24});dimensions(next,160,24);
  close(center(next).x,oldCenter.x);close(center(next).y,oldCenter.y);assert.deepEqual(source,before);
});

test('a vertical screwdriver keeps its width and real finger-bay radius when only length is edited',()=>{
  const points=[{x:0,y:0},{x:20,y:0},{x:20,y:120},{x:0,y:120}],source=fixture({points,rotation:37,sizeLabel:'PH2',nominalSize:undefined,
    fingerGrips:[{id:'left',x:1.2,y:100,radius:7},{id:'right',x:18.8,y:100,radius:7}]});
  delete source.nominalSize;const before=clone(source),next=resizeToolDimensions(source,{length:160});
  dimensions(next,160,20);close(Math.max(...next.points.map(p=>p.y)),160);close(Math.max(...next.points.map(p=>p.x)),20);
  assert.deepEqual(next.fingerGrips.map(g=>[g.id,g.radius]),[['left',7],['right',7]]);
  for(const grip of next.fingerGrips)close(grip.y,100*4/3);
  assert.equal(next.sizeLabel,'PH2');assert.equal(next.depth,9);assert.ok(pocketOutline(next,.8).length>3);assert.deepEqual(source,before);
});

test('real catalogue wrench and screwdriver preserve nominal size, manual metadata and JSON-compatible geometry',()=>{
  const items=catalogItems();
  for(const item of [items.find(item=>item.id==='combination-wrench-13mm'),items.find(item=>item.id.startsWith('screwdriver-ph2'))]){
    assert.ok(item);const source=fixture({...clone(item),name:item.name.cs,rotation:90,nominalSize:{value:13,unit:'mm'},sizeLabel:item.category==='wrenches'?'13 mm':'PH2'});
    source.fingerGrips=automaticFingerGrips(source,{radius:7});const before=clone(source),d=getToolDimensions(source),next=resizeToolDimensions(source,{length:d.length*1.2});
    dimensions(next,d.length*1.2,d.width);assert.equal(next.id,source.id);assert.deepEqual(next.nominalSize,source.nominalSize);assert.deepEqual(next.source,source.source);
    assert.equal(next.sizeLabel,source.sizeLabel);assert.equal(next.depth,source.depth);assert.deepEqual(next.fingerGrips.map(g=>g.radius),[7,7]);
    const restored=validateProject({...blankProject(),tools:[next]}).tools[0];dimensions(restored,d.length*1.2,d.width);
    close(center(restored).x,center(next).x);close(center(restored).y,center(next).y);assert.ok(pocketOutline(restored,.8).length>3);assert.deepEqual(source,before);
  }
});

test('explicitly cleared and legacy absent finger bays stay untouched, and returned geometry is an independent copy',()=>{
  for(const source of [fixture(),fixture({fingerGrips:[]})]){
    const before=clone(source),next=resizeToolDimensions(source,{length:150});
    assert.equal(Object.hasOwn(next,'fingerGrips'),Object.hasOwn(source,'fingerGrips'));assert.deepEqual(next.fingerGrips,source.fingerGrips);
    next.points[0].x+=1;assert.deepEqual(source,before);
    const unchanged=resizeToolDimensions(source,{});assert.deepEqual(unchanged,source);assert.notEqual(unchanged,source);assert.notEqual(unchanged.points,source.points);
  }
});

test('supported extreme factors and physical limits are exact while invalid values fail without mutation',()=>{
  const source=fixture({points:rectangle(100,10)}),before=clone(source);
  dimensions(resizeToolDimensions(source,{length:20}),20,10);dimensions(resizeToolDimensions(source,{length:500}),500,10);
  dimensions(resizeToolDimensions(source,{width:2}),100,2);dimensions(resizeToolDimensions(source,{length:'150'}),150,10);
  for(const rotation of [0,90,180]){
    const limit=resizeToolDimensions(fixture({points:rotatePoints(rectangle(600,20),rotation)}),{length:3000});
    dimensions(limit,3000,20);assert.ok(limit.points.every(p=>p.x<=3000&&p.y<=3000));
    const restored=validateProject({...blankProject(),tools:[limit]}).tools[0];dimensions(restored,3000,20);
  }
  for(const key of ['length','width'])for(const value of [NaN,Infinity,-Infinity,0,1.99,3000.1,null,true,false,'','   ',[],{}])assert.throws(()=>resizeToolDimensions(source,{[key]:value}),error=>!!error.i18n,`${key}=${String(value)}`);
  for(const value of [{length:19.9},{length:500.1},{width:50.1}])assert.throws(()=>resizeToolDimensions(source,value),/Měřítko/);
  assert.deepEqual(source,before);
});

test('axis flips, oversized raw projections and detached manual bays are rejected atomically',()=>{
  const wide=fixture({points:rectangle(100,30)}),wideBefore=clone(wide);
  assert.throws(()=>resizeToolDimensions(wide,{length:20}),/podélnou osu/);assert.throws(()=>resizeToolDimensions(wide,{width:150}),/podélnou osu/);assert.deepEqual(wide,wideBefore);
  const slanted=fixture({points:rotatePoints(rectangle(600,300),45)}),slantedBefore=clone(slanted);
  assert.throws(()=>resizeToolDimensions(slanted,{length:3000,width:1500}),/přesáhnout/);assert.deepEqual(slanted,slantedBefore);
  const manual=fixture({points:rectangle(100,10),fingerGrips:[{id:'end',x:105,y:5,radius:6}]}),manualBefore=clone(manual);
  assert.ok(pocketOutline(manual,0).length>3);assert.throws(()=>resizeToolDimensions(manual,{length:500}),/Výřezy pro prsty/);assert.deepEqual(manual,manualBefore);
});

test('malformed contours and option objects fail clearly, with translated dimension errors',()=>{
  for(const source of [{points:[]},{points:[{x:0,y:0},{x:1,y:1},{x:2,y:2}]},{points:[{x:0,y:0},{x:NaN,y:5},{x:4,y:0}]}])assert.throws(()=>getToolDimensions(source),error=>!!error.i18n);
  for(const options of [null,[],false])assert.throws(()=>resizeToolDimensions(fixture(),options),error=>!!error.i18n);
  const original=getLang();try{setLang('en',{save:false});assert.throws(()=>resizeToolDimensions(fixture(),{length:''}),/Enter a valid tool length/);assert.throws(()=>resizeToolDimensions(fixture(),{length:3001}),/Tool dimensions/);}finally{setLang(original,{save:false});}
});
