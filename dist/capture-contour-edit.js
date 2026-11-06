// Manual capture geometry stays in calibrated millimetres with a fixed photo
// origin. The original photograph and detected contour are never overwritten.
import {capturePhotoGeometry} from './capture-tools.js';
import {getToolDimensions} from './tool-dimensions.js';
import {i18nError} from './i18n.js';

const EPS=1e-8,MAX_POINTS=6000;
const copyPoint=p=>({x:p.x,y:p.y});
const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const cloneNode=node=>({...copyPoint(node),...(node.in?{in:copyPoint(node.in)}:{}),...(node.out?{out:copyPoint(node.out)}:{}),...(node.manual?{manual:true}:{})});
export const cloneContourModel=model=>({origin:copyPoint(model.origin),nodes:model.nodes.map(cloneNode)});
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);

function project(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
  const point=mix(a,b,t);return{point,t,distance:Math.hypot(p.x-point.x,p.y-point.y)};
}

function cubicSamples(a,b,tolerance=.05){
  if(!a.out&&!b.in)return[{point:copyPoint(a),t:0},{point:copyPoint(b),t:1}];
  const result=[{point:copyPoint(a),t:0}];
  const visit=(p0,p1,p2,p3,t0,t1,depth)=>{
    if(depth>=12||(project(p1,p0,p3).distance<=tolerance&&project(p2,p0,p3).distance<=tolerance)){
      result.push({point:copyPoint(p3),t:t1});return;
    }
    const a=mix(p0,p1,.5),b=mix(p1,p2,.5),c=mix(p2,p3,.5),d=mix(a,b,.5),e=mix(b,c,.5),f=mix(d,e,.5),mid=(t0+t1)/2;
    visit(p0,a,d,f,t0,mid,depth+1);visit(f,e,c,p3,mid,t1,depth+1);
  };
  visit(a,a.out||a,b.in||b,b,0,1,0);return result;
}

/** Polygon shared by canvas, import and manufacturing; Bézier error <= .05 mm. */
export function flattenContour(nodes,{tolerance=.05}={}){
  if(!Array.isArray(nodes)||nodes.length<3)throw i18nError('Kontura potřebuje alespoň tři body.');
  const points=[];
  for(let i=0;i<nodes.length;i++){
    const samples=cubicSamples(nodes[i],nodes[(i+1)%nodes.length],tolerance);
    for(let j=0;j<samples.length-1;j++){
      const point=samples[j].point;
      if(!points.length||Math.hypot(point.x-points.at(-1).x,point.y-points.at(-1).y)>EPS)points.push(point);
      if(points.length>MAX_POINTS)throw i18nError('Kontura může mít nejvýše 6000 bodů.');
    }
  }
  return points;
}

function onSegment(a,b,p){return Math.abs(cross(a,b,p))<=EPS&&p.x>=Math.min(a.x,b.x)-EPS&&p.x<=Math.max(a.x,b.x)+EPS&&p.y>=Math.min(a.y,b.y)-EPS&&p.y<=Math.max(a.y,b.y)+EPS;}
function intersects(a,b,c,d){
  if(Math.max(a.x,b.x)<Math.min(c.x,d.x)-EPS||Math.max(c.x,d.x)<Math.min(a.x,b.x)-EPS||Math.max(a.y,b.y)<Math.min(c.y,d.y)-EPS||Math.max(c.y,d.y)<Math.min(a.y,b.y)-EPS)return false;
  const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
  return (abC*abD<0&&cdA*cdB<0)||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b);
}

export function validateContourModel(model){
  if(!finite(model?.origin)||!Array.isArray(model?.nodes)||model.nodes.length>MAX_POINTS||!model.nodes.every(node=>finite(node)&&(!node.in||finite(node.in))&&(!node.out||finite(node.out))))throw i18nError('Bod kontury nemá platnou polohu.');
  const points=flattenContour(model.nodes);let area=0;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];area+=a.x*b.y-b.x*a.y;
    if(Math.hypot(a.x-b.x,a.y-b.y)<EPS)throw i18nError('Body kontury jsou příliš blízko u sebe.');
    for(let j=i+2;j<points.length;j++){
      if(i===0&&j===points.length-1)continue;
      if(intersects(a,b,points[j],points[(j+1)%points.length]))throw i18nError('Kontura se nesmí křížit sama se sebou.');
    }
  }
  if(Math.abs(area)<.02)throw i18nError('Kontura potřebuje nenulovou plochu.');
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  if(Math.max(...xs)-Math.min(...xs)>3000||Math.max(...ys)-Math.min(...ys)>3000)throw i18nError('Kontura nesmí v žádném směru přesáhnout 3000 mm.');
  return points;
}

export function getCaptureEditModel(item,scale){
  if(!(Number.isFinite(scale)&&scale>0))throw i18nError('Měřítko fotografie není platné.');
  if(item.contourEdit&&(!item.pocketShape||item.pocketShape==='measured'))return cloneContourModel(item.contourEdit);
  const points=capturePhotoGeometry(item,scale).points,origin={x:item.info.minX,y:item.info.minY};
  return{origin,nodes:points.map(point=>({x:(point.x-origin.x)/scale,y:(point.y-origin.y)/scale}))};
}

