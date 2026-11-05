import Clipper from './vendor/clipper.js';

// Pockets deliberately enclose the measurement. Manufacturing clearance belongs
// to pocketOutline(), not to this geometric construction.
const GRID=1e6, TAU=Math.PI*2, ARC=64, MAX_PARTS=5;
const area=points=>Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)/2);
const median=values=>{const sorted=values.slice().sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)]??0;};
const path=points=>{const out=points.map(p=>({X:Math.round(p.x*GRID),Y:Math.round(p.y*GRID)}));if(!Clipper.Clipper.Orientation(out))out.reverse();return out;};
function boolean(subject,clip=[],type=Clipper.ClipType.ctUnion){
  const engine=new Clipper.Clipper(),out=[];engine.StrictlySimple=true;
  engine.AddPaths(subject.map(path),Clipper.PolyType.ptSubject,true);
  if(clip.length)engine.AddPaths(clip.map(path),Clipper.PolyType.ptClip,true);
  engine.Execute(type,out,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero);
  return out.map(p=>p.map(q=>({x:q.X/GRID,y:q.Y/GRID}))).filter(p=>area(p)>1e-12);
}
function frameOf(points){
  // Exact area moments are independent of vertex density and winding.
  let a=0,cx=0,cy=0,xx=0,xy=0,yy=0;
  for(let i=0;i<points.length;i++){
    const p=points[i],q=points[(i+1)%points.length],cross=p.x*q.y-q.x*p.y;
    a+=cross;cx+=(p.x+q.x)*cross;cy+=(p.y+q.y)*cross;
    xx+=(p.x*p.x+p.x*q.x+q.x*q.x)*cross;
    yy+=(p.y*p.y+p.y*q.y+q.y*q.y)*cross;
    xy+=(2*p.x*p.y+p.x*q.y+q.x*p.y+2*q.x*q.y)*cross;
  }
  const origin={x:cx/(3*a),y:cy/(3*a)};
  const angle=.5*Math.atan2(2*(xy/(12*a)-origin.x*origin.y),xx/(6*a)-origin.x**2-yy/(6*a)+origin.y**2);
  return{origin,angle,ax:Math.cos(angle),ay:Math.sin(angle)};
}
function localize(points,frame){return points.map(p=>{const x=p.x-frame.origin.x,y=p.y-frame.origin.y;return{x:x*frame.ax+y*frame.ay,y:-x*frame.ay+y*frame.ax};});}
function world(p,frame){return{x:frame.origin.x+p.x*frame.ax-p.y*frame.ay,y:frame.origin.y+p.x*frame.ay+p.y*frame.ax};}
function limits(points){let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const p of points){x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);y0=Math.min(y0,p.y);y1=Math.max(y1,p.y);}return{x0,x1,y0,y1};}
function clippedPoints(points,lo,hi){
  const out=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    if(a.x>=lo&&a.x<=hi)out.push(a);
    for(const x of [lo,hi])if((a.x<x&&b.x>x)||(a.x>x&&b.x<x))out.push({x,y:a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x)});
  }
  return out;
}
function regularCircle(points){
  if(points.length<16)return null;
  const b=limits(points),center={x:(b.x0+b.x1)/2,y:(b.y0+b.y1)/2},radii=points.map(p=>Math.hypot(p.x-center.x,p.y-center.y)),r=median(radii);
  if(Math.max(...radii)-Math.min(...radii)>Math.max(2e-6,r*1e-7))return null;
  const angles=points.map(p=>Math.atan2(p.y-center.y,p.x-center.x)).sort((a,b)=>a-b),step=TAU/points.length;
  if(angles.some((v,i)=>Math.abs((i? v-angles[i-1]:v+TAU-angles.at(-1))-step)>1e-5))return null;
  return{center,radius:r};
}
function solve3(matrix,values){
  const a=matrix.map((row,i)=>[...row,values[i]]);
  for(let k=0;k<3;k++){
    let pivot=k;for(let i=k+1;i<3;i++)if(Math.abs(a[i][k])>Math.abs(a[pivot][k]))pivot=i;
    if(Math.abs(a[pivot][k])<1e-14)return null;
    [a[k],a[pivot]]=[a[pivot],a[k]];const divisor=a[k][k];for(let j=k;j<4;j++)a[k][j]/=divisor;
    for(let i=0;i<3;i++)if(i!==k){const factor=a[i][k];for(let j=k;j<4;j++)a[i][j]-=factor*a[k][j];}
  }
  return a.map(row=>row[3]);
}
function regularArc(points,tolerance){
  if(points.length<5)return false;
  const endpoints=[points[0],points.at(-1)];points=points.slice(1,-1);
  // Least-squares circle, translated first to keep the small system conditioned.
  const mean={x:points.reduce((s,p)=>s+p.x,0)/points.length,y:points.reduce((s,p)=>s+p.y,0)/points.length};
  let xx=0,xy=0,yy=0,xr=0,yr=0;
  for(const p of points){const x=p.x-mean.x,y=p.y-mean.y,r=x*x+y*y;xx+=x*x;xy+=x*y;yy+=y*y;xr+=x*r;yr+=y*r;}
  const d=2*(xx*yy-xy*xy);
  if(Math.abs(d)>1e-14){
    const cx=mean.x+(yy*xr-xy*yr)/d,cy=mean.y+(xx*yr-xy*xr)/d,r=median(points.map(p=>Math.hypot(p.x-cx,p.y-cy)));
    if(points.every(p=>Math.abs(Math.hypot(p.x-cx,p.y-cy)-r)<=tolerance)&&endpoints.every(p=>{const distance=Math.hypot(p.x-cx,p.y-cy);return distance<=r+tolerance&&distance>=r*Math.cos(Math.PI/ARC)-tolerance;}))return true;
  }
  // Terminal ellipses share the tool axis. Fit A*x²+B*x+C*y²=1 in a
  // dimensionless frame, then verify every point instead of trusting the fit.
  const scale=Math.max(1,...points.map(p=>Math.hypot(p.x,p.y))),rows=points.map(p=>[(p.x/scale)**2,p.x/scale,(p.y/scale)**2]),matrix=Array.from({length:3},()=>Array(3).fill(0)),rhs=Array(3).fill(0);
  for(const row of rows)for(let i=0;i<3;i++){rhs[i]+=row[i];for(let j=0;j<3;j++)matrix[i][j]+=row[i]*row[j];}
  const solution=solve3(matrix,rhs);
  if(!solution||solution[0]*solution[2]<=0||!rows.every(row=>Math.abs(row.reduce((sum,v,i)=>sum+v*solution[i],0)-1)<tolerance/scale*8))return false;
  const shift=solution[1]**2/(4*solution[0]);
  if((1+shift)/solution[0]<=0)return false;
  return endpoints.every(p=>{const x=p.x/scale,y=p.y/scale,value=(solution[0]*x*x+solution[1]*x+solution[2]*y*y+shift)/(1+shift);return value<=1+tolerance/scale*8&&value>=Math.cos(Math.PI/ARC)**2-tolerance/scale*8;});
}
function constructedOutline(points,span){
  const tolerance=Math.max(5e-6,span*2e-7),n=points.length;
  const axial=points.map((p,i)=>{const q=points[(i+1)%n];return Math.abs(p.x-q.x)<tolerance||Math.abs(p.y-q.y)<tolerance;});
  // A compound construction is exactly mirror-symmetric about its shared
  // axis. This prevents a real but smooth asymmetric tool being mistaken for
  // a previously built pocket.
  const mirrored=points.map(p=>({x:p.x,y:-p.y})),difference=boolean([points],[mirrored],Clipper.ClipType.ctXor);
  if(difference.reduce((s,p)=>s+area(p),0)>Math.max(1e-7,area(points)*2e-6))return false;
  const bounds=limits(points);
  for(let k=0;k<48;k++){
    const x=bounds.x0+(k+.5)*(bounds.x1-bounds.x0)/48,ys=clippedPoints(points,x,x).map(p=>p.y).sort((a,b)=>a-b).filter((y,i,a)=>!i||y-a[i-1]>tolerance);
    if(ys.length>2)return false;
  }
  if(axial.every(Boolean))return n<=24;
  const start=axial.indexOf(true);if(start<0)return regularArc([...points,points[0]],tolerance*3);
  let run=[],arcs=0;
  for(let offset=1;offset<=n+1;offset++){
    const i=(start+offset)%n;
    if(!axial[i]){if(!run.length)run.push(points[i]);run.push(points[(i+1)%n]);}
    else if(run.length){if(!regularArc(run,tolerance*3))return false;arcs++;run=[];}
  }
  return arcs>0&&arcs<=12;
}
function enclosedEllipse(points,cx,rx,ry,type='ellipse'){
  // Supporting half-planes enclose complete straight boundary segments and
  // keep an already generated polygon unchanged when fitted again.
  let factor=1;
  for(let k=0;k<ARC;k++){
    const angle=TAU*(k+.5)/ARC,nx=Math.cos(angle),ny=Math.sin(angle);
    for(const p of points)factor=Math.max(factor,((p.x-cx)/rx*nx+p.y/ry*ny)/Math.cos(Math.PI/ARC));
  }
  rx*=factor;ry*=factor;
  const polygon=Array.from({length:ARC},(_,i)=>({x:cx+rx*Math.cos(i*TAU/ARC),y:ry*Math.sin(i*TAU/ARC)}));
  return{type,center:{x:cx,y:0},width:rx*2,height:ry*2,...(type==='circle'?{radius:rx}:{}),points:polygon,cost:Math.PI*rx*ry};
}
function rectangle(lo,hi,radius){return{type:'rectangle',center:{x:(lo+hi)/2,y:0},width:hi-lo,height:radius*2,points:[{x:lo,y:-radius},{x:hi,y:-radius},{x:hi,y:radius},{x:lo,y:radius}],cost:(hi-lo)*radius*2};}
function rounded(points,lo,hi,halfWidth,radius){
  const cx=(lo+hi)/2,hw=(hi-lo)/2;
  let grow=0;
  // The signed distance to a rounded box is convex. Enclosing every clipped
  // edge endpoint therefore also encloses every point along that edge.
  for(const p of points){const x=Math.abs(p.x-cx)-hw+radius,y=Math.abs(p.y)-halfWidth+radius;grow=Math.max(grow,Math.hypot(Math.max(0,x),Math.max(0,y))+Math.min(Math.max(x,y),0)-radius);}
  const w=hw+grow,h=halfWidth+grow;
  const polygon=[];
  for(const [x,y,start] of [[cx+w-radius,h-radius,0],[cx-w+radius,h-radius,Math.PI/2],[cx-w+radius,-h+radius,Math.PI],[cx+w-radius,-h+radius,Math.PI*1.5]])for(let k=0;k<=ARC/4;k++){
    const a=start+k*Math.PI/(ARC/2),r=radius/Math.cos(Math.PI/ARC);polygon.push({x:x+r*Math.cos(a),y:y+r*Math.sin(a)});
  }
  return{type:'rounded-rectangle',center:{x:cx,y:0},width:w*2,height:h*2,radius,points:polygon,cost:w*h*4-(4-Math.PI)*radius**2};
}
function bestPart(points,lo,hi,terminal,epsilon){
  const clipped=clippedPoints(points,lo,hi),radius=Math.max(...clipped.map(p=>Math.abs(p.y)))+epsilon;
  const candidates=[rectangle(lo-epsilon,hi+epsilon,radius)],length=hi-lo;
  if(terminal&&length>radius*2.1)for(const amount of [.25,.5])candidates.push(rounded(clipped,lo-epsilon,hi+epsilon,radius,radius*amount));
  if(terminal&&length/(2*radius)>.5&&length/(2*radius)<2.1){
    const cx=(lo+hi)/2;
    candidates.push(enclosedEllipse(clipped,cx,Math.max(length/2+epsilon,radius),Math.max(length/2+epsilon,radius),'circle'));
    if(length>radius*2.35)candidates.push(enclosedEllipse(clipped,cx,length/2+epsilon,radius));
  }
  // A round head is an intentional construction choice, even when a slightly
  // smaller box could enclose it. This prior trades a modest amount of unused
  // pocket for a much simpler, useful tool silhouette.
  const score=p=>p.cost*(p.type==='circle'?.72:p.type==='ellipse'?.76:1);
  return candidates.reduce((best,p)=>score(p)<score(best)? p:best);
}

