import { repairNativeProposalTopology, originalNativeWeakOwner } from './recognition-topology.js';
/** Physical tool instances assembled from image-only proposals and source RGB.
 * Coordinates remain in original image pixels; manufacturing clearance belongs
 * to the existing calibrated downstream path, never this detector. */
import { traceMask, polygonArea } from './trace.js';
import { simple } from './contour-smoothing.js';
import { decodeInstanceMask, validateInstanceImage } from './tool-neural-core.js';
import { readableImage } from './photo-enhance.js';
import { recoverDarkTools } from './photo-recovery.js';
import { autoTraceImage } from './auto-trace.js';
import {
 resolveInstanceHierarchy,geometry,intersection,throughBackground,dilateRLE,
 unionRLE,insideRLE,polygonRLE,roiRLE,traceRLE,uniformForeground,
 measureSourceContours,trimSourceBackground,checkAbort
} from './recognition-foreground.js';

const median=values=>{values.sort((a,b)=>a-b);return values[values.length>>1]||0;};
function background(image,node){
 const channels=[[],[],[]],{width,height,data}=image,b=node.bounds;
 for(let y=Math.max(0,b.y0-8);y<=Math.min(height-1,b.y1+8);y+=2)for(let x=Math.max(0,b.x0-8);x<=Math.min(width-1,b.x1+8);x+=2){if(x>=b.x0&&x<=b.x1&&y>=b.y0&&y<=b.y1)continue;for(let c=0;c<3;c++)channels[c].push(data[(y*width+x)*4+c]);}
 return channels.map(median);
}
function normalize(instance,index,width,height){
 const maskRLE=instance.maskRLE??roiRLE(instance.mask,width,height);
 return{...instance,id:instance.id??'instance-'+index,maskRLE};
}
function rasterize(contours,width,height){
 const mask=new Uint8Array(width*height);
 for(const c of contours){const rle=polygonRLE(c.points,width,height);for(let i=0;i<rle.length;i+=2)mask.fill(1,rle[i],rle[i]+rle[i+1]);}return mask;
}
function finish(contours,image,diagnostics,{trusted=false,mask=null,requiresReview=false}={}){
 const valid=contours.filter(c=>c.points.length>=3&&c.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))&&simple(c.points)).map(c=>{
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;for(const p of c.points){x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);y0=Math.min(y0,p.y);y1=Math.max(y1,p.y);}
  return{...c,area:Math.abs(polygonArea(c.points)),width:x1-x0,height:y1-y0};
 });
 const dropped=contours.length-valid.length,status=!valid.length?'retake':trusted&&!requiresReview&&!dropped?'ready':'review';
 const reasons=status==='retake'?['Není vidět dostatečně souvislý obrys nástroje. Vyfoťte jej na čistém světlém papíru v rozptýleném světle.']:status==='ready'?['Obrys má souvislou obrazovou hranu a automatické metody se na něm shodují.']:['Obrysy jsou předběžné. Zkontrolujte celistvost nástrojů, jejich oddělení a přesnost hran podle fotografie.'];
 return{contours:valid,mask:mask??rasterize(valid,image.width,image.height),width:image.width,height:image.height,method:'physical-instances',requiresReview:status==='review',quality:{status,score0to1:status==='ready'?.9:status==='review'?.65:0,reasons,methods:[diagnostics.source??'instance-hierarchy','source-rgb']},diagnostics:{...diagnostics,invalidContours:dropped}};
}

/** Source-sized complete-foreground controls are traced as physical components.
 * An incomplete semantic foreground is never inflated into production geometry. */
function measuredForeground(image,probability){
 if(!probability||probability.length!==image.width*image.height)throw new Error('Pravděpodobnostní maska má jiný rozměr než fotografie.');
 const mask=Uint8Array.from(probability,p=>+(p>=.5));
 return traceMask(mask,image.width,image.height,{minArea:12,smoothing:.5});
}

