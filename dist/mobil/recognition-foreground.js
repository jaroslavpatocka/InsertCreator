/** Source-pixel geometry. No annotations, tool classes, or inference coordinates. */
import { traceMask, polygonArea, simplifyContour } from './trace.js';
import { simple } from './contour-smoothing.js';
const median=a=>{a.sort((x,y)=>x-y);return a[Math.floor(a.length/2)]||0;};
export const intersection=(a,b)=>{let i=0,j=0,total=0;while(i<a.length&&j<b.length){const lo=Math.max(a[i],b[j]),hi=Math.min(a[i]+a[i+1],b[j]+b[j+1]);total+=Math.max(0,hi-lo);if(a[i]+a[i+1]<b[j]+b[j+1])i+=2;else j+=2;}return total;};
const ranges=(rle,width)=>{const rows=[];for(let i=0;i<rle.length;i+=2){let start=rle[i],left=rle[i+1];while(left){const y=Math.floor(start/width),x=start%width,n=Math.min(left,width-x);rows.push({x,y,n});start+=n;left-=n;}}return rows;};
function geometry(instance,width,height){
 let area=0,sx=0,sy=0,sxx=0,syy=0,sxy=0,x0=width,y0=height,x1=-1,y1=-1,border=0;const rows=ranges(instance.maskRLE,width),points=[];
 for(const {x,y,n} of rows){const end=x+n-1,sum=n*(x+end)/2,squares=(end*(end+1)*(2*end+1)-(x-1)*x*(2*x-1))/6;
  area+=n;sx+=sum;sy+=y*n;sxx+=squares;syy+=y*y*n;sxy+=sum*y;x0=Math.min(x0,x);x1=Math.max(x1,end);y0=Math.min(y0,y);y1=Math.max(y1,y);border+=Math.max(0,Math.min(n,3-x))+Math.max(0,Math.min(n,end-width+4))+(y<3||y>=height-3?n:0);points.push({x,y},{x:end,y});
 }
 const mx=sx/area,my=sy/area,angle=.5*Math.atan2(2*(sxy/area-mx*my),sxx/area-mx*mx-syy/area+my*my),axis={x:Math.cos(angle),y:Math.sin(angle)};
 return{...instance,id:instance.id??'anchor-'+instance.anchorIndex,area,rows,points,axis,center:{x:mx,y:my},bounds:{x0,y0,x1,y1,border}};
}
const project=(points,axis)=>{let lo=Infinity,hi=-Infinity;for(const p of points){const v=p.x*axis.x+p.y*axis.y;lo=Math.min(lo,v);hi=Math.max(hi,v);}return{lo,hi,length:hi-lo};};
function dilateRLE(instance,width,height,radius){
 const rows=new Map();for(const {x,y,n} of instance.rows)for(let dy=-radius;dy<=radius;dy++){const yy=y+dy;if(yy<0||yy>=height)continue;if(!rows.has(yy))rows.set(yy,[]);rows.get(yy).push([Math.max(0,x-radius),Math.min(width,x+n+radius)]);}
 const rle=[];for(const y of [...rows.keys()].sort((a,b)=>a-b)){const intervals=rows.get(y).sort((a,b)=>a[0]-b[0]);let left=-1,right=-1;for(const [a,b] of intervals){if(a<=right)right=Math.max(right,b);else{if(left>=0)rle.push(y*width+left,right-left);left=a;right=b;}}if(left>=0)rle.push(y*width+left,right-left);}return rle;
}
function throughBackground(image,parent,a,b,axis,diagnostics={}){
 const normal={x:-axis.y,y:axis.x},pr=project(parent.points,axis),va=a.center.x*normal.x+a.center.y*normal.y,vb=b.center.x*normal.x+b.center.y*normal.y;
 const v0=Math.min(va,vb),v1=Math.max(va,vb),step=Math.max(1,Math.ceil(Math.max(pr.length,v1-v0)/512)),w=Math.ceil(pr.length/step)+1,h=Math.ceil((v1-v0)/step)+1;
 if(w<3||h<3)return false;
 const ring=[[],[],[]],{width,height,data}=image,box=parent.bounds;
 for(let y=Math.max(0,box.y0-8);y<=Math.min(height-1,box.y1+8);y+=2)for(let x=Math.max(0,box.x0-8);x<=Math.min(width-1,box.x1+8);x+=2){if(x>=box.x0&&x<=box.x1&&y>=box.y0&&y<=box.y1)continue;const p=(y*width+x)*4;for(let c=0;c<3;c++)ring[c].push(data[p+c]);}
 const bg=ring.map(median),noise=median(ring[0].map((_,i)=>Math.max(...ring.map((v,c)=>Math.abs(v[i]-bg[c]))))),tolerance=Math.max(12,noise*3);
 if(tolerance>24){Object.assign(diagnostics,{reason:'uncertain-background',bg,noise,tolerance,w,h});return false;}
 const allowed=new Uint8Array(w*h),seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let head=0,tail=0;
 const bgMax=Math.max(...bg),chromaTolerance=Math.max(3,noise*255/Math.max(32,bgMax)),edgeThreshold=Math.max(6,noise*3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const u=pr.lo+x*step,v=v0+y*step,xx=Math.round(axis.x*u+normal.x*v),yy=Math.round(axis.y*u+normal.y*v);if(xx<=0||yy<=0||xx>=width-1||yy>=height-1)continue;const p=(yy*width+xx)*4,maximum=Math.max(data[p],data[p+1],data[p+2]);
  const direct=[0,1,2].every(c=>Math.abs(data[p+c]-bg[c])<=tolerance),shadow=maximum>24&&maximum<bgMax&&[0,1,2].every(c=>Math.abs(data[p+c]/maximum*255-bg[c]/bgMax*255)<=chromaTolerance);
  let gradient=0;for(let c=0;c<3;c++)gradient=Math.max(gradient,Math.hypot(data[p+4+c]-data[p-4+c],data[p+width*4+c]-data[p-width*4+c])/2);
  allowed[y*w+x]=+((direct||shadow)&&gradient<edgeThreshold);
 }
 for(let y=0;y<h;y++)if(allowed[y*w]){queue[tail++]=y*w;seen[y*w]=1;}
 while(head<tail){const p=queue[head++],x=p%w,y=Math.floor(p/w);if(x===w-1)return true;for(const q of [x?p-1:-1,x+1<w?p+1:-1,y?p-w:-1,y+1<h?p+w:-1])if(q>=0&&allowed[q]&&!seen[q]){seen[q]=1;queue[tail++]=q;}}
 Object.assign(diagnostics,{reason:'blocked-corridor',bg,noise,tolerance,w,h});return false;
}
export function resolveInstanceHierarchy(image,instances){
 const {width,height}=image,all=instances.map(row=>geometry(row,width,height)),rejectedGroups=[],frameBand=Math.max(3,Math.ceil(Math.max(width,height)/256)*2+2);
 const admissible=all.filter(row=>{
  if(row.area<12||row.bounds.border>=Math.max(3,Math.min(width,height)*.02)||row.area>=width*height*.7)return false;
  if(row.area>=width*height*.08){
   const top=new Uint8Array(width),bottom=new Uint8Array(width),left=new Uint8Array(height),right=new Uint8Array(height);
   const models=new Map(),same=(p,q,step)=>{
    const key=q+':'+step;let model=models.get(key);
    if(!model){const color=[];let noise=0;for(let c=0;c<3;c++){const a=image.data[q*4+c],b=image.data[(q+step)*4+c],d=image.data[(q+step*2)*4+c],m=a+b+d-Math.min(a,b,d)-Math.max(a,b,d);color.push(m);noise=Math.max(noise,Math.abs(a-m),Math.abs(b-m),Math.abs(d-m));}model={color,tolerance:Math.max(8,Math.min(24,noise*3))};models.set(key,model);}
    return[0,1,2].every(c=>Math.abs(image.data[p*4+c]-model.color[c])<=model.tolerance);
   };
   for(const {x,y,n}of row.rows){
    if(y<frameBand)for(let xx=x;xx<x+n;xx++)if(same(y*width+xx,xx,width))top[xx]=1;
    if(y>=height-frameBand)for(let xx=x;xx<x+n;xx++)if(same(y*width+xx,(height-1)*width+xx,-width))bottom[xx]=1;
    for(let xx=x;xx<Math.min(x+n,frameBand);xx++)if(same(y*width+xx,y*width,1))left[y]=1;
    for(let xx=Math.max(x,width-frameBand);xx<x+n;xx++)if(same(y*width+xx,y*width+width-1,-1))right[y]=1;
   }
   const fraction=(pixels,side)=>pixels.reduce((sum,v)=>sum+v,0)/side,t=fraction(top,width),b=fraction(bottom,width),l=fraction(left,height),r=fraction(right,height);
   if((t>=.4||b>=.4)&&(l>=.4||r>=.4)){rejectedGroups.push({id:row.id,children:[],reason:'source-frame-background',frameCoverage:{top:t,bottom:b,left:l,right:r}});return false;}
  }
  return true;
 });
 const overlaps=new Map(),overlap=(a,b)=>{const key=[a.id,b.id].sort().join(':');if(!overlaps.has(key))overlaps.set(key,intersection(a.maskRLE,b.maskRLE));return overlaps.get(key);};
 // A proposal can label the photographed surface itself. Its outer contour
 // must not turn that background (or its tool-shaped holes) into a tool pocket.
 // Reject using original RGB appearance plus contained visible material; size
 // alone never rejects a physical tool.
 const ring=[[],[],[]],add=(x,y)=>{const p=(y*width+x)*4,a=image.data[p+3]/255;for(let c=0;c<3;c++)ring[c].push(image.data[p+c]*a+255*(1-a));};
 const stride=Math.max(1,Math.floor(Math.min(width,height)/160));for(let x=0;x<width;x+=stride){add(x,0);add(x,height-1);}for(let y=stride;y<height-1;y+=stride){add(0,y);add(width-1,y);}
 const bg=ring.map(c=>median(c.slice())),deviation=ring[0].map((_,i)=>Math.max(...ring.map((v,c)=>Math.abs(v[i]-bg[c])))),noise=median(deviation),tolerance=Math.max(16,Math.min(32,noise*3)),ratios=new Map();
 const backgroundRatio=node=>{
  if(ratios.has(node.id))return ratios.get(node.id);let same=0,total=0;const step=Math.max(1,Math.floor(node.area/4096));
  for(let i=0;i<node.maskRLE.length;i+=2)for(let q=node.maskRLE[i];q<node.maskRLE[i]+node.maskRLE[i+1];q+=step){const a=image.data[q*4+3]/255;same+=+([0,1,2].every(c=>Math.abs(image.data[q*4+c]*a+255*(1-a)-bg[c])<=tolerance));total++;}
  const ratio=same/Math.max(1,total);ratios.set(node.id,ratio);return ratio;
 };
 if(noise<=24)for(const parent of admissible){
  const likeness=backgroundRatio(parent);if(likeness<.65||parent.area<width*height*.08)continue;
  const material=admissible.filter(child=>child!==parent&&child.area>=Math.max(12,parent.area*.004)&&child.area<parent.area*.8&&backgroundRatio(child)<.4);
  if(!material.length)continue;
  const outlines=traceRLE(parent.maskRLE,width,height,0),filled=unionRLE(outlines.map(c=>polygonRLE(c.points,width,height))),children=material.filter(child=>intersection(child.maskRLE,filled)>=child.area*.9);
  if(children.length)rejectedGroups.push({id:parent.id,children:children.map(c=>c.id),reason:'source-background-container',backgroundFraction:likeness});
 }
 for(const parent of admissible){
  if(rejectedGroups.some(group=>group.id===parent.id))continue;
  const children=admissible.filter(child=>child!==parent&&child.area>parent.area*.08&&child.area<parent.area*.8&&overlap(child,parent)>=child.area*.95);
  let group=false;
  for(let i=0;i<children.length&&!group;i++)for(let j=i+1;j<children.length&&!group;j++){
   const a=children[i],b=children[j],axis=a.axis,normal={x:-axis.y,y:axis.x};if(overlap(a,b)>.1*Math.min(a.area,b.area))continue;
   // A source-background corridor separates arbitrary round or differently
   // oriented bodies too. The complete parent extent is tested, so an actual
   // connecting bar/handle blocks the corridor even when its colours change.
   const dx=b.center.x-a.center.x,dy=b.center.y-a.center.y,length=Math.hypot(dx,dy);
   if(length>2&&throughBackground(image,parent,a,b,{x:-dy/length,y:dx/length})){
    group=true;rejectedGroups.push({id:parent.id,children:[a.id,b.id],reason:'separate-source-bodies'});continue;
   }
   if(Math.abs(axis.x*b.axis.x+axis.y*b.axis.y)<.94)continue;
   const ar=project(a.points,axis),br=project(b.points,axis),pr=project(parent.points,axis),aw=project(a.points,normal),bw=project(b.points,normal);
   if(ar.length<pr.length*.72||br.length<pr.length*.72||ar.length<aw.length*2.5||br.length<bw.length*2.5)continue;
   if(throughBackground(image,parent,a,b,axis)){group=true;rejectedGroups.push({id:parent.id,children:[a.id,b.id]});}
  }
 }
 const viable=admissible.filter(row=>!rejectedGroups.some(g=>g.id===row.id)),cell=Math.max(1,Math.ceil(Math.max(width,height)/256)),dilated=new Map(),parents=[];
 const expanded=row=>{if(!dilated.has(row.id))dilated.set(row.id,dilateRLE(row,width,height,cell));return dilated.get(row.id);};
 const kept=viable.filter(child=>!viable.some(parent=>{
  if(parent===child||parent.area<child.area*1.03)return false;
  if(overlap(child,parent)<child.area*.5||intersection(child.maskRLE,expanded(parent))<child.area*.97)return false;
  parents.push({child:child.id,parent:parent.id});return true;
 }));
 return{all,admissible,kept,rejectedGroups,parents,cell};
}
export {geometry,project,throughBackground,dilateRLE};

