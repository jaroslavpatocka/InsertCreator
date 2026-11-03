import test from 'node:test';
import assert from 'node:assert/strict';
import {bulkRotate,bulkSetRotation,bulkMove,bulkMoveTools,bulkAlignTools,bulkDistributeTools,bulkFingerGrips,bulkDelete,bulkSetDepth,bulkLock} from '../dist/bulk-edit.js';
import {blankProject,clone,validateProject} from '../dist/model.js';
import {bounds,validateLayout} from '../dist/geometry.js';
import {addToolGroup} from '../dist/set-module.js';
import {setCoherence} from '../dist/tool-sets.js';
import {automaticFingerGrips} from '../dist/finger-grip.js';
import {tIn} from '../dist/i18n.js';

const points=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const module=(id,x=0,y=0,extra={})=>({id,name:id,x,y,width:126,height:126,sizeMode:'manual',locked:false,...extra});
const tool=(id,moduleId,x=40,y=20,extra={})=>({id,name:id,moduleId,x,y,points:points(20,60),rotation:0,depth:8,locked:false,...extra});
const drawer=()=>validateProject({...blankProject(),width:588,height:420,limitToBed:false,modules:[module('a'),module('b',168)],tools:[tool('one','a'),tool('two','b',208)]});
const unchanged=(source,before)=>assert.deepEqual(source,before,'source was not mutated');
const assertValid=p=>assert.deepEqual(validateLayout(p),[]);

test('bulk rotate all and subset keeps manual dimensions, outline centres, depths and units',()=>{
  const p=drawer();p.unit='in';p.tools[0].unit='mm';p.modules[0].unit='in';const before=clone(p);
  const one=bulkRotate(p,['one']),all=bulkRotate(p,new Set(['one','two']));
  assert.equal(one.tools[0].rotation,90);assert.equal(one.tools[1].rotation,0);
  assert.deepEqual(one.modules,p.modules,'manual footprint preserved');
  for(const t of all.tools){const b=bounds(t),old=bounds(p.tools.find(x=>x.id===t.id));assert.ok(Math.abs(b.x+b.width/2-old.x-old.width/2)<1e-7);assert.ok(Math.abs(b.y+b.height/2-old.y-old.height/2)<1e-7);assert.equal(t.depth,8);assert.equal(t.rotation,90);}
  assert.equal(all.unit,'in');assert.equal(all.tools[0].unit,'mm');assert.deepEqual(all.tools[0].points,p.tools[0].points);assertValid(one);assertValid(all);unchanged(p,before);
});

test('automatic rotated modules resize safely and manual ones stay fixed',()=>{
  const p=drawer();p.modules[0].sizeMode='auto';const before=clone(p);
  const next=bulkRotate(p,['one']);assert.equal(next.modules[0].width,84);assert.equal(next.modules[0].height,42);assert.equal(next.modules[0].sizeMode,'auto');assertValid(next);unchanged(p,before);
});

test('selected members rotate inside a shared automatic module without shifting the container or siblings',()=>{
  const p=validateProject({...blankProject(),width:588,height:420,limitToBed:true,
    modules:[module('shared',0,0,{width:336,height:252,sizeMode:'auto',grouped:true})],
    tools:[tool('one','shared',60,70),tool('two','shared',180,70),tool('three','shared',270,70)]});
  const before=clone(p),one=bulkRotate(p,['one'],30),two=bulkSetRotation(p,['one','two'],45);
  assert.deepEqual(one.modules,p.modules);assert.deepEqual(one.tools.slice(1),p.tools.slice(1));
  assert.equal(one.tools[0].rotation,30);assert.deepEqual(two.tools.map(t=>t.rotation),[45,45,0]);
  assert.deepEqual(two.modules,p.modules);assert.deepEqual(two.tools[2],p.tools[2]);
  for(const t of two.tools){const old=bounds(p.tools.find(x=>x.id===t.id)),next=bounds(t);assert.ok(Math.abs(old.x+old.width/2-next.x-next.width/2)<1e-7);assert.ok(Math.abs(old.y+old.height/2-next.y-next.height/2)<1e-7);}
  const normalized=bulkSetRotation(two,['one','two'],0);assert.deepEqual(normalized.tools.map(t=>t.rotation),[0,0,0]);
  assertValid(one);assertValid(two);unchanged(p,before);
});

