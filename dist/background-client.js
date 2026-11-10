import {getLang,i18nError} from './i18n.js';

export const MAX_BACKGROUND_PIXELS=4000000;
const REMOVE_PATH='/api/background/remove',STATUS_PATH='/api/background/status';
const now=()=>globalThis.performance?.now?.()??Date.now();
const text=(cs,en)=>getLang()==='en'?en:cs;
const failure=(code,cs,en,status)=>{const error=i18nError(text(cs,en));error.code=code;if(status!==undefined)error.status=status;return error;};
const aborted=()=>new DOMException(text('Odstranění pozadí bylo zrušeno.','Background removal was cancelled.'),'AbortError');
const checkAbort=signal=>{if(signal?.aborted)throw aborted();};
const unavailable=status=>failure('background-unavailable','Lokální služba pro odstranění pozadí není dostupná. Spusťte lokální server s touto funkcí, nebo zvolte ruční výběr.','The local background removal service is unavailable. Start the local server with this feature, or choose manual selection.',status);
const invalidResponse=()=>failure('background-invalid-response','Lokální služba vrátila neplatnou masku. Zkuste výpočet znovu, nebo zvolte ruční výběr.','The local service returned an invalid mask. Try again, or choose manual selection.');

function validateImage(image){
  if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.width*image.height>MAX_BACKGROUND_PIXELS||!(image.data instanceof Uint8Array||image.data instanceof Uint8ClampedArray)||image.data.length!==image.width*image.height*4)throw failure('background-invalid-image','Fotografie musí obsahovat platné RGBA pixely a nejvýše 4 miliony pixelů.','The photo must contain valid RGBA pixels and at most 4 million pixels.');
}

function endpoint(path){
  // The caller cannot supply a host. Browser same-origin mode and redirect:error
  // also prevent an HTTP redirect from forwarding a photo to another service.
  const origin=globalThis.location?.origin||globalThis.window?.location?.origin;
  return origin&&/^https?:\/\//.test(origin)?new URL(path,origin).href:path;
}

function abortable(promise,signal){
  if(!signal)return Promise.resolve(promise);
  return new Promise((resolve,reject)=>{
    const cancel=()=>{signal.removeEventListener('abort',cancel);reject(aborted());};
    signal.addEventListener('abort',cancel,{once:true});
    Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',cancel);signal.aborted?reject(aborted()):resolve(value);},error=>{signal.removeEventListener('abort',cancel);reject(signal.aborted?aborted():error);});
    if(signal.aborted)cancel();
  });
}

function httpError(status){
  if(status===404||status===503)return unavailable(status);
  if(status===429)return failure('background-busy','Lokální odstranění pozadí právě zpracovává jinou fotografii. Počkejte a zkuste to znovu.','Local background removal is processing another photo. Wait and try again.',status);
  if(status===504)return failure('background-timeout','Lokální odstranění pozadí překročilo časový limit. Zkuste menší fotografii, nebo ruční výběr.','Local background removal timed out. Try a smaller photo, or manual selection.',status);
  if(status===400||status===413)return failure('background-invalid-image','Lokální služba nepřijala rozměry nebo pixely fotografie. Použijte fotografii do 4 milionů pixelů.','The local service rejected the photo dimensions or pixels. Use a photo of at most 4 million pixels.',status);
  if(status===403)return failure('background-origin','Odstranění pozadí otevřete ze stejného lokálního serveru jako aplikaci.','Open background removal from the same local server as the application.',status);
  return failure('background-failed','Lokální odstranění pozadí selhalo. Zkuste to znovu, nebo zvolte ruční výběr.','Local background removal failed. Try again, or choose manual selection.',status);
}

async function request(path,init,signal){
  checkAbort(signal);if(typeof globalThis.fetch!=='function')throw unavailable();
  let response;
  try{response=await abortable(globalThis.fetch(endpoint(path),{...init,signal,mode:'same-origin',credentials:'same-origin',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'}),signal);}
  catch(error){if(signal?.aborted||error?.name==='AbortError')throw aborted();throw unavailable();}
  checkAbort(signal);if(!response?.ok)throw httpError(response?.status);return response;
}

function mime(response){return(response.headers?.get('content-type')||'').split(';')[0].trim().toLowerCase();}
function validModel(model){return typeof model==='string'&&model.trim().length>0&&model.length<=200&&!/[\x00-\x1f\x7f]/.test(model);}

/** The local server returns source-sized alpha only. RGB and existing source
 * transparency are retained from a private snapshot, never from a remote image. */
export async function removePhotoBackground(image,{signal,onProgress}={}){
  validateImage(image);checkAbort(signal);
  const started=now(),{width,height}=image,original=new Uint8ClampedArray(image.data),body=new Uint8Array(original);
  const report=complete=>{try{onProgress?.({stage:'matting',indeterminate:!complete,elapsedMs:Math.max(0,Math.round(now()-started)),message:complete?text('Pozadí bylo odstraněno na serveru této aplikace.','Background was removed on this app’s server.'):text('Odstraňuji pozadí na serveru této aplikace…','Removing background on this app’s server…')});}catch{}};
  report(false);checkAbort(signal);const timer=setInterval(()=>{if(!signal?.aborted)report(false);},1000);
  try{
    const response=await request(REMOVE_PATH,{method:'POST',headers:{'Content-Type':'application/octet-stream','Accept':'application/octet-stream','X-Image-Width':String(width),'X-Image-Height':String(height)},body},signal);
    const model=response.headers?.get('x-background-model');if(mime(response)!=='application/octet-stream'||!validModel(model))throw invalidResponse();
    let buffer;try{buffer=await abortable(response.arrayBuffer(),signal);}catch(error){if(signal?.aborted||error?.name==='AbortError')throw aborted();throw invalidResponse();}
    checkAbort(signal);if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==width*height)throw invalidResponse();
    const alpha=new Uint8Array(buffer),data=new Uint8ClampedArray(original);
    for(let p=0;p<alpha.length;p++)data[p*4+3]=Math.round(original[p*4+3]*alpha[p]/255);
    checkAbort(signal);report(true);checkAbort(signal);
    return{image:{width,height,data},model:model.trim(),execution:'local-computer',elapsedMs:Math.max(0,Math.round(now()-started))};
  }finally{clearInterval(timer);}
}

/** Explicit capability query; importing this client never starts the service. */
export async function backgroundServiceStatus({signal}={}){
  const response=await request(STATUS_PATH,{method:'GET',headers:{'Accept':'application/json'}},signal);if(mime(response)!=='application/json')throw invalidResponse();
  let value;try{value=await abortable(response.json(),signal);}catch(error){if(signal?.aborted||error?.name==='AbortError')throw aborted();throw invalidResponse();}
  checkAbort(signal);
  if(!value||typeof value.available!=='boolean'||typeof value.busy!=='boolean'||value.execution!=='local-computer'||!validModel(value.model)||!Number.isSafeInteger(value.maxPixels)||value.maxPixels<1||value.reason!==undefined&&typeof value.reason!=='string')throw invalidResponse();
  return{available:value.available,execution:'local-computer',model:value.model.trim(),busy:value.busy,maxPixels:value.maxPixels,...(value.reason===undefined?{}:{reason:value.reason})};
}
