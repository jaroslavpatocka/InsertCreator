// LIC-02: third-party outline provenance survives catalogue → project → validation → save/restore →
// duplication → manufacturing export. CC0 items stay distinguished; tools without provenance add nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogItems} from '../dist/catalog/index.js';
import {catalogTool} from '../dist/catalog-ui.js';
import {validateProject,blankProject} from '../dist/model.js';
import {duplicateModule} from '../dist/module-edit.js';
import {scaleTool} from '../dist/set-module.js';
import {preparePrintBatch} from '../dist/print-batch.js';
import {encodeColor3MF} from '../dist/three-mf.js';
import {executeManufacturingTask} from '../dist/manufacturing-worker.js';
import {normalizeAttribution,attributionText,attributionNotice,exportAttributionNotice,collectAttributions,standaloneAttributionPackage} from '../dist/asset-attribution.js';

const items=catalogItems(),byId=id=>items.find(item=>item.id===id);
const caliperItem=items.find(item=>item.source?.license==='CC-BY-3.0'&&/FreeCAD-library/.test(item.source.url));
const cc0Item=items.find(item=>item.source?.license==='CC0-1.0'&&/polyhaven\.com/.test(item.source.url||''));
const ownItem=byId('digital-caliper-150mm');
const text=bytes=>new TextDecoder().decode(bytes);
function unzip(bytes){const data=new Uint8Array(bytes),view=new DataView(data.buffer,data.byteOffset,data.byteLength),out={};let p=0;while(view.getUint32(p,true)===0x04034b50){const size=view.getUint32(p+18,true),name=view.getUint16(p+26,true),extra=view.getUint16(p+28,true);out[text(data.subarray(p+30,p+30+name))]=data.subarray(p+30+name+extra,p+30+name+extra+size);p+=30+name+extra+size;}return out;}
function box(points){const xs=points.map(p=>p.x),ys=points.map(p=>p.y);return{x0:Math.min(...xs),y0:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};}
// One module per tool, the tool centred inside it.
function projectWith(tools){
  const modules=[],placed=[];let y=0;
  tools.forEach((tool,index)=>{
    const b=box(tool.points),width=Math.ceil((b.w+40)/42)*42,height=Math.ceil((b.h+40)/42)*42,id='m'+index;
    modules.push({id,name:'Modul '+index,x:0,y,width,height,locked:true,sizeMode:'manual'});
    placed.push({...tool,depth:10,id:'t'+index,moduleId:id,x:(width-b.w)/2-b.x0,y:y+(height-b.h)/2-b.y0,rotation:0});
    y+=height;
  });
  return validateProject({...blankProject(),id:'lic02',name:'LIC-02',width:420,height:Math.max(42,y)*2,printMode:'solid',bottomMode:'plain',bedWidth:400,bedHeight:400,modules,tools:placed});
}

test('catalogue data carries structured provenance for the FreeCAD caliper and Poly Haven CC0 items',()=>{
  assert.ok(caliperItem,'FreeCAD caliper item exists');
  assert.equal(caliperItem.source.author,'hasecilu');
  assert.equal(caliperItem.source.revision,'f5ca01cdcaa2f69b9295a6382719c2d90628780c');
  assert.match(caliperItem.source.changes,/69\.0 mm/);
  assert.ok(cc0Item&&cc0Item.source.author&&cc0Item.source.title);
  for(const item of items.filter(item=>/polyhaven\.com/.test(item.source?.url||'')))assert.equal(item.source.license,'CC0-1.0');
});

test('catalogTool keeps author, source, licence and changes; own parametric items carry none',()=>{
  const caliper=catalogTool(caliperItem),a=caliper.attribution;
  assert.equal(a.author,'hasecilu');assert.equal(a.license,'CC-BY-3.0');
  assert.equal(a.source,caliperItem.source.url);assert.equal(a.licenseUrl,'https://creativecommons.org/licenses/by/3.0/');
  assert.equal(a.revision,'f5ca01cdcaa2f69b9295a6382719c2d90628780c');assert.match(a.changes,/closed position/);
  assert.equal(catalogTool(cc0Item).attribution.license,'CC0-1.0');
  assert.ok(ownItem);assert.equal(Object.hasOwn(catalogTool(ownItem),'attribution'),false);
});