test('absolute headings, invalid shared rotations and no-op angles preserve atomic editing',()=>{
  const p=drawer(),before=clone(p);p.tools[0].rotation=90;p.tools[0].y=40;
  const next=bulkSetRotation(p,['one','two'],180);assert.deepEqual(next.tools.map(t=>t.rotation),[180,180]);assertValid(next);
  assert.deepEqual(bulkSetRotation(next,['one','two'],180),next);
  const crowded=validateProject({...blankProject(),width:336,height:252,
    modules:[module('shared',0,0,{width:126,height:126,sizeMode:'auto',grouped:true})],
    tools:[tool('one','shared',25,30),tool('two','shared',60,30)]}),snapshot=clone(crowded);
  assertValid(crowded);assert.throws(()=>bulkRotate(crowded,['one'],90),/překrývají|stěnu/);unchanged(crowded,snapshot);
  assert.deepEqual(p.modules,before.modules);assert.equal(p.tools[0].rotation,90,'source absolute heading is not mutated');
});

test('rotation fails atomically if a manual footprint cannot contain the result',()=>{
  const p=drawer();p.modules[0].width=42;p.tools[0].x=10;const before=clone(p);assertValid(p);
  assert.throws(()=>bulkRotate(p,['one','two']),error=>!!error.i18n);unchanged(p,before);
});

test('rotating a partial shared group rejects a pocket collision without rotating any other selected tool',()=>{
  const p=drawer();p.modules[0].grouped=true;p.tools.push(tool('sibling','a',70,20));const before=clone(p);assertValid(p);
  assert.throws(()=>bulkRotate(p,['one','two']),error=>!!error.i18n);unchanged(p,before);
});

test('shared module moves every sibling and preserves their relative geometry even for a partial selection',()=>{
  const p=drawer();p.modules[0].grouped=true;p.tools.push(tool('sibling','a',70,20));const before=clone(p);
  const next=bulkMove(p,['one'],{dx:0,dy:84});
  assert.equal(next.modules[0].y,84);assert.equal(next.tools.find(t=>t.id==='one').y,104);assert.equal(next.tools.find(t=>t.id==='sibling').y,104);
  assert.deepEqual(next.tools.find(t=>t.id==='two'),p.tools.find(t=>t.id==='two'));
  for(const t of next.tools.filter(t=>t.moduleId==='a')){const old=p.tools.find(x=>x.id===t.id);assert.deepEqual(t.points,old.points);assert.equal(t.x,old.x);assert.equal(t.rotation,old.rotation);}
  assertValid(next);unchanged(p,before);
});

test('moving all selected modules is checked in the final state; collisions and leaving the drawer roll back',()=>{
  const p=drawer(),before=clone(p);
  const next=bulkMove(p,['one','two'],{dx:168,dy:0});assertValid(next);assert.equal(next.modules[0].x,168);assert.equal(next.modules[1].x,336);
  for(const vector of [{dx:168,dy:0},{dx:-42,dy:0},{dx:0,dy:420}]){assert.throws(()=>bulkMove(p,['one'],vector),error=>!!error.i18n);unchanged(p,before);}
});

test('any locked touched module or selected tool prevents move and rotate for the whole selection',()=>{
  for(const lock of ['module','tool']){
    const p=drawer();if(lock==='module')p.modules[1].locked=true;else p.tools[1].locked=true;
    const before=clone(p);
    assert.throws(()=>bulkMove(p,['one','two'],{dx:0,dy:42}),/odemkněte/);assert.throws(()=>bulkRotate(p,['one','two']),/odemkněte/);unchanged(p,before);
  }
});

test('a fixed locked sibling permits selected pocket edits but still blocks moving its whole module',()=>{
  const p=drawer();Object.assign(p.modules[0],{grouped:true,sizeMode:'auto'});p.tools.push(tool('locked sibling','a',98,20,{locked:true}));const before=clone(p);
  for(const next of [bulkRotate(p,['one'],90),bulkSetRotation(p,['one'],30),bulkMoveTools(p,['one'],{dx:10,dy:0})]){
    assert.deepEqual(next.modules,p.modules);assert.deepEqual(next.tools.slice(1),p.tools.slice(1));assertValid(next);
  }
  assert.throws(()=>bulkMove(p,['one'],{dx:0,dy:42}),/odemkněte/);unchanged(p,before);
});

