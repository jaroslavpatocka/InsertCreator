// Intrinsic outline dimensions. Editing length never implicitly changes width or nominal tool size.
import {bounds} from './geometry.js';
import {pocketOutline} from './finger-grip.js';
import {clone} from './model.js';
import {i18nError} from './i18n.js';
import {fmtLen} from './units.js';

const EPS=1e-9,MAX=3000;
const invalidOutline=()=>i18nError('Nástroj nemá platnou konturu pro změnu rozměrů.');
function frame(tool){
  if(!Array.isArray(tool?.points)||tool.points.length<3||tool.points.length>6000)throw invalidOutline();
  const points=tool.points.map(point=>{
    if(!point||typeof point.x!=='number'||typeof point.y!=='number'||!Number.isFinite(point.x)||!Number.isFinite(point.y))throw invalidOutline();
    return{x:point.x,y:point.y};
  });
  let mass=0,cx=0,cy=0,xx=0,yy=0,xy=0;
  for(let i=0;i<points.length;i++){
    const p=points[i],q=points[(i+1)%points.length],weight=p.x*q.y-q.x*p.y;
    mass+=weight;cx+=(p.x+q.x)*weight;cy+=(p.y+q.y)*weight;
    xx+=(p.x*p.x+p.x*q.x+q.x*q.x)*weight;yy+=(p.y*p.y+p.y*q.y+q.y*q.y)*weight;
    xy+=(2*p.x*p.y+p.x*q.y+q.x*p.y+2*q.x*q.y)*weight;
  }
  if(Math.abs(mass)<EPS)throw invalidOutline();cx/=3*mass;cy/=3*mass;
  const angle=.5*Math.atan2(2*(xy/(12*mass)-cx*cy),xx/(6*mass)-cx*cx-yy/(6*mass)+cy*cy);
  const axis={x:Math.cos(angle),y:Math.sin(angle)},normal={x:-axis.y,y:axis.x};
  const along=points.map(p=>p.x*axis.x+p.y*axis.y),across=points.map(p=>p.x*normal.x+p.y*normal.y);
  const minA=Math.min(...along),maxA=Math.max(...along),minB=Math.min(...across),maxB=Math.max(...across);
  const length=maxA-minA,width=maxB-minB;
  if(!(length>EPS&&width>EPS&&Number.isFinite(length)&&Number.isFinite(width)))throw invalidOutline();
  const center={x:axis.x*(minA+maxA)/2+normal.x*(minB+maxB)/2,y:axis.y*(minA+maxA)/2+normal.y*(minB+maxB)/2};
  return{length,width,axis,normal,center};
}

/** Raw-contour dimensions along its area principal axes; independent of placement and tool.rotation. */
export function getToolDimensions(tool){const {length,width,axis}=frame(tool);return{length,width,axis:{...axis}};}

function dimension(value){
  if(!['number','string'].includes(typeof value)||(typeof value==='string'&&!value.trim()))throw i18nError('Zadejte platnou délku a šířku nástroje.');
  const number=Number(value);
  if(!Number.isFinite(number)||number<2||number>MAX)throw i18nError('Rozměry nástroje musí být od {min} do {max}.',{min:fmtLen(2),max:fmtLen(MAX)});
  return number;
}

/** Affine stretch in the intrinsic frame. Manual grip centres follow the outline; their real radii stay fixed. */
export function resizeToolDimensions(tool,dimensions={}){
  if(!dimensions||typeof dimensions!=='object'||Array.isArray(dimensions))throw i18nError('Zadejte platnou délku a šířku nástroje.');
  const original=frame(tool),length=Object.hasOwn(dimensions,'length')?dimension(dimensions.length):original.length,width=Object.hasOwn(dimensions,'width')?dimension(dimensions.width):original.width;
  const longitudinal=length/original.length,transverse=width/original.width;
  if([longitudinal,transverse].some(factor=>factor<.2-EPS||factor>5+EPS))throw i18nError('Měřítko nástroje musí být mezi {min}× a {max}×.',{min:.2,max:5});
  const next=clone(tool);if(Math.abs(longitudinal-1)<EPS&&Math.abs(transverse-1)<EPS)return next;
  pocketOutline(tool,0);
  const {axis,normal,center}=original;
  const transform=point=>{
    const dx=point.x-center.x,dy=point.y-center.y,a=(dx*axis.x+dy*axis.y)*longitudinal,b=(dx*normal.x+dy*normal.y)*transverse;
    return{x:center.x+axis.x*a+normal.x*b,y:center.y+axis.y*a+normal.y*b};
  };
  next.points=tool.points.map(transform);
  const minX=Math.min(...next.points.map(p=>p.x)),minY=Math.min(...next.points.map(p=>p.y));
  next.points=next.points.map(p=>({x:p.x-minX,y:p.y-minY}));
  if(Math.max(...next.points.map(p=>p.x))>MAX+EPS||Math.max(...next.points.map(p=>p.y))>MAX+EPS)throw i18nError('Kontura nesmí v žádném směru přesáhnout {max}.',{max:fmtLen(MAX)});
  // Snap arithmetic overshoot at the model's strict coordinate limit.
  next.points=next.points.map(p=>({x:Math.min(MAX,p.x),y:Math.min(MAX,p.y)}));
  if(Array.isArray(tool.fingerGrips))next.fingerGrips=tool.fingerGrips.map(grip=>{const p=transform(grip);return{...grip,x:p.x-minX,y:p.y-minY};});
  const measured=frame(next),tolerance=Math.max(1,length,width)*1e-7;
  if(Math.abs(measured.length-length)>tolerance||Math.abs(measured.width-width)>tolerance||Math.abs(measured.axis.x*axis.x+measured.axis.y*axis.y)<1-1e-6)throw i18nError('Zadané rozměry by změnily podélnou osu nástroje. Zvolte delší nebo užší obrys.');
  const before=bounds(tool),after=bounds(next);
  next.x=(tool.x??0)+(before.width-after.width)/2;next.y=(tool.y??0)+(before.height-after.height)/2;
  try{pocketOutline(next,0);}catch{throw i18nError('Výřezy pro prsty by po změně rozměrů nebyly platné. Upravte jejich polohu nebo průměr.');}
  return next;
}
