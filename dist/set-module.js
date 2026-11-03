// Tool sets as ONE shared module, and uniform tool scaling. Pure geometry, no DOM.
import Clipper from './vendor/clipper.js';
import {pocketOutline,automaticFingerGrips} from './finger-grip.js';
import {autoArrange,validateLayout} from './geometry.js';
import {analyzeToolShape} from './tool-sets.js';
import {uid} from './model.js';
import {t,i18nError} from './i18n.js';
import {fmtLen} from './units.js';

const EPS=1e-7,SCALE=10000,CELL=1,MAX_SIZE=3000;
const copy=value=>JSON.parse(JSON.stringify(value));
const num=(value,fallback=0)=>Number.isFinite(+value)?+value:fallback;
const angle=value=>{const r=((value%360)+360)%360;return Math.round(r*1e6)/1e6;};
const box=points=>{let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of points){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}return{minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};};
const intersects=(a,b,e=.001)=>a.x<b.x+b.width-e&&a.x+a.width>b.x+e&&a.y<b.y+b.height-e&&a.y+a.height>b.y+e;
const fitsBed=(width,height,project)=>{
  if(!project.limitToBed)return true;
  const bw=num(project.bedWidth,220),bh=num(project.bedHeight,220);
  return (width-.5<=bw&&height-.5<=bh)||(height-.5<=bw&&width-.5<=bh);
};

/** Uniformly scale a tool outline about its local origin. Grip centres move with the outline, grip radii stay finger-sized. */
export function scaleTool(tool,factor,opts={}){
  const f=Number(factor);
  if(typeof factor==='boolean'||factor===null||factor===''||!Number.isFinite(f)||f<.2||f>5)throw i18nError('Měřítko nástroje musí být mezi {min}× a {max}×.',{min:.2,max:5});
  if(!Array.isArray(tool?.points)||tool.points.length<3)throw i18nError('Nástroj nemá platnou konturu pro změnu měřítka.');
  const points=tool.points.map(p=>({x:num(p.x)*f,y:num(p.y)*f})),b=box(points);
  if(b.width>MAX_SIZE||b.height>MAX_SIZE)throw i18nError('Kontura nesmí v žádném směru přesáhnout {max}.',{max:fmtLen(MAX_SIZE)});
  const next={...copy(tool),points,...(opts.id!=null?{id:String(opts.id)}:{})};
  if(Array.isArray(tool.fingerGrips)&&tool.fingerGrips.length){
    next.fingerGrips=tool.fingerGrips.map(g=>({...g,x:num(g.x)*f,y:num(g.y)*f}));
    try{pocketOutline(next,0);}
    catch{next.fingerGrips=automaticFingerGrips(next,{radius:num(tool.fingerGrips[0].radius,9)});}
  }
  return next;
}

// --- Clipper helpers -------------------------------------------------------
function expand(points,distance){
  const path=points.map(p=>({X:Math.round(p.x*SCALE),Y:Math.round(p.y*SCALE)}));
  if(!Clipper.Clipper.Orientation(path))path.reverse();
  const engine=new Clipper.ClipperOffset(2,.005*SCALE),result=[];
  engine.AddPath(path,Clipper.JoinType.jtRound,Clipper.EndType.etClosedPolygon);
  engine.Execute(result,distance*SCALE);
  if(!result.length)return null;
  result.sort((a,b)=>Math.abs(Clipper.Clipper.Area(b))-Math.abs(Clipper.Clipper.Area(a)));
  return result[0].map(p=>({x:p.X/SCALE,y:p.Y/SCALE}));
}
/** Conservative per-column (CELL wide) y range of a polygon, absolute column indices. */
function columns(points){
  const map=new Map();
  const put=(col,lo,hi)=>{const v=map.get(col);if(v){v.lo=Math.min(v.lo,lo);v.hi=Math.max(v.hi,hi);}else map.set(col,{lo,hi});};
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],first=Math.floor(Math.min(a.x,b.x)/CELL),last=Math.floor(Math.max(a.x,b.x)/CELL);
    for(let col=first;col<=last;col++){
      if(Math.abs(b.x-a.x)<EPS){put(col,Math.min(a.y,b.y),Math.max(a.y,b.y));continue;}
      const x1=Math.max(Math.min(a.x,b.x),col*CELL),x2=Math.min(Math.max(a.x,b.x),(col+1)*CELL);
      const y1=a.y+(b.y-a.y)*(x1-a.x)/(b.x-a.x),y2=a.y+(b.y-a.y)*(x2-a.x)/(b.x-a.x);
      put(col,Math.min(y1,y2),Math.max(y1,y2));
    }
  }
  return map;
}
const rect=b=>[{x:b.minX,y:b.minY},{x:b.maxX,y:b.minY},{x:b.maxX,y:b.maxY},{x:b.minX,y:b.maxY}];

