import {materialConfig} from './print-material.js';
import {esc} from './ui.js';
import {t,getLang} from './i18n.js';
import {unit} from './units.js';
import {planSizeLabels,SIZE_LABEL_REASONS} from './size-labels.js';
import {moduleOutline} from './module-footprint.js';
import {gridfinityLayout,GRIDFINITY_BASEPLATE,BASEPLATE_SOCKET_LEVELS} from './gridfinity-baseplate.js';
import earcut from './vendor/earcut.js';
import {layoutMeshToPhysical} from './manufacturing-coordinates.js';
import {moduleParts,previewBatch,usesPrintParts} from './preview-mesh.js';

const TAU=Math.PI*2,PITCH_LIMIT=Math.PI/2-.01;
const shade=(hex,light)=>{const factor=light/62,[r,g,b]=[1,3,5].map(i=>Math.min(255,Math.round(parseInt(hex.slice(i,i+2),16)*factor)));return`rgb(${r} ${g} ${b})`;};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=(value,fallback)=>value!==null&&value!==''&&Number.isFinite(Number(value))?Number(value):fallback;
let cacheKey='',cached=null,meshRevision=0,projectionKey='',projectionHTML='',projectionFaces=0,projectionReduced=false,projectionRevision=0;

// These are display budgets only. The manufacturing export always uses the full mesh.
export const PREVIEW_BUDGET=Object.freeze({tools:24,points:2500,modules:32,faces:12000,fragments:24000,planeTests:4000000,nodes:16000,htmlBytes:5000000,wirePoints:16000});
const previewBudgetMessage=()=>t('Sestava je pro přesný interaktivní náhled příliš složitá. Zobrazuji rychlé obrysy; výrobní export zůstává úplný.');
const budgetError=()=>Object.assign(new Error(previewBudgetMessage()),{previewBudget:true});
const pick=(object,keys)=>Object.fromEntries(keys.map(key=>[key,object?.[key]]));
export function previewGeometryKey(project){
  const material=materialConfig(project),parts=project.connectors===true&&project.bottomMode!=='grid'||material.enabled;
  return JSON.stringify({lang:getLang(),unit:unit(),...pick(project,['width','height','grid','clearance','wall','base','insertHeight','printMode','bottomMode','sizeLabels','connectors','jointClearance','magnetDiameter','magnetDepth']),
    ...(parts?pick(project,['bedWidth','bedHeight']):{}),material:pick(material,['enabled','floor','text','floorThickness']),
    modules:(Array.isArray(project.modules)?project.modules:[]).map(module=>pick(module,['id','name','x','y','width','height','shape','cells'])),
    tools:(Array.isArray(project.tools)?project.tools:[]).map(tool=>pick(tool,['id','name','x','y','rotation','depth','moduleId','points','fingerGrips','pocketMagnets','sizeLabel','nominalSize']))});
}
const PLANE_EPS=1e-5;
const dot3=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
function facePlane(points){
  const [a,b,c]=points,u=b.map((v,i)=>v-a[i]),v=c.map((value,i)=>value-a[i]);
  let normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal);
  if(length<1e-10)throw Error('Síť obsahuje degenerovaný trojúhelník.');
  normal=normal.map(value=>value/length);
  if(normal.find(value=>Math.abs(value)>1e-7)<0)normal=normal.map(value=>-value);
  const offset=dot3(normal,a),key=normal.map(value=>Math.round(value*1e6)).join(',')+':'+Math.round(offset*1e5);
  return{normal,offset,key};
}
function polygonSide(points,plane){
  let side=0;
  for(const point of points){const distance=dot3(plane.normal,point)-plane.offset;side|=distance>PLANE_EPS?1:distance<-PLANE_EPS?2:0;if(side===3)break;}
  return side;
}
function partitionPlane(polygons,spend){
  spend(polygons.length);
  const counts=new Map();
  for(const polygon of polygons){const plane=polygon.face.plane,entry=counts.get(plane.key);if(entry)entry.count++;else counts.set(plane.key,{plane,count:1});}
  if(counts.size===1)return polygons[0].face.plane;
  const candidates=new Map([...counts.values()].sort((a,b)=>b.count-a.count).slice(0,4).map(entry=>[entry.plane.key,entry.plane]));
  for(let i=0;i<12;i++){const plane=polygons[Math.floor(i*(polygons.length-1)/11)].face.plane;candidates.set(plane.key,plane);}
  let best=null,bestCost=Infinity;
  for(const plane of candidates.values()){
    spend(polygons.length);
    let front=0,back=0,split=0,coplanar=0;
    for(const polygon of polygons){const side=polygonSide(polygon.points,plane);if(side===3)split++;else if(side===1)front++;else if(side===2)back++;else coplanar++;}
    const cost=split*8+Math.abs(front-back)*.3-coplanar*.8;
    if(cost<bestCost){bestCost=cost;best=plane;}
  }
  return best;
}
function splitPolygon(polygon,plane){
  const front=[],back=[],points=polygon.points,distances=points.map(point=>dot3(plane.normal,point)-plane.offset);
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],da=distances[i],db=distances[(i+1)%points.length];
    if(da>=-PLANE_EPS)front.push(a);if(da<=PLANE_EPS)back.push(a);
    if((da>PLANE_EPS&&db<-PLANE_EPS)||(da<-PLANE_EPS&&db>PLANE_EPS)){
      const t=da/(da-db),point=a.map((value,c)=>value+(b[c]-value)*t);front.push(point);back.push(point);
    }
  }
  const clean=vertices=>vertices.filter((point,i)=>Math.hypot(...point.map((value,c)=>value-vertices[(i+vertices.length-1)%vertices.length][c]))>1e-8);
  const valid=points=>{
    if(points.length<3)return false;
    const origin=points[0],sum=[0,0,0];
    for(let i=1;i<points.length-1;i++){
      const a=points[i].map((value,c)=>value-origin[c]),b=points[i+1].map((value,c)=>value-origin[c]);
      sum[0]+=a[1]*b[2]-a[2]*b[1];sum[1]+=a[2]*b[0]-a[0]*b[2];sum[2]+=a[0]*b[1]-a[1]*b[0];
    }
    return Math.hypot(...sum)>1e-10;
  };
  return[front,back].map(clean).map(points=>({...polygon,points:valid(points)?points:[]}));
}
function buildPainterTree(modules){
  const polygons=modules.flatMap(module=>module.faces.map(face=>({face,module,points:face.points}))),nodes=[];
  if(!polygons.length)return{nodes,root:-1,fragments:0};
  if(polygons.length>PREVIEW_BUDGET.faces)throw budgetError();
  const limit=Math.min(PREVIEW_BUDGET.fragments,polygons.length*16);let fragments=polygons.length,planeTests=0;
  const spend=count=>{planeTests+=count;if(planeTests>PREVIEW_BUDGET.planeTests)throw budgetError();};
  const pending=[{polygons,parent:-1,branch:null}];
  // Build and traverse iteratively: a difficult contour cannot exhaust the JS stack.
  while(pending.length){
    const task=pending.pop(),plane=partitionPlane(task.polygons,spend),index=nodes.length,node={plane,polygons:[],front:-1,back:-1};
    nodes.push(node);if(task.parent>=0)nodes[task.parent][task.branch]=index;
    const front=[],back=[];
    spend(task.polygons.length);
    for(const polygon of task.polygons){
      const side=polygonSide(polygon.points,plane);
      if(side===0)node.polygons.push(polygon);else if(side===1)front.push(polygon);else if(side===2)back.push(polygon);else{
        const [a,b]=splitPolygon(polygon,plane);if(a.points.length>=3)front.push(a);if(b.points.length>=3)back.push(b);
        if(++fragments>limit)throw budgetError();
      }
    }
    if(nodes.length>PREVIEW_BUDGET.nodes)throw budgetError();
    if(front.length)pending.push({polygons:front,parent:index,branch:'front'});
    if(back.length)pending.push({polygons:back,parent:index,branch:'back'});
  }
  return{nodes,root:0,fragments,planeTests};
}
function painterFaces(tree,towards){
  const faces=[],stack=tree.root<0?[]:[tree.root];
  while(stack.length){
    const item=stack.pop();
    if(item<0){
      for(const polygon of tree.nodes[~item].polygons){const facing=dot3(polygon.face.normal,towards);if(facing>1e-7)faces.push({...polygon,facing});}
      continue;
    }
    const node=tree.nodes[item],front=dot3(node.plane.normal,towards)>=0,near=front?node.front:node.back,far=front?node.back:node.front;
    if(near>=0)stack.push(near);stack.push(~item);if(far>=0)stack.push(far);
  }
  return faces;
}

