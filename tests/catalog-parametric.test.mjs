import test from 'node:test';
import assert from 'node:assert/strict';
import items from '../dist/catalog/parametric.js';
import {CATEGORIES} from '../dist/catalog/index.js';
import {validateProject,blankProject} from '../dist/model.js';
import {pocketOutline} from '../dist/finger-grip.js';

const byId=id=>{const item=items.find(i=>i.id===id);assert.ok(item,`missing ${id}`);return item;};
const bbox=points=>({w:Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),h:Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))});
const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
function segmentsIntersect(a,b,c,d){
  const d1=cross(c,d,a),d2=cross(c,d,b),d3=cross(a,b,c),d4=cross(a,b,d);
  return ((d1>0&&d2<0)||(d1<0&&d2>0))&&((d3>0&&d4<0)||(d3<0&&d4>0));
}
function selfIntersects(points){
  const n=points.length;
  for(let i=0;i<n;i++)for(let j=i+2;j<n;j++){
    if(i===0&&j===n-1)continue;
    if(segmentsIntersect(points[i],points[(i+1)%n],points[j],points[(j+1)%n]))return true;
  }
  return false;
}

test('catalogue is sizeable with unique, stable ids',()=>{
  assert.ok(items.length>=120&&items.length<=260,`count ${items.length}`);
  const ids=new Set(items.map(i=>i.id));
  assert.equal(ids.size,items.length);
  for(const item of items)assert.match(item.id,/^[a-z0-9-]+$/);
});

test('every item has valid metadata',()=>{
  const cats=new Set(CATEGORIES.map(c=>c.id));
  for(const item of items){
    assert.ok(cats.has(item.category),`${item.id} category ${item.category}`);
    assert.ok(item.name.cs.trim()&&item.name.en.trim(),`${item.id} names`);
    assert.ok(['mm','in'].includes(item.unit),item.id);
    assert.ok(['standard','typical'].includes(item.accuracy),item.id);
    assert.ok(item.depth>=2&&item.depth<=60,`${item.id} depth ${item.depth}`);
    assert.ok(item.source?.name&&item.source.license,item.id);
    assert.ok(Array.isArray(item.tags)&&item.tags.length,item.id);
    assert.ok(item.points.length>=3&&item.points.length<=400,`${item.id} has ${item.points.length} points`);
  }
});

test('outlines pass the project validator, pocket offset and have no self-intersections',()=>{
  for(const item of items){
    const project=validateProject({...blankProject(),tools:[{id:item.id,name:item.name.cs,points:item.points,depth:item.depth}]});
    assert.equal(project.tools.length,1);
    const pocket=pocketOutline(project.tools[0],.8);
    assert.ok(pocket.length,`${item.id} pocket`);
    assert.equal(selfIntersects(item.points),false,`${item.id} self-intersects`);
  }
});

test('sample dimensions are plausible',()=>{
  const wrench=bbox(byId('combination-wrench-13mm').points);
  assert.ok(wrench.w>=160&&wrench.w<=200,`13 mm wrench length ${wrench.w}`);
  assert.ok(wrench.h>=25&&wrench.h<=45,`13 mm wrench head ${wrench.h}`);
  const key=bbox(byId('hex-key-l-5mm').points);
  assert.ok(Math.max(key.w,key.h)>=80&&Math.max(key.w,key.h)<=110,`5 mm hex key long leg ${key.w}`);
  const socket=bbox(byId('socket-1-2in-13mm').points);
  assert.ok(socket.w>=35&&socket.w<=45,`1/2" socket length ${socket.w}`);
  const sae=bbox(byId('combination-wrench-1-2in').points);
  assert.ok(sae.w>=150&&sae.w<=190,`1/2" wrench length ${sae.w}`);
});

test('metric and imperial sizes carry the right unit',()=>{
  assert.equal(byId('combination-wrench-13mm').unit,'mm');
  assert.equal(byId('combination-wrench-13mm').size,13);
  assert.equal(byId('combination-wrench-1-2in').unit,'in');
  assert.equal(byId('combination-wrench-1-2in').size,.5);
  assert.equal(byId('hex-key-l-5-32in').unit,'in');
  assert.equal(byId('hex-key-l-2-5mm').unit,'mm');
  assert.match(byId('combination-wrench-1-2in').name.en,/1\/2"/);
  for(const item of items.filter(i=>i.unit==='in'))assert.ok(item.size>0&&item.size<=2,`${item.id} size ${item.size}`);
});
