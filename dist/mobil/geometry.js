import {moduleOutline,modulePadding} from './module-footprint.js';
import Clipper from './vendor/clipper.js';
import {buildColorZones,buildPrintTriangles,encodeSTL,trianglesVolume,printConfig,validatePrintBed,validatePrintMesh} from './print-geometry.js';
import {materialConfig,pocketHeightLimits} from './print-material.js';
import {hasPocketMagnets,pocketMagnetHoles,pocketMagnetProblem} from './tool-magnet.js';
import {layoutMeshToPhysical} from './manufacturing-coordinates.js';
import {pocketOutline} from './finger-grip.js';
import {effectivePocketMargin} from './pocket-margin.js';
import {releaseSoloMargins,restoreSoloMargins} from './module-margin.js';
export {pocketOutline} from './finger-grip.js';
import {t as tr,i18nError} from './i18n.js';
import {fmtLen} from './units.js';
import {orderTools} from './tool-size.js';
import {moduleIntersects,containsPocketWalls,validateModuleFootprint,fillFreeCells,steppedModuleFootprint} from './module-footprint.js';

const EPS = 1e-7;
const copy = value => JSON.parse(JSON.stringify(value));
const n = (value, fallback = 0) => Number.isFinite(+value) ? +value : fallback;
const area = points => points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0) / 2;
const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const close = (a,b) => Math.hypot(a.x-b.x,a.y-b.y)<EPS;
// Layout issues keep the Czech source + params so the UI can re-translate them later (errorText).
const issue = (type,ids,cs,params) => ({type,ids,message:tr(cs,params),i18n:{cs,params}});
const issueError = item => Object.assign(Error(item.message),{i18n:item.i18n});
function clean(points) {
  let result = points.map(p => ({x:n(p.x),y:n(p.y)})).filter((p,i,a) => !i || !close(p,a[i-1]));
  if (result.length > 2 && close(result[0],result.at(-1))) result.pop();
  let changed = true;
  while (changed && result.length > 3) {
    changed = false;
    result = result.filter((p,i,a) => { const before=a[(i+a.length-1)%a.length],after=a[(i+1)%a.length],forward=(p.x-before.x)*(after.x-p.x)+(p.y-before.y)*(after.y-p.y); const keep = Math.abs(cross(before,p,after))>EPS||forward<0; if (!keep) changed=true; return keep; });
  }
  return result;
}
function box(points) {
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  const x=Math.min(...xs),y=Math.min(...ys),maxX=Math.max(...xs),maxY=Math.max(...ys);
  return {x,y,minX:x,minY:y,maxX,maxY,width:maxX-x,height:maxY-y};
}
function offsetPolygon(points, distance) {
  if (!distance) return points;
  // Integer clipping joins opposing edges safely when a narrow concavity closes.
  // 1 coordinate unit = 0.0001mm; round corners preserve a true minimum clearance.
  const scale=10000,path=points.map(p=>({X:Math.round(p.x*scale),Y:Math.round(p.y*scale)}));
  const offset=new Clipper.ClipperOffset(2,.015*scale),result=[];
  if(!Clipper.Clipper.Orientation(path))path.reverse();
  offset.AddPath(path,Clipper.JoinType.jtRound,Clipper.EndType.etClosedPolygon);
  offset.Execute(result,distance*scale);
  if(!result.length)return [];
  result.sort((a,b)=>Math.abs(Clipper.Clipper.Area(b))-Math.abs(Clipper.Clipper.Area(a)));
  return clean(result[0].map(p=>({x:p.X/scale,y:p.Y/scale})));
}

/** Rotations are normalized to the top-left of the rotated contour, then x/y are applied. */
export function transformedPoints(tool, clearance=0) {
  const points=clean(tool.points || []);
  if(points.length<3) return [];
  const raw=box(points),r=n(tool.rotation)*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  const rotated=points.map(p=>({x:(p.x-raw.x)*c-(p.y-raw.y)*s,y:(p.x-raw.x)*s+(p.y-raw.y)*c}));
  const b=box(rotated);
  return offsetPolygon(rotated.map(p=>({x:p.x-b.x+n(tool.x),y:p.y-b.y+n(tool.y)})),n(clearance));
}
export function bounds(tool) {
  const p=transformedPoints(tool);
  return p.length ? box(p) : {x:n(tool.x),y:n(tool.y),minX:n(tool.x),minY:n(tool.y),maxX:n(tool.x),maxY:n(tool.y),width:0,height:0};
}
const intersectsRect=(a,b,epsilon=EPS)=>a.x<b.x+b.width-epsilon&&a.x+a.width>b.x+epsilon&&a.y<b.y+b.height-epsilon&&a.y+a.height>b.y+epsilon;
const intersectsModules=(a,b,grid,epsilon=.001)=>intersectsRect(a,b,epsilon)&&((a.cells||b.cells)?moduleIntersects(a,b,grid):true);
function pointInside(p,poly) {
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const a=poly[i],b=poly[j];
    if(Math.abs(cross(a,b,p))<EPS && p.x>=Math.min(a.x,b.x)-EPS && p.x<=Math.max(a.x,b.x)+EPS && p.y>=Math.min(a.y,b.y)-EPS && p.y<=Math.max(a.y,b.y)+EPS) return true;
    if((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}
function polygonsOverlap(a,b) {
  // A shared edge or vertex also makes separate pocket meshes invalid.
  if(!a.length||!b.length||!intersectsRect(box(a),box(b),-EPS))return false;
  for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){
    const p=a[i],q=a[(i+1)%a.length],r=b[j],s=b[(j+1)%b.length];
    if(cross(p,q,r)*cross(p,q,s)<-EPS && cross(r,s,p)*cross(r,s,q)<-EPS)return true;
  }
  return a.some(p=>pointInside(p,b))||b.some(p=>pointInside(p,a));
}
function pointSegmentDistanceSquared(p,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
  return (p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2;
}
function polygonsTooClose(a,b,distance) {
  if(distance<=0||!a.length||!b.length||!intersectsRect(box(a),box(b),-distance))return false;
  const limit=distance*distance;
  for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){
    const p=a[i],q=a[(i+1)%a.length],r=b[j],s=b[(j+1)%b.length];
    if(pointSegmentDistanceSquared(p,r,s)<limit||pointSegmentDistanceSquared(r,p,q)<limit)return true;
  }
  return false;
}
function selfIntersects(p) {
  const on=(a,b,c)=>Math.abs(cross(a,b,c))<EPS&&c.x>=Math.min(a.x,b.x)-EPS&&c.x<=Math.max(a.x,b.x)+EPS&&c.y>=Math.min(a.y,b.y)-EPS&&c.y<=Math.max(a.y,b.y)+EPS;
  for(let i=0;i<p.length;i++)for(let j=i+2;j<p.length;j++){
    if(i===0&&j===p.length-1)continue;
    const a=p[i],b=p[(i+1)%p.length],c=p[j],d=p[(j+1)%p.length];
    if((cross(a,b,c)*cross(a,b,d)<-EPS&&cross(c,d,a)*cross(c,d,b)<-EPS)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))return true;
  }
  return false;
}

