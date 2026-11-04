import earcut from './vendor/earcut.js';
import Clipper from './vendor/clipper.js';
import {i18nError} from './i18n.js';
import {fmtLen,fmtSize} from './units.js';
import {planSizeLabels} from './size-labels.js';
import {moduleOutline,validateModuleFootprint,containsPocketWalls} from './module-footprint.js';

const SCALE=10000,EPS=1e-7;
const number=(value,fallback)=>Number.isFinite(+value)?+value:fallback;
const signedArea=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.y-b.x*a.y;},0)/2;
const round=value=>Math.round(value*SCALE)/SCALE;
const point=(x,y)=>({x:round(x),y:round(y)});
const toInt=paths=>paths.filter(p=>p.length>2).map(p=>p.map(v=>({X:Math.round(v.x*SCALE),Y:Math.round(v.y*SCALE)})));
const fromInt=paths=>paths.map(p=>p.map(v=>({x:v.X/SCALE,y:v.Y/SCALE})));
function boolean(subject,clip=[],operation=Clipper.ClipType.ctUnion){
  if(!subject.length)return [];
  const c=new Clipper.Clipper(),result=[];c.PreserveCollinear=true;
  c.AddPaths(toInt(subject),Clipper.PolyType.ptSubject,true);
  if(clip.length)c.AddPaths(toInt(clip),Clipper.PolyType.ptClip,true);
  c.Execute(operation,result,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero);
  return fromInt(result);
}
const union=paths=>boolean(paths);
const subtract=(a,b)=>b.length?boolean(a,b,Clipper.ClipType.ctDifference):a;
function offset(poly,distance){
  const p=toInt([poly])[0];if(!Clipper.Clipper.Orientation(p))p.reverse();
  const result=[],o=new Clipper.ClipperOffset(2,.015*SCALE);o.AddPath(p,Clipper.JoinType.jtRound,Clipper.EndType.etClosedPolygon);o.Execute(result,distance*SCALE);return fromInt(result);
}
const rect=(x,y,w,h)=>[point(x,y),point(x+w,y),point(x+w,y+h),point(x,y+h)];
function roundedRect(x,y,width,height,radius,segments=8){
  const r=Math.min(radius,width/2,height/2),out=[];
  for(const [cx,cy,start] of [[x+width-r,y+r,-Math.PI/2],[x+width-r,y+height-r,0],[x+r,y+height-r,Math.PI/2],[x+r,y+r,Math.PI]]){
    for(let i=0;i<=segments;i++){const angle=start+i*Math.PI/(2*segments);out.push(point(cx+Math.cos(angle)*r,cy+Math.sin(angle)*r));}
  }
  return out.filter((p,i,a)=>!i||Math.hypot(p.x-a[i-1].x,p.y-a[i-1].y)>EPS);
}
const circle=(cx,cy,r)=>Array.from({length:48},(_,i)=>point(cx+Math.cos(i*Math.PI/24)*r,cy+Math.sin(i*Math.PI/24)*r));
const defaultKernel={scale:SCALE,round,toInt,fromInt,boolean,union,subtract,offset,rect,roundedRect,circle};
function preciseKernel(scale){
  const round=value=>Math.round(value*scale)/scale,point=(x,y)=>({x:round(x),y:round(y)});
  const toInt=paths=>paths.filter(poly=>poly.length>2).map(poly=>poly.map(p=>({X:Math.round(p.x*scale),Y:Math.round(p.y*scale)})));
  const fromInt=paths=>paths.map(poly=>poly.map(p=>({x:p.X/scale,y:p.Y/scale})));
  const boolean=(subject,clip=[],operation=Clipper.ClipType.ctUnion)=>{
    if(!subject.length)return[];const engine=new Clipper.Clipper(),result=[];engine.PreserveCollinear=true;
    engine.AddPaths(toInt(subject),Clipper.PolyType.ptSubject,true);if(clip.length)engine.AddPaths(toInt(clip),Clipper.PolyType.ptClip,true);
    engine.Execute(operation,result,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero);return fromInt(result);
  };
  const union=paths=>boolean(paths),subtract=(a,b)=>b.length?boolean(a,b,Clipper.ClipType.ctDifference):a;
  const offset=(poly,distance)=>{const p=toInt([poly])[0];if(!Clipper.Clipper.Orientation(p))p.reverse();const engine=new Clipper.ClipperOffset(2,.015*scale),result=[];engine.AddPath(p,Clipper.JoinType.jtRound,Clipper.EndType.etClosedPolygon);engine.Execute(result,distance*scale);return fromInt(result);};
  const rect=(x,y,w,h)=>[point(x,y),point(x+w,y),point(x+w,y+h),point(x,y+h)];
  const roundedRect=(x,y,width,height,radius,segments=8)=>{
    const r=Math.min(radius,width/2,height/2),out=[];
    for(const [cx,cy,start] of [[x+width-r,y+r,-Math.PI/2],[x+width-r,y+height-r,0],[x+r,y+height-r,Math.PI/2],[x+r,y+r,Math.PI]])for(let i=0;i<=segments;i++){const a=start+i*Math.PI/(2*segments);out.push(point(cx+Math.cos(a)*r,cy+Math.sin(a)*r));}
    return out.filter((p,i,all)=>!i||Math.hypot(p.x-all[i-1].x,p.y-all[i-1].y)>EPS);
  };
  const circle=(cx,cy,r)=>Array.from({length:48},(_,i)=>point(cx+Math.cos(i*Math.PI/24)*r,cy+Math.sin(i*Math.PI/24)*r));
  return{scale,round,toInt,fromInt,boolean,union,subtract,offset,rect,roundedRect,circle};
}
const cutKernel=preciseKernel(1000000);
function cleanCapBacktracks(poly,scale){
  const out=poly.slice();let changed=true;
  while(changed&&out.length>3){changed=false;for(let i=0;i<out.length;i++){
    const a=out[(i+out.length-1)%out.length],b=out[i],c=out[(i+1)%out.length],dot=(b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y),length=Math.max(Math.hypot(b.x-a.x,b.y-a.y),Math.hypot(c.x-b.x,c.y-b.y));
    // A derived Boolean edge can reverse along itself by less than one kernel unit.
    // Remove only that zero-area spike; forward collinear stitching vertices stay.
    if(dot<0&&Math.abs((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x))/(length||1)<1/scale){out.splice(i,1);changed=true;break;}
  }}
  return out;
}
function inside(p,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}
function regions(paths){
  const outer=paths.filter(p=>signedArea(p)>0).map(p=>({outer:p,holes:[],area:signedArea(p)}));
  for(const hole of paths.filter(p=>signedArea(p)<0)){
    const owner=outer.filter(p=>inside(hole[0],p.outer)).sort((a,b)=>a.area-b.area)[0];if(owner)owner.holes.push(hole);
  }
  return outer;
}

