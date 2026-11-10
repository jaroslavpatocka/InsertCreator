// Pocket wall profile: the shape of the pocket side wall in the 3D model.
// The profile is an offset of the pocket outline as a function of the height
// above the pocket floor. All supported profiles are non-decreasing in height:
// the floor is the narrowest section and the top edge the widest one.
//   vertical     offset 0 everywhere (default, also null / missing value)
//   draft        straight sloped wall, `value` = angle from vertical in degrees
//   chamfer      45° bevel of the top edge, `value` = width = height in mm
//   roundTop     quarter-circle rounding of the top edge, `value` = radius in mm
//   roundBottom  concave fillet between wall and floor, `value` = radius in mm;
//                the floor shrinks by the radius, the top edge stays unchanged
import Clipper from './vendor/clipper.js';
import {i18nError} from './i18n.js';
import {pocketOutline} from './finger-grip.js';

export const POCKET_WALL_TYPES=['vertical','draft','chamfer','roundTop','roundBottom'];
/** Largest height and width of one terrace step (typical FDM layer height). */
export const POCKET_WALL_STEP=.2;
const LIMITS={draft:[.5,45],chamfer:[.2,20],roundTop:[.2,20],roundBottom:[.2,20]};
const MAX_BANDS=400,SCALE=10000,EPS=1e-9;

/** null for a vertical wall, otherwise a fresh {type,value}. Throws for an invalid profile. */
export function normalizePocketWall(wall){
  if(wall==null)return null;
  if(typeof wall!=='object'||Array.isArray(wall))throw i18nError('Neznámý tvar stěny kapsy.');
  if(wall.type==null||wall.type==='vertical')return null;
  if(!Object.hasOwn(LIMITS,wall.type))throw i18nError('Neznámý tvar stěny kapsy.');
  const value=typeof wall.value==='string'&&wall.value.trim()?Number(wall.value):wall.value,[min,max]=LIMITS[wall.type];
  if(typeof value!=='number'||!Number.isFinite(value)||value<min-EPS||value>max+EPS){
    if(wall.type==='draft')throw i18nError('Úhel stěny kapsy musí být od {min}° do {max}°.',{min,max});
    throw i18nError('Rozměr tvaru stěny kapsy musí být od {min} do {max} mm.',{min,max});
  }
  return{type:wall.type,value};
}

/** Checks the profile against the pocket depth; returns the normalized profile. */
export function validatePocketWall(wall,depth){
  const normalized=normalizePocketWall(wall);
  if(!normalized)return null;
  if(!(Number.isFinite(depth)&&depth>0))throw i18nError('Hloubka kapsy není platná.');
  if(normalized.type!=='draft'&&normalized.value>depth+EPS)throw i18nError('Zkosení nebo zaoblení stěny nesmí být větší než hloubka kapsy {depth} mm.',{depth:Math.round(depth*1000)/1000});
  return normalized;
}

const toolDepth=tool=>{const depth=Number(tool?.depth);return Number.isFinite(depth)&&depth>0?depth:10;};

/** Offset of the outline in mm at height h above the floor (0..depth); positive grows the pocket. */
export function pocketWallOffset(wall,depth,h){
  const w=normalizePocketWall(wall);if(!w)return 0;
  const z=Math.max(0,Math.min(depth,h));
  if(w.type==='draft')return z*Math.tan(w.value*Math.PI/180);
  const r=Math.min(w.value,depth);
  if(w.type==='chamfer')return Math.max(0,z-(depth-r));
  if(w.type==='roundTop'){const d=z-(depth-r);return d<=0?0:r-Math.sqrt(Math.max(0,r*r-d*d));}
  // roundBottom: concave quarter circle centred r inside the pocket and r above the floor.
  if(z>=r)return 0;const d=r-z;return-(r-Math.sqrt(Math.max(0,r*r-d*d)));
}

export function pocketWallOutset(tool){
  const wall=normalizePocketWall(tool?.pocketWall);if(!wall||wall.type==='roundBottom')return 0;
  const depth=toolDepth(tool);return pocketWallOffset(wall,depth,depth);
}

