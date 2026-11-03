import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticFingerGrips,pocketOutline} from '../dist/finger-grip.js';

const points=coordinates=>coordinates.map(([x,y])=>({x,y}));
const rotate=(contour,degrees)=>{const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return contour.map(p=>({x:p.x*c-p.y*s,y:p.x*s+p.y*c}));};
const unrotate=(point,degrees)=>rotate([point],-degrees)[0];

test('automatic bays choose the nearby thin shaft instead of a broad handle at the exact middle',()=>{
  const contour=points([[0,-20],[110,-20],[110,-3],[190,-3],[190,-8],[200,-8],[200,8],[190,8],[190,3],[110,3],[110,20],[0,20]]);
  for(const rawRotation of [0,37,90,129])for(const placementRotation of [0,37,90,180]){
    const tool={id:'shaft',points:rotate(contour,rawRotation),rotation:placementRotation,x:100,y:40,fingerGrips:[{id:'manual',x:0,y:0,radius:12}]},before=structuredClone(tool);
    const grips=automaticFingerGrips(tool,{radius:9}),local=grips.map(grip=>unrotate(grip,rawRotation));
    assert.ok(local.every(g=>g.x>=110-1e-6&&g.x<=130+1e-6),'the thin section must remain within the central 35–65% band');
    assert.ok(local.every(g=>Math.abs(g.y)<3),'both centres lie on the actual shaft, rather than the handle');
    assert.ok(grips.every(g=>g.radius===9),'physical radius stays fixed in millimetres');
    assert.ok(pocketOutline({...tool,fingerGrips:grips},.8).length>3);assert.deepEqual(tool,before,'explicit regeneration must not mutate stored manual bays');
  }
});

test('equal-width central sections stay at the midpoint and narrower end tips cannot attract bays',()=>{
  const contour=points([[0,-2],[20,-2],[20,-8],[180,-8],[180,-2],[200,-2],[200,2],[180,2],[180,8],[20,8],[20,2],[0,2]]);
  for(const angle of [0,37,129]){
    const tool={id:'middle',points:rotate(contour,angle)},grips=automaticFingerGrips(tool,{radius:7}),local=grips.map(g=>unrotate(g,angle));
    assert.ok(local.every(g=>Math.abs(g.x-100)<1e-6),'equal-width candidates prefer the midpoint, away from narrow ends');
    assert.ok(local.every(g=>Math.abs(g.y)<8));assert.deepEqual(automaticFingerGrips(tool,{radius:7}),grips);
  }
});

test('a narrow concave central branch still produces one connected pocket',()=>{
  const contour=points([[0,0],[12,0],[12,180],[40,180],[40,0],[60,0],[60,200],[0,200]]),tool={id:'concave',points:contour};
  const grips=automaticFingerGrips(tool);
  assert.ok(grips.every(g=>g.x>0&&g.x<12&&g.y>70&&g.y<130),'the narrower filled central branch wins within the middle band');
  assert.ok(pocketOutline({...tool,fingerGrips:grips},0).length>3);
});
