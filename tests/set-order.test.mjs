import test from 'node:test';
import assert from 'node:assert/strict';
import {getToolSize,sizeText,compareToolSize,orderTools} from '../dist/tool-size.js';
import {addToolGroup,splitForBed,scaleTool} from '../dist/set-module.js';
import {catalogSets} from '../dist/catalog/index.js';
import {automaticFingerGrips,pocketOutline} from '../dist/finger-grip.js';
import {blankProject,validateProject} from '../dist/model.js';
import {validateLayout,exportSTL} from '../dist/geometry.js';
import {analyzeToolShape,setCoherence,findToolSets} from '../dist/tool-sets.js';

const rect=(id,width=100,height=10,nominalSize)=>({id,name:id,points:[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}],depth:8,x:0,y:0,rotation:0,fingerGrips:[],...(nominalSize?{nominalSize}:{})});
const big=()=>({...blankProject(),width:1008,height:840,limitToBed:false});
const wrap=value=>((value%360)+360)%360;
const heading=tool=>Math.round(wrap(tool.rotation-analyzeToolShape(tool).rotation))%360;
const area=result=>result.project.modules.filter(module=>result.moduleIds?.includes(module.id)||module.id===result.moduleId).reduce((sum,module)=>sum+module.width*module.height,0);
const values=tools=>tools.map(tool=>getToolSize(tool)?.mm);
const sorted=(list,order)=>[...list].sort((a,b)=>order==='desc'?b-a:a-b);
function toolsOf(id){
  const set=catalogSets().find(set=>set.id===id);assert.ok(set,id);
  return set.tools.map((item,index)=>{
    const tool={id:`${id}-${index}`,name:item.name.cs,points:structuredClone(item.points),depth:Math.min(item.depth,17.6),unit:item.unit,x:0,y:0,rotation:0,nominalSize:{value:item.size,unit:item.unit}};
    tool.fingerGrips=automaticFingerGrips(tool,{radius:9});return tool;
  });
}
function pocketBox(tool,clearance){const points=pocketOutline(tool,clearance);return{left:Math.min(...points.map(point=>point.x)),right:Math.max(...points.map(point=>point.x)),bottom:Math.max(...points.map(point=>point.y))};}
function assertRegularRows(project,order){
  const rows=new Map();
  for(const tool of project.tools){const b=pocketBox(tool,project.clearance),key=Math.round(b.bottom*1000);if(!rows.has(key))rows.set(key,[]);rows.get(key).push({tool,b});}
  const read=[...rows].sort(([a],[b])=>a-b).flatMap(([,row])=>row.sort((a,b)=>a.b.left-b.b.left).map(item=>item.tool));
  assert.deepEqual(values(read),sorted(values(project.tools),order),'Reading complete rows left to right follows nominal sizes');
  for(const row of rows.values())for(let i=1;i<row.length;i++)assert.ok(row[i-1].b.right<=row[i].b.left,'Distinct columns remain separated');
}

test('nominal size, manual labels and explicit mm/in names are distinct from physical outline dimensions',()=>{
  const tool={...rect('large-outline',280,60),name:'Klíč 13 mm',nominalSize:{value:13,unit:'mm'}};
  assert.deepEqual(getToolSize(tool),{value:13,unit:'mm',mm:13,text:'13 mm'});
  assert.equal(sizeText({...tool,sizeLabel:'Klíč pro servis'}),'Klíč pro servis');
  assert.equal(getToolSize({...tool,sizeLabel:'1/4 in'}).mm,13,'A manual display label never overrides declared numeric size');
  assert.equal(sizeText(scaleTool(tool,1.5)),'13 mm','Scaling an outline does not change its nominal wrench size');
  assert.equal(getToolSize(rect('bez údaje',280,60)),null);
  assert.equal(sizeText(rect('bez údaje',280,60)),'','No nominal size is invented from the contour');
  assert.equal(sizeText({...rect('custom'),sizeLabel:'T25'}),'T25');
  assert.deepEqual(getToolSize({name:'Nástrčná hlavice 13 mm (3/8")'}),{value:13,unit:'mm',mm:13,text:'13 mm'});
  for(const [name,value] of [['Klíč 3/8 in',.375],['Wrench 1 1/2"',1.5],['Wrench 1-1/4 inches',1.25],['Klíč 1/4″',.25]]){
    const size=getToolSize({name});assert.equal(size.value,value,name);assert.equal(size.unit,'in');assert.ok(Math.abs(size.mm-value*25.4)<1e-9);
  }
  assert.equal(sizeText({nominalSize:{value:.8125,unit:'in'}}),'13/16 in');
  assert.equal(sizeText({nominalSize:{value:1.5,unit:'in'}}),'1 1/2 in');
  assert.equal(getToolSize({name:'PH2 × 100',unit:'mm'}),null,'An unqualified number is not nominal metadata');
  assert.equal(getToolSize({nominalSize:{value:Infinity,unit:'mm'}}),null);
  assert.equal(getToolSize({nominalSize:{value:13,unit:'cm'}}),null);
});

