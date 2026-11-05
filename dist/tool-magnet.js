// Holding magnets in a pocket floor: blind holes opening upwards under the tool.
// A stored entry describes the real magnet in the same raw local millimetres as
// tool.points. The printed hole adds a fixed fit allowance to that size.
import {pocketOutline,toolWorldPoint} from './finger-grip.js';
import {t,i18nError} from './i18n.js';
import {fmtLen} from './units.js';

export const POCKET_MAGNET_LIMITS={diameter:{min:2,max:40},height:{min:.5,max:20},count:12};
export const POCKET_MAGNET_DEFAULT={diameter:6,height:2};
// Same fit as the bottom-mode holes: a 6 × 2 mm magnet gets a Ø 6.2 × 2.2 mm hole.
export const MAGNET_HOLE_PLAY=.2;
// Material left under a hole, and between a hole and any other cavity.
export const MAGNET_COVER=1.2;
// Floor rim kept between a hole and the pocket wall, and between two holes.
export const MAGNET_RIM=.8;

const numeric=(value,min,max,label,length=true)=>{
  if(value===null||typeof value==='boolean'||(typeof value==='string'&&!value.trim()))throw i18nError('Neplatná hodnota: {label}.',{label:t(label)});
  const result=Number(value);
  if(!Number.isFinite(result)||result<min||result>max)throw i18nError('Neplatná hodnota: {label} ({range}).',{label:t(label),range:length?`${fmtLen(min,{suffix:false})}–${fmtLen(max)}`:`${min}–${max}`});
  return result;
};

/** Centers use the same raw local millimetres as tool.points; [] records "no magnets". */
export function validatePocketMagnets(magnets,{minX=0,minY=0}={}){
  const {diameter,height,count}=POCKET_MAGNET_LIMITS;
  if(!Array.isArray(magnets)||magnets.length>count)throw i18nError('Magnety v kapse musí být pole s nejvýše {count} položkami.',{count});
  const ids=new Set();
  return magnets.map(magnet=>{
    if(!magnet||typeof magnet!=='object'||typeof magnet.id!=='string'||!magnet.id.trim()||magnet.id.length>100)throw i18nError('Magnet v kapse musí mít platný identifikátor.');
    if(ids.has(magnet.id))throw i18nError('Duplicitní identifikátor magnetu v kapse.');ids.add(magnet.id);
    return{id:magnet.id,x:numeric(numeric(magnet.x,-6000,6000,'X magnetu')-minX,-6000,6000,'X magnetu'),y:numeric(numeric(magnet.y,-6000,6000,'Y magnetu')-minY,-6000,6000,'Y magnetu'),diameter:numeric(magnet.diameter,diameter.min,diameter.max,'průměr magnetu'),height:numeric(magnet.height,height.min,height.max,'výška magnetu')};
  });
}

export const hasPocketMagnets=tool=>Array.isArray(tool?.pocketMagnets)&&tool.pocketMagnets.length>0;
export const magnetHoleDiameter=magnet=>Number(magnet.diameter)+MAGNET_HOLE_PLAY;
export const magnetHoleDepth=magnet=>Number(magnet.height)+MAGNET_HOLE_PLAY;

/** Printed holes of a placed tool, in the same world frame as its pocket outline. */
export function pocketMagnetHoles(tool){
  if(!hasPocketMagnets(tool))return[];
  const world=toolWorldPoint(tool);
  return tool.pocketMagnets.map(magnet=>({...world(magnet),radius:magnetHoleDiameter(magnet)/2,depth:magnetHoleDepth(magnet)}));
}

function boundaryDistance(point,polygon){
  let best=Infinity;
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
    const u=length?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length)):0;
    best=Math.min(best,Math.hypot(point.x-a.x-u*dx,point.y-a.y-u*dy));
  }
  return best;
}
function inside(point,polygon){
  let result=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)result=!result;
  }
  return result;
}
const fitsPocket=(hole,pocket)=>inside(hole,pocket)&&boundaryDistance(hole,pocket)>=hole.radius+MAGNET_RIM-1e-6;