/** Pockets oriented for packing. heading=null: longest pocket side horizontal (current rotation or +90°).
 *  heading=0|90: every tool gets analyzeToolShape(tool).rotation+heading — one common heading as set-layout.js expects. */
function prepare(tools,clearance,separation,heading=null){
  return tools.map((tool,index)=>{
    let rotations;
    if(heading===null){const base=num(tool.rotation);rotations=[angle(base),angle(base+90)];}
    else{let shape;try{shape=analyzeToolShape(tool);}catch(error){throw i18nError('Nástroj „{name}“ nemá platnou kapsu: {error}',{name:tool.name||tool.id,error:error.message});}rotations=[angle(shape.rotation+heading)];}
    const options=[];
    for(const rotation of rotations){
      let polygon;
      try{polygon=pocketOutline({...tool,x:0,y:0,rotation},clearance);}
      catch(error){throw i18nError('Nástroj „{name}“ nemá platnou kapsu: {error}',{name:tool.name||tool.id,error:error.message});}
      if(polygon.length<3)throw i18nError('Nástroj „{name}“ nemá platnou kapsu: {error}',{name:tool.name||tool.id,error:''});
      options.push({rotation,polygon,bounds:box(polygon)});
    }
    const chosen=options.length===1||options[0].bounds.width>=options[0].bounds.height-EPS?options[0]:options[1];
    const expanded=expand(chosen.polygon,separation);
    if(!expanded)throw i18nError('Nástroj „{name}“ nemá platnou kapsu: {error}',{name:tool.name||tool.id,error:''});
    return{tool,index,...chosen,expanded,box:rect(chosen.bounds),expandedBox:rect({minX:chosen.bounds.minX-separation,minY:chosen.bounds.minY-separation,maxX:chosen.bounds.maxX+separation,maxY:chosen.bounds.maxY+separation})};
  });
}

/** Shelf rows of at most `shelf` mm, each item dropped onto the skyline of what is already placed. */
function layout(items,{shelf,align,exact,gap}){
  const rows=[];let row=[],used=0;
  for(const item of items){
    const w=item.bounds.width;
    if(row.length&&used+gap+w>shelf+EPS){rows.push({items:row,width:used});row=[];used=0;}
    used+=(row.length?gap:0)+w;row.push(item);
  }
  if(row.length)rows.push({items:row,width:used});
  const total=Math.max(...rows.map(r=>r.width)),skyline=new Map(),placed=[];
  for(const r of rows){
    let cursor=align==='center'?(total-r.width)/2:align==='right'?total-r.width:0;
    for(const item of r.items){
      const x=cursor-item.bounds.minX;cursor+=item.bounds.width+gap;
      const shape=exact?item.expanded:item.expandedBox,solid=exact?item.polygon:item.box;
      // Lowest y that keeps the expanded pocket clear of everything above it.
      let y=-item.bounds.minY;
      for(const [col,range] of columns(shape.map(p=>({x:p.x+x,y:p.y})))){const top=skyline.get(col);if(top!==undefined)y=Math.max(y,top-range.lo);}
      for(const [col,range] of columns(solid.map(p=>({x:p.x+x,y:p.y+y})))){const top=skyline.get(col);skyline.set(col,top===undefined?range.hi:Math.max(top,range.hi));}
      placed.push({item,x,y});
    }
  }
  const content=box(placed.flatMap(({item,x,y})=>[{x:item.bounds.minX+x,y:item.bounds.minY+y},{x:item.bounds.maxX+x,y:item.bounds.maxY+y}]));
  return{placed,content,rows:rows.length};
}

