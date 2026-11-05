// Tool sets as ONE shared module (or as few print-bed sized modules), and uniform tool scaling. Pure geometry, no DOM.
import Clipper from './vendor/clipper.js';
import {pocketOutline,automaticFingerGrips} from './finger-grip.js';
import {autoArrange,validateLayout,exportSTL} from './geometry.js';
import {analyzeToolShape} from './tool-sets.js';
import {uid} from './model.js';
import {t,i18nError} from './i18n.js';
import {fmtLen} from './units.js';
import {compareToolSize,orderTools} from './tool-size.js';
import {moduleIntersects,modulePadding} from './module-footprint.js';

const EPS=1e-7,SCALE=10000,CELL=1,MAX_SIZE=3000;
const copy=value=>JSON.parse(JSON.stringify(value));
const num=(value,fallback=0)=>Number.isFinite(+value)?+value:fallback;
const angle=value=>{const r=((value%360)+360)%360;return Math.round(r*1e6)/1e6;};
const box=points=>{let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of points){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}return{minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};};
const intersects=(a,b,e=.001)=>a.x<b.x+b.width-e&&a.x+a.width>b.x+e&&a.y<b.y+b.height-e&&a.y+a.height>b.y+e;

/** Uniformly scale a tool outline about its local origin. Grip centres move with the outline, grip radii stay finger-sized. */
export function scaleTool(tool,factor,opts={}){
  const f=Number(factor);
  if(typeof factor==='boolean'||factor===null||factor===''||!Number.isFinite(f)||f<.2||f>5)throw i18nError('Měřítko nástroje musí být mezi {min}× a {max}×.',{min:.2,max:5});
  if(!Array.isArray(tool?.points)||tool.points.length<3)throw i18nError('Nástroj nemá platnou konturu pro změnu měřítka.');
  const points=tool.points.map(p=>({x:num(p.x)*f,y:num(p.y)*f})),b=box(points);
  if(b.width>MAX_SIZE||b.height>MAX_SIZE)throw i18nError('Kontura nesmí v žádném směru přesáhnout {max}.',{max:fmtLen(MAX_SIZE)});
  const next={...copy(tool),points,...(opts.id!=null?{id:String(opts.id)}:{})};
  // Centres follow the outline; a real magnet keeps its size.
  if(Array.isArray(tool.pocketMagnets))next.pocketMagnets=tool.pocketMagnets.map(magnet=>({...magnet,x:num(magnet.x)*f,y:num(magnet.y)*f}));
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
/** Conservative y range of a polygon in every CELL (1 mm) wide column, in the polygon's own frame.
 *  Shifting the polygon by an integer x shifts the column index by x, so every placement reuses these arrays. */
function columns(points){
  const b=box(points),start=Math.floor(b.minX/CELL),count=Math.floor(b.maxX/CELL)-start+1;
  const lo=new Float64Array(count).fill(Infinity),hi=new Float64Array(count).fill(-Infinity);
  const put=(col,a,c)=>{const i=col-start;if(a<lo[i])lo[i]=a;if(c>hi[i])hi[i]=c;};
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],first=Math.floor(Math.min(a.x,b.x)/CELL),last=Math.floor(Math.max(a.x,b.x)/CELL);
    for(let col=first;col<=last;col++){
      if(Math.abs(b.x-a.x)<EPS){put(col,Math.min(a.y,b.y),Math.max(a.y,b.y));continue;}
      const x1=Math.max(Math.min(a.x,b.x),col*CELL),x2=Math.min(Math.max(a.x,b.x),(col+1)*CELL);
      const y1=a.y+(b.y-a.y)*(x1-a.x)/(b.x-a.x),y2=a.y+(b.y-a.y)*(x2-a.x)/(b.x-a.x);
      put(col,Math.min(y1,y2),Math.max(y1,y2));
    }
  }
  return{start,lo,hi};
}
const rect=b=>[{x:b.minX,y:b.minY},{x:b.maxX,y:b.minY},{x:b.maxX,y:b.maxY},{x:b.minX,y:b.maxY}];
const invalidPocket=(tool,error)=>i18nError('Nástroj „{name}“ nemá platnou kapsu: {error}',{name:tool.name||tool.id,error});

/** One fixed orientation of a pocket: bounds and the column profiles used by the skyline packer.
 *  shape = pocket grown by the wall, so the next pocket stays a full wall away (finger grips included). */
