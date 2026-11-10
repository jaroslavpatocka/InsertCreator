import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePocketWall,validatePocketWall,pocketWallOffset,pocketWallOutset,pocketWallInset,pocketWallBands,pocketLayoutOutline,pocketFloorOutlines,POCKET_WALL_STEP} from '../dist/pocket-wall.js';

const near=(a,b,eps=1e-9,m='')=>assert.ok(Math.abs(a-b)<=eps,`${m} ${a} != ${b} ±${eps}`);
const rejects=(fn,re)=>assert.throws(fn,e=>re.test(e.i18n?.cs||e.message));
const box=poly=>{const xs=poly.map(p=>p.x),ys=poly.map(p=>p.y);return{w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};};
const rectTool=(extra={})=>({id:'t',name:'Klíč',x:0,y:0,rotation:0,depth:10,points:[{x:0,y:0},{x:40,y:0},{x:40,y:20},{x:0,y:20}],...extra});

test('normalization keeps vertical as null and validates ranges',()=>{
  for(const v of [null,undefined,{type:'vertical'},{type:'vertical',value:5}])assert.equal(normalizePocketWall(v),null);
  assert.deepEqual(normalizePocketWall({type:'draft',value:'10'}),{type:'draft',value:10});
  assert.deepEqual(normalizePocketWall({type:'roundTop',value:2,extra:1}),{type:'roundTop',value:2});
  rejects(()=>normalizePocketWall({type:'draft',value:60}),/Úhel/);
  rejects(()=>normalizePocketWall({type:'draft',value:0}),/Úhel/);
  rejects(()=>normalizePocketWall({type:'chamfer',value:0}),/Rozměr/);
  rejects(()=>normalizePocketWall({type:'chamfer',value:NaN}),/Rozměr/);
  rejects(()=>normalizePocketWall({type:'spiral',value:1}),/Neznámý/);
  rejects(()=>normalizePocketWall('draft'),/Neznámý/);
  rejects(()=>validatePocketWall({type:'roundBottom',value:6},5),/hloubka|hloubk/);
  assert.deepEqual(validatePocketWall({type:'draft',value:30},5),{type:'draft',value:30});
});

test('profile offsets match the geometric definitions',()=>{
  const d=10;
  near(pocketWallOffset({type:'draft',value:45},d,4),4);near(pocketWallOffset({type:'draft',value:10},d,0),0);
  near(pocketWallOffset({type:'chamfer',value:2},d,8),0);near(pocketWallOffset({type:'chamfer',value:2},d,9),1);near(pocketWallOffset({type:'chamfer',value:2},d,10),2);
  near(pocketWallOffset({type:'roundTop',value:2},d,8),0);near(pocketWallOffset({type:'roundTop',value:2},d,10),2);
  near(pocketWallOffset({type:'roundTop',value:2},d,9),2-Math.sqrt(3));
  near(pocketWallOffset({type:'roundBottom',value:2},d,0),-2);near(pocketWallOffset({type:'roundBottom',value:2},d,2),0);
  near(pocketWallOffset({type:'roundBottom',value:2},d,1),-(2-Math.sqrt(3)));
  near(pocketWallOutset(rectTool({pocketWall:{type:'draft',value:10}})),10*Math.tan(Math.PI/18));
  assert.equal(pocketWallOutset(rectTool({pocketWall:{type:'roundBottom',value:2}})),0);
  assert.equal(pocketWallInset(rectTool({pocketWall:{type:'roundBottom',value:2}})),2);
  assert.equal(pocketWallOutset(rectTool()),0);
});

test('terrace bands cover the depth, start at the exact floor and stay within the profile',()=>{
  for(const wall of [{type:'draft',value:10},{type:'draft',value:45},{type:'chamfer',value:1.5},{type:'roundTop',value:3},{type:'roundBottom',value:3},{type:'roundTop',value:10},null]){
    const d=10,bands=pocketWallBands(wall,d);
    near(bands[0].h0,0);near(bands.at(-1).h1,d);
    bands.forEach((b,i)=>{if(i)near(b.h0,bands[i-1].h1,1e-12);assert.ok(b.h1>b.h0);});
    near(bands[0].offset,pocketWallOffset(wall,d,0),1e-12,'floor');
    for(const b of bands){
      // Lower-bound sampling: the band never cuts beyond the true (non-decreasing) profile.
      assert.ok(b.offset<=pocketWallOffset(wall,d,b.h0)+1e-12&&b.offset<=pocketWallOffset(wall,d,b.h1)+1e-12);
      const curved=wall&&wall.type!=='draft'&&wall.type!=='chamfer';
      if(Math.abs(pocketWallOffset(wall,d,b.h1)-b.offset)>1e-9||curved){
        assert.ok(b.h1-b.h0<=POCKET_WALL_STEP+1e-9||Math.abs(pocketWallOffset(wall,d,(b.h0+b.h1)/2)-b.offset)<1e-9,'step height');
        assert.ok(pocketWallOffset(wall,d,b.h1)-b.offset<=POCKET_WALL_STEP+1e-9,'step width '+JSON.stringify(wall));
      }
    }
  }
  assert.equal(pocketWallBands(null,10).length,1);
  near(pocketWallBands({type:'chamfer',value:1},10)[0].h1,9.2,1e-9,'first chamfer band merges with the vertical part');
});

test('layout outline grows by the outset; floor outline shrinks by the round-bottom radius',()=>{
  const plain=box(pocketLayoutOutline(rectTool(),0));near(plain.w,40,1e-3);near(plain.h,20,1e-3);
  const drafted=box(pocketLayoutOutline(rectTool({pocketWall:{type:'chamfer',value:2}}),0));near(drafted.w,44,.02);near(drafted.h,24,.02);
  const floor=pocketFloorOutlines(rectTool({pocketWall:{type:'roundBottom',value:3}}),0);
  assert.equal(floor.length,1);const f=box(floor[0]);near(f.w,34,.02);near(f.h,14,.02);
  const top=box(pocketLayoutOutline(rectTool({pocketWall:{type:'roundBottom',value:3}}),0));near(top.w,40,1e-3);
  rejects(()=>pocketFloorOutlines(rectTool({depth:30,pocketWall:{type:'roundBottom',value:15}}),0),/Zaoblené dno/);
});