const range=(min,max)=>`${fmtLen(min,{suffix:false})}–${fmtLen(max)}`;

export function printConfig(project){
  const printMode=project.printMode==='light'?'light':'solid',bottomMode=['grid','magnet','adhesive'].includes(project.bottomMode)?project.bottomMode:'plain';
  const base=number(project.base,2.4),wall=number(project.wall,2.4),height=number(project.insertHeight,20),magnetDiameter=number(project.magnetDiameter,6.2),magnetDepth=number(project.magnetDepth,2.2);
  if(base<=0||wall<=0||height<=base)throw i18nError('Výška inzertu musí být větší než kladná tloušťka dna.');
  if(bottomMode==='magnet'&&(!(magnetDiameter>=2&&magnetDiameter<=20)||!(magnetDepth>=.5&&magnetDepth<=10)))throw i18nError('Pro magnety zadejte průměr otvoru {diameter} a hloubku {depth}.',{diameter:range(2,20),depth:range(.5,10)});
  const effectiveBaseMm=bottomMode==='magnet'?Math.max(base,magnetDepth+1.2):base,extraBase=effectiveBaseMm-base,footHeight=bottomMode==='grid'?4.75:0;
  if(bottomMode==='grid'&&Math.abs(number(project.grid,42)-42)>.001)throw i18nError('Gridfinity patky vyžadují rastr přesně 42 mm.');
  return {printMode,bottomMode,base,wall,height,magnetDiameter,magnetDepth,effectiveBaseMm,extraBase,footHeight};
}

