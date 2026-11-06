// Last stage of automatic layout: keeps a found layout, but uses the room it left.
// 1. Stepped modules are cut in place, so a good rectangular layout never loses its steps.
// 2. Tools left outside get a second chance: turned modules, then other arrangements of a set.
// 3. With merge on, tools of unrelated modules move into the free room of larger ones.
// 4. A step only pays off when another module sits in it, so unused notches are filled again.
import {bounds,pocketOutline,validateLayout} from './geometry.js';
import {fillFreeCells,moduleIntersects,moduleOutline,modulePadding,offsetOutline,steppedModuleFootprint} from './module-footprint.js';
import {addToolGroup} from './set-module.js';
import {orderTools} from './tool-size.js';
import {findToolSets,setCoherence} from './tool-sets.js';

const CELL=2,EPS=.001,SHUFFLES=6,MERGE_BUDGET=8000,TURNS=[0,90,180,270];
const copy=value=>structuredClone(value);
const number=(value,fallback=0)=>Number.isFinite(+value)?+value:fallback;
const inDrawer=(m,p)=>m.x>=-EPS&&m.y>=-EPS&&m.x+m.width<=p.width+EPS&&m.y+m.height<=p.height+EPS;
const box=points=>{let x=Infinity,y=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of points){x=Math.min(x,p.x);y=Math.min(y,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}return{x,y,maxX,maxY,width:maxX-x,height:maxY-y};};
const hash=text=>{let value=2166136261;for(let i=0;i<text.length;i++){value^=text.charCodeAt(i);value=Math.imul(value,16777619);}return(value>>>0).toString(16);};
const members=(state,id)=>state.tools.filter(tool=>tool.moduleId===id);
const freeId=(base,taken)=>{let id=base,index=2;while(taken.has(id))id=`${base}-${index++}`;taken.add(id);return id;};
function random(seed){let value=seed>>>0;return()=>{value=value+0x6D2B79F5>>>0;let t=value;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function shuffled(list,seed){const out=[...list],next=random(seed);for(let i=out.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;}

/** What the layout may do with a module. The same rules are enforced again when the app accepts the result. */
function rules(project,state){
  const uniform=m=>(project.toolSets||[]).some(set=>set.layout==='uniform'&&(set.id===m.setId||members(state,m.id).some(tool=>set.toolIds.includes(tool.id))));
  const fixed=m=>{const own=members(state,m.id);return m.locked||!own.length||own.some(tool=>tool.locked);};
  const rigid=m=>m.sizeMode==='manual'||m.pocketMargin!=null||uniform(m);
  // A plain module holding several tools was arranged by hand; only its grouped or single-tool neighbours are rebuilt.
  const open=m=>!fixed(m)&&!rigid(m)&&(m.grouped===true||m.setLayout==='auto'||members(state,m.id).length===1);
  // A cut moves no tool, so a module's own pocket margin is no reason to keep its empty cells.
  const cuttable=m=>!fixed(m)&&m.sizeMode!=='manual'&&!uniform(m);
  return{fixed,rigid,open,cuttable};
}

/** Same tools turned with their module by a multiple of 90 degrees. Module sizes stay whole raster cells. */
function turned(option,quarter){
  let {width,height,items}=option;
  for(let i=0;i<quarter;i++){
    items=items.map(item=>{const b=bounds({...item.tool,x:item.x,y:item.y,rotation:item.rotation});return{...item,x:height-(item.y+b.height),y:item.x,rotation:(number(item.rotation)+90)%360};});
    [width,height]=[height,width];
  }
  return{...option,width,height,items};
}
function currentOption(module,tools){return{width:module.width,height:module.height,items:tools.map(tool=>({tool,x:tool.x-module.x,y:tool.y-module.y,rotation:tool.rotation||0}))};}
function rearranged(project,module,tools,alternate){
  try{
    const result=addToolGroup({...project,tools:[],modules:[],toolSets:[]},orderTools(copy(tools),'asc'),{name:module.name,moduleId:module.id,arrangement:'compact',order:'asc',alternate,separation:Math.max(project.wall,project.gap),checkManufacturing:false,toolSet:{id:'space-alternative',name:module.name,layout:'shared'}});
    const made=result.project.modules.find(item=>item.id===result.moduleId);
    if(!result.placed||!made)return null;
    return currentOption(made,result.project.tools);
  }catch{return null;}
}

/** Every module as a packing item. `turn` and `redo` widen the choice only when something still does not fit. */
function atomsOf(project,state,{turn=()=>false,redo=()=>false,alternate=true}={}){
  const {fixed,rigid,open}=rules(project,state),stay=[],atoms=[];
  for(const module of state.modules){
    if(fixed(module)){stay.push(copy(module));continue;}
    const tools=members(state,module.id),base=currentOption(module,tools),options=[base];
    if(open(module)){
      if(turn(module))for(const quarter of [1,2,3])options.push(turned(base,quarter));
      if(redo(module)&&tools.length>1){const other=rearranged(project,module,tools,alternate);if(other){options.push(other);if(turn(module))options.push(turned(other,1));}}
    }
    atoms.push({id:module.id,module:copy(module),options,...(rigid(module)?{preserveFootprint:true}:{})});
  }
  return{stay,atoms};
}

function cutInPlace(project,state){
  const next={tools:state.tools,modules:state.modules.map(copy)},{cuttable}=rules(project,next),grid=number(project.grid,42);
  for(let i=0;i<next.modules.length;i++){
    const module=next.modules[i];if(!cuttable(module))continue;
    const cut=steppedModuleFootprint({...project,modules:next.modules,tools:members(next,module.id)},module);
    if(!cut.cells)continue;
    // A rectangle returned for an awkward shape must not grow back over a neighbour.
    if(next.modules.some((other,j)=>j!==i&&moduleIntersects(cut,other,grid)))continue;
    next.modules[i]=cut;
  }
  return next;
}

/** Rectangular modules only: a step left by an earlier layout goes back to plain module wherever no neighbour stands in it. */
function fillUnusedSteps(project,state){
  const next={tools:state.tools,modules:state.modules.map(copy)},{fixed,rigid}=rules(project,next),grid=number(project.grid,42);
  for(let i=0;i<next.modules.length;i++){
    const module=next.modules[i];if(!module.cells||fixed(module)||rigid(module))continue;
    next.modules[i]=fillFreeCells(module,next.modules.filter((other,j)=>j!==i),grid);
  }
  return next;
}

/** Applies the chosen shape where the modules stand. Nothing moves, so switching the option never rearranges a drawer. */
export function reshapeModules(project,moduleShape){
  const state={tools:project.tools,modules:project.modules},next=moduleShape==='stepped'?cutInPlace(project,state):fillUnusedSteps(project,state),result={...project,modules:next.modules};
  return validateLayout(result).length>validateLayout(project).length?project:result;
}

// Raster of one module: 1 = taken. It only proposes a position, the exact contours decide afterwards.
function lineCrossings(poly,y){const hits=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];if(a.y<=y!==b.y<=y)hits.push(a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y));}return hits.sort((a,b)=>a-b);}
function polygonRows(poly,originX,originY,rows,cols,visit){
  for(let row=0;row<rows;row++){
    for(const sample of [.02,.5,.98]){
      const hits=lineCrossings(poly,originY+(row+sample)*CELL);
      for(let i=0;i+1<hits.length;i+=2){const from=Math.floor((hits[i]-originX)/CELL),to=Math.floor((hits[i+1]-originX)/CELL);if(to<0||from>=cols)continue;visit(row,Math.max(0,from),Math.min(cols-1,to));}
    }
  }
}
function makeRaster(x,y,width,height){const cols=Math.ceil(width/CELL),rows=Math.ceil(height/CELL);return{x,y,cols,rows,taken:new Uint8Array(cols*rows),run:new Int32Array(cols*rows),free:0};}
function mark(raster,poly){
  const b=box(poly),top=Math.max(0,Math.floor((b.y-raster.y)/CELL)),last=Math.min(raster.rows-1,Math.floor((b.maxY-raster.y)/CELL));if(last<top)return;
  polygonRows(poly,raster.x,raster.y+top*CELL,last-top+1,raster.cols,(row,from,to)=>raster.taken.fill(1,(row+top)*raster.cols+from,(row+top)*raster.cols+to+1));
}
function index(raster){
  let free=0;
  for(let row=0;row<raster.rows;row++){let run=0;for(let col=raster.cols-1;col>=0;col--){const at=row*raster.cols+col;run=raster.taken[at]?0:run+1;raster.run[at]=run;if(!raster.taken[at])free++;}}
  raster.free=free;
}
function shape(tool,project,rotation){
  const pocket=pocketOutline({...tool,x:0,y:0,rotation},project),b=box(pocket),local=pocket.map(p=>({x:p.x-b.x,y:p.y-b.y})),rows=Math.ceil(b.height/CELL)+1,cols=Math.ceil(b.width/CELL)+1,spans=[],seen=Array.from({length:rows},()=>[]);
  polygonRows(local,0,0,rows,cols,(row,from,to)=>seen[row].push([from,to]));
  let cells=0;
  for(let row=0;row<rows;row++){
    const list=seen[row].sort((a,c)=>a[0]-c[0]);let open=null;
    for(const [from,to] of list){if(open&&from<=open[1]+1)open[1]=Math.max(open[1],to);else{if(open)spans.push({row,col:open[0],length:open[1]-open[0]+1});open=[from,to];}}
    if(open)spans.push({row,col:open[0],length:open[1]-open[0]+1});
  }
  for(const span of spans)cells+=span.length;
  // The longest span rejects most positions with a single lookup.
  spans.sort((a,c)=>c.length-a.length);
  return{rotation,spans,cells,rows,cols,minX:b.x,minY:b.y};
}
function firstFit(raster,item){
  if(item.cells>raster.free||item.rows>raster.rows||item.cols>raster.cols)return null;
  const [lead,...rest]=item.spans,{run,cols}=raster;
  for(let y=0;y+item.rows<=raster.rows;y++)for(let x=0;x+item.cols<=cols;x++){
    if(run[(y+lead.row)*cols+x+lead.col]<lead.length)continue;
    let fits=true;for(const span of rest)if(run[(y+span.row)*cols+x+span.col]<span.length){fits=false;break;}
    if(fits)return{x,y};
  }
  return null;
}
function targetRaster(project,state,target){
  const grid=number(project.grid,42),padding=modulePadding(project),separation=Math.max(project.wall,project.gap)+.05,raster=makeRaster(target.x,target.y,target.width,target.height);
  const rim=Math.ceil(padding/CELL);
  for(let row=0;row<raster.rows;row++)for(let col=0;col<raster.cols;col++)if(row<rim||col<rim||row>=raster.rows-rim||col>=raster.cols-rim)raster.taken[row*raster.cols+col]=1;
  for(const other of state.modules){
    if(other.id===target.id||!inDrawer(other,project)||other.x>=target.x+target.width||other.y>=target.y+target.height||other.x+other.width<=target.x||other.y+other.height<=target.y)continue;
    for(const poly of offsetOutline(moduleOutline(other,grid),padding))mark(raster,poly);
  }
  for(const tool of members(state,target.id))for(const poly of offsetOutline(pocketOutline(tool,project),separation))mark(raster,poly);
  index(raster);return raster;
}
function placeTool(project,tool,rasters,shapes){
  for(const raster of rasters)for(const item of shapes){
    const at=firstFit(raster,item);if(!at)continue;
    const x=raster.x+at.x*CELL-item.minX,y=raster.y+at.y*CELL-item.minY;
    return{raster,moved:{...tool,x,y,rotation:item.rotation,moduleId:raster.moduleId}};
  }
  return null;
}
function toolShapes(project,tool){const base=number(tool.rotation),out=[];for(const turn of TURNS){try{out.push(shape(tool,project,(base+turn)%360));}catch{}}return out;}
const footprintFor=(project,moduleShape,module,tools)=>moduleShape==='stepped'?steppedModuleFootprint({...project,tools},module):module;

