import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEditorGeometryCache} from '../dist/editor-cache.js';
import {validateLayout} from '../dist/geometry.js';
import {pocketOutline} from '../dist/finger-grip.js';
import {findToolSets} from '../dist/tool-sets.js';
import {blankProject} from '../dist/model.js';
const make=()=>({...blankProject(),tools:[{id:'one',name:'Klíč',points:[{x:0,y:0},{x:10,y:0},{x:10,y:60},{x:0,y:60}],x:10,y:10,rotation:0,depth:8,moduleId:'m',fingerGrips:[]}],modules:[{id:'m',x:0,y:0,width:42,height:84}]});
test('read-only redraws reuse actual validation and set analysis; every geometry and language change invalidates them',()=>{
  const cache=createEditorGeometryCache({validateLayout,pocketOutline,findToolSets}),project=make();
  for(let i=0;i<10;i++){assert.deepEqual(cache.validate(project,'cs:mm'),validateLayout(project));cache.sets(project);}
  assert.deepEqual(cache.stats(),{layouts:1,sets:1,pockets:0,pocketHits:0});
  for(const change of [p=>p.tools[0].x+=1,p=>p.tools[0].points[0].x+=.1,p=>p.tools[0].depth=25,p=>p.clearance=1,p=>p.modules[0].width=84]){
    change(project);assert.deepEqual(cache.validate(project,'cs:mm'),validateLayout(project));cache.sets(project);
  }
  assert.equal(cache.stats().layouts,6);assert.equal(cache.stats().sets,6);cache.validate(project,'en:in');assert.equal(cache.stats().layouts,7);
  const restored=make();assert.deepEqual(cache.validate(restored,'cs:mm'),validateLayout(restored));assert.equal(cache.stats().layouts,8);
});
test('cached pocket geometry follows translation and invalidates in-place contour, rotation, clearance and finger edits',()=>{
  const cache=createEditorGeometryCache({validateLayout,pocketOutline,findToolSets}),tool=make().tools[0];
  const samePocket=(a,b)=>{assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)for(const key of ['x','y'])assert.ok(Math.abs(a[i][key]-b[i][key])<.00011);};
  samePocket(cache.pocket(tool,.8),pocketOutline(tool,.8));
  tool.x=94;tool.y=52;samePocket(cache.pocket(tool,.8),pocketOutline(tool,.8));assert.equal(cache.stats().pockets,1);assert.equal(cache.stats().pocketHits,1);
  tool.points[1].x=12;samePocket(cache.pocket(tool,.8),pocketOutline(tool,.8));assert.equal(cache.stats().pockets,2);
  tool.rotation=37;samePocket(cache.pocket(tool,.8),pocketOutline(tool,.8));
  samePocket(cache.pocket(tool,1),pocketOutline(tool,1));
  tool.fingerGrips=[{id:'grip',x:1,y:30,radius:7}];samePocket(cache.pocket(tool,1),pocketOutline(tool,1));
  tool.fingerGrips[0].y=32;samePocket(cache.pocket(tool,1),pocketOutline(tool,1));assert.equal(cache.stats().pockets,6);
  tool.fingerGrips[0].x=1000;assert.throws(()=>cache.pocket(tool,1));assert.throws(()=>cache.pocket(tool,1));
});
