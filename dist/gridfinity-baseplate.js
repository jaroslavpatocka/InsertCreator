import earcut from './vendor/earcut.js';
import {encodeSTL,validatePrintMesh} from './print-geometry.js';
import {i18nError} from './i18n.js';
import {fmtSize} from './units.js';
import {layoutMeshToPhysical} from './manufacturing-coordinates.js';

// Reference geometry, independently implemented:
// https://github.com/kennetek/gridfinity-rebuilt-openscad/blob/main/src/core/gridfinity-baseplate.scad
// https://github.com/gridfinity-unofficial/specification
// The last 0.1 mm retains a finite wall instead of joining openings at a zero-thickness edge.
export const GRIDFINITY_BASEPLATE=Object.freeze({pitch:42,height:5,footOffsetZ:.25,maxCells:400,segmentsPerCorner:8});
export const BASEPLATE_SOCKET_LEVELS=Object.freeze([
  [0,36.3,1.15],[.35,36.3,1.15],[1.05,37.7,1.85],[2.85,37.7,1.85],[4.9,41.8,3.9],[5,41.8,3.9]
].map(Object.freeze));
const round=value=>Math.round(value*10000)/10000;
function roundedRectangle(width,height,radius){
  const result=[];
  for(const [cx,cy,start] of [[width-radius,radius,-Math.PI/2],[width-radius,height-radius,0],[radius,height-radius,Math.PI/2],[radius,radius,Math.PI]]){
    for(let i=0;i<=GRIDFINITY_BASEPLATE.segmentsPerCorner;i++){const angle=start+i*Math.PI/(2*GRIDFINITY_BASEPLATE.segmentsPerCorner);result.push([round(cx+Math.cos(angle)*radius),round(cy+Math.sin(angle)*radius)]);}
  }
  return result;
}
// Fixed, bounded tessellation is shared by every socket. Returned mesh vertices are separate.
const socketProfiles=BASEPLATE_SOCKET_LEVELS.map(([,size,radius])=>roundedRectangle(size,size,radius).map(([x,y])=>Object.freeze([round(x+(42-size)/2),round(y+(42-size)/2)])));

/** Grid begins at drawer origin, matching module feet. Remainders stay at the right and bottom. */
export function gridfinityLayout(project){
  const width=project?.width,height=project?.height;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<42||height<42||width>3000||height>3000)throw i18nError('Pro podkladovou mřížku zadejte platné rozměry šuplíku od 42 do 3000 mm.');
  if(project.grid!==undefined&&(!Number.isFinite(project.grid)||Math.abs(project.grid-42)>.001))throw i18nError('Gridfinity patky vyžadují rastr přesně 42 mm.');
  const columns=Math.floor((width+1e-7)/42),rows=Math.floor((height+1e-7)/42);
  return {columns,rows,width:columns*42,height:rows*42,pitch:42,heightMm:5,footOffsetZ:.25,x:0,y:0,remainder:{right:Math.max(0,round(width-columns*42)),bottom:Math.max(0,round(height-rows*42))}};
}

/** Printer dimensions affect only this export plan, never the layout or module editing. */
export function planBaseplateTiles(project,{bedWidth=project?.bedWidth,bedHeight=project?.bedHeight,checkBed=project?.limitToBed}={}){
  const layout=gridfinityLayout(project);let columns=20,rows=20,rotated=false;
  if(checkBed){
    if(!Number.isFinite(bedWidth)||!Number.isFinite(bedHeight)||bedWidth<=0||bedHeight<=0)throw i18nError('Zadejte kladné rozměry tiskové plochy.');
    const across=Math.floor((bedWidth+1e-7)/42),down=Math.floor((bedHeight+1e-7)/42);
    if(across<1||down<1)throw i18nError('Podkladová mřížka potřebuje tiskovou plochu alespoň {size}.',{size:fmtSize(42,42)});
    let best=null;
    for(const rotate of [false,true]){
      const maxColumns=Math.min(layout.columns,rotate?down:across,400),maxRows=Math.min(layout.rows,rotate?across:down,400);
      for(let c=1;c<=maxColumns;c++){
        const r=Math.min(maxRows,Math.floor(400/c)),count=Math.ceil(layout.columns/c)*Math.ceil(layout.rows/r),area=c*r;
        if(!best||count<best.count||count===best.count&&area>best.area)best={columns:c,rows:r,rotated:rotate,count,area};
      }
    }
    ({columns,rows,rotated}=best);
  }
  const tiles=[];
  for(let y=0;y<layout.rows;y+=rows)for(let x=0;x<layout.columns;x+=columns)tiles.push({x,y,columns:Math.min(columns,layout.columns-x),rows:Math.min(rows,layout.rows-y)});
  return {layout,tiles,rotated};
}