export function pocketWallInset(tool){
  const wall=normalizePocketWall(tool?.pocketWall);
  return wall?.type==='roundBottom'?Math.min(wall.value,toolDepth(tool)):0;
}

/**
 * Terraced approximation [{h0,h1,offset}] covering 0..depth bottom-up. Each band uses
 * the profile offset at its lower height, so the pocket never exceeds the true
 * profile and the floor is exactly offset(0). Band height and offset change per
 * band are both at most POCKET_WALL_STEP (coarsened only beyond MAX_BANDS bands).
 */
export function pocketWallBands(wall,depth){
  const w=normalizePocketWall(wall);
  if(!(Number.isFinite(depth)&&depth>0))throw i18nError('Hloubka kapsy není platná.');
  if(!w)return[{h0:0,h1:depth,offset:0}];
  const r=Math.min(w.value,depth),heights=[0];
  const steps=length=>Math.max(1,Math.min(MAX_BANDS,Math.ceil(length/POCKET_WALL_STEP-1e-9)));
  if(w.type==='draft'){
    const n=steps(Math.max(depth,pocketWallOffset(w,depth,depth)));
    for(let i=1;i<=n;i++)heights.push(depth*i/n);
  }else if(w.type==='chamfer'){
    if(depth-r>EPS)heights.push(depth-r);
    const n=steps(r);for(let i=1;i<=n;i++)heights.push(depth-r+r*i/n);
  }else{
    // Equal arc-length steps keep both height and width changes within one step.
    const n=steps(r*Math.PI/2);
    if(w.type==='roundTop'){
      if(depth-r>EPS)heights.push(depth-r);
      for(let i=1;i<=n;i++)heights.push(depth-r+r*Math.sin(Math.PI/2*i/n));
    }else{
      for(let i=1;i<=n;i++)heights.push(r*(1-Math.cos(Math.PI/2*i/n)));
      if(depth-r>EPS)heights.push(depth);
    }
  }
  heights[heights.length-1]=depth;
  const bands=[];
  for(let i=0;i<heights.length-1;i++){
    const h0=heights[i],h1=heights[i+1];if(h1-h0<=EPS)continue;
    const offset=pocketWallOffset(w,depth,h0),last=bands.at(-1);
    if(last&&Math.abs(last.offset-offset)<=EPS)last.h1=h1;else bands.push({h0,h1,offset});
  }
  return bands;
}

const toInt=points=>points.map(p=>({X:Math.round(p.x*SCALE),Y:Math.round(p.y*SCALE)}));
const fromInt=path=>path.map(p=>({x:p.X/SCALE,y:p.Y/SCALE}));
const area=points=>points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)/2;
/** Round-joined offset of one closed polygon; returns the outer boundaries. */
export function offsetPocketPolygon(points,distance){
  if(!distance)return[points.map(p=>({x:p.x,y:p.y}))];
  const engine=new Clipper.ClipperOffset(2,.015*SCALE),tree=new Clipper.PolyTree();
  engine.AddPath(toInt(points),Clipper.JoinType.jtRound,Clipper.EndType.etClosedPolygon);
  engine.Execute(tree,distance*SCALE);
  return tree.Childs().map(node=>fromInt(node.Contour())).filter(path=>path.length>=3&&Math.abs(area(path))>1e-6);
}

/** Pocket outline at its widest (top edge); use for collisions, wall space and layout. */
export function pocketLayoutOutline(tool,context=0){
  const base=pocketOutline(tool,context),outset=pocketWallOutset(tool);
  if(!(outset>0))return base;
  const grown=offsetPocketPolygon(base,outset);
  if(grown.length!==1)throw i18nError('Tvar stěny nevytvořil jednu jednoznačnou kapsu nástroje.');
  return grown[0];
}

/** Floor outlines (possibly several after a round-bottom inset); use for floor magnets and inlays. */
export function pocketFloorOutlines(tool,context=0){
  const base=pocketOutline(tool,context),inset=pocketWallInset(tool);
  if(!(inset>0))return[base];
  const floor=offsetPocketPolygon(base,-inset);
  if(!floor.length)throw i18nError('Zaoblené dno je pro kapsu „{name}“ příliš velké. Zmenšete poloměr zaoblení.',{name:tool?.name||''});
  return floor;
}
