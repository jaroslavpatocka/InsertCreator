import {autoArrange,exportFitSTL,exportSVG,exportDXF,printStats,validateLayout,zipFiles} from './geometry.js';
import {appendGridfinityExport,planPrintBatch,prepareBaseplateFiles,preparePrintBatch} from './print-batch.js';
import {prepareJointFitTest} from './joint-fit.js';
import {planSizeLabels} from './size-labels.js';
import {printPreview} from './preview3d.js';
import {mergePrintStats} from './preview-mesh.js';
import {validatePrintBed} from './print-geometry.js';
import {exportFitPDF} from './fit-sheet.js';
import {validateProject} from './model.js';
import {setLang,errorText,t} from './i18n.js';
import {setAppUnit,setProjectUnit} from './units.js';
import {materialConfig} from './print-material.js';

const MAX_BYTES=128*1024*1024;
const slug=value=>String(value||'modul').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase();
const aborted=signal=>{if(signal?.aborted)throw new DOMException('Výpočet byl zrušen.','AbortError');};
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
export const createManufacturingTaskCache=()=>({key:null,labels:null,issues:null,stats:null,statsError:'',statsReady:false});
function selected(project,moduleIds){
  if(!moduleIds)return project;
  const ids=new Set(moduleIds);return{...project,modules:project.modules.filter(module=>ids.has(module.id)),tools:project.tools.filter(tool=>ids.has(tool.moduleId)),toolSets:[]};
}
function cacheKey(project,options){
  // Bed settings and timestamps never change plaques or geometric volume.
  const {bedWidth,bedHeight,limitToBed,updatedAt,multiMaterial,...shape}=project;
  // Filament colour changes appearance, while these material options can alter
  // manufacturing regions and therefore must remain part of the shape key.
  const config=materialConfig(project),material={enabled:config.enabled,floor:config.floor,text:config.text,floorThickness:config.floorThickness};
  return JSON.stringify([{...shape,multiMaterial:material},options.lang||'cs',options.unit||'mm']);
}
function packageResult(result,options,onProgress=()=>{}){
  if(!options.package&&!Array.isArray(options.extraFiles))return result;
  const files=[...result.files,...(options.extraFiles||[])];onProgress({stage:'packaging',files:files.length});
  const zip=makeZip(files),{files:unused,...metadata}=result;onProgress({stage:'packaged',progress:1,files:files.length});
  return{...metadata,zip,fileCount:files.length};
}
function makeZip(files){
  if(!Array.isArray(files)||files.length>4096)throw new Error('Pro jeden ZIP vyberte méně souborů.');
  const bytes=files.reduce((sum,file)=>sum+(typeof file.data==='string'?new TextEncoder().encode(file.data).length:file.data?.byteLength||0),0);
  if(bytes>MAX_BYTES)throw new Error('Tiskové díly přesahují limit 128 MB. Vyberte méně modulů a export zopakujte.');
  return zipFiles(files);
}