/** Build a conservative, regular pocket around a measured tool polygon.
 * Coordinates, units and world frame are retained; no printing clearance is added.
 * Primitive points are ready to draw and union into one closed manufacturing loop. */
export function fitFunctionalPocket(input,options={}){
  if(!Array.isArray(input)||input.length<3||input.length>6000||input.some(p=>!p||typeof p.x!=='number'||typeof p.y!=='number'||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>1e6||Math.abs(p.y)>1e6))throw new Error('Nástroj nemá platnou konturu pro pravidelnou kapsu.');
  const points=input.map(p=>({x:p.x,y:p.y})),size=limits(points),span=Math.max(size.x1-size.x0,size.y1-size.y0);
  if(!(area(points)>Math.max(1e-12,span*span*1e-12)))throw new Error('Nástroj nemá platnou plochu pro pravidelnou kapsu.');
  const simple=boolean([points]);if(simple.length!==1||Math.abs(area(simple[0])-area(points))>Math.max(1e-7,area(points)*1e-7))throw new Error('Kontura nástroje se nesmí křížit.');
  const frame=frameOf(points);let local=localize(points,frame),b=limits(local);
  const epsilon=Math.max(2/GRID,span*1e-9),regular=regularCircle(local);
  if(regular){const polygon=points.map(p=>({...p})),center=world(regular.center,frame);return{points:polygon,axis:{start:world({x:b.x0,y:0},frame),end:world({x:b.x1,y:0},frame)},primitives:[{type:'circle',center,radius:regular.radius,width:regular.radius*2,height:regular.radius*2,angle:frame.angle,points:polygon.map(p=>({...p}))}],kind:'circle'};}
  if(Math.abs(area(local)-(b.x1-b.x0)*(b.y1-b.y0))<Math.max(1e-8,area(local)*1e-9)){
    const polygon=points.map(p=>({...p}));return{points:polygon,axis:{start:world({x:b.x0,y:0},frame),end:world({x:b.x1,y:0},frame)},primitives:[{type:'rectangle',center:world({x:(b.x0+b.x1)/2,y:(b.y0+b.y1)/2},frame),width:b.x1-b.x0,height:b.y1-b.y0,angle:frame.angle,points:polygon.map(p=>({...p}))}],kind:'rectangle',alreadyRegular:true};
  }
  if(constructedOutline(local,span))return{points:points.map(p=>({...p})),axis:{start:world({x:b.x0,y:0},frame),end:world({x:b.x1,y:0},frame)},primitives:[],kind:'compound',alreadyRegular:true};
  // A median section midpoint lets a substantial round head coexist with its
  // narrow shaft, rather than tilting the axis towards a dense group of vertices.
  const mids=[];
  for(let k=0;k<48;k++){const x=b.x0+(k+.5)*(b.x1-b.x0)/48,cut=clippedPoints(local,x,x);if(cut.length){const ys=cut.map(p=>p.y);mids.push((Math.min(...ys)+Math.max(...ys))/2);}}
  const middle=median(mids);frame.origin=world({x:0,y:middle},frame);local=localize(points,frame);b=limits(local);
  const length=b.x1-b.x0,width=Math.max(Math.abs(b.y0),Math.abs(b.y1))*2;
  let primitives;
  if(length<width*1.55){
    primitives=[bestPart(local,b.x0,b.x1,true,epsilon)];
  }else{
    const bins=72,cuts=Array.from({length:bins+1},(_,i)=>b.x0+length*i/bins),parts=Array.from({length:bins},()=>[]),penalty=length*width*.04;
    for(let lo=0;lo<bins;lo++)for(let hi=lo+2;hi<=bins;hi++)parts[lo][hi]=bestPart(local,cuts[lo],cuts[hi],lo===0||hi===bins,epsilon);
    const dp=Array.from({length:MAX_PARTS+1},()=>Array(bins+1).fill(null));dp[0][0]={cost:0};
    for(let count=1;count<=MAX_PARTS;count++)for(let hi=2;hi<=bins;hi++)for(let lo=0;lo<=hi-2;lo++)if(dp[count-1][lo]&&parts[lo]?.[hi]){
      const cost=dp[count-1][lo].cost+parts[lo][hi].cost+penalty;
      if(!dp[count][hi]||cost<dp[count][hi].cost)dp[count][hi]={cost,lo};
    }
    let count=1;for(let k=2;k<=MAX_PARTS;k++)if(dp[k][bins]?.cost<dp[count][bins]?.cost)count=k;
    primitives=[];for(let hi=bins;count>0;count--){const lo=dp[count][hi].lo;primitives.unshift(parts[lo][hi]);hi=lo;}
  }
  let united=boolean(primitives.map(p=>p.points));
  // Clipper's integer rounding is below a micron; nevertheless verify actual
  // polygon containment, including edges between sparsely sampled source tips.
  const remaining=united.length===1?boolean([local],united,Clipper.ClipType.ctDifference):[local];
  if(united.length!==1||remaining.reduce((sum,p)=>sum+area(p),0)>Math.max(1e-8,area(local)*1e-10)){
    primitives=[rectangle(b.x0-epsilon,b.x1+epsilon,Math.max(Math.abs(b.y0),Math.abs(b.y1))+epsilon)];united=[primitives[0].points];
  }
  const metadata=primitives.map(({cost,...p})=>({...p,center:world(p.center,frame),angle:frame.angle,points:p.points.map(q=>world(q,frame))}));
  return{points:united[0].map(p=>world(p,frame)),axis:{start:world({x:b.x0,y:0},frame),end:world({x:b.x1,y:0},frame)},primitives:metadata,kind:metadata.length===1?metadata[0].type:'compound'};
}