/** One donor module: move what fits into the room of open modules, keep the result only when it is measurably better. */
function absorb(project,state,donor,{moduleShape,better,metric,valid}){
  const {open}=rules(project,state),grid=number(project.grid,42);
  const targets=state.modules.filter(module=>module.id!==donor.id&&open(module)&&inDrawer(module,project)).sort((a,b)=>b.width*b.height-a.width*a.height);
  if(!targets.length)return null;
  const rasters=targets.map(target=>Object.assign(targetRaster(project,state,target),{moduleId:target.id}));
  const moved=new Map(),tools=members(state,donor.id).sort((a,b)=>{const pa=box(pocketOutline(a,project)),pb=box(pocketOutline(b,project));return pb.width*pb.height-pa.width*pa.height;});
  const separation=Math.max(project.wall,project.gap)+.05;
  for(const tool of tools){
    const spot=placeTool(project,tool,rasters,toolShapes(project,tool));if(!spot)continue;
    moved.set(tool.id,spot.moved);
    for(const poly of offsetOutline(pocketOutline(spot.moved,project),separation))mark(spot.raster,poly);
    index(spot.raster);
  }
  if(!moved.size)return null;
  const next={tools:state.tools.map(tool=>moved.get(tool.id)||tool),modules:state.modules.map(copy)},touched=new Set([...moved.values()].map(tool=>tool.moduleId));
  for(const id of touched){
    const at=next.modules.findIndex(module=>module.id===id),target=next.modules[at],mergedId=target.id.startsWith('merged-')?target.id:freeId(`merged-${hash(target.id)}`,new Set(next.modules.map(module=>module.id)));
    const merged={...target,id:mergedId,name:mergedId===target.id?target.name:`${target.name} + ${donor.name}`.slice(0,100),grouped:true,sizeMode:'auto',locked:false};
    delete merged.setId;delete merged.setLayout;delete merged.cells;delete merged.shape;
    next.tools=next.tools.map(tool=>tool.moduleId===id?{...tool,moduleId:mergedId}:tool);
    next.modules[at]=footprintFor(project,moduleShape,merged,members(next,mergedId));
  }
  const left=members(next,donor.id),at=next.modules.findIndex(module=>module.id===donor.id);
  if(!left.length)next.modules.splice(at,1);
  else{const plain={...next.modules[at]};delete plain.cells;delete plain.shape;next.modules[at]=footprintFor(project,moduleShape,plain,left);}
  if(next.modules.some((module,i)=>inDrawer(module,project)&&next.modules.some((other,j)=>j>i&&inDrawer(other,project)&&moduleIntersects(module,other,grid))))return null;
  return better(metric(next,project),metric(state,project))&&valid(next)?next:null;
}

