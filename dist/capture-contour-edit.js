// Manual capture geometry stays in calibrated millimetres with a fixed photo
// origin. The original photograph and detected contour are never overwritten.
import {capturePhotoGeometry} from './capture-tools.js';
import {getToolDimensions} from './tool-dimensions.js';
import {i18nError} from './i18n.js';
import {checkCaptureContourSafety} from './capture-contour-safety.js';

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

export function checkCaptureEditSafety(item,scale,model){
  return checkCaptureContourSafety(item,scale,{origin:model.origin,points:flattenContour(model.nodes)});
}

export function assertCaptureEditSafety(item,scale,model,points=flattenContour(model.nodes)){
  const result=checkCaptureContourSafety(item,scale,{origin:model.origin,points});
  if(!result.safe){const error=i18nError('Úprava by zasáhla do nástroje. Obrys se zastavil na jeho původní hraně.');error.code='CAPTURE_TOOL_EDGE';error.safety=result;throw error;}
  return result;
}

/** Limit point/handle movement along the user's motion against one immutable
 * tool silhouette. The accepted candidate is checked again at atomic commit. */
export function limitCaptureEdit(item,scale,from,requested){
  if(checkCaptureEditSafety(item,scale,requested).safe)return{model:requested,limited:false,progress:1};
  if(from.nodes.length!==requested.nodes.length||!checkCaptureEditSafety(item,scale,from).safe)return{model:cloneContourModel(from),limited:true,progress:0};
  const between=amount=>({origin:mix(from.origin,requested.origin,amount),nodes:from.nodes.map((node,index)=>{
    const target=requested.nodes[index],next={...cloneNode(node),...mix(node,target,amount)};
    for(const key of ['in','out']){if(node[key]&&target[key])next[key]=mix(node[key],target[key],amount);else if(target[key]||node[key])next[key]=mix(node[key]||node,target[key]||target,amount);}
    return next;
  })});
  // Already at the tool edge: even the smallest bisection step would enter it.
  // Repeated blocked pointer events need no further polygon searches.
  if(!checkCaptureEditSafety(item,scale,between(1/65536)).safe)return{model:cloneContourModel(from),limited:true,progress:0};
  let low=0,high=1,best=cloneContourModel(from);
  for(let i=0;i<16;i++){const mid=(low+high)/2,candidate=between(mid);if(checkCaptureEditSafety(item,scale,candidate).safe){low=mid;best=candidate;}else high=mid;}
  return{model:best,limited:true,progress:low};
}

/** Atomic commit; invalid topology or tool intrusion leaves every item field intact. */
export function applyCaptureEdit(item,scale,model){
  if(!(Number.isFinite(scale)&&scale>0))throw i18nError('Měřítko fotografie není platné.');
  const next=cloneContourModel(model),points=validateContourModel(next);
  assertCaptureEditSafety(item,scale,next,points);
  // Manual edits start with the displayed fitted pocket. Its reserve is already
  // in these points, so a later return to the automatic fit must not add it twice.
  if(item.pocketShape==='ideal')item.contourReserveRatio=.02;
  item.contourEdit=next;item.contourEditOrigin=copyPoint(next.origin);item.editedPoints=points;item.pocketShape='measured';
  return points;
}

export function resetCaptureEdit(item){delete item.editedPoints;delete item.contourEdit;delete item.contourEditOrigin;delete item.contourReserveRatio;item.pocketShape='measured';}

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