function crossWidth(points,x){
  let width=0;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    if(x<Math.min(a.x,b.x)-1e-8||x>Math.max(a.x,b.x)+1e-8)continue;
    if(Math.abs(a.x-b.x)<1e-10){width=Math.max(width,Math.abs(a.y),Math.abs(b.y));continue;}
    width=Math.max(width,Math.abs(a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x)));
  }
  return width;
}

/** Halfway between a measured macro silhouette and its regular construction.
 * Tiny ribs and isolated fins widen a smooth envelope instead of surviving as
 * local teeth. The measured polygon remains wholly inside the resulting pocket. */
export function fitHybridPocket(input,{blend=.5}={}){
  if(typeof blend!=='number'||!Number.isFinite(blend)||blend<0||blend>1)throw new Error('Poměr pravidelné kapsy musí být od 0 do 1.');
  const regular=fitFunctionalPocket(input);
  if(blend===1||regular.alreadyRegular||regular.kind==='circle'&&regular.points.length===input.length&&regular.points.every((p,i)=>p.x===input[i].x&&p.y===input[i].y))return{...regular,kind:'hybrid',blend};
  if(blend===0)return{...regular,points:input.map(p=>({...p})),kind:'hybrid',blend};
  const dx=regular.axis.end.x-regular.axis.start.x,dy=regular.axis.end.y-regular.axis.start.y,length=Math.hypot(dx,dy),frame={origin:regular.axis.start,ax:dx/length,ay:dy/length,angle:Math.atan2(dy,dx)};
  const source=localize(input,frame),envelope=localize(regular.points,frame),b=limits(envelope),count=256,step=(b.x1-b.x0)/count;
  const raw=Array.from({length:count+1},(_,i)=>crossWidth(source,b.x0+i*step)),smoothed=[];
  // A short triangular low-pass follows broad heads/handles while suppressing
  // ribs and little side projections. Shared-axis symmetry is deliberate.
  const radius=10;
  for(let i=0;i<=count;i++){
    let sum=0,weight=0;
    for(let j=-radius;j<=radius;j++){const index=Math.max(0,Math.min(count,i+j)),w=radius+1-Math.abs(j);sum+=raw[index]*w;weight+=w;}
    smoothed.push(sum/weight);
  }
  const at=x=>{const k=Math.max(0,Math.min(count,(x-b.x0)/step)),i=Math.min(count-1,Math.floor(k)),fraction=k-i;return smoothed[i]*(1-fraction)+smoothed[i+1]*fraction;};
  let allowance=2/GRID;
  for(let i=0;i<=count;i++)allowance=Math.max(allowance,raw[i]-smoothed[i]+2/GRID);
  for(const p of source)allowance=Math.max(allowance,Math.abs(p.y)-at(p.x)+2/GRID);
  const cuts=[...source.map(p=>p.x),...envelope.map(p=>p.x),...Array.from({length:count+1},(_,i)=>b.x0+i*step)].filter(x=>x>=b.x0-1e-8&&x<=b.x1+1e-8).sort((a,b)=>a-b).filter((x,i,a)=>!i||x-a[i-1]>1e-8);
  const upper=[],lower=[];
  for(const x of cuts){const outer=crossWidth(envelope,x),macro=Math.min(outer,at(x)+allowance),halfWidth=outer*blend+macro*(1-blend);upper.push({x,y:halfWidth});lower.push({x,y:-halfWidth});}
  const proposal=[...upper,...lower.reverse()],clipped=boolean([proposal],[envelope],Clipper.ClipType.ctIntersection),guarded=boolean([source,...clipped]);
  const safe=guarded.length===1&&guarded[0].length<=6000?guarded[0]:envelope;
  return{...regular,points:safe.map(p=>world(p,frame)),kind:'hybrid',blend};
}
