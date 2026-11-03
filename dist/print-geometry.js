import earcut from './vendor/earcut.js';
import Clipper from './vendor/clipper.js';
import {i18nError} from './i18n.js';
import {fmtLen,fmtSize} from './units.js';

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

export function validatePrintBed(project,modules){
  if(!project.limitToBed)return;
  const width=number(project.bedWidth,220),height=number(project.bedHeight,220);
  if(!(width>0&&height>0))throw i18nError('Zadejte kladné rozměry tiskové plochy.');
  const tooBig=modules.find(m=>!((m.width-.5<=width+EPS&&m.height-.5<=height+EPS)||(m.height-.5<=width+EPS&&m.width-.5<=height+EPS)));
  if(tooBig)throw i18nError('Modul „{name}“ se nevejde na tiskovou plochu {size} ani po otočení. Zmenšete modul nebo zvětšete tiskovou plochu.',{name:tooBig.name||tooBig.id,size:fmtSize(width,height)});
}

/** Build non-overlapping material slabs, then expose only their actual boundary faces. */
export function buildPrintTriangles(project,modules,tools,origin={x:0,y:0},{fit=false}={}){
  const cfg=printConfig(fit?{...project,bottomMode:'plain'}:project),triangles=[];
  const cellCount=modules.reduce((sum,m)=>sum+Math.round(m.width/42)*Math.round(m.height/42),0);
  if(!fit&&cfg.bottomMode==='grid'&&cellCount>400)throw i18nError('Najednou lze vytvořit nejvýše 400 Gridfinity patek. Exportujte sestavu po jednotlivých modulech.');
  if(tools.reduce((sum,t)=>sum+t.poly.length,0)>20000)throw i18nError('Kontury jsou pro jeden export příliš složité. Exportujte jednotlivé moduly.');
  const v=(p,z)=>[round(p.x-origin.x),round(p.y-origin.y),round(z)];
  const add=(a,b,c)=>{if(triangles.length>=120000)throw i18nError('Model je pro jeden export příliš složitý. Exportujte jednotlivé moduly.');const u=b.map((x,i)=>x-a[i]),w=c.map((x,i)=>x-a[i]);if(Math.hypot(u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0])>1e-9)triangles.push([a,b,c]);};
  function face(paths,z,up){
    for(const region of regions(paths)){
      const polygons=[region.outer,...region.holes],data=[],holes=[];let count=0;
      for(let i=0;i<polygons.length;i++){if(i)holes.push(count);for(const p of polygons[i]){data.push(p.x,p.y);count++;}}
      const indexes=earcut(data,holes,2);
      for(let i=0;i<indexes.length;i+=3){let a={x:data[indexes[i]*2],y:data[indexes[i]*2+1]},b={x:data[indexes[i+1]*2],y:data[indexes[i+1]*2+1]},c={x:data[indexes[i+2]*2],y:data[indexes[i+2]*2+1]};const ccw=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)>0;if(ccw!==up)[b,c]=[c,b];add(v(a,z),v(b,z),v(c,z));}
    }
  }
  function sides(paths,z0,z1){for(const poly of paths)for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];add(v(a,z0),v(b,z0),v(b,z1));add(v(a,z0),v(b,z1),v(a,z1));}}
  function slabs(levels,sections,bottom=[]){
    let below=bottom;
    for(let i=0;i<sections.length;i++){
      const current=sections[i];face(subtract(current,below),levels[i],false);face(subtract(below,current),levels[i],true);sides(current,levels[i],levels[i+1]);below=current;
    }
    face(below,levels.at(-1),true);
  }
  function loft(a,b,z0,z1){
    for(let i=0;i<a.length;i++){const j=(i+1)%a.length;add(v(a[i],z0),v(a[j],z0),v(b[j],z1));add(v(a[i],z0),v(b[j],z1),v(b[i],z1));}
  }
  for(const m of modules){
    const start=triangles.length;
    if(cfg.bottomMode==='grid'&&!fit&&[m.x,m.y,m.width,m.height].some(value=>Math.abs(value/42-Math.round(value/42))>.0001))throw i18nError('Modul „{name}“ musí mít rozměry i polohu v násobcích 42 mm pro Gridfinity patky.',{name:m.name||m.id});
    const own=tools.filter(t=>t.moduleId===m.id),outer=cfg.bottomMode==='grid'&&!fit?roundedRect(m.x+.25,m.y+.25,m.width-.5,m.height-.5,3.75):rect(m.x+.25,m.y+.25,m.width-.5,m.height-.5);
    const pockets=own.map(t=>({...t,poly:signedArea(t.poly)>0?t.poly:[...t.poly].reverse()}));
    const rings=union(pockets.flatMap(t=>subtract(offset(t.poly,Math.max(1.2,cfg.wall)),[t.poly])));
    if(fit){if(rings.length)slabs([0,1],[rings]);continue;}
    let feet=[];
    if(cfg.bottomMode==='grid'){
      for(let y=0;y<m.height-1;y+=42)for(let x=0;x<m.width-1;x+=42){
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
      for(const x of [m.x+.25+inset,m.x+m.width-.25-inset])for(const y of [m.y+.25+inset,m.y+m.height-.25-inset])magnets.push(circle(x,y,r));
    }
    const levels=[bottom,baseTop,...pockets.map(t=>cfg.printMode==='light'?baseTop+number(t.depth,10):H-number(t.depth,10)),cfg.printMode==='solid'?H:baseTop];
    if(magnets.length)levels.push(cfg.magnetDepth);
    const z=[...new Set(levels.map(round))].sort((a,b)=>a-b),sections=[];
    for(let i=0;i<z.length-1;i++){
      const middle=(z[i]+z[i+1])/2;let section;
      if(cfg.printMode==='light')section=middle<baseTop-EPS?[outer]:union(pockets.filter(t=>middle<baseTop+number(t.depth,10)-EPS).flatMap(t=>subtract(offset(t.poly,cfg.wall),[t.poly])));
      else section=subtract([outer],pockets.filter(t=>middle>=H-number(t.depth,10)-EPS).map(t=>t.poly));
      if(magnets.length&&middle<cfg.magnetDepth-EPS)section=subtract(section,magnets);
      sections.push(section);
    }
    slabs(z,sections,feet);
    const stitched=stitchBoundaryEdges(triangles.splice(start));for(const triangle of stitched)triangles.push(triangle);
    if(triangles.length>120000)throw i18nError('Model je pro jeden export příliš složitý. Exportujte jednotlivé moduly.');
  }
  return fit?stitchBoundaryEdges(triangles):triangles;
}