test('lock and unlock expand to every pocket in the touched module',()=>{
  const p=drawer();p.tools.push(tool('sibling','a',70,20));const before=clone(p);
  const locked=bulkLock(p,['one'],true);
  assert.equal(locked.modules[0].locked,true);assert.ok(locked.tools.filter(t=>t.moduleId==='a').every(t=>t.locked));assert.equal(locked.modules[1].locked,false);assert.equal(locked.tools[1].locked,false);
  const unlocked=bulkLock(locked,['sibling'],false);assert.deepEqual(unlocked,p);unchanged(p,before);
});

test('depth changes only selected tools, permits position locks and rejects every invalid depth atomically',()=>{
  const p=drawer();p.modules[0].locked=true;p.tools[0].locked=true;const before=clone(p);
  const next=bulkSetDepth(p,['one'],12.7);assert.equal(next.tools[0].depth,12.7);assert.equal(next.tools[1].depth,8);assert.deepEqual(next.modules,p.modules);assertValid(next);
  for(const depth of [0,.49,18,NaN,Infinity,null,true]){assert.throws(()=>bulkSetDepth(p,['one','two'],depth),error=>!!error.i18n);unchanged(p,before);}
  assert.equal(bulkSetDepth(p,['one'],p.insertHeight-p.base).tools[0].depth,p.insertHeight-p.base);
});

test('delete selected tools cleans set membership and metadata, removes only newly empty modules, preserves blanks',()=>{
  const p=drawer();p.modules.push(module('blank',336));p.modules[0].grouped=true;p.tools.push(tool('sibling','a',70,20));
  p.toolSets=[{id:'shared',name:'Shared',toolIds:['one','sibling'],layout:'shared'},{id:'single',name:'Single',toolIds:['two'],layout:'auto'}];
  Object.assign(p.modules[0],{setId:'shared',setLayout:'shared'});Object.assign(p.modules[1],{setId:'single',setLayout:'uniform',locked:true});p.tools[1].locked=true;const before=clone(p);
  const next=bulkDelete(p,['one','two']);assert.deepEqual(next.tools.map(t=>t.id),['sibling']);assert.deepEqual(next.modules.map(m=>m.id),['a','blank']);assert.deepEqual(next.toolSets,[{id:'shared',name:'Shared',toolIds:['sibling'],layout:'shared'}]);assert.equal(next.modules[0].setId,'shared');assertValid(next);unchanged(p,before);
  const empty=bulkDelete(next,['sibling']);assert.deepEqual(empty.modules.map(m=>m.id),['blank']);assert.deepEqual(empty.toolSets,[]);assertValid(empty);
});

test('delete does not discard an unrelated empty filler with set metadata from a legacy project',()=>{
  const p=drawer();p.modules.push(module('blank',336,0,{setId:'old',setLayout:'shared'}));p.toolSets=[{id:'old',name:'Old',toolIds:['one'],layout:'shared'}];
  const next=bulkDelete(p,['one']);const blank=next.modules.find(m=>m.id==='blank');assert.ok(blank);assert.equal(blank.setId,undefined);assert.equal(blank.setLayout,undefined);assert.deepEqual(next.toolSets,[]);
});

test('uniform sets remain uniform when all rotate together and release to auto after a partial rotation',()=>{
  const src={...blankProject(),width:588,height:420,limitToBed:false};
  const p=addToolGroup(src,[tool('one',null,0,0),tool('two',null,0,0)],{toolSet:{id:'uniform',name:'Set',layout:'uniform'}}).project;
  assertValid(p);assert.deepEqual(setCoherence(p,p.toolSets).satisfied,['uniform']);
  // Manual square footprints leave room for either heading without moving neighbours.
  p.modules.forEach((m,i)=>Object.assign(m,{x:i*168,y:0,width:126,height:126,sizeMode:'manual'}));p.tools.forEach((t,i)=>Object.assign(t,{x:i*168+40,y:20,rotation:0}));
  const all=bulkRotate(p,['one','two']);assert.equal(all.toolSets[0].layout,'uniform');assert.deepEqual(setCoherence(all,all.toolSets).satisfied,['uniform']);
  const part=bulkRotate(p,['one']);assert.equal(part.toolSets[0].layout,'auto');assert.equal(p.toolSets[0].layout,'uniform');assertValid(part);
});