/** Resize the nominal footprint without scaling or rotating any tool contour. */
export function resizeModule(project,moduleId,{width,height,mode='manual'}={}) {
  if(!['manual','auto'].includes(mode))throw i18nError('Zvolte ruční nebo automatickou velikost modulu.');
  const next=copy(project),module=(next.modules||[]).find(m=>m.id===moduleId);
  if(!module)throw i18nError('Vybraný modul neexistuje.');
  const tools=(next.tools||[]).filter(t=>t.moduleId===moduleId);
  const points=tools.flatMap(t=>pocketOutline(t,next)),content=points.length?box(points):null;
  if(mode==='auto'){
    if(!tools.length)throw i18nError('Automatickou velikost prázdného modulu nelze určit. Zadejte jeho rozměry.');
    if(!content)throw i18nError('Nástroj nemá platnou konturu pro určení velikosti modulu.');
    const grid=n(next.grid,42),padding=modulePadding(next);
    if(grid<=0)throw i18nError('Rastr modulů musí být kladný.');
    width=Math.ceil((content.width+2*padding-EPS)/grid)*grid;
    height=Math.ceil((content.height+2*padding-EPS)/grid)*grid;
  }
  width=Number(width);height=Number(height);
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<5||height<5||width>3000||height>3000)throw i18nError('Rozměry modulu musí být od {min} do {max}.',{min:fmtLen(5),max:fmtLen(3000)});
  module.width=width;module.height=height;module.sizeMode=mode;
  // Explicit box resizing defines a rectangular container; old cell indices no
  // longer describe it, and centering tools must not retain an obsolete notch.
  delete module.shape;delete module.cells;
  if(content){
    const dx=module.x+(width-content.width)/2-content.x,dy=module.y+(height-content.height)/2-content.y;
    for(const tool of tools){tool.x=n(tool.x)+dx;tool.y=n(tool.y)+dy;}
  }
  const problem=validateLayout({...next,modules:[module],tools})[0];
  if(problem)throw issueError(problem);
  const collision=next.modules.find(m=>m.id!==moduleId&&intersectsModules(module,m,n(next.grid,42)));
  if(collision)throw i18nError('Modul „{name}“ by se překrýval s modulem „{other}“.',{name:module.name||module.id,other:collision.name||collision.id});
  if(next.bottomMode==='grid'){
    if(Math.abs(n(next.grid,42)-42)>.001)throw i18nError('Gridfinity patky vyžadují rastr přesně 42 mm.');
    if([module.x,module.y,width,height].some(value=>Math.abs(value/42-Math.round(value/42))>.0001))throw i18nError('Rozměry i poloha modulu musí být v násobcích 42 mm pro Gridfinity patky.');
  }
  return next;
}

/** Tighten occupied modules without changing their contours or relative tool placement.
 * Manual sizes are considered only when explicitly requested; every result is shrink-only.
 * Explicit uniform set cells, locks and empty filler modules remain user constraints. */