function orient(tool,rotation,clearance,separation){
  let polygon;
  try{polygon=pocketOutline({...tool,x:0,y:0,rotation},clearance);}catch(error){throw invalidPocket(tool,error.message);}
  if(!Array.isArray(polygon)||polygon.length<3)throw invalidPocket(tool,'');
  const expanded=expand(polygon,separation);if(!expanded)throw invalidPocket(tool,'');
  const bounds=box(polygon),grown={minX:bounds.minX-separation,minY:bounds.minY-separation,maxX:bounds.maxX+separation,maxY:bounds.maxY+separation};
  return{rotation:angle(rotation),bounds,solid:columns(polygon),shape:columns(expanded),solidBox:columns(rect(bounds)),shapeBox:columns(rect(grown))};
}
/** Packing item: its normal orientation and (lazily) the one turned by 180°, so heads of neighbours can interleave.
 *  heading=null: longest pocket side horizontal (current rotation or +90°); heading=0|90: analyzeToolShape(tool).rotation+heading
 *  — one common heading as set-layout.js expects; rotation=number: exactly that rotation. */
function prepareOne(tool,index,ctx,{heading=null,rotation=null}={}){
  let base;
  if(rotation!=null)base=rotation;
  else if(heading===null){
    const r=num(tool.rotation);let a,b;
    try{a=box(pocketOutline({...tool,x:0,y:0,rotation:r},ctx.clearance));b=box(pocketOutline({...tool,x:0,y:0,rotation:r+90},ctx.clearance));}catch(error){throw invalidPocket(tool,error.message);}
    base=a.width>=a.height-EPS||b.width<b.height?r:r+90;
  }else{let shape;try{shape=analyzeToolShape(tool);}catch(error){throw invalidPocket(tool,error.message);}base=shape.rotation+heading;}
  const normal=orient(tool,base,ctx.clearance,ctx.separation);
  let turned=null;
  return{tool,index,normal,bounds:normal.bounds,turned:()=>turned||(turned=orient(tool,base+180,ctx.clearance,ctx.separation))};
}

/** Rows of at most `shelf` mm. */
function partition(items,shelf,gap){
  const rows=[];let row=[],used=0;
  for(const item of items){
    const w=item.bounds.width;
    if(row.length&&used+gap+w>shelf+EPS){rows.push(row);row=[];used=0;}
    used+=(row.length?gap:0)+w;row.push(item);
  }
  if(row.length)rows.push(row);
  return rows;
}
/** Shelf rows; each pocket drops onto the skyline of what is already placed (column-exact, or by bounding box).
 *  flip: 'none' | 'rows' (every other row turned 180°) | 'alt' (every other item turned 180°) — heads nest beside shanks.
 *  align: 'left' | 'center' | 'right' | 'zigzag' (rows alternately left and right).
 *  Valid by construction: in every column the wall-grown outline of a new pocket lies below everything placed before. */
function layout(rows,{align,exact,gap,flip,regular=false}){
  let k=0;
  const planned=rows.map((r,ri)=>{
    let cursor=0;
    const cells=r.map(item=>{
      const turn=flip==='rows'?ri%2:flip==='alt'?(k++)%2:0,v=turn?item.turned():item.normal,b=v.bounds;
      const x=Math.ceil((cursor-b.minX)/CELL-EPS)*CELL;cursor=x+b.maxX+gap;
      return{item,v,x};
    });
    return{cells,width:cursor-gap};
  });
  const total=Math.max(...planned.map(r=>r.width)),O=64,sky=new Float64Array(Math.ceil(total/CELL)+2*O).fill(-Infinity),placed=[];
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  let rowY=0;
  for(const [ri,r] of planned.entries()){
    const slack=Math.max(0,total-r.width),shift=CELL*Math.floor((align==='center'?slack/2:align==='right'||(align==='zigzag'&&ri%2)?slack:0)/CELL);
    const rowHeight=regular?Math.max(...r.cells.map(cell=>cell.v.bounds.height)):0;
    for(const {item,v,x:x0} of r.cells){
      const x=x0+shift,col=Math.round(x/CELL),shape=exact?v.shape:v.shapeBox,solid=exact?v.solid:v.solidBox;
      let y=regular?rowY+rowHeight-v.bounds.height-v.bounds.minY:-v.bounds.minY;
      if(!regular)for(let i=0,j=shape.start+col+O;i<shape.lo.length;i++,j++){const d=sky[j]-shape.lo[i];if(d>y)y=d;}
      for(let i=0,j=solid.start+col+O;i<solid.hi.length;i++,j++){const h=solid.hi[i]+y;if(h>sky[j])sky[j]=h;}
      placed.push({item,rotation:v.rotation,x,y});
      minX=Math.min(minX,v.bounds.minX+x);minY=Math.min(minY,v.bounds.minY+y);maxX=Math.max(maxX,v.bounds.maxX+x);maxY=Math.max(maxY,v.bounds.maxY+y);
    }
    if(regular)rowY+=rowHeight+gap;
  }
  return{placed,content:{minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY},rows:rows.length};
}

