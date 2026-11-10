// Local foreground service. Models/dependencies stay outside dist and Git.
// Fresh checkout: provide Python CPU dependencies with ORT1.20.1 via a repo-local
// pip --target .background/native-deps install, and the verified model below.
// Overrides: INSERTCREATOR_BG_PYTHON, INSERTCREATOR_BG_MODEL,
// INSERTCREATOR_BG_DEPS, INSERTCREATOR_BG_THREADS (1..8). No cloud requests.
import http from 'node:http';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';

export const BACKGROUND_MODEL='birefnet-lite-1024';
export const MODEL_SHA256='5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333';
export const MODEL_BYTES=224005088;
export const MAX_PIXELS=64000000;
export const MAX_JOB_MS=30*60*1000;
export function nativeTileCount(width,height){const count=n=>n<=1024?1:Math.ceil((n-1024)/768)+1;return count(width)*count(height);}
export function nativeJobTimeout(width,height){return Math.min(MAX_JOB_MS,Math.max(180000,nativeTileCount(width,height)*180000));}
export const BACKGROUND_SERVICE_MARKER='<meta name="insertcreator-background-service" content="local-computer">';
const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const within=(root,file)=>file===root||file.startsWith(root+path.sep);
const exists=async file=>{try{return(await fs.stat(file)).isFile();}catch{return false;}};
async function firstFile(candidates){for(const file of candidates.filter(Boolean))if(await exists(file))return path.resolve(file);return null;}
async function hashFile(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}

export async function resolveBackgroundConfig({root=repoRoot,env=process.env}={}){
 const common=path.resolve(root,'..','artifacts/background-model-bench');
 const model=await firstFile(env.INSERTCREATOR_BG_MODEL?[env.INSERTCREATOR_BG_MODEL]:[path.join(root,'.background/model.onnx'),path.join(root,'.background/birefnet-lite-1024-f32.onnx'),path.join(common,'birefnet-lite-1024-f32.onnx')]);
 const base={available:false,model:BACKGROUND_MODEL,execution:'local-computer',threads:Math.max(1,Math.min(8,Math.floor(Number(env.INSERTCREATOR_BG_THREADS)||Math.min(4,os.availableParallelism()))))};
 if(!model)return{...base,reason:'Chybí lokální model BiRefNet. Nastavte INSERTCREATOR_BG_MODEL na ověřený model.'};
 if((await fs.stat(model)).size!==MODEL_BYTES||await hashFile(model)!==MODEL_SHA256)return{...base,reason:'Lokální model nemá požadovanou velikost nebo SHA256.'};
 let deps=null;for(const dir of (env.INSERTCREATOR_BG_DEPS?[env.INSERTCREATOR_BG_DEPS]:[path.join(root,'.background/native-deps'),path.join(common,'native-deps')]))if(await exists(path.join(dir,'onnxruntime/__init__.py'))&&await exists(path.join(dir,'numpy/__init__.py'))&&await exists(path.join(dir,'PIL/__init__.py'))){deps=path.resolve(dir);break;}
 if(!deps)return{...base,reason:'Chybí lokální Python závislosti. Připravte onnxruntime1.20.1, numpy1.26.4 a Pillow10.4.0 přes pip --target a nastavte INSERTCREATOR_BG_DEPS.'};
 const python=env.INSERTCREATOR_BG_PYTHON||(process.platform==='win32'?path.join(env.LOCALAPPDATA||path.join(os.homedir(),'AppData/Local'),'Programs/Python/Python312/python.exe'):'python3');
 const probe=spawnSync(python,['-c','import sys,json;sys.path.insert(0,sys.argv[1]);import onnxruntime,numpy,PIL;print(json.dumps([onnxruntime.__version__,numpy.__version__,PIL.__version__]))',deps],{encoding:'utf8',timeout:15000,windowsHide:true,env:{...process.env,ORT_DISABLE_TELEMETRY:'1'}});
 if(probe.error||probe.status!==0)return{...base,reason:'Lokální Python nebo jeho nativní závislosti nelze spustit. Zkontrolujte INSERTCREATOR_BG_PYTHON a INSERTCREATOR_BG_DEPS.'};
 let versions;try{versions=JSON.parse(probe.stdout.trim());}catch{}
 if(JSON.stringify(versions)!==JSON.stringify(['1.20.1','1.26.4','10.4.0']))return{...base,reason:'Lokální Python závislosti nemají ověřené verze1.20.1 /1.26.4 /10.4.0.'};
 return{...base,available:true,python,modelPath:model,deps,versions};
}

