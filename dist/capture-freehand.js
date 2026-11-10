// Freehand outline geometry: converts one drawn stroke (original photo pixels)
// into a closed contour model in local millimetres. No DOM, no pointers.
// Shape changes are limited to removing near-identical samples and a bounded
// Douglas-Peucker simplification; the reported maxErrorMm is measured against
// every input sample. No convex hull, no smoothing, no fallback geometry.
import {validateContourModel} from './capture-contour-edit.js';
import {i18nError} from './i18n.js';

const MAX_POINTS=6000,DUPLICATE_MM=.01,RETRIES=4;
const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);

function segmentDistance(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
  return Math.hypot(p.x-(a.x+dx*t),p.y-(a.y+dy*t));
}

/** Indices of `ring` kept by closed-ring Douglas-Peucker with segment distance <= tolerance. */
function simplifyRing(ring,tolerance){
  const n=ring.length;if(n<=3||!(tolerance>0))return ring.map((_,i)=>i);
  // Split the ring at the vertex farthest from vertex 0 so both chains are open.
  let far=1,best=-1;
  for(let i=1;i<n;i++){const d=Math.hypot(ring[i].x-ring[0].x,ring[i].y-ring[0].y);if(d>best){best=d;far=i;}}
  const keep=new Uint8Array(n);keep[0]=keep[far]=1;
  const at=i=>ring[i%n],stack=[[0,far],[far,n]];
  while(stack.length){
    const [start,end]=stack.pop();if(end-start<2)continue;
    let index=-1,max=-1;
    for(let i=start+1;i<end;i++){const d=segmentDistance(at(i),at(start),at(end));if(d>max){max=d;index=i;}}
    if(max>tolerance){keep[index%n]=1;stack.push([start,index],[index,end]);}
  }
  const result=[];for(let i=0;i<n;i++)if(keep[i])result.push(i);
  return result;
}

/** Largest distance of any raw sample from the closed simplified polygon edge that replaced it. */
function measureError(raw,ringIndex,kept,ring){
  // ringIndex is non-decreasing in [0,n]; n denotes vertex 0 reached by the closing edge.
  const n=ring.length,bounds=[...kept,n];let max=0,segment=0;
  for(let j=0;j<raw.length;j++){
    const u=ringIndex[j];
    while(segment<kept.length-1&&bounds[segment+1]<u)segment++;
    const d=segmentDistance(raw[j],ring[bounds[segment]%n],ring[bounds[segment+1]%n]);
    if(d>max)max=d;
  }
  return max;
}

/**
 * buildFreehandContour(photoPoints,{pxPerMm,origin,toleranceMm,maxPoints})
 * -> {model:{origin,nodes},points,stats}
 * photoPoints and origin are original photo pixels; nodes/points are local mm.
 * Throws i18n errors for invalid input, strokes without area, crossings or
 * results above maxPoints. Never returns substitute geometry.
 */
export function buildFreehandContour(photoPoints,{pxPerMm,origin={x:0,y:0},toleranceMm=.15,maxPoints=MAX_POINTS}={}){
  if(!(Number.isFinite(pxPerMm)&&pxPerMm>0))throw i18nError('Měřítko fotografie není platné.');
  if(!finite(origin)||!(Number.isFinite(toleranceMm)&&toleranceMm>=0))throw i18nError('Bod kontury nemá platnou polohu.');
  const limit=Math.min(MAX_POINTS,Number.isFinite(maxPoints)&&maxPoints>=3?Math.floor(maxPoints):MAX_POINTS);
  if(!Array.isArray(photoPoints)||!photoPoints.every(finite))throw i18nError('Bod kontury nemá platnou polohu.');
  const base={x:origin.x,y:origin.y};
  const raw=photoPoints.map(p=>({x:(p.x-base.x)/pxPerMm,y:(p.y-base.y)/pxPerMm}));
  // Drop consecutive near-identical samples; each raw sample remembers its survivor.
  const duplicate=toleranceMm>0?Math.min(DUPLICATE_MM,toleranceMm):1e-6,ring=[],rawToRing=new Int32Array(raw.length);
  for(let j=0;j<raw.length;j++){
    const p=raw[j],last=ring.at(-1);
    if(!last||Math.hypot(p.x-last.x,p.y-last.y)>duplicate)ring.push(p);
    rawToRing[j]=ring.length-1;
  }
  // The stroke usually ends where it began; that end sample is the start point.
  while(ring.length>1&&Math.hypot(ring.at(-1).x-ring[0].x,ring.at(-1).y-ring[0].y)<=duplicate)ring.pop();
  if(ring.length<3)throw i18nError('Kontura potřebuje alespoň tři body.');
  // Samples merged into dropped end vertices sit at vertex 0, reached by the closing edge.
  const ringIndex=Array.from(rawToRing,u=>Math.min(u,ring.length));
  let tolerance=toleranceMm,lastError;
  for(let attempt=0;attempt<=RETRIES+1;attempt++){
    const kept=simplifyRing(ring,tolerance);
    if(kept.length>limit){
      if(attempt===0)throw i18nError('Kontura může mít nejvýše 6000 bodů.');
      break;
    }
    const nodes=kept.map(i=>({x:ring[i].x,y:ring[i].y})),model={origin:base,nodes};
    try{
      const points=validateContourModel(model);
      return{model:{origin:{...base},nodes},points,stats:{
        inputSamples:raw.length,uniqueSamples:ring.length,nodes:nodes.length,
        toleranceMm:tolerance,maxErrorMm:measureError(raw,ringIndex,kept,ring)
      }};
    }catch(error){
      lastError=error;
      // Simplification may merge two close but separate edges (open jaws,
      // narrow slots). Retry with a finer tolerance, finally with none.
      if(!(tolerance>0)||!/křížit|intersect/i.test(error.i18n?.cs||error.message))throw error;
      tolerance=attempt>=RETRIES?0:tolerance/2;
    }
  }
  throw lastError||i18nError('Kontura může mít nejvýše 6000 bodů.');
}