function shelfWidths(items,gap,limits){
  const widths=items.map(i=>i.bounds.width).sort((a,b)=>b-a),min=widths[0],values=new Set([min]);
  let sum=widths[0];
  for(let k=1;k<Math.min(widths.length,12);k++){sum+=gap+widths[k];values.add(sum);}
  const area=items.reduce((s,i)=>s+(i.bounds.width+gap)*(i.bounds.height+gap),0);
  for(const factor of [.6,.8,1,1.25,1.6,2,2.5,3.2])values.add(Math.sqrt(area)*factor);
  for(const limit of limits)if(limit>0)values.add(limit);
  return [...values].filter(w=>w>=min-EPS&&w<=MAX_SIZE).sort((a,b)=>a-b);
}
const FLIPS=['none','rows','alt'],ALIGNS=['left','center','right','zigzag'];
/** Every distinct packing of the prepared item lists (one list per heading) that `accept`s. */
function candidatesFor(lists,ctx,{accept=null,limits=[],flips=FLIPS}={}){
  const out=[];
  for(const list of lists){
    const items=[...list].sort(ctx.logicalOrder?(a,b)=>compareToolSize(a.tool,b.tool,ctx.order)||a.index-b.index:(a,b)=>b.bounds.width-a.bounds.width||b.bounds.height-a.bounds.height||a.index-b.index),seen=new Set();
    for(const shelf of shelfWidths(items,ctx.gap,limits)){
      const rows=partition(items,shelf,ctx.gap),key=rows.map(r=>r.length).join(',');
      if(seen.has(key))continue;seen.add(key);
      for(const flip of flips){
        if(flip==='rows'&&rows.length<2)continue;
        for(const align of rows.length>1&&!ctx.regular?ALIGNS:['left']){
          const result=layout(rows,{align,exact:true,gap:ctx.gap,flip,regular:ctx.regular}),dims=ctx.size(result.content);
          if(dims.width>MAX_SIZE||dims.height>MAX_SIZE||(accept&&!accept(dims)))continue;
          out.push({rowItems:rows,align,flip,...result,...dims,area:dims.width*dims.height});
        }
      }
    }
  }
  return out;
}
const byArea=(a,b)=>a.area-b.area||(a.flip!=='none')-(b.flip!=='none')||Math.max(a.width,a.height)-Math.max(b.width,b.height)||a.rows-b.rows||a.content.width*a.content.height-b.content.width*b.content.height;
const insideDrawer=(m,project)=>m.x>=-.001&&m.y>=-.001&&m.x+m.width<=num(project.width)+.001&&m.y+m.height<=num(project.height)+.001;
function placedTools(project){
  const inside=new Set(project.modules.filter(m=>insideDrawer(m,project)).map(m=>m.id));
  return new Set(project.tools.filter(tool=>inside.has(tool.moduleId)).map(tool=>tool.id));
}