test('validateProject, save/restore, duplication and scaling preserve the attribution',()=>{
  const project=projectWith([catalogTool(caliperItem)]),expected=catalogTool(caliperItem).attribution;
  assert.deepEqual(project.tools[0].attribution,expected);
  const restored=validateProject(JSON.parse(JSON.stringify({schemaVersion:1,app:'InsertCreator',project})).project);
  assert.deepEqual(restored.tools[0].attribution,expected);
  const copy=validateProject(duplicateModule(restored,'m0'));
  assert.equal(copy.tools.length,2);
  for(const tool of copy.tools)assert.deepEqual(tool.attribution,expected);
  assert.deepEqual(scaleTool(restored.tools[0],1.1).attribution,expected);
  // The context-menu duplicate path is a plain clone of the tool.
  assert.deepEqual(validateProject({...restored,tools:[...restored.tools,{...structuredClone(restored.tools[0]),id:'dup'}]}).tools[1].attribution,expected);
});

test('hostile or unknown attribution is normalised, never invented',()=>{
  const a=normalizeAttribution({title:'A\u0000b\u0007\nc'+'x'.repeat(500),author:'Eve ',source:'javascript:alert(1)',license:'<script>',licenseUrl:'data:text/html,x',changes:5});
  assert.equal(a.title.length,160);assert.ok(!/[\u0000-\u001f]/.test(a.title));
  assert.equal(a.author,'Eve');assert.equal(a.license,'unknown');
  assert.equal(Object.hasOwn(a,'source'),false);assert.equal(Object.hasOwn(a,'licenseUrl'),false);assert.equal(Object.hasOwn(a,'changes'),false);
  for(const bad of [null,'CC-BY',[],{license:'CC0-1.0'},{source:'ftp://x'}])assert.equal(normalizeAttribution(bad),undefined);
  const project=validateProject({...blankProject(),tools:[{id:'x',name:'X',points:[{x:0,y:0},{x:10,y:0},{x:10,y:10}],attribution:{title:'T',license:'weird licence'}}]});
  assert.deepEqual(project.tools[0].attribution,{title:'T',license:'unknown'});
  assert.match(attributionText(project.tools),/neznámý autor/);
});

test('print batch ZIP contents carry ATTRIBUTION.txt and assembly metadata; tools without provenance add nothing',async()=>{
  const project=projectWith([catalogTool(caliperItem),catalogTool(cc0Item)]);
  const result=await preparePrintBatch(project);
  const file=result.files.find(file=>file.name==='ATTRIBUTION.txt');
  assert.ok(file,'ATTRIBUTION.txt is part of the export');
  assert.match(file.data,/hasecilu/);assert.match(file.data,/CC BY 3\.0/);assert.ok(file.data.includes(caliperItem.source.url));
  assert.match(file.data,/69\.0 mm/);assert.match(file.data,/CC0 1\.0/);assert.match(file.data,/atribuce není vyžadována/);
  assert.equal(result.manifest.attribution.length,2);assert.equal(result.manifest.attribution[0].license,'CC-BY-3.0');
  assert.ok(result.files.some(file=>file.name==='assembly.json'&&JSON.parse(file.data).attribution?.[0]?.author==='hasecilu'));
  const plain=await preparePrintBatch(projectWith([catalogTool(ownItem)]));
  assert.equal(plain.files.some(file=>file.name==='ATTRIBUTION.txt'),false);assert.equal(Object.hasOwn(plain.manifest,'attribution'),false);
});

