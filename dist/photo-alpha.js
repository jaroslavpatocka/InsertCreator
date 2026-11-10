import {traceMask} from './trace.js';

/** Consume real transparency from a cutout PNG. A checkerboard screenshot has
 * opaque pixels and is deliberately not interpreted as an alpha mask. */
export function traceAlphaPhoto(image){
 const {width,height,data}=image;let transparent=0,visible=0,soft=0;
 for(let p=3;p<data.length;p+=4){transparent+=+(data[p]<250);visible+=+(data[p]>=128);soft+=+(data[p]>0&&data[p]<255);}
 if(!transparent)return null;
 const mask=new Uint8Array(width*height);for(let p=0;p<mask.length;p++)mask[p]=+(data[p*4+3]>=128);
 const traced=traceMask(mask,width,height,{minArea:1,minComponentPixels:1,keepBorder:true,smoothing:.25});
 let clipped=0,discarded=0;for(let p=0;p<mask.length;p++)if(mask[p]){clipped+=+(p<width||p>=mask.length-width||p%width===0||p%width===width-1);discarded+=+!traced.mask[p];}
 const reasons=[traced.contours.length?'Použita průhlednost obrázku bez nového rozpoznávání. Zkontrolujte malé díly, měřítko a celý obrys.':'Průhledný obrázek neobsahuje dostatečně viditelný obrys.'];
 if(clipped)reasons.push('Materiál dosahuje k okraji obrázku. Zkontrolujte, že nástroj není oříznutý.');
 if(discarded)reasons.push('Některé pixely se nepodařilo převést na obrys. Zkontrolujte drobné části.');
 return{...traced,mask,width,height,engine:'alpha',method:'alpha-mask',neuralModel:null,neuralUnavailable:false,neuralDisabled:true,requiresReview:true,
  quality:{status:traced.contours.length?'review':'retake',score0to1:0,reasons},
  diagnostics:{source:'embedded-alpha',threshold:128,transparentPixels:transparent,visiblePixels:visible,softAlphaPixels:soft,clippedForegroundPixels:clipped,discardedForegroundPixels:discarded,sourceCoordinates:true}};
}
