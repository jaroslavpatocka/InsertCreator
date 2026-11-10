// Turns one module into the exact STL faces of its print parts. Both 3D renderers and the workers use this.
import {exportSTL,validateLayout} from './geometry.js';
import {materialConfig} from './print-material.js';
import {planPrintBatch,buildPrintPart} from './print-batch.js';
import {planSizeLabels} from './size-labels.js';
import {pocketOutline} from './finger-grip.js';
import {encodeSTL} from './print-geometry.js';
import {moduleJointProfiles,omitJointCutSegments} from './preview-joints.js';

const drawerHeight=project=>{const value=Number(project.height);return Number.isFinite(value)&&value>0?Math.min(value,1000000):378;};

export const usesPrintParts=project=>(project.connectors===true&&project.bottomMode!=='grid')||materialConfig(project).enabled||project.previewCuts===true;

/** STL bytes with the matrix that places them in the drawer. */
export function moduleParts(project,module,tools,batch){
  if(!batch)return[{bytes:exportSTL(project,{moduleId:module.id,checkBed:false}),matrix:[1,0,0,module.x,0,1,0,drawerHeight(project)-module.y-module.height,0,0,1,0,0,0,0,1],partKey:null,zone:'body'}];
  const own=tools.filter(tool=>tool.moduleId===module.id),issue=validateLayout({...project,modules:[module],tools:own})[0];if(issue)throw Error(issue.message);
  const prepared=own.map(tool=>({...tool,poly:pocketOutline(tool,project)})),labelPlan=planSizeLabels(project,[module],prepared);
  const plan=batch.plans.find(plan=>plan.module.id===module.id),parts=[];
  for(const tile of plan?.tiles||[]){
    const part=buildPrintPart(project,module,prepared,tile,{labelPlan,jointPlan:batch.jointPlan});if(!part)continue;
    for(const {mesh,zone} of part.zones||[{mesh:part.mesh,zone:'body'}])parts.push({bytes:encodeSTL(mesh),matrix:part.assemblyTransform,partKey:tile.key,zone});
  }
  return parts;
}

const facetCount=bytes=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(80,true);
const ZONES=['body','floor','text'];
// Labels with their own colour add `text:#rrggbb` zones after the fixed ones.
const zonesOf=parts=>[...ZONES,...new Set(parts.map(part=>part.zone).filter(zone=>!ZONES.includes(zone)))];

/** Interleaved position + normal vertices, grouped by colour zone so each zone is one draw call. */
export function packParts(parts){
  const total=parts.reduce((sum,part)=>sum+facetCount(part.bytes),0),vertices=new Float32Array(total*18),ranges=[];let cursor=0;
  for(const zone of zonesOf(parts)){
    const first=cursor/6;
    for(const part of parts.filter(part=>part.zone===zone)){
      const view=new DataView(part.bytes.buffer,part.bytes.byteOffset,part.bytes.byteLength),count=view.getUint32(80,true),m=part.matrix;
      for(let i=0;i<count;i++){
        const offset=84+i*50,nx=view.getFloat32(offset,true),ny=view.getFloat32(offset+4,true),nz=view.getFloat32(offset+8,true);
        const a=m[0]*nx+m[1]*ny+m[2]*nz,b=m[4]*nx+m[5]*ny+m[6]*nz,c=m[8]*nx+m[9]*ny+m[10]*nz;
        for(let j=0;j<3;j++){
          const at=offset+12+j*12,x=view.getFloat32(at,true),y=view.getFloat32(at+4,true),z=view.getFloat32(at+8,true);
          vertices[cursor++]=m[0]*x+m[1]*y+m[2]*z+m[3];vertices[cursor++]=m[4]*x+m[5]*y+m[6]*z+m[7];vertices[cursor++]=m[8]*x+m[9]*y+m[10]*z+m[11];
          vertices[cursor++]=a;vertices[cursor++]=b;vertices[cursor++]=c;
        }
      }
    }
    const count=cursor/6-first;if(count)ranges.push({zone,first,count});
  }
  for(const value of vertices)if(!Number.isFinite(value))throw Error('Síť obsahuje neplatné souřadnice.');
  return{vertices,ranges,facets:total};
}

