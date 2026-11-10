import Clipper from './vendor/clipper.js';

// Work in an axis-aligned, dimensionless frame: a 0.01 offset adds one
// percent of the full length/width to each side, including inside open jaws.
const GRID=1e7;
const signedArea=points=>points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)/2;
const area=points=>Math.abs(signedArea(points));
function bounds(points){let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const p of points){x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y);}return{x0,y0,x1,y1};}
function path(points){const out=points.map(p=>({X:Math.round(p.x*GRID),Y:Math.round(p.y*GRID)}));if(!Clipper.Clipper.Orientation(out))out.reverse();return out;}
const polygon=path=>path.map(p=>({x:p.X/GRID,y:p.Y/GRID}));
function operation(subject,clip=[],kind=Clipper.ClipType.ctUnion){
  const engine=new Clipper.Clipper(),out=[];engine.StrictlySimple=true;
  engine.AddPaths(subject.map(path),Clipper.PolyType.ptSubject,true);
  if(clip.length)engine.AddPaths(clip.map(path),Clipper.PolyType.ptClip,true);
  engine.Execute(kind,out,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero);
  return out.map(polygon).filter(points=>area(points)>1e-12);
}
function offset(points,amount){
  if(Math.abs(amount)<1/GRID)return [points.map(p=>({...p}))];
  const engine=new Clipper.ClipperOffset(2,.0002*GRID),out=[];
  engine.AddPath(path(points),Clipper.JoinType.jtRound,Clipper.EndType.etClosedPolygon);
  engine.Execute(out,amount*GRID);
  return out.map(polygon).filter(points=>area(points)>1e-12);
}
function frameOf(points){
  // Polygon area moments do not depend on how many pixels sampled each edge.
  // Translate first so millimetre-sized tools also work far from world zero.
  const reference=points[0],local=points.map(p=>({x:p.x-reference.x,y:p.y-reference.y}));
  let a=0,cx=0,cy=0,xx=0,xy=0,yy=0;
  for(let i=0;i<local.length;i++){
    const p=local[i],q=local[(i+1)%local.length],cross=p.x*q.y-q.x*p.y;
    a+=cross;cx+=(p.x+q.x)*cross;cy+=(p.y+q.y)*cross;
    xx+=(p.x*p.x+p.x*q.x+q.x*q.x)*cross;yy+=(p.y*p.y+p.y*q.y+q.y*q.y)*cross;
    xy+=(2*p.x*p.y+p.x*q.y+q.x*p.y+2*q.x*q.y)*cross;
  }
  cx/=3*a;cy/=3*a;
  const angle=.5*Math.atan2(2*(xy/(12*a)-cx*cy),xx/(6*a)-cx*cx-yy/(6*a)+cy*cy);
  return{origin:{x:reference.x+cx,y:reference.y+cy},ax:Math.cos(angle),ay:Math.sin(angle)};
}
function lineDistance(p,a,b){const x=b.x-a.x,y=b.y-a.y,d=x*x+y*y,t=d?Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/d)):0;return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y);}
function simplifyChain(points,tolerance){
  const keep=new Uint8Array(points.length);keep[0]=keep[points.length-1]=1;
  const pending=[[0,points.length-1]];
  while(pending.length){
    const [a,b]=pending.pop();let furthest=-1,distance=tolerance;
    for(let i=a+1;i<b;i++){const d=lineDistance(points[i],points[a],points[b]);if(d>distance){distance=d;furthest=i;}}
    if(furthest>=0){keep[furthest]=1;pending.push([a,furthest],[furthest,b]);}
  }
  return points.filter((_,i)=>keep[i]);
}
function simplifyClosed(points,tolerance){
  let first=0;for(let i=1;i<points.length;i++)if(points[i].x<points[first].x||points[i].x===points[first].x&&points[i].y<points[first].y)first=i;
  const ordered=[...points.slice(first),...points.slice(0,first)];let split=1,furthest=0;
  for(let i=1;i<ordered.length;i++){const d=Math.hypot(ordered[i].x-ordered[0].x,ordered[i].y-ordered[0].y);if(d>furthest){furthest=d;split=i;}}
  return [...simplifyChain(ordered.slice(0,split+1),tolerance).slice(0,-1),...simplifyChain([...ordered.slice(split),ordered[0]],tolerance).slice(0,-1)];
}
function smoothBoundary(points,reach){
  if(!reach)return points;
  let first=0;for(let i=1;i<points.length;i++)if(points[i].x<points[first].x-1e-7||Math.abs(points[i].x-points[first].x)<1e-7&&points[i].y<points[first].y)first=i;
  points=[...points.slice(first),...points.slice(0,first)];
  const distances=[0];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];distances.push(distances.at(-1)+Math.hypot(b.x-a.x,b.y-a.y));}
  const perimeter=distances.at(-1),count=Math.min(4096,Math.max(128,Math.ceil(perimeter/.0015))),step=perimeter/count,samples=[];let edge=0;
  for(let i=0;i<count;i++){
    const distance=i*step;while(edge<points.length-1&&distances[edge+1]<distance)edge++;
    const a=points[edge],b=points[(edge+1)%points.length],t=(distance-distances[edge])/(distances[edge+1]-distances[edge]||1);
    samples.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  }
  const radius=Math.max(1,Math.round(reach/step));
  return samples.map((_,i)=>{let x=0,y=0,weight=0;for(let j=-radius;j<=radius;j++){const p=samples[(i+j+count)%count],w=radius+1-Math.abs(j);x+=p.x*w;y+=p.y*w;weight+=w;}return{x:x/weight,y:y/weight};});
}

