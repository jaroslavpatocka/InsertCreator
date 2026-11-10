import test from 'node:test';
import assert from 'node:assert/strict';
import {autoArrange,validateLayout} from '../dist/geometry.js';
import {smartArrange} from '../dist/smart-layout.js';
import {blankProject} from '../dist/model.js';
import {pocketLayoutOutline} from '../dist/pocket-wall.js';
import {automaticPocketMagnets} from '../dist/tool-magnet.js';

// Rectangle tools: the vertical pocket is the tool rectangle grown by the clearance (0.8 mm),
// so every expected gap below follows from plain arithmetic, not from the code under test.
const rectangle=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const tool=(id,x,y,extra={})=>({id,name:id,moduleId:'m',points:rectangle(40,20),x,y,rotation:0,depth:10,...extra});
const project=(tools,module={id:'m',name:'M',x:0,y:0,width:168,height:84})=>({...blankProject(),printMode:'solid',width:504,height:378,modules:[module],tools});
const kinds=issues=>issues.map(issue=>issue.i18n?.cs||issue.message);
const has=(issues,re)=>issues.some(issue=>re.test(issue.i18n?.cs||issue.message));
const CLEARANCE=.8,WALL=2.4,EDGE=.25;

function segmentDistance(p,a,b){const x=b.x-a.x,y=b.y-a.y,l=x*x+y*y,t=l?Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/l)):0;return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y);}
function contourDistance(a,b){let d=Infinity;for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++)d=Math.min(d,segmentDistance(a[i],b[j],b[(j+1)%b.length]),segmentDistance(b[j],a[i],a[(i+1)%a.length]));return d;}

// Pocket A spans x 19.2..60.8; pocket B starts exactly one wall later at 63.2, i.e. tool B at x=64.
const pair=(wallB)=>project([tool('a',20,30),tool('b',20+40+2*CLEARANCE+WALL,30,wallB?{pocketWall:wallB}:{})]);

test('pockets exactly one wall apart are valid vertical, a widened top on one of them is flagged',()=>{
  assert.deepEqual(kinds(validateLayout(pair(null))),[]);
  assert.deepEqual(kinds(validateLayout(pair({type:'vertical'}))),[]);
  for(const wall of [{type:'chamfer',value:1},{type:'draft',value:10},{type:'roundTop',value:1}]){
    const issues=validateLayout(pair(wall));
    assert.ok(has(issues,/není dost místa na stěnu/),`${wall.type}: ${kinds(issues)}`);
    const spacing=issues.find(issue=>/není dost místa na stěnu/.test(issue.i18n.cs));
    assert.deepEqual([...spacing.ids].sort(),['a','b']);
  }
  // Chamfer wider than the free wall makes the top edges overlap outright.
  assert.ok(has(validateLayout(pair({type:'chamfer',value:2})),/překrývají|není dost místa/));
});

test('a pocket at the module edge is flagged only when its top edge grows',()=>{
  // Left pocket edge exactly wall + 0.25 mm from the module edge.
  const edge=wall=>project([tool('a',WALL+EDGE+CLEARANCE,30,wall?{pocketWall:wall}:{})],{id:'m',name:'M',x:0,y:0,width:84,height:84});
  assert.deepEqual(kinds(validateLayout(edge(null))),[]);
  assert.deepEqual(kinds(validateLayout(edge({type:'roundBottom',value:2}))),[]);
  for(const wall of [{type:'chamfer',value:.5},{type:'draft',value:5},{type:'roundTop',value:.5}]){
    const issues=validateLayout(edge(wall));
    assert.ok(issues.some(issue=>issue.type==='outside'&&/Kolem/.test(issue.i18n.cs)&&issue.ids.includes('a')),`${wall.type}: ${kinds(issues)}`);
  }
});

test('a rounded floor keeps the spacing but rejects a magnet too close to the wall',()=>{
  assert.deepEqual(kinds(validateLayout(pair({type:'roundBottom',value:3}))),[]);
  // Hole radius 3.1 + rim 0.8 = 3.9 mm needed; magnet 3.2 mm above the tool edge = 4.0 mm from the floor edge.
  const magnet={id:'mg',x:20,y:3.2,diameter:6,height:2};
  const holder=wall=>project([tool('a',20,30,{pocketMagnets:[magnet],...(wall?{pocketWall:wall}:{})})]);
  assert.deepEqual(kinds(validateLayout(holder(null))),[]);
  assert.deepEqual(kinds(validateLayout(holder({type:'chamfer',value:2}))),[]);
  const issues=validateLayout(holder({type:'roundBottom',value:1}));
  assert.ok(issues.some(issue=>/Magnet v kapse/.test(issue.i18n.cs)&&issue.ids[0]==='a'),kinds(issues).join(' | '));
  // A centred magnet still fits the shrunken floor (10.8 mm from the edge > 3.9 + 1).
  assert.deepEqual(kinds(validateLayout(project([tool('a',20,30,{pocketMagnets:[{...magnet,y:10}],pocketWall:{type:'roundBottom',value:1}})]))),[]);
});