/** Shared setup of addToolGroup/splitForBed. */
function begin(project,tools,opts,{forceLayout=null,maxModules=1}={}){
  if(!Array.isArray(tools)||!tools.length)throw i18nError('Sada neobsahuje žádné nástroje.');
  const next=copy(project);next.tools=next.tools||[];next.modules=next.modules||[];
  const ids=new Set(next.tools.map(t=>t.id));
  for(const tool of tools){if(!tool||typeof tool.id!=='string'||!tool.id||ids.has(tool.id))throw i18nError('Duplicitní identifikátor nástroje.');ids.add(tool.id);}
  const toolSet=opts.toolSet?{...opts.toolSet,layout:forceLayout||(opts.toolSet.layout??'shared')}:null;
  if(toolSet&&!['shared','uniform','auto'].includes(toolSet.layout))throw i18nError('Zvolte automatické, sjednocené nebo společné uspořádání sady.');
  const arrangement=opts.arrangement??toolSet?.arrangement??null,order=opts.order??toolSet?.order??'asc';
  if(arrangement!==null&&!['ordered','compact'].includes(arrangement))throw i18nError('Zvolte přehledné nebo úsporné uspořádání sady.');
  if(!['asc','desc'].includes(order))throw i18nError('Zvolte vzestupné nebo sestupné pořadí velikostí.');
  const logicalOrder=arrangement!==null||opts.order!=null||toolSet?.order!=null,regular=arrangement==='ordered';
  const preferences={...(arrangement!==null?{arrangement}:{}),...(logicalOrder?{order}:{})};
  const addedModules=['auto','uniform'].includes(toolSet?.layout)?tools.length:maxModules;
  if(next.tools.length+tools.length>3000||next.modules.length+addedModules>4000)throw i18nError('Projekt je příliš velký. Limit je 3000 nástrojů a 4000 modulů.');
  const name=String(opts.name||toolSet?.name||t('Sada nástrojů')).slice(0,100);
  let setId=null;
  if(toolSet){
    const setIds=new Set((next.toolSets||[]).map(s=>s.id)),base=String(toolSet.id||uid()).slice(0,90);
    setId=base;for(let i=2;setIds.has(setId);i++)setId=`${base}-${i}`;
  }
  const clearance=num(next.clearance,.8),wall=num(next.wall,2.4),grid=Math.max(1,num(next.grid,42)),padding=modulePadding(next);
  const separation=Math.max(wall,num(opts.separation,wall))+.05,gap=separation+CELL+.01;
  const usedModules=new Set(next.modules.map(m=>m.id));
  const allocate=base=>{base=String(base).slice(0,90);let id=base;for(let i=2;usedModules.has(id);i++)id=`${base}-${i}`;usedModules.add(id);return id;};
  const unit=['mm','in'].includes(opts.unit)?opts.unit:null;
  const W=num(next.width),H=num(next.height);
  const inDrawer=(w,h)=>w<=W+EPS&&h<=H+EPS;
  const size=content=>({width:Math.ceil((content.width+2*padding-EPS)/grid)*grid,height:Math.ceil((content.height+2*padding-EPS)/grid)*grid});
  const freeSpot=(width,height)=>{
    for(let y=0;y+height<=H+EPS;y+=grid)for(let x=0;x+width<=W+EPS;x+=grid){
      const r={x,y,width,height};
      if(!next.modules.some(m=>intersects(r,m)&&moduleIntersects(r,m,grid)))return{x,y};
    }
    return null;
  };
  // Park outside the drawer while keeping the persisted coordinates within the model's 4000 mm limit.
  // Once the parking area fills, parked modules may overlap each other; their tools must remain saveable.
  const park=(width,height)=>{
    const outside=next.modules.filter(m=>m.x+m.width>W+EPS||m.y+m.height>H+EPS);
    const x=Math.min(W+grid,4000-width),below=outside.length?Math.max(...outside.map(m=>m.y+m.height))+grid:0;
    const y=Math.min(Math.max(below,x<W?H+grid:0),4000-height);
    return{x,y};
  };
  // Drawer arrangement is independent of printer settings, including settings saved by older versions.
  const tryArrange=own=>{
    const before=placedTools(next),wanted=own.map(t=>t.id),ownModules=new Set(own.map(t=>t.moduleId));
    const arranged=autoArrange(next),candidate={...next,tools:arranged.tools,modules:arranged.modules},after=placedTools(candidate);
    if(![...before].every(id=>after.has(id))||!wanted.every(id=>after.has(id)))return null;
    if(checkManufacturing&&[...ownModules].some(id=>{const module=candidate.modules.find(m=>m.id===id);return !module||!candidateOk(module,candidate.tools.filter(t=>t.moduleId===id));}))return null;
    return candidate;
  };
  const register=toolIds=>{if(toolSet)next.toolSets=[...(next.toolSets||[]),{id:setId,name:String(toolSet.name||name).slice(0,100),toolIds,layout:toolSet.layout,...preferences}];};
  // Only geometric problems of the module itself count here (pocket depth is the editor's business).
  const geometryOk=(module,own)=>!validateLayout({...next,width:Math.max(module.width,W),height:Math.max(module.height,H),modules:[{...module,x:0,y:0}],tools:own.map(t=>({...t,x:t.x-module.x,y:t.y-module.y}))}).some(issue=>issue.type==='overlap'||issue.type==='outside');
  const meshCache=new Map(),checkManufacturing=(logicalOrder||next.sizeLabels===true)&&opts.checkManufacturing!==false;
  const candidateOk=(module,own)=>{
    if(!geometryOk(module,own))return false;
    if(!checkManufacturing)return true;
    // Validate only the candidate being considered. A local cache avoids exporting identical shelf/bbox
    // fallbacks twice. Geometry validation does not apply the export-only print-bed constraint.
    const local={...next,width:Math.max(42,module.width),height:Math.max(42,module.height),modules:[{...module,x:0,y:0}],tools:own.map(t=>({...t,x:t.x-module.x,y:t.y-module.y}))};
    const key=JSON.stringify([module.width,module.height,local.tools]);if(meshCache.has(key))return meshCache.get(key);
    let safe=true;
    try{for(const printMode of ['solid','light'])exportSTL({...local,printMode},{checkBed:false});}catch{safe=false;}
    meshCache.set(key,safe);return safe;
  };
  return{next,toolSet,setId,name,clearance,separation,gap,grid,padding,allocate,unit,W,H,inDrawer,size,freeSpot,park,tryArrange,register,geometryOk,candidateOk,arrangement,order,logicalOrder,regular,extra:setId?{setId}:{}};
}

