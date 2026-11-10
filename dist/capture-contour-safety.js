import Clipper from './vendor/clipper.js';

// Numerical allowance only, matching the four-decimal millimetre geometry.
// This is not fitting reserve or manufacturing clearance.
const GRID=100000,PRECISION_MM=.0001,MAX_POINTS=6000,MAX_COORDINATE_MM=1e7;
const references=new WeakMap();
const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const copy=p=>({x:p.x,y:p.y});
const toInt=points=>points.map(p=>({X:Math.round(p.x*GRID),Y:Math.round(p.y*GRID)}));
const area=path=>Math.abs(Clipper.Clipper.Area(path))/(GRID*GRID);
// Re-ordering a long integer path changes IEEE754 summation error. This check
// detects normalization/topology changes, not physical containment; the actual
// source-minus-candidate difference below keeps its fixed integer-grid budget.
const sameArea=(a,b,count)=>Math.abs(a-b)<=Math.max(1/(GRID*GRID),Math.max(a,b)*Number.EPSILON*Math.max(32,count*8));
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const onSegment=(a,b,p)=>cross(a,b,p)===0&&p.x>=Math.min(a.x,b.x)&&p.x<=Math.max(a.x,b.x)&&p.y>=Math.min(a.y,b.y)&&p.y<=Math.max(a.y,b.y);
function intersects(a,b,c,d){
  if(Math.max(a.x,b.x)<Math.min(c.x,d.x)||Math.max(c.x,d.x)<Math.min(a.x,b.x)||Math.max(a.y,b.y)<Math.min(c.y,d.y)||Math.max(c.y,d.y)<Math.min(a.y,b.y))return false;
  const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
  return(abC*abD<0&&cdA*cdB<0)||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b);
}
function simple(points){
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    if(a.x===b.x&&a.y===b.y)return false;
    for(let j=i+2;j<points.length;j++)if(!(i===0&&j===points.length-1)&&intersects(a,b,points[j],points[(j+1)%points.length]))return false;
  }
  return true;
}
function positive(path){const next=path.map(p=>({...p}));if(!Clipper.Clipper.Orientation(next))next.reverse();return next;}
function operation(subject,clip=[],kind=Clipper.ClipType.ctDifference){
  const engine=new Clipper.Clipper(),result=[];engine.StrictlySimple=true;
  engine.AddPaths(subject,Clipper.PolyType.ptSubject,true);
  if(clip.length)engine.AddPaths(clip,Clipper.PolyType.ptClip,true);
  if(!engine.Execute(kind,result,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero))throw Error('polygon-operation-failed');
  return result;
}
function referenceOf(item,scale){
  if(!item||typeof item!=='object'||!(Number.isFinite(scale)&&scale>0))return{reason:'invalid-reference'};
  const source=item.contour?.points,cached=references.get(item);
  if(cached){
    if(cached.scale!==scale)return{reason:'reference-calibration-changed'};
    if(!Array.isArray(source)||source.length!==cached.photoPoints.length||source.some((p,i)=>!finite(p)||p.x!==cached.photoPoints[i].x||p.y!==cached.photoPoints[i].y))return{reason:'reference-changed'};
    return cached;
  }
  if(!Array.isArray(source)||source.length<3||source.length>MAX_POINTS||!source.every(finite))return{reason:'invalid-reference'};
  const photoPoints=source.map(copy),anchor=copy(source[0]),points=source.map(p=>({x:(p.x-anchor.x)/scale,y:(p.y-anchor.y)/scale}));
  if(points.some(p=>Math.abs(p.x)>MAX_COORDINATE_MM||Math.abs(p.y)>MAX_COORDINATE_MM)||!simple(points))return{reason:'invalid-reference'};
  const path=positive(toInt(points)),referenceAreaMm2=area(path);
  if(!(referenceAreaMm2>1e-12))return{reason:'invalid-reference'};
  const normalized=operation([path],[],Clipper.ClipType.ctUnion);
  if(normalized.length!==1||!sameArea(area(normalized[0]),referenceAreaMm2,path.length))return{reason:'invalid-reference'};
  const next={scale,anchor,photoPoints,path,referenceAreaMm2};references.set(item,next);return next;
}

/** Verify an edited manufacturing polygon against the immutable measured source.
 * `polygon.origin` is in original photo pixels, `polygon.points` are flattened
 * local millimetres. The caller validates topology and passes the SAME polygon
 * it will commit/export. Never pass a separately re-centred or margin polygon.
 * Always check `safe`; protected:false is a fail-closed invalid-reference result.
 * Original RGB, source contour, calibrated scale and edit fields are untouched.
 */
export function checkCaptureContourSafety(item,scale,polygon){
  const failure=(reason,extra={})=>({safe:false,protected:false,reason,lostAreaMm2:null,referenceAreaMm2:null,precisionMm:PRECISION_MM,...extra});
  let reference;
  try{reference=referenceOf(item,scale);}catch{return failure('invalid-reference');}
  if(reference.reason)return failure(reference.reason);
  const {points,origin}=polygon||{},metadata={protected:true,referenceAreaMm2:reference.referenceAreaMm2};
  if(!finite(origin)||!Array.isArray(points)||points.length<3||points.length>MAX_POINTS||!points.every(finite))return failure('invalid-candidate',metadata);
  // Translate BEFORE integer scaling; large photo-coordinate anchors do not
  // degrade millimetre accuracy or overflow the integer polygon representation.
  const dx=(origin.x-reference.anchor.x)/scale,dy=(origin.y-reference.anchor.y)/scale,local=points.map(p=>({x:p.x+dx,y:p.y+dy}));
  if(local.some(p=>!finite(p)||Math.abs(p.x)>MAX_COORDINATE_MM||Math.abs(p.y)>MAX_COORDINATE_MM))return failure('invalid-candidate',metadata);
  try{
    const path=positive(toInt(local));if(!(area(path)>1e-12))return failure('invalid-candidate',metadata);
    const normalized=operation([path],[],Clipper.ClipType.ctUnion);
    if(normalized.length!==1||!sameArea(area(normalized[0]),area(path),path.length))return failure('invalid-candidate',metadata);
    // Tiny positive dilation is solely a rounding comparison. It never changes
    // the committed candidate and never borrows the user's mm pocket clearance.
    const offset=new Clipper.ClipperOffset(2,.25),comparison=[];
    offset.AddPath(path,Clipper.JoinType.jtRound,Clipper.EndType.etClosedPolygon);offset.Execute(comparison,PRECISION_MM*GRID);
    if(!comparison.length)return failure('polygon-operation-failed',metadata);
    const lost=operation([reference.path],comparison),lostAreaMm2=Math.abs(lost.reduce((sum,p)=>sum+Clipper.Clipper.Area(p),0))/(GRID*GRID),safe=lostAreaMm2<=1/(GRID*GRID);
    return{safe,...metadata,reason:safe?'contained':'source-material-lost',lostAreaMm2,precisionMm:PRECISION_MM};
  }catch{return failure('polygon-operation-failed',metadata);}
}