function shelfWidths(items,gap,project,padding){
  const widths=items.map(i=>i.bounds.width).sort((a,b)=>b-a),min=widths[0],values=new Set([min]);
  let sum=widths[0];
  for(let k=1;k<Math.min(widths.length,12);k++){sum+=gap+widths[k];values.add(sum);}
  const area=items.reduce((s,i)=>s+(i.bounds.width+gap)*(i.bounds.height+gap),0);
  for(const factor of [.6,.8,1,1.25,1.6,2,2.5,3.2])values.add(Math.sqrt(area)*factor);
  for(const limit of [num(project.width)-2*padding,...(project.limitToBed?[num(project.bedWidth,220)-2*padding,num(project.bedHeight,220)-2*padding]:[])])if(limit>0)values.add(limit);
  return [...values].filter(w=>w>=min-EPS&&w<=MAX_SIZE).sort((a,b)=>a-b);
}

/** Pack tools tightly into ONE module and place it in the drawer.
 *  opts.toolSet {name?, id?, layout:'shared'|'uniform'|'auto'} also registers project.toolSets (see tool-sets.js):
 *  'shared'/'auto' → one module tagged {grouped, setId, setLayout:'shared', sizeMode:'auto'} with one common heading;
 *  'uniform' → one equal-sized module per tool tagged {setId, setLayout:'uniform'} (also returns moduleIds). */