/** Tools of a packing placed in `module`; content centred like resizeModule does. */
function buildTools(candidate,module){
  const dx=module.x+(module.width-candidate.content.width)/2-candidate.content.minX,dy=module.y+(module.height-candidate.content.height)/2-candidate.content.minY;
  return candidate.placed.map(({item,rotation,x,y})=>({...item.tool,moduleId:module.id,rotation,x:x+dx,y:y+dy}));
}
/** Check a bounded shortlist lazily, including manufacturing-safe conservative shelf fallbacks. */
function choose(candidates,ctx,makeModule,accept=null){
  if(!candidates?.length)throw i18nError('Model nelze bezpečně vytisknout. Zkuste nástroje rozdělit do samostatných modulů.');
  const valid=candidate=>{
    if(candidate.width>MAX_SIZE||candidate.height>MAX_SIZE||(accept&&!accept(candidate)))return false;
    const module=makeModule(candidate,0,0);
    return ctx.candidateOk(module,buildTools(candidate,module));
  };
  const rank=(a,b)=>ctx.inDrawer(b.width,b.height)-ctx.inDrawer(a.width,a.height)||byArea(a,b);
  const pool=[...candidates],conservative=[],safeGap=Math.max(ctx.gap,2*num(ctx.next.wall,2.4)+.2),headings=new Map();
  for(const best of candidates){
    const items=best.rowItems.flat(),heading=items[0]?.normal.rotation;if(!headings.has(heading))headings.set(heading,items);
    // Compact mode also considers the corresponding ordered shelves: turning tools is worthwhile
    // only when a safe nest actually uses less area than a safe common-heading arrangement.
    if(ctx.arrangement==='compact'&&best.flip==='none'){
      const shelf=layout(best.rowItems,{align:'left',exact:true,gap:ctx.gap,flip:'none',regular:true}),dims=ctx.size(shelf.content);
      pool.push({...best,...shelf,...dims,area:dims.width*dims.height,orderedFallback:true});
    }
    const shelf=layout(best.rowItems,{align:'left',exact:false,gap:safeGap,flip:'none',regular:true}),dims=ctx.size(shelf.content);
    conservative.push({...best,...shelf,...dims,area:dims.width*dims.height,flip:'none',orderedFallback:true});
  }
  // Equal-cell shelves are the conservative set-layout template. They avoid pinching small tools
  // into neck gaps and provide safe alternatives with different aspect ratios without mesh-searching
  // hundreds of nearly identical contour nests.
  for(const items of headings.values()){
    const maxW=Math.max(...items.map(item=>item.bounds.width)),maxH=Math.max(...items.map(item=>item.bounds.height));
    for(let columns=1;columns<=Math.min(items.length,12);columns++){
      const rows=Math.ceil(items.length/columns),cw=maxW+safeGap,ch=maxH+safeGap,content={minX:0,minY:0,maxX:columns*cw-safeGap,maxY:rows*ch-safeGap,width:columns*cw-safeGap,height:rows*ch-safeGap};
      const placed=items.map((item,i)=>({item,rotation:item.normal.rotation,x:i%columns*cw+(maxW-item.bounds.width)/2-item.bounds.minX,y:Math.floor(i/columns)*ch+maxH-item.bounds.height-item.bounds.minY})),dims=ctx.size(content);
      conservative.push({placed,content,rows,...dims,area:dims.width*dims.height,flip:'none',orderedFallback:true});
    }
  }
  const shortlist=(source,limit)=>{
    const seen=new Set(),out=[];
    for(const candidate of source.sort(rank)){
      if(candidate.width>MAX_SIZE||candidate.height>MAX_SIZE||(accept&&!accept(candidate)))continue;
      const key=[candidate.width,candidate.height,candidate.flip,candidate.rows,candidate.placed[0]?.rotation,!!candidate.orderedFallback].join('|');
      if(seen.has(key))continue;seen.add(key);out.push(candidate);if(out.length===limit)break;
    }
    return out;
  };
  // An off-drawer safe shelf must not win before a different conservative shelf that fits.
  for(const inside of [true,false]){
    const exact=shortlist(pool.filter(c=>ctx.inDrawer(c.width,c.height)===inside),6),safe=shortlist(conservative.filter(c=>ctx.inDrawer(c.width,c.height)===inside),6);
    for(const candidate of [...exact.slice(0,4),...safe.slice(0,3)].sort(rank))if(valid(candidate))return candidate;
    for(const candidate of [...exact.slice(4),...safe.slice(3)].sort(rank))if(valid(candidate))return candidate;
  }
  throw i18nError('Model nelze bezpečně vytisknout. Zkuste nástroje rozdělit do samostatných modulů.');
}

/** Pack tools tightly into ONE module and place it in the drawer. Explicit arrangements reject unprintable meshes atomically.
 *  Returns {project, moduleId, placed, reason, setId?, moduleIds? (uniform only)}:
 *   reason 'ok'     — placed in the drawer;
 *          'drawer' — no room in the drawer (module parked to the right of / below the drawer).
 *  Printer dimensions never affect editing; bed size is checked only by an explicit print export.
 *  opts: {name, unit, moduleId, alternate (default: true without toolSet) — allow 180° turned neighbours so heads interleave,
 *         arrangement:'ordered'|'compact', order:'asc'|'desc', toolSet:{name?, id?, layout:'shared'|'uniform'|'auto'}}.
 *  Explicit arrangement/order sort nominal sizes (mm/in) into monotonic row segments. 'ordered' uses common-heading
 *  bottom-aligned shelf rows; 'compact' may turn opposite rows by 180° when that saves actual module area.
 *  toolSet registers project.toolSets (see tool-sets.js): 'shared'/'auto' → one module {grouped, setId, setLayout:'shared', sizeMode:'auto'}
 *  with one common heading (set-layout.js coherence forbids opposite headings, so no 180° turns unless opts.alternate:true);
 *  'uniform' → one equal-sized module per tool. */