// Brush operations use local calibrated millimetres. These helpers are separate
// from the existing point/handle editing APIs and never move the photo origin.
const brushDot=(a,b)=>a.x*b.x+a.y*b.y;
const brushCross=(a,b)=>a.x*b.y-a.y*b.x;
const brushSub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
const brushUnit=p=>{const length=Math.hypot(p.x,p.y);return length>EPS?{x:p.x/length,y:p.y/length}:null;};
function brushPoint(model,position){
  const n=model.nodes.length,index=((Math.floor(position)%n)+n)%n,t=position-Math.floor(position),a=model.nodes[index],b=model.nodes[(index+1)%n],p=a.out||a,q=b.in||b,u=1-t;
  if(!a.out&&!b.in)return mix(a,b,t);
  return{x:u*u*u*a.x+3*u*u*t*p.x+3*u*t*t*q.x+t*t*t*b.x,y:u*u*u*a.y+3*u*u*t*p.y+3*u*t*t*q.y+t*t*t*b.y};
}
function brushCircleRange(a,b,center,radius){
  const d=brushSub(b,a),f=brushSub(a,center),aa=brushDot(d,d);if(aa<EPS*EPS)return null;
  const bb=2*brushDot(f,d),cc=brushDot(f,f)-radius*radius,discriminant=bb*bb-4*aa*cc;
  if(discriminant<0)return null;const root=Math.sqrt(Math.max(0,discriminant)),from=Math.max(0,(-bb-root)/(2*aa)),to=Math.min(1,(-bb+root)/(2*aa));
  return to-from>1e-10?{from,to}:null;
}
function brushLocalArc(model,center,radius){
  const intervals=[],n=model.nodes.length,tolerance=Math.min(.005,radius/500);
  const g=position=>{const p=brushPoint(model,position);return(p.x-center.x)**2+(p.y-center.y)**2-radius*radius;};
  const boundary=(outside,inside)=>{for(let k=0;k<35;k++){const mid=(outside+inside)/2;if(g(mid)>0)outside=mid;else inside=mid;}return(outside+inside)/2;};
  for(let index=0;index<n;index++){
    const a=model.nodes[index],b=model.nodes[(index+1)%n],samples=cubicSamples(a,b,tolerance);
    for(let j=0;j<samples.length-1;j++){
      const left=samples[j],right=samples[j+1],clip=brushCircleRange(left.point,right.point,center,radius);if(!clip)continue;
      const t0=index+left.t,t1=index+right.t,mid=t0+(t1-t0)*(clip.from+clip.to)/2;if(g(mid)>tolerance*tolerance)continue;
      const from=g(t0)<=0?t0:boundary(t0,mid),to=g(t1)<=0?t1:boundary(t1,mid);if(to-from<1e-10)continue;
      const distance=project(center,brushPoint(model,from),brushPoint(model,to)).distance,last=intervals.at(-1);
      if(last&&Math.abs(last.to-from)<1e-7){last.to=to;last.distance=Math.min(last.distance,distance);}else intervals.push({from,to,distance});
    }
  }
  if(intervals.length>1&&intervals[0].from<1e-8&&intervals.at(-1).to>n-1e-8){const first=intervals.shift(),last=intervals.pop();intervals.push({from:last.from,to:first.to+n,distance:Math.min(first.distance,last.distance)});}
  return intervals.sort((a,b)=>a.distance-b.distance)[0]||null;
}
function brushArcPoints(model,arc,radius){
  const result=[brushPoint(model,arc.from)],n=model.nodes.length;
  for(let index=Math.floor(arc.from);index<=Math.floor(arc.to);index++){
    const a=model.nodes[((index%n)+n)%n],b=model.nodes[(index+1)%n],samples=cubicSamples(a,b,Math.min(.005,radius/500));
    for(const sample of samples){const position=index+sample.t;if(position>arc.from+1e-9&&position<arc.to-1e-9&&Math.hypot(sample.point.x-result.at(-1).x,sample.point.y-result.at(-1).y)>EPS)result.push(copyPoint(sample.point));}
  }
  result.push(brushPoint(model,arc.to));return result;
}
function brushResample(points,count){
  const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));
  const total=lengths.at(-1),result=[];let edge=0;
  for(let i=0;i<count;i++){const distance=total*i/(count-1);while(edge<points.length-2&&lengths[edge+1]<distance)edge++;result.push(mix(points[edge],points[edge+1],(distance-lengths[edge])/(lengths[edge+1]-lengths[edge]||1)));}
  return result;
}
function brushLine(points){
  let x=0,y=0;for(const p of points){x+=p.x;y+=p.y;}x/=points.length;y/=points.length;let xx=0,yy=0,xy=0;
  for(const p of points){xx+=(p.x-x)**2;yy+=(p.y-y)**2;xy+=(p.x-x)*(p.y-y);}const angle=.5*Math.atan2(2*xy,xx-yy);let direction={x:Math.cos(angle),y:Math.sin(angle)};
  if(brushDot(direction,brushSub(points.at(-1),points[0]))<0)direction={x:-direction.x,y:-direction.y};
  const origin=points[0],error=Math.sqrt(points.reduce((sum,p)=>sum+brushCross(brushSub(p,origin),direction)**2,0)/points.length);return{origin:copyPoint(origin),direction,error};
}
function brushCorner(points,center,radius){
  const count=Math.max(4,Math.floor(points.length*.22)),incoming=brushLine(points.slice(0,count)),outgoing=brushLine(points.slice(-count)),u=incoming.direction,v=outgoing.direction,turn=Math.atan2(brushCross(u,v),brushDot(u,v));
  if(Math.abs(turn)<Math.PI/12||Math.abs(turn)>Math.PI*5/6||incoming.error>radius*.08||outgoing.error>radius*.08)return null;
  const denominator=brushCross(u,v);if(Math.abs(denominator)<1e-6)return null;
  const t=brushCross(brushSub(outgoing.origin,incoming.origin),v)/denominator,corner={x:incoming.origin.x+u.x*t,y:incoming.origin.y+u.y*t};
  if(Math.hypot(corner.x-center.x,corner.y-center.y)>=radius*.95)return null;
  const error=Math.sqrt(points.reduce((sum,p)=>sum+Math.min(project(p,points[0],corner).distance,project(p,corner,points.at(-1)).distance)**2,0)/points.length);
  return{point:corner,u,v,turn,error};
}
function brushSolve(matrix,rhs){
  const rows=matrix.map((row,i)=>[...row,rhs[i]]);
  for(let j=0;j<3;j++){let pivot=j;for(let i=j+1;i<3;i++)if(Math.abs(rows[i][j])>Math.abs(rows[pivot][j]))pivot=i;[rows[j],rows[pivot]]=[rows[pivot],rows[j]];if(Math.abs(rows[j][j])<1e-10)return null;const divisor=rows[j][j];for(let k=j;k<4;k++)rows[j][k]/=divisor;for(let i=0;i<3;i++)if(i!==j){const factor=rows[i][j];for(let k=j;k<4;k++)rows[i][k]-=factor*rows[j][k];}}
  return rows.map(row=>row[3]);
}
function brushCircle(points,brushRadius){
  const origin=points.reduce((sum,p)=>({x:sum.x+p.x/points.length,y:sum.y+p.y/points.length}),{x:0,y:0}),matrix=Array.from({length:3},()=>[0,0,0]),rhs=[0,0,0];
  for(const p of points){const x=p.x-origin.x,y=p.y-origin.y,row=[x,y,1],target=-(x*x+y*y);for(let j=0;j<3;j++){rhs[j]+=row[j]*target;for(let k=0;k<3;k++)matrix[j][k]+=row[j]*row[k];}}
  const solved=brushSolve(matrix,rhs);if(!solved)return null;const center={x:origin.x-solved[0]/2,y:origin.y-solved[1]/2},squared=(solved[0]**2+solved[1]**2)/4-solved[2],radius=Math.sqrt(squared);
  if(!(radius>brushRadius*.2&&radius<brushRadius*100))return null;const error=Math.sqrt(points.reduce((sum,p)=>sum+(Math.hypot(p.x-center.x,p.y-center.y)-radius)**2,0)/points.length);
  return error<brushRadius*.08?{center,radius,error}:null;
}
function brushSplit(nodes,index,t){
  if(t<1e-9)return index;if(t>1-1e-9)return(index+1)%nodes.length;
  const a=nodes[index],b=nodes[(index+1)%nodes.length];let node;
  if(a.out||b.in){const p=mix(a,a.out||a,t),q=mix(a.out||a,b.in||b,t),r=mix(b.in||b,b,t),s=mix(p,q,t),u=mix(q,r,t),v=mix(s,u,t);a.out=p;b.in=r;node={...v,in:s,out:u};}
  else node=mix(a,b,t);
  nodes.splice(index+1,0,node);return index+1;
}
function brushReplace(model,arc,interior){
  const n=model.nodes.length,nodes=model.nodes.map(cloneNode),from=((arc.from%n)+n)%n,to=((arc.to%n)+n)%n,fromEdge=Math.floor(from),endEdge=Math.floor(to),endT=to-endEdge,endInserted=endT>1e-9&&endT<1-1e-9;
  let end=brushSplit(nodes,endEdge,endT),startEdge=fromEdge,startT=from-fromEdge;
  // Split the original end first. Map the original start parameter into the
  // remaining exact subcurve, including a local arc crossing node zero.
  if(endInserted){
    if(fromEdge===endEdge){if(startT<endT)startT/=endT;else{startEdge++;startT=(startT-endT)/(1-endT);}}
    else if(end<=startEdge)startEdge++;
  }
  const startInserted=startT>1e-9&&startT<1-1e-9,start=brushSplit(nodes,startEdge,startT);if(startInserted&&start<=end)end++;
  const a=cloneNode(nodes[start]),b=cloneNode(nodes[end]);delete a.out;delete b.in;
  const replacement=[a,...interior.map(cloneNode),b].filter((p,i,array)=>!i||Math.hypot(p.x-array[i-1].x,p.y-array[i-1].y)>EPS);
  for(let i=(end+1)%nodes.length;i!==start;i=(i+1)%nodes.length)replacement.push(nodes[i]);
  return{origin:copyPoint(model.origin),nodes:replacement};
}
function brushRound(points,corner,center,radius,strength){
  const {point:c,u,v,turn}=corner,tan=Math.tan(Math.abs(turn)/2),budget=Math.min(Math.hypot(points[0].x-c.x,points[0].y-c.y),Math.hypot(points.at(-1).x-c.x,points.at(-1).y-c.y),radius-Math.hypot(c.x-center.x,c.y-center.y))*.85,targetRadius=budget/tan;
  let distance=Infinity;for(let i=1;i<points.length;i++)distance=Math.min(distance,project(c,points[i-1],points[i]).distance);
  const currentRadius=Math.max(0,distance/(1/Math.cos(Math.abs(turn)/2)-1)),nextRadius=currentRadius+strength*(targetRadius-currentRadius);
  if(!(targetRadius>currentRadius+1e-5&&nextRadius>EPS*100))return null;
  const tangent=nextRadius*tan,start={x:c.x-u.x*tangent,y:c.y-u.y*tangent},end={x:c.x+v.x*tangent,y:c.y+v.y*tangent},sign=Math.sign(turn),circle={x:start.x-u.y*sign*nextRadius,y:start.y+u.x*sign*nextRadius},startAngle=Math.atan2(start.y-circle.y,start.x-circle.x),segments=Math.ceil(Math.abs(turn)/(Math.PI/2)),nodes=[{...start,manual:true}];
  for(let i=0;i<segments;i++){
    const a=startAngle+turn*i/segments,b=startAngle+turn*(i+1)/segments,delta=b-a,k=4/3*Math.tan(delta/4)*nextRadius,p0=nodes.at(-1),p1={x:circle.x+nextRadius*Math.cos(b),y:circle.y+nextRadius*Math.sin(b),manual:true};
    p0.out={x:p0.x-Math.sin(a)*k,y:p0.y+Math.cos(a)*k};p1.in={x:p1.x+Math.sin(b)*k,y:p1.y-Math.cos(b)*k};nodes.push(p1);
  }
  nodes.at(-1).x=end.x;nodes.at(-1).y=end.y;return{nodes,roundRadius:nextRadius,targetRadius};
}

