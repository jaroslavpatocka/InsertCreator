import Clipper from './vendor/clipper.js';
import {pocketOutline} from './finger-grip.js';
import {i18nError} from './i18n.js';

const SCALE=10000,EPS=1e-7,MAX_CELLS=4096;
const key=(x,y)=>`${x},${y}`;
const directions=[[1,0],[0,1],[-1,0],[0,-1]];
const area=poly=>poly.reduce((sum,p,i)=>{const q=poly[(i+1)%poly.length];return sum+p.x*q.y-q.x*p.y;},0)/2;
const rectangle=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const invalid=()=>i18nError('Schodový modul musí tvořit souvislé buňky rastru bez otvorů.');
const toInt=paths=>paths.map(poly=>poly.map(p=>({X:Math.round(p.x*SCALE),Y:Math.round(p.y*SCALE)})));
const fromInt=paths=>paths.map(poly=>poly.map(p=>({x:p.X/SCALE,y:p.Y/SCALE})));
function boolean(subject,clip=[],operation=Clipper.ClipType.ctIntersection){
  if(!subject.length)return[];
  const engine=new Clipper.Clipper(),result=[];
  engine.AddPaths(toInt(subject),Clipper.PolyType.ptSubject,true);
  if(clip.length)engine.AddPaths(toInt(clip),Clipper.PolyType.ptClip,true);
  engine.Execute(operation,result,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero);
  return fromInt(result);
}
function offset(poly,distance){
  if(Math.abs(distance)<EPS)return[poly];
  const path=toInt([poly])[0];if(!Clipper.Clipper.Orientation(path))path.reverse();
  const engine=new Clipper.ClipperOffset(2,.015*SCALE),result=[];
  engine.AddPath(path,Clipper.JoinType.jtMiter,Clipper.EndType.etClosedPolygon);engine.Execute(result,distance*SCALE);
  return fromInt(result);
}
function dimensions(module,grid){
  if(typeof grid!=='number'||!Number.isFinite(grid)||grid<=0)throw invalid();
  const width=Number(module?.width),height=Number(module?.height);
  if(!(width>0&&height>0&&Number.isFinite(width)&&Number.isFinite(height)))throw invalid();
  return{width,height};
}
function boundary(cells){
  const occupied=new Set(cells.map(c=>key(c.x,c.y))),edges=new Map();
  const add=(x,y,nx,ny)=>{const start=key(x,y);if(edges.has(start))throw invalid();edges.set(start,{x:nx,y:ny});};
  for(const {x,y} of cells){
    if(!occupied.has(key(x,y-1)))add(x,y,x+1,y);
    if(!occupied.has(key(x+1,y)))add(x+1,y,x+1,y+1);
    if(!occupied.has(key(x,y+1)))add(x+1,y+1,x,y+1);
    if(!occupied.has(key(x-1,y)))add(x,y+1,x,y);
  }
  const first=edges.keys().next().value,visited=new Set(),points=[];let cursor=first;
  while(!visited.has(cursor)){
    const next=edges.get(cursor);if(!next)throw invalid();visited.add(cursor);
    const [x,y]=cursor.split(',').map(Number);points.push({x,y});cursor=key(next.x,next.y);
  }
  if(cursor!==first||visited.size!==edges.size)throw invalid();
  return points.filter((p,i,all)=>{const a=all[(i+all.length-1)%all.length],b=all[(i+1)%all.length];return(a.x-p.x)*(b.y-p.y)!==(a.y-p.y)*(b.x-p.x);});
}

/** Model fields only. Legacy rectangular modules remain rectangles without allocating cells. */
// Depth a joint socket takes from the module edge, so that it keeps clear of the wall around every pocket.
export const JOINT_RESERVE=11;
/** Free margin between a module edge and its tools. With joints switched on it also leaves room for a socket on every side. */
export function modulePadding(project,edge=.25){
  const wall=Number(project.wall),base=(Number.isFinite(wall)?wall:2.4)+edge;
  const extraClearance=Math.max(0,(Number(project.jointClearance??.2)||0)-.2);
  return project.connectors===true&&project.bottomMode!=='grid'?base+JOINT_RESERVE+extraClearance:base;
}

