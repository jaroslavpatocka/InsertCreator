import {getLang,i18nError} from './i18n.js';

export const MAX_BACKGROUND_PIXELS=64000000;
const REMOVE_PATH='/api/background/remove',STATUS_PATH='/api/background/status';
const NATIVE_METHOD='native-tiles',JOB_PATTERN=/^[A-Za-z0-9_-]{1,64}$/;
let nextJob=0;
const now=()=>globalThis.performance?.now?.()??Date.now();
const text=(cs,en)=>getLang()==='en'?en:cs;
const failure=(code,cs,en,status)=>{const error=i18nError(text(cs,en));error.code=code;if(status!==undefined)error.status=status;return error;};
const aborted=()=>new DOMException(text('Odstranění pozadí bylo zrušeno.','Background removal was cancelled.'),'AbortError');
const checkAbort=signal=>{if(signal?.aborted)throw aborted();};
const unavailable=status=>failure('background-unavailable','Lokální služba pro odstranění pozadí není dostupná. Spusťte lokální server s touto funkcí, nebo zvolte ruční výběr.','The local background removal service is unavailable. Start the local server with this feature, or choose manual selection.',status);
const invalidResponse=()=>failure('background-invalid-response','Lokální služba vrátila neplatnou masku. Zkuste výpočet znovu, nebo zvolte ruční výběr.','The local service returned an invalid mask. Try again, or choose manual selection.');

function validateImage(image){
  if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.width*image.height>MAX_BACKGROUND_PIXELS||!(image.data instanceof Uint8Array||image.data instanceof Uint8ClampedArray)||image.data.length!==image.width*image.height*4)throw failure('background-invalid-image','Fotografie musí obsahovat platné RGBA pixely a nejvýše 64 milionů pixelů. Rozlišení se automaticky nezmenšuje.','The photo must contain valid RGBA pixels and at most 64 million pixels. Resolution is never automatically reduced.');
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
  if(status===504)return failure('background-timeout','Odstranění pozadí v plném rozlišení překročilo časový limit. Výsledek nebyl zmenšen; zkuste výpočet znovu, nebo ruční výběr.','Full-resolution background removal timed out. The result was not reduced; try again, or choose manual selection.',status);
  if(status===400||status===413)return failure('background-invalid-image','Služba nepřijala původní rozměry nebo pixely fotografie. Limit je 64 milionů pixelů; rozlišení se automaticky nezmenšuje.','The service rejected the original photo dimensions or pixels. The limit is 64 million pixels; resolution is never automatically reduced.',status);
  if(status===403)return failure('background-origin','Odstranění pozadí otevřete ze stejného lokálního serveru jako aplikaci.','Open background removal from the same local server as the application.',status);
  return failure('background-failed','Lokální odstranění pozadí selhalo. Zkuste to znovu, nebo zvolte ruční výběr.','Local background removal failed. Try again, or choose manual selection.',status);
}

