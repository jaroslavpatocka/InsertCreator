import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeToolShape,findToolSets,setCoherence} from '../dist/tool-sets.js';
import {blankProject,validateProject} from '../dist/model.js';
import {createDemoProject} from '../dist/geometry.js';

const driver=[[-3,0],[3,0],[3,105],[15,110],[17,120],[17,165],[12,175],[-12,175],[-17,165],[-17,120],[-15,110],[-3,105]];
function specimen(id,{scale=1,angle=0,reverse=false,start=0,noise=0,coords=driver}={}){
  const radians=angle*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  const transform=([x,y])=>({x:(x*c-y*s)*scale+120,y:(x*s+y*c)*scale-80});
  let points=coords.map((p,i)=>{const q=transform(p);return{x:q.x+Math.sin(i*2.3)*noise,y:q.y+Math.cos(i*1.7)*noise};});
  points=[...points.slice(start),...points.slice(0,start)];if(reverse)points.reverse();
  return{tool:{id,name:'Stejný název nic nedokazuje',points,rotation:213,x:0,y:0,depth:12,moduleId:null},tip:transform([0,0]),handle:transform([0,160])};
}
const familyTools=()=>[specimen('a').tool,specimen('b',{angle:37,scale:.7,reverse:true,start:4}).tool,specimen('c',{angle:213,scale:1.45,start:8,noise:.12}).tool];
function uniformProject(){
  const tools=familyTools().map((tool,i)=>({...tool,rotation:analyzeToolShape(tool).rotation,moduleId:'m'+i,x:20+i*100,y:20}));
  return{...blankProject(),id:'uniform-fixture',width:630,height:420,tools,modules:tools.map((tool,i)=>({id:'m'+i,x:i*100,y:0,width:84,height:252})),toolSets:[{id:'family',name:'Moje sada',toolIds:tools.map(tool=>tool.id),layout:'uniform'}]};
}

test('shape analysis removes raw rotation, scale, contour direction and vertex-start differences',()=>{
  const variants=[{}, {angle:37,scale:.65,reverse:true,start:4},{angle:213,scale:1.5,start:7},{angle:-121,scale:.9,reverse:true,start:2,noise:.1}];
  for(const options of variants){
    const {tool,tip,handle}=specimen('same',options),snapshot=structuredClone(tool),analysis=analyzeToolShape(tool),r=analysis.rotation*Math.PI/180;
    const vertical=p=>p.x*Math.sin(r)+p.y*Math.cos(r);
    assert.ok(vertical(handle)>vertical(tip)+analysis.length*.7,'the physical handle must end up below the physical tip');
    assert.ok(Math.abs(analysis.length-175*(options.scale||1))<.5);
    assert.ok(Math.abs(analysis.width-34*(options.scale||1))<.5);
    assert.equal(analysis.profile.length,32);assert.ok(analysis.profile.every(Number.isFinite));assert.ok(analysis.eligible);
    assert.deepEqual(analyzeToolShape({...tool,rotation:17}),analysis,'analysis must be independent of the current layout rotation');assert.deepEqual(tool,snapshot);
    analysis.profile[0]=99;assert.notEqual(analyzeToolShape(tool).profile[0],99,'callers cannot corrupt the cached signature');
  }
});

test('similar sizes form one stable family without using names or mutating points',()=>{
  const tools=familyTools(),project={tools},snapshot=structuredClone(project),first=findToolSets(project);
  assert.equal(first.sets.length,1);assert.deepEqual(first.sets[0].toolIds,['a','b','c']);assert.equal(first.sets[0].source,'suggested');assert.equal(first.sets[0].layout,'auto');assert.deepEqual(first.unassigned,[]);
  assert.ok(first.sets[0].confidence>=.6&&first.sets[0].confidence<=1);
  assert.deepEqual(findToolSets({tools:[...tools].reverse().map(tool=>({...tool,name:'Kladivo — úmyslně zavádějící název'}))}),first);assert.deepEqual(project,snapshot);
  const reordered=tools.map(tool=>({...tool,points:[...tool.points.slice(3),...tool.points.slice(0,3)].reverse()}));
  assert.deepEqual(findToolSets({tools:reordered}).sets.map(set=>[set.id,set.toolIds]),first.sets.map(set=>[set.id,set.toolIds]));
});

test('screwdrivers, hammers, wrenches and tiny fragments do not form mixed families',()=>{
  const hammer=[[-4,0],[4,0],[4,150],[25,150],[25,175],[-25,175],[-25,150],[-4,150]],wrench=createDemoProject().tools.find(tool=>tool.id==='tool-wrench').points.map(p=>[p.x,p.y]);
  const tools=[specimen('driver-a').tool,specimen('driver-b',{angle:83,scale:.8}).tool,specimen('hammer-a',{coords:hammer}).tool,specimen('hammer-b',{coords:hammer,angle:173,scale:1.2}).tool,specimen('wrench-a',{coords:wrench}).tool,specimen('wrench-b',{coords:wrench,angle:48,scale:.75}).tool,specimen('tiny',{scale:.04}).tool];
  const result=findToolSets({tools});assert.deepEqual(result.sets.map(set=>set.toolIds),[['driver-a','driver-b'],['hammer-a','hammer-b'],['wrench-a','wrench-b']]);assert.deepEqual(result.unassigned,['tiny']);
});