export function validateModuleFootprint(module,grid=42){
  const {width,height}=dimensions(module,grid);
  if(!Object.hasOwn(module,'cells')&&module.shape!=='stepped'){
    if(module.shape!=null&&module.shape!=='rectangular')throw invalid();return{};
  }
  if(module.shape!=null&&module.shape!=='stepped')throw invalid();
  if(!Array.isArray(module.cells)||!module.cells.length||module.cells.length>MAX_CELLS)throw invalid();
  const cells=module.cells.map(c=>{
    if(!c||typeof c.x!=='number'||typeof c.y!=='number'||!Number.isSafeInteger(c.x)||!Number.isSafeInteger(c.y)||c.x<0||c.y<0)throw invalid();
    return{x:c.x,y:c.y};
  }).sort((a,b)=>a.y-b.y||a.x-b.x);
  const occupied=new Set(cells.map(c=>key(c.x,c.y))),cols=Math.round(width/grid),rows=Math.round(height/grid);
  if(occupied.size!==cells.length||Math.abs(cols*grid-width)>EPS||Math.abs(rows*grid-height)>EPS||Math.min(...cells.map(c=>c.x))!==0||Math.min(...cells.map(c=>c.y))!==0||Math.max(...cells.map(c=>c.x))!==cols-1||Math.max(...cells.map(c=>c.y))!==rows-1)throw invalid();
  for(const value of [module.x??0,module.y??0])if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value/grid-Math.round(value/grid))>EPS)throw invalid();
  const reached=new Set([key(cells[0].x,cells[0].y)]),pending=[cells[0]];
  for(let i=0;i<pending.length;i++)for(const [dx,dy] of directions){const x=pending[i].x+dx,y=pending[i].y+dy,k=key(x,y);if(occupied.has(k)&&!reached.has(k)){reached.add(k);pending.push({x,y});}}
  if(reached.size!==cells.length)throw invalid();boundary(cells);
  return{shape:'stepped',cells};
}

/** One real material boundary, in local or world millimetres. Positive inset shrinks every edge. */
export function moduleOutline(module,grid=42,{world=true,inset=0}={}){
  const fields=validateModuleFootprint(module,grid),{width,height}=dimensions(module,grid);
  if(typeof inset!=='number'||!Number.isFinite(inset)||inset<0)throw invalid();
  const local=fields.cells?boundary(fields.cells).map(p=>({x:p.x*grid,y:p.y*grid})):rectangle(0,0,width,height);
  const shrunk=offset(local,-inset);if(shrunk.length!==1||Math.abs(area(shrunk[0]))<EPS)throw invalid();
  const x=world?Number(module.x??0):0,y=world?Number(module.y??0):0;
  if(!Number.isFinite(x)||!Number.isFinite(y))throw invalid();
  return shrunk[0].map(p=>({x:p.x+x,y:p.y+y}));
}
export const localModuleOutline=(module,grid=42,options={})=>moduleOutline(module,grid,{...options,world:false});
export const worldModuleOutline=(module,grid=42,options={})=>moduleOutline(module,grid,{...options,world:true});
export function moduleArea(module,grid=42){const fields=validateModuleFootprint(module,grid);return fields.cells?fields.cells.length*grid*grid:Number(module.width)*Number(module.height);}
export function moduleIntersects(a,b,grid=42,{gap=0}={}){
  if(typeof gap!=='number'||!Number.isFinite(gap)||gap<0)throw invalid();
  if(a.x+a.width+gap<=b.x+EPS||b.x+b.width+gap<=a.x+EPS||a.y+a.height+gap<=b.y+EPS||b.y+b.height+gap<=a.y+EPS)return false;
  if(!a.cells&&!b.cells)return true;
  const grown=offset(moduleOutline(a,grid),gap);
  return boolean(grown,[moduleOutline(b,grid)]).some(poly=>Math.abs(area(poly))>EPS);
}
export function containsPocketWalls(module,pocket,wall=0,grid=42,{inset=.25}={}){
  if(!Array.isArray(pocket)||pocket.length<3||pocket.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))||!Number.isFinite(wall)||wall<0||!Number.isFinite(inset)||inset<0)return false;
  const grown=offset(pocket,wall+inset);
  return grown.length>0&&!boolean(grown,[moduleOutline(module,grid)],Clipper.ClipType.ctDifference).some(poly=>Math.abs(area(poly))>EPS);
}