test('unrelated existing geometry or depth errors do not prevent editing a valid selection',()=>{
  const p=drawer();p.modules.push(module('invalid',600));p.tools.push(tool('invalid tool','invalid',620,20,{depth:40}));const before=clone(p);
  const moved=bulkMove(p,['one'],{dx:0,dy:42});assert.equal(moved.modules[0].y,42);
  const depth=bulkSetDepth(p,['one'],10);assert.equal(depth.tools[0].depth,10);assert.equal(depth.tools.at(-1).depth,40);unchanged(p,before);
});

test('automatic rotation preserves an existing depth warning rather than changing or blocking it',()=>{
  const p=drawer();p.modules[0].sizeMode='auto';p.tools[0].depth=40;const before=clone(p);
  const next=bulkRotate(p,['one']);assert.equal(next.tools[0].rotation,90);assert.equal(next.tools[0].depth,40);
  assert.deepEqual(validateLayout(next).map(i=>i.type),['depth']);unchanged(p,before);
});

test('invalid selections and vectors fail without mutation; empty selection returns an independent copy',()=>{
  const p=drawer(),before=clone(p);
  for(const action of [()=>bulkMove(p,['missing'],{dx:0,dy:1}),()=>bulkMove(p,['one'],{dx:NaN,dy:0}),()=>bulkRotate(p,['one'],Infinity),()=>bulkLock(p,['one'],'yes'),()=>bulkDelete(p,null)])assert.throws(action,error=>!!error.i18n);
  const empty=bulkRotate(p,[]);assert.deepEqual(empty,p);assert.notEqual(empty,p);unchanged(p,before);
});

test('Gridfinity move keeps its metric 42 mm grid regardless of displayed inches',()=>{
  const p=drawer();p.unit='in';p.bottomMode='grid';const before=clone(p);
  assertValid(bulkMove(p,['one','two'],{dx:0,dy:42}));assert.throws(()=>bulkMove(p,['one'],{dx:0,dy:25.4}),/násobcích 42/);unchanged(p,before);
});

const pocketDrawer=()=>validateProject({...blankProject(),width:588,height:420,limitToBed:true,bedWidth:220,bedHeight:220,
  modules:[module('shared',0,0,{width:420,height:336,sizeMode:'auto',grouped:true,unit:'in'})],
  tools:[tool('one','shared',40,40),tool('two','shared',150,150),tool('three','shared',290,224),tool('fixed','shared',360,30,{locked:true})],
  toolSets:[{id:'shared-set',name:'Shared set',toolIds:['one','two','three','fixed'],layout:'shared',order:'asc',arrangement:'ordered'}]});

test('moving selected pockets leaves their module, siblings, outlines and set data unchanged',()=>{
  const p=pocketDrawer(),before=clone(p),next=bulkMoveTools(p,['one','two'],{dx:12.7,dy:8});
  for(const id of ['one','two']){const a=next.tools.find(t=>t.id===id),b=p.tools.find(t=>t.id===id);assert.equal(a.x,b.x+12.7);assert.equal(a.y,b.y+8);assert.deepEqual(a.points,b.points);assert.equal(a.rotation,b.rotation);}
  assert.deepEqual(next.modules,p.modules);assert.deepEqual(next.tools.slice(2),p.tools.slice(2));assert.deepEqual(next.toolSets,p.toolSets);assertValid(next);unchanged(p,before);
  for(const ids of [['fixed'],['one','fixed']])assert.throws(()=>bulkMoveTools(p,ids,{dx:1,dy:0}),/odemkněte/);
  for(const vector of [{dx:-100,dy:0},{dx:310,dy:0}])assert.throws(()=>bulkMoveTools(p,['one'],vector),error=>!!error.i18n);
  unchanged(p,before);
});