test('complete-link clustering prevents a gradual shape bridge from merging incompatible ends',()=>{
  const shape=join=>[[-3,0],[3,0],[3,join],[14,join],[14,175],[-14,175],[-14,join],[-3,join]];
  const tools=[150,130,110].map((join,i)=>specimen('bridge'+i,{coords:shape(join)}).tool);
  assert.equal(findToolSets({tools:tools.slice(0,2)}).sets.length,1);assert.equal(findToolSets({tools:tools.slice(1)}).sets.length,1);assert.equal(findToolSets({tools:[tools[0],tools[2]]}).sets.length,0);
  const result=findToolSets({tools});assert.equal(result.sets.length,1);assert.equal(result.sets[0].toolIds.length,2);assert.equal(result.unassigned.length,1);
});

test('explicit membership has priority, singletons survive and malformed or deleted shapes remain safe',()=>{
  const tools=[...familyTools(),specimen('d',{angle:71}).tool,{id:'invalid',name:'Vadný',points:[{x:NaN,y:0}]}],project={tools,toolSets:[{id:'manual',name:'Moje volba',toolIds:['b','deleted'],layout:'shared'}]},snapshot=structuredClone(project);
  const result=findToolSets(project);assert.deepEqual(result.sets[0],{id:'manual',name:'Moje volba',toolIds:['b'],layout:'shared',source:'manual',confidence:1});
  assert.ok(result.sets.slice(1).every(set=>!set.toolIds.includes('b')));assert.ok(result.unassigned.includes('invalid'));assert.deepEqual(project,snapshot);
  assert.doesNotThrow(()=>findToolSets({tools,toolSets:[null,{toolIds:['a'],layout:'future'}]}));
});

test('coherence rewards whole sets only, requires aligned headings and exact separate uniform footprints',()=>{
  const project=uniformProject(),sets=findToolSets(project).sets,snapshot=structuredClone(project);
  let result=setCoherence(project,sets);assert.equal(result.score,3);assert.deepEqual(result.satisfied,['family']);assert.ok(result.details[0].uniform);
  project.tools[1].rotation+=180;result=setCoherence(project,sets);assert.equal(result.score,0);assert.equal(result.details[0].headingAligned,false);project.tools[1].rotation-=180;
  project.modules[1].width=252;project.modules[1].height=84;assert.equal(setCoherence(project,sets).score,0,'rotated module dimensions must not masquerade as a visually uniform footprint');
  assert.deepEqual(snapshot,uniformProject());
  const absent=uniformProject();absent.modules[2].x=672;assert.equal(setCoherence(absent,sets).score,0,'off-drawer modules are not placed members');
  const invalid=uniformProject();invalid.tools[0].rotation=Infinity;assert.equal(setCoherence(invalid,sets).score,0,'invalid headings cannot receive coherence credit');
});

test('shared and uniform coherence respect exact membership and the explicit layout choice',()=>{
  const project=uniformProject(),ids=project.tools.map(tool=>tool.id),set={id:'family',toolIds:ids,layout:'shared'};
  project.modules=[{id:'shared',x:0,y:0,width:252,height:252}];project.tools.forEach(tool=>tool.moduleId='shared');
  assert.equal(setCoherence(project,[set]).score,3);assert.equal(setCoherence(project,[{...set,layout:'uniform'}]).score,0);assert.equal(setCoherence(project,[{...set,layout:'auto'}]).score,3);
  project.tools.push({...specimen('extra').tool,moduleId:'shared'});assert.equal(setCoherence(project,[set]).score,0,'a different family cannot be hidden inside the shared module');
  const uniform=uniformProject();uniform.tools.push({...specimen('extra').tool,moduleId:'m0'});assert.equal(setCoherence(uniform,uniform.toolSets).score,0,'a uniform module must be dedicated to one tool');
});

test('optional set schema, module tags, singleton cleanup and JSON preserve legacy absence and explicit empty arrays',()=>{
  const source={...blankProject(),tools:familyTools(),modules:[{id:'m',name:'Navržený modul',x:0,y:0,width:84,height:252,setId:'suggested-not-stored',setLayout:'uniform'}],toolSets:[{id:'kept',name:'Samostatný člen',toolIds:['a','deleted'],layout:'uniform'},{id:'gone',name:'Smazané',toolIds:['deleted'],layout:'auto'}]};
  const normalized=validateProject(source);assert.deepEqual(normalized.toolSets,[{id:'kept',name:'Samostatný člen',toolIds:['a'],layout:'uniform'}]);assert.equal(normalized.modules[0].setId,'suggested-not-stored');assert.equal(normalized.modules[0].setLayout,'uniform');
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(normalized))),normalized);
  const legacy=validateProject(blankProject());assert.equal(Object.hasOwn(legacy,'toolSets'),false);
  assert.deepEqual(validateProject({...blankProject(),toolSets:[]}).toolSets,[]);
  assert.equal(Object.hasOwn(validateProject({...blankProject(),modules:[{id:'plain',x:0,y:0,width:42,height:42}]}).modules[0],'setId'),false);
});

test('invalid duplicate memberships, set IDs, layouts and incomplete module tags reject clearly',()=>{
  const project={...blankProject(),tools:familyTools()},row={id:'set',name:'Sada',toolIds:['a'],layout:'auto'};
  for(const toolSets of [null,{},[{...row,id:''}],[row,row],[row,{...row,id:'other'}],[{...row,layout:'bad'}],[{...row,toolIds:[17]}]])assert.throws(()=>validateProject({...project,toolSets}));
  for(const fields of [{setId:'x'},{setLayout:'uniform'},{setId:'x',setLayout:'auto'},{setId:'',setLayout:'shared'}])assert.throws(()=>validateProject({...project,modules:[{id:'m',x:0,y:0,width:42,height:42,...fields}]}),/sady/);
});
