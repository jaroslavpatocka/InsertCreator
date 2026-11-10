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
import {normalizeAttribution,attributionText,attributionNotice,exportAttributionNotice,collectAttributions} from '../dist/asset-attribution.js';

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