export function refitModules(project,{includeManual=false,moduleIds=null}={}) {
  const next=copy(project),resizedModules=[],selected=moduleIds===null?null:new Set(moduleIds);
  const grid=n(next.grid,42),padding=modulePadding(next);
  if(!(grid>0&&padding>.25))return{project:next,resizedModules};
  for(const module of next.modules||[]){
    const own=(next.tools||[]).filter(tool=>tool.moduleId===module.id);
    if(selected&&!selected.has(module.id)||module.locked||module.pocketMargin!=null||!own.length||own.some(tool=>tool.locked)||module.cells||module.sizeMode==='manual'&&!includeManual)continue;
    if(module.sizeMode==='manual'&&[module.x,module.y,module.width,module.height].some(value=>Math.abs(value/grid-Math.round(value/grid))>.0001))continue;
    if(module.setLayout==='uniform'&&(next.toolSets||[]).some(set=>set.layout==='uniform'&&(set.id===module.setId||own.some(tool=>set.toolIds?.includes(tool.id)))))continue;
    let content;try{content=box(own.flatMap(tool=>pocketOutline(tool,next)));}catch{continue;}
    const width=Math.ceil((content.width+2*padding-EPS)/grid)*grid,height=Math.ceil((content.height+2*padding-EPS)/grid)*grid;
    if(![width,height].every(value=>Number.isFinite(value)&&value>=5&&value<=3000)||width>module.width+EPS||height>module.height+EPS||width>=module.width-EPS&&height>=module.height-EPS)continue;
    const dx=module.x+(width-content.width)/2-content.x,dy=module.y+(height-content.height)/2-content.y;
    const fitted={...module,x:0,y:0,width,height},moved=own.map(tool=>({...tool,x:n(tool.x)+dx-module.x,y:n(tool.y)+dy-module.y}));
    if(validateLayout({...next,width,height,modules:[fitted],tools:moved}).length)continue;
    resizedModules.push({id:module.id,name:module.name||module.id,before:{width:module.width,height:module.height},after:{width,height}});
    module.width=width;module.height=height;
    for(const tool of own){tool.x=n(tool.x)+dx;tool.y=n(tool.y)+dy;}
  }
  return{project:next,resizedModules};
}

export function minimizeAutoModules(project){return refitModules(project);}

/** Deterministic grid packing. Locked modules and every tool inside them stay in place. */
export function autoArrange(project,options) {
  const {project:source,released}=releaseSoloMargins(project);
  return restoreSoloMargins(packModules(source,options),released);
}