export async function recognizeToolRegions(image,{
 instances=[],weakProposals=[],prototypes=null,transform=null,probability=null,
 pxPerMm=1,kind='paper',signal,onProgress,_collectSource=false
}={}){
 validateInstanceImage(image);checkAbort(signal);const started=performance.now(),{width,height}=image;
 const progress=(value,message)=>{checkAbort(signal);try{onProgress?.({stage:'physical',progress:value,message});}catch(error){if(error?.name==='AbortError')throw error;}};
 progress(.1,'Ověřuji fyzické obrysy nástrojů…');
 if(probability){const traced=measuredForeground(image,probability);return finish(traced.contours,image,{source:'complete-foreground',elapsedMs:performance.now()-started},{trusted:true,mask:traced.mask});}
 const uniform=instances.length?uniformForeground(image,signal):null;
 let sourceCandidate=null;
 if(instances.length&&(uniform||readableImage(image))){
  // Source measurements are individual proposals, never a whole-image winner.
  // Learned identities still veto a merged region or complete fragmented RGB.
  sourceCandidate=await recognizeToolRegions(image,{pxPerMm,kind,signal,onProgress,_collectSource:true});
 }

 if(!instances.length){
  // Local RGB fallback keeps the established adaptive background preparation.
  // It traces all measured components rather than ranking global candidates.
  const readable=readableImage(image);checkAbort(signal);
  if(readable){
   const light=readable.name==='light-background'||readable.name==='plain-background',source=light?readable.image:recoverDarkTools(image,readable.image);
   // Existing adaptive RGB metrology remains the no-model fallback. There is no
   // binary neural prior and it cannot replace a set of learned identities.
   const result=await autoTraceImage(source,{pxPerMm,kind:light?'light':'tray',wideFragments:readable.wideFragments??readable.name==='plain-background',source:image,collectProposals:_collectSource,onProgress});checkAbort(signal);
   result.method='physical-instances';result.enhanced=readable.name;
   result.diagnostics={...result.diagnostics,source:readable.name,elapsedMs:performance.now()-started};
   for(const key of ['ambiguousBridge','ambiguousMaterial','ambiguousPrinting','recoveredBands','requiresReview'])if(readable[key]!==undefined)result[key]=readable[key];
   if(result.quality.status!=='retake'){
    if(readable.ambiguousBridge){
     const reason='Krátké přerušení obrysu bylo odhadnuto z okolních hran. Ověřte spojené části podle fotografie.';
     result.quality.reasons=result.quality.status==='ready'?[reason]:[reason,...result.quality.reasons];result.quality.status='review';
    }
    if(readable.ambiguousMaterial){
     result.quality.status='review';result.quality.reasons=['Část hrany je málo kontrastní nebo splývá se stínem. Přesnost této části nelze z fotografie spolehlivě ověřit.',...result.quality.reasons];
    }
    if(readable.ambiguousPrinting){
     const reason='Na podkladu jsou drobné značky, které mohou být potisk. Zkontrolujte výběr nástrojů.';
     result.quality.reasons=result.quality.status==='ready'?[reason]:[...result.quality.reasons,reason];result.quality.status='review';
    }
    if(readable.requiresReview&&result.quality.status==='ready'){
     result.quality.status='review';result.quality.reasons=['Na tmavém podkladu mohou sousední nebo málo kontrastní části splývat. Ověřte počet a oddělení nástrojů.'];
    }
   }
   return result;
  }
  const result=await autoTraceImage(image,{pxPerMm,kind,source:image,collectProposals:_collectSource,onProgress});checkAbort(signal);result.method='physical-instances';result.diagnostics={...result.diagnostics,source:'rgb-fallback'};return result;
 }

 let normalized=instances.map((instance,index)=>normalize(instance,index,width,height));
 let hierarchy=resolveInstanceHierarchy(image,normalized);
 const sourceEvidence={proposed:sourceCandidate?.contours.length||0,accepted:0,rejected:0};
 if(sourceCandidate){
  const reference=unionRLE(hierarchy.kept.map(n=>n.maskRLE));
  const pool=[...sourceCandidate.contours.map(contour=>({...contour,primary:true})),...(sourceCandidate.sourceProposals||[]).filter(p=>p.contours!==sourceCandidate.contours).flatMap(p=>p.contours.map(contour=>({...contour,sourceMethod:p.method,primary:false})))];
  sourceEvidence.proposed=pool.length;
  const accepted=[],sourceNodes=[];
  for(const [index,contour] of pool.entries()){
   checkAbort(signal);const maskRLE=polygonRLE(contour.points,width,height),node=geometry({id:'source-'+index,maskRLE},width,height),bg=background(image,node),colors=[[],[],[]];
   const stride=Math.max(1,Math.floor(node.area/1024));
   for(let i=0;i<maskRLE.length;i+=2)for(let p=maskRLE[i];p<maskRLE[i]+maskRLE[i+1];p+=stride)for(let c=0;c<3;c++)colors[c].push(image.data[p*4+c]);
   const contrast=Math.max(...colors.map((v,c)=>Math.abs(median(v)-bg[c]))),support=intersection(maskRLE,reference)/Math.max(1,node.area);
   let sourceContour=contour;
   if(!simple(contour.points)){
    for(const radius of [0,1,2]){
     const repaired=traceRLE(maskRLE,width,height,radius);
     if(repaired.length===1&&simple(repaired[0].points)&&Math.abs(repaired[0].area-node.area)<=node.area*.02+12){sourceContour={...contour,...repaired[0],repairedTopology:true};break;}
    }
   }
   const proposal={...node,score:1,maskRLE,sourceContour,sourceMeasured:true,primary:!!contour.primary,support,contrast};sourceNodes.push(proposal);
   if(support<.65){sourceEvidence.rejected++;continue;}
   accepted.push(proposal);sourceEvidence.accepted++;
  }
  for(const node of sourceNodes)if(node.primary&&!accepted.includes(node)&&node.support>.02&&sourceNodes.some(other=>!other.primary&&intersection(node.maskRLE,other.maskRLE)>=Math.max(node.area,other.area)*.9)){accepted.push(node);sourceEvidence.accepted++;sourceEvidence.rejected--;}
  const excess=(node,mask)=>{
   const bg=background(image,node);let same=0,total=0;const stride=Math.max(1,Math.floor(node.area/2048));
   for(let i=0;i<node.maskRLE.length;i+=2)for(let p=node.maskRLE[i];p<node.maskRLE[i]+node.maskRLE[i+1];p+=stride)if(!insideRLE(mask,p)){total++;same+=+([0,1,2].every(c=>Math.abs(image.data[p*4+c]-bg[c])<=24));}
   return same/Math.max(1,total);
  };
  // Source components are locked identities. Another RGB edge view may complete
  // several fragments only with independent learned support and without a
  // substantial source-background web. NN parent masks cannot erase these gaps.
  let locked=accepted.filter(n=>n.primary);sourceEvidence.completed=0;
  for(const node of accepted.filter(n=>!n.primary).sort((a,b)=>a.area-b.area)){
   const children=locked.filter(n=>intersection(n.maskRLE,node.maskRLE)>=n.area*.95);
   let separated=false;
   if(children.length>1)for(let i=0;i<children.length&&!separated;i++)for(let j=i+1;j<children.length&&!separated;j++){
    const a=children[i],b=children[j],dx=b.center.x-a.center.x,dy=b.center.y-a.center.y,length=Math.hypot(dx,dy);if(length>=1)separated=throughBackground(image,node,a,b,{x:-dy/length,y:dx/length});
   }
   if(children.length>1&&node.support>=.65&&!separated){
    locked=locked.filter(n=>!children.includes(n));locked.push(node);sourceEvidence.completed++;
   }else if(!locked.length&&node.support>=.8&&node.contrast>=40)locked.push(node);
  }
  // A precise source contour may describe a printed mark or one physical part.
  // Release its identity only when a retained learned root adds substantial
  // source-observed material beyond the union of its source children.
  const incompleteSource=new Set(),originalLocked=locked.slice(),sourceSnapshot=unionRLE(originalLocked.map(child=>child.maskRLE));let extentRoots=0,sparseRoots=0;
  const projection=(points,axis)=>{let lo=Infinity,hi=-Infinity;for(const p of points){const value=p.x*axis.x+p.y*axis.y;lo=Math.min(lo,value);hi=Math.max(hi,value);}return{lo,hi,length:hi-lo};};
  const colorDistance=(a,b)=>Math.max(...a.map((v,c)=>Math.abs(v-b[c])));
  const ringAppearance=node=>{
   const b=node.bounds,samples=[];
   for(let y=Math.max(0,b.y0-8);y<=Math.min(height-1,b.y1+8);y+=2)for(let x=Math.max(0,b.x0-8);x<=Math.min(width-1,b.x1+8);x+=2){if(x>=b.x0&&x<=b.x1&&y>=b.y0&&y<=b.y1)continue;const p=(y*width+x)*4;samples.push([image.data[p],image.data[p+1],image.data[p+2]]);}
   if(samples.length<8)return null;
   const color=[0,1,2].map(c=>median(samples.map(v=>v[c]))),noise=median(samples.map(v=>colorDistance(v,color)));return{color,noise};
  };
  for(const instance of hierarchy.kept.slice().sort((a,b)=>a.area-b.area)){
   checkAbort(signal);
   const parent=geometry(instance,width,height),children=originalLocked.filter(child=>intersection(child.maskRLE,parent.maskRLE)>=Math.min(child.area,parent.area)*.5);
   if(!children.length)continue;
   const allLocked=sourceSnapshot,childUnion=unionRLE(children.map(child=>child.maskRLE)),covered=intersection(parent.maskRLE,childUnion),extra=parent.area-intersection(parent.maskRLE,allLocked);
   if(extra<Math.max(12,parent.area*.08))continue;
   const parentExtent=projection(parent.points,parent.axis),sourceExtent=projection(children.flatMap(child=>child.points),parent.axis),requiredExtension=Math.max(hierarchy.cell*2,parentExtent.length*.25);
   // Rings from source children describe the photographed surface. A parent
   // ring can instead lie on a separate white border around a dark foam tray.
   const appearances=children.map(ringAppearance).filter(Boolean);if(!appearances.length)continue;
   const clusters=appearances.map(model=>appearances.filter(other=>colorDistance(other.color,model.color)<=24)).sort((a,b)=>b.length-a.length),dominant=clusters[0],bg={color:[0,1,2].map(c=>median(dominant.map(model=>model.color[c]))),noise:median(dominant.map(model=>model.noise))},threshold=Math.max(8,Math.min(32,bg.noise*3+4));
   let examined=0,observed=0,observedBeyond=0;const step=Math.max(1,Math.floor(extra/4096));
   for(let i=0;i<parent.maskRLE.length;i+=2){
    if(!(i&255))checkAbort(signal);
    for(let p=parent.maskRLE[i];p<parent.maskRLE[i]+parent.maskRLE[i+1];p+=step)if(!insideRLE(allLocked,p)){
     examined++;if(colorDistance([image.data[p*4],image.data[p*4+1],image.data[p*4+2]],bg.color)<=threshold)continue;
     observed++;const value=(p%width)*parent.axis.x+Math.floor(p/width)*parent.axis.y,extension=Math.max(sourceExtent.lo-value,value-sourceExtent.hi,0);if(extension>=requiredExtension)observedBeyond++;
    }
   }
   const observedFraction=observed/Math.max(1,examined),extentProof=observedFraction>=.15&&observedBeyond>=12&&observedBeyond/Math.max(1,examined)>=.03,sparseSourceProof=covered/Math.max(1,parent.area)<.25&&observedFraction>=.35&&observed>=32;
   if(extentProof||sparseSourceProof){for(const child of children)incompleteSource.add(child.id);extentRoots+=+extentProof;sparseRoots+=+sparseSourceProof;}
  }
  locked=locked.filter(child=>!incompleteSource.has(child.id));
  sourceEvidence.releasedPartial=incompleteSource.size;sourceEvidence.partialExtentRoots=extentRoots;sourceEvidence.partialSparseRoots=sparseRoots;
  const sourceUnion=unionRLE(locked.map(n=>n.maskRLE));
  const sourceViews=(sourceCandidate.sourceProposals||[]).map(p=>unionRLE(p.contours.map(c=>polygonRLE(c.points,width,height))));
  normalized=normalized.filter(instance=>{const node=geometry(instance,width,height);return !locked.some(n=>intersection(n.maskRLE,node.maskRLE)>=Math.min(n.area,node.area)*.5);});
  const materialReference=unionRLE([sourceUnion,...normalized.map(n=>n.maskRLE)]),referenceArea=materialReference.reduce((sum,n,i)=>i%2?sum+n:sum,0);
  sourceEvidence.materialAgreement=intersection(materialReference,sourceUnion)/Math.max(1,referenceArea);
  normalized=normalized.filter(instance=>{
   const node=geometry(instance,width,height),overlap=intersection(node.maskRLE,sourceUnion);
   if(sourceEvidence.materialAgreement>=.75&&sourceViews.filter(view=>intersection(node.maskRLE,view)>=node.area*.5).length<2)return false;
   return !(overlap<node.area*.15&&excess(node,sourceUnion)>=.95);
  });
  hierarchy=resolveInstanceHierarchy(image,normalized);
  hierarchy.kept.push(...locked);sourceEvidence.locked=locked.length;
 }
 const cell=hierarchy.cell;
 progress(.3,'Spojuji části jednotlivých nástrojů…');
 const seeds=[];
 for(const instance of hierarchy.kept){checkAbort(signal);for(const contour of instance.sourceContour?[instance.sourceContour]:traceRLE(instance.maskRLE,width,height,cell))seeds.push({...contour,sourceMeasured:!!instance.sourceMeasured,seedInstance:instance.id,score:instance.score});}
 const nodes=seeds.map((seed,i)=>({...geometry({id:'part-'+i,maskRLE:polygonRLE(seed.points,width,height)},width,height),seed}));
 const expanded=nodes.map(node=>dilateRLE(node,width,height,cell)),labels=nodes.map((_,i)=>i),joins=[];
 const find=i=>labels[i]===i?i:labels[i]=find(labels[i]);
 for(let i=0;i<nodes.length;i++){
  checkAbort(signal);
  for(let j=i+1;j<nodes.length;j++){
   const a=nodes[i],b=nodes[j];if(!intersection(expanded[i],expanded[j]))continue;
   if(a.seed.sourceMeasured||b.seed.sourceMeasured)continue;
   const dx=b.center.x-a.center.x,dy=b.center.y-a.center.y,length=Math.hypot(dx,dy);if(length<1)continue;
   const combined=geometry({id:'combined',maskRLE:unionRLE([a.maskRLE,b.maskRLE])},width,height),evidence={},separated=throughBackground(image,combined,a,b,{x:-dy/length,y:dx/length},evidence),overlap=intersection(a.maskRLE,b.maskRLE)/Math.max(1,Math.min(a.area,b.area));
   if(separated||evidence.reason==='uncertain-background'&&overlap<.3)continue;
   labels[find(j)]=find(i);joins.push({a:i,b:j,overlap});
  }
 }
 const groups=new Map();nodes.forEach((node,i)=>{const group=find(i);if(!groups.has(group))groups.set(group,[]);groups.get(group).push(node);});let assembled=[];
 for(const group of groups.values()){
  const measured=group.find(n=>n.seed.sourceMeasured&&group.every(other=>intersection(n.maskRLE,other.maskRLE)>=other.area*.98));
  if(measured){assembled.push({...measured.seed,seedParts:group.map(n=>n.seed.seedInstance)});continue;}
  for(const contour of traceRLE(unionRLE(group.map(n=>n.maskRLE)),width,height,cell))assembled.push({...contour,seedParts:group.map(n=>n.seed.seedInstance)});
 }

 const nativeRepair=repairNativeProposalTopology(image,assembled,{cell,signal});
 assembled=nativeRepair.assemblies;
 const nativeOriginalBackgrounds=nativeRepair.originalOwners.map(node=>background(image,node));

 // Freeze strong identities before hysteresis. Weak proposals cannot create an
 // independent object, merge two owners, or recursively recruit another weak part.
 const fixed=assembled.map((seed,i)=>({...geometry({id:'fixed-'+i,maskRLE:polygonRLE(seed.points,width,height)},width,height),seed})),grown=fixed.map(n=>dilateRLE(n,width,height,cell)),additions=fixed.map(()=>[]),backgrounds=fixed.map(node=>background(image,node)),existing=new Set(normalized.map(i=>i.id));
 const weakStats={proposals:weakProposals.length,decoded:0,components:0,attached:0,multipleOwners:0,unsupported:0};
 for(let index=0;index<weakProposals.length;index++){
  checkAbort(signal);const proposal=weakProposals[index];if(existing.has(proposal.id)||proposal.score>=.25)continue;
  const box=proposal.box;if(!box||!fixed.some(n=>box.x0<=n.bounds.x1+cell*2&&box.x1>=n.bounds.x0-cell*2&&box.y0<=n.bounds.y1+cell*2&&box.y1>=n.bounds.y0-cell*2))continue;
  let decoded=proposal;
  if(!proposal.mask&&!proposal.maskRLE){if(!prototypes||!transform)continue;decoded=decodeInstanceMask(proposal,prototypes,[1,32,256,256],transform,{includeProbability:false});}
  weakStats.decoded++;const rle=decoded.maskRLE??roiRLE(decoded.mask,width,height);
  for(const contour of traceRLE(rle,width,height,cell)){
   weakStats.components++;const node=geometry({id:proposal.id+'-part-'+weakStats.components,maskRLE:polygonRLE(contour.points,width,height)},width,height);if(node.bounds.border>=Math.max(3,Math.min(width,height)*.02))continue;
   const grownNode=dilateRLE(node,width,height,cell),owners=fixed.flatMap((other,i)=>intersection(grownNode,grown[i])?[i]:[]);
   if(owners.length!==1){if(owners.length>1)weakStats.multipleOwners++;continue;}
   const owner=owners[0],mergedOwner=fixed[owner],other=originalNativeWeakOwner(nativeRepair,grownNode,mergedOwner,{signal});
   if(!other)continue;
   const ownerBackground=other===mergedOwner?backgrounds[owner]:nativeOriginalBackgrounds[nativeRepair.originalOwners.indexOf(other)];
   if(other.seed.sourceMeasured||node.area>other.area)continue;
   const dx=other.center.x-node.center.x,dy=other.center.y-node.center.y,length=Math.hypot(dx,dy),parent=geometry({maskRLE:unionRLE([node.maskRLE,other.maskRLE])},width,height),evidence={};
   if(length>=1&&throughBackground(image,parent,node,other,{x:-dy/length,y:dx/length},evidence))continue;
   const overlap=intersection(node.maskRLE,other.maskRLE)/Math.max(1,Math.min(node.area,other.area));if(evidence.reason==='uncertain-background'&&overlap<.3)continue;
   let added=0,observed=0;for(let i=0;i<node.maskRLE.length;i+=2)for(let p=node.maskRLE[i];p<node.maskRLE[i]+node.maskRLE[i+1];p++)if(!insideRLE(other.maskRLE,p)){added++;observed+=+([0,1,2].some(c=>Math.abs(image.data[p*4+c]-ownerBackground[c])>=24));}
   if(added<12||observed/added<.6){weakStats.unsupported++;continue;}
   additions[owner].push(node.maskRLE);weakStats.attached++;
  }
 }
 assembled=[];fixed.forEach((node,i)=>{
  if(!additions[i].length){assembled.push(node.seed);return;}
  for(const contour of traceRLE(unionRLE([node.maskRLE,...additions[i]]),width,height,cell))assembled.push({...contour,seedParts:node.seed.seedParts});
 });
 progress(.85,'Měřím hrany na původní fotografii…');
 const toMeasure=assembled.filter(c=>!c.sourceMeasured),trimmed=trimSourceBackground(image,toMeasure,{cell,signal});
 const refined=measureSourceContours(image,trimmed,{reach:cell,signal});let cursor=0;
 const measured=assembled.map(c=>c.sourceMeasured?c:refined[cursor++]);
 progress(1,'Obrysy jsou připravené ke kontrole.');
 const result=finish(measured,image,{source:'instance-hierarchy',sourceEvidence,nativeTopologyRepair:nativeRepair.diagnostics,instances:instances.length,admissible:hierarchy.admissible.length,kept:hierarchy.kept.length,parents:hierarchy.parents,rejectedGroups:hierarchy.rejectedGroups,joins,weakStats,pxPerMm,kind,elapsedMs:performance.now()-started});
 if(sourceCandidate&&measured.length&&result.diagnostics.invalidContours===0&&measured.every(c=>c.sourceMeasured)){
  result.quality={...sourceCandidate.quality,reasons:[...sourceCandidate.quality.reasons]};
  result.requiresReview=sourceCandidate.quality.status==='review';
  for(const key of ['enhanced','ambiguousBridge','ambiguousMaterial','ambiguousPrinting','recoveredBands'])if(sourceCandidate[key]!==undefined)result[key]=sourceCandidate[key];
 }
 return result;
}