export function addToolGroup(project,tools,opts={}){
  if(!Array.isArray(tools)||!tools.length)throw i18nError('Sada neobsahuje žádné nástroje.');
  const next=copy(project);next.tools=next.tools||[];next.modules=next.modules||[];
  const ids=new Set(next.tools.map(t=>t.id));
  for(const tool of tools){if(!tool||typeof tool.id!=='string'||!tool.id||ids.has(tool.id))throw i18nError('Duplicitní identifikátor nástroje.');ids.add(tool.id);}
  const toolSet=opts.toolSet?{...opts.toolSet,layout:opts.toolSet.layout??'shared'}:null;
  if(toolSet&&!['shared','uniform','auto'].includes(toolSet.layout))throw i18nError('Zvolte automatické, sjednocené nebo společné uspořádání sady.');
  const addedModules=toolSet?.layout==='uniform'?tools.length:1;
  if(next.tools.length+tools.length>300||next.modules.length+addedModules>400)throw i18nError('Projekt je příliš velký. Limit je 300 nástrojů a 400 modulů.');
  const name=String(opts.name||toolSet?.name||t('Sada nástrojů')).slice(0,100);
  let setId=null;
  if(toolSet){
    const setIds=new Set((next.toolSets||[]).map(s=>s.id)),base=String(toolSet.id||uid()).slice(0,90);
    setId=base;for(let i=2;setIds.has(setId);i++)setId=`${base}-${i}`;
    next.toolSets=[...(next.toolSets||[]),{id:setId,name:String(toolSet.name||name).slice(0,100),toolIds:tools.map(tool=>tool.id),layout:toolSet.layout}];
  }
  const extra=setId?{setId}:{};
  const clearance=num(next.clearance,.8),wall=num(next.wall,2.4),grid=Math.max(1,num(next.grid,42)),padding=wall+.25;
  const separation=wall+.05,gap=separation+CELL+.01,source=copy(tools);
  const usedModules=new Set(next.modules.map(m=>m.id));
  const allocate=base=>{base=String(base).slice(0,90);let id=base;for(let i=2;usedModules.has(id);i++)id=`${base}-${i}`;usedModules.add(id);return id;};
  const unit=['mm','in'].includes(opts.unit)?opts.unit:null;
  // fits = inside drawer and on the print bed; inDrawer alone still gives a parked group a sensible shape.
  const rank=dims=>{const inDrawer=dims.width<=num(next.width)+EPS&&dims.height<=num(next.height)+EPS;return{area:dims.width*dims.height,inDrawer,fits:inDrawer&&fitsBed(dims.width,dims.height,next)};};
  const order=(a,b)=>(b.fits-a.fits)||(b.inDrawer-a.inDrawer);
  const freeSpot=(width,height)=>{
    for(let y=0;y+height<=num(next.height)+EPS;y+=grid)for(let x=0;x+width<=num(next.width)+EPS;x+=grid){
      const r={x,y,width,height};
      if(!next.modules.some(m=>intersects(r,m)))return{x,y};
    }
    return null;
  };
  // Park outside the drawer while keeping the persisted coordinates within the model's 4000 mm limit.
  // Once the parking area fills, parked modules may overlap each other; their tools must remain saveable.
  const park=(width,height)=>{
    const outside=next.modules.filter(m=>m.x+m.width>num(next.width)+EPS||m.y+m.height>num(next.height)+EPS);
    const x=Math.min(num(next.width)+grid,4000-width),below=outside.length?Math.max(...outside.map(m=>m.y+m.height))+grid:0;
    const y=Math.min(Math.max(below,x<num(next.width)?num(next.height)+grid:0),4000-height);
    return{x,y};
  };
  const tryArrange=own=>{
    const placedBefore=placedTools(next),arranged=autoArrange(next),candidate={...next,tools:arranged.tools,modules:arranged.modules},placedAfter=placedTools(candidate);
    return [...placedBefore].every(id=>placedAfter.has(id))&&own.every(tool=>placedAfter.has(tool.id))?candidate:null;
  };

  if(toolSet?.layout==='uniform'){
    // Equal footprints for every member and one common heading; the smaller cell wins.
    const cells=[90,0].map(heading=>{
      const items=prepare(source,clearance,separation,heading);
      const width=Math.ceil((Math.max(...items.map(i=>i.bounds.width))+2*padding-EPS)/grid)*grid,height=Math.ceil((Math.max(...items.map(i=>i.bounds.height))+2*padding-EPS)/grid)*grid;
      return{items,width,height,...rank({width,height})};
    }).sort((a,b)=>order(a,b)||a.area-b.area);
    const cell=cells[0];
    if(cell.width>MAX_SIZE||cell.height>MAX_SIZE)throw i18nError('Sada je pro jeden modul příliš velká (nejvýše {max} v každém směru).',{max:fmtLen(MAX_SIZE)});
    const base=opts.moduleId||`set-${tools[0].id}`,moduleIds=[],own=[];let all=true;
    for(const item of cell.items){
      const spot=cell.fits?freeSpot(cell.width,cell.height):null;if(!spot)all=false;
      const id=allocate(cell.items.length>1?`${base}-${item.index+1}`:base),position=spot||park(cell.width,cell.height);
      const module={id,name:String(item.tool.name||name).slice(0,100),...position,width:cell.width,height:cell.height,locked:false,sizeMode:'auto',setId,setLayout:'uniform',...(unit?{unit}:{})};
      const tool={...item.tool,moduleId:id,rotation:item.rotation,x:position.x+(cell.width-item.bounds.width)/2-item.bounds.minX,y:position.y+(cell.height-item.bounds.height)/2-item.bounds.minY};
      next.modules.push(module);next.tools.push(tool);own.push(tool);moduleIds.push(id);
    }
    if(all)return{project:next,moduleId:moduleIds[0],moduleIds,placed:true,...extra};
    const arranged=cell.fits?tryArrange(own):null;
    return{project:arranged||next,moduleId:moduleIds[0],moduleIds,placed:!!arranged,...extra};
  }

  // One shared module. A registered set uses one common heading (coherent for set-layout.js).
  const variants=toolSet?[90,0].map(heading=>prepare(source,clearance,separation,heading)):[prepare(source,clearance,separation)];
  const size=content=>({width:Math.ceil((content.width+2*padding-EPS)/grid)*grid,height:Math.ceil((content.height+2*padding-EPS)/grid)*grid});
  const candidates=[];
  for(const prepared of variants){
    const items=prepared.sort((a,b)=>b.bounds.width-a.bounds.width||b.bounds.height-a.bounds.height||a.index-b.index);
    for(const shelf of shelfWidths(items,gap,next,padding))for(const align of ['left','center','right']){
      const result=layout(items,{shelf,align,exact:true,gap}),dims=size(result.content);
      if(dims.width>MAX_SIZE||dims.height>MAX_SIZE)continue;
      candidates.push({items,shelf,align,...result,...dims,...rank(dims)});
    }
  }
  if(!candidates.length)throw i18nError('Sada je pro jeden modul příliš velká (nejvýše {max} v každém směru).',{max:fmtLen(MAX_SIZE)});
  candidates.sort((a,b)=>order(a,b)||a.area-b.area||Math.max(a.width,a.height)-Math.max(b.width,b.height)||a.rows-b.rows||a.content.width*a.content.height-b.content.width*b.content.height);

  const moduleId=allocate(opts.moduleId||`set-${tools[0].id}`);
  // Tool placements for a candidate at module position (mx,my); content centred like resizeModule does.
  const build=(candidate,mx,my)=>{
    const module={id:moduleId,name,x:mx,y:my,width:candidate.width,height:candidate.height,locked:false,sizeMode:setId?'auto':'manual',grouped:true,...(setId?{setId,setLayout:'shared'}:{}),...(unit?{unit}:{})};
    const dx=mx+(candidate.width-candidate.content.width)/2-candidate.content.minX,dy=my+(candidate.height-candidate.content.height)/2-candidate.content.minY;
    const placed=candidate.placed.map(({item,x,y})=>({...item.tool,moduleId,rotation:item.rotation,x:x+dx,y:y+dy}));
    return{module,tools:placed};
  };
  const valid=candidate=>{
    const {module,tools:own}=build(candidate,0,0);
    return !validateLayout({...next,width:Math.max(candidate.width,num(next.width)),height:Math.max(candidate.height,num(next.height)),modules:[module],tools:own}).length;
  };
  // Contour-nested candidates are double-checked; the bounding-box version is safe by construction.
  const checked=[];
  for(const candidate of candidates){
    if(checked.length>=6)break;
    if(valid(candidate)){checked.push(candidate);continue;}
    const safe=layout(candidate.items,{shelf:candidate.shelf,align:candidate.align,exact:false,gap}),dims=size(safe.content);
    if(dims.width>MAX_SIZE||dims.height>MAX_SIZE)continue;
    const fallback={...candidate,...safe,...dims,...rank(dims)};
    if(valid(fallback))checked.push(fallback);
  }
  if(!checked.length)throw i18nError('Sadu se nepodařilo bezpečně uspořádat do jednoho modulu.');
  checked.sort((a,b)=>order(a,b)||a.area-b.area);
  for(const candidate of checked){
    const spot=candidate.fits?freeSpot(candidate.width,candidate.height):null;
    if(spot){const {module,tools:own}=build(candidate,spot.x,spot.y);next.modules.push(module);next.tools.push(...own);return{project:next,moduleId,placed:true,...extra};}
  }
  const best=checked[0],position=park(best.width,best.height),{module,tools:own}=build(best,position.x,position.y);
  next.modules.push(module);next.tools.push(...own);
  const arranged=best.fits?tryArrange(own):null;
  return{project:arranged||next,moduleId,placed:!!arranged,...extra};
}
function placedTools(project){
  const inside=new Set(project.modules.filter(m=>m.x>=-.001&&m.y>=-.001&&m.x+m.width<=num(project.width)+.001&&m.y+m.height<=num(project.height)+.001).map(m=>m.id));
  return new Set(project.tools.filter(tool=>inside.has(tool.moduleId)).map(tool=>tool.id));
}
