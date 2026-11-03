import Clipper from './vendor/clipper.js';
import {t,i18nError} from './i18n.js';
import {fmtLen} from './units.js';

const SCALE=10000,EPS=1e-7;
const numeric=(value,min,max,label,length=true)=>{
  if(value===null||typeof value==='boolean'||(typeof value==='string'&&!value.trim()))throw i18nError('Neplatná hodnota: {label}.',{label:t(label)});
  const result=Number(value);
  if(!Number.isFinite(result)||result<min||result>max)throw i18nError('Neplatná hodnota: {label} ({range}).',{label:t(label),range:length?`${fmtLen(min,{suffix:false})}–${fmtLen(max)}`:`${min}–${max}`});
  return result;
};
const area=points=>points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)/2;
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function clean(points){
  let out=points.filter((p,i)=>!i||Math.hypot(p.x-points[i-1].x,p.y-points[i-1].y)>EPS);
  if(out.length>2&&Math.hypot(out[0].x-out.at(-1).x,out[0].y-out.at(-1).y)<EPS)out.pop();
  let changed=true;
  while(changed&&out.length>3){
    changed=false;
    out=out.filter((p,i,a)=>{const before=a[(i+a.length-1)%a.length],after=a[(i+1)%a.length],forward=(p.x-before.x)*(after.x-p.x)+(p.y-before.y)*(after.y-p.y);const keep=Math.abs(cross(before,p,after))>EPS||forward<0;if(!keep)changed=true;return keep;});
  }
  return out;
}
function rawPoints(tool){
  if(!Array.isArray(tool?.points)||tool.points.length<3||tool.points.length>6000)throw i18nError('Nástroj nemá platnou konturu pro výřez pro prsty.');
  const points=clean(tool.points.map(p=>({x:numeric(p?.x,-1000000,1000000,'bod X'),y:numeric(p?.y,-1000000,1000000,'bod Y')})));
  if(points.length<3||Math.abs(area(points))<EPS)throw i18nError('Nástroj nemá platnou plochu pro výřez pro prsty.');
  return points;
}
const toInt=points=>{
  const path=points.map(p=>({X:Math.round(p.x*SCALE),Y:Math.round(p.y*SCALE)}));
  if(!Clipper.Clipper.Orientation(path))path.reverse();
  return path;
};
const fromInt=path=>clean(path.map(p=>({x:p.X/SCALE,y:p.Y/SCALE})));
function combine(subject,clip=[],operation=Clipper.ClipType.ctUnion){
  const engine=new Clipper.Clipper(),result=[];engine.StrictlySimple=true;
  engine.AddPaths(subject.map(toInt),Clipper.PolyType.ptSubject,true);
  if(clip.length)engine.AddPaths(clip.map(toInt),Clipper.PolyType.ptClip,true);
  engine.Execute(operation,result,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero);
  return result.map(fromInt).filter(path=>path.length>=3&&Math.abs(area(path))>EPS);
}
function offset(points,distance){
  if(!distance)return points;
  const engine=new Clipper.ClipperOffset(2,.015*SCALE),result=[];
  engine.AddPath(toInt(points),Clipper.JoinType.jtRound,Clipper.EndType.etClosedPolygon);
  engine.Execute(result,distance*SCALE);
  if(result.length!==1)throw i18nError('Vůle nevytvořila jednu jednoznačnou kapsu nástroje.');
  return fromInt(result[0]);
}
function circle(grip){
  // Multiples of four retain the exact radius at cardinal extrema; chord error
  // stays below 0.01 mm and is independent of the tool's manufacturing clearance.
  const segments=Math.max(32,Math.ceil(Math.PI/Math.acos(1-.01/grip.radius)/4)*4);
  return Array.from({length:segments},(_,i)=>{const angle=i*Math.PI*2/segments;return{x:grip.x+Math.cos(angle)*grip.radius,y:grip.y+Math.sin(angle)*grip.radius};});
}

/** Centers use the same raw local millimetres as tool.points. [] records deletion. */
export function validateFingerGrips(grips,{minX=0,minY=0}={}){
  if(!Array.isArray(grips)||grips.length>12)throw i18nError('Výřezy pro prsty musí být pole s nejvýše 12 položkami.');
  const dx=numeric(minX,-6000,6000,'počátek X'),dy=numeric(minY,-6000,6000,'počátek Y'),ids=new Set();
  return grips.map(grip=>{
    if(!grip||typeof grip!=='object'||typeof grip.id!=='string'||!grip.id.trim()||grip.id.length>100)throw i18nError('Výřez pro prsty musí mít platný identifikátor.');
    if(ids.has(grip.id))throw i18nError('Duplicitní identifikátor výřezu pro prsty.');ids.add(grip.id);
    const x=numeric(grip.x,-6000,6000,'X výřezu pro prsty')-dx,y=numeric(grip.y,-6000,6000,'Y výřezu pro prsty')-dy;
    return{id:grip.id,x:numeric(x,-6000,6000,'X výřezu pro prsty'),y:numeric(y,-6000,6000,'Y výřezu pro prsty'),radius:numeric(grip.radius,2,40,'poloměr výřezu pro prsty')};
  });
}