export function runBackgroundJob({width,height,rgba,config,signal,onProgress}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason||new Error('Aborted'));return;}
  const child=spawn(config.python,[path.join(repoRoot,'scripts/background-worker.py'),'--width',String(width),'--height',String(height),'--model',config.modelPath,'--deps',config.deps,'--threads',String(config.threads)],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,ORT_DISABLE_TELEMETRY:'1',PYTHONIOENCODING:'utf-8',OMP_NUM_THREADS:String(config.threads)}});
  const chunks=[];let length=0,stderr='',pendingLine='',statistics='',failure=null,settled=false;
  const stop=()=>{failure=signal.reason||new Error('Aborted');child.kill();};signal?.addEventListener('abort',stop,{once:true});
  const finish=(error,result)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',stop);if(error)reject(error);else resolve(result);};
  child.stdout.on('data',chunk=>{length+=chunk.length;if(length>width*height){failure=new Error('Lokální model vrátil příliš mnoho dat.');child.kill();}else chunks.push(chunk);});
  child.stderr.on('data',chunk=>{
   const text=chunk.toString('utf8');stderr=(stderr+text).slice(-65536);pendingLine+=text;
   let end;while((end=pendingLine.indexOf('\n'))!==-1){const line=pendingLine.slice(0,end);pendingLine=pendingLine.slice(end+1);try{const event=JSON.parse(line);if(event.event==='progress')onProgress?.(event);else if(event.event==='statistics')statistics=line;}catch{}}
   if(pendingLine.length>65536)pendingLine='';
  });
  child.on('error',error=>finish(new Error('Lokální Python nelze spustit: '+error.message)));
  child.stdin.on('error',()=>{});
  child.on('close',code=>{
   if(failure)return finish(failure);
   if(code!==0)return finish(new Error('Lokální model selhal. '+stderr.slice(-1500)));
   if(length!==width*height)return finish(new Error('Lokální model vrátil neúplnou alfu.'));
   // Stderr contains aggregate runtime statistics only, never source pixels.
   finish(null,{alpha:Buffer.concat(chunks,length),statistics});
  });
  child.stdin.end(rgba);
 });
}

function json(res,status,value){if(res.destroyed)return;const body=JSON.stringify(value);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);}
function sameOrigin(req){
 const host=req.headers.host;if(typeof host!=='string')return false;
 let url;try{url=new URL('http://'+host);}catch{return false;}if(url.pathname!=='/'||url.search||url.hash||url.username||url.password)return false;
 const name=url.hostname.replace(/^\[|\]$/g,'').toLowerCase(),local=req.socket.localAddress?.replace(/^::ffff:/,'').toLowerCase();
 if(!['localhost','127.0.0.1','::1',os.hostname().toLowerCase(),os.hostname().toLowerCase()+'.local',local].includes(name))return false;
 const origin=req.headers.origin;if(origin!==undefined&&origin!==url.origin)return false;
 if(req.headers['sec-fetch-site']==='cross-site')return false;
 return true;
}
async function readBody(req,expected,signal){
 return new Promise((resolve,reject)=>{
  const parts=[];let length=0,done=false;
  const finish=(error)=>{if(done)return;done=true;req.off('data',data);req.off('end',end);req.off('error',fail);req.off('aborted',aborted);signal.removeEventListener('abort',aborted);if(error){req.resume();reject(error);}else resolve(Buffer.concat(parts,length));};
  const data=part=>{length+=part.length;if(length>expected){const error=new Error('Příliš velké tělo požadavku.');error.status=413;finish(error);}else parts.push(part);};
  const end=()=>{if(length!==expected){const error=new Error('Rozměry a délka RGBA dat nesouhlasí.');error.status=400;finish(error);}else finish();};
  const fail=error=>finish(error),aborted=()=>finish(signal.reason||new Error('Přenos byl zrušen.'));
  req.on('data',data);req.on('end',end);req.on('error',fail);req.on('aborted',aborted);signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted();
 });
}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.onnx':'application/octet-stream','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.webmanifest':'application/manifest+json','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8'};

