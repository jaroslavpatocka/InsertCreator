// Export-only cuts of the original manufacturing body. Drawer layout is never changed.
import {validateProject} from './model.js';
import {validateLayout} from './geometry.js';
import {pocketOutline} from './finger-grip.js';
import {planSizeLabels} from './size-labels.js';
import {planJoints,planCutJoints,JOINT_BED_RESERVE,jointClearance} from './module-joints.js';
import {buildColorZones,buildPrintTriangles,encodeSTL,printConfig,trianglesVolume,validatePrintMesh,weldPrintVertices,finalizePrintTriangles} from './print-geometry.js';
import {FLOOR_RESERVE,labelColors,materialConfig,materialSlots,zoneColor} from './print-material.js';
import {encodeColor3MF} from './three-mf.js';
import {i18nError,t} from './i18n.js';
import {layoutMeshToPhysical} from './manufacturing-coordinates.js';
import {exportBaseplateSTL,gridfinityFreeCells,planBaseplateTiles} from './gridfinity-baseplate.js';

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
const ZONE_NAMES={body:'Tělo',floor:'Dno kapes',text:'Text'},ZONE_FILES={body:'telo',floor:'dno-kapes',text:'text'};
// A label's own colour is a `text:#rrggbb` zone; two text parts need different names and files.
const zoneName=zone=>ZONE_NAMES[zone]?t(ZONE_NAMES[zone]):`${t('Text')} ${zone.slice(5)}`,zoneFile=zone=>ZONE_FILES[zone]||`text-${zone.slice(6)}`;
const fits=(w,h,bw,bh)=>w<=bw+EPS&&h<=bh+EPS;
const footprintFits=(m,bw,bh)=>fits(m.width-.5,m.height-.5,bw,bh)||fits(m.height-.5,m.width-.5,bw,bh);
function tilePlan(project,module,bedWidth,bedHeight){
  const grid=Number(project.grid),isGrid=project.bottomMode==='grid';
  const feet=isGrid?(module.cells?.length??Math.round(module.width/42)*Math.round(module.height/42)):0;
  if(footprintFits(module,bedWidth,bedHeight)&&feet<=400)return[{row:0,column:0,clip:null}];
  const pitch=isGrid?42:grid;
  const alternative=(width,height)=>{
    // A tile with a male joint must fit together with its protrusion. Reserve only
    // axes that actually need cutting.
    if(project.connectors&&project.bottomMode!=='grid'){
      if(module.width-.5>width+EPS)width-=JOINT_BED_RESERVE;
      if(module.height-.5>height+EPS)height-=JOINT_BED_RESERVE;
    }
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

/** Synchronous geometry plan shared by export and its UI. All shapes use original drawer coordinates. */
export function planPrintBatch(project,modules=project.modules,tools=project.tools){
  const bedWidth=Number(project.bedWidth),bedHeight=Number(project.bedHeight);
  const plans=modules.map(module=>({module,tiles:tilePlan(project,module,bedWidth,bedHeight).map(tile=>({...tile,key:JSON.stringify([module.id,tile.row,tile.column])}))}));
  const total=plans.reduce((sum,plan)=>sum+plan.tiles.length,0);
  if(total>MAX_PARTS)throw i18nError('Pro jeden export lze připravit nejvýše 400 tiskových dílů. Vyberte méně modulů nebo větší tiskovou plochu.');
  let jointPlan=null;
  if(project.connectors){
    const modulePlan=planJoints(project,modules,tools),cutPlan=planCutJoints(project,plans,tools,{modulePlan}),keyOf=new Map(plans.filter(plan=>plan.tiles.length===1).map(plan=>[plan.module.id,plan.tiles[0].key]));
    const moduleJoints=modulePlan.joints.map(joint=>({...joint,kind:'module',ownerModuleId:joint.owner,hostModuleId:joint.host,owner:keyOf.get(joint.owner),host:keyOf.get(joint.host),clearance:jointClearance(project)}));
    jointPlan={...modulePlan,joints:[...moduleJoints,...cutPlan.joints],byPart:cutPlan.byPart,moduleCount:modulePlan.joints.length,cutCount:cutPlan.joints.length,skipped:modulePlan.skipped+cutPlan.skipped,seams:cutPlan.seams,unjoined:cutPlan.unjoined,clearance:jointClearance(project)};
  }
  return{plans,total,jointPlan};
}

/** The exact physical part geometry shared by STL export and the manufacturing preview.
 * Tools already contain their layout-space pocket polygons. STL encoding rounds mesh vertices to Float32.
 */
export function buildPrintPart(project,module,tools,tile,{labelPlan=null,jointPlan=null}={}){
  const meshOrigin={x:tile.clip?.x??module.x,y:tile.clip?.y??module.y},cutJoints=jointPlan?.byPart.get(tile.key),joints=cutJoints?new Map([[module.id,cutJoints]]):jointPlan?.byModule;
  const options={clip:tile.clip,labelPlan,joints},colored=materialConfig(project).enabled?buildColorZones(project,[module],tools,meshOrigin,options):null;
  const mesh=colored?colored[0].mesh:buildPrintTriangles(project,[module],tools,meshOrigin,options);
  if(!mesh.length)return null;
  const box=bounds(mesh),rotation=fits(box.width,box.height,project.bedWidth,project.bedHeight)?0:fits(box.height,box.width,project.bedWidth,project.bedHeight)?90:null;
  if(rotation===null)throw i18nError('Tiskový díl se nevejde na zadanou tiskovou plochu.');
  // Layout Y grows down the screen. Reflect the complete body, including
  // pockets and joints, into physical Y-up before any proper print rotation.
  // Bind existing serialized vertices before normalization can separate their
  // double coordinates; defer collapsed-fan cleanup until every affine is done.
  // Colour zones take exactly the same path, anchored on the body, so they stay in place inside it.
  const toPrint=triangles=>{
    const normalized=weldPrintVertices(triangles).map(triangle=>triangle.map(point=>[point[0]-box.min[0],point[1]-box.min[1],point[2]])),physical=layoutMeshToPhysical(normalized,box.height,{finalize:false});
    const result=finalizePrintTriangles(rotation?physical.map(triangle=>triangle.map(point=>[box.height-point[1],point[0],point[2]])):physical);
    validatePrintMesh(result);return result;
  };
  const local=toPrint(mesh),zones=colored?colored.map(zone=>({zone:zone.zone,mesh:zone.mesh===mesh?local:toPrint(zone.mesh)})):null;
  const offset={x:round(meshOrigin.x+box.min[0]),y:round(meshOrigin.y+box.min[1]),z:0};
  const assemblyTransform=rotation?[0,1,0,offset.x,-1,0,0,round(project.height-offset.y),0,0,1,0,0,0,0,1]:[1,0,0,offset.x,0,1,0,round(project.height-offset.y-box.height),0,0,1,0,0,0,0,1];
  const layoutTransform=rotation?[0,1,0,offset.x,1,0,0,offset.y,0,0,1,0,0,0,0,1]:[1,0,0,offset.x,0,-1,0,round(offset.y+box.height),0,0,1,0,0,0,0,1];
  return{mesh:local,...(zones?{zones}:{}),box,rotation,offset,assemblyTransform,layoutTransform};
}

/** Baseplate STL tiles and their assembly data, shared by the standalone export and the main one. */
export async function prepareBaseplateFiles(project,{fileName=(tile,index)=>`gridfinity-${String(index+1).padStart(3,'0')}-${tile.columns}x${tile.rows}.stl`,bytes=0,signal,onProgress}={}){
  const abort=()=>{if(signal?.aborted)throw new DOMException('Příprava tiskových dílů byla zrušena.','AbortError');};
  const plan=planBaseplateTiles(project),files=[];
  for(const [index,tile] of plan.tiles.entries()){
    onProgress?.({stage:'cutting',progress:index/plan.tiles.length,completed:index,total:plan.tiles.length});await new Promise(resolve=>setTimeout(resolve,0));abort();
    const data=exportBaseplateSTL(project,{tile});bytes+=data.byteLength;
    if(bytes>MAX_BYTES)throw i18nError('Tiskové díly přesahují limit 128 MB. Vyberte méně modulů a export zopakujte.');
    files.push({name:fileName(tile,index),data});
  }
  const tiles=plan.tiles.map((tile,i)=>{
    const width=round(tile.columns*42+tile.extendRight),height=round(tile.rows*42+tile.extendBottom);
    return{...tile,file:files[i].name,xMm:tile.x*42,yMm:tile.y*42,sizeMm:{width,height},assemblyTransform:[1,0,0,tile.x*42,0,1,0,round(project.height-tile.y*42-height),0,0,1,0,0,0,0,1]};
  });
  const manifest={schemaVersion:2,units:'mm',pitch:42,layout:plan.layout,expansion:plan.layout.expansion,layoutSize:{width:project.width,height:project.height},coordinates:'physical-world',layoutAxes:'X right, Y down',assemblyAxes:'X right, Y up, Z up',rotateForPrinting:plan.rotated,tiles};
  return{plan,files,manifest,bytes};
}

/** One free raster cell, built as an ordinary empty module so that its foot, floor and height match the rest. */
export function gridfinityPlugSTL(project){
  const module={id:'__gridfinity-plug',name:'Gridfinity 1x1',x:0,y:0,width:42,height:42,sizeMode:'manual',locked:false};
  // A plug has no pockets or text to colour, and nothing to join: it sits alone in its socket.
  const source={...project,modules:[module],tools:[],toolSets:[],connectors:false,multiMaterial:{...project.multiMaterial,enabled:false}};
  const {mesh}=buildPrintPart(source,module,[],{row:0,column:0,clip:null,key:module.id});
  return encodeSTL(mesh,'InsertCreator | mm | Gridfinity plug 1x1');
}

/** A Gridfinity export is complete only with its raster and the plug. Free cells count the whole drawer, not the selection. */
export async function appendGridfinityExport(result,project,{signal,onProgress}={}){
  const size=file=>typeof file.data==='string'?new TextEncoder().encode(file.data).byteLength:file.data?.byteLength||0;
  const fileName=(tile,index)=>`gridfinity/zakladna-${String(index+1).padStart(3,'0')}-${tile.columns}x${tile.rows}.stl`;
  const base=await prepareBaseplateFiles(project,{fileName,bytes:result.files.reduce((sum,file)=>sum+size(file),0),signal,onProgress});
  const plug={name:'gridfinity/zatka-1x1.stl',data:gridfinityPlugSTL(project)},{expansion,tiles,rotateForPrinting}=base.manifest;
  const manifest={...result.manifest,gridfinity:{plug:{file:plug.name,freeCells:gridfinityFreeCells(project)},baseplate:{expansion,rotateForPrinting,tiles}}},assembly=JSON.stringify(manifest,null,2);
  const files=[...result.files.map(file=>file.name==='assembly.json'?{...file,data:assembly}:file),...base.files,plug];
  if(files.reduce((sum,file)=>sum+size(file),0)>MAX_BYTES)throw i18nError('Tiskové díly přesahují limit 128 MB. Vyberte méně modulů a export zopakujte.');
  return{...result,files,manifest};
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
  if(snapshot.tools.length>3000||snapshot.modules.length>4000)throw i18nError('Projekt je příliš velký. Limit je 3000 nástrojů a 4000 modulů.');
  const wanted=new Set(ids),selected=snapshot.modules.filter(module=>wanted.has(module.id));
  if(selected.length!==ids.length)throw i18nError('Některý vybraný modul už v projektu neexistuje.');
  const selectedTools=snapshot.tools.filter(tool=>wanted.has(tool.moduleId));
  // Unselected geometry must not block an otherwise valid independent export.
  const normalized=validateProject({...snapshot,modules:selected,tools:selectedTools,toolSets:[]});
  const source={...snapshot,...normalized},bedWidth=Number(source.bedWidth),bedHeight=Number(source.bedHeight);
  const cfg=printConfig(source),colors=materialConfig(source);
  const issue=validateLayout(source)[0];if(issue)throw Object.assign(Error(issue.message),{i18n:issue.i18n});
  // Reject a known floor-depth conflict before planning joints or cutting parts.
  // In solid magnetic models the exact reserve is pocket-position dependent.
  if(colors.enabled&&colors.floor&&(cfg.printMode==='light'||cfg.bottomMode!=='magnet')){
    const reserve=cfg.printMode==='light'?cfg.base+colors.floorThickness:Math.max(cfg.base,colors.floorThickness+FLOOR_RESERVE);
    const deep=source.tools.find(tool=>tool.depth>cfg.height-reserve+EPS);
    if(deep)throw i18nError('Kapsa „{name}“ je pro vložku dna příliš hluboká. Zmenšete hloubku kapsy nebo tloušťku vložky.',{name:deep.name});
  }
  if(source.bottomMode==='grid')for(const module of source.modules)if([module.x,module.y,module.width,module.height].some(value=>Math.abs(value/42-Math.round(value/42))>.0001))throw i18nError('Modul „{name}“ musí mít rozměry i polohu v násobcích 42 mm pro Gridfinity patky.',{name:module.name||module.id});
  progress({stage:'planning',progress:0,completed:0,total:0});await pause();
  const {plans,total,jointPlan}=planPrintBatch(source);
  if(total>MAX_PARTS)throw i18nError('Pro jeden export lze připravit nejvýše 400 tiskových dílů. Vyberte méně modulů nebo větší tiskovou plochu.');
  const allLabels=colors.enabled?planSizeLabels(source).labels:[],files=[],parts=[],splitSummary=[],slots=colors.enabled?materialSlots({...colors,floor:colors.floor&&source.tools.length>0,text:colors.text&&allLabels.length>0,labelColors:labelColors(allLabels)}):null;let completed=0,bytes=0;
  for(const [moduleIndex,{module,tiles}] of plans.entries()){
    const own=source.tools.filter(tool=>tool.moduleId===module.id).map(tool=>({...tool,poly:pocketOutline(tool,source)})),labelPlan=planSizeLabels(source,[module],own),moduleParts=[];
    for(const tile of tiles){
      progress({stage:'cutting',progress:total?completed/total:0,completed,total,moduleId:module.id});await pause();
      const geometry=buildPrintPart(source,module,own,tile,{labelPlan,jointPlan});abort();completed++;
      if(!geometry)continue;
      const {mesh:local,zones,box,rotation,offset,assemblyTransform,layoutTransform}=geometry;
      const index=moduleParts.length+1,base=`${String(moduleIndex+1).padStart(3,'0')}-${slug(module.name||module.id)}-${String(index).padStart(3,'0')}`;
      let file=base+'.stl',data,colorFiles=null;
      if(zones){
        // The 3MF keeps the colours together; the STLs share its coordinates for slicers that ignore them.
        file=base+'.3mf';data=encodeColor3MF(zones.map(zone=>({name:zoneName(zone.zone),color:zoneColor(zone.zone,colors),filament:slots.zones[zone.zone],triangles:zone.mesh})),{title:module.name||module.id,position:{x:Math.max(0,(bedWidth-(rotation?box.height:box.width))/2),y:Math.max(0,(bedHeight-(rotation?box.width:box.height))/2)}});
        colorFiles={};
        for(const zone of zones){const name=`barvy/${base}-${zoneFile(zone.zone)}.stl`,stl=encodeSTL(zone.mesh,'InsertCreator | mm | '+zone.zone+' '+module.id+' '+index);bytes+=stl.byteLength;files.push({name,data:stl});colorFiles[zone.zone]=name;}
      }else data=encodeSTL(local,'InsertCreator | mm | cut '+module.id+' '+index);
      bytes+=data.byteLength;if(bytes>MAX_BYTES)throw i18nError('Tiskové díly přesahují limit 128 MB. Vyberte méně modulů a export zopakujte.');
      const part={moduleId:module.id,key:tile.key,file,index,count:0,row:tile.row,column:tile.column,offset,rotationForPrinting:rotation,assemblyTransform,layoutTransform,clip:tile.clip||{x:module.x,y:module.y,width:module.width,height:module.height},bounds:{width:rotation?box.height:box.width,height:rotation?box.width:box.height,heightMm:box.heightMm},sourceBounds:{width:box.width,height:box.height,heightMm:box.heightMm},triangles:zones?zones.reduce((sum,zone)=>sum+zone.mesh.length,0):local.length,volumeMm3:zones?zones.reduce((sum,zone)=>sum+trianglesVolume(zone.mesh),0):trianglesVolume(local),...(colorFiles?{colorFiles}:{})};
      files.push({name:file,data});moduleParts.push(part);parts.push(part);
      progress({stage:'cutting',progress:completed/total,completed,total,moduleId:module.id});await pause();
    }
    for(const part of moduleParts)part.count=moduleParts.length;
    splitSummary.push({moduleId:module.id,name:module.name||module.id,count:moduleParts.length,files:moduleParts.map(part=>part.file)});
  }
  if(!parts.length)throw i18nError('Vybrané moduly neobsahují žádnou tisknutelnou geometrii.');
  const manifest={schemaVersion:2,units:'mm',bed:{width:bedWidth,height:bedHeight},coordinates:'physical-world',coordinateFrames:{assembly:{origin:'drawer lower-left',axes:'X right, Y up, Z up'},layout:{origin:'drawer upper-left',axes:'X right, Y down, Z up'},stl:{origin:'part print-bed lower-left',axes:'X right, Y up, Z up'}},layoutHeightMm:source.height,layoutSize:{width:source.width,height:source.height},layoutFields:['parts.offset','parts.clip','parts.row','parts.column','joints'],transform:'row-major 4x4: assemblyTransform maps STL vertices to physical drawer world; layoutTransform maps STL vertices to original 2D drawer layout',parts,...(slots?{colors:{filaments:slots.colors,zones:slots.zones,floorThickness:colors.floor?colors.floorThickness:0}}:{}),...(jointPlan?{joints:{count:jointPlan.joints.length,moduleCount:jointPlan.moduleCount,cutCount:jointPlan.cutCount,skipped:jointPlan.skipped,clearance:jointPlan.clearance,seams:jointPlan.seams,unjoined:jointPlan.unjoined,connections:jointPlan.joints}}:{})};
  const assembly=JSON.stringify(manifest,null,2);bytes+=new TextEncoder().encode(assembly).byteLength;
  if(bytes>MAX_BYTES)throw i18nError('Tiskové díly přesahují limit 128 MB. Vyberte méně modulů a export zopakujte.');
  files.push({name:'assembly.json',data:assembly});
  progress({stage:'complete',progress:1,completed:total,total});await pause();
  return{files,parts,manifest,moduleIds:source.modules.map(module=>module.id),splitSummary,joints:jointPlan?.joints.length??0};
}
