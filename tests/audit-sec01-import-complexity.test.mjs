// SEC-01: a crafted project contour must not block the editor. Synthetic inputs only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateProject,blankProject,IMPORT_POINT_LIMIT} from '../dist/model.js';
import {validateLayout,transformedPoints} from '../dist/geometry.js';
import {contourTopology,contourProblem,pocketOutline} from '../dist/finger-grip.js';
import {catalogItems} from '../dist/catalog/index.js';

// The audit reproduction: one 6000-point star whose chords all cross near the centre.
const star=(n=6000)=>Array.from({length:n},(_,i)=>{const theta=2*Math.PI*((i*3001)%n)/n;return{x:80+80*Math.cos(theta),y:80+80*Math.sin(theta)};});
// A legitimate dense traced outline: 6000 points, wavy but simple.
const wavy=(n=6000)=>Array.from({length:n},(_,i)=>{const theta=2*Math.PI*i/n,r=70+6*Math.sin(theta*40)+2*Math.sin(theta*313);return{x:80+r*Math.cos(theta),y:80+r*Math.sin(theta)};});
// A realistic hair comb traced every ~0.3 mm: 30 teeth, 1 mm wide, 25 mm long.
function tracedComb(){
  const corners=[],pts=[];corners.push({x:0,y:30});for(let k=0;k<30;k++){const x=1+k*2;corners.push({x,y:30},{x,y:5},{x:x+1,y:5},{x:x+1,y:30});}
  corners.push({x:61,y:30},{x:61,y:0},{x:0,y:0});
  corners.forEach((a,i)=>{const b=corners[(i+1)%corners.length],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/.3));for(let s=0;s<steps;s++)pts.push({x:a.x+(b.x-a.x)*s/steps,y:a.y+(b.y-a.y)*s/steps});});
  return pts;
}
const project=(tools)=>({...blankProject(),modules:[{id:'m',name:'audit',x:0,y:0,width:210,height:210}],tools:tools.map((points,i)=>({id:'t'+i,name:'synthetic '+i,moduleId:'m',x:20,y:20,points}))});
const timed=fn=>{const start=performance.now(),value=fn();return{value,ms:performance.now()-start};};

// The former pairwise predicate, kept as the reference for the bucketed test.
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),EPS=1e-7;
function pairwise(p){
  const on=(a,b,c)=>Math.abs(cross(a,b,c))<EPS&&c.x>=Math.min(a.x,b.x)-EPS&&c.x<=Math.max(a.x,b.x)+EPS&&c.y>=Math.min(a.y,b.y)-EPS&&c.y<=Math.max(a.y,b.y)+EPS;
  for(let i=0;i<p.length;i++)for(let j=i+2;j<p.length;j++){
    if(i===0&&j===p.length-1)continue;
    const a=p[i],b=p[(i+1)%p.length],c=p[j],d=p[(j+1)%p.length];
    if((cross(a,b,c)*cross(a,b,d)<-EPS&&cross(c,d,a)*cross(c,d,b)<-EPS)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))return true;
  }
  return false;
}

test('bucketed topology matches the pairwise predicate, including touching and collinear vertices',()=>{
  let seed=7;const random=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
  let crossing=0;
  for(let round=0;round<600;round++){
    const n=4+Math.floor(random()*(round%5?40:160)),grid=round%2?6:1000,scale=round%3?1:.001;
    const points=Array.from({length:n},()=>({x:Math.floor(random()*grid)*scale,y:Math.floor(random()*grid)*scale}));
    const expected=pairwise(points);if(expected)crossing++;
    assert.equal(contourTopology(points)!=='simple',expected,JSON.stringify(points));
  }
  assert.ok(crossing>50&&crossing<600,'the sample must contain both simple and crossing contours');
  assert.equal(contourTopology(wavy()),'simple');assert.equal(contourTopology(tracedComb()),'simple');
});

test('the 6000-point crossing contour is rejected on import within a bounded time',()=>{
  const {value,ms}=timed(()=>{try{validateProject(project([star()]),{strict:true});return null;}catch(error){return error;}});
  assert.ok(value,'strict import must reject the crossing contour');
  assert.match(value.message,/synthetic 0/);assert.equal(value.i18n.cs,'Kontura nástroje „{name}“ se kříží sama se sebou.');
  assert.ok(ms<1500,`strict validation took ${ms} ms`);
  assert.equal(contourProblem([{x:0,y:0},{x:1,y:0},{x:2,y:0}]),'degenerate');
});