/** A short missing proposal junction can be bridged only where source material
 * is continuous and bounded by two observed background edges. Returns actual
 * source pixels rather than a larger dilation or an inferred tool template. */
export function sourceSupportedBridge(image,a,b,{cell=Math.ceil(Math.max(image.width,image.height)/256),signal,barriers=[]}={}){
 const {width,height,data}=image,pointsA=a.seed?.points??traceRLE(a.maskRLE,width,height,0)[0]?.points,pointsB=b.seed?.points??traceRLE(b.maskRLE,width,height,0)[0]?.points,candidates=[];
 if(!pointsA?.length||!pointsB?.length)return null;const maxDistance=cell*4,ap=simplifyContour(pointsA,Math.max(.5,cell*.25)),bp=simplifyContour(pointsB,Math.max(.5,cell*.25));
 const projected=(p,u,v)=>{const dx=v.x-u.x,dy=v.y-u.y,t=Math.max(0,Math.min(1,((p.x-u.x)*dx+(p.y-u.y)*dy)/(dx*dx+dy*dy||1)));return{x:u.x+dx*t,y:u.y+dy*t};};
 const add=(p,q)=>{const distance=Math.hypot(q.x-p.x,q.y-p.y);if(distance>=.75&&distance<=maxDistance)candidates.push({p,q,distance});};
 for(let i=0;i<ap.length;i++){
  checkAbort(signal);const u=ap[i],v=ap[(i+1)%ap.length];
  for(let j=0;j<bp.length;j++){
   const s=bp[j],t=bp[(j+1)%bp.length];if(Math.max(Math.min(u.x,v.x),Math.min(s.x,t.x))-Math.min(Math.max(u.x,v.x),Math.max(s.x,t.x))>maxDistance||Math.max(Math.min(u.y,v.y),Math.min(s.y,t.y))-Math.min(Math.max(u.y,v.y),Math.max(s.y,t.y))>maxDistance)continue;
   add(u,projected(u,s,t));add(v,projected(v,s,t));add(projected(s,u,v),s);add(projected(t,u,v),t);
   for(const f of [.25,.5,.75]){const p={x:u.x+(v.x-u.x)*f,y:u.y+(v.y-u.y)*f};add(p,projected(p,s,t));const q={x:s.x+(t.x-s.x)*f,y:s.y+(t.y-s.y)*f};add(projected(q,u,v),q);}
  }
 }
 candidates.sort((x,y)=>x.distance-y.distance);if(!candidates.length)return null;const shortest=candidates[0].distance,unique=new Set();
 const rgb=(x,y)=>{if(x<0||y<0||x>=width||y>=height)return null;const q=(Math.floor(y)*width+Math.floor(x))*4,alpha=data[q+3]/255;return[0,1,2].map(c=>data[q+c]*alpha+255*(1-alpha));};
 const difference=(u,v)=>Math.max(...u.map((value,c)=>Math.abs(value-v[c]))),minor=node=>Math.min(node.bounds.x1-node.bounds.x0+1,node.bounds.y1-node.bounds.y0+1);
 for(const candidate of candidates){
  checkAbort(signal);if(candidate.distance>shortest+cell)break;
  const {p,q,distance}=candidate,key=[p.x,p.y,q.x,q.y].map(v=>Math.round(v)).join(':');if(unique.has(key))continue;unique.add(key);if(unique.size>64)break;
  const axis={x:(q.x-p.x)/distance,y:(q.y-p.y)/distance},normal={x:-axis.y,y:axis.x},middle={x:(p.x+q.x)/2,y:(p.y+q.y)/2},radius=Math.min(cell*16,Math.max(cell*3,Math.min(minor(a),minor(b))*.7)),samples=[];
  for(let i=0;i<32;i++){
   const angle=i*Math.PI/16,x=middle.x+Math.cos(angle)*radius,y=middle.y+Math.sin(angle)*radius,xx=Math.floor(x),yy=Math.floor(y);if(xx<0||yy<0||xx>=width||yy>=height)continue;const index=yy*width+xx;
   if(insideRLE(a.maskRLE,index)||insideRLE(b.maskRLE,index))continue;const color=rgb(x,y);if(color)samples.push(color);
  }
  if(samples.length<8)continue;const bg=[0,1,2].map(c=>median(samples.map(v=>v[c]))),noise=median(samples.map(v=>difference(v,bg)));
  if(noise>24)continue;const threshold=Math.max(20,noise*3),edgeThreshold=Math.max(8,noise*2),at=(u,v)=>rgb(p.x+axis.x*u+normal.x*v,p.y+axis.y*u+normal.y*v),foreground=color=>!!color&&difference(color,bg)>threshold;
  const count=Math.max(3,Math.ceil(distance*2)),path=new Set();let valid=true,minWidth=Infinity,maxWidth=0,minimumContrast=Infinity;
  for(let i=0;i<=count;i++){
   const u=distance*i/count,center=at(u,0);if(!foreground(center)){valid=false;break;}minimumContrast=Math.min(minimumContrast,difference(center,bg));
   let left=0,right=0;
   while(left>-radius&&foreground(at(u,left-1)))left--;
   while(right<radius&&foreground(at(u,right+1)))right++;
   const outsideLeft=at(u,left-1),insideLeft=at(u,left),outsideRight=at(u,right+1),insideRight=at(u,right),span=right-left+1;
   if(left<=-radius||right>=radius||span<2||!outsideLeft||!outsideRight||difference(outsideLeft,insideLeft)<edgeThreshold||difference(outsideRight,insideRight)<edgeThreshold){valid=false;break;}
   minWidth=Math.min(minWidth,span);maxWidth=Math.max(maxWidth,span);
   for(let v=left;v<=right;v+=.5){const x=Math.floor(p.x+axis.x*u+normal.x*v),y=Math.floor(p.y+axis.y*u+normal.y*v);if(x<0||y<0||x>=width||y>=height){valid=false;break;}const index=y*width+x;if(barriers.some(owner=>insideRLE(owner.maskRLE??owner,index))){valid=false;break;}path.add(index);}if(!valid)break;
  }
  if(!valid||!path.size||maxWidth>minWidth*4)continue;
  const ordered=[...path].sort((x,y)=>x-y),maskRLE=[];let start=ordered[0],end=start+1;for(let i=1;i<ordered.length;i++)if(ordered[i]===end)end++;else{maskRLE.push(start,end-start);start=ordered[i];end=start+1;}maskRLE.push(start,end-start);
  return{maskRLE,distance,area:path.size,minWidth,maxWidth,minimumContrast,backgroundNoise:noise,method:'bounded-source-material-bridge'};
 }
 return null;
}

