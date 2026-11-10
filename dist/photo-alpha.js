import {traceMask} from './trace.js';
import {analyzeAlphaComponents} from './alpha-contrast.js';

/** Consume real transparency from a cutout PNG. A checkerboard screenshot has
 * opaque pixels and is deliberately not interpreted as an alpha mask. */
export function traceAlphaPhoto(image,{force=false,source=image,signal}={}){
 const {width,height,data}=image;let transparent=0,visible=0,soft=0;
 for(let p=3;p<data.length;p+=4){transparent+=+(data[p]<250);visible+=+(data[p]>=128);soft+=+(data[p]>0&&data[p]<255);}
 if(!transparent&&!force)return null;
 const mask=new Uint8Array(width*height);for(let p=0;p<mask.length;p++)mask[p]=+(data[p*4+3]>=128);
 const traced=traceMask(mask,width,height,{minArea:1,minComponentPixels:1,keepBorder:true,smoothing:.25,includeLabels:true});
 const contrast=analyzeAlphaComponents(image,{source:source||image,labels:traced.labels,contours:traced.contours,signal}),decisions=new Map(contrast.components.map(row=>[row.id,row]));
 const contours=[],pendingContours=[],pendingIds=new Set();
 for(const {componentId,seed,...contour} of traced.contours){const evidence=decisions.get(componentId);if(evidence&&evidence.decision!=='keep'){pendingContours.push({...contour,contrastEvidence:evidence});pendingIds.add(componentId);}else contours.push(contour);}
 let clipped=0,discarded=0,pendingPixels=0;for(let p=0;p<mask.length;p++)if(mask[p]){if(pendingIds.has(traced.labels[p])){pendingPixels++;mask[p]=0;continue;}clipped+=+(p<width||p>=mask.length-width||p%width===0||p%width===width-1);discarded+=+!traced.mask[p];}
 const reasons=[contours.length?'Použita průhlednost obrázku bez nového rozpoznávání. Zkontrolujte malé díly, měřítko a celý obrys.':pendingContours.length?'Nalezené oblasti nemají dostatečnou oporu ve skutečných hranách. Nejsou automaticky považované za nástroje.':'Průhledný obrázek neobsahuje dostatečně viditelný obrys.'];
 if(contours.length&&pendingContours.length)reasons.push('Některé oblasti nemají dostatečnou oporu ve skutečných hranách. Zůstaly oddělené pro výslovnou kontrolu.');
 if(clipped)reasons.push('Materiál dosahuje k okraji obrázku. Zkontrolujte, že nástroj není oříznutý.');
 if(discarded)reasons.push('Některé pixely se nepodařilo převést na obrys. Zkontrolujte drobné části.');
 return{contours,pendingContours,mask,width,height,engine:'alpha',method:'alpha-mask',neuralModel:null,neuralUnavailable:false,neuralDisabled:true,requiresReview:true,
  quality:{status:contours.length||pendingContours.length?'review':'retake',score0to1:0,reasons},
  diagnostics:{source:'embedded-alpha',threshold:128,transparentPixels:transparent,visiblePixels:visible,softAlphaPixels:soft,clippedForegroundPixels:clipped,discardedForegroundPixels:discarded,pendingForegroundPixels:pendingPixels,sourceCoordinates:true,contrastValidation:contrast.components}};
}