export function addToolGroup(project,tools,opts={}){
  const ctx=begin(project,tools,opts),{next,toolSet,setId,name,grid,allocate,unit,inDrawer,freeSpot,park,tryArrange,extra}=ctx;
  ctx.register(tools.map(tool=>tool.id));
  const source=ctx.logicalOrder?orderTools(copy(tools),ctx.order):copy(tools);
  const finish=(placed,more)=>({project:next,...more,placed,reason:placed?'ok':'drawer',...extra});

  if(['auto','uniform'].includes(toolSet?.layout)){
    // Equal footprints for every member and one common heading; the smaller cell fitting the drawer wins.
    const cells=[90,0].map(heading=>{
      const items=source.map((tool,index)=>prepareOne(tool,index,ctx,{heading}));
      const width=Math.ceil((Math.max(...items.map(i=>i.bounds.width))+2*ctx.padding-EPS)/grid)*grid,height=Math.ceil((Math.max(...items.map(i=>i.bounds.height))+2*ctx.padding-EPS)/grid)*grid;
      const sizes=items.map(item=>toolSet.layout==='uniform'?{width,height}:{width:Math.ceil((item.bounds.width+2*ctx.padding-EPS)/grid)*grid,height:Math.ceil((item.bounds.height+2*ctx.padding-EPS)/grid)*grid});
      return{items,width,height,sizes,area:sizes.reduce((sum,size)=>sum+size.width*size.height,0),inDrawer:sizes.every(size=>inDrawer(size.width,size.height))};
    }).sort((a,b)=>b.inDrawer-a.inDrawer||a.area-b.area);
    const cell=cells.find(cell=>cell.items.every((item,index)=>{
      const {width,height}=cell.sizes[index],module={id:'uniform-check',x:0,y:0,width,height},tool={...item.tool,moduleId:module.id,rotation:item.normal.rotation,x:(width-item.bounds.width)/2-item.bounds.minX,y:(height-item.bounds.height)/2-item.bounds.minY};
      return ctx.candidateOk(module,[tool]);
    }));
    if(!cell)throw i18nError('Model nelze bezpečně vytisknout. Zkuste nástroje rozdělit do samostatných modulů.');
    if(cell.sizes.some(size=>size.width>MAX_SIZE||size.height>MAX_SIZE))throw i18nError('Sada je pro jeden modul příliš velká (nejvýše {max} v každém směru).',{max:fmtLen(MAX_SIZE)});
    const base=opts.moduleId||`set-${tools[0].id}`,moduleIds=[],own=[];let all=true;
    for(const [index,item] of cell.items.entries()){
      const {width,height}=cell.sizes[index],spot=inDrawer(width,height)?freeSpot(width,height):null;if(!spot)all=false;
      const id=allocate(cell.items.length>1?`${base}-${item.index+1}`:base),position=spot||park(width,height);
      const module={id,name:String(item.tool.name||name).slice(0,100),...position,width,height,locked:false,sizeMode:'auto',setId,setLayout:toolSet.layout,...(unit?{unit}:{})};
      const tool={...item.tool,moduleId:id,rotation:item.normal.rotation,x:position.x+(width-item.bounds.width)/2-item.bounds.minX,y:position.y+(height-item.bounds.height)/2-item.bounds.minY};
      next.modules.push(module);next.tools.push(tool);own.push(tool);moduleIds.push(id);
    }
    if(all)return finish(true,{moduleId:moduleIds[0],moduleIds});
    const arranged=cell.inDrawer?tryArrange(own):null;
    if(arranged)Object.assign(next,{tools:arranged.tools,modules:arranged.modules});
    return finish(!!arranged,{moduleId:moduleIds[0],moduleIds});
  }

  // One shared module. A registered set uses one common heading (coherent for set-layout.js); a plain group may turn
  // every other row or tool by 180° so heads interleave with shanks.
  const lists=toolSet||ctx.logicalOrder?[90,0].map(heading=>source.map((tool,index)=>prepareOne(tool,index,ctx,{heading}))):[source.map((tool,index)=>prepareOne(tool,index,ctx))];
  const flips=ctx.regular?['none']:ctx.arrangement==='compact'?FLIPS:(opts.alternate??!toolSet)?FLIPS:['none'];
  const candidates=candidatesFor(lists,ctx,{limits:[ctx.W-2*ctx.padding],flips});
  if(!candidates.length)throw i18nError('Sada je pro jeden modul příliš velká (nejvýše {max} v každém směru).',{max:fmtLen(MAX_SIZE)});
  for(const c of candidates)c.inDrawer=inDrawer(c.width,c.height);
  candidates.sort((a,b)=>b.inDrawer-a.inDrawer||byArea(a,b));
  const moduleId=allocate(opts.moduleId||`set-${tools[0].id}`);
  const makeModule=(candidate,x,y)=>({id:moduleId,name,x,y,width:candidate.width,height:candidate.height,locked:false,sizeMode:setId?'auto':'manual',grouped:true,...(setId?{setId,setLayout:'shared'}:{}),...(unit?{unit}:{})});
  const best=choose(candidates,ctx,makeModule);
  const fits=inDrawer(best.width,best.height),spot=fits?freeSpot(best.width,best.height):null;
  const position=spot||park(best.width,best.height),module=makeModule(best,position.x,position.y),own=buildTools(best,module);
  next.modules.push(module);next.tools.push(...own);
  if(spot)return finish(true,{moduleId});
  const arranged=fits?tryArrange(own):null;
  if(arranged)Object.assign(next,{tools:arranged.tools,modules:arranged.modules});
  return finish(!!arranged,{moduleId});
}

