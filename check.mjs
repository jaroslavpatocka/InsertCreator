import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import vm from 'node:vm';

const fail=message=>{throw Error(message);};
const within=(root,file)=>{const relative=path.relative(root,file);return relative===''||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep));};
function walk(root){
  if(!fs.existsSync(root)||!fs.lstatSync(root).isDirectory()||fs.lstatSync(root).isSymbolicLink())fail('Chybí běžná složka '+root);
  const files=[];
  for(const entry of fs.readdirSync(root,{withFileTypes:true})){
    const file=path.join(root,entry.name),stat=fs.lstatSync(file);
    if(stat.isSymbolicLink())fail('Publikační soubor nesmí být symlink nebo junction: '+file);
    if(stat.isDirectory())files.push(...walk(file));else if(stat.isFile())files.push(file);else fail('Neplatný publikační soubor '+file);
  }
  return files;
}
function reference(scope,from,spec,label){
  if(!/^\.\.?\//.test(spec))fail(`${label} musí být lokální relativní cesta: ${spec}`);
  let file;try{file=fileURLToPath(new URL(spec,pathToFileURL(from)));}catch{fail(`Neplatná cesta ${label}: ${spec}`);}
  if(!within(scope,file))fail(`${label} uniká ze složky aplikace: ${spec}`);
  if(!fs.existsSync(file))fail(`Chybí ${label} ${spec} v ${from}`);
  return file;
}
function imports(scope,files){
  for(const file of files.filter(file=>/\.m?js$/.test(file))){
    const source=fs.readFileSync(file,'utf8');
    for(const match of source.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)(['"])(\.{1,2}\/[^'"]+)\1/g))reference(scope,file,match[2],'import');
    for(const match of source.matchAll(/new\s+URL\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*,\s*import\.meta\.url/g))reference(scope,file,match[2],'asset');
  }
}
function offline(scope){
  const filename=path.join(scope,'sw.js'),source=fs.readFileSync(filename,'utf8');
  const literal=source.match(/\bconst\s+ASSETS\s*=\s*(\[[\s\S]*?\])\s*;/)?.[1];
  let assets;try{assets=JSON.parse(literal?.replaceAll("'",'"'));}catch{fail('Chybí statický seznam offline souborů v '+filename);}
  if(!Array.isArray(assets)||!assets.length||assets.some(asset=>typeof asset!=='string'))fail('Neplatný seznam offline souborů v '+filename);
  for(const asset of assets)reference(scope,filename,asset,'offline soubor');
  return{source,assets};
}
function safeManifestPath(value){
  return typeof value==='string'&&value.length>0&&!/[\\\0:]/.test(value)&&!value.startsWith('/')&&value.split('/').every(part=>part!==''&&part!=='.'&&part!=='..')&&path.posix.normalize(value)===value;
}

async function workerIsolation(source,mobile){
  const origin='https://package-check.invalid',scope=origin+(mobile?'/mobil/':'/'),mobilePrefix='insertcreator-mobile:'+encodeURIComponent(origin+'/mobil/')+':';
  const handlers=new Map(),opened=[],deleted=[];let keys=[];
  const store={addAll:async()=>{},put:async()=>{},match:async()=>undefined};
  const sandbox={URL,Response,location:{origin},fetch:async()=>new Response('online'),caches:{open:async name=>{opened.push(name);return store;},keys:async()=>keys,delete:async name=>{deleted.push(name);return true;},match:()=>fail('Globální cache lookup porušuje izolaci.')},self:{registration:{scope},addEventListener:(type,handler)=>handlers.set(type,handler),skipWaiting:async()=>{},clients:{claim:async()=>{}}}};
  const context=vm.createContext(sandbox);
  new vm.Script(source,{filename:mobile?'mobil/sw.js':'sw.js'}).runInContext(context,{timeout:1000});
  async function lifecycle(type){
    const handler=handlers.get(type);if(!handler)fail('Worker nemá '+type);
    const waits=[];sandbox.event={waitUntil:promise=>waits.push(promise)};sandbox.handler=handler;
    new vm.Script('handler(event)').runInContext(context,{timeout:1000});await Promise.all(waits);
  }
  await lifecycle('install');const current=opened[0];
  if(typeof current!=='string'||(mobile?!current.startsWith(mobilePrefix):!/^insertcreator-v\d+(?:-|$)/.test(current)))fail('Worker používá nesprávný namespace cache.');
  const old=mobile?mobilePrefix+'old-check':'insertcreator-v0-check';
  keys=[current,old,mobile?'insertcreator-v999-desktop':mobilePrefix+'other', 'insertcreator-mobile:'+encodeURIComponent(origin+'/other/')+':old','unrelated-application'];
  await lifecycle('activate');
  if(deleted.length!==1||deleted[0]!==old)fail('Worker maže cizí cache nebo nečistí vlastní starou cache.');
  const fetchHandler=handlers.get('fetch');if(!fetchHandler)fail('Worker nemá fetch handler.');
  for(const [url,expected] of [[origin+(mobile?'/app.js':'/mobil/app.js'),false],[origin+(mobile?'/mobil/app.js':'/app.js'),true]]){
    let response;const waits=[];
    sandbox.handler=fetchHandler;sandbox.event={request:{url,method:'GET'},respondWith:promise=>{response=promise;},waitUntil:promise=>waits.push(promise)};
    new vm.Script('handler(event)').runInContext(context,{timeout:1000});
    if((response!==undefined)!==expected)fail('Worker přebírá požadavky druhé aplikace nebo ignoruje vlastní scope.');
    if(response!==undefined)await response;await Promise.all(waits);
  }
  if(opened.some(name=>name!==current))fail('Worker čte cache druhé aplikace.');
}

function storageIsolation(dist,mobile){
  const model=fs.readFileSync(path.join(mobile,'model.js'),'utf8'),desktop=fs.readFileSync(path.join(dist,'model.js'),'utf8');
  if(!model.includes("'insertcreator-mobile:'")||desktop.includes("'insertcreator-mobile:'"))fail('Mobilní model nemá samostatný namespace úložiště.');
  for(const [filename,key] of [['i18n.js','LANG_KEY'],['units.js','UNIT_KEY']]){
    const value=root=>fs.readFileSync(path.join(root,filename),'utf8').match(new RegExp('\\bconst\\s+'+key+'\\s*=\\s*([\"\'])'+'([^\"\']+)'+'\\1'))?.[2];
    const base=value(dist),scoped=value(mobile);
    if(!base||base.startsWith('insertcreator-mobile:')||scoped!=='insertcreator-mobile:'+base)fail('Jazyk nebo jednotky nemají oddělené mobilní úložiště.');
  }
}

/** Validate the committed, self-contained mobile runtime; no sibling checkout is read. */
export async function validateMobilePackage(projectRoot){
  const project=path.resolve(projectRoot),dist=path.join(project,'dist'),mobile=path.join(dist,'mobil'),files=walk(mobile);
  const manifestFile=path.join(project,'mobile-release.json');let manifest;
  try{manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8').replace(/^\uFEFF/,''));}catch{fail('Chybí platný mobile-release.json. Spusťte synchronizaci mobilního vydání.');}
  if(manifest.version!==1||!(manifest.sourceCommit===null||typeof manifest.sourceCommit==='string')||!Array.isArray(manifest.files)||!manifest.files.length)fail('Neplatný formát mobile-release.json.');
  const listed=new Map(),folded=new Set();
  for(const entry of manifest.files){
    if(!safeManifestPath(entry.path)||folded.has(entry.path.toLowerCase()))fail('Neplatná nebo duplicitní cesta v mobile-release.json: '+entry.path);
    if(!/^[0-9A-F]{64}$/.test(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0)fail('Neplatný hash nebo velikost mobilního souboru '+entry.path);
    folded.add(entry.path.toLowerCase());listed.set(entry.path,entry);
    const target=path.resolve(mobile,...entry.path.split('/'));if(!within(mobile,target))fail('Cesta manifestu uniká z mobilní aplikace.');
    if(!fs.existsSync(target)||!fs.lstatSync(target).isFile()||fs.lstatSync(target).isSymbolicLink())fail('Chybí mobilní soubor '+entry.path);
    const body=fs.readFileSync(target),hash=createHash('sha256').update(body).digest('hex').toUpperCase();
    if(body.length!==entry.bytes||hash!==entry.sha256)fail('Mobilní soubor neodpovídá vydání: '+entry.path);
  }
  for(const file of files){const relative=path.relative(mobile,file).split(path.sep).join('/');if(!listed.has(relative))fail('Mobilní soubor není v manifestu: '+relative);}
  for(const name of ['index.html','app.js','sw.js','manifest.webmanifest','model.js','i18n.js','units.js'])if(!listed.has(name))fail('V mobilním vydání chybí vstup '+name);
  const manifestURL=new URL('https://package-check.invalid/mobil/manifest.webmanifest'),pwa=JSON.parse(fs.readFileSync(path.join(mobile,'manifest.webmanifest'),'utf8'));
  for(const key of ['id','start_url','scope'])if(typeof pwa[key]!=='string'||new URL(pwa[key],manifestURL).href!=='https://package-check.invalid/mobil/')fail('Mobilní PWA má nesprávný '+key);
  imports(mobile,files);
  for(const file of files.filter(file=>/\.html$/.test(file)))for(const match of fs.readFileSync(file,'utf8').matchAll(/\b(?:src|href)\s*=\s*(['"])(\.{1,2}\/[^'"]+)\1/g))reference(mobile,file,match[2],'HTML asset');
  const mobileOffline=offline(mobile),desktopOffline=offline(dist);
  await workerIsolation(mobileOffline.source,true);await workerIsolation(desktopOffline.source,false);storageIsolation(dist,mobile);
  return{files:files.length,offlineAssets:mobileOffline.assets.length};
}

export async function runChecks(projectRoot=process.cwd()){
  const project=path.resolve(projectRoot),dist=path.join(project,'dist'),files=walk(dist),mobile=path.join(dist,'mobil');
  const snapshot=await validateMobilePackage(project);
  imports(dist,files.filter(file=>!within(mobile,file)));
  const scripts=[...files.filter(file=>/\.m?js$/.test(file)),path.join(project,'serve.mjs')];
  for(const file of scripts){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0)fail(result.stderr||'Chyba syntaxe '+file);}
  const assets=offline(dist).assets.length+snapshot.offlineAssets;
  return{scripts:scripts.length,offlineAssets:assets,mobileFiles:snapshot.files};
}
const entry=process.argv[1]?path.resolve(process.argv[1]):'',self=fileURLToPath(import.meta.url);
if((process.platform==='win32'?entry.toLowerCase()===self.toLowerCase():entry===self)){
  try{const result=await runChecks();console.log(`Ověřeno ${result.scripts} skriptů, lokální importy obou aplikací, ${result.offlineAssets} offline odkazů a ${result.mobileFiles} mobilních souborů podle SHA-256.`);}catch(error){console.error(error.message);process.exitCode=1;}
}
