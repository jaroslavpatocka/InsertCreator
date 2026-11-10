// Deterministic RGB/edge proposals. No model, inference or trained weights.
import {readableImage} from './photo-enhance.js';
import {recoverDarkTools} from './photo-recovery.js';
import {autoTraceImage} from './auto-trace.js';
const checkAbort=signal=>{if(signal?.aborted)throw new DOMException('Rozpoznávání bylo zrušeno.','AbortError');};
export function validatePhoto(image){
 if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<16||image.height<16||image.width*image.height>16000000||image.data?.length!==image.width*image.height*4)throw Error('Fotografie nemá platná obrazová data nebo je příliš velká.');
}
export async function recognizeClassical(image,{pxPerMm=1,kind='paper',signal,onProgress}={}){
 validatePhoto(image);checkAbort(signal);const started=performance.now();
  const readable=readableImage(image);checkAbort(signal);
  if(readable){
   const light=readable.name==='light-background'||readable.name==='plain-background',source=light?readable.image:recoverDarkTools(image,readable.image);
   // Existing adaptive RGB metrology remains the no-model fallback. There is no
   // binary neural prior and it cannot replace a set of learned identities.
   const result=await autoTraceImage(source,{pxPerMm,kind:light?'light':'tray',wideFragments:readable.wideFragments??readable.name==='plain-background',source:image,collectProposals:false,onProgress});checkAbort(signal);
   result.method='classical';result.enhanced=readable.name;
   result.diagnostics={...result.diagnostics,source:readable.name,engine:'classical',elapsedMs:performance.now()-started};
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
  const result=await autoTraceImage(image,{pxPerMm,kind,source:image,collectProposals:false,onProgress});checkAbort(signal);result.method='classical';result.diagnostics={...result.diagnostics,source:'rgb-fallback'};return result;
}