/** One world-space pocket. Adding grips never changes the raw rotated-bounds anchor. */
export function pocketOutline(tool,clearance=0){
  const points=rawPoints(tool),minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y));
  const rotation=numeric(tool.rotation??0,-1000000,1000000,'otočení',false)*Math.PI/180,c=Math.cos(rotation),s=Math.sin(rotation);
  const rotate=p=>({x:(p.x-minX)*c-(p.y-minY)*s,y:(p.x-minX)*s+(p.y-minY)*c});
  const rotated=points.map(rotate),bx=Math.min(...rotated.map(p=>p.x)),by=Math.min(...rotated.map(p=>p.y));
  const x=numeric(tool.x??0,-1000000,1000000,'pozice X'),y=numeric(tool.y??0,-1000000,1000000,'pozice Y');
  const world=p=>{const q=rotate(p);return{x:q.x-bx+x,y:q.y-by+y};};
  const base=offset(rotated.map(p=>({x:p.x-bx+x,y:p.y-by+y})),numeric(clearance,0,6000,'vůle kapsy'));
  const grips=Object.hasOwn(tool,'fingerGrips')?validateFingerGrips(tool.fingerGrips):[];
  if(!grips.length)return base;
  const circles=grips.map(grip=>circle({...grip,...world(grip)}));
  for(const polygon of circles){
    const intersection=combine([base],[polygon],Clipper.ClipType.ctIntersection);
    if(intersection.reduce((sum,path)=>sum+Math.abs(area(path)),0)<.0001)throw i18nError('Výřez pro prsty musí plošně navazovat na kapsu nástroje. Posuňte jej blíž k obrysu.');
  }
  const result=combine([base,...circles]);
  if(result.length!==1)throw i18nError('Výřezy pro prsty nevytvářejí jednu jednoznačnou spojenou kapsu. Upravte jejich polohu nebo poloměr.');
  return result[0];
}

function mainAxis(points){
  let mass=0,cx=0,cy=0,xx=0,yy=0,xy=0;
  for(let i=0;i<points.length;i++){
    const p=points[i],q=points[(i+1)%points.length],weight=p.x*q.y-q.x*p.y;
    mass+=weight;cx+=(p.x+q.x)*weight;cy+=(p.y+q.y)*weight;
    xx+=(p.x*p.x+p.x*q.x+q.x*q.x)*weight;yy+=(p.y*p.y+p.y*q.y+q.y*q.y)*weight;
    xy+=(2*p.x*p.y+p.x*q.y+q.x*p.y+2*q.x*q.y)*weight;
  }
  cx/=3*mass;cy/=3*mass;
  const angle=.5*Math.atan2(2*(xy/(12*mass)-cx*cy),xx/(6*mass)-cx*cx-yy/(6*mass)+cy*cy);
  return{x:Math.cos(angle),y:Math.sin(angle)};
}

/** Two opposed circles near a broad, central, genuinely filled cross-section. */
export function automaticFingerGrips(tool,{radius=9}={}){
  radius=numeric(radius,2,40,'poloměr výřezu pro prsty');
  const points=rawPoints(tool),axis=mainAxis(points),normal={x:-axis.y,y:axis.x};
  const along=points.map(p=>p.x*axis.x+p.y*axis.y),lo=Math.min(...along),length=Math.max(...along)-lo,candidates=[];
  for(const fraction of [.5,.4,.6,.3,.7,.2,.8,.1,.9,.05,.95]){
    const station=lo+length*fraction,crossings=[];
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length],sa=along[i],sb=along[(i+1)%points.length];
      if((sa>station)!==(sb>station)){const t=(station-sa)/(sb-sa);crossings.push((a.x+(b.x-a.x)*t)*normal.x+(a.y+(b.y-a.y)*t)*normal.y);}
    }
    crossings.sort((a,b)=>a-b);
    for(let i=0;i+1<crossings.length;i+=2){
      const left=crossings[i],right=crossings[i+1],width=right-left;
      if(width>.01)candidates.push({station,left,right,width,score:width*(1-.7*Math.abs(fraction-.5))});
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  const prefix=String(tool.id||'tool').slice(0,80);
  for(const candidate of candidates){
    const inset=Math.min(radius*.15,candidate.width*.2);
    const grips=[candidate.left+inset,candidate.right-inset].map((across,i)=>({id:`${prefix}-finger-${i+1}`,x:axis.x*candidate.station+normal.x*across,y:axis.y*candidate.station+normal.y*across,radius}));
    try{pocketOutline({...tool,fingerGrips:grips},0);return grips;}catch{}
  }
  throw i18nError('Pro tento obrys se nepodařilo automaticky umístit připojené výřezy pro prsty.');
}