/** 'wall' when a hole leaves the pocket floor, 'spacing' when two holes merge, otherwise null. */
export function pocketMagnetProblem(tool,pocket){
  const holes=pocketMagnetHoles(tool);
  if(holes.some(hole=>!fitsPocket(hole,pocket)))return'wall';
  for(let i=0;i<holes.length;i++)for(let j=0;j<i;j++)if(Math.hypot(holes[i].x-holes[j].x,holes[i].y-holes[j].y)<holes[i].radius+holes[j].radius+MAGNET_RIM-1e-6)return'spacing';
  return null;
}

/** Evenly spread centers along the tool, on its widest usable floor. Throws when they do not fit. */
export function automaticPocketMagnets(tool,{diameter=POCKET_MAGNET_DEFAULT.diameter,height=POCKET_MAGNET_DEFAULT.height,count=1,clearance=0}={}){
  const [magnet]=validatePocketMagnets([{id:'size',x:0,y:0,diameter,height}]),wanted=Math.round(numeric(count,1,POCKET_MAGNET_LIMITS.count,'počet magnetů',false));
  // Placing the unrotated outline at its own minimum keeps the pocket in tool.points coordinates.
  const raw=tool.points,minX=Math.min(...raw.map(p=>p.x)),minY=Math.min(...raw.map(p=>p.y));
  const pocket=pocketOutline({...tool,x:minX,y:minY,rotation:0,fingerGrips:[]},clearance);
  const maxX=Math.max(...raw.map(p=>p.x)),maxY=Math.max(...raw.map(p=>p.y)),radius=magnetHoleDiameter(magnet)/2,reach=radius+MAGNET_RIM;
  // About 3000 samples bound the cost for dense traced outlines; .25 mm is finer than any hole.
  const step=Math.max(.25,Math.sqrt((maxX-minX)*(maxY-minY)/3000)),candidates=[];
  for(let y=minY+step/2;y<maxY;y+=step)for(let x=minX+step/2;x<maxX;x+=step){
    const point={x,y};if(!inside(point,raw)||!inside(point,pocket))continue;
    const room=boundaryDistance(point,pocket);
    if(room>=reach-1e-6)candidates.push({x,y,room});
  }
  const failure=()=>i18nError('Magnety Ø {diameter} se do této kapsy nevejdou ({count} ks). Zvolte menší magnet nebo menší počet.',{diameter:fmtLen(magnet.diameter),count:wanted});
  if(!candidates.length)throw failure();
  const cx=candidates.reduce((sum,p)=>sum+p.x,0)/candidates.length,cy=candidates.reduce((sum,p)=>sum+p.y,0)/candidates.length;
  let xx=0,yy=0,xy=0;for(const p of candidates){xx+=(p.x-cx)**2;yy+=(p.y-cy)**2;xy+=(p.x-cx)*(p.y-cy);}
  const angle=.5*Math.atan2(2*xy,xx-yy),axis={x:Math.cos(angle),y:Math.sin(angle)},along=p=>(p.x-cx)*axis.x+(p.y-cy)*axis.y;
  const stations=candidates.map(along),low=Math.min(...stations),high=Math.max(...stations),chosen=[],spacing=2*radius+MAGNET_RIM;
  for(let i=0;i<wanted;i++){
    const target=low+(high-low)*(i+.5)/wanted,free=candidates.filter(p=>chosen.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>=spacing-1e-6));
    if(!free.length)throw failure();
    // Stay near the station, but accept a short shift towards a wider part of the floor.
    const score=p=>Math.abs(along(p)-target)-Math.min(p.room-reach,6);
    chosen.push(free.reduce((best,p)=>score(p)<score(best)?p:best));
  }
  const prefix=String(tool.id||'tool').slice(0,80);
  return chosen.map((p,i)=>({id:`${prefix}-magnet-${i+1}`,x:p.x,y:p.y,diameter:magnet.diameter,height:magnet.height}));
}