test('aligning selected raw bounds honours both axes and all edges inside a fixed module',()=>{
  const p=pocketDrawer(),before=clone(p),ids=['one','two','three'];
  for(const axis of ['x','y'])for(const edge of ['min','center','max']){
    const next=bulkAlignTools(p,ids,{axis,edge}),size=axis==='x'?'width':'height',ratio={min:0,center:.5,max:1}[edge];
    const targets=next.tools.filter(t=>ids.includes(t.id)).map(t=>{const b=bounds(t);return b[axis]+b[size]*ratio;});
    assert.ok(targets.every(v=>Math.abs(v-targets[0])<1e-7));assert.deepEqual(next.modules,p.modules);assert.deepEqual(next.tools.at(-1),p.tools.at(-1));assert.deepEqual(next.toolSets,p.toolSets);assertValid(next);
  }
  unchanged(p,before);
});

test('equal spacing keeps endpoints and unselected tools fixed, validates both axes and rejects unsafe gaps',()=>{
  const p=pocketDrawer(),before=clone(p),ids=['three','one','two'];
  for(const axis of ['x','y']){
    const next=bulkDistributeTools(p,ids,{axis}),size=axis==='x'?'width':'height',boxes=next.tools.slice(0,3).map(bounds).sort((a,b)=>a[axis]-b[axis]);
    assert.ok(Math.abs(boxes[1][axis]-boxes[0][axis]-boxes[0][size]-(boxes[2][axis]-boxes[1][axis]-boxes[1][size]))<1e-7);
    assert.deepEqual(next.tools[0],p.tools[0]);assert.deepEqual(next.tools[2],p.tools[2]);assert.deepEqual(next.tools[3],p.tools[3]);assert.deepEqual(next.modules,p.modules);assertValid(next);
  }
  const crowded=clone(p);crowded.tools[0].x=20;crowded.tools[1].x=25;crowded.tools[2].x=30;
  assert.throws(()=>bulkDistributeTools(crowded,ids,{axis:'x'}),/dost místa/);unchanged(p,before);
});

test('explicit bulk finger bays replace only selected pockets, preserve locked positions and clear without regeneration',()=>{
  const p=pocketDrawer();p.modules[0].locked=true;p.tools[0].locked=true;p.tools[2].fingerGrips=automaticFingerGrips(p.tools[2],{radius:5});const before=clone(p);
  const next=bulkFingerGrips(p,['one','two'],{mode:'auto',radius:7});
  assert.deepEqual(next.modules,p.modules);assert.deepEqual(next.tools.slice(2),p.tools.slice(2));assert.deepEqual(next.toolSets,p.toolSets);
  for(const t of next.tools.slice(0,2)){assert.equal(t.fingerGrips.length,2);assert.ok(t.fingerGrips.every(g=>g.radius===7&&Math.abs(g.y-30)<1e-7));}
  assertValid(next);const cleared=bulkFingerGrips(next,['one'],{mode:'clear'});assert.deepEqual(cleared.tools[0].fingerGrips,[]);assert.deepEqual(cleared.tools.slice(1),next.tools.slice(1));assertValid(cleared);
  const nearWall=clone(p);nearWall.tools[0].x=20;const snapshot=clone(nearWall);
  assert.throws(()=>bulkFingerGrips(nearWall,['one','two'],{mode:'auto',radius:40}),error=>!!error.i18n);unchanged(nearWall,snapshot);unchanged(p,before);
});

test('new pocket edit inputs and selection limits fail atomically with translated errors',()=>{
  const p=pocketDrawer(),before=clone(p);
  const actions=[()=>bulkMoveTools(p,['one'],{dx:'  ',dy:0}),()=>bulkSetRotation(p,['one'],[]),()=>bulkAlignTools(p,['one'],{axis:'x',edge:'min'}),()=>bulkAlignTools(drawer(),['one','two'],{axis:'x',edge:'min'}),()=>bulkAlignTools(p,['one','two'],{axis:'z',edge:'min'}),()=>bulkAlignTools(p,['one','two'],{axis:'x',edge:'invalid'}),()=>bulkDistributeTools(p,['one','two'],{axis:'x'}),()=>bulkFingerGrips(p,['one'],{mode:'invalid'})];
  for(const action of actions)assert.throws(action,error=>{assert.ok(error.i18n?.cs);assert.notEqual(tIn('en',error.i18n.cs,error.i18n.params),error.i18n.cs);return true;});
  unchanged(p,before);const empty=bulkMoveTools(p,[],{dx:1,dy:1});assert.deepEqual(empty,p);assert.notEqual(empty,p);
});
