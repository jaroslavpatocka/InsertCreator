// Export-only cuts of the original manufacturing body. Drawer layout is never changed.
import {validateProject} from './model.js';
import {validateLayout} from './geometry.js';
import {pocketOutline} from './finger-grip.js';
import {planSizeLabels} from './size-labels.js';
import {planJoints} from './module-joints.js';
import {buildPrintTriangles,encodeSTL,printConfig,trianglesVolume,validatePrintMesh} from './print-geometry.js';
import {i18nError} from './i18n.js';

const EPS=1e-6,MAX_PARTS=400,MAX_BYTES=128*1024*1024;
const clonePlain=value=>Array.isArray(value)?value.map(clonePlain):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clonePlain(item)])):value;
const clone=value=>typeof structuredClone==='function'?structuredClone(value):clonePlain(value);
const round=value=>Math.round(value*1000000)/1000000;
const slug=value=>String(value??'modul').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase().slice(0,60)||'modul';
const bounds=triangles=>{
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const triangle of triangles)for(const point of triangle)for(let i=0;i<3;i++){min[i]=Math.min(min[i],point[i]);max[i]=Math.max(max[i],point[i]);}
  return{min,max,width:round(max[0]-min[0]),height:round(max[1]-min[1]),heightMm:round(max[2]-min[2])};
};
const fits=(w,h,bw,bh)=>w<=bw+EPS&&h<=bh+EPS;
const footprintFits=(m,bw,bh)=>fits(m.width-.5,m.height-.5,bw,bh)||fits(m.height-.5,m.width-.5,bw,bh);
function tilePlan(project,module,bedWidth,bedHeight){
  const grid=Number(project.grid),isGrid=project.bottomMode==='grid';
  const feet=isGrid?(module.cells?.length??Math.round(module.width/42)*Math.round(module.height/42)):0;
  if(footprintFits(module,bedWidth,bedHeight)&&feet<=400)return[{row:0,column:0,clip:null}];
  const pitch=isGrid?42:grid;
  const alternative=(width,height)=>{
    let w=Math.floor((width+EPS)/pitch)*pitch,h=Math.floor((height+EPS)/pitch)*pitch;
    if(isGrid&&(w<42||h<42))throw i18nError('Tisková plocha je příliš malá pro celé pole Gridfinity 42 mm.');
    if(!w)w=width;if(!h)h=height;
    w=Math.min(w,module.width);h=Math.min(h,module.height);
    if(isGrid)h=Math.min(h,Math.floor(400/Math.round(w/42))*42);
    const columns=Math.ceil((module.width-EPS)/w),rows=Math.ceil((module.height-EPS)/h),indexes=new Set();
    if(module.cells){
      for(const cell of module.cells){
        const x0=Math.floor((cell.x*grid+EPS)/w),x1=Math.min(columns-1,Math.ceil(((cell.x+1)*grid-EPS)/w)-1),y0=Math.floor((cell.y*grid+EPS)/h),y1=Math.min(rows-1,Math.ceil(((cell.y+1)*grid-EPS)/h)-1);
        for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)indexes.add(`${x},${y}`);
      }
    }else{
      if(columns*rows>MAX_PARTS)return{count:columns*rows,tiles:[]};
      for(let y=0;y<rows;y++)for(let x=0;x<columns;x++)indexes.add(`${x},${y}`);
    }
    const tiles=[...indexes].map(key=>{const [column,row]=key.split(',').map(Number);return{row,column,clip:{x:round(module.x+column*w),y:round(module.y+row*h),width:round(Math.min(w,module.width-column*w)),height:round(Math.min(h,module.height-row*h))}};}).sort((a,b)=>a.row-b.row||a.column-b.column);
    return{count:tiles.length,tiles};
  };
  const options=[alternative(bedWidth,bedHeight),alternative(bedHeight,bedWidth)].sort((a,b)=>a.count-b.count);
  if(options[0].count>MAX_PARTS)throw i18nError('Pro jeden export lze připravit nejvýše 400 tiskových dílů. Vyberte méně modulů nebo větší tiskovou plochu.');
  return options[0].tiles;
}