test('size comparison converts nominal inch values to mm and uses physical length only as an ordering fallback',()=>{
  const tools=[rect('13mm',40,10,{value:13,unit:'mm'}),rect('half-inch',220,10,{value:.5,unit:'in'}),rect('8mm',300,10,{value:8,unit:'mm'})];
  assert.deepEqual(orderTools(tools).map(tool=>tool.id),['8mm','half-inch','13mm']);
  assert.deepEqual(orderTools(tools,'desc').map(tool=>tool.id),['13mm','half-inch','8mm']);
  assert.deepEqual(tools.map(tool=>tool.id),['13mm','half-inch','8mm'],'Ordering does not mutate inputs');
  assert.ok(compareToolSize(rect('short',50),rect('long',100))<0);
  assert.equal(sizeText(rect('short',50)),'');
});

test('real 8–19 mm wrench sets use monotonic, common-heading ordered rows in both directions',()=>{
  for(const order of ['asc','desc']){
    const project={...blankProject(),limitToBed:false},tools=toolsOf('combination-wrench-set-8-19mm').reverse(),snapshot=structuredClone(tools);
    const result=addToolGroup(project,tools,{arrangement:'ordered',order,toolSet:{layout:'shared',name:'Klíče'}});
    assert.equal(result.placed,true);
    assert.deepEqual(validateLayout(result.project),[]);
    assertRegularRows(result.project,order);
    assert.equal(new Set(result.project.tools.map(heading)).size,1,'Every wrench points in the same common direction');
    assert.equal(result.project.toolSets[0].arrangement,'ordered');assert.equal(result.project.toolSets[0].order,order);
    assert.deepEqual(setCoherence(result.project,findToolSets(result.project).sets).unsatisfied,[]);
    assert.deepEqual(tools,snapshot,'Nominal sizes, contours and finger grips remain unchanged');
  }
});

test('compact real hex keys use opposite headings only with an actual smaller footprint, preserving size order and grips',()=>{
  for(const order of ['asc','desc']){
    const tools=toolsOf('hex-key-set-1-5-10mm'),project=big(),opts={order,toolSet:{layout:'shared'}};
    const ordered=addToolGroup(project,tools,{...opts,arrangement:'ordered'}),compact=addToolGroup(project,[...tools].reverse(),{...opts,arrangement:'compact'});
    assert.ok(area(compact)<=area(ordered),`${area(compact)} <= ${area(ordered)}`);
    const headings=[...new Set(compact.project.tools.map(heading))];
    if(headings.length>1){assert.equal(headings.length,2);assert.equal(wrap(headings[0]-headings[1]),180);assert.ok(area(compact)<area(ordered),'Opposing headings require an actual saving over the safe ordered variant');}
    else assert.equal(headings.length,1,'A common heading remains available when opposing tools cannot safely save area');
    assert.deepEqual(values(compact.project.tools),sorted(values(tools),order),'Nominal sequence stays monotonic across row breaks');
    assert.deepEqual(validateLayout(compact.project),[]);
    for(const tool of compact.project.tools){const original=tools.find(item=>item.id===tool.id);assert.deepEqual(tool.points,original.points);assert.deepEqual(tool.fingerGrips,original.fingerGrips);}
    for(const result of [ordered,compact])for(const printMode of ['solid','light'])assert.ok(exportSTL({...result.project,printMode}).length>84,'Both selectable constructions produce a closed printable mesh');
  }
});