test('automatic magnets land on the rounded floor and validate',()=>{
  const base=tool('a',20,30,{points:rectangle(40,12),pocketWall:{type:'roundBottom',value:2}});
  const magnets=automaticPocketMagnets(base,{diameter:6,clearance:CLEARANCE});
  assert.equal(magnets.length,1);
  assert.deepEqual(kinds(validateLayout(project([{...base,pocketMagnets:magnets}]))),[]);
  // Pocket 10.1 mm wide: a 3.9 mm reach fits the flat floor, but not one narrowed by 2 mm per side.
  const thin={...base,points:rectangle(40,8.5)};
  assert.equal(automaticPocketMagnets({...thin,pocketWall:null},{diameter:6,clearance:CLEARANCE}).length,1);
  assert.throws(()=>automaticPocketMagnets(thin,{diameter:6,clearance:CLEARANCE}),error=>/nevejdou/.test(error.i18n?.cs));
});

test('an invalid profile or floor is reported for its tool',()=>{
  const deep=validateLayout(project([tool('a',20,30,{depth:5,pocketWall:{type:'chamfer',value:8}})]));
  assert.ok(deep.some(issue=>issue.type==='depth'&&issue.ids[0]==='a'&&/hloubka kapsy/.test(issue.i18n.cs)),kinds(deep).join(' | '));
  const range=validateLayout(project([tool('a',20,30,{pocketWall:{type:'draft',value:80}})]));
  assert.ok(range.some(issue=>issue.type==='depth'&&/Úhel stěny/.test(issue.i18n.cs)),kinds(range).join(' | '));
  // Pocket 5.6 mm wide, floor rounded by 4 mm on each side: nothing remains.
  const thin=validateLayout(project([tool('a',20,30,{points:rectangle(40,4),pocketWall:{type:'roundBottom',value:4}})]));
  assert.ok(thin.some(issue=>issue.ids[0]==='a'&&/Zaoblené dno/.test(issue.i18n.cs)),kinds(thin).join(' | '));
});

const profiled=()=>project([
  tool('a',0,0,{pocketWall:{type:'chamfer',value:3},moduleId:null}),
  tool('b',0,0,{pocketWall:{type:'draft',value:20},points:rectangle(60,15),moduleId:null}),
  tool('c',0,0,{pocketWall:{type:'roundTop',value:2},points:rectangle(36,36),moduleId:null}),
  tool('d',0,0,{pocketWall:{type:'roundBottom',value:2},moduleId:null}),
  // 35 mm pocket + 2×(wall+0.25) is just under one 42 mm cell when vertical; the chamfer needs a second cell.
  tool('e',0,0,{pocketWall:{type:'chamfer',value:3},points:rectangle(35,35),moduleId:null}),
],{id:'unused',name:'Empty',x:420,y:294,width:84,height:84});

function assertTopWalls(source,result){
  const combined={...source,...result};
  assert.deepEqual(kinds(validateLayout(combined)),[]);
  for(const t of result.tools){
    const m=result.modules.find(module=>module.id===t.moduleId);assert.ok(m,`${t.id} placed`);
    const top=pocketLayoutOutline(t,combined);
    if(!m.cells)for(const p of top)assert.ok(p.x>=m.x+WALL+EDGE-.002&&p.y>=m.y+WALL+EDGE-.002&&p.x<=m.x+m.width-WALL-EDGE+.002&&p.y<=m.y+m.height-WALL-EDGE+.002,`${t.id} top edge leaves the wall`);
    for(const o of result.tools)if(o.id<t.id&&o.moduleId===t.moduleId)assert.ok(contourDistance(top,pocketLayoutOutline(o,combined))>=WALL-.002);
  }
}

test('auto arrange sizes and places modules around the widened top edges',()=>{
  const source=profiled();
  for(const moduleShape of ['rectangular','stepped'])assertTopWalls(source,autoArrange(source,{moduleShape}));
});

test('smart arrange keeps profiled tools valid',async()=>{
  const source=profiled();source.modules=[];
  const result=await smartArrange(source);
  assert.deepEqual(result.unplaced||[],[]);
  assertTopWalls(source,result);
});