/** files contain STL plus assembly.json. Part offsets and inverse transforms use world millimetres. */
export async function preparePrintBatch(project,{moduleIds,signal,onProgress}={}){
  const abort=()=>{if(signal?.aborted)throw new DOMException('Příprava tiskových dílů byla zrušena.','AbortError');};
  const progress=event=>{abort();try{onProgress?.(event);}catch{}abort();};
  const pause=async()=>{await new Promise(resolve=>setTimeout(resolve,0));abort();};
  abort();
  if(!project||!Array.isArray(project.modules)||!Array.isArray(project.tools))throw i18nError('Soubor neobsahuje projekt InsertCreator.');
  const snapshot=clone(project),ids=moduleIds===undefined?snapshot.modules.map(module=>module.id):moduleIds;
  if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)throw i18nError('Vyberte alespoň jeden platný modul pro tisk.');
  if(snapshot.tools.length>300||snapshot.modules.length>400)throw i18nError('Projekt je příliš velký. Limit je 300 nástrojů a 400 modulů.');
  const wanted=new Set(ids),selected=snapshot.modules.filter(module=>wanted.has(module.id));
  if(selected.length!==ids.length)throw i18nError('Některý vybraný modul už v projektu neexistuje.');
  const selectedTools=snapshot.tools.filter(tool=>wanted.has(tool.moduleId));
  // Unselected geometry must not block an otherwise valid independent export.
  const normalized=validateProject({...snapshot,modules:selected,tools:selectedTools,toolSets:[]});
  const source={...snapshot,...normalized},bedWidth=Number(source.bedWidth),bedHeight=Number(source.bedHeight);
  printConfig(source);
  const issue=validateLayout(source)[0];if(issue)throw Object.assign(Error(issue.message),{i18n:issue.i18n});
  if(source.bottomMode==='grid')for(const module of source.modules)if([module.x,module.y,module.width,module.height].some(value=>Math.abs(value/42-Math.round(value/42))>.0001))throw i18nError('Modul „{name}“ musí mít rozměry i polohu v násobcích 42 mm pro Gridfinity patky.',{name:module.name||module.id});
  progress({stage:'planning',progress:0,completed:0,total:0});await pause();
  const plans=source.modules.map(module=>({module,tiles:tilePlan(source,module,bedWidth,bedHeight)})),total=plans.reduce((sum,plan)=>sum+plan.tiles.length,0);
  if(total>MAX_PARTS)throw i18nError('Pro jeden export lze připravit nejvýše 400 tiskových dílů. Vyberte méně modulů nebo větší tiskovou plochu.');
  const jointPlan=source.connectors?planJoints(source,source.modules,source.tools):null;
  const files=[],parts=[],splitSummary=[];let completed=0,bytes=0;
  for(const [moduleIndex,{module,tiles}] of plans.entries()){
    const own=source.tools.filter(tool=>tool.moduleId===module.id).map(tool=>({...tool,poly:pocketOutline(tool,source.clearance)})),labelPlan=planSizeLabels(source,[module],own),moduleParts=[];
    for(const tile of tiles){
      progress({stage:'cutting',progress:total?completed/total:0,completed,total,moduleId:module.id});await pause();
      const meshOrigin={x:tile.clip?.x??module.x,y:tile.clip?.y??module.y};
      const mesh=buildPrintTriangles(source,[module],own,meshOrigin,{clip:tile.clip,labelPlan,joints:jointPlan?.byModule});abort();completed++;
      if(!mesh.length)continue;
      const box=bounds(mesh),rotation=fits(box.width,box.height,bedWidth,bedHeight)?0:fits(box.height,box.width,bedWidth,bedHeight)?90:null;
      if(rotation===null)throw i18nError('Tiskový díl se nevejde na zadanou tiskovou plochu.');
      const local=mesh.map(triangle=>triangle.map(point=>rotation?[box.height-(point[1]-box.min[1]),point[0]-box.min[0],point[2]]:[point[0]-box.min[0],point[1]-box.min[1],point[2]]));
      validatePrintMesh(local);
      const index=moduleParts.length+1,file=`${String(moduleIndex+1).padStart(3,'0')}-${slug(module.name||module.id)}-${String(index).padStart(3,'0')}.stl`,data=encodeSTL(local,'InsertCreator | mm | cut '+module.id+' '+index);
      bytes+=data.byteLength;if(bytes>MAX_BYTES)throw i18nError('Tiskové díly přesahují limit 128 MB. Vyberte méně modulů a export zopakujte.');
      const offset={x:round(meshOrigin.x+box.min[0]),y:round(meshOrigin.y+box.min[1]),z:0},assemblyTransform=rotation?[0,1,0,offset.x,-1,0,0,round(offset.y+box.height),0,0,1,0,0,0,0,1]:[1,0,0,offset.x,0,1,0,offset.y,0,0,1,0,0,0,0,1];
      const part={moduleId:module.id,file,index,count:0,row:tile.row,column:tile.column,offset,rotationForPrinting:rotation,assemblyTransform,clip:tile.clip||{x:module.x,y:module.y,width:module.width,height:module.height},bounds:{width:rotation?box.height:box.width,height:rotation?box.width:box.height,heightMm:box.heightMm},sourceBounds:{width:box.width,height:box.height,heightMm:box.heightMm},triangles:local.length,volumeMm3:trianglesVolume(local)};
      files.push({name:file,data});moduleParts.push(part);parts.push(part);
      progress({stage:'cutting',progress:completed/total,completed,total,moduleId:module.id});await pause();
    }
    for(const part of moduleParts)part.count=moduleParts.length;
    splitSummary.push({moduleId:module.id,name:module.name||module.id,count:moduleParts.length,files:moduleParts.map(part=>part.file)});
  }
  if(!parts.length)throw i18nError('Vybrané moduly neobsahují žádnou tisknutelnou geometrii.');
  const manifest={schemaVersion:1,units:'mm',bed:{width:bedWidth,height:bedHeight},coordinates:'world',transform:'row-major 4x4: STL vertex to original drawer world coordinates',parts,...(jointPlan?{joints:{count:jointPlan.joints.length,skipped:jointPlan.skipped}}:{})};
  const assembly=JSON.stringify(manifest,null,2);bytes+=new TextEncoder().encode(assembly).byteLength;
  if(bytes>MAX_BYTES)throw i18nError('Tiskové díly přesahují limit 128 MB. Vyberte méně modulů a export zopakujte.');
  files.push({name:'assembly.json',data:assembly});
  progress({stage:'complete',progress:1,completed:total,total});await pause();
  return{files,parts,manifest,moduleIds:source.modules.map(module=>module.id),splitSummary,joints:jointPlan?.joints.length??0};
}