/** Export-only printer check; drawer editing and previews use the drawer dimensions. */
export function validatePrintBed(project,modules){
  if(!project.limitToBed)return;
  const width=number(project.bedWidth,220),height=number(project.bedHeight,220);
  if(!(width>0&&height>0))throw i18nError('Zadejte kladné rozměry tiskové plochy.');
  const tooBig=modules.find(m=>!((m.width-.5<=width+EPS&&m.height-.5<=height+EPS)||(m.height-.5<=width+EPS&&m.width-.5<=height+EPS)));
  if(tooBig)throw i18nError('Modul „{name}“ se nevejde na tiskovou plochu {size} ani po otočení. Zmenšete modul nebo zvětšete tiskovou plochu.',{name:tooBig.name||tooBig.id,size:fmtSize(width,height)});
}

/** Build non-overlapping material slabs, then expose only their actual boundary faces. */
export function buildPrintTriangles(project,modules,tools,origin={x:0,y:0},{fit=false,clip=null,labelPlan:providedLabelPlan=null}={}){
  const kernel=clip?cutKernel:defaultKernel,{round,toInt,fromInt,boolean,union,subtract,offset,rect,roundedRect,circle}=kernel;
  const cfg=printConfig(fit?{...project,bottomMode:'plain'}:project),triangles=[];
  if(clip&&(!['x','y','width','height'].every(key=>typeof clip[key]==='number'&&Number.isFinite(clip[key]))||clip.width<=0||clip.height<=0))throw i18nError('Řez modelu musí mít platnou polohu a kladné rozměry.');
  if(clip&&cfg.bottomMode==='grid'&&[clip.x,clip.y,clip.width,clip.height].some(value=>Math.abs(value/42-Math.round(value/42))>.0001))throw i18nError('Řez modelu s patkami Gridfinity musí vést po hranicích polí 42 mm.');
  const clipPolygon=clip?rect(clip.x,clip.y,clip.width,clip.height):null;
  const clipped=paths=>clip?boolean(paths,[clipPolygon],Clipper.ClipType.ctIntersection):paths;
  const touchesClip=(poly,padding=0)=>!clip||(Math.max(...poly.map(p=>p.x))+padding>clip.x-EPS&&Math.min(...poly.map(p=>p.x))-padding<clip.x+clip.width+EPS&&Math.max(...poly.map(p=>p.y))+padding>clip.y-EPS&&Math.min(...poly.map(p=>p.y))-padding<clip.y+clip.height+EPS);
  const labelPlan=fit?{labels:[],skipped:[]}:providedLabelPlan||planSizeLabels(project,modules,tools);
  const relevantTools=clip?tools.filter(tool=>touchesClip(tool.poly,Math.max(1.2,cfg.wall))):tools;
  const cellInClip=(m,x,y)=>!clip||(m.x+x+21>=clip.x-EPS&&m.x+x+21<clip.x+clip.width-EPS&&m.y+y+21>=clip.y-EPS&&m.y+y+21<clip.y+clip.height-EPS);
  const cellCount=cfg.bottomMode==='grid'&&!fit?modules.reduce((sum,m)=>{
    const cells=validateModuleFootprint(m,number(project.grid,42)).cells;
    if(cells)return sum+cells.filter(cell=>cellInClip(m,cell.x*42,cell.y*42)).length;
    let count=0;for(let y=0;y<m.height-1;y+=42)for(let x=0;x<m.width-1;x+=42)if(cellInClip(m,x,y))count++;return sum+count;
  },0):0;
  if(!fit&&cfg.bottomMode==='grid'&&cellCount>400)throw i18nError('Najednou lze vytvořit nejvýše 400 Gridfinity patek. Exportujte sestavu po jednotlivých modulech.');
  if(relevantTools.reduce((sum,t)=>sum+t.poly.length,0)>20000)throw i18nError('Kontury jsou pro jeden export příliš složité. Exportujte jednotlivé moduly.');
  const v=(p,z)=>[round(p.x-origin.x),round(p.y-origin.y),round(z)];
  const add=(a,b,c)=>{if(triangles.length>=120000)throw i18nError('Model je pro jeden export příliš složitý. Exportujte jednotlivé moduly.');const u=b.map((x,i)=>x-a[i]),w=c.map((x,i)=>x-a[i]);if(Math.hypot(u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0])>1e-9)triangles.push([a,b,c]);};
  function face(paths,z,up){
    if(clip)paths=paths.map(poly=>cleanCapBacktracks(poly,kernel.scale));
    for(const region of regions(paths)){
      const polygons=[region.outer,...region.holes],data=[],holes=[];let count=0;
      for(let i=0;i<polygons.length;i++){if(i)holes.push(count);for(const p of polygons[i]){data.push(p.x,p.y);count++;}}
      const indexes=earcut(data,holes,2);
      for(let i=0;i<indexes.length;i+=3){let a={x:data[indexes[i]*2],y:data[indexes[i]*2+1]},b={x:data[indexes[i+1]*2],y:data[indexes[i+1]*2+1]},c={x:data[indexes[i+2]*2],y:data[indexes[i+2]*2+1]};const ccw=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)>0;if(ccw!==up)[b,c]=[c,b];add(v(a,z),v(b,z),v(c,z));}
    }
  }
  function sides(paths,z0,z1){for(const poly of paths)for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];add(v(a,z0),v(b,z0),v(b,z1));add(v(a,z0),v(b,z1),v(a,z1));}}
  function slabs(levels,sections,bottom=[],barriers=null,topCuts=[]){
    // Clip material sections before caps and sides are triangulated. This closes every
    // cut plane, including cuts through pockets, lettering and blind magnet holes.
    // Differences use original contributors, not a rounded union from the
    // preceding wall section. This keeps shared cap intersections consistent.
    const rawOf=new Map();
    if(clip){
      sections=sections.map(paths=>{const value=clipped(union(paths));rawOf.set(value,paths);return value;});
      const rawBottom=bottom;bottom=clipped(bottom);rawOf.set(bottom,rawBottom);
    }
    const diff=(a,b)=>clip?clipped(subtract(rawOf.get(a)||a,rawOf.get(b)||b)):subtract(a,b);
    let below=bottom;
    if(!barriers){
      for(let i=0;i<sections.length;i++){const current=sections[i];face(diff(current,below),levels[i],false);face(diff(below,current),levels[i],true);sides(current,levels[i],levels[i+1]);below=current;}
      face(diff(below,topCuts),levels.at(-1),true);return;
    }
    // Merge only across Z levels introduced by lettering. Original base, pocket and magnet levels
    // retain their vertices: Boolean T-junctions at those levels must remain available for stitching.
    const walls=new Map();
    for(let i=0;i<sections.length;i++){
      const current=sections[i];face(diff(current,below),levels[i],false);face(diff(below,current),levels[i],true);
      for(const poly of current)for(let j=0;j<poly.length;j++){
        const a=poly[j],b=poly[(j+1)%poly.length],key=`${a.x},${a.y}|${b.x},${b.y}`;
        let edge=walls.get(key);if(!edge){edge={a,b,ranges:[]};walls.set(key,edge);}
        const last=edge.ranges.at(-1);if(last&&!barriers.has(levels[i])&&Math.abs(last[1]-levels[i])<EPS)last[1]=levels[i+1];else edge.ranges.push([levels[i],levels[i+1]]);
      }
      below=current;
    }
    face(diff(below,topCuts),levels.at(-1),true);
    for(const {a,b,ranges} of walls.values())for(const [z0,z1] of ranges){add(v(a,z0),v(b,z0),v(b,z1));add(v(a,z0),v(b,z1),v(a,z1));}
  }
  function loft(a,b,z0,z1){
    for(let i=0;i<a.length;i++){const j=(i+1)%a.length;add(v(a[i],z0),v(a[j],z0),v(b[j],z1));add(v(a[i],z0),v(b[j],z1),v(b[i],z1));}
  }
  /** Independent pockets and wall rings need only their own height. Keep touching or overlapping rings on the
   *  original global-Z path: their Boolean junctions require all original depth barriers for stitching. */
  function disjointComponents(outer,pockets,labels,bottom,baseTop,H,magnets,feet){
    if(pockets.length<2)return false;
    const components=pockets.map(tool=>({paths:subtract(offset(tool.poly,cfg.wall),[tool.poly]),envelope:offset(tool.poly,cfg.wall+1/kernel.scale),top:round(baseTop+number(tool.depth,10))}));
    for(const label of labels)components.push({paths:[label.plate],envelope:offset(label.plate,1/kernel.scale),top:label.top,label});
    const bounds=paths=>{let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const path of paths)for(const p of path){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}return{minX,minY,maxX,maxY};};
    for(const component of components){if(!component.paths.length||!component.envelope.length)return false;component.bounds=bounds(component.envelope);}
    for(let i=0;i<components.length;i++)for(let j=0;j<i;j++){
      const a=components[i],b=components[j],x=a.bounds,y=b.bounds;
      if(x.maxX<y.minX||x.minX>y.maxX||x.maxY<y.minY||x.minY>y.maxY)continue;
      // The one-grid-unit growth rejects point and edge contact as well as a positive overlap.
      if(boolean(a.envelope,b.envelope,Clipper.ClipType.ctIntersection).length)return false;
    }
    if(cfg.printMode==='solid'){
      const z=[...new Set([bottom,H,...(magnets.length?[cfg.magnetDepth]:[])].map(round))].sort((a,b)=>a-b);
      const sections=z.slice(1).map((top,i)=>magnets.length&&(z[i]+top)/2<cfg.magnetDepth-EPS?subtract([outer],magnets):[outer]);
      const cuts=[...pockets.map(tool=>tool.poly),...labels.flatMap(label=>label.polygons)];
      slabs(z,sections,feet,null,cuts);
      // A void's wall winding faces into the pocket. Its floor points upwards; no internal cap is added.
      for(const tool of pockets){const floor=round(H-number(tool.depth,10));face([tool.poly],floor,true);sides([[...tool.poly].reverse()],floor,H);}
      for(const label of labels){const floor=round(label.top-label.depth);face(label.polygons,floor,true);sides(label.polygons.map(path=>[...path].reverse()),floor,label.top);}
      return true;
    }
    const z=[...new Set([bottom,baseTop,...(magnets.length?[cfg.magnetDepth]:[])].map(round))].sort((a,b)=>a-b);
    const sections=z.slice(1).map((top,i)=>magnets.length&&(z[i]+top)/2<cfg.magnetDepth-EPS?subtract([outer],magnets):[outer]);
    // Expose the base only where no component grows from it. Components themselves omit a bottom
    // cap, so they join the one common base without coincident internal faces.
    slabs(z,sections,feet,null,components.flatMap(component=>component.paths));
    for(const component of components){
      if(component.label){const label=component.label;slabs([baseTop,round(label.top-label.depth),label.top],[component.paths,subtract(component.paths,label.polygons)],component.paths,new Set([round(baseTop),round(label.top)]));}
      else slabs([baseTop,component.top],[component.paths],component.paths);
    }
    return true;
  }
  for(const m of modules){
    const start=triangles.length;
    const footprint=validateModuleFootprint(m,number(project.grid,42));
    if(cfg.bottomMode==='grid'&&!fit&&[m.x,m.y,m.width,m.height].some(value=>Math.abs(value/42-Math.round(value/42))>.0001))throw i18nError('Modul „{name}“ musí mít rozměry i polohu v násobcích 42 mm pro Gridfinity patky.',{name:m.name||m.id});
    const own=relevantTools.filter(t=>t.moduleId===m.id),outer=footprint.cells?moduleOutline(m,number(project.grid,42),{inset:.25}):cfg.bottomMode==='grid'&&!fit?roundedRect(m.x+.25,m.y+.25,m.width-.5,m.height-.5,3.75):rect(m.x+.25,m.y+.25,m.width-.5,m.height-.5);
    const pockets=own.map(t=>({...t,poly:signedArea(t.poly)>0?t.poly:[...t.poly].reverse()}));
    if(footprint.cells&&pockets.some(tool=>!containsPocketWalls(m,tool.poly,cfg.wall,number(project.grid,42))))throw i18nError('Kapsa nástroje nemá uvnitř schodového modulu dost místa na stěnu.');
    const rings=union(pockets.flatMap(t=>subtract(offset(t.poly,Math.max(1.2,cfg.wall)),[t.poly])));
    if(fit){if(rings.length)slabs([0,1],[rings]);continue;}
    let feet=[];
    if(cfg.bottomMode==='grid'){
      const occupied=footprint.cells?new Set(footprint.cells.map(cell=>`${cell.x},${cell.y}`)):null;
      for(let y=0;y<m.height-1;y+=42)for(let x=0;x<m.width-1;x+=42){
        if(occupied&&!occupied.has(`${Math.round(x/42)},${Math.round(y/42)}`))continue;
        if(!cellInClip(m,x,y))continue;
        const cx=m.x+x+21,cy=m.y+y+21,a=roundedRect(cx-17.8,cy-17.8,35.6,35.6,.8),b=roundedRect(cx-18.6,cy-18.6,37.2,37.2,1.6),c=roundedRect(cx-20.75,cy-20.75,41.5,41.5,3.75);
        face([a],0,false);loft(a,b,0,.8);loft(b,b,.8,2.6);loft(b,c,2.6,4.75);feet.push(c);
      }
      feet=union(feet);
    }
    const bottom=cfg.footHeight,baseTop=bottom+cfg.effectiveBaseMm,H=bottom+cfg.height+cfg.extraBase;
    let magnets=[];
    if(cfg.bottomMode==='magnet'){
      const r=cfg.magnetDiameter/2,edge=Math.max(1.2,cfg.wall),inset=r+edge;
      if(Math.min(m.width-.5,m.height-.5)<2*cfg.magnetDiameter+2*edge+.5)throw i18nError('Modul „{name}“ je příliš malý pro čtyři bezpečně oddělené magnetové kapsy.',{name:m.name||m.id});
      if(!footprint.cells)for(const x of [m.x+.25+inset,m.x+m.width-.25-inset])for(const y of [m.y+.25+inset,m.y+m.height-.25-inset])magnets.push(circle(x,y,r));
      else{
        const candidates=[],seen=new Set(),grid=number(project.grid,42);
        const consider=(x,y)=>{const id=`${round(x)},${round(y)}`;if(seen.has(id))return;seen.add(id);const poly=circle(x,y,r);if(containsPocketWalls(m,poly,edge,grid))candidates.push({x,y,poly});};
        for(const x of [m.x+.25+inset,m.x+m.width-.25-inset])for(const y of [m.y+.25+inset,m.y+m.height-.25-inset])consider(x,y);
        for(const cell of footprint.cells){const x=m.x+cell.x*grid,y=m.y+cell.y*grid;consider(x+grid/2,y+grid/2);for(const dx of [.25+inset,grid-.25-inset])for(const dy of [.25+inset,grid-.25-inset])consider(x+dx,y+dy);}
        const chosen=[];
        while(chosen.length<4){
          const eligible=candidates.filter(p=>chosen.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>=2*r+edge+.5-EPS));
          eligible.sort((a,b)=>{const score=p=>chosen.length?Math.min(...chosen.map(q=>Math.hypot(p.x-q.x,p.y-q.y))):Math.hypot(p.x-(m.x+m.width/2),p.y-(m.y+m.height/2));return score(b)-score(a)||a.y-b.y||a.x-b.x;});
          if(!eligible.length)throw i18nError('Modul „{name}“ je příliš malý pro čtyři bezpečně oddělené magnetové kapsy.',{name:m.name||m.id});chosen.push(eligible[0]);
        }
        magnets=chosen.map(p=>p.poly);
      }
    }
    const labels=labelPlan.labels.filter(label=>label.moduleId===m.id&&touchesClip(label.plate));
    if((clip&&cfg.printMode!=='light')||!disjointComponents(outer,pockets,labels,bottom,baseTop,H,magnets,feet)){
    const levels=[bottom,baseTop,...pockets.map(t=>cfg.printMode==='light'?baseTop+number(t.depth,10):H-number(t.depth,10)),cfg.printMode==='solid'?H:baseTop];
    if(magnets.length)levels.push(cfg.magnetDepth);
    const barriers=labels.length?new Set(levels.map(round)):null;
    levels.push(...labels.flatMap(label=>[label.top-label.depth,label.top]));
    const z=[...new Set(levels.map(round))].sort((a,b)=>a-b),sections=[];
    for(let i=0;i<z.length-1;i++){
      const middle=(z[i]+z[i+1])/2;let section;
      if(cfg.printMode==='light'){
        const active=[...pockets.filter(t=>middle<baseTop+number(t.depth,10)-EPS).flatMap(t=>subtract(offset(t.poly,cfg.wall),[t.poly])),...labels.filter(label=>middle<label.top-EPS).map(label=>label.plate)];
        section=middle<baseTop-EPS?[outer]:clip?active:union(active);
      }
      else section=subtract([outer],pockets.filter(t=>middle>=H-number(t.depth,10)-EPS).map(t=>t.poly));
      if(magnets.length&&middle<cfg.magnetDepth-EPS)section=subtract(section,magnets);
      const lettering=labels.filter(label=>middle>=label.top-label.depth-EPS&&middle<label.top-EPS).flatMap(label=>label.polygons);
      if(lettering.length)section=subtract(section,lettering);
      sections.push(section);
    }
    slabs(z,sections,feet,barriers);
    }
    const stitched=stitchBoundaryEdges(triangles.splice(start),{canonical:!!clip});for(const triangle of stitched)triangles.push(triangle);
    if(triangles.length>120000)throw i18nError('Model je pro jeden export příliš složitý. Exportujte jednotlivé moduly.');
  }
  const result=fit?stitchBoundaryEdges(triangles,{canonical:!!clip}):triangles;
  validatePrintMesh(result);
  return result;
}