/** Local circular brush. Model nodes/center/radius are calibrated millimetres.
 * No original item, photo, reserve, origin or existing point operation changes.
 * Repeated round dabs progressively increase a true tangent fillet; other modes
 * progressively fair only the nearest connected profile arc inside the circle.
 * Invalid topology rejects the complete dab and returns an independent copy. */
export function smoothContourModel(model,{center,radius,strength=.2,mode='auto'}={}){
  if(!finite(center)||!Number.isFinite(radius)||radius<=0||radius>3000||!Number.isFinite(strength)||strength<0||strength>1||!['auto','line','round','arc','corner'].includes(mode))throw i18nError('Nastavení vyhlazovacího štětce není platné.');
  if(!finite(model?.origin)||!Array.isArray(model?.nodes)||model.nodes.length<3||model.nodes.length>MAX_POINTS||!model.nodes.every(node=>finite(node)&&(!node.in||finite(node.in))&&(!node.out||finite(node.out))))throw i18nError('Bod kontury nemá platnou polohu.');
  const unchanged=(reason,extra={})=>({model:cloneContourModel(model),changed:false,kind:'none',reason,...extra});
  if(!strength)return unchanged('zero-strength');const arc=brushLocalArc(model,center,radius);if(!arc)return unchanged('outside-brush');
  if(arc.to-arc.from>=model.nodes.length-1e-7)return unchanged('whole-contour-inside-brush');
  const actual=brushArcPoints(model,arc,radius);if(actual.length<2||Math.hypot(actual[0].x-actual.at(-1).x,actual[0].y-actual.at(-1).y)<EPS)return unchanged('no-open-local-arc');
  const points=brushResample(actual,65),corner=brushCorner(points,center,radius),circle=brushCircle(points,radius),useCorner=corner&&(!circle||corner.error<=circle.error*1.15);let kind=mode==='arc'?'round':mode,interior,metadata={};
  if(kind==='auto')kind=useCorner?'corner':circle?'arc':'line';
  if(kind==='round'&&corner){const rounded=brushRound(actual,corner,center,radius,strength);if(!rounded)return unchanged('no-room-for-more-rounding');interior=rounded.nodes;metadata={roundRadius:rounded.roundRadius,targetRadius:rounded.targetRadius};}
  else{
    if(kind==='round'){if(!circle)return unchanged('no-stable-round-profile',{rejected:true});kind='arc';}
    if(kind==='corner'&&!corner)return unchanged('no-stable-corner',{rejected:true});
    const line={point:points[0],direction:brushUnit(brushSub(points.at(-1),points[0]))};if(!line.direction)return unchanged('no-profile-direction');let displacement=0;
    interior=points.slice(1,-1).map(p=>{
      let target;
      if(kind==='arc'){const direction=brushUnit(brushSub(p,circle.center));target={x:circle.center.x+direction.x*circle.radius,y:circle.center.y+direction.y*circle.radius};}
      else if(kind==='corner'){const a=project(p,points[0],corner.point),b=project(p,corner.point,points.at(-1));target=a.distance<b.distance?a.point:b.point;}
      else{const t=brushDot(brushSub(p,line.point),line.direction);target={x:line.point.x+line.direction.x*t,y:line.point.y+line.direction.y*t};}
      const d=brushSub(target,p),length=Math.hypot(d.x,d.y),weight=Math.max(0,1-((p.x-center.x)**2+(p.y-center.y)**2)/(radius*radius))**2*strength,factor=length?Math.min(1,radius*.35/length)*weight:0,next={x:p.x+d.x*factor,y:p.y+d.y*factor};displacement=Math.max(displacement,Math.hypot(next.x-p.x,next.y-p.y));return next;
    });
    if(displacement<1e-7)return unchanged('already-smooth',{kind});
  }
  try{
    // Every changed segment is in the convex brush disc. The old incoming and
    // outgoing subcurves retain their exact de Casteljau controls outside it.
    if(interior.some(node=>[node,node.in,node.out].filter(Boolean).some(p=>!finite(p)||Math.hypot(p.x-center.x,p.y-center.y)>radius+1e-6)))return unchanged('outside-brush-result',{rejected:true});
    const next=brushReplace(model,arc,interior);if(next.nodes.length>MAX_POINTS)return unchanged('point-limit',{rejected:true});
    validateContourModel(next);return{model:next,changed:true,kind,affectedNodes:interior.length,scope:{center:copyPoint(center),radius},...metadata};
  }catch(error){return unchanged(error.message||String(error),{rejected:true});}
}