/** Tools still outside become single modules in whatever room is left. Only when sets may be split. */
function singles(project,state,pack,moduleShape){
  const parked=state.modules.filter(module=>!inDrawer(module,project)&&rules(project,state).open(module));if(!parked.length)return null;
  const grid=number(project.grid,42),padding=modulePadding(project),ids=new Set(parked.map(module=>module.id)),taken=new Set(state.modules.map(module=>module.id)),atoms=[];
  for(const tool of state.tools.filter(tool=>ids.has(tool.moduleId))){
    const options=[number(tool.rotation),number(tool.rotation)+90].map(rotation=>{const b=box(pocketOutline({...tool,x:0,y:0,rotation},project)),width=Math.ceil((b.width+2*padding-EPS)/grid)*grid,height=Math.ceil((b.height+2*padding-EPS)/grid)*grid;return{width,height,items:[{tool,x:(width-b.width)/2-b.x,y:(height-b.height)/2-b.y,rotation}]};});
    const id=freeId(`solo-${hash(tool.id)}`,taken);atoms.push({id,module:{id,name:tool.name,sizeMode:'auto',locked:false},options});
  }
  const stay=state.modules.filter(module=>!ids.has(module.id));
  return pack({...project,tools:state.tools},stay,atoms,0,{moduleShape});
}