/** Validate the exact float32 surface sent to STL, at the same 0.00001 mm edge precision as QA. */
export function validatePrintMesh(triangles){
  if(!triangles.length)return;
  const fail=()=>{throw i18nError('Model nelze bezpečně vytisknout. Zkuste nástroje rozdělit do samostatných modulů.');};
  const edges=new Map(),key=point=>point.map(value=>Math.round(Math.fround(value)*1e5)).join(',');let volume=0;
  for(const triangle of triangles){
    if(triangle.length!==3||triangle.some(point=>point.length!==3||point.some(value=>!Number.isFinite(value))))fail();
    const points=triangle.map(point=>point.map(Math.fround)),keys=points.map(key);
    if(new Set(keys).size!==3)fail();
    const [a,b,c]=points;volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    for(let i=0;i<3;i++){
      const a=keys[i],b=keys[(i+1)%3],edge=a<b?a+'|'+b:b+'|'+a,entry=edges.get(edge)||{count:0,direction:0};
      entry.count++;entry.direction+=a<b?1:-1;edges.set(edge,entry);
    }
  }
  if(!(volume>0&&Number.isFinite(volume)))fail();
  for(const entry of edges.values())if(entry.count!==2||entry.direction!==0)fail();
}

const qaVertexKey=p=>p.map(value=>Math.round(Math.fround(value)*1e5)).join(',');
function canonicalCutVertices(triangles){
  // Half of the existing STL-QA vertex resolution. A Boolean intersection may
  // otherwise land less than 0.000005 mm apart across the same QA-bin boundary.
  const step=.000005,buckets=new Map(),exact=new Map();
  return triangles.map(triangle=>triangle.map(point=>{
    const token=point.join(',');if(exact.has(token))return exact.get(token);
    const cell=point.map(value=>Math.floor(value/step));let found=null;
    for(let x=-1;x<=1&&!found;x++)for(let y=-1;y<=1&&!found;y++)for(let z=-1;z<=1&&!found;z++){
      const nearby=buckets.get(`${cell[0]+x},${cell[1]+y},${cell[2]+z}`)||[];
      found=nearby.find(p=>Math.hypot(point[0]-p[0],point[1]-p[1],point[2]-p[2])<step)||null;
    }
    if(!found){const id=cell.join(',');if(!buckets.has(id))buckets.set(id,[]);buckets.get(id).push(point);found=point;}
    exact.set(token,found);return found;
  }));
}