export function checkAbort(signal) {
 if(signal?.aborted)throw new DOMException('Rozpoznávání bylo zrušeno.','AbortError');
}
export function unionRLE(arrays){
 const intervals=[];
 for(const rle of arrays)for(let i=0;i<rle.length;i+=2)intervals.push([rle[i],rle[i]+rle[i+1]]);
 intervals.sort((a,b)=>a[0]-b[0]);const out=[];let lo=-1,hi=-1;
 for(const [a,b] of intervals)if(a<=hi)hi=Math.max(hi,b);else{if(lo>=0)out.push(lo,hi-lo);lo=a;hi=b;}
 if(lo>=0)out.push(lo,hi-lo);return out;
}
export function insideRLE(rle,p){
 let lo=0,hi=rle.length/2-1;
 while(lo<=hi){const i=(lo+hi)>>1,start=rle[i*2],end=start+rle[i*2+1];if(p<start)hi=i-1;else if(p>=end)lo=i+1;else return true;}return false;
}
export function polygonRLE(points,width,height){
 const out=[];let ymin=height,ymax=0;for(const p of points){ymin=Math.min(ymin,p.y);ymax=Math.max(ymax,p.y);}
 for(let y=Math.max(0,Math.floor(ymin));y<Math.min(height,Math.ceil(ymax));y++){
  const xs=[];for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[j],b=points[i];if((a.y>y+.5)!==(b.y>y+.5))xs.push(a.x+(y+.5-a.y)*(b.x-a.x)/(b.y-a.y));}
  xs.sort((a,b)=>a-b);for(let i=0;i+1<xs.length;i+=2){const lo=Math.max(0,Math.ceil(xs[i]-.5)),hi=Math.min(width,Math.ceil(xs[i+1]-.5));if(hi>lo)out.push(y*width+lo,hi-lo);}
 }return out;
}
export function roiRLE(roi,width,height){
 const out=[];
 if(!roi||!Number.isInteger(roi.width)||!Number.isInteger(roi.height)||roi.data?.length!==roi.width*roi.height)throw new Error('Maska instance nemá platná pixelová data.');
 for(let y=0;y<roi.height;y++){
  const yy=y+roi.y;if(yy<0||yy>=height)continue;let start=-1;
  for(let x=0;x<=roi.width;x++){
   const xx=x+roi.x,on=x<roi.width&&xx>=0&&xx<width&&roi.data[y*roi.width+x];
   if(on&&start<0)start=xx;if(!on&&start>=0){out.push(yy*width+start,Math.min(width,xx)-start);start=-1;}
  }
 }return out;
}
/** Square morphology is separable and uses bounded sliding windows. */
function morph(mask,width,height,radius,dilate){
 if(radius<1)return mask.slice();const horizontal=new Uint8Array(mask.length),out=new Uint8Array(mask.length),span=radius*2+1;
 for(let y=0;y<height;y++){let sum=0;for(let x=0;x<=Math.min(width-1,radius);x++)sum+=mask[y*width+x];
  for(let x=0;x<width;x++){horizontal[y*width+x]=+(dilate?sum>0:sum===span);if(x-radius>=0)sum-=mask[y*width+x-radius];if(x+radius+1<width)sum+=mask[y*width+x+radius+1];}}
 for(let x=0;x<width;x++){let sum=0;for(let y=0;y<=Math.min(height-1,radius);y++)sum+=horizontal[y*width+x];
  for(let y=0;y<height;y++){out[y*width+x]=+(dilate?sum>0:sum===span);if(y-radius>=0)sum-=horizontal[(y-radius)*width+x];if(y+radius+1<height)sum+=horizontal[(y+radius+1)*width+x];}}
 return out;
}
export function closeMask(mask,width,height,radius){return morph(morph(mask,width,height,radius,true),width,height,radius,false);}
export function traceRLE(rle,width,height,radius=0){
 if(!rle.length)return[];const g=geometry({maskRLE:rle},width,height),b=g.bounds,pad=radius+3,x=Math.max(0,b.x0-pad),y=Math.max(0,b.y0-pad),w=Math.min(width,b.x1+pad+1)-x,h=Math.min(height,b.y1+pad+1)-y;
 let mask=new Uint8Array(w*h);for(const row of g.rows)mask.fill(1,(row.y-y)*w+row.x-x,(row.y-y)*w+row.x-x+row.n);
 if(radius)mask=closeMask(mask,w,h,radius);
 return traceMask(mask,w,h,{minArea:12,smoothing:.5}).contours.map(c=>({...c,points:c.points.map(p=>({x:p.x+x,y:p.y+y}))}));
}
/** A genuinely uniform photographed surface supports direct source components.
 * The gate uses source border statistics, never expected object counts. */