/** Split polygon-Boolean T-junctions without dropping collinear boundary vertices. */
function stitchBoundaryEdges(triangles){
  const key=p=>p.map(v=>Math.round(v*1e5)).join(','),edges=new Map();
  for(const t of triangles)for(let i=0;i<3;i++){const a=t[i],b=t[(i+1)%3],ka=key(a),kb=key(b),k=ka<kb?ka+'|'+kb:kb+'|'+ka;const e=edges.get(k)||{count:0,a,b};e.count++;edges.set(k,e);}
  const unmatched=[...edges.values()].filter(e=>e.count!==2),points=[...new Map(unmatched.flatMap(e=>[e.a,e.b]).map(p=>[key(p),p])).values()];
  if(!points.length)return triangles;
  const splits=new Map();
  for(const e of unmatched){
    const d=e.b.map((v,i)=>v-e.a[i]),length=d.reduce((s,v)=>s+v*v,0),on=[];
    for(const p of points){const t=p.reduce((s,v,i)=>s+(v-e.a[i])*d[i],0)/length;if(t<1e-7||t>1-1e-7)continue;const distance=Math.hypot(...p.map((v,i)=>v-e.a[i]-t*d[i]));if(distance<.00016)on.push({p,t});}
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
  return result;
}

export function trianglesVolume(triangles){return Math.abs(triangles.reduce((s,[a,b,c])=>s+(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6,0));}
export function encodeSTL(triangles,label='Suplik Studio | mm'){
  if(!triangles.length)throw i18nError('Pro tento export nejsou k dispozici žádné kontury.');
  const bytes=new Uint8Array(84+triangles.length*50),view=new DataView(bytes.buffer);bytes.set(new TextEncoder().encode(label).slice(0,80));view.setUint32(80,triangles.length,true);let offset=84;
  for(const [a,b,c] of triangles){const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);let normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal);normal=normal.map(v=>length?v/length:0);for(const xyz of [normal,a,b,c])for(const value of xyz){view.setFloat32(offset,value,true);offset+=4;}view.setUint16(offset,0,true);offset+=2;}
  return bytes;
}
