import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {blankProject,validateProject} from '../dist/model.js';
import {validateLayout,exportSVG,LAYOUT_ISSUE_LIMIT} from '../dist/geometry.js';
import {catalogSets} from '../dist/catalog/index.js';
import {automaticFingerGrips} from '../dist/finger-grip.js';
import {addToolGroup} from '../dist/set-module.js';
import {addPhotoModule} from '../dist/photo-module.js';
import {spacePocketCenters} from '../dist/pocket-growth.js';

const square=[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}];
const tool=i=>({id:'t'+i,name:'audit'+i,moduleId:'m',x:20,y:20,points:square,fingerGrips:[]});
const dense=()=>({...blankProject(),modules:[{id:'m',x:0,y:0,width:210,height:210}],tools:Array.from({length:1000},(_,i)=>tool(i))});
const incomplete=issues=>{assert.equal(issues.length,1);assert.equal(issues[0].code,'layout-complexity');assert.equal(issues[0].incomplete,true);assert.equal(issues[0].type,'complexity');assert.ok(issues[0].i18n.cs.includes('Rozdělte projekt'));return issues[0];};

test('exact 149183-byte overlap fixture completes fail-closed in a 128MiB child',t=>{
  const moduleUrl=new URL('../dist/model.js',import.meta.url).href,geometryUrl=new URL('../dist/geometry.js',import.meta.url).href;
  const script=`import{blankProject,validateProject}from${JSON.stringify(moduleUrl)};import{validateLayout}from${JSON.stringify(geometryUrl)};
  const points=${JSON.stringify(square)};const input={...blankProject(),modules:[{id:'m',x:0,y:0,width:210,height:210}],tools:Array.from({length:1000},(_,i)=>({id:'t'+i,name:'audit'+i,moduleId:'m',x:20,y:20,points,fingerGrips:[]}))};
  const bytes=Buffer.byteLength(JSON.stringify(input)),p=validateProject(input,{strict:true}),start=performance.now(),issues=validateLayout(p);
  console.log(JSON.stringify({bytes,tools:p.tools.length,ms:performance.now()-start,heapUsed:process.memoryUsage().heapUsed,issues}));`;
  const child=spawnSync(process.execPath,['--max-old-space-size=128','--input-type=module','-e',script],{encoding:'utf8',timeout:15000,maxBuffer:10000,windowsHide:true});
  assert.equal(child.error,undefined,child.error?.message);assert.equal(child.status,0,child.stderr);
  const result=JSON.parse(child.stdout);assert.equal(result.bytes,149183);assert.equal(result.tools,1000);
  assert.equal(incomplete(result.issues).limitKind,'pairs');
  t.diagnostic(JSON.stringify({fixtureBytes:result.bytes,tools:result.tools,layoutMs:result.ms,heapUsedBytes:result.heapUsed,limit:result.issues[0].limitKind,childHeapMiB:128,childDeadlineMs:15000}));
});

test('all manufacturing checks retain a blocking error for incomplete validation',()=>{
  const p=validateProject(dense(),{strict:true});incomplete(validateLayout(p));
  assert.throws(()=>exportSVG(p),error=>error.i18n?.cs.includes('bezpečný limit'));
});

test('3000 valid tools in 3000 ordinary modules still validate without lowering capacity',t=>{
  const modules=[],tools=[];for(let i=0;i<3000;i++){const x=(i%60)*42,y=Math.floor(i/60)*42,id='m'+i;modules.push({id,name:id,x,y,width:42,height:42});tools.push({...tool(i),moduleId:id,x:x+10,y:y+10,points:[{x:0,y:0},{x:5,y:0},{x:5,y:5},{x:0,y:5}]});}
  const p=validateProject({...blankProject(),width:3000,height:3000,modules,tools},{strict:true}),start=performance.now();
  assert.deepEqual(validateLayout(p),[]);const ms=performance.now()-start;assert.ok(ms<4000);t.diagnostic(JSON.stringify({tools:tools.length,modules:modules.length,layoutMs:ms,issues:0}));
});

test('dense module pairs and excessive individual issues are bounded as well as pocket pairs',()=>{
  const modules=Array.from({length:1000},(_,i)=>({id:'m'+i,x:0,y:0,width:42,height:42}));
  assert.equal(incomplete(validateLayout({...blankProject(),modules,tools:[]})).limitKind,'pairs');
  const tools=Array.from({length:LAYOUT_ISSUE_LIMIT+1},(_,i)=>({...tool(i),moduleId:null,x:i*40,y:0}));
  assert.equal(incomplete(validateLayout({...blankProject(),width:3000,height:3000,modules:[],tools})).limitKind,'issues');
});