async function request(path,init,signal){
  checkAbort(signal);if(typeof globalThis.fetch!=='function')throw unavailable();
  let response;
  try{response=await abortable(globalThis.fetch(endpoint(path),{...init,signal,mode:'same-origin',credentials:'same-origin',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'}),signal);}
  catch(error){if(signal?.aborted||error?.name==='AbortError')throw aborted();throw unavailable();}
  checkAbort(signal);if(!response?.ok)throw httpError(response?.status);
  const target=endpoint(path);if(response.redirected||response.type==='opaqueredirect'||response.url&&/^https?:\/\//.test(target)&&new URL(response.url).origin!==new URL(target).origin)throw unavailable();
  return response;
}

function mime(response){return(response.headers?.get('content-type')||'').split(';')[0].trim().toLowerCase();}
function validModel(model){return typeof model==='string'&&model.trim().length>0&&model.length<=200&&!/[\x00-\x1f\x7f]/.test(model);}
function jobNonce(){if(typeof globalThis.crypto?.randomUUID==='function')return globalThis.crypto.randomUUID();return`background-${Date.now().toString(36)}-${++nextJob}-${Math.random().toString(36).slice(2)}`;}
function validProgress(value){return value&&Number.isSafeInteger(value.completed)&&Number.isSafeInteger(value.total)&&value.total>0&&value.completed>=0&&value.completed<=value.total&&Number.isSafeInteger(value.width)&&Number.isSafeInteger(value.height)&&value.width>0&&value.height>0&&value.width*value.height<=MAX_BACKGROUND_PIXELS;}

/** The local server returns source-sized alpha only. RGB and existing source
 * transparency are retained from a private snapshot, never from a remote image. */
export async function removePhotoBackground(image,{signal,onProgress}={}){
  validateImage(image);checkAbort(signal);
  const started=now(),{width,height}=image,jobId=jobNonce(),pollController=new AbortController();let original,body;
  // Two independent snapshots are necessary: the caller and a transport adapter
  // can both mutate their buffers. The private snapshot becomes the result, so
  // no third full-size RGBA copy is allocated after the response arrives.
  try{original=new Uint8ClampedArray(image.data);body=new Uint8Array(original);}catch{throw failure('background-memory','Pro plné rozlišení není v prohlížeči dostatek paměti. Fotografie nebyla zmenšena.','The browser has insufficient memory for full resolution. The photo was not reduced.');}
  let finished=false,timer=null,pollInFlight=false,nativeProgress=null,highestCompleted=-1,expectedTotal=null;
  const report=complete=>{
    if(!complete&&(finished||signal?.aborted))return;const progress=complete?null:nativeProgress;
    const message=complete?text('Pozadí bylo odstraněno v původním rozlišení na serveru této aplikace.','Background was removed at original resolution on this app’s server.'):progress?text(`Zpracováno ${progress.completed} z ${progress.total} částí snímku v plném rozlišení…`,`Processed ${progress.completed} of ${progress.total} image sections at full resolution…`):text('Odstraňuji pozadí v plném rozlišení na serveru této aplikace…','Removing background at full resolution on this app’s server…');
    try{onProgress?.({stage:'matting',indeterminate:!complete&&!progress,elapsedMs:Math.max(0,Math.round(now()-started)),...(progress?{...progress}:{}),message});}catch{}
  };
  const stopPolling=()=>{finished=true;clearInterval(timer);pollController.abort();signal?.removeEventListener('abort',stopPolling);nativeProgress=null;};
  const poll=()=>{
    if(finished||signal?.aborted)return;report(false);if(finished||signal?.aborted||pollInFlight)return;pollInFlight=true;
    backgroundServiceStatus({signal:pollController.signal}).then(status=>{
      if(finished||signal?.aborted)return;const next=status.progress;
      if(status.available&&status.busy&&status.jobId===jobId&&next&&next.width===width&&next.height===height&&(expectedTotal===null||next.total===expectedTotal)&&next.completed>=highestCompleted){nativeProgress=next;highestCompleted=next.completed;expectedTotal=next.total;}
      else nativeProgress=null;
      report(false);
    }).catch(()=>{if(!finished&&!signal?.aborted){nativeProgress=null;report(false);}}).finally(()=>{pollInFlight=false;});
  };
  signal?.addEventListener('abort',stopPolling,{once:true});
  try{
    report(false);checkAbort(signal);timer=setInterval(poll,1000);
    const pending=request(REMOVE_PATH,{method:'POST',headers:{'Content-Type':'application/octet-stream','Accept':'application/octet-stream','X-Image-Width':String(width),'X-Image-Height':String(height),'X-Background-Job':jobId},body},signal);body=null;
    const response=await pending;stopPolling();
    const model=response.headers?.get('x-background-model');if(mime(response)!=='application/octet-stream'||!validModel(model))throw invalidResponse();
    const method=response.headers.get('x-background-method');
    if(method!==NATIVE_METHOD)throw failure('background-native-required','Server nepodporuje zpracování v původním rozlišení. Aktualizujte server; fotografie se nebude automaticky zmenšovat.','The server does not support processing at original resolution. Update the server; the photo will not be automatically reduced.');
    if(response.headers.get('x-background-job')!==jobId||response.headers.get('x-image-width')!==String(width)||response.headers.get('x-image-height')!==String(height))throw invalidResponse();
    let buffer;try{buffer=await abortable(response.arrayBuffer(),signal);}catch(error){if(signal?.aborted||error?.name==='AbortError')throw aborted();throw invalidResponse();}
    checkAbort(signal);if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==width*height)throw invalidResponse();
    const alpha=new Uint8Array(buffer),data=original;let deadline=now()+22;
    for(let p=0;p<alpha.length;p++){data[p*4+3]=Math.round(data[p*4+3]*alpha[p]/255);if((p&262143)===0&&now()>deadline){await abortable(new Promise(resolve=>setTimeout(resolve,0)),signal);checkAbort(signal);deadline=now()+22;}}
    checkAbort(signal);report(true);checkAbort(signal);
    return{image:{width,height,data},model:model.trim(),method,jobId,execution:'local-computer',elapsedMs:Math.max(0,Math.round(now()-started))};
  }finally{stopPolling();}
}

/** Explicit capability query; importing this client never starts the service. */
export async function backgroundServiceStatus({signal}={}){
  const response=await request(STATUS_PATH,{method:'GET',headers:{'Accept':'application/json'}},signal);if(mime(response)!=='application/json')throw invalidResponse();
  let value;try{value=await abortable(response.json(),signal);}catch(error){if(signal?.aborted||error?.name==='AbortError')throw aborted();throw invalidResponse();}
  checkAbort(signal);
  if(!value||typeof value.available!=='boolean'||typeof value.busy!=='boolean'||value.execution!=='local-computer'||!validModel(value.model)||!Number.isSafeInteger(value.maxPixels)||value.maxPixels<1||value.reason!==undefined&&typeof value.reason!=='string')throw invalidResponse();
  if(value.progress!==undefined&&(!value.busy||!validProgress(value.progress))||value.jobId!==undefined&&(typeof value.jobId!=='string'||!JOB_PATTERN.test(value.jobId))||value.method!==undefined&&value.method!==NATIVE_METHOD)throw invalidResponse();
  return{available:value.available,execution:'local-computer',model:value.model.trim(),busy:value.busy,maxPixels:value.maxPixels,...(value.reason===undefined?{}:{reason:value.reason}),...(value.jobId===undefined?{}:{jobId:value.jobId}),...(value.method===undefined?{}:{method:value.method}),...(value.progress===undefined?{}:{progress:{completed:value.progress.completed,total:value.progress.total,width:value.progress.width,height:value.progress.height}})};
}
