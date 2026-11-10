/** Deterministic, source-pixel selection. User labels supply object identity. */
import { traceMask, polygonArea, simplifyContour } from './trace.js';
import { simple } from './contour-smoothing.js';
import { prepareSelectionLighting, validateSelectionImage, selectionAbort, selectionYield } from './photo-selection-light.js';

export const MAX_SELECTION_PIXELS=4000000;
export const MAX_BOUNDARY_PIXELS=1000000;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const progress=(callback,signal,stage,value,message)=>{callback?.({stage,progress:value,message});selectionAbort(signal);};
function region(image,roi){
 if(!roi)return{x:0,y:0,width:image.width,height:image.height};
 if(!['x','y','width','height'].every(key=>Number.isFinite(roi[key]))||roi.width<=0||roi.height<=0)throw new Error('Výběr fotografie nemá platné rozměry.');
 const x=clamp(Math.floor(roi.x),0,image.width),y=clamp(Math.floor(roi.y),0,image.height),right=clamp(Math.ceil(roi.x+roi.width),0,image.width),bottom=clamp(Math.ceil(roi.y+roi.height),0,image.height);
 if(right<=x||bottom<=y)throw new Error('Výběr leží mimo fotografii.');return{x,y,width:right-x,height:bottom-y};
}
function point(image,roi,p){
 if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<roi.x||p.y<roi.y||p.x>=roi.x+roi.width||p.y>=roi.y+roi.height)throw new Error('Bod leží mimo vybranou oblast fotografie.');
 return{x:p.x,y:p.y};
}
class Heap{
 constructor(length,less){this.items=new Int32Array(length);this.positions=new Int32Array(length).fill(-1);this.size=0;this.less=less;}
 update(pixel){let i=this.positions[pixel];if(i===-2)return;if(i<0){i=this.size++;this.items[i]=pixel;this.positions[pixel]=i;}while(i>0){const parent=(i-1)>>1,other=this.items[parent];if(!this.less(pixel,other))break;this.items[i]=other;this.positions[other]=i;i=parent;}this.items[i]=pixel;this.positions[pixel]=i;}
 pop(){const pixel=this.items[0],last=this.items[--this.size];this.positions[pixel]=-2;if(this.size){let i=0;while(i*2+1<this.size){let child=i*2+1;if(child+1<this.size&&this.less(this.items[child+1],this.items[child]))child++;if(!this.less(this.items[child],last))break;const next=this.items[child];this.items[i]=next;this.positions[next]=i;i=child;}this.items[i]=last;this.positions[last]=i;}return pixel;}
}
async function lightingFor(image,options){
 if(options.lighting==='original')return{image,diagnostics:{method:'original',clippedPixels:0,requiresManual:false}};
 const prepared=options.preparedLighting;
 if(prepared?.image?.width===image.width&&prepared?.image?.height===image.height&&prepared.image.data?.length===image.data.length)return prepared;
 return prepareSelectionLighting(image,{signal:options.signal,onProgress:options.onProgress});
}
async function applySeeds(image,roi,seeds,label,hard,signal){
 let count=0,deadline=performance.now()+22;
 for(const seed of seeds){
  point(image,roi,seed);const radius=seed.r??0;if(!Number.isFinite(radius)||radius<0||radius>Math.max(image.width,image.height))throw new Error('Štětec nemá platný poloměr.');
  const cx=Math.floor(seed.x)-roi.x,cy=Math.floor(seed.y)-roi.y,r=Math.ceil(radius);
  for(let y=Math.max(0,cy-r);y<=Math.min(roi.height-1,cy+r);y++)for(let x=Math.max(0,cx-r);x<=Math.min(roi.width-1,cx+r);x++)if(!radius||Math.hypot(x-cx,y-cy)<=radius){const index=y*roi.width+x;if(hard[index]&&hard[index]!==label)throw new Error('Značky nástroje a pozadí se překrývají. Opravte jejich průnik.');if(!hard[index]){hard[index]=label;count++;}}
  if(performance.now()>deadline){await selectionYield(signal);deadline=performance.now()+22;}
 }
 return count;
}
async function features(image,analysis,roi,{signal,onProgress}){
 const n=roi.width*roi.height,original=new Uint8Array(n*3),corrected=analysis===image?original:new Uint8Array(n*3),chroma=new Uint8Array(n*3);let deadline=performance.now()+22;
 for(let y=0;y<roi.height;y++){
  for(let x=0;x<roi.width;x++){
   const index=y*roi.width+x,p=((y+roi.y)*image.width+x+roi.x)*4,q=index*3,a=image.data[p+3]/255;let maximum=0;
   for(let c=0;c<3;c++){original[q+c]=Math.round(image.data[p+c]*a+255*(1-a));if(corrected!==original)corrected[q+c]=analysis.data[p+c];maximum=Math.max(maximum,original[q+c]);}
   for(let c=0;c<3;c++)chroma[q+c]=Math.round(original[q+c]*255/Math.max(32,maximum));
  }
  if(performance.now()>deadline){progress(onProgress,signal,'selection',.05+y/roi.height*.15,'Připravuji barvy vybrané oblasti…');await selectionYield(signal);deadline=performance.now()+22;}
 }
 return{original,corrected,chroma};
}
function edgeCost(feature,a,b){let raw=0,corrected=0,chroma=0;for(let c=0;c<3;c++){raw=Math.max(raw,Math.abs(feature.original[a*3+c]-feature.original[b*3+c]));corrected=Math.max(corrected,Math.abs(feature.corrected[a*3+c]-feature.corrected[b*3+c]));chroma=Math.max(chroma,Math.abs(feature.chroma[a*3+c]-feature.chroma[b*3+c]));}return Math.round(Math.max(Math.min(raw,corrected),chroma*.6));}
async function watershed(roi,hard,feature,{signal,onProgress}){
 const n=hard.length,cost=new Uint16Array(n).fill(65535),distance=new Uint32Array(n).fill(0xffffffff),label=new Uint8Array(n),heap=new Heap(n,(a,b)=>cost[a]!==cost[b]?cost[a]<cost[b]:distance[a]!==distance[b]?distance[a]<distance[b]:label[a]!==label[b]?label[a]>label[b]:a<b);
 const seed=(index,value)=>{if(hard[index]&&hard[index]!==value)return;if(cost[index]===0&&label[index]===value)return;cost[index]=0;distance[index]=0;label[index]=value;heap.update(index);};
 for(let i=0;i<n;i++)if(hard[i])seed(i,hard[i]);
 for(let x=0;x<roi.width;x++){seed(x,2);seed((roi.height-1)*roi.width+x,2);}for(let y=1;y<roi.height-1;y++){seed(y*roi.width,2);seed(y*roi.width+roi.width-1,2);}
 let processed=0,deadline=performance.now()+22;
 while(heap.size){
  const p=heap.pop(),x=p%roi.width,y=Math.floor(p/roi.width),nextDistance=distance[p]+1;
  for(const q of[x?p-1:-1,x+1<roi.width?p+1:-1,y?p-roi.width:-1,y+1<roi.height?p+roi.width:-1]){
   if(q<0||heap.positions[q]===-2||hard[q]&&hard[q]!==label[p])continue;const nextCost=Math.max(cost[p],edgeCost(feature,p,q));
   if(nextCost<cost[q]||nextCost===cost[q]&&(nextDistance<distance[q]||nextDistance===distance[q]&&label[p]>label[q])){cost[q]=nextCost;distance[q]=nextDistance;label[q]=label[p];heap.update(q);}
  }
  processed++;
  if(!(processed&2047)&&performance.now()>deadline){progress(onProgress,signal,'selection',.2+processed/n*.6,'Odděluji označený nástroj od pozadí…');await selectionYield(signal);deadline=performance.now()+22;}
 }
 selectionAbort(signal);return Uint8Array.from(label,v=>+(v===1));
}
async function fillEnclosed(mask,roi,hard,{signal}){
 const n=mask.length,seen=new Uint8Array(n),queue=new Int32Array(n);let filled=0,protectedHoles=0,deadline=performance.now()+22;
 for(let start=0;start<n;start++){
  if(mask[start]||seen[start])continue;let head=0,tail=1,border=false,protectedSeed=false;queue[0]=start;seen[start]=1;
  while(head<tail){const p=queue[head++],x=p%roi.width,y=Math.floor(p/roi.width);border||=!x||!y||x===roi.width-1||y===roi.height-1;protectedSeed||=hard[p]===2;for(const q of[x?p-1:-1,x+1<roi.width?p+1:-1,y?p-roi.width:-1,y+1<roi.height?p+roi.width:-1])if(q>=0&&!mask[q]&&!seen[q]){seen[q]=1;queue[tail++]=q;}if(!(head&2047)&&performance.now()>deadline){await selectionYield(signal);deadline=performance.now()+22;}}
  if(!border&&!protectedSeed){for(let i=0;i<tail;i++)mask[queue[i]]=1;filled+=tail;}else if(!border&&protectedSeed)protectedHoles++;
  if(performance.now()>deadline){await selectionYield(signal);deadline=performance.now()+22;}
 }
 return{filled,protectedHoles};
}
function inside(x,y,points){let odd=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[j],b=points[i];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)odd=!odd;}return odd;}
async function externalBackground(mask,roi,signal){
 const seen=new Uint8Array(mask.length),queue=new Int32Array(mask.length);let head=0,tail=0,deadline=performance.now()+22;const add=p=>{if(!mask[p]&&!seen[p]){seen[p]=1;queue[tail++]=p;}};
 for(let x=0;x<roi.width;x++){add(x);add((roi.height-1)*roi.width+x);}for(let y=0;y<roi.height;y++){add(y*roi.width);add(y*roi.width+roi.width-1);}
 while(head<tail){const p=queue[head++],x=p%roi.width,y=Math.floor(p/roi.width);for(const q of[x?p-1:-1,x+1<roi.width?p+1:-1,y?p-roi.width:-1,y+1<roi.height?p+roi.width:-1])if(q>=0)add(q);if(!(head&2047)&&performance.now()>deadline){await selectionYield(signal);deadline=performance.now()+22;}}return seen;
}
async function traceSelection(mask,roi,hard,signal){
 const pad=3,w=roi.width+pad*2,h=roi.height+pad*2,padded=new Uint8Array(w*h);for(let y=0;y<roi.height;y++)padded.set(mask.subarray(y*roi.width,(y+1)*roi.width),(y+pad)*w+pad);
 const external=await externalBackground(mask,roi,signal),map=contours=>contours.map(c=>({...c,points:c.points.map(p=>({x:p.x-pad+roi.x,y:p.y-pad+roi.y}))}));
 const valid=contours=>{for(let p=0;p<hard.length;p++)if(hard[p]===1||hard[p]===2&&external[p]){const x=p%roi.width+roi.x+.5,y=Math.floor(p/roi.width)+roi.y+.5,covered=contours.some(c=>inside(x,y,c.points));if(hard[p]===1&&!covered||hard[p]===2&&covered)return false;}return contours.every(c=>simple(c.points));};
 let traced=traceMask(padded,w,h,{minArea:12,smoothing:.35,includeLabels:true}),contours=map(traced.contours);
 // A deliberately selected tiny part must not disappear into the legacy12px filter.
 const accepted=new Set(traced.contours.map(c=>c.componentId)),done=new Set();
 for(let p=0;p<hard.length;p++)if(hard[p]===1){const x=p%roi.width,y=Math.floor(p/roi.width),id=traced.labels[(y+pad)*w+x+pad];if(accepted.has(id)||done.has(id))continue;done.add(id);const pixels=[];let x0=roi.width,y0=roi.height,x1=0,y1=0;for(let q=0;q<mask.length;q++)if(traced.labels[(Math.floor(q/roi.width)+pad)*w+q%roi.width+pad]===id){pixels.push(q);x0=Math.min(x0,q%roi.width);x1=Math.max(x1,q%roi.width);y0=Math.min(y0,Math.floor(q/roi.width));y1=Math.max(y1,Math.floor(q/roi.width));}if(!pixels.length||pixels.length>=12)continue;const scale=4,tw=(x1-x0+1+6)*scale,th=(y1-y0+1+6)*scale,tiny=new Uint8Array(tw*th);for(const q of pixels){const xx=(q%roi.width-x0+3)*scale,yy=(Math.floor(q/roi.width)-y0+3)*scale;for(let dy=0;dy<scale;dy++)tiny.fill(1,(yy+dy)*tw+xx,(yy+dy)*tw+xx+scale);}for(const c of traceMask(tiny,tw,th,{minArea:12,smoothing:0}).contours)contours.push({...c,area:c.area/16,width:c.width/4,height:c.height/4,componentId:id,points:c.points.map(p=>({x:p.x/4-3+x0+roi.x,y:p.y/4-3+y0+roi.y}))});}
 if(!valid(contours)){contours=map(traceMask(padded,w,h,{minArea:12,smoothing:0}).contours);if(!valid(contours))return{contours:[],valid:false,reason:'hard-seed-vector-conflict'};}
 return{contours,valid:true};
}
function fullMask(local,image,roi){const result=new Uint8Array(image.width*image.height);for(let y=0;y<roi.height;y++)result.set(local.subarray(y*roi.width,(y+1)*roi.width),(y+roi.y)*image.width+roi.x);return result;}