function packModules(project,{preserveLocked=true,moduleShape}={}) {
  const minimized=minimizeAutoModules(project).project;
  const tools=copy(minimized.tools||[]),oldModules=copy(minimized.modules||[]),grid=Math.max(1,n(project.grid,42));
  // Rebuilt modules keep their own display unit (module.unit) by id.
  const unitOf=id=>{const u=oldModules.find(m=>m.id===id)?.unit;return u?{unit:u}:{};};
  const marginOf=id=>{const value=oldModules.find(m=>m.id===id)?.pocketMargin;return value==null?{}:{pocketMargin:value};};
  const footprints=new Map(),invalid=new Set(),unplaced=[];
  const markUnplaced=id=>{if(!unplaced.includes(id))unplaced.push(id);};
  for(const tool of tools){
    try{const poly=pocketOutline(tool,minimized);if(poly.length<3)throw new Error('Prázdná kapsa.');footprints.set(tool.id,box(poly));}
    catch{invalid.add(tool.id);markUnplaced(tool.id);}
  }
  // Fillers are explicit user-created parts, so packing must never discard them.
  const lockedIds=new Set(oldModules.filter(m=>!tools.some(t=>t.moduleId===m.id)||(preserveLocked&&(m.locked||tools.some(t=>t.moduleId===m.id&&t.locked)))).map(m=>m.id));
  const modules=oldModules.filter(m=>lockedIds.has(m.id));
  const reservedTools=new Set(tools.filter(t=>lockedIds.has(t.moduleId)||invalid.has(t.id)).map(t=>t.id));
  for(const tool of tools.filter(t=>invalid.has(t.id)&&!lockedIds.has(t.moduleId)&&!oldModules.some(m=>m.id===t.moduleId&&(m.sizeMode==='manual'||m.pocketMargin!=null||m.grouped===true||m.setLayout==='uniform')))){tool.moduleId=null;tool.x=n(project.width)+grid;tool.y=0;}
  // A fixed tool without a module receives a stationary enclosing module.
  for(const t of tools.filter(t=>preserveLocked&&t.locked&&!reservedTools.has(t.id))){
    const b=footprints.get(t.id),padding=modulePadding(project);
    const x=Math.floor((b.x-padding)/grid)*grid,y=Math.floor((b.y-padding)/grid)*grid;
    const module={id:t.moduleId||`mod-${t.id}`,name:t.name,x,y,width:Math.ceil((b.maxX+padding-x)/grid)*grid,height:Math.ceil((b.maxY+padding-y)/grid)*grid,locked:true,sizeMode:'auto',...unitOf(t.moduleId),...marginOf(t.moduleId)};
    t.moduleId=module.id;modules.push(module);reservedTools.add(t.id);
  }
  // Manual sizes and explicitly shared modules remain movable, rigid groups.
  const groups=oldModules.filter(m=>(m.sizeMode==='manual'||m.pocketMargin!=null||m.grouped===true||m.setLayout==='uniform'||m.cells)&&!lockedIds.has(m.id)).map(original=>{
    const own=tools.filter(t=>t.moduleId===original.id);let content=null,width=original.width,height=original.height,valid=!own.some(t=>invalid.has(t.id));
    if(valid&&original.grouped===true&&original.sizeMode!=='manual'&&original.pocketMargin==null&&!original.cells){
      content=box(own.flatMap(t=>{const b=footprints.get(t.id);return[{x:b.x,y:b.y},{x:b.maxX,y:b.maxY}];}));
      const padding=modulePadding(project);
      width=Math.ceil((content.width+2*padding-EPS)/grid)*grid;height=Math.ceil((content.height+2*padding-EPS)/grid)*grid;
      if(width>3000||height>3000){valid=false;width=original.width;height=original.height;content=null;}
    }
    return{original,own,width,height,content,valid};
  });
  // Equal-footprint members of an explicitly ordered uniform set form one deterministic sort block.
  // A tuple avoids a non-transitive "same set => nominal, otherwise => id" comparator.
  const groupOrder=new Map();
  for(const set of project.toolSets||[]){
    if(!['auto','uniform'].includes(set.layout)||!['asc','desc'].includes(set.order))continue;
    const memberIds=new Set(set.toolIds),own=groups.filter(g=>g.original.setLayout==='uniform'&&g.own.length===1&&memberIds.has(g.own[0].id));
    if(!own.length)continue;
    const key=own.map(g=>String(g.original.id)).sort((a,b)=>a.localeCompare(b))[0],rank=new Map(orderTools(own.map(g=>g.own[0]),set.order).map((t,index)=>[t.id,index]));
    for(const group of own)groupOrder.set(group.original.id,{key,rank:rank.get(group.own[0].id)});
  }
  groups.sort((a,b)=>{
    const ar=groupOrder.get(a.original.id)||{key:String(a.original.id),rank:0},br=groupOrder.get(b.original.id)||{key:String(b.original.id),rank:0};
    return b.width*b.height-a.width*a.height||ar.key.localeCompare(br.key)||ar.rank-br.rank;
  });
  for(const {original,own,width,height,content,valid} of groups){
    let position=null;
    if(valid)for(let y=0;y+height<=n(project.height)+EPS&&!position;y+=grid)for(let x=0;x+width<=n(project.width)+EPS;x+=grid){
      const candidate={...original,x,y,width,height};
      if(!modules.some(m=>intersectsModules(candidate,m,grid))){position={x,y};break;}
    }
    // Keep the group and its size reloadable even when the drawer is too small.
    const module={...original,width,height,...(position||{x:Math.ceil(n(project.width)/grid)*grid+grid,y:0})};
    const dx=content?module.x+(width-content.width)/2-content.x:module.x-original.x,dy=content?module.y+(height-content.height)/2-content.y:module.y-original.y;
    for(const tool of own){tool.x=n(tool.x)+dx;tool.y=n(tool.y)+dy;reservedTools.add(tool.id);if(!position)markUnplaced(tool.id);}
    modules.push(module);
  }
  const padding=modulePadding(project);
  const pendingOrder=new Map(),orderCursor=new Map();
  for(const set of project.toolSets||[]){
    if(!['auto','uniform'].includes(set.layout)||!['asc','desc'].includes(set.order))continue;
    const own=tools.filter(t=>set.toolIds.includes(t.id)&&!reservedTools.has(t.id));if(!own.length)continue;
    const largest=Math.max(...own.map(t=>{const b=footprints.get(t.id);return b.width*b.height;})),key=own.map(t=>String(t.id)).sort()[0];
    orderTools(own,set.order).forEach((t,rank)=>pendingOrder.set(t.id,{key,rank,area:largest}));
  }
  const pending=tools.filter(t=>!reservedTools.has(t.id)).sort((a,b)=>{
    const x=footprints.get(a.id),y=footprints.get(b.id),ar=pendingOrder.get(a.id)||{key:String(a.id),rank:0,area:x.width*x.height},br=pendingOrder.get(b.id)||{key:String(b.id),rank:0,area:y.width*y.height};
    return br.area-ar.area||ar.key.localeCompare(br.key)||ar.rank-br.rank;
  });
  for(const tool of pending){
    const candidates=[];
    for(const rotation of [n(tool.rotation),n(tool.rotation)+90]){
      let b;try{b=box(pocketOutline({...tool,x:0,y:0,rotation},minimized));}catch{continue;}
      const width=Math.ceil((b.width+2*padding)/grid)*grid,height=Math.ceil((b.height+2*padding)/grid)*grid;
      if(width>n(project.width)||height>n(project.height))continue;
      for(let y=0;y+height<=n(project.height)+EPS;y+=grid){
        for(let x=0;x+width<=n(project.width)+EPS;x+=grid){
          const candidate={x,y,width,height,rotation,b},order=pendingOrder.get(tool.id),cursor=order&&orderCursor.get(order.key);
          if(cursor&&(y<cursor.y-EPS||Math.abs(y-cursor.y)<EPS&&x<cursor.x-EPS))continue;
          if(modules.some(m=>intersectsModules(candidate,m,grid)))continue;
          // Prefer a low packed height, then the left edge, then the current rotation.
          candidate.score=(y+height)*100000+x*100+((rotation%360+360)%360!==((n(tool.rotation)%360+360)%360)?1:0);
          candidates.push(candidate);break;
        }
        if(candidates.length&&candidates.at(-1).rotation===rotation)break;
      }
    }
    candidates.sort((a,b)=>a.score-b.score);
    const chosen=candidates[0];
    if(!chosen){tool.moduleId=null;tool.x=n(project.width)+grid;tool.y=unplaced.reduce((y,id)=>y+bounds(tools.find(t=>t.id===id)).height+grid,0);unplaced.push(tool.id);continue;}
    const id=tool.moduleId&&!modules.some(m=>m.id===tool.moduleId)?tool.moduleId:`mod-${tool.id}`;
    const previous=oldModules.find(module=>module.id===id),module={...(previous||{}),id,name:previous?.name||tool.name,x:chosen.x,y:chosen.y,width:chosen.width,height:chosen.height,locked:false,sizeMode:'auto',...unitOf(id),...marginOf(tool.moduleId)};
    const order=pendingOrder.get(tool.id);if(order)orderCursor.set(order.key,{x:chosen.x,y:chosen.y});
    modules.push(module);
    tool.moduleId=id;tool.rotation=((chosen.rotation%360)+360)%360;
    tool.x=module.x+(module.width-chosen.b.width)/2-chosen.b.x;tool.y=module.y+(module.height-chosen.b.height)/2-chosen.b.y;
  }
  // The shape is the customer's choice, so without one every existing step stays as it is. Module-by-module, so two steps cannot both claim one cell.
  const keepsShape=m=>m.locked||lockedIds.has(m.id)||m.sizeMode==='manual'||m.pocketMargin!=null||(project.toolSets||[]).some(set=>set.layout==='uniform'&&(set.id===m.setId||tools.some(t=>t.moduleId===m.id&&set.toolIds.includes(t.id))));
  const fixedShape=m=>m.locked||lockedIds.has(m.id)||m.sizeMode==='manual'||(project.toolSets||[]).some(set=>set.layout==='uniform'&&(set.id===m.setId||tools.some(t=>t.moduleId===m.id&&set.toolIds.includes(t.id))));
  if(moduleShape==='rectangular')modules.forEach((module,i)=>{if(module.cells&&!keepsShape(module))modules[i]=fillFreeCells(module,modules.filter(other=>other!==module),grid);});
  if(moduleShape==='stepped')modules.forEach((module,i)=>{
    if(fixedShape(module))return;
    const cut=steppedModuleFootprint({...project,modules,tools:tools.filter(tool=>tool.moduleId===module.id)},module);
    if(cut.cells&&!modules.some(other=>other!==module&&moduleIntersects(cut,other,grid)))modules[i]=cut;
  });
  return {tools,modules,unplaced};
}