export function createCamera3D(){return{yaw:Math.PI/4,pitch:.55,zoom:1,panX:0,panY:0};}
export function normalizeCamera3D(camera={}){
  const source=camera||{},defaults=createCamera3D(),yaw=finite(source.yaw,defaults.yaw);
  return{yaw:yaw>=-Math.PI&&yaw<Math.PI?yaw:((yaw+Math.PI)%TAU+TAU)%TAU-Math.PI,pitch:clamp(finite(source.pitch,defaults.pitch),-PITCH_LIMIT,PITCH_LIMIT),zoom:clamp(finite(source.zoom,1),.2,10),panX:clamp(finite(source.panX,0),-1e7,1e7),panY:clamp(finite(source.panY,0),-1e7,1e7)};
}
function viewportSize(viewport){
  return{width:clamp(finite(viewport?.width,1000)>0?finite(viewport?.width,1000):1000,1,32768),height:clamp(finite(viewport?.height,600)>0?finite(viewport?.height,600):600,1,32768)};
}
function boxCorners(x,y,width,height,bottom,top){
  return[[x,y,bottom],[x+width,y,bottom],[x+width,y+height,bottom],[x,y+height,bottom],[x,y,top],[x+width,y,top],[x+width,y+height,top],[x,y+height,top]];
}
function moduleWire(module,grid,bottom,top){
  const outline=moduleOutline(module,grid),count=outline.length;
  const points=[...outline.map(p=>[p.x,p.y,bottom]),...outline.map(p=>[p.x,p.y,top])],edges=[];
  for(let i=0;i<count;i++){const next=(i+1)%count;edges.push([i,next],[i+count,next+count],[i,i+count]);}
  return{points,edges};
}
// A display reference needs neither polygon cleaning nor pocket offsets. Scan
// once for the rotated origin, then retain a bounded sample of measured points.
function toolReference(tool,maxPoints){
  const points=Array.isArray(tool.points)?tool.points:[];
  if(points.length<3)return[];
  const angle=finite(tool.rotation,0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  let minX=Infinity,minY=Infinity;
  for(const point of points){const x=finite(point.x,0),y=finite(point.y,0);minX=Math.min(minX,x*c-y*s);minY=Math.min(minY,x*s+y*c);}
  const result=[],stride=Math.max(1,Math.ceil(points.length/maxPoints));
  for(let i=0;i<points.length;i+=stride){const x=finite(points[i].x,0),y=finite(points[i].y,0);result.push({x:x*c-y*s-minX+finite(tool.x,0),y:x*s+y*c-minY+finite(tool.y,0)});}
  return result;
}
// The baseplate is a placement reference. Manufacturing STL retains the complete socket profile.
function baseplateReference(layout){
  const rounded=(x,y,w,h,r,z)=>[[x+w-r,y,z],[x+w,y+r,z],[x+w,y+h-r,z],[x+w-r,y+h,z],[x+r,y+h,z],[x,y+h-r,z],[x,y+r,z],[x+r,y,z]];
  const bottom=-layout.footOffsetZ,top=layout.heightMm-layout.footOffsetZ;
  const outerBottom=rounded(0,0,layout.width,layout.height,4,bottom),outerTop=rounded(0,0,layout.width,layout.height,4,top),sockets=[];
  const [,,bottomRadius]=BASEPLATE_SOCKET_LEVELS[0],bottomSize=BASEPLATE_SOCKET_LEVELS[0][1],topSize=BASEPLATE_SOCKET_LEVELS.at(-1)[1],topRadius=BASEPLATE_SOCKET_LEVELS.at(-1)[2];
  for(let y=0;y<layout.rows;y++)for(let x=0;x<layout.columns;x++)sockets.push({bottom:rounded(x*42+(42-bottomSize)/2,y*42+(42-bottomSize)/2,bottomSize,bottomSize,bottomRadius,bottom),top:rounded(x*42+(42-topSize)/2,y*42+(42-topSize)/2,topSize,topSize,topRadius,top)});
  if(layout.columns*layout.rows>64){
    const points=[...outerBottom,...outerTop],edges=[];
    for(let i=0;i<8;i++)edges.push([i,(i+1)%8],[i+8,(i+1)%8+8],[i,i+8]);
    for(const socket of sockets){const start=points.length;points.push(...socket.top);for(let i=0;i<8;i++)edges.push([start+i,start+(i+1)%8]);}
    return{points,edges,triangles:[]};
  }
  const triangles=[];
  const loft=(a,b,inward=false)=>{for(let i=0;i<a.length;i++){const j=(i+1)%a.length;if(inward)triangles.push([a[j],a[i],b[i]],[a[j],b[i],b[j]]);else triangles.push([a[i],a[j],b[j]],[a[i],b[j],b[i]]);}};
  const cap=(outer,holes,up)=>{
    const vertices=[...outer,...holes.flat()],data=vertices.flatMap(p=>p.slice(0,2)),indexes=[];let cursor=outer.length;
    for(const hole of holes){indexes.push(cursor);cursor+=hole.length;}const faces=earcut(data,indexes,2);
    for(let i=0;i<faces.length;i+=3){const a=vertices[faces[i]],b=vertices[faces[i+1]],c=vertices[faces[i+2]],ccw=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0;triangles.push(ccw===up?[a,b,c]:[a,c,b]);}
  };
  cap(outerBottom,sockets.map(s=>s.bottom),false);cap(outerTop,sockets.map(s=>s.top),true);loft(outerBottom,outerTop);for(const socket of sockets)loft(socket.bottom,socket.top,true);
  return{points:[],edges:[],triangles};
}
const drawerSize=project=>({width:clamp(finite(project.width,504)>0?finite(project.width,504):504,1,1000000),height:clamp(finite(project.height,378)>0?finite(project.height,378):378,1,1000000)});
const moduleTop=project=>clamp(finite(project.insertHeight,20),1,200)+(project.bottomMode==='grid'?4.75:0);
/** Outline of a module that has no mesh yet or cannot have one. */
export function modulePreviewWire(project,module){
  const {height}=drawerSize(project),physical=([x,y,z])=>[x,height-y,z],top=moduleTop(project);
  try{const wire=moduleWire(module,finite(project.grid,42),0,top);return{wire:wire.points.map(physical),wireEdges:wire.edges};}
  catch{
    const x=clamp(finite(module.x,0),-1e6,1e6),y=clamp(finite(module.y,0),-1e6,1e6),w=clamp(Math.abs(finite(module.width,42)),1,6000),h=clamp(Math.abs(finite(module.height,42)),1,6000);
    return{wire:boxCorners(x,y,w,h,0,top).map(physical)};
  }
}
/** Framing from the layout alone, so it stays still while the meshes arrive. */
export function boundsFor(project){
  const {width,height}=drawerSize(project),physical=([x,y,z])=>[x,height-y,z],reference=[[0,0,0],[width,0,0],[width,height,0],[0,height,0]].map(physical);
  const points=[...reference],top=moduleTop(project);
  for(const module of Array.isArray(project.modules)?project.modules:[])points.push(...modulePreviewWire(project,module).wire);
  if(!project.modules?.length)points.push([0,0,top]);
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const point of points)for(let c=0;c<3;c++){min[c]=Math.min(min[c],point[c]);max[c]=Math.max(max[c],point[c]);}
  if(project.bottomMode==='grid')min[2]=Math.min(min[2],-4.75);
  const center=min.map((value,c)=>(value+max[c])/2),radius=Math.hypot(...min.map((value,c)=>(max[c]-value)/2));
  return{reference,center,fitSize:Math.max(20,radius*2)*1.1};
}
export function labelNotes(project,skippedLabels){
  const tools=Array.isArray(project.tools)?project.tools:[];
  return skippedLabels.map(skipped=>{const tool=tools.find(tool=>tool.id===skipped.toolId);return t('Popisek „{name}“: {reason}',{name:tool?.name||skipped.text||skipped.toolId,reason:t(SIZE_LABEL_REASONS[skipped.reason])});});
}
export function sceneNotes(project,{labels=true}={}){
  const sourceModules=Array.isArray(project.modules)?project.modules:[],tools=Array.isArray(project.tools)?project.tools:[];
  const warnings=labels?labelNotes(project,planSizeLabels(project,sourceModules,tools).skipped):[];
  if(!sourceModules.length)warnings.push('Sestava zatím nemá moduly.');
  const moduleIds=new Set(sourceModules.map(module=>module.id)),unplaced=tools.filter(tool=>!moduleIds.has(tool.moduleId)).length;
  if(unplaced)warnings.push(`Nástroje čekající na umístění: ${unplaced}.`);
  return warnings;
}
export function baseplateEntry(project){
  const {height}=drawerSize(project),physical=([x,y,z])=>[x,height-y,z],layout=gridfinityLayout(project),entry={id:'__gridfinity-baseplate',name:t('Podkladová mřížka'),baseplate:true,faces:[],wire:null,source:{x:0,y:0,width:layout.width,height:layout.height}};
  let warning=null;
  if(layout.columns*layout.rows>GRIDFINITY_BASEPLATE.maxCells){
    entry.wire=boxCorners(0,0,layout.width,layout.height,-layout.footOffsetZ,layout.heightMm-layout.footOffsetZ).map(physical);
    warning=t('Podkladová mřížka má více než 400 polí. Náhled ukazuje její obrys; STL exportujte po dílech.');
  }else{
    const reference=baseplateReference(layout);
    if(reference.points.length){entry.wire=reference.points.map(physical);entry.wireEdges=reference.edges;}
    for(const [index,points] of layoutMeshToPhysical(reference.triangles,height).entries()){
      const plane=facePlane(points);
      const [a,b,c]=points,u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal);
      entry.faces.push({index,points,normal:normal.map(n=>n/length),plane});
    }
  }
  return{entry,warning};
}
function sceneFor(project){
  const key=previewGeometryKey(project);
  if(cached&&key===cacheKey)return cached;
  const {width,height}=drawerSize(project);
  // The editor keeps Y down. Every scene coordinate uses the physical STL frame:
  // X right, Y up and Z up, with the drawer's lower-left corner at (0,0).
  const physical=([x,y,z])=>[x,height-y,z];
  const reference=[[0,0,0],[width,0,0],[width,height,0],[0,height,0]].map(physical),modules=[],warnings=[],allPoints=[...reference];
  const sourceModules=Array.isArray(project.modules)?project.modules:[],tools=Array.isArray(project.tools)?project.tools:[];
  const sourcePoints=tools.reduce((sum,tool)=>sum+(tool.points?.length||0),0),cellCount=sourceModules.reduce((sum,module)=>sum+(module.cells?.length||0),0);
  let reducedDetail=tools.length>PREVIEW_BUDGET.tools||sourcePoints>PREVIEW_BUDGET.points||sourceModules.length>PREVIEW_BUDGET.modules||cellCount>16000;
  if(reducedDetail)warnings.push(previewBudgetMessage());
  warnings.push(...sceneNotes(project,{labels:!reducedDetail}));
  let batch=null,batchError=null,printParts=0,generatedFacets=0;
  if(!reducedDetail&&usesPrintParts(project)){
    try{
      batch=previewBatch(project);
      if(batch.jointPlan?.unjoined.length)warnings.push(t('Na {n} vnitřních hranách mezi díly není bezpečné místo pro spojku. Podrobnosti jsou v assembly.json.',{n:batch.jointPlan.unjoined.length}));
    }catch(error){batchError=error;}
  }
  for(const module of sourceModules){
    const entry={id:module.id,name:module.name||'Modul',faces:[],wire:null,toolWires:[]};
    const reference=()=>{
      const top=clamp(finite(project.insertHeight,20),1,200)+(project.bottomMode==='grid'?4.75:0);
      try{if(cellCount>16000)throw budgetError();const wire=moduleWire(module,finite(project.grid,42),0,top);entry.wire=wire.points.map(physical);entry.wireEdges=wire.edges;}
      catch{entry.wire=boxCorners(finite(module.x,0),finite(module.y,0),Math.max(1,finite(module.width,42)),Math.max(1,finite(module.height,42)),0,top).map(physical);}
      entry.previewOnly=true;allPoints.push(...entry.wire);
      const maxPoints=Math.max(12,Math.min(128,Math.floor(PREVIEW_BUDGET.wirePoints/Math.max(1,tools.length))));
      for(const tool of tools.filter(tool=>tool.moduleId===module.id))try{
        const points=toolReference(tool,maxPoints).map(point=>physical([point.x,point.y,top]));
        if(points.length>2){entry.toolWires.push(points);allPoints.push(...points);}
      }catch{}
    };
    if(reducedDetail){reference();modules.push(entry);continue;}
    try{
      if(batchError)throw batchError;
      const append=(bytes,matrix,partKey=null,zone='body')=>{
        const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(80,true);
        if(generatedFacets+entry.faces.length+count>PREVIEW_BUDGET.faces)throw budgetError();
        const transform=(p,translate)=>[0,1,2].map(axis=>matrix[axis*4]*p[0]+matrix[axis*4+1]*p[1]+matrix[axis*4+2]*p[2]+(translate?matrix[axis*4+3]:0));
        // Encode/decode the shared part mesh so these are the exact Float32 STL
        // vertices and normals, not an independent visual approximation.
        for(let i=0;i<count;i++){
          const offset=84+i*50,normal=transform([0,1,2].map(c=>view.getFloat32(offset+c*4,true)),false);
          const points=[0,1,2].map(j=>transform([0,1,2].map(c=>view.getFloat32(offset+12+j*12+c*4,true)),true));
          if(!normal.every(Number.isFinite)||!points.every(p=>p.every(Number.isFinite)))throw Error('Síť obsahuje neplatné souřadnice.');
          entry.faces.push({index:entry.faces.length,normal,points,plane:facePlane(points),partKey,zone});
        }
      };
      const parts=moduleParts(project,module,tools,batch);
      for(const part of parts)append(part.bytes,part.matrix,part.partKey,part.zone);
      const partCount=new Set(parts.map(part=>part.partKey)).size;
      if(!entry.faces.length)throw Error('Modul nemá platnou síť pro náhled.');
      printParts+=partCount;generatedFacets+=entry.faces.length;
      for(const face of entry.faces)for(const point of face.points)allPoints.push(point);
    }catch(error){
      entry.faces=[];
      if(error?.previewBudget){reducedDetail=true;if(!warnings.includes(error.message))warnings.push(error.message);reference();modules.push(entry);continue;}
      const wire=modulePreviewWire(project,module);entry.wire=wire.wire;if(wire.wireEdges)entry.wireEdges=wire.wireEdges;allPoints.push(...entry.wire);
      warnings.push(`${entry.name}: ${error?.message||'Modul nelze zobrazit jako výrobní síť.'}`);
    }
    modules.push(entry);
  }
  if(project.bottomMode==='grid'){
    try{
      const {entry,warning}=baseplateEntry(project);if(warning)warnings.push(warning);
      if(entry.wire)for(const point of entry.wire)allPoints.push(point);else for(const face of entry.faces)for(const point of face.points)allPoints.push(point);modules.push(entry);
    }catch(error){warnings.push(t('Podkladovou mřížku nelze zobrazit: {error}',{error:error?.message||String(error)}));}
  }
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const point of allPoints)for(let c=0;c<3;c++){min[c]=Math.min(min[c],point[c]);max[c]=Math.max(max[c],point[c]);}
  const center=min.map((value,c)=>(value+max[c])/2),radius=Math.hypot(...min.map((value,c)=>(max[c]-value)/2));
  let painter;
  try{painter=buildPainterTree(modules);}catch(error){
    painter={nodes:[],root:-1,fragments:0};warnings.push(error.message);
    reducedDetail=true;
    for(const module of modules.filter(module=>!module.wire)){
      module.previewOnly=true;
      const coordinates=module.faces.flatMap(face=>face.points),low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
      for(const point of coordinates)for(let c=0;c<3;c++){low[c]=Math.min(low[c],point[c]);high[c]=Math.max(high[c],point[c]);}
      const source=module.source||sourceModules.find(item=>item.id===module.id);
      try{const wire=moduleWire(source,finite(project.grid,42),low[2],high[2]);module.wire=wire.points.map(physical);module.wireEdges=wire.edges;}
      catch{module.wire=boxCorners(low[0],low[1],high[0]-low[0],high[1]-low[1],low[2],high[2]);}
      module.faces=[];
    }
  }
  cached={modules,warnings,reference,center,painter,reducedDetail,printParts,joints:batch?.jointPlan?.joints.length||0,fitSize:Math.max(20,radius*2)*1.1,triangles:modules.reduce((sum,module)=>sum+module.faces.length,0),revision:++meshRevision};cacheKey=key;
  return cached;
}