export async function selectPhotoRegion(image,options={}){
 validateSelectionImage(image);selectionAbort(options.signal);const started=performance.now(),roi=region(image,options.roi),n=roi.width*roi.height;
 if(n>MAX_SELECTION_PIXELS)throw new Error('Výběr je příliš velký. Zmenšete rámeček nebo použijte ruční body obrysu.');
 const foreground=options.foreground??[],background=options.background??[];if(!Array.isArray(foreground)||!foreground.length||!Array.isArray(background))throw new Error('Označte alespoň jeden bod nástroje.');
 const hard=new Uint8Array(n),foregroundPixels=await applySeeds(image,roi,foreground,1,hard,options.signal),backgroundPixels=await applySeeds(image,roi,background,2,hard,options.signal),prepared=await lightingFor(image,options),feature=await features(image,prepared.image,roi,options),mask=await watershed(roi,hard,feature,options),holes=await fillEnclosed(mask,roi,hard,options);
 progress(options.onProgress,options.signal,'selection',.85,'Převádím výběr na kontrolovatelný obrys…');await selectionYield(options.signal);
 const traced=await traceSelection(mask,roi,hard,options.signal);if(holes.protectedHoles){traced.contours=[];traced.valid=false;traced.reason='protected-background-hole';}let touchesRoi=false,weak=0,edgeCount=0;
 for(let p=0;p<n;p++)if(mask[p]){const x=p%roi.width,y=Math.floor(p/roi.width);touchesRoi||=!x||!y||x===roi.width-1||y===roi.height-1;for(const q of[x?p-1:-1,x+1<roi.width?p+1:-1,y?p-roi.width:-1,y+1<roi.height?p+roi.width:-1])if(q>=0&&!mask[q]){edgeCount++;weak+=+(edgeCost(feature,p,q)<8);}}
 const needsManual=!traced.valid||touchesRoi||holes.protectedHoles>0||weak/Math.max(1,edgeCount)>.4,reasons=[];
 if(!traced.valid)reasons.push('Vnější obrys nedokáže zachovat označené body. Upravte značky nebo použijte body obrysu.');
 if(touchesRoi)reasons.push('Nástroj dosahuje k okraji výběru. Zkontrolujte, že není oříznutý.');
 if(holes.protectedHoles)reasons.push('Označený vnitřní otvor nelze zachovat jedním vnějším obrysem. Upravte výběr nebo použijte ruční body.');
 if(weak/Math.max(1,edgeCount)>.4)reasons.push('Část hrany je nečitelná. Zpřesněte ji dalšími značkami nebo ručními body.');
 if(!reasons.length)reasons.push('Zkontrolujte navržený obrys podle původní fotografie.');
 progress(options.onProgress,options.signal,'selection',1,'Výběr je připravený ke kontrole.');
 return{width:image.width,height:image.height,mask:fullMask(mask,image,roi),contours:traced.contours,method:'seeded-minimax-watershed',quality:{status:traced.contours.length?'review':'retake',needsManual,reasons},diagnostics:{roi,foregroundPixels,backgroundPixels,filledInteriorPixels:holes.filled,protectedInteriorHoles:holes.protectedHoles,weakBoundaryFraction:weak/Math.max(1,edgeCount),touchesRoi,hardSeedValidation:traced.valid,lighting:prepared.diagnostics,elapsedMs:performance.now()-started,sourceCoordinates:true}};
}