export function validateLayout(project) {
  const issues=[],modules=project.modules||[],tools=project.tools||[],height=n(project.insertHeight,20),base=n(project.base,2.4),wall=n(project.wall,2.4);
  if(!(n(project.width)>0&&n(project.height)>0&&height>base&&base>0&&wall>0))issues.push(issue('depth',[],'Zkontrolujte rozměry šuplíku, výšku inzertu a tloušťku dna i stěny.'));
  for(let i=0;i<modules.length;i++){
    const m=modules[i];
    try{validateModuleFootprint(m,n(project.grid,42));}catch(error){issues.push({type:'outside',ids:[m.id],message:error.message,...(error.i18n?{i18n:error.i18n}:{})});continue;}
    if(m.width<=0||m.height<=0||m.x<-.001||m.y<-.001||m.x+m.width>n(project.width)+.001||m.y+m.height>n(project.height)+.001)issues.push(issue('outside',[m.id],'Modul „{name}“ přesahuje šuplík.',{name:m.name||m.id}));
    for(let j=i+1;j<modules.length;j++){let overlaps=false;try{overlaps=intersectsModules(m,modules[j],n(project.grid,42));}catch{continue;}if(overlaps)issues.push(issue('overlap',[m.id,modules[j].id],'Moduly „{a}“ a „{b}“ se překrývají.',{a:m.name||m.id,b:modules[j].name||modules[j].id}));}
  }
  const polygons=new Map(),limits=tools.some(hasPocketMagnets)?pocketHeightLimits(project):null;
  for(const t of tools){
    let poly=[],pocketError=null;
    try{poly=pocketOutline(t,project);}catch(error){pocketError=error;issues.push(issue('overlap',[t.id],t.fingerGrips?.length?'Výřezy pro prsty nástroje „{name}“ nejsou platné: {error}':'Kontura „{name}“ není platná: {error}',{name:t.name,error:error.message}));}
    const m=modules.find(m=>m.id===t.moduleId);polygons.set(t.id,poly);
    const raw=transformedPoints(t);
    if(!pocketError&&(poly.length<3||Math.abs(area(poly))<EPS||selfIntersects(raw)||selfIntersects(poly)))issues.push(issue('overlap',[t.id],'Kontura „{name}“ se kříží nebo není platná. Upravte konturu či zmenšete vůli.',{name:t.name}));
    if(!m)issues.push(issue('outside',[t.id],'Nástroj „{name}“ zatím nemá umístěný modul.',{name:t.name}));
    else {let contained=false;try{contained=m.cells?containsPocketWalls(m,poly,wall,n(project.grid,42)):!poly.some(p=>p.x<m.x+wall+.25-.001||p.y<m.y+wall+.25-.001||p.x>m.x+m.width-wall-.25+.001||p.y>m.y+m.height-wall-.25+.001);}catch{}if(!contained)issues.push(issue('outside',[t.id,m.id],'Kolem „{name}“ není dost místa na stěnu. Zvětšete modul nebo spusťte rozvržení.',{name:t.name}));}
    if(!(n(t.depth,10)>0&&n(t.depth,10)<=height-base+.001))issues.push(issue('depth',[t.id],'Hloubka kapsy „{name}“ musí být větší než 0 a nejvýše {max}.',{name:t.name,max:fmtLen(height-base)}));
    else if(!pocketError&&limits?.affected(t)&&n(t.depth,10)>limits.maxDepth(t)+.001)issues.push(issue('depth',[t.id],'Kapsa „{name}“ v modulu s magnetem potřebuje výšku vložky alespoň {height}.',{name:t.name,height:fmtLen(limits.requiredHeight(t),{digits:2})}));
    if(!pocketError&&hasPocketMagnets(t)){
      const problem=pocketMagnetProblem(t,poly);
      if(problem==='wall')issues.push(issue('overlap',[t.id],'Magnet v kapse „{name}“ je příliš blízko stěny nebo mimo dno kapsy.',{name:t.name}));
      if(problem==='spacing')issues.push(issue('overlap',[t.id],'Magnety v kapse „{name}“ jsou příliš blízko sebe.',{name:t.name}));
    }
  }
  for(let i=0;i<tools.length;i++)for(let j=i+1;j<tools.length;j++){
    const a=tools[i],b=tools[j],pa=polygons.get(a.id),pb=polygons.get(b.id);
    if(polygonsOverlap(pa,pb))issues.push(issue('overlap',[a.id,b.id],'Kapsy „{a}“ a „{b}“ se překrývají nebo dotýkají.',{a:a.name,b:b.name}));
    else if(a.moduleId&&a.moduleId===b.moduleId&&polygonsTooClose(pa,pb,wall-.001))issues.push(issue('overlap',[a.id,b.id],'Mezi kapsami „{a}“ a „{b}“ není dost místa na stěnu {wall}.',{a:a.name,b:b.name,wall:fmtLen(wall)}));
  }
  return issues;
}
function selected(project,moduleId) {
  const modules=(project.modules||[]).filter(m=>!moduleId||m.id===moduleId);
  if(!modules.length)throw i18nError('Nejprve umístěte alespoň jeden modul.');
  const ids=new Set(modules.map(m=>m.id)),tools=moduleId?(project.tools||[]).filter(t=>ids.has(t.moduleId)):(project.tools||[]);
  const validation=validateLayout({...project,modules,tools});
  if(validation.length)throw issueError(validation[0]);
  const origin=moduleId?{x:modules[0].x,y:modules[0].y}:{x:0,y:0};
  return {modules,tools,origin,width:moduleId?modules[0].width:n(project.width),height:moduleId?modules[0].height:n(project.height)};
}
const xml=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const fmt=value=>(Math.round(value*10000)/10000).toString();
const path=points=>points.map((p,i)=>`${i?'L':'M'}${fmt(p.x)},${fmt(p.y)}`).join(' ')+' Z';
export function exportSVG(project,{moduleId=null}={}) {
  const {modules,tools,origin,width,height}=selected(project,moduleId);
  const shift=p=>({x:p.x-origin.x,y:p.y-origin.y});
  const margins=tools.map(tool=>effectivePocketMargin(tool,project)),minimum=margins.length?Math.min(...margins):n(project.clearance,.8),maximum=margins.length?Math.max(...margins):minimum,clearance=minimum===maximum?minimum:`${fmt(minimum)}–${fmt(maximum)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}mm" height="${fmt(height)}mm" viewBox="0 0 ${fmt(width)} ${fmt(height)}"><title>${xml(project.name||'InsertCreator')}</title><desc>${xml(tr('Rozměry v mm. Černá = modul; červená = kapsa včetně vůle {clearance} mm. Ploché dno, rozteč modulů {grid} mm.',{clearance,grid:n(project.grid,42)}))}</desc><g id="modules" fill="none" stroke="black" stroke-width="0.15">${modules.map(m=>m.cells?`<path d="${path(moduleOutline(m,project.grid,{inset:.25}).map(shift))}"/>`:`<rect x="${fmt(m.x-origin.x+.25)}" y="${fmt(m.y-origin.y+.25)}" width="${fmt(m.width-.5)}" height="${fmt(m.height-.5)}"/>`).join('')}</g><g id="pockets" fill="none" stroke="red" stroke-width="0.15">${tools.map(t=>`<path id="${xml(t.id)}" data-depth-mm="${n(t.depth,10)}" data-pocket-margin-mm="${fmt(effectivePocketMargin(t,project))}" d="${path(pocketOutline(t,project).map(shift))}"><title>${xml(t.name)}</title></path>`).join('')}</g>${tools.some(hasPocketMagnets)?`<g id="magnets" fill="none" stroke="blue" stroke-width="0.15">${tools.flatMap(t=>pocketMagnetHoles(t).map(hole=>`<circle cx="${fmt(hole.x-origin.x)}" cy="${fmt(hole.y-origin.y)}" r="${fmt(hole.radius)}" data-floor-depth-mm="${fmt(n(t.depth,10)+hole.depth)}"><title>${xml(t.name)}</title></circle>`)).join('')}</g>`:''}</svg>`;
}
export function exportDXF(project,{moduleId=null}={}) {
  const {modules,tools,origin,height}=selected(project,moduleId),lines=[];
  const add=(code,value)=>lines.push(String(code),String(value));
  add(0,'SECTION');add(2,'HEADER');add(9,'$ACADVER');add(1,'AC1015');add(9,'$INSUNITS');add(70,4);add(0,'ENDSEC');add(0,'SECTION');add(2,'ENTITIES');
  const polygon=(points,layer)=>{add(0,'LWPOLYLINE');add(100,'AcDbEntity');add(8,layer);add(100,'AcDbPolyline');add(90,points.length);add(70,1);for(const p of points){add(10,fmt(p.x-origin.x));add(20,fmt(height-(p.y-origin.y)));}};
  for(const m of modules)polygon(moduleOutline(m,project.grid,{inset:.25}),'MODULES');
  for(const t of tools)polygon(pocketOutline(t,project),'POCKETS');
  for(const t of tools)for(const hole of pocketMagnetHoles(t)){add(0,'CIRCLE');add(100,'AcDbEntity');add(8,'MAGNETS');add(100,'AcDbCircle');add(10,fmt(hole.x-origin.x));add(20,fmt(height-(hole.y-origin.y)));add(40,fmt(hole.radius));}
  add(0,'ENDSEC');add(0,'EOF');return lines.join('\r\n')+'\r\n';
}