/** Bed-sized module limits in grid steps: module size − 0.5 mm must fit the bed, either way round (as geometry.js checks it). */
function bedLimits(project,grid){
  const bw=num(project.bedWidth,220),bh=num(project.bedHeight,220);
  return{a:Math.floor((bw+.5+EPS)/grid)*grid,b:Math.floor((bh+.5+EPS)/grid)*grid};
}

/** Pack a set into as few grouped modules as possible, each printable on the bed (bedWidth × bedHeight, used even when
 *  limitToBed is off), and place them in the drawer. A tool too long for a bed-sized module in line may be turned
 *  diagonally (opts.diagonal, default true; the module itself stays axis aligned). Tools that cannot fit the bed at all
 *  are returned in `oversize`: with opts.oversize 'module' (default) they share one extra (over-bed) module,
 *  with 'skip' they are not added to the project at all.
 *  opts: {name, unit, moduleId, arrangement:'ordered'|'compact', order:'asc'|'desc', alternate (default true),
 *         diagonal (default true), oversize:'module'|'skip', toolSet:{name?, id?}}.
 *  toolSet registers ONE project.toolSets entry {layout:'shared'} with every added tool. Modules are rigid groups
 *  {grouped:true, sizeMode:'manual'} named "name k/n", without setId/setLayout (those describe one complete shared module).
 *  Returns {project, moduleIds, moduleId (= moduleIds[0] or null), placed (every new module in the drawer),
 *           reason 'ok' | 'bed' (an oversize module was added) | 'drawer' (not all modules found room),
 *           oversize:[toolId], diagonal:[toolId], setId?}. */