function straight(from,to,reason){return{points:[{x:from.x,y:from.y},{x:to.x,y:to.y}],quality:{status:'review',needsManual:true,reasons:['Hranu nelze spolehlivě sledovat. Úsek je přímý; upravte jej ručními body.']},diagnostics:{method:'manual-straight-fallback',fallback:true,reason}};}
function simplifyOpenPath(points,tolerance){
 if(points.length<3)return points;const keep=new Uint8Array(points.length),stack=[[0,points.length-1]];keep[0]=keep[points.length-1]=1;
 while(stack.length){const[from,to]=stack.pop(),a=points[from],b=points[to],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;let maximum=tolerance*tolerance,index=-1;for(let i=from+1;i<to;i++){const p=points[i],t=length?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/length,0,1):0,d=(p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2;if(d>maximum){maximum=d;index=i;}}if(index>=0){keep[index]=1;stack.push([from,index],[index,to]);}}
 return points.filter((_,index)=>keep[index]);
}
async function gradients(image,analysis,roi,options){
 const n=roi.width*roi.height,gx=new Int16Array(n),gy=new Int16Array(n),strength=new Uint8Array(n);let deadline=performance.now()+22;
 const color=(source,x,y,c)=>{const p=(clamp(y,0,image.height-1)*image.width+clamp(x,0,image.width-1))*4,a=source.data[p+3]/255;return source.data[p+c]*a+255*(1-a);};
 for(let y=0;y<roi.height;y++){
  for(let x=0;x<roi.width;x++){
   let best=0,dx=0,dy=0;for(const source of analysis===image?[image]:[image,analysis])for(let c=0;c<3;c++){const xx=x+roi.x,yy=y+roi.y,a=(color(source,xx+1,yy,c)-color(source,xx-1,yy,c))/2,b=(color(source,xx,yy+1,c)-color(source,xx,yy-1,c))/2,magnitude=Math.hypot(a,b);if(magnitude>best){best=magnitude;dx=a;dy=b;}}
   const p=y*roi.width+x;gx[p]=Math.round(dx);gy[p]=Math.round(dy);strength[p]=Math.round(Math.min(255,best));
  }
  if(performance.now()>deadline){progress(options.onProgress,options.signal,'boundary',y/roi.height*.3,'Zvýrazňuji obrazové hrany pro body obrysu…');await selectionYield(options.signal);deadline=performance.now()+22;}
 }
 return{gx,gy,strength};
}
export async function traceBoundarySegment(image,from,to,options={}){
 validateSelectionImage(image);selectionAbort(options.signal);const length=Math.hypot(to?.x-from?.x,to?.y-from?.y),padding=Math.max(12,Math.min(128,length*.6)),roi=region(image,options.roi??{x:Math.min(from?.x,to?.x)-padding,y:Math.min(from?.y,to?.y)-padding,width:Math.abs(to?.x-from?.x)+padding*2+1,height:Math.abs(to?.y-from?.y)+padding*2+1});point(image,roi,from);point(image,roi,to);
 if(length<.01)return straight(from,to,'identical-anchors');if(roi.width*roi.height>MAX_BOUNDARY_PIXELS)return straight(from,to,'memory-limit');
 const prepared=await lightingFor(image,options),gradient=await gradients(image,prepared.image,roi,options),n=roi.width*roi.height,start=(Math.floor(from.y)-roi.y)*roi.width+Math.floor(from.x)-roi.x,end=(Math.floor(to.y)-roi.y)*roi.width+Math.floor(to.x)-roi.x;
 if(start===end)return straight(from,to,'subpixel-anchors');
 let maximum=0;for(const value of gradient.strength)maximum=Math.max(maximum,value);if(maximum<5)return straight(from,to,'no-visible-edge');
 const distance=new Float64Array(n).fill(Infinity),previous=new Int32Array(n).fill(-1),heap=new Heap(n,(a,b)=>distance[a]===distance[b]?a<b:distance[a]<distance[b]);distance[start]=0;heap.update(start);let processed=0,deadline=performance.now()+22,reached=false;
 while(heap.size){
  const p=heap.pop();if(p===end){reached=true;break;}const x=p%roi.width,y=Math.floor(p/roi.width);
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   if(!dx&&!dy||x+dx<0||y+dy<0||x+dx>=roi.width||y+dy>=roi.height)continue;const q=(y+dy)*roi.width+x+dx;if(heap.positions[q]===-2)continue;const strength=(gradient.strength[p]+gradient.strength[q])/2,step=dx&&dy?14:10,magnitude=Math.hypot(gradient.gx[p],gradient.gy[p])||1,direction=Math.abs(gradient.gx[p]*dx+gradient.gy[p]*dy)/magnitude/(dx&&dy?Math.SQRT2:1),cost=step*(1+(255-strength)**2/256+direction*16),candidate=distance[p]+cost;
   if(candidate<distance[q]){distance[q]=candidate;previous[q]=p;heap.update(q);}
  }
  processed++;if(!(processed&2047)&&performance.now()>deadline){progress(options.onProgress,options.signal,'boundary',.3+processed/n*.65,'Přichytávám úsek k obrazové hraně…');await selectionYield(options.signal);deadline=performance.now()+22;}
 }
 selectionAbort(options.signal);if(!reached)return straight(from,to,'unreachable');const pixels=[];for(let p=end;p>=0;p=previous[p]){pixels.push(p);if(p===start)break;if(pixels.length>Math.min(n,Math.ceil(length*4+32)))return straight(from,to,'path-limit');}pixels.reverse();
 let support=0;for(const p of pixels)support+=+(gradient.strength[p]>=8);const path=pixels.map(p=>({x:p%roi.width+roi.x+.5,y:Math.floor(p/roi.width)+roi.y+.5}));path[0]={x:from.x,y:from.y};path[path.length-1]={x:to.x,y:to.y};let travelled=0;for(let i=1;i<path.length;i++)travelled+=Math.hypot(path[i].x-path[i-1].x,path[i].y-path[i-1].y);
 if(support/Math.max(1,pixels.length)<.15||travelled>length*4+16)return straight(from,to,'weak-or-detouring-edge');
 return{points:simplifyOpenPath(path,.3),quality:{status:'review',needsManual:support/pixels.length<.5,reasons:['Zkontrolujte přichycený úsek na původní fotografii.']},diagnostics:{method:'gradient-dijkstra',fallback:false,edgeSupport:support/pixels.length,visited:processed,roi,lighting:prepared.diagnostics}};
}
export async function tracePhotoBoundary(image,{points,closed=true,...options}={}){
 validateSelectionImage(image);selectionAbort(options.signal);if(!Array.isArray(points)||points.length<(closed?3:2))throw new Error('Obrys potřebuje alespoň tři body.');if(points.length>1000)throw new Error('Obrys obsahuje příliš mnoho bodů. Použijte méně opěrných bodů.');const roi=region(image,options.roi);for(const p of points)point(image,roi,p);
 const prepared=await lightingFor(image,options),segments=[],path=[];let pointLimit=false;for(let i=0;i<points.length-(closed?0:1);i++){selectionAbort(options.signal);const segment=await traceBoundarySegment(image,points[i],points[(i+1)%points.length],{...options,preparedLighting:prepared});segments.push(segment.diagnostics);if(path.length+segment.points.length>6000){path.splice(0,path.length,...points.map(p=>({...p})));segments.push({fallback:true,reason:'point-limit'});pointLimit=true;break;}path.push(...segment.points.slice(0,-1));}if(!closed&&!pointLimit)path.push({...points.at(-1)});
 const needsManual=segments.some(s=>s.fallback||s.edgeSupport<.5),valid=closed&&path.length>=3&&simple(path)&&Math.abs(polygonArea(path))>0;
 if(!valid)return{width:image.width,height:image.height,mask:new Uint8Array(image.width*image.height),contours:[],points:path,quality:{status:'review',needsManual:true,reasons:['Úseky netvoří platný uzavřený obrys. Upravte body nebo použijte přímý obrys.']},diagnostics:{method:'livewire-boundary',segments,valid:false,lighting:prepared.diagnostics}};
 const mask=new Uint8Array(image.width*image.height),minY=Math.max(0,Math.floor(Math.min(...path.map(p=>p.y)))),maxY=Math.min(image.height,Math.ceil(Math.max(...path.map(p=>p.y))));
 for(let y=minY;y<maxY;y++){const xs=[];for(let i=0,j=path.length-1;i<path.length;j=i++){const a=path[j],b=path[i];if((a.y>y+.5)!==(b.y>y+.5))xs.push(a.x+(y+.5-a.y)*(b.x-a.x)/(b.y-a.y));}xs.sort((a,b)=>a-b);for(let i=0;i+1<xs.length;i+=2)mask.fill(1,y*image.width+Math.max(roi.x,Math.ceil(xs[i]-.5)),y*image.width+Math.min(roi.x+roi.width,Math.ceil(xs[i+1]-.5)));}
 const contour={points:path,area:Math.abs(polygonArea(path)),width:Math.max(...path.map(p=>p.x))-Math.min(...path.map(p=>p.x)),height:Math.max(...path.map(p=>p.y))-Math.min(...path.map(p=>p.y))};
 return{width:image.width,height:image.height,mask,contours:[contour],points:path,method:'livewire-boundary',quality:{status:'review',needsManual,reasons:[needsManual?'Některé úseky nemají čitelnou hranu. Ověřte je nebo upravte ručně.':'Zkontrolujte navržený obrys podle původní fotografie.']},diagnostics:{method:'livewire-boundary',segments,valid:true,lighting:prepared.diagnostics}};
}