export function createBackgroundServer({distRoot=path.join(repoRoot,'dist'),config={available:false,reason:'Lokální služba není připravená.'},jobRunner=runBackgroundJob,timeoutMs=null,onStatistics}={}){
 const root=path.resolve(distRoot),controllers=new Set();let busy=false,activeJob=null;
 const server=http.createServer(async(req,res)=>{
  if(!sameOrigin(req)){req.resume();return json(res,403,{error:'Požadavek musí pocházet ze stejné lokální stránky.'});}
  let url;try{url=new URL(req.url,'http://'+req.headers.host);}catch{return json(res,400,{error:'Neplatná adresa.'});}
  if(url.pathname==='/api/background/status'){
   if(req.method!=='GET'){req.resume();return json(res,405,{error:'Použijte GET.'});}
   return json(res,200,{available:config.available===true,execution:'local-computer',model:BACKGROUND_MODEL,busy,maxPixels:MAX_PIXELS,...(activeJob?{jobId:activeJob.id,progress:activeJob.progress}:{}),...(!config.available?{reason:config.reason||'Lokální služba není připravená.'}:{})});
  }
  if(url.pathname==='/api/background/remove'){
   if(req.method!=='POST'){req.resume();return json(res,405,{error:'Použijte POST s RGBA daty.'});}
   if(!config.available){req.resume();return json(res,503,{error:config.reason||'Lokální služba není připravená.'});}
   if(busy){req.resume();return json(res,429,{error:'Lokální počítač už zpracovává jiný obrázek.'});}
   const widthText=req.headers['x-image-width'],heightText=req.headers['x-image-height'];
   if(typeof widthText!=='string'||typeof heightText!=='string'||!/^\d+$/.test(widthText)||!/^\d+$/.test(heightText))return req.resume(),json(res,400,{error:'Chybí celočíselné rozměry obrázku.'});
   const width=Number(widthText),height=Number(heightText);
   if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)return req.resume(),json(res,400,{error:'Rozměry musí být kladná celá čísla.'});
   if(width*height>MAX_PIXELS)return req.resume(),json(res,413,{error:'Obrázek smí mít nejvýše64milionů pixelů. Rozlišení automaticky nesnižujeme.'});
   if((req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/octet-stream')return req.resume(),json(res,415,{error:'Použijte application/octet-stream.'});
   const expected=width*height*4;
   if(req.headers['content-length']!==undefined&&Number(req.headers['content-length'])!==expected)return req.resume(),json(res,400,{error:'Rozměry a délka RGBA dat nesouhlasí.'});
   const requestedId=req.headers['x-background-job'];if(requestedId!==undefined&&(typeof requestedId!=='string'||!/^[-A-Za-z0-9_]{1,64}$/.test(requestedId)))return req.resume(),json(res,400,{error:'Neplatný identifikátor lokální úlohy.'});
   busy=true;const total=nativeTileCount(width,height),id=requestedId||randomUUID();activeJob={id,progress:{completed:0,total,width,height}};
   const controller=new AbortController();controllers.add(controller);let timedOut=false;
   const timer=setTimeout(()=>{timedOut=true;controller.abort(new Error('Časový limit lokálního zpracování vypršel.'));},timeoutMs??nativeJobTimeout(width,height));
   const disconnect=()=>{if(!res.writableEnded)controller.abort(new Error('Klient zrušil zpracování.'));};res.on('close',disconnect);req.on('aborted',disconnect);
   try{
    const rgba=await readBody(req,expected,controller.signal);if(controller.signal.aborted)throw controller.signal.reason;
    const result=await jobRunner({width,height,rgba,config,signal:controller.signal,onProgress:event=>{
     if(!activeJob||activeJob.id!==id||controller.signal.aborted)return;
     if(event.width!==width||event.height!==height||event.total!==total||!Number.isInteger(event.completed)||event.completed<activeJob.progress.completed||event.completed>total)return;
     activeJob.progress={completed:event.completed,total,width,height};
    }});if(controller.signal.aborted)throw controller.signal.reason;
    const alpha=result?.alpha;if(!(alpha instanceof Uint8Array)||alpha.byteLength!==width*height)throw new Error('Lokální model vrátil neplatnou alfu.');
    if(onStatistics&&result.statistics)onStatistics(result.statistics);
    res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':alpha.byteLength,'X-Background-Model':BACKGROUND_MODEL,'X-Background-Execution':'local-computer','X-Background-Method':'native-tiles','X-Background-Job':id,'X-Image-Width':width,'X-Image-Height':height,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(alpha);
   }catch(error){if(!res.destroyed)json(res,timedOut?504:error.status||500,{error:timedOut?'Časový limit lokálního zpracování vypršel.':String(error.message||error).slice(0,1800)});}
   finally{clearTimeout(timer);controllers.delete(controller);res.off('close',disconnect);req.off('aborted',disconnect);busy=false;activeJob=null;}
   return;
  }
  if(url.pathname.startsWith('/api/'))return json(res,404,{error:'Neznámé lokální API.'});
  if(req.method!=='GET'&&req.method!=='HEAD'){req.resume();return json(res,405,{error:'Použijte GET nebo HEAD.'});}
  try{
   const decoded=decodeURIComponent(url.pathname);if(decoded.includes('\0')||decoded.includes('\\')||decoded.split('/').some(s=>s==='..'||s.startsWith('.')))return json(res,403,{error:'Nepovolená cesta.'});
   let file=path.resolve(root,'.'+decoded);if(!within(root,file))return json(res,403,{error:'Nepovolená cesta.'});
   let stat=await fs.stat(file);if(stat.isDirectory()){if(!url.pathname.endsWith('/')){res.writeHead(302,{Location:url.pathname+'/'+url.search});res.end();return;}file=path.join(file,'index.html');stat=await fs.stat(file);}
   const realRoot=await fs.realpath(root),realFile=await fs.realpath(file);if(!within(realRoot,realFile)||!stat.isFile())return json(res,403,{error:'Nepovolená cesta.'});
   // The local service declares its capability before the first app render.
   // This fixed marker never comes from a request and never mutates dist files.
   let appHtml=null;
   if(config.available&&path.basename(file).toLowerCase()==='index.html'){
    const original=await fs.readFile(file,'utf8');
    const html=original.includes(BACKGROUND_SERVICE_MARKER)?original:original.replace(/<head\b[^>]*>/i,head=>head+'\n'+BACKGROUND_SERVICE_MARKER);
    appHtml=Buffer.from(html,'utf8');
   }
   res.writeHead(200,{'Content-Type':types[path.extname(file).toLowerCase()]||'application/octet-stream','Content-Length':appHtml?.length??stat.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   if(appHtml){res.end(req.method==='HEAD'?undefined:appHtml);return;}
   if(req.method==='HEAD')res.end();else{const stream=createReadStream(file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);}
  }catch(error){json(res,error instanceof URIError?400:404,{error:'Soubor nenalezen.'});}
 });
 server.requestTimeout=180000;server.headersTimeout=10000;
 const close=server.close.bind(server);server.close=(...args)=>{for(const controller of controllers)controller.abort(new Error('Lokální služba byla ukončena.'));return close(...args);};
 return server;
}

async function main(){
 const args=process.argv.slice(2);let host='127.0.0.1',port=path.basename(repoRoot)==='mobil'?5181:5180;
 for(let i=0;i<args.length;i++){if(args[i]==='--host')host=args[++i];else if(args[i]==='--port')port=Number(args[++i]);else throw new Error('Neznámý argument '+args[i]);}
 if(!['127.0.0.1','0.0.0.0','::1'].includes(host)||!Number.isInteger(port)||port<1||port>65535)throw new Error('Použijte platný port a --host127.0.0.1 nebo0.0.0.0 pro důvěryhodnou LAN.');
 const config=await resolveBackgroundConfig(),server=createBackgroundServer({config,onStatistics:stats=>process.stderr.write(stats.endsWith('\n')?stats:stats+'\n')});
 server.listen(port,host,()=>console.log(JSON.stringify({url:`http://${host==='0.0.0.0'?'localhost':host}:${port}`,available:config.available,execution:'local-computer',model:BACKGROUND_MODEL,reason:config.reason,threads:config.threads,scope:'Images stay on this computer; mobile uses this computer over trusted LAN. Native model needs approximately5.34GiB peak RAM on measured original.'})));
 for(const name of ['SIGINT','SIGTERM'])process.on(name,()=>{server.close();server.closeAllConnections();});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