/** Shared only with the strictly bounded, deferred fallback for small projects. */
export async function executeManufacturingTask(operation,input={},options={},context={}){
  const {signal,onProgress=()=>{},cache=createManufacturingTaskCache()}=context;
  const progress=event=>{aborted(signal);onProgress(event);};
  aborted(signal);setLang(options.lang||'cs',{save:false});setAppUnit(options.unit||'mm',{save:false});setProjectUnit(input.unit||'');
  if(operation==='zip'){const files=options.files||[];progress({stage:'packaging',files:files.length});const zip=makeZip(files);progress({stage:'packaged',progress:1,files:files.length});return{zip,fileCount:files.length};}
  if(operation==='preview')return printPreview(input,options.selected??null,options.selectedModule??null,options.camera||{},options.viewport||{width:1000,height:600},options.selectedToolIds||[]);
  if(operation==='joint-fit')return packageResult(await prepareJointFitTest(input,{signal,onProgress:progress}),options,progress);
  if(operation==='export'){
    let result=await preparePrintBatch(input,{moduleIds:options.moduleIds,signal,onProgress:progress});
    if(input.bottomMode==='grid')result=await appendGridfinityExport(result,input,{signal,onProgress:progress});
    if(!options.bundle)return packageResult(result,options,progress);
    const colorNote=result.manifest?.colors?'\n\n'+t('Vícebarevný tisk: otevřete soubory 3MF a nastavte filamenty podle čísel:')+'\n'+result.manifest.colors.filaments.map((color,index)=>`${index+1}: ${color} (${[...new Set(Object.entries(result.manifest.colors.zones).filter(([,slot])=>slot===index+1).map(([zone])=>t({body:'Tělo',floor:'Dno kapes'}[zone]||'Text')))].join(', ')})`).join('\n'):'';
    const gridfinity=result.manifest?.gridfinity,gridNote=gridfinity?'\n\n'+t('Gridfinity: složka gridfinity obsahuje základnu podle rozměru šuplíku včetně dilatačního kusu a zátku 1×1. Zátku vytiskněte {n}×, tolik polí zůstalo volných.',{n:gridfinity.plug.freeCells}):'';
    const jointNote=result.joints&&options.jointNote?'\n\n'+options.jointNote:'',unjoined=result.manifest?.joints?.unjoined?.length||0;
    const readme=(options.readme??'InsertCreator\n\n'+t('Tiskové díly sestavte podle assembly.json. Souřadnice jsou v mm. Dělení je pouze pro tisk; rozvržení šuplíku zůstává původní.'))+gridNote+colorNote+jointNote+(unjoined?'\n'+t('Na {n} vnitřních hranách mezi díly není bezpečné místo pro spojku. Podrobnosti jsou v assembly.json.',{n:unjoined}):'');
    return packageResult(result,{...options,package:true,extraFiles:[...(options.extraFiles||[]),{name:'projekt.json',data:JSON.stringify({schemaVersion:1,app:'InsertCreator',project:input},null,2)},{name:'README.txt',data:readme}]},progress);
  }
  if(operation==='connectors'){
    const enabled=options.enabled===true;progress({stage:'planning',progress:.05});await pause();aborted(signal);
    const on=autoArrange({...input,connectors:enabled});progress({stage:'planning',progress:.55});await pause();aborted(signal);
    const off=autoArrange({...input,connectors:!enabled}),fits=on.unplaced.length<=off.unplaced.length;
    return{project:{...input,connectors:enabled,...(fits?{tools:on.tools,modules:on.modules}:{})},fits};
  }
  if(operation==='baseplate'){
    const {plan,files,manifest}=await prepareBaseplateFiles(input,{signal,onProgress:progress});
    files.push({name:'assembly.json',data:JSON.stringify(manifest,null,2)});progress({stage:'complete',progress:1});return packageResult({files,manifest,plan},options,progress);
  }
  const source=validateProject(selected(input,options.moduleIds));
  if(operation==='svg')return{data:new TextEncoder().encode(exportSVG(source,{moduleId:options.moduleId??null}))};
  if(operation==='dxf')return{data:new TextEncoder().encode(exportDXF(source,{moduleId:options.moduleId??null}))};
  if(operation==='fit-pdf')return{data:exportFitPDF(source,{moduleId:options.moduleId??null})};
  if(operation==='fit-stl'){
    const modules=source.modules.filter(module=>!options.moduleId||module.id===options.moduleId),files=[];
    for(const [index,module] of modules.entries()){
      progress({stage:'cutting',progress:index/modules.length,completed:index,total:modules.length});await pause();aborted(signal);
      files.push({name:`${String(index+1).padStart(2,'0')}-${slug(module.name)}-zkouska.stl`,data:exportFitSTL(source,{moduleId:module.id})});
    }
    return packageResult({files},options,progress);
  }
  if(operation!=='analyze'&&operation!=='labels')throw new Error('Neznámý výrobní výpočet.');
  const key=cacheKey(source,options);
  if(cache.key!==key){cache.key=key;cache.labels=null;cache.issues=null;cache.stats=null;cache.statsError='';cache.statsReady=false;}
  if(!cache.labels)cache.labels=planSizeLabels(source);
  if(operation==='labels')return cache.labels;
  if(cache.issues===null)cache.issues=validateLayout(source);
  const issues=cache.issues;progress({stage:'planning',progress:.2});await pause();aborted(signal);
  const labels={count:cache.labels.labels.length,skipped:cache.labels.skipped};
  let joints=null,jointError='',bedError='';
  if(source.connectors){
    try{const plan=planPrintBatch(source).jointPlan;joints={count:plan.joints.length,joints:plan.joints,cutCount:plan.cutCount,moduleCount:plan.moduleCount,skipped:plan.skipped,unjoined:plan.unjoined,unsupported:plan.unsupported,clearance:plan.clearance};}
    catch(error){jointError=errorText(error);}
  }
  try{validatePrintBed({...source,limitToBed:true},source.modules);}catch(error){bedError=errorText(error);}
  progress({stage:'planning',progress:.5});await pause();aborted(signal);
  const fitting=source.modules.every(module=>(module.width-.5<=source.bedWidth&&module.height-.5<=source.bedHeight)||(module.height-.5<=source.bedWidth&&module.width-.5<=source.bedHeight));
  const canShowStats=!issues.length&&source.modules.length>0&&(options.checkBedForStats===false||fitting),wantStats=options.stats!==false&&canShowStats;
  if(wantStats&&!cache.statsReady){try{cache.stats=mergePrintStats(source.modules.map(module=>printStats(source,{moduleId:module.id,checkBed:false})));}catch(error){cache.statsError=errorText(error);}cache.statsReady=true;}
  progress({stage:'complete',progress:1});
  return{issues,stats:canShowStats&&cache.statsReady?cache.stats:null,printError:wantStats?cache.statsError:'',bedError,labels,joints,jointError,...(options.includeLabelPlan?{labelPlan:cache.labels}:{})};
}

function transferables(value,seen=new Set(),buffers=new Set()){
  if(!value||typeof value!=='object'||seen.has(value))return buffers;seen.add(value);
  if(value instanceof ArrayBuffer)buffers.add(value);else if(ArrayBuffer.isView(value))buffers.add(value.buffer);else for(const item of Object.values(value))transferables(item,seen,buffers);
  return buffers;
}
// Importing for the small main-thread fallback must not install a worker handler.
if(typeof document==='undefined'&&typeof self!=='undefined'&&typeof self.postMessage==='function'){
  const cache=createManufacturingTaskCache();let running=false;
  self.onmessage=async({data})=>{
    if(data?.type!=='run'||running)return;
    running=true;
    try{
      const result=await executeManufacturingTask(data.operation,data.project,data.options||{},{cache,onProgress:event=>self.postMessage({type:'progress',id:data.id,event})});
      self.postMessage({type:'result',id:data.id,result},[...transferables(result)]);
    }catch(error){self.postMessage({type:'error',id:data.id,name:error?.name||'Error',message:error?.message||'Výpočet se nepodařilo dokončit.',...(error?.i18n?{i18n:error.i18n}:{})});}
    finally{running=false;}
  };
}