/** A smooth, asymmetric manufacturing silhouette in the original mm/world frame.
 * Reserve is total dimensional growth: .02 means approximately 100 -> 102 mm.
 * Small measured teeth are simplified before rounding; raw edges are never
 * unioned back into the pocket. Important openings remain concave. If bounded
 * smoothing cannot retain all material, a diagnosed final source-offset uses
 * the same reserve and rounded corners without the boundary smoothing step. */
export function fitIdealPocket(input,{reserveRatio=.02}={}){
  if(!Array.isArray(input)||input.length<3||input.length>6000||input.some(p=>!p||typeof p.x!=='number'||typeof p.y!=='number'||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>1e6||Math.abs(p.y)>1e6))throw new Error('Nástroj nemá platnou konturu pro hladkou kapsu.');
  if(typeof reserveRatio!=='number'||!Number.isFinite(reserveRatio)||reserveRatio<0||reserveRatio>.2)throw new Error('Rezerva hladké kapsy musí být od 0 do 20 %.');
  const points=input.map(p=>({x:p.x,y:p.y})),size=bounds(points),span=Math.max(size.x1-size.x0,size.y1-size.y0);
  const reference=points[0],translated=points.map(p=>({x:p.x-reference.x,y:p.y-reference.y}));
  if(!(area(translated)>Math.max(1e-12,span*span*1e-12)))throw new Error('Nástroj nemá platnou plochu pro hladkou kapsu.');
  const frame=frameOf(points),local=points.map(p=>{const x=p.x-frame.origin.x,y=p.y-frame.origin.y;return{x:x*frame.ax+y*frame.ay,y:-x*frame.ay+y*frame.ax};});let b=bounds(local);
  if(-b.x0>b.x1+span*1e-8){frame.ax=-frame.ax;frame.ay=-frame.ay;for(const p of local){p.x=-p.x;p.y=-p.y;}b=bounds(local);}
  const length=b.x1-b.x0,width=b.y1-b.y0;
  if(!(length>0&&width>0))throw new Error('Nástroj nemá platné rozměry.');
  const source=local.map(p=>({x:(p.x-b.x0)/length,y:(p.y-b.y0)/width})),simple=operation([source]);
  if(simple.length!==1||Math.abs(area(simple[0])-area(source))>Math.max(1e-9,area(source)*1e-7))throw new Error('Kontura nástroje se nesmí křížit.');
  const reserve=reserveRatio/2,tolerance=Math.min(.005,reserve*.5),rounding=Math.min(.005,reserve*.5);
  const exact=simplifyClosed(simple[0],1e-7),alreadyStraight=exact.length<=4;
  const proposal=alreadyStraight?exact:simplifyClosed(smoothBoundary(simple[0],Math.min(.012,reserve*1.2)),tolerance),clean=operation([proposal]);
  // A narrow real neck must not be erased by smoothing. In that case the
  // simplified outline itself is the base and the reserve rounds its outside.
  const reduced=clean.length===1?offset(clean[0],-rounding):[];
  let fallback,filledOffsetHoles=0,filledOffsetHoleAreaRatio=0;
  let base=reduced.length===1?reduced[0]:clean.length===1?clean[0]:simple[0],amount=reserve+(reduced.length===1?rounding:0),result=offset(base,amount);
  const contains=shape=>shape.length===1&&operation([source],shape,Clipper.ClipType.ctDifference).reduce((sum,p)=>sum+area(p),0)<1e-9;
  if(!contains(result)){
    // Any lost tooth is covered by a smooth extra offset, never by reattaching
    // its pixel chain. The bounded allowance also handles sharp convex tips.
    for(let step=1;step<=4&&!contains(result);step++)result=offset(base,amount+tolerance*step/2);
  }
  if(!contains(result)){
    base=clean.length===1?clean[0]:simple[0];amount=reserve;
    result=offset(base,amount);
    for(let step=1;step<=4&&!contains(result);step++)result=offset(base,amount+tolerance*step/2);
  }
  if(!contains(result)){
    // Last attempt: offset the already validated source with the requested
    // reserve exactly once. This changes no successful smoothed candidate.
    fallback='source-offset';result=offset(simple[0],reserve);
    if(result.length>1){
      const outers=result.filter(points=>signedArea(points)>0);
      if(outers.length===1){
        const outer=outers[0],holes=result.filter(points=>points!==outer);
        // A positive offset can close a narrow opening and leave an enclosed
        // hole. A manufacturing pocket uses its exterior. Never discard another
        // outer component, an uncontained path, or any measured source material.
        const holesInside=holes.every(points=>signedArea(points)<0&&operation([points],[outer],Clipper.ClipType.ctDifference).reduce((sum,path)=>sum+area(path),0)<1e-9);
        if(holesInside&&contains([outer])){filledOffsetHoles=holes.length;filledOffsetHoleAreaRatio=holes.reduce((sum,points)=>sum+area(points),0)/area(source);result=[outer];}
      }
    }
  }
  if(!contains(result))throw new Error('Hladká kapsa nemůže bezpečně obepnout tuto konturu.');
  const world=p=>{const x=b.x0+p.x*length,y=b.y0+p.y*width;return{x:frame.origin.x+x*frame.ax-y*frame.ay,y:frame.origin.y+x*frame.ay+y*frame.ax};};
  return{points:result[0].map(world),axis:{start:world({x:0,y:-b.y0/width}),end:world({x:1,y:-b.y0/width})},primitives:[],kind:'ideal',reserveRatio,...(fallback?{fallback,filledOffsetHoles,filledOffsetHoleAreaRatio}:{})};
}