test('opposing compact shelves can save space with real hex outlines and a shared pocket depth',()=>{
  const tools=toolsOf('hex-key-set-1-5-10mm').map(tool=>({...tool,depth:8})),opts={order:'asc',toolSet:{layout:'shared'}};
  const ordered=addToolGroup(big(),tools,{...opts,arrangement:'ordered'}),compact=addToolGroup(big(),tools,{...opts,arrangement:'compact'});
  assert.ok(area(compact)<area(ordered));const directions=[...new Set(compact.project.tools.map(heading))];
  assert.equal(directions.length,2);assert.equal(wrap(directions[0]-directions[1]),180);
  for(const printMode of ['solid','light'])assert.ok(exportSTL({...compact.project,printMode}).length>84);
});

test('compact rectangular pockets keep a common heading when turning cannot save grid area',()=>{
  const tools=[8,10,13].map(size=>rect(`tool-${size}`,100,20,{value:size,unit:'mm'}));
  const result=addToolGroup(big(),tools,{arrangement:'compact',order:'asc',toolSet:{layout:'shared'}});
  assert.equal(new Set(result.project.tools.map(heading)).size,1);
  assert.deepEqual(validateLayout(result.project),[]);
});

test('real 26-piece wrenches remain ordered and valid in ordered and compact layouts with existing position locks',()=>{
  const tools=toolsOf('combination-wrench-set-6-32mm'),locked={id:'locked',name:'Výplň',x:0,y:0,width:42,height:42,locked:true,sizeMode:'manual'};
  for(const arrangement of ['ordered','compact']){
    const project={...big(),modules:[locked]},result=addToolGroup(project,[...tools].reverse(),{arrangement,order:'asc',toolSet:{layout:'shared'}});
    assert.equal(result.placed,true);assert.deepEqual(result.project.modules.find(module=>module.id==='locked'),locked);
    assert.deepEqual(validateLayout(result.project),[]);
    assert.deepEqual(values(result.project.tools),sorted(values(tools),'asc'));
    for(const printMode of ['solid','light'])assert.ok(exportSTL({...result.project,printMode}).length>84,'The final translated module, including mixed pocket depths and the locked filler, is printable');
  }
});

test('uniform modules place nominal size order left to right and top to bottom',()=>{
  const tools=toolsOf('hex-key-set-1-5-10mm');
  for(const order of ['asc','desc']){
    const result=addToolGroup(big(),[...tools].reverse(),{arrangement:'ordered',order,toolSet:{layout:'uniform'}}),p=result.project;
    const physical=[...p.modules].sort((a,b)=>a.y-b.y||a.x-b.x).map(module=>p.tools.find(tool=>tool.moduleId===module.id));
    assert.deepEqual(values(physical),sorted(values(tools),order));
    assert.equal(new Set(p.modules.map(module=>`${module.width}x${module.height}`)).size,1);
    assert.deepEqual(validateLayout(p),[]);
  }
});

test('print-bed splits keep contiguous monotonic nominal ranges and every complete pocket printable',()=>{
  const tools=toolsOf('combination-wrench-set-8-19mm'),project={...big(),limitToBed:true};
  for(const arrangement of ['ordered','compact'])for(const order of ['asc','desc']){
    const result=splitForBed(project,[...tools].reverse(),{arrangement,order,toolSet:{name:'Klíče'}}),p=result.project;
    assert.equal(result.placed,true);assert.equal(result.reason,'ok');
    assert.deepEqual(result.oversize,[]);assert.deepEqual(validateLayout(p),[]);
    const logical=result.moduleIds.flatMap(id=>p.tools.filter(tool=>tool.moduleId===id));
    assert.deepEqual(values(logical),sorted(values(tools),order),'Each printable module holds the next contiguous sizes');
    assert.ok(p.modules.every(module=>(module.width-.5<=220&&module.height-.5<=220)||(module.height-.5<=220&&module.width-.5<=220)));
    assert.equal(p.toolSets[0].arrangement,arrangement);assert.equal(p.toolSets[0].order,order);
    assert.equal(validateProject(JSON.parse(JSON.stringify(p))).tools.length,tools.length);
  }
});

test('invalid arrangement preferences fail atomically',()=>{
  const project=big(),tools=[rect('a')],snapshot=structuredClone(project);
  for(const operation of [addToolGroup,splitForBed]){
    assert.throws(()=>operation(project,tools,{arrangement:'random'}),error=>!!error.i18n);
    assert.throws(()=>operation(project,tools,{order:'mixed'}),error=>!!error.i18n);
    assert.deepEqual(project,snapshot);
  }
});