test('high-point valid contours keep exact overlap verdicts and share one work budget',{timeout:20000},t=>{
  const ring=(r,n=6000)=>Array.from({length:n},(_,i)=>({x:r+r*Math.cos(2*Math.PI*i/n),y:r+r*Math.sin(2*Math.PI*i/n)}));
  const project=count=>validateProject({...blankProject(),modules:[{id:'m',x:0,y:0,width:210,height:210}],tools:Array.from({length:count},(_,i)=>({...tool(i),x:100-(20+i*.9),y:100-(20+i*.9),points:ring(20+i*.9)}))},{strict:true});
  const small=project(6);for(let run=0;run<3;run++){const issues=validateLayout(small);assert.equal(issues.filter(x=>x.ids.length===2).length,15);assert.ok(!issues.some(x=>x.code==='layout-complexity'));}
  // The work verdict is deterministic. Keep the actual time in diagnostics;
  // a short speed assertion is unreliable while other test files use the CPU.
  const large=project(35),start=performance.now(),result=validateLayout(large),ms=performance.now()-start;
  assert.equal(incomplete(result).limitKind,'work');
  t.diagnostic(JSON.stringify({tools:35,points:210000,layoutMs:ms,limit:result[0].limitKind,testDeadlineMs:20000,normalTools:6,normalPoints:36000,normalPairIssues:15,repeatedNormalRuns:3}));
});

test('scoped validation keeps unaffected collision partners and original pair order',()=>{
  const p=validateProject({...blankProject(),modules:[{id:'m',x:0,y:0,width:210,height:210}],tools:[tool(0),tool(1),{...tool(2),x:100,y:100}]});
  const issues=validateLayout(p,{affectedIds:['t1']});assert.deepEqual(issues.filter(x=>x.ids.length===2).map(x=>x.ids),[['t0','t1']]);
});

test('real wrench and hex-key catalogue sets with finger bays retain fully checked layouts',()=>{
  for(const id of ['combination-wrench-set-8-19mm','combination-wrench-set-6-32mm','hex-key-set-1-5-10mm']){
    const tools=catalogSets().find(set=>set.id===id).tools.map((item,i)=>{
      const tool={id:id+'-'+i,name:item.name.cs,points:item.points,depth:Math.min(item.depth,17.6),unit:item.unit,x:0,y:0,rotation:0,locked:false,moduleId:null};
      return{...tool,fingerGrips:automaticFingerGrips(tool,{radius:9})};
    });
    const result=addToolGroup({...blankProject(),width:1000,height:800,limitToBed:false},tools);
    assert.equal(result.placed,true,id);assert.equal(result.project.tools.length,tools.length,id);
    assert.deepEqual(validateLayout(result.project),[],id);
  }
});

test('80-tool photo can repair truncated overlap diagnostics and still fully validate',()=>{
  const project={...blankProject(),width:1000,height:800,grid:42,limitToBed:false,modules:[],tools:[]};
  const tools=Array.from({length:80},(_,i)=>({...tool(i),moduleId:'m',x:500+(i%10)*20,y:200+Math.floor(i/10)*26,rotation:i%2?180:0,pocketMargin:8,points:[{x:0,y:0},{x:12,y:0},{x:12,y:18},{x:0,y:18}]})),before=JSON.stringify({project,tools});
  assert.equal(incomplete(validateLayout({...project,tools})).limitKind,'issues');
  const result=addPhotoModule(project,tools,{moduleId:'photo-80',growMargins:true});
  assert.equal(result.placed,true);assert.equal(result.project.tools.length,80);assert.equal(result.project.modules.length,1);assert.deepEqual(validateLayout(result.project),[]);
  assert.equal(JSON.stringify({project,tools}),before);
});

test('photo spacing does not launch repair after a pair or aggregate-point budget failure',()=>{
  const p=validateProject(dense(),{strict:true}),before=JSON.stringify(p);
  assert.throws(()=>spacePocketCenters(p,p.tools),error=>error.i18n?.cs.startsWith('Kontrola sestavy překročila bezpečný limit.'));
  assert.equal(JSON.stringify(p),before);
  const many=Array.from({length:51},(_,i)=>({...tool(i),points:Array.from({length:6000},(_,j)=>({x:j,y:0}))}));
  assert.throws(()=>spacePocketCenters({...blankProject(),modules:[]},many),error=>error.i18n?.cs.startsWith('Kontrola sestavy překročila bezpečný limit.'));
});