export function uniformForeground(image,signal){
 const {width,height,data}=image,channels=[[],[],[]],step=Math.max(1,Math.floor(Math.min(width,height)/200));
 const add=(x,y)=>{const p=(y*width+x)*4,a=data[p+3]/255;for(let c=0;c<3;c++)channels[c].push(data[p+c]*a+255*(1-a));};
 for(let x=0;x<width;x+=step){add(x,0);add(x,height-1);}for(let y=step;y<height-1;y+=step){add(0,y);add(width-1,y);}
 const bg=channels.map(c=>median(c.slice())),deltas=channels[0].map((_,i)=>Math.max(...channels.map((v,c)=>Math.abs(v[i]-bg[c])))).sort((a,b)=>a-b),noise=deltas[Math.floor(deltas.length*.97)];
 if(noise>3)return null;const mask=new Uint8Array(width*height),threshold=Math.max(8,noise*4);
 for(let y=0;y<height;y++){if(!(y&63))checkAbort(signal);for(let x=0;x<width;x++){const q=y*width+x,p=q*4,a=data[p+3]/255;mask[q]=+([0,1,2].some(c=>Math.abs(data[p+c]*a+255*(1-a)-bg[c])>threshold));}}
 // At sensor resolution a neutral reflective stripe can equal the background
 // for a pixel. One-pixel closing bridges that sampling dropout; visible gaps
 // wider than two source pixels remain open and identities remain components.
 const before=traceMask(mask,width,height,{minArea:12,smoothing:.5});
 const traced=traceMask(closeMask(mask,width,height,1),width,height,{minArea:12,smoothing:.5});
 if(!traced.contours.length)return null;
 return{...traced,background:bg,noise,requiresReview:traced.contours.length!==before.contours.length};
}