/** Edges where the planned bed cuts meet the real exterior STL surfaces.
 * Keeping these in physical space also puts cuts at the actual pocket floors and
 * thin walls of a material-saving model, rather than at an invented flat top.
 */
export function moduleCutSegments(project,module,parts,batch){
  if(project.previewCuts!==true)return[];
  const tiles=batch?.plans.find(plan=>plan.module.id===module.id)?.tiles||[];
  if(tiles.length<2)return[];
  const planes=new Map(),height=drawerHeight(project),epsilon=.0002;
  for(const tile of tiles){
    const clip=tile.clip;if(!clip)continue;
    if(clip.x>module.x+epsilon)planes.set('x'+clip.x,{axis:0,value:clip.x});
    if(clip.y>module.y+epsilon)planes.set('y'+clip.y,{axis:1,value:height-clip.y});
  }
  const segments=[],seen=new Set();
  for(const part of parts){
    const view=new DataView(part.bytes.buffer,part.bytes.byteOffset,part.bytes.byteLength),m=part.matrix,count=view.getUint32(80,true);
    const transform=(point,translate)=>[0,1,2].map(axis=>m[axis*4]*point[0]+m[axis*4+1]*point[1]+m[axis*4+2]*point[2]+(translate?m[axis*4+3]:0));
    for(let i=0;i<count;i++){
      const at=84+i*50,normal=transform([0,1,2].map(axis=>view.getFloat32(at+axis*4,true)),false);
      const points=[0,1,2].map(j=>transform([0,1,2].map(axis=>view.getFloat32(at+12+j*12+axis*4,true)),true));
      for(const {axis,value} of planes.values()){
        // The newly created vertical cut cap is not an exterior surface.
        if(Math.abs(normal[axis])>.999)continue;
        const edge=points.filter(point=>Math.abs(point[axis]-value)<epsilon);
        if(edge.length!==2||Math.hypot(...edge[0].map((value,c)=>value-edge[1][c]))<epsilon)continue;
        const key=edge.map(point=>point.map(value=>Math.round(value*10000)).join(',')).sort().join('|')+'|'+normal.map(value=>Math.round(value*1000)).join(',');
        if(seen.has(key))continue;seen.add(key);segments.push({points:edge,normal});
      }
    }
  }
  return omitJointCutSegments(segments,moduleJointProfiles(project,module.id,batch,new Set(parts.map(part=>part.partKey))));
}

export function moduleMesh(project,moduleId,batch){
  const tools=Array.isArray(project.tools)?project.tools:[],module=(project.modules||[]).find(item=>item.id===moduleId);
  if(!module)throw Error('Modul nemá platnou síť pro náhled.');
  const parts=moduleParts(project,module,tools,batch),mesh=packParts(parts);
  if(!mesh.facets)throw Error('Modul nemá platnou síť pro náhled.');
  return{...mesh,parts:new Set(parts.map(part=>part.partKey)).size,skippedLabels:planSizeLabels(project,[module],tools).skipped,cuts:moduleCutSegments(project,module,parts,batch),jointProfiles:moduleJointProfiles(project,module.id,batch,new Set(parts.map(part=>part.partKey)))};
}

export function previewBatch(project){
  return usesPrintParts(project)?planPrintBatch(project,Array.isArray(project.modules)?project.modules:[],Array.isArray(project.tools)?project.tools:[]):null;
}

/** Project totals from per-module results, so size limits apply to one module and not to the whole drawer. */
export function mergePrintStats(list){
  if(!list.length)return null;
  const sum=key=>list.reduce((total,item)=>total+item[key],0),volumeMm3=sum('volumeMm3'),solidVolumeMm3=sum('solidVolumeMm3');
  return{...list[0],volumeMm3,volumeCm3:volumeMm3/1000,solidVolumeMm3,savingPercent:solidVolumeMm3?Math.max(0,(1-volumeMm3/solidVolumeMm3)*100):0,heightMm:Math.max(...list.map(item=>item.heightMm)),effectiveBaseMm:Math.max(...list.map(item=>item.effectiveBaseMm)),triangles:sum('triangles'),notes:[...new Set(list.flatMap(item=>item.notes||[]))]};
}
