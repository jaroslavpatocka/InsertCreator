// Joints and stepped module footprints must keep clear of the widened top edge of a profiled pocket.
import test from 'node:test';
import assert from 'node:assert/strict';
import {planJoints} from '../dist/module-joints.js';
import {steppedModuleFootprint} from '../dist/module-footprint.js';
import {pocketOutline} from '../dist/finger-grip.js';
import {blankProject} from '../dist/model.js';

const rect=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const CHAMFER={type:'chamfer',value:3};

test('a joint that fits beside a vertical pocket is refused beside its chamfered top edge',()=>{
  // The tall pocket covers the whole shared edge, so the joint cannot slide past it.
  const plan=(x,wall)=>{
    const project={...blankProject(),width:504,height:378,bottomMode:'plain',printMode:'solid',connectors:true,
      modules:[{id:'a',name:'a',x:0,y:0,width:84,height:84,locked:true,sizeMode:'manual'},{id:'b',name:'b',x:84,y:0,width:84,height:84,locked:true,sizeMode:'manual'}],
      tools:[{id:'t',name:'t',moduleId:'b',points:rect(30,78),x,y:3,rotation:0,depth:10,fingerGrips:[],...(wall?{pocketWall:wall}:{})}]};
    return planJoints(project,project.modules,project.tools);
  };
  let x=84;while(x<130&&plan(x).skipped)x+=.25;
  assert.ok(x<130,'some position leaves room for the joint');
  assert.equal(plan(x).joints.length,1);
  assert.equal(plan(x,{type:'roundBottom',value:3}).joints.length,1,'a rounded floor does not widen the top edge');
  const chamfered=plan(x,CHAMFER);
  assert.equal(chamfered.joints.length,0);assert.equal(chamfered.skipped,1);
  assert.equal(plan(x+3.5,CHAMFER).joints.length,1,'moving the pocket by its outset frees the joint again');
});

test('a stepped footprint keeps the cell under a widened top edge, whether or not a poly is supplied',()=>{
  const project={...blankProject(),width:504,height:378},module={id:'m',name:'m',x:0,y:0,width:126,height:84};
  const tool=(x,wall,withPoly)=>{const t={id:'t',name:'t',moduleId:'m',points:rect(30,60),x,y:12,rotation:0,depth:10,...(wall?{pocketWall:wall}:{})};return withPoly?{...t,poly:pocketOutline(t,project)}:t;};
  const footprint=(...args)=>steppedModuleFootprint({...project,tools:[tool(...args)]},module);
  // Slide right until the lower-left cell is free of the vertical pocket plus its module padding.
  let x=40;while(x<50&&!footprint(x).cells)x+=.25;
  const vertical=footprint(x);
  assert.ok(vertical.cells?.length===3,JSON.stringify(vertical));
  assert.deepEqual(footprint(x,null,true),vertical,'a precomputed vertical pocket gives the same footprint');
  assert.deepEqual(footprint(x,{type:'roundBottom',value:3}),vertical);
  for(const withPoly of [false,true]){
    const widened=footprint(x,CHAMFER,withPoly);
    assert.equal(widened.cells,undefined,`poly supplied: ${withPoly}`);
    assert.equal(widened.width,84);assert.equal(widened.height,84);
  }
});
