import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateMobilePackage,runChecks} from '../check.mjs';

const temporary=[];
const rootWorker=fs.readFileSync(new URL('../dist/sw.js',import.meta.url),'utf8');
// The fixture is independent of the real mobile release and sibling checkout.
const mobileWorker=`const CACHE_PREFIX='insertcreator-mobile:'+encodeURIComponent(self.registration.scope)+':';
const CACHE=CACHE_PREFIX+'test';
const ASSETS=['./','./index.html','./app.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(CACHE_PREFIX)&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url),s=new URL(self.registration.scope);if(e.request.method==='GET'&&u.origin===s.origin&&u.pathname.startsWith(s.pathname))e.respondWith(fetch(e.request));});`;
function write(file,body){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);}
function snapshot(project){
  const base=path.join(project,'dist','mobil'),entries=[];
  const visit=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())visit(file);else{const body=fs.readFileSync(file);entries.push({path:path.relative(base,file).split(path.sep).join('/'),sha256:createHash('sha256').update(body).digest('hex').toUpperCase(),bytes:body.length});}}};
  visit(base);write(path.join(project,'mobile-release.json'),JSON.stringify({version:1,sourceCommit:null,files:entries}));
}
function fixture(){
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'insertcreator-mobile-package-'));temporary.push(project);
  const dist=path.join(project,'dist'),mobile=path.join(dist,'mobil');
  write(path.join(project,'serve.mjs'),'export {};');
  for(const [dir,prefix] of [[dist,''],[mobile,'insertcreator-mobile:']]){
    write(path.join(dir,'index.html'),'<script type="module" src="./app.js"></script>');
    write(path.join(dir,'app.js'),"import './nested/feature.js';");
    write(path.join(dir,'nested','feature.js'),'export const value=1;');
    write(path.join(dir,'model.js'),prefix?"export const mobileStorageKey=key=>'insertcreator-mobile:'+key;":"export const desktop=true;");
    write(path.join(dir,'i18n.js'),`const LANG_KEY='${prefix}suplik-studio-lang';`);
    write(path.join(dir,'units.js'),`const UNIT_KEY='${prefix}suplik-studio-unit';`);
  }
  write(path.join(dist,'sw.js'),rootWorker.replace(/const ASSETS=\[[^\n]+\];/,"const ASSETS=['./','./index.html','./app.js'];"));
  write(path.join(mobile,'sw.js'),mobileWorker);
  write(path.join(mobile,'manifest.webmanifest'),JSON.stringify({id:'./',start_url:'./',scope:'./'}));
  snapshot(project);return{project,dist,mobile};
}
after(()=>{for(const directory of temporary){assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(directory).startsWith('insertcreator-mobile-package-'));fs.rmSync(directory,{recursive:true,force:true});}});

test('a complete standalone mobile snapshot passes without a sibling source or nested dependencies',async()=>{
  const {project}=fixture();const result=await validateMobilePackage(project);assert.equal(result.files,8);assert.equal(result.offlineAssets,3);
  const checked=await runChecks(project);assert.equal(checked.scripts,13);assert.equal(checked.mobileFiles,8);assert.equal(checked.offlineAssets,6);
});

test('missing, changed and extra mobile runtime files all reject an otherwise valid release',async()=>{
  for(const action of ['missing','changed','extra']){
    const {project,mobile}=fixture();
    if(action==='missing')fs.unlinkSync(path.join(mobile,'app.js'));
    if(action==='changed')fs.appendFileSync(path.join(mobile,'app.js'),'\n// unpublished change');
    if(action==='extra')write(path.join(mobile,'unlisted.js'),'export {};');
    await assert.rejects(validateMobilePackage(project),/Chybí mobilní soubor|neodpovídá vydání|není v manifestu/);
  }
});

test('manifest paths cannot escape the mobile package or collide by case',async()=>{
  for(const bad of ['../app.js','/app.js','C:/app.js','nested\\feature.js','nested/../app.js']){
    const {project}=fixture(),file=path.join(project,'mobile-release.json'),manifest=JSON.parse(fs.readFileSync(file,'utf8'));manifest.files[0].path=bad;write(file,JSON.stringify(manifest));await assert.rejects(validateMobilePackage(project),/Neplatná nebo duplicitní cesta/);
  }
  const {project}=fixture(),file=path.join(project,'mobile-release.json'),manifest=JSON.parse(fs.readFileSync(file,'utf8'));manifest.files.push({...manifest.files[0],path:manifest.files[0].path.toUpperCase()});write(file,JSON.stringify(manifest));await assert.rejects(validateMobilePackage(project),/duplicitní cesta/);
});

test('a regenerated snapshot still rejects missing recursive imports and escaping mobile imports',async()=>{
  for(const spec of ['./missing.js','../../model.js']){
    const {project,mobile}=fixture();write(path.join(mobile,'nested','feature.js'),`import '${spec}';`);snapshot(project);await assert.rejects(validateMobilePackage(project),/Chybí import|uniká ze složky/);
  }
});

test('each application offline list must resolve to its own existing files',async()=>{
  for(const kind of ['root','mobile']){
    const {project,dist,mobile}=fixture(),file=path.join(kind==='root'?dist:mobile,'sw.js');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace("'./app.js'","'./not-cached.js'"));snapshot(project);await assert.rejects(validateMobilePackage(project),/Chybí offline soubor/);
  }
});

test('mobile worker cannot delete desktop caches or intercept the desktop application',async()=>{
  for(const alteration of [source=>source.replace('k.startsWith(CACHE_PREFIX)&&k!==CACHE','k!==CACHE'),source=>source.replace("u.pathname.startsWith(s.pathname)",'true')]){
    const {project,mobile}=fixture();write(path.join(mobile,'sw.js'),alteration(mobileWorker));snapshot(project);await assert.rejects(validateMobilePackage(project),/maže cizí cache|přebírá požadavky/);
  }
});

test('desktop worker must preserve mobile caches across activation',async()=>{
  const {project,dist}=fixture(),file=path.join(dist,'sw.js');write(file,rootWorker.replace(/const ASSETS=\[[^\n]+\];/,"const ASSETS=['./'];").replace("/^insertcreator-v\\d+(?:-|$)/.test(key)&&key!==CACHE",'key!==CACHE'));
  await assert.rejects(validateMobilePackage(project),/maže cizí cache/);
});

test('mobile storage and PWA scope remain independent after a new snapshot',async()=>{
  for(const file of ['model.js','i18n.js','units.js','manifest.webmanifest']){
    const {project,mobile}=fixture(),target=path.join(mobile,file);
    write(target,file==='manifest.webmanifest'?JSON.stringify({id:'./',start_url:'./',scope:'../'}):fs.readFileSync(target,'utf8').replaceAll('insertcreator-mobile:',''));
    snapshot(project);await assert.rejects(validateMobilePackage(project),/namespace|oddělené|nesprávný scope/);
  }
});

test('recursive mobile JavaScript syntax is checked before publication',async()=>{
  const {project,mobile}=fixture();write(path.join(mobile,'nested','feature.js'),'export const = ;');snapshot(project);await assert.rejects(runChecks(project),/SyntaxError|Unexpected token/);
});