/** Conservative raster hull of real pockets. Only empty right/bottom strips may be removed. */
export function steppedModuleFootprint(project,module){
  const next=JSON.parse(JSON.stringify(module));delete next.cells;delete next.shape;
  const grid=Number(project.grid??42),cols=Math.round(next.width/grid),rows=Math.round(next.height/grid);
  if(!(grid>0&&cols>0&&rows>0)||cols*rows>MAX_CELLS||Math.abs(cols*grid-next.width)>EPS||Math.abs(rows*grid-next.height)>EPS||[next.x,next.y].some(value=>!Number.isFinite(value)||Math.abs(value/grid-Math.round(value/grid))>EPS))return next;
  const own=(project.tools||[]).filter(tool=>tool.moduleId===module.id);if(!own.length)return next;
  try{
    const wall=Number(project.wall??2.4),clearance=Number(project.clearance??.8),pockets=own.map(tool=>tool.poly||pocketOutline(tool,clearance));
    if(pockets.some(poly=>!containsPocketWalls(next,poly,wall,grid)))return next;
    const grown=pockets.flatMap(poly=>offset(poly,modulePadding(project))),occupied=new Set();
    // Rasterize each small pocket only over its own bounding cells. A large set must not
    // run a Boolean operation containing every outline for every empty module cell.
    for(const poly of grown){
      const minX=Math.max(0,Math.floor((Math.min(...poly.map(p=>p.x))-next.x)/grid)),minY=Math.max(0,Math.floor((Math.min(...poly.map(p=>p.y))-next.y)/grid));
      const maxX=Math.min(cols-1,Math.ceil((Math.max(...poly.map(p=>p.x))-next.x)/grid)-1),maxY=Math.min(rows-1,Math.ceil((Math.max(...poly.map(p=>p.y))-next.y)/grid)-1);
      for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++)if(!occupied.has(key(x,y))&&boolean([poly],[rectangle(next.x+x*grid,next.y+y*grid,grid,grid)]).some(path=>Math.abs(area(path))>EPS))occupied.add(key(x,y));
    }
    if(!occupied.size)return next;
    const read=k=>{const [x,y]=k.split(',').map(Number);return{x,y};};
    // Retaining the original origin also retains every local tool position.
    let first=[...occupied].map(read).sort((a,b)=>a.x-b.x||a.y-b.y)[0];for(let x=0;x<first.x;x++)occupied.add(key(x,first.y));
    first=[...occupied].map(read).sort((a,b)=>a.y-b.y||a.x-b.x)[0];for(let y=0;y<first.y;y++)occupied.add(key(first.x,y));
    const flood=()=>{const start=read(occupied.values().next().value),found=new Set([key(start.x,start.y)]),queue=[start];for(let i=0;i<queue.length;i++)for(const [dx,dy] of directions){const x=queue[i].x+dx,y=queue[i].y+dy,k=key(x,y);if(occupied.has(k)&&!found.has(k)){found.add(k);queue.push({x,y});}}return found;};
    let connected=flood();
    while(connected.size<occupied.size){
      const queue=[...connected].map(read),parents=new Map(queue.map(p=>[key(p.x,p.y),null]));let target=null;
      for(let i=0;i<queue.length&&!target;i++)for(const [dx,dy] of directions){const x=queue[i].x+dx,y=queue[i].y+dy,k=key(x,y);if(x<0||y<0||x>=cols||y>=rows||parents.has(k))continue;parents.set(k,key(queue[i].x,queue[i].y));queue.push({x,y});if(occupied.has(k)&&!connected.has(k)){target=k;break;}}
      if(!target)return next;for(let cursor=target;cursor!==null;cursor=parents.get(cursor))occupied.add(cursor);connected=flood();
    }
    const cells=[...occupied].map(read),maxX=Math.max(...cells.map(p=>p.x)),maxY=Math.max(...cells.map(p=>p.y)),outside=new Set(),queue=[];
    const enqueue=(x,y)=>{const k=key(x,y);if(x<0||y<0||x>maxX||y>maxY||occupied.has(k)||outside.has(k))return;outside.add(k);queue.push({x,y});};
    for(let x=0;x<=maxX;x++){enqueue(x,0);enqueue(x,maxY);}for(let y=0;y<=maxY;y++){enqueue(0,y);enqueue(maxX,y);}
    for(let i=0;i<queue.length;i++)for(const [dx,dy] of directions)enqueue(queue[i].x+dx,queue[i].y+dy);
    for(let y=0;y<=maxY;y++)for(let x=0;x<=maxX;x++)if(!outside.has(key(x,y)))occupied.add(key(x,y));
    const candidate={...next,width:(maxX+1)*grid,height:(maxY+1)*grid,shape:'stepped',cells:[...occupied].map(read)};
    const fields=validateModuleFootprint(candidate,grid);candidate.cells=fields.cells;
    if(pockets.some(poly=>!containsPocketWalls(candidate,poly,wall,grid)))return next;
    if(candidate.cells.length===(maxX+1)*(maxY+1)){delete candidate.cells;delete candidate.shape;}
    return candidate;
  }catch{return next;}
}