/** Split polygon-Boolean T-junctions without dropping collinear boundary vertices. */
function stitchBoundaryEdges(triangles,{canonical=false}={}){
  if(canonical)triangles=canonicalCutVertices(triangles);
  const key=canonical?qaVertexKey:p=>p.map(v=>Math.round(v*1e5)).join(','),edges=new Map();
  for(const t of triangles)for(let i=0;i<3;i++){const a=t[i],b=t[(i+1)%3],ka=key(a),kb=key(b),k=ka<kb?ka+'|'+kb:kb+'|'+ka;const e=edges.get(k)||{count:0,a,b};e.count++;edges.set(k,e);}
  const unmatched=[...edges.values()].filter(e=>e.count!==2),points=[...new Map(unmatched.flatMap(e=>[e.a,e.b]).map(p=>[key(p),p])).values()];
  if(!points.length)return cancelOppositeFaces(triangles,{canonical});
  const splits=new Map();
  for(const e of unmatched){
    const d=e.b.map((v,i)=>v-e.a[i]),length=d.reduce((s,v)=>s+v*v,0),on=[];
    // Allow sub-grid clipping error at real T-junctions. A tolerance larger than
    // the clipping grid also admitted nearby distinct edges and made thin
    // triangle perimeters backtrack over their own corners.
    for(const p of points){const t=p.reduce((s,v,i)=>s+(v-e.a[i])*d[i],0)/length;if(t<1e-7||t>1-1e-7)continue;const distance=Math.hypot(...p.map((v,i)=>v-e.a[i]-t*d[i]));if(distance<.00004)on.push({p,t});}
    if(on.length){on.sort((a,b)=>a.t-b.t);splits.set(key(e.a)+'|'+key(e.b),on.map(x=>x.p));splits.set(key(e.b)+'|'+key(e.a),on.map(x=>x.p).reverse());}
  }
  const result=[];
  for(const t of triangles){
    const perimeter=[];let changed=false;
    for(let i=0;i<3;i++){perimeter.push(t[i]);const extra=splits.get(key(t[i])+'|'+key(t[(i+1)%3]));if(extra){perimeter.push(...extra);changed=true;}}
    if(!changed){result.push(t);continue;}
    const center=[0,1,2].map(i=>(t[0][i]+t[1][i]+t[2][i])/3);
    for(let i=0;i<perimeter.length;i++)result.push([center,perimeter[i],perimeter[(i+1)%perimeter.length]]);
  }
  return cancelOppositeFaces(result,{canonical});
}