function loopSamples(points,spacing){
 const lengths=points.map((p,i)=>Math.hypot(p.x-points[(i+1)%points.length].x,p.y-points[(i+1)%points.length].y)),total=lengths.reduce((a,b)=>a+b,0),count=Math.max(12,Math.ceil(total/spacing)),out=[];let edge=0,before=0;
 for(let i=0;i<count;i++){const d=i*total/count;while(edge+1<points.length&&before+lengths[edge]<d){before+=lengths[edge];edge++;}const a=points[edge],b=points[(edge+1)%points.length],t=lengths[edge]?(d-before)/lengths[edge]:0;out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}return out;
}
/** Bounded RGB edge measurement. Invalid topology falls back to the seed. */
export function measureSourceContours(image,contours,{reach=Math.max(image.width,image.height)/256,signal}={}){
 const{width,height,data}=image,sample=(x,y)=>{x=Math.max(0,Math.min(width-1,x));y=Math.max(0,Math.min(height-1,y));const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),fx=x-x0,fy=y-y0;return[0,1,2].map(c=>(data[(y0*width+x0)*4+c]*(1-fx)+data[(y0*width+x1)*4+c]*fx)*(1-fy)+(data[(y1*width+x0)*4+c]*(1-fx)+data[(y1*width+x1)*4+c]*fx)*fy);},distance=(a,b)=>Math.sqrt(a.reduce((s,v,c)=>s+(v-b[c])**2,0)/3);
 return contours.map(contour=>{
  checkAbort(signal);const points=loopSamples(contour.points,1.5),n=points.length,sign=Math.sign(polygonArea(points))||1,offsets=[],observed=[],normals=[];let supported=0;
  let x0=width,x1=0,y0=height,y1=0;for(const p of points){x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);y0=Math.min(y0,p.y);y1=Math.max(y1,p.y);}
  const inward=Math.min(reach*10,Math.min(x1-x0,y1-y0)*.5);
  for(let i=0;i<n;i++){
   if(!(i&255))checkAbort(signal);const p=points[i],a=points[(i+n-2)%n],b=points[(i+2)%n],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1,normal={x:sign*dy/length,y:-sign*dx/length};normals.push(normal);
   const terminal=Math.max(x1-x0,y1-y0)>Math.min(x1-x0,y1-y0)*3&&(x1-x0>y1-y0?Math.abs(normal.x):Math.abs(normal.y))>.9;
   const at=d=>sample(p.x+normal.x*d,p.y+normal.y*d),far=[at(reach*2+2),at(reach*2+4),at(reach*2+6)],background=[0,1,2].map(c=>median(far.map(rgb=>rgb[c]))),noise=median(far.map(rgb=>distance(rgb,background))),minimum=Math.max(12,noise*4),outsideTolerance=Math.max(8,noise*3),candidates=[];
   for(let t=-inward;t<=reach*2+.01;t+=.5){const response=distance(at(t-.5),at(t+.5)),innerSupport=median([2,4,6].map(d=>distance(at(t-d),background)));let continuous=t<=reach*.5||terminal;if(t>reach*.5)for(let d=0;d<t-1;d++)if(distance(at(d),background)<Math.max(28,noise*4)){continuous=false;break;}candidates.push({t,response,credible:response>=minimum&&distance(at(t+3),background)<=outsideTolerance&&innerSupport>=Math.max(20,noise*4)&&continuous});}
   const groups=[];let current=[];for(const candidate of candidates){if(candidate.credible)current.push(candidate);else if(current.length){groups.push(current);current=[];}}if(current.length)groups.push(current);
   const peaks=groups.map(group=>group.reduce((a,b)=>b.response>a.response?b:a));peaks.sort((a,b)=>Math.abs(a.t)-Math.abs(b.t)||b.response-a.response);
   const dominant=peaks.filter(p=>p.t<-reach*1.5&&p.response>=Math.max(28,noise*6)).sort((a,b)=>b.response-a.response)[0];
   const selected=dominant&&(!peaks.length||dominant.response>=peaks[0].response*1.5)?dominant:peaks[0];
   if(selected){offsets.push(selected.t);observed.push(true);supported++;}else{offsets.push(0);observed.push(false);}
  }
  // Only a coherent macroscopic excess justifies moving the instance seed.
  // Do not replace sound small-part boundaries by noisy per-pixel gradients.
  // Interpolate unsupported short spans between matching observed boundaries;
  // supported near-seed material edges are retained as hard breakpoints.
  for(let i=0;i<n;i++)if(observed[i]&&offsets[i]<-reach*1.5){let gap=1;while(gap<n&&gap<=reach*12&&!observed[(i+gap)%n])gap++;const j=(i+gap)%n;if(gap>1&&gap<=reach*12&&observed[j]&&offsets[j]<-reach*1.5&&Math.abs(offsets[i]-offsets[j])<=reach*2&&normals[i].x*normals[j].x+normals[i].y*normals[j].y>.95)for(let k=1;k<gap;k++)offsets[(i+k)%n]=offsets[i]+(offsets[j]-offsets[i])*k/gap;}
  const selected=new Uint8Array(n),minimumRun=Math.ceil(reach*4);let first=offsets.findIndex(v=>v>=-reach*1.5);
  if(first<0)first=0;let run=[];for(let j=1;j<=n+1;j++){const i=(first+j)%n;if(j<=n&&offsets[i]<-reach*1.5)run.push(i);else{if(run.length>=minimumRun)for(const q of run)selected[q]=1;run=[];}}
  first=offsets.findIndex(v=>v<=reach*.5);if(first<0)first=0;run=[];for(let j=1;j<=n+1;j++){const i=(first+j)%n;if(j<=n&&offsets[i]>reach*.5)run.push(i);else{if(run.length>=2)for(const q of run)selected[q]=1;run=[];}}
  if(!selected.some(Boolean))return{...contour,measurement:{method:'bounded-source-normal',reach,inward,support:supported/n,maxDisplacement:0,valid:true,fallback:false}};
  const bounded=offsets.map((v,i)=>selected[i]?v:0),smooth=bounded.map((offset,i)=>(bounded[(i+n-2)%n]+bounded[(i+n-1)%n]*2+offset*3+bounded[(i+1)%n]*2+bounded[(i+2)%n])/9);let measured=points.map((p,i)=>({x:p.x+normals[i].x*smooth[i],y:p.y+normals[i].y*smooth[i]})),topologyRepair=false;
  if(!simple(measured)){
   // Normal rays can cross near a corner. Resolve only tiny folded slivers on
   // the original source grid, then require one dominant, valid owner again.
   const repaired=traceRLE(polygonRLE(measured,width,height),width,height,0);
   if(repaired.length&&repaired.slice(1).reduce((sum,c)=>sum+c.area,0)<repaired[0].area*.01){measured=repaired[0].points;topologyRepair=true;}
  }
  // Photometric material in the seed is a veto, including coloured grips and
  // narrow dark loops. Background removal must not delete an established body.
  const ring=[[],[],[]];for(let y=Math.max(0,Math.floor(y0)-8);y<=Math.min(height-1,Math.ceil(y1)+8);y+=2)for(let x=Math.max(0,Math.floor(x0)-8);x<=Math.min(width-1,Math.ceil(x1)+8);x+=2){if(x>=x0&&x<=x1&&y>=y0&&y<=y1)continue;for(let c=0;c<3;c++)ring[c].push(data[(y*width+x)*4+c]);}
  const bg=ring.map(median),oldRLE=polygonRLE(contour.points,width,height),newRLE=polygonRLE(measured,width,height);let materialLoss=0;
  for(let i=0;i<oldRLE.length;i+=2)for(let q=oldRLE[i];q<oldRLE[i]+oldRLE[i+1];q++)if(!insideRLE(newRLE,q)&&[0,1,2].some(c=>Math.abs(data[q*4+c]-bg[c])>=32))materialLoss++;
  const valid=simple(measured)&&Math.abs(polygonArea(measured)/polygonArea(contour.points)-1)<.4&&materialLoss<=Math.max(12,contour.area*.01);
  return{...contour,points:valid?measured:contour.points,measurement:{method:'bounded-source-normal',reach,inward,support:supported/n,maxDisplacement:valid?Math.max(...smooth.map(Math.abs)):0,materialLoss,valid,fallback:!valid,topologyRepair}};
 });
}