test('bundled export ZIP, SVG and 1:1 PDF carry the credits',async()=>{
  const project=projectWith([catalogTool(caliperItem)]);
  const bundle=await executeManufacturingTask('export',project,{package:true,bundle:true,lang:'cs'});
  const files=unzip(bundle.zip);
  assert.ok(files['ATTRIBUTION.txt']);assert.match(text(files['ATTRIBUTION.txt']),/hasecilu/);
  assert.match(text(files['README.txt']),/ATTRIBUTION\.txt/);
  assert.match(text(files['projekt.json']),/"attribution"/);
  const svg=text((await executeManufacturingTask('svg',project,{lang:'cs'})).data);
  assert.match(svg,/<metadata id="insertcreator-attribution">[^<]*hasecilu[^<]*<\/metadata><\/svg>/);
  const pdf=text((await executeManufacturingTask('fit-pdf',project,{lang:'cs'})).data);
  assert.ok(/\/Info \d+ 0 R/.test(pdf),'PDF trailer links the information dictionary');
  assert.ok(pdf.includes('(Obrys: Digital caliper \\(FreeCAD-library\\) - hasecilu - CC BY 3.0 - https://github.com/FreeCAD/'),'visible credit line on the page');
  assert.ok(/\/Subject \(InsertCreator - ATTRIBUTION[^]*hasecilu/.test(pdf),'full text in /Subject');
  const plain=projectWith([catalogTool(ownItem)]);
  assert.doesNotMatch(text((await executeManufacturingTask('svg',plain,{lang:'cs'})).data),/insertcreator-attribution/);
  assert.doesNotMatch(text((await executeManufacturingTask('fit-pdf',plain,{lang:'cs'})).data),/\/Info|Obrys:/);
});

test('3MF stores credits as LicenseTerms metadata only when present',()=>{
  const cube=[[[0,0,0],[1,1,0],[1,0,0]]],part=[{name:'Telo',color:'#112233',filament:1,triangles:cube}];
  const withCredits=text(unzip(encodeColor3MF(part,{title:'M',attribution:'Digital caliper – hasecilu – CC BY 3.0 & <x>'}))['3D/3dmodel.model']);
  assert.match(withCredits,/<metadata name="LicenseTerms">Digital caliper – hasecilu – CC BY 3\.0 &amp; &lt;x&gt;<\/metadata>/);
  assert.doesNotMatch(text(unzip(encodeColor3MF(part,{title:'M'}))['3D/3dmodel.model']),/LicenseTerms/);
});

test('export notice: required credits only, CC0 and unknown-free tools stay silent, deduplicated',()=>{
  const caliper=catalogTool(caliperItem),cc0=catalogTool(cc0Item);
  assert.equal(attributionNotice([cc0]),'');assert.equal(attributionNotice([catalogTool(ownItem)]),'');
  const notice=attributionNotice([caliper,{...caliper,name:'copy'},cc0]);
  assert.equal(notice.match(/hasecilu/g).length,1);
  assert.equal(collectAttributions([caliper,{...caliper,name:'copy'}])[0].tools.length,2);
  const project={tools:[{...caliper,moduleId:'a'},{...cc0,moduleId:'b'}]};
  assert.match(exportAttributionNotice(project,{moduleIds:['a']}),/hasecilu/);
  assert.equal(exportAttributionNotice(project,{moduleId:'b'}),'');
});

test('attribution text follows the active language',async()=>{
  const {setLang}=await import('../dist/i18n.js'),tools=[catalogTool(caliperItem),catalogTool(cc0Item)];
  setLang('en',{save:false});
  try{const english=attributionText(tools);assert.match(english,/Author: hasecilu/);assert.match(english,/Public domain – attribution is not required/);assert.match(attributionNotice(tools),/^When sharing the output, give attribution: /);}
  finally{setLang('cs',{save:false});}
  assert.match(attributionText(tools),/Autor: hasecilu/);
});

function fullCredit(credits){
  assert.match(credits,/Digital caliper/);assert.match(credits,/hasecilu/);
  assert.ok(credits.includes(caliperItem.source.url),'complete source URL');
  assert.ok(credits.includes('https://creativecommons.org/licenses/by/3.0/'),'licence URL');
  assert.match(credits,/CC BY 3\.0/);assert.match(credits,/69\.0 mm/,'source conversion changes');
  assert.match(credits,/InsertCreatoru|InsertCreator changes/,'subsequent application changes');
}

test('standalone DXF and fit STL packages keep generated bytes with a complete readable sidecar',async()=>{
  const project=projectWith([catalogTool(caliperItem)]),before=JSON.stringify(project);
  for(const operation of ['dxf','fit-stl']){
    const result=await executeManufacturingTask(operation,project,{lang:'cs'});
    const file=operation==='dxf'?{name:'lic-02.dxf',data:result.data,type:'application/dxf'}:{...result.files[0],type:'model/stl'};
    const plan=standaloneAttributionPackage(project,file);
    assert.ok(plan);assert.match(plan.name,/\.zip$/);
    assert.equal(plan.files[0].data,file.data,'packaging never rewrites the manufacturing file');
    const packaged=await executeManufacturingTask('zip',project,{files:plan.files}),files=unzip(packaged.zip);
    assert.deepEqual(Object.keys(files),[file.name,'ATTRIBUTION.txt']);
    assert.deepEqual(files[file.name],file.data,'download contains every original manufacturing byte');
    fullCredit(text(files['ATTRIBUTION.txt']));
  }
  assert.equal(JSON.stringify(project),before,'sidecar packaging cannot modify the project');
});

test('sidecars follow the exact exported scope and leave embedded formats, own tools and CC0-only exports alone',()=>{
  const project=projectWith([catalogTool(caliperItem),catalogTool(cc0Item)]),file={name:'outline.DXF',data:new Uint8Array([1,2,3])};
  assert.ok(standaloneAttributionPackage(project,file,{moduleId:'m0'}));
  assert.equal(standaloneAttributionPackage(project,file,{moduleId:'m1'}),null);
  assert.equal(standaloneAttributionPackage(project,file,{moduleIds:[]}),null);
  assert.equal(standaloneAttributionPackage(project,file,{moduleIds:['m0'],moduleId:'m1'}),null,'both scope filters apply');
  assert.equal(exportAttributionNotice(project,{moduleIds:['m0'],moduleId:'m1'}),'');
  const selected=standaloneAttributionPackage(project,file,{moduleIds:['m0']});
  fullCredit(selected.files[1].data);assert.ok(!selected.files[1].data.includes(cc0Item.source.url));
  assert.equal(standaloneAttributionPackage(projectWith([catalogTool(ownItem)]),file),null);
  for(const ext of ['zip','svg','pdf','3mf','json'])assert.equal(standaloneAttributionPackage(project,{...file,name:'existing.'+ext}),null,ext);
  assert.equal(standaloneAttributionPackage(project,null),null);
});

test('actual application download delivers attributed DXF and single-module fit STL together with their sidecar',async t=>{
  const [{Window},{Worker:NodeWorker},fs]=await Promise.all([import('happy-dom'),import('node:worker_threads'),import('node:fs/promises')]);
  const mobile=new URL('../',import.meta.url).pathname.split('/').filter(Boolean).at(-1)==='mobil',prefix=mobile?'insertcreator-mobile:':'';
  const win=new Window({url:mobile?'http://localhost:5174':'http://localhost:5173'});
  win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
  for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
  Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
  if(mobile){Object.defineProperty(win.navigator,'userAgent',{value:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',configurable:true});win.innerWidth=390;win.innerHeight=844;}
  win.scrollTo=()=>{};win.HTMLCanvasElement.prototype.getContext=()=>null;
  const nativeTimeout=globalThis.setTimeout,createURL=URL.createObjectURL,revokeURL=URL.revokeObjectURL;
  globalThis.setTimeout=(fn,ms,...args)=>{const timer=nativeTimeout(fn,ms,...args);if(ms>=4000)timer.unref?.();return timer;};
  globalThis.requestAnimationFrame=fn=>nativeTimeout(()=>fn(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;
  const workers=new Set(),results=[],blobURLs=new Map(),downloads=[];
  globalThis.Worker=class{
    constructor(url){
      this.jobs=new Map();this.native=new NodeWorker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{url:String(url)}});workers.add(this);
      this.native.on('message',data=>{if(data.type==='result')results.push({operation:this.jobs.get(data.id),result:data.result});this.onmessage?.({data});});
      this.native.on('error',error=>this.onerror?.({message:error.message,preventDefault(){}}));this.native.on('messageerror',()=>this.onmessageerror?.());this.native.unref();
    }
    postMessage(data,transfer){this.jobs.set(data.id,data.operation);this.native.postMessage(data,transfer);}
    terminate(){workers.delete(this);return this.native.terminate();}
  };
  URL.createObjectURL=blob=>{const url='blob:http://localhost/lic02-'+blobURLs.size;blobURLs.set(url,blob);return url;};
  URL.revokeObjectURL=url=>blobURLs.delete(url);
  win.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push({name:this.download,blob:blobURLs.get(this.href)});};
  const $=selector=>document.querySelector(selector),click=selector=>{const node=$(selector);assert.ok(node,'Missing '+selector);node.click();};
  const pause=ms=>new Promise(resolve=>nativeTimeout(resolve,ms));
  const waitFor=async predicate=>{const start=Date.now();while(!predicate()){if(Date.now()-start>15000)throw Error('Timed out waiting for attributed download');await pause(10);}};
  t.after(async()=>{try{$('[data-modal-close]')?.click();await Promise.all([...workers].map(worker=>worker.terminate()));win.happyDOM.abort();}finally{globalThis.setTimeout=nativeTimeout;URL.createObjectURL=createURL;URL.revokeObjectURL=revokeURL;}});
  const fixture=projectWith([catalogTool(caliperItem)]);fixture.connectors=false;fixture.sizeLabels=false;
  localStorage.setItem(prefix+'suplik-studio-lang','"cs"');localStorage.setItem(prefix+'suplik-studio-unit','"mm"');
  localStorage.setItem(prefix+'suplik-studio-projects-v1',JSON.stringify([fixture]));localStorage.setItem(prefix+'suplik-studio-current',JSON.stringify(fixture.id));
  await import('../dist/app.js');
  const persisted=localStorage.getItem(prefix+'suplik-studio-projects-v1');
  for(const operation of ['dxf','fit-stl']){
    click('#app [data-action="export"]');click(`[data-format="${operation==='dxf'?'dxf':'stl'}"]`);
    await waitFor(()=>$('[data-export-analysis]')?.dataset.analysisBusy==='false'&&!$('[data-do-export]').disabled);
    const before=downloads.length;
    click(operation==='dxf'?'[data-do-export]':'[data-export-fit-stl]');
    if(mobile){
      await waitFor(()=>$('.mobile-file-tray [data-file-save]'));
      assert.equal(downloads.length,before,'mobile waits for explicit Save/Download action');
      assert.equal(document.querySelectorAll('.mobile-file-tray li').length,1,'one archive keeps attribution with the model');
      click('.mobile-file-tray [data-file-save]');
    }
    await waitFor(()=>downloads.length>before);await waitFor(()=>!$('.modal'));
    assert.equal(downloads.length,before+1,'one persistent download, not a second automatic download');
    const download=downloads.at(-1);assert.match(download.name,/\.zip$/);assert.equal(download.blob.type,'application/zip');
    const files=unzip(new Uint8Array(await download.blob.arrayBuffer())),name=Object.keys(files).find(name=>name.endsWith(operation==='dxf'?'.dxf':'.stl'));
    assert.ok(name,'the selected manufacturing file is inside the downloaded archive');assert.equal(Object.keys(files).length,2);
    fullCredit(text(files['ATTRIBUTION.txt']));
    const original=results.findLast(entry=>entry.operation===operation).result;
    assert.deepEqual(files[name],operation==='dxf'?original.data:original.files[0].data,'download preserves actual worker-generated geometry');
    if(mobile)click('[data-files-close]');
  }
  assert.equal(localStorage.getItem(prefix+'suplik-studio-projects-v1'),persisted,'downloads do not change saved geometry/provenance');
});