/** Camera basis and view box. The SVG and WebGL views must agree on these exactly. */
export function previewFrame(fitSize,camera,viewport){
  const state=normalizeCamera3D(camera),size=viewportSize(viewport),aspect=size.width/size.height;
  const width=fitSize*Math.max(1,aspect)/state.zoom,height=fitSize*Math.max(1,1/aspect)/state.zoom;
  const viewBounds={x:state.panX-width/2,y:state.panY-height/2,width,height};
  const cy=Math.cos(state.yaw),sy=Math.sin(state.yaw),cp=Math.cos(state.pitch),sp=Math.sin(state.pitch);
  // Screen Y points down, so right × down must point away from the viewer.
  // Use a right-handed camera: the preview must have the same chirality as the STL.
  const towards=[-sy*cp,-cy*cp,sp],right=[cy,-sy,0],down=[-sy*sp,-cy*sp,-cp];
  const project=center=>point=>{const p=point.map((value,c)=>value-center[c]);return{x:dot3(p,right),y:dot3(p,down)};};
  return{state,size,width,height,viewBounds,towards,right,down,project,viewBox:`${viewBounds.x} ${viewBounds.y} ${width} ${height}`};
}
export function wirePath(module,projectPoint){
  const edges=module.wireEdges||[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  return edges.map(([a,b])=>{const p=projectPoint(module.wire[a]),q=projectPoint(module.wire[b]);return`M${p.x.toFixed(3)} ${p.y.toFixed(3)}L${q.x.toFixed(3)} ${q.y.toFixed(3)}`;}).join('');
}
export function previewHud(project,frame,warnings){
  const font=frame.height/70,x=frame.state.panX,y=frame.state.panY+frame.height/2-font;
  let html=`<text data-preview-hud="true" x="${x}" y="${y}" text-anchor="middle" font-size="${font}" fill="#6f805e">${esc(t('Skutečná geometrie STL · {mode}',{mode:t(project.printMode==='light'?'úsporný tisk':'plný blok')}))}</text>`;
  if(warnings.length)html+=`<text data-preview-warning="true" x="${x}" y="${y-font*1.5}" text-anchor="middle" font-size="${font}" fill="#9c5f43">${esc(warnings[0])}${warnings.length>1?` (+${warnings.length-1})`:''}</text>`;
  return html;
}

/** Orthographic orbit of the actual STL; framing is independent of yaw/pitch. */
export function printPreview(project,selected,selectedModule,camera={},viewport={width:1000,height:600},selectedToolIds=[]){
  project=project||{};
  const scene=sceneFor(project),frame=previewFrame(scene.fitSize,camera,viewport),{state,size,width,height,viewBounds,towards}=frame;
  const dot=dot3,projectPoint=frame.project(scene.center);
  const polygon=points=>points.map(point=>{const p=projectPoint(point);return`${p.x.toFixed(3)},${p.y.toFixed(3)}`;}).join(' ');
  const tools=Array.isArray(project.tools)?project.tools:[];
  const selectedTools=new Set(selectedToolIds),activeIds=new Set([selectedModule,...tools.filter(tool=>tool.id===selected||selectedTools.has(tool.id)).map(tool=>tool.moduleId)]);
  const key=JSON.stringify([scene.revision,state.yaw,state.pitch,[...activeIds].sort(),materialConfig(project)]);
  let html,visibleFaces,viewReduced=scene.reducedDetail;
  if(key===projectionKey){html=projectionHTML;visibleFaces=projectionFaces;viewReduced=projectionReduced;}
  else{
    let faces=painterFaces(scene.painter,towards);
    // Keep the drawer reference behind the mesh, including views from underneath.
    html=`<polygon data-reference="drawer" points="${polygon(scene.reference)}" fill="#eef3e8" fill-opacity=".5" stroke="#b9c9a8" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    const wireLines=module=>wirePath(module,projectPoint);
    // A wire reference belongs below the opaque tool modules, so socket lines do not show through their tops.
    for(const module of scene.modules.filter(module=>module.wire&&module.baseplate))html+=`<g data-baseplate="true" aria-label="${esc(module.name)}"><path d="${wireLines(module)}" fill="none" stroke="#718d91" stroke-width="1.2" stroke-dasharray="5 3" vector-effect="non-scaling-stroke"/></g>`;
    const sun=[-.35,-.45,.82],colors=materialConfig(project),zoneColor={body:colors.bodyColor,floor:colors.floorColor,text:colors.textColor};
    const referenceHTML=html;let overflow=faces.length>10000;
    // Same-color subpixel overlap seals antialias cracks between render fragments.
    for(const {face,module,facing,points} of overflow?[]:faces){
      const light=clamp(42+Math.max(0,dot(face.normal,sun))*22+facing*15,40,82),zone=colors.enabled&&!module.baseplate?face.zone:null,color=module.baseplate?`hsl(185 13% ${light.toFixed(1)}%)`:zone&&(zone!=='body'||!activeIds.has(module.id))?shade(zoneColor[zone],light):activeIds.has(module.id)?`hsl(39 47% ${light.toFixed(1)}%)`:`hsl(88 23% ${light.toFixed(1)}%)`;
      const attributes=module.baseplate?'data-baseplate="true"':`data-module="${esc(module.id)}"`;
      const partAttribute=face.partKey?` data-print-part="${esc(face.partKey)}"`:'';
      const markup=`<polygon ${attributes} data-face-index="${face.index}" points="${polygon(points)}" fill="${color}" stroke="${color}" stroke-width=".6" vector-effect="non-scaling-stroke" aria-label="${esc(module.name)}"${partAttribute}${module.baseplate?'':` data-module-selected="${activeIds.has(module.id)}"`}/>`;
      if(html.length+markup.length>PREVIEW_BUDGET.htmlBytes-100000){overflow=true;break;}html+=markup;
    }
    let wireModules=scene.modules.filter(module=>module.wire&&!module.baseplate);
    if(overflow){
    html=referenceHTML;faces=[];viewReduced=true;
      wireModules=scene.modules.filter(module=>!module.baseplate).map(module=>{
        if(module.wire)return module;
        const source=module.source||(project.modules||[]).find(item=>item.id===module.id),points=module.faces.flatMap(face=>face.points);
        let bottom=Infinity,top=-Infinity;for(const point of points){bottom=Math.min(bottom,point[2]);top=Math.max(top,point[2]);}
        try{const wire=moduleWire(source,finite(project.grid,42),bottom,top);return {...module,previewOnly:true,wire:wire.points.map(([x,y,z])=>[x,finite(project.height,378)-y,z]),wireEdges:wire.edges};}
        catch{return {...module,previewOnly:true,wire:boxCorners(0,0,finite(project.width,504),finite(project.height,378),0,finite(project.insertHeight,20))};}
      });
    }
    for(const module of wireModules){
      const color=activeIds.has(module.id)?'#bf8d35':module.previewOnly?'#718565':'#b56c52';
      html+=`<g data-module="${esc(module.id)}" ${module.previewOnly?'data-simplified-module="true"':'data-invalid-module="true"'} role="button" tabindex="0" aria-label="${esc(module.name)}${module.previewOnly?'':' — neplatný modul'}" data-module-selected="${activeIds.has(module.id)}"><path d="${wireLines(module)}" fill="none" stroke="${color}" stroke-width="1.2" stroke-dasharray="5 3" vector-effect="non-scaling-stroke"/>${(module.toolWires||[]).map(points=>`<polygon data-preview-tool="true" points="${polygon(points)}" fill="none" stroke="${color}" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('')}</g>`;
    }

    visibleFaces=faces.length;projectionKey=key;projectionHTML=html;projectionFaces=visibleFaces;projectionReduced=viewReduced;projectionRevision++;
  }
  const font=height/70,hudX=state.panX,hudY=state.panY+height/2-font;
  html+=`<text data-preview-hud="true" x="${hudX}" y="${hudY}" text-anchor="middle" font-size="${font}" fill="#6f805e">${esc(viewReduced?t('Rychlý obrysový náhled · výrobní model se nemění'):t('Skutečná geometrie STL · {mode}',{mode:t(project.printMode==='light'?'úsporný tisk':'plný blok')}))}</text>`;
  const warnings=[...scene.warnings];if(viewReduced&&!warnings.includes(previewBudgetMessage()))warnings.push(previewBudgetMessage());
  if(warnings.length)html+=`<text data-preview-warning="true" x="${hudX}" y="${hudY-font*1.5}" text-anchor="middle" font-size="${font}" fill="#9c5f43">${esc(warnings[0])}${warnings.length>1?` (+${warnings.length-1})`:''}</text>`;
  return{html,viewBox:`${viewBounds.x} ${viewBounds.y} ${width} ${height}`,viewBounds,camera:state,frame:{width,height,fitSize:scene.fitSize,center:[...scene.center],viewport:size},warnings,stats:{triangles:scene.triangles,visibleFaces,meshRevision:scene.revision,projectionRevision,invalidModules:scene.modules.filter(module=>module.wire&&!module.baseplate&&!module.previewOnly).length,reducedDetail:viewReduced,painterFragments:scene.painter.fragments,printParts:scene.reducedDetail?null:scene.printParts,joints:scene.reducedDetail?null:scene.joints}};
}