const printTools=(project,tools)=>tools.map(t=>({...t,poly:clean(pocketOutline(t,project))}));
/** Binary STL in mm: solid or open contour walls, with the selected real underside. */
export function exportSTL(project,{moduleId=null,checkBed=true}={}){
  const {modules,tools,origin,height}=selected(project,moduleId);if(checkBed)validatePrintBed(project,modules);
  const triangles=layoutMeshToPhysical(buildPrintTriangles(project,modules,printTools(project,tools),origin),height);
  validatePrintMesh(triangles);
  return encodeSTL(triangles,'InsertCreator | mm | '+(project.printMode||'solid')+' | '+(project.bottomMode||'plain'));
}
/** One millimetre high contour ring: same pocket clearance, no full block or base. */
export function exportFitSTL(project,{moduleId=null}={}){
  const {modules,tools,origin,height}=selected(project,moduleId);
  const triangles=buildPrintTriangles(project,modules,printTools(project,tools),origin,{fit:true});
  if(project.limitToBed&&triangles.length){let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const triangle of triangles)for(const p of triangle){minX=Math.min(minX,p[0]);minY=Math.min(minY,p[1]);maxX=Math.max(maxX,p[0]);maxY=Math.max(maxY,p[1]);}const width=maxX-minX,height=maxY-minY,bw=n(project.bedWidth,220),bh=n(project.bedHeight,220);if(!((width<=bw&&height<=bh)||(width<=bh&&height<=bw)))throw i18nError('Testovací obrys se nevejde na tiskovou plochu. Vyberte jeden menší modul.');}
  const physical=layoutMeshToPhysical(triangles,height);validatePrintMesh(physical);
  return encodeSTL(physical,'InsertCreator | mm | 1mm contour fit test');
}
/** Geometric volume only; does not pretend to predict slicer infill or print duration. */
export function printStats(project,{moduleId=null,checkBed=true}={}){
  const {modules,tools,origin}=selected(project,moduleId),prepared=printTools(project,tools),cfg=printConfig(project);
  if(checkBed)validatePrintBed(project,modules);
  const zones=materialConfig(project).enabled?buildColorZones(project,modules,prepared,origin):null;
  const triangles=zones?zones.flatMap(zone=>zone.mesh):buildPrintTriangles(project,modules,prepared,origin),volumeMm3=zones?zones.reduce((sum,zone)=>sum+trianglesVolume(zone.mesh),0):trianglesVolume(triangles);
  const solidVolumeMm3=cfg.printMode==='solid'?volumeMm3:trianglesVolume(buildPrintTriangles({...project,printMode:'solid'},modules,prepared,origin));
  let heightMm=0;for(const triangle of triangles)for(const p of triangle)heightMm=Math.max(heightMm,p[2]);
  const notes=[];
  if(cfg.printMode==='light')notes.push(tr('Úsporný model má ploché dno a pouze obrysové stěny; každá stěna stoupá od dna o hloubku své kapsy. Okolí zůstává nízké a otevřené.'));
  if(cfg.bottomMode==='grid')notes.push(tr('Gridfinity patky mají profil 0,8 + 1,8 + 2,15 mm, rozteč 42 mm a přidávají {foot} pod tělo inzertu. Bez horního stohovacího lemu.',{foot:fmtLen(4.75)}));
  if(cfg.bottomMode==='magnet')notes.push(tr('Čtyři slepé kapsy na modul: Ø {diameter} × {depth}. Dno je automaticky nejméně {base}, aby nad magnety zůstalo alespoň {cover} materiálu.',{diameter:fmtLen(cfg.magnetDiameter,{suffix:false}),depth:fmtLen(cfg.magnetDepth),base:fmtLen(cfg.effectiveBaseMm),cover:fmtLen(1.2)}));
  const holders=tools.flatMap(t=>t.pocketMagnets||[]);
  if(holders.length)notes.push(cfg.printMode==='light'?tr('Magnety v kapsách: {count} ks. Díry míří nahoru pod nástroj, díra je o {play} větší než magnet. Dno modulu s magnetem se zesílí, aby pod dírou zůstalo alespoň {cover}.',{count:holders.length,play:fmtLen(.2),cover:fmtLen(1.2)}):tr('Magnety v kapsách: {count} ks. Díry míří nahoru pod nástroj, díra je o {play} větší než magnet a pod dírou zůstává alespoň {cover}.',{count:holders.length,play:fmtLen(.2),cover:fmtLen(1.2)}));
  if(cfg.bottomMode==='adhesive')notes.push(tr('Rovné souvislé dno pro oboustrannou pásku; tloušťka pásky se do modelu nezapočítává.'));
  return {volumeMm3,volumeCm3:volumeMm3/1000,solidVolumeMm3,savingPercent:solidVolumeMm3?Math.max(0,(1-volumeMm3/solidVolumeMm3)*100):0,heightMm,effectiveBaseMm:cfg.effectiveBaseMm,footHeightMm:cfg.footHeight,printMode:cfg.printMode,bottomMode:cfg.bottomMode,triangles:triangles.length,notes};
}