// Nearly collinear Boolean edges can visit the same stitching interval twice.
// Opposing, coincident fan patches have no boundary surface. Default exports
// pair exact Float32 vertices; clipped exports use the existing STL-QA resolution.
// Keep every unmatched face and its winding.
function cancelOppositeFaces(triangles,{canonical=false}={}){
  if(canonical)triangles=canonicalCutVertices(triangles);
  const pending=new Map(),keep=new Uint8Array(triangles.length).fill(1);
  for(let i=0;i<triangles.length;i++){
    const keys=triangles[i].map(p=>canonical?qaVertexKey(p):p.map(Math.fround).join(',')),sorted=[...keys].sort();
    // A stitching point may round onto its neighbour in the binary STL. This
    // collapsed fan has no area and must not contribute the same edge twice.
    if(new Set(keys).size<3){keep[i]=0;continue;}
    const start=keys.indexOf(sorted[0]),direction=keys[(start+1)%3]<keys[(start+2)%3]?0:1,key=sorted.join('|'),pair=pending.get(key)||[[],[]];
    if(pair[1-direction].length){keep[pair[1-direction].pop()]=0;keep[i]=0;}
    else pair[direction].push(i);
    pending.set(key,pair);
  }
  return triangles.filter((triangle,i)=>keep[i]);
}

export function trianglesVolume(triangles){return Math.abs(triangles.reduce((s,[a,b,c])=>s+(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6,0));}
export function encodeSTL(triangles,label='Suplik Studio | mm'){
  if(!triangles.length)throw i18nError('Pro tento export nejsou k dispozici žádné kontury.');
  const bytes=new Uint8Array(84+triangles.length*50),view=new DataView(bytes.buffer);bytes.set(new TextEncoder().encode(label).slice(0,80));view.setUint32(80,triangles.length,true);let offset=84;
  for(const [a,b,c] of triangles){const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);let normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal);normal=normal.map(v=>length?v/length:0);for(const xyz of [normal,a,b,c])for(const value of xyz){view.setFloat32(offset,value,true);offset+=4;}view.setUint16(offset,0,true);offset+=2;}
  return bytes;
}