export function splitForBed(project,tools,opts={}){
  const ctx=begin(project,tools,opts,{forceLayout:'shared'}),{next,name,grid,padding,allocate,unit,inDrawer,freeSpot,park,tryArrange,extra}=ctx;
  const {a:maxA,b:maxB}=bedLimits(next,grid),onBed=d=>(d.width<=maxA+EPS&&d.height<=maxB+EPS)||(d.width<=maxB+EPS&&d.height<=maxA+EPS);
  const limits=[maxA-2*padding,maxB-2*padding],source=ctx.logicalOrder?orderTools(copy(tools),ctx.order):copy(tools),flips=ctx.regular?['none']:ctx.arrangement==='compact'?FLIPS:(opts.alternate??true)?FLIPS:['none'];
  const heads=new Map(source.map((tool,index)=>{let list;try{list=[0,90].map(heading=>prepareOne(tool,index,ctx,{heading}));}catch{list=[prepareOne(tool,index,ctx)];}return[tool.id,list];}));
  const pack=(members,accept=onBed)=>{
    const count=Math.max(...members.map(t=>heads.get(t.id).length));
    const lists=Array.from({length:count},(_,h)=>members.map(t=>{const list=heads.get(t.id);return list[Math.min(h,list.length-1)];}));
    const found=candidatesFor(lists,ctx,{accept,limits,flips});
    return found.length?found.sort(byArea):null;
  };
  // A tool that does not fit a bed module in line: smallest diagonal turn that does.
  const diagonal=[],oversize=[],fit=[];
  for(const tool of source){
    if(pack([tool])){fit.push(tool);continue;}
    let turned=false;
    if(opts.diagonal!==false){
      const base=heads.get(tool.id)[0].normal.rotation;let outline=null,bestTurn=null;
      try{outline=pocketOutline({...tool,x:0,y:0,rotation:base},ctx.clearance);}catch{}
      for(let a=1;outline&&a<180;a++){
        if(a===90)continue;
        const r=a*Math.PI/180,c=Math.cos(r),s=Math.sin(r),d=ctx.size(box(outline.map(p=>({x:p.x*c-p.y*s,y:p.x*s+p.y*c}))));
        if(onBed(d)&&(!bestTurn||d.width*d.height<bestTurn.area))bestTurn={a,area:d.width*d.height};
      }
      if(bestTurn){const item=prepareOne(tool,heads.get(tool.id)[0].index,ctx,{rotation:base+bestTurn.a});if(onBed(ctx.size(item.bounds))){heads.set(tool.id,[item]);turned=true;}}
    }
    if(turned){diagonal.push(tool.id);fit.push(tool);}else oversize.push(tool.id);
  }
  // Modules are filled one at a time: the largest remaining pocket that still finds room opens a module, then every
  // further pocket that keeps it on the bed and in a free spot of the drawer joins it (largest first).
  const area=tool=>{const b=heads.get(tool.id)[0].bounds;return b.width*b.height;};
  let remaining=ctx.logicalOrder?[...fit]:[...fit].sort((a,b)=>area(b)-area(a)||a.id.localeCompare(b.id)),drawerFull=false;
  const spotFor=c=>inDrawer(c.width,c.height)?freeSpot(c.width,c.height):null,created=[],own=[];let all=true;
  const add=(members,found,accept)=>{
    const module={id:`\u0000split-${created.length}`,name,x:0,y:0,width:0,height:0,locked:false,sizeMode:'manual',grouped:true,...(unit?{unit}:{})};
    const makeModule=(candidate,x,y)=>({...module,x,y,width:candidate.width,height:candidate.height});
    const best=choose(found,ctx,makeModule,accept),spot=spotFor(best);if(!spot)all=false;
    Object.assign(module,makeModule(best,...Object.values(spot||park(best.width,best.height))));
    const placed=buildTools(best,module);next.modules.push(module);next.tools.push(...placed);own.push(...placed);created.push({module,tools:placed});
  };
  while(remaining.length){
    const rooms=new Map(),room=d=>{const key=`${d.width}x${d.height}`;if(!rooms.has(key))rooms.set(key,!!spotFor(d));return rooms.get(key);};
    const accept=d=>onBed(d)&&(drawerFull||room(d));
    let members=null,found=null;
    for(const tool of remaining){const f=pack([tool],accept);if(f){members=[tool];found=f;break;}}
    if(!members){if(drawerFull)break;drawerFull=true;continue;}
    for(const tool of remaining){if(members.includes(tool))continue;const f=pack([...members,tool],accept);if(f){members.push(tool);found=f;}else if(ctx.logicalOrder)break;}
    // A 2D nest can fit the bed yet have no printable mesh. Keep the next nominal sizes for the
    // following module rather than committing that nest or failing a whole otherwise printable set.
    for(;;){
      try{add(members,found,onBed);break;}
      catch(error){
        if(error.i18n?.cs!=='Model nelze bezpečně vytisknout. Zkuste nástroje rozdělit do samostatných modulů.'||members.length===1)throw error;
        members=members.slice(0,-1);found=pack(members,accept);
      }
    }
    remaining=remaining.filter(tool=>!members.includes(tool));
  }
  const skip=opts.oversize==='skip',added=source.filter(tool=>!skip||!oversize.includes(tool.id));
  if(added.length)ctx.register(added.map(tool=>tool.id));
  if(oversize.length&&!skip){
    const members=source.filter(tool=>oversize.includes(tool.id)),fitsDrawer=c=>inDrawer(c.width,c.height)&&!!spotFor(c);
    add(members,candidatesFor([members.map(t=>heads.get(t.id)[0])],ctx,{limits:[ctx.W-2*padding,ctx.H-2*padding],flips}).sort((a,b)=>fitsDrawer(b)-fitsDrawer(a)||byArea(a,b)),null);
  }
  if(next.modules.length>4000)throw i18nError('Projekt je příliš velký. Limit je 3000 nástrojů a 4000 modulů.');
  if(ctx.logicalOrder)created.sort((a,b)=>compareToolSize(orderTools(a.tools,ctx.order)[0],orderTools(b.tools,ctx.order)[0],ctx.order));
  const base=String(opts.moduleId||`set-${tools[0].id}`),moduleIds=[];
  for(const [k,{module,tools:members}] of created.entries()){
    module.id=allocate(created.length>1?`${base}-${k+1}`:base);module.name=created.length>1?`${name.slice(0,90)} ${k+1}/${created.length}`:name;
    for(const tool of members)tool.moduleId=module.id;
    moduleIds.push(module.id);
  }
  let placed=all;
  if(!all&&own.length){const arranged=tryArrange(own);if(arranged){Object.assign(next,{tools:arranged.tools,modules:arranged.modules});placed=true;}}
  return{project:next,moduleIds,moduleId:moduleIds[0]??null,placed,reason:!placed?'drawer':oversize.length&&!skip?'bed':'ok',oversize,diagonal,...extra};
}