test('crafted simple-but-dense contours stop at the work budget instead of running unbounded',()=>{
  // 1497 hair-thin 150 mm teeth: simple, but every grid cell holds dozens of long edges.
  const teeth=1497,w=150/teeth,points=[];for(let k=0;k<teeth;k++){const x=k*w;points.push({x,y:160},{x:x+w*.25,y:160},{x:x+w*.25,y:10},{x:x+w*.75,y:10});}points.push({x:150,y:10},{x:150,y:170},{x:0,y:170});
  const {value,ms}=timed(()=>contourTopology(points));assert.equal(value,'too-complex');assert.ok(ms<1500,`topology took ${ms} ms`);
  assert.throws(()=>validateProject(project([points]),{strict:true}),error=>error.i18n?.cs==='Kontura nástroje „{name}“ je příliš složitá na bezpečné otevření.');
});

test('aggregate contour points are capped on import while saved projects stay loadable',()=>{
  const ring=n=>Array.from({length:n},(_,i)=>({x:10+5*Math.cos(2*Math.PI*i/n),y:10+5*Math.sin(2*Math.PI*i/n)}));
  const count=Math.ceil((IMPORT_POINT_LIMIT+1)/6000),many=project(Array.from({length:count},()=>ring(6000)));
  assert.throws(()=>validateProject(many,{strict:true}),error=>error.i18n?.cs==='Projekt má příliš mnoho bodů kontur. Limit je {max} bodů.');
  // Non-strict validation (stored projects, every edit) keeps its former contract.
  assert.equal(validateProject(project([star()])).tools[0].points.length,6000);
});

test('legitimate large traced contours and the whole catalog still import and lay out',()=>{
  const {value:imported,ms}=timed(()=>validateProject(project([wavy(),tracedComb()]),{strict:true}));
  assert.equal(imported.tools[0].points.length,6000);assert.ok(ms<1500,`strict validation took ${ms} ms`);
  imported.tools[1].x=10;imported.tools[1].y=150;imported.modules[0].height=210;
  const issues=validateLayout(imported);assert.ok(!issues.some(issue=>/kříží/.test(issue.i18n?.cs||'')),issues.map(issue=>issue.message).join('; '));
  const catalog=catalogItems().slice(0,247).map(item=>item.points);
  assert.equal(validateProject({...blankProject(),width:3000,height:3000,modules:[],tools:catalog.map((points,i)=>({id:'c'+i,name:'c'+i,points}))},{strict:true}).tools.length,catalog.length);
});

test('layout geometry checks topology before the Clipper offset',()=>{
  const p=validateProject(project([star()]));
  const {value:issues,ms}=timed(()=>validateLayout(p));
  assert.ok(ms<2000,`validateLayout took ${ms} ms`);
  assert.ok(issues.some(issue=>issue.i18n?.cs==='Kontura „{name}“ se kříží nebo není platná. Upravte konturu či zmenšete vůli.'));
  assert.throws(()=>pocketOutline(p.tools[0],p),error=>error.i18n?.cs==='Kontura se kříží sama se sebou nebo je příliš složitá. Upravte ji před výpočtem kapsy.');
  const {value:outline,ms:drawMs}=timed(()=>transformedPoints(p.tools[0],.8));
  assert.equal(outline.length,6000,'the drawing fallback keeps the raw outline without offsetting it');assert.ok(drawMs<2000);
});

test('pairwise pocket checks between large valid contours stay bounded and keep their verdicts',()=>{
  const ring=(r,n=6000)=>Array.from({length:n},(_,i)=>({x:r*Math.cos(2*Math.PI*i/n),y:r*Math.sin(2*Math.PI*i/n)}));
  const layout=tools=>validateLayout(validateProject({...blankProject(),modules:[{id:'m',name:'m',x:0,y:0,width:210,height:210}],tools:tools.map((tool,i)=>({id:'t'+i,name:'r'+i,moduleId:'m',...tool}))},{strict:true}));
  const pairs=issues=>issues.filter(issue=>issue.ids.length===2).map(issue=>issue.i18n.cs);
  // Six nested rings: every pair overlaps (one pocket inside another) without crossing edges.
  const {value:nested,ms}=timed(()=>layout(Array.from({length:6},(_,i)=>({x:100-(20+i*3),y:100-(20+i*3),points:ring(20+i*3)}))));
  assert.equal(pairs(nested).filter(cs=>cs==='Kapsy „{a}“ a „{b}“ se překrývají nebo dotýkají.').length,15);assert.ok(ms<4000,`nested layout took ${ms} ms`);
  // Side by side: 2 mm apart is closer than the 2.4 mm wall, 10 mm apart is fine.
  const near=layout([{x:10,y:60,points:ring(40)},{x:93.6,y:60,points:ring(40)}]),far=layout([{x:10,y:60,points:ring(40)},{x:101.6,y:60,points:ring(40)}]);
  assert.deepEqual(pairs(near),['Mezi kapsami „{a}“ a „{b}“ není dost místa na stěnu {wall}.']);assert.deepEqual(pairs(far),[]);
});