/** Atomic commit; topology failure leaves all original capture fields intact. */
export function applyCaptureEdit(item,scale,model){
  if(!(Number.isFinite(scale)&&scale>0))throw i18nError('Měřítko fotografie není platné.');
  const next=cloneContourModel(model),points=validateContourModel(next);
  item.contourEdit=next;item.contourEditOrigin=copyPoint(next.origin);item.editedPoints=points;item.pocketShape='measured';
  return points;
}

export function resetCaptureEdit(item){delete item.editedPoints;delete item.contourEdit;delete item.contourEditOrigin;item.pocketShape='measured';}

export function nearestContourSegment(model,point){
  let best=null;
  for(let index=0;index<model.nodes.length;index++){
    const samples=cubicSamples(model.nodes[index],model.nodes[(index+1)%model.nodes.length]);
    for(let j=0;j<samples.length-1;j++){
      const hit=project(point,samples[j].point,samples[j+1].point);
      if(!best||hit.distance<best.distance)best={...hit,index,t:samples[j].t+(samples[j+1].t-samples[j].t)*hit.t};
    }
  }
  return best;
}

/** Split the exact cubic using de Casteljau; adding a point does not reshape it. */
export function insertContourNode(model,point){
  const next=cloneContourModel(model),hit=nearestContourSegment(next,point);
  if(!hit)throw i18nError('Kontura potřebuje alespoň tři body.');
  const index=hit.index,a=next.nodes[index],b=next.nodes[(index+1)%next.nodes.length];
  if(hit.t<.0001){a.manual=true;return{model:next,index};}
  if(hit.t>.9999){const selected=(index+1)%next.nodes.length;b.manual=true;return{model:next,index:selected};}
  if(next.nodes.length>=MAX_POINTS)throw i18nError('Kontura může mít nejvýše 6000 bodů.');
  let node;
  if(a.out||b.in){
    const p=mix(a,a.out||a,hit.t),q=mix(a.out||a,b.in||b,hit.t),r=mix(b.in||b,b,hit.t),s=mix(p,q,hit.t),u=mix(q,r,hit.t),v=mix(s,u,hit.t);
    a.out=p;b.in=r;node={...v,in:s,out:u,manual:true};
  }else node={...hit.point,manual:true};
  next.nodes.splice(index+1,0,node);validateContourModel(next);return{model:next,index:index+1};
}

export function moveContourNode(model,index,point,{handle}={}){
  if(!finite(point)||!model.nodes[index])throw i18nError('Bod kontury nemá platnou polohu.');
  const next=cloneContourModel(model),node=next.nodes[index];
  if(handle==='in'||handle==='out')node[handle]=copyPoint(point);
  else{
    const dx=point.x-node.x,dy=point.y-node.y;
    node.x=point.x;node.y=point.y;node.manual=true;
    for(const key of ['in','out'])if(node[key])node[key]={x:node[key].x+dx,y:node[key].y+dy};
  }
  return next;
}

export function curveContourNode(model,index){
  const next=cloneContourModel(model),node=next.nodes[index];if(!node)return next;
  const previous=next.nodes[(index+next.nodes.length-1)%next.nodes.length],following=next.nodes[(index+1)%next.nodes.length];
  const dx=following.x-previous.x,dy=following.y-previous.y,length=Math.hypot(dx,dy)||1;
  const before=Math.hypot(node.x-previous.x,node.y-previous.y)/3,after=Math.hypot(following.x-node.x,following.y-node.y)/3;
  node.in={x:node.x-dx/length*before,y:node.y-dy/length*before};node.out={x:node.x+dx/length*after,y:node.y+dy/length*after};node.manual=true;
  validateContourModel(next);return next;
}

export function straightContourNode(model,index){const next=cloneContourModel(model);if(next.nodes[index]){delete next.nodes[index].in;delete next.nodes[index].out;}validateContourModel(next);return next;}
export function deleteContourNode(model,index){const next=cloneContourModel(model);next.nodes.splice(index,1);validateContourModel(next);return next;}

/** Affine resize along the outline's intrinsic axes, including curve handles. */
export function resizeContourModel(model,dimensions){
  const points=flattenContour(model.nodes),frame=getToolDimensions({points}),axis=frame.axis,normal={x:-axis.y,y:axis.x};
  const along=points.map(p=>p.x*axis.x+p.y*axis.y),across=points.map(p=>p.x*normal.x+p.y*normal.y);
  const center={a:(Math.min(...along)+Math.max(...along))/2,b:(Math.min(...across)+Math.max(...across))/2};
  const length=dimensions.length??frame.length,width=dimensions.width??frame.width;
  if(!Number.isFinite(length)||!Number.isFinite(width)||length<2||width<2||length>3000||width>3000)throw i18nError('Rozměry nástroje musí být od 2 do 3000 mm.');
  const transform=p=>{const a=center.a+(p.x*axis.x+p.y*axis.y-center.a)*length/frame.length,b=center.b+(p.x*normal.x+p.y*normal.y-center.b)*width/frame.width;return{x:axis.x*a+normal.x*b,y:axis.y*a+normal.y*b};};
  const next=cloneContourModel(model);next.nodes=next.nodes.map(node=>({...node,...transform(node),...(node.in?{in:transform(node.in)}:{}),...(node.out?{out:transform(node.out)}:{})}));
  validateContourModel(next);return next;
}