function resolveTile(project,tile){
  const layout=gridfinityLayout(project),result=tile??{x:0,y:0,columns:layout.columns,rows:layout.rows};
  if(!result||![result.x,result.y,result.columns,result.rows].every(Number.isInteger)||result.x<0||result.y<0||result.columns<1||result.rows<1||result.x+result.columns>layout.columns||result.y+result.rows>layout.rows)throw i18nError('Díl podkladové mřížky musí obsahovat celá pole uvnitř šuplíku.');
  if(result.columns*result.rows>GRIDFINITY_BASEPLATE.maxCells)throw i18nError('Podkladová mřížka má příliš mnoho polí pro jeden STL. Exportujte ji po dílech nejvýše 400 polí.');
  return result;
}

/** One connected, open-bottom socket plate in local editor (Y-down) coordinates.
 * Tile x/y use cell indices; exportBaseplateSTL converts the mesh to physical Y-up coordinates.
 * Shared vertex arrays in the returned mesh should be treated as read-only. */
export function baseplateTriangles(project,{tile}={}){
  const {columns,rows}=resolveTile(project,tile),width=columns*42,height=rows*42,triangles=[];
  const outer=roundedRectangle(width,height,4),outerBottom=outer.map(([x,y])=>[x,y,0]),outerTop=outer.map(([x,y])=>[x,y,5]);
  const sockets=[];
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++)sockets.push(socketProfiles.map((profile,i)=>profile.map(([px,py])=>[round(px+x*42),round(py+y*42),BASEPLATE_SOCKET_LEVELS[i][0]])));
  function loft(lower,upper,inward=false){
    for(let i=0;i<lower.length;i++){const j=(i+1)%lower.length;
      if(inward)triangles.push([lower[j],lower[i],upper[i]],[lower[j],upper[i],upper[j]]);
      else triangles.push([lower[i],lower[j],upper[j]],[lower[i],upper[j],upper[i]]);
    }
  }
  function cap(outer,holes,up){
    const vertices=[...outer,...holes.flat()],data=vertices.flatMap(([x,y])=>[x,y]),indexes=[];let cursor=outer.length;
    for(const hole of holes){indexes.push(cursor);cursor+=hole.length;}
    const faces=earcut(data,indexes,2);
    for(let i=0;i<faces.length;i+=3){const a=vertices[faces[i]],b=vertices[faces[i+1]],c=vertices[faces[i+2]],ccw=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0;triangles.push(ccw===up?[a,b,c]:[a,c,b]);}
  }
  cap(outerBottom,sockets.map(levels=>levels[0]),false);cap(outerTop,sockets.map(levels=>levels.at(-1)),true);loft(outerBottom,outerTop);
  for(const levels of sockets)for(let i=1;i<levels.length;i++)loft(levels[i-1],levels[i],true);
  validatePrintMesh(triangles);
  return triangles;
}

export function exportBaseplateSTL(project,options={}){
  const {rows}=resolveTile(project,options.tile);
  const triangles=layoutMeshToPhysical(baseplateTriangles(project,options),rows*42);
  validatePrintMesh(triangles);
  return encodeSTL(triangles,'InsertCreator | Gridfinity baseplate | mm');
}