const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=bytes=>{let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
/** Dependency-free ZIP (stored entries); supports Unicode filenames. */
export function zipFiles(files) {
  const encoder=new TextEncoder(),chunks=[],central=[];let position=0,centralSize=0;
  const header=(size)=>{const bytes=new Uint8Array(size);return {bytes,v:new DataView(bytes.buffer)};};
  for(const file of files){
    const name=encoder.encode(String(file.name).replace(/\\/g,'/').replace(/^\/+/,'')),data=typeof file.data==='string'?encoder.encode(file.data):new Uint8Array(file.data),crc=crc32(data);
    const h=header(30+name.length);h.v.setUint32(0,0x04034b50,true);h.v.setUint16(4,20,true);h.v.setUint16(6,0x800,true);h.v.setUint16(12,0x21,true);h.v.setUint32(14,crc,true);h.v.setUint32(18,data.length,true);h.v.setUint32(22,data.length,true);h.v.setUint16(26,name.length,true);h.bytes.set(name,30);chunks.push(h.bytes,data);
    const c=header(46+name.length);c.v.setUint32(0,0x02014b50,true);c.v.setUint16(4,20,true);c.v.setUint16(6,20,true);c.v.setUint16(8,0x800,true);c.v.setUint16(14,0x21,true);c.v.setUint32(16,crc,true);c.v.setUint32(20,data.length,true);c.v.setUint32(24,data.length,true);c.v.setUint16(28,name.length,true);c.v.setUint32(42,position,true);c.bytes.set(name,46);central.push(c.bytes);centralSize+=c.bytes.length;position+=h.bytes.length+data.length;
  }
  const e=header(22);e.v.setUint32(0,0x06054b50,true);e.v.setUint16(8,files.length,true);e.v.setUint16(10,files.length,true);e.v.setUint32(12,centralSize,true);e.v.setUint32(16,position,true);
  const out=new Uint8Array(position+centralSize+22);let i=0;for(const part of [...chunks,...central,e.bytes]){out.set(part,i);i+=part.length;}return out;
}

export function createDemoProject() {
  const polygon=(coords)=>coords.map(([x,y])=>({x,y}));
  const tools=[
    {id:'tool-pliers',name:tr('Kombinované kleště'),points:polygon([[14,0],[23,0],[26,25],[32,39],[40,62],[47,109],[43,119],[35,117],[27,76],[24,62],[20,62],[17,76],[9,117],[1,119],[0,109],[7,62],[15,39],[17,25]]) ,depth:13,color:'#e7a039'},
    {id:'tool-wrench',name:tr('Očkoplochý klíč 17'),points:polygon([[7,0],[11,0],[10,12],[17,17],[24,12],[23,0],[27,0],[34,9],[32,21],[23,29],[23,112],[31,120],[31,135],[23,143],[11,143],[3,135],[3,120],[11,112],[11,29],[2,21],[0,9]]),depth:7,color:'#a8b3bd'},
    {id:'tool-screwdriver',name:tr('Šroubovák PH2'),points:polygon([[10,0],[14,0],[15,12],[14,87],[23,94],[24,134],[20,145],[4,145],[0,134],[1,94],[10,87],[9,12]]),depth:12,color:'#6d9c82'},
    {id:'tool-cutter',name:tr('Odlamovací nůž'),points:polygon([[8,0],[21,0],[22,20],[28,26],[28,116],[23,124],[4,124],[0,116],[0,27],[6,20]]),depth:10,color:'#df975b'},
    {id:'tool-hex',name:tr('Imbusový klíč 6'),points:polygon([[0,0],[65,0],[65,7],[9,7],[9,103],[0,103]]),depth:6,color:'#b5a1cf'},
    {id:'tool-caliper',name:tr('Posuvné měřítko'),points:polygon([[0,15],[10,15],[10,0],[15,0],[15,15],[34,15],[34,4],[39,4],[39,23],[31,23],[31,32],[129,32],[129,38],[30,38],[30,52],[22,52],[22,38],[14,38],[14,55],[8,55],[8,23],[0,23]]),depth:8,color:'#a4b9bd'},
  ].map(t=>({...t,x:0,y:0,rotation:0,locked:false,moduleId:null}));
  const project={version:1,name:tr('Dílna · ruční nářadí'),width:420,height:294,grid:42,gap:3,clearance:.8,wall:2.4,base:2.4,insertHeight:20,tools,modules:[]};
  // A readable first project: tool silhouettes stay upright, while Auto can compact later.
  const layout=[[0,0,84,168],[84,0,84,168],[168,0,42,168],[210,0,42,168],[252,0,84,126],[0,168,168,84]];
  tools.forEach((t,i)=>{
    const [x,y,width,height]=layout[i],m={id:`mod-${t.id}`,name:t.name,x,y,width,height,locked:false,sizeMode:'auto'};
    const b=box(pocketOutline(t,project));
    t.moduleId=m.id;t.x=x+(width-b.width)/2-b.x;t.y=y+(height-b.height)/2-b.y;
    project.modules.push(m);
  });
  return project;
}