export async function tightenLayout(project,result,{moduleShape='rectangular',mode='compact',merge=false,pack,better,metric,pause=async()=>{},report=()=>{}}){
  const sets=mode==='sets'?findToolSets(project).sets:[],score=state=>mode==='sets'?setCoherence({...project,...state},sets).score:0;
  const placedOnly=state=>{const modules=state.modules.filter(module=>inDrawer(module,project)),ids=new Set(modules.map(module=>module.id));return{...project,modules,tools:state.tools.filter(tool=>ids.has(tool.moduleId))};};
  const valid=state=>!validateLayout(placedOnly(state)).length;
  let best={tools:result.tools,modules:result.modules},limited=false;
  const consider=candidate=>{
    if(!candidate)return;limited||=!!candidate.searchLimited;
    const before=metric(best,project),after=metric(candidate,project);
    if([...before.placed].some(id=>!after.placed.has(id))||!better(after,before)||after.placed.size===before.placed.size&&score(candidate)<score(best)||!valid(candidate))return;
    best={tools:candidate.tools,modules:candidate.modules};
  };
  const outside=()=>best.tools.length-metric(best,project).placed.size;
  const repack=async widen=>{
    const {stay,atoms}=atomsOf({...project,...best},best,widen),source={...project,...best},limit={moduleShape,maxPositions:120000};
    for(let order=0;order<4;order++){consider(pack(source,stay,atoms,order,limit));await pause();}
    if(atoms.length<=40)for(let seed=1;seed<=SHUFFLES;seed++){consider(pack(source,stay,atoms,list=>shuffled(list,seed),limit));await pause();}
  };
  if(moduleShape==='stepped')consider(cutInPlace(project,best));
  if(outside()){
    report(.97,'Hledám místo pro nástroje mimo šuplík…');
    const isOutside=module=>!inDrawer(module,project);
    await repack({turn:module=>isOutside(module)&&module.grouped===true});
    // Sets keep one heading while that is enough: tools turned by 180 degrees are the last resort.
    for(const alternate of mode==='sets'?[false,true]:[true])for(const redo of [isOutside,()=>true])if(outside())await repack({turn:module=>module.grouped===true,redo,alternate});
  }
  let merged=0;
  if(merge){
    report(.98,'Slučuji moduly do volného místa…');
    const started=Date.now();
    for(let round=0;round<3;round++){
      let changed=false;
      const donors=[...best.modules].sort((a,b)=>inDrawer(a,project)-inDrawer(b,project)||a.width*a.height-b.width*b.height);
      for(const donor of donors){
        if(Date.now()-started>MERGE_BUDGET)break;
        const current=best.modules.find(module=>module.id===donor.id);
        if(!current||!rules(project,best).open(current))continue;
        const count=best.modules.length,next=absorb(project,best,current,{moduleShape,better,metric,valid});
        if(next){best=next;changed=true;merged+=Math.max(0,count-next.modules.length);}
        await pause();
      }
      if(!changed)break;
      await repack({turn:()=>true});
    }
    await repack({turn:()=>true,redo:module=>!inDrawer(module,project)});
    if(outside())consider(singles(project,best,pack,moduleShape));
  }
  // Stepped means the module follows its tools on the raster, whether or not anything stands in the notch.
  // Free cells are closed by 1x1 plugs, so this last cut does not have to beat the metric.
  const finished=moduleShape==='stepped'?cutInPlace(project,best):fillUnusedSteps(project,best);if(valid(finished))best=finished;
  // Automatic grips belong to shared modules; a tool left alone goes back to what the customer had.
  const original=new Map(project.tools.map(tool=>[tool.id,tool])),count=id=>best.tools.filter(tool=>tool.moduleId===id).length,grouped=new Set(best.modules.filter(module=>module.grouped).map(module=>module.id));
  const tools=best.tools.map(tool=>{if(!Object.hasOwn(tool,'fingerGrips')||Object.hasOwn(original.get(tool.id)||{},'fingerGrips')||grouped.has(tool.moduleId)&&count(tool.moduleId)>1)return tool;const {fingerGrips,...plain}=tool;return plain;});
  report(1,'Chytré rozvržení je připravené.');
  return{...best,tools,merged,searchLimited:limited&&outside()>0};
}