/** Remove only a broad, connected background lobe, bounded inside one owner.
 * Narrow reflective details are left to the short normal measurement. A lobe
 * needs two-sided source-background support, an elongated footprint and a large
 * area share; detached foreground and invalid topology force the seed fallback. */
export function trimSourceBackground(image,contours,{cell=Math.ceil(Math.max(image.width,image.height)/256),signal,onDiagnostic}={}){
 const {width,height,data}=image;
 return contours.map((contour,owner)=>{
  checkAbort(signal);let xmin=width,xmax=0,ymin=height,ymax=0;for(const p of contour.points){xmin=Math.min(xmin,p.x);xmax=Math.max(xmax,p.x);ymin=Math.min(ymin,p.y);ymax=Math.max(ymax,p.y);}
  const pad=12,x0=Math.max(1,Math.floor(xmin)-pad),x1=Math.min(width-2,Math.ceil(xmax)+pad),y0=Math.max(1,Math.floor(ymin)-pad),y1=Math.min(height-2,Math.ceil(ymax)+pad),w=x1-x0+1,h=y1-y0+1;
  if(w<8||h<8)return contour;
  const mask=new Uint8Array(w*h),background=new Uint8Array(w*h),seen=new Uint8Array(w*h),queue=new Int32Array(w*h),rle=polygonRLE(contour.points,width,height),horizontal=xmax-xmin>ymax-ymin;
  for(let i=0;i<rle.length;i+=2)for(let p=rle[i];p<rle[i]+rle[i+1];p++)mask[(Math.floor(p/width)-y0)*w+p%width-x0]=1;
  for(let line=0;line<(horizontal?h:w);line++){
   const colors=[[],[],[]];for(let t=0;t<8;t++)for(const side of [0,1]){const x=horizontal?(side?x1-t:x0+t):x0+line,y=horizontal?y0+line:(side?y1-t:y0+t),p=(y*width+x)*4;for(let c=0;c<3;c++)colors[c].push(data[p+c]);}
   const color=colors.map(c=>median(c.slice())),noise=median(colors[0].map((_,i)=>Math.max(...colors.map((v,c)=>Math.abs(v[i]-color[c])))));
   if(noise>64)continue;const tolerance=Math.max(10,Math.min(24,noise*3));
   for(let t=0;t<(horizontal?w:h);t++){const x=horizontal?x0+t:x0+line,y=horizontal?y0+line:y0+t,p=(y*width+x)*4,q=(y-y0)*w+x-x0;background[q]=+([0,1,2].every(c=>Math.abs(data[p+c]-color[c])<=tolerance));}
  }
  let head=0,tail=0;for(let q=0;q<mask.length;q++)if(!mask[q]&&background[q]){seen[q]=1;queue[tail++]=q;}
  const adjacent=q=>{const x=q%w,y=Math.floor(q/w);return[x?q-1:-1,x+1<w?q+1:-1,y?q-w:-1,y+1<h?q+w:-1];};
  while(head<tail){const q=queue[head++];for(const n of adjacent(q))if(n>=0&&background[n]&&!seen[n]){seen[n]=1;queue[tail++]=n;}}
  // Bound the amount of inward measurement independently of pixel colour.
  const depths=new Uint16Array(mask.length);head=0;tail=0;for(let q=0;q<mask.length;q++)if(!mask[q]){depths[q]=1;queue[tail++]=q;}
  const reach=Math.max(8,cell*8);
  while(head<tail){const q=queue[head++];if(depths[q]>reach)continue;for(const n of adjacent(q))if(n>=0&&!depths[n]){depths[n]=depths[q]+1;queue[tail++]=n;}}
  const selected=new Uint8Array(mask.length),visited=new Uint8Array(mask.length);let removed=0;
  for(let start=0;start<mask.length;start++){
   if(!mask[start]||!seen[start]||visited[start]||!depths[start]||depths[start]>reach)continue;head=0;tail=1;queue[0]=start;visited[start]=1;let ax=w,ay=h,bx=0,by=0,mouth=0;
   while(head<tail){const q=queue[head++],x=q%w,y=Math.floor(q/w);ax=Math.min(ax,x);ay=Math.min(ay,y);bx=Math.max(bx,x);by=Math.max(by,y);mouth+=+(depths[q]===2);for(const n of adjacent(q))if(n>=0&&mask[n]&&seen[n]&&!visited[n]&&depths[n]&&depths[n]<=reach){visited[n]=1;queue[tail++]=n;}}
   const long=Math.max(bx-ax+1,by-ay+1),short=Math.min(bx-ax+1,by-ay+1),ownerLong=Math.max(xmax-xmin,ymax-ymin);
   if(tail>contour.area*.08)onDiagnostic?.({owner,area:contour.area,tail,long,short,density:tail/(long*short),mouth});
   if(tail>=contour.area*.12&&long>=short*4&&short>=cell*4&&tail/(long*short)>=.55&&long>=ownerLong*.4&&mouth>=long*.35){for(let i=0;i<tail;i++)selected[queue[i]]=1;removed+=tail;}
  }
  if(!removed||removed>contour.area*.4)return contour;
  const result=[];for(let y=0;y<h;y++){let start=-1;for(let x=0;x<=w;x++){const q=y*w+x,on=x<w&&mask[q]&&!selected[q];if(on&&start<0)start=x;if(!on&&start>=0){result.push((y+y0)*width+x0+start,x-start);start=-1;}}}
  const traced=traceRLE(result,width,height,0),main=traced[0];
  if(!main||main.area<contour.area*.6||traced.slice(1).reduce((sum,c)=>sum+c.area,0)>main.area*.05||!simple(main.points))return contour;
  return{...contour,...main,backgroundTrim:{removed,reach,method:'source-supported-background-lobe'}};
 });
}
