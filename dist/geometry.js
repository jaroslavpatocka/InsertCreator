import earcut from './vendor/earcut.js';
import Clipper from './vendor/clipper.js';

const EPS = 1e-7;
const copy = value => JSON.parse(JSON.stringify(value));
const n = (value, fallback = 0) => Number.isFinite(+value) ? +value : fallback;
const area = points => points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0) / 2;
const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const close = (a,b) => Math.hypot(a.x-b.x,a.y-b.y)<EPS;
function clean(points) {
  let result = points.map(p => ({x:n(p.x),y:n(p.y)})).filter((p,i,a) => !i || !close(p,a[i-1]));
  if (result.length > 2 && close(result[0],result.at(-1))) result.pop();
  let changed = true;
  while (changed && result.length > 3) {
    changed = false;
    result = result.filter((p,i,a) => { const before=a[(i+a.length-1)%a.length],after=a[(i+1)%a.length],forward=(p.x-before.x)*(after.x-p.x)+(p.y-before.y)*(after.y-p.y); const keep = Math.abs(cross(before,p,after))>EPS||forward<0; if (!keep) changed=true; return keep; });
  }
  return result;
}
function box(points) {
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  const x=Math.min(...xs),y=Math.min(...ys),maxX=Math.max(...xs),maxY=Math.max(...ys);
  return {x,y,minX:x,minY:y,maxX,maxY,width:maxX-x,height:maxY-y};
}
function offsetPolygon(points, distance) {
  if (!distance) return points;
  // Integer clipping joins opposing edges safely when a narrow concavity closes.
  // 1 coordinate unit = 0.0001mm; round corners preserve a true minimum clearance.
  const scale=10000,path=points.map(p=>({X:Math.round(p.x*scale),Y:Math.round(p.y*scale)}));
  const offset=new Clipper.ClipperOffset(2,.015*scale),result=[];
  if(!Clipper.Clipper.Orientation(path))path.reverse();
  offset.AddPath(path,Clipper.JoinType.jtRound,Clipper.EndType.etClosedPolygon);
  offset.Execute(result,distance*scale);
  if(!result.length)return [];
  result.sort((a,b)=>Math.abs(Clipper.Clipper.Area(b))-Math.abs(Clipper.Clipper.Area(a)));
  return clean(result[0].map(p=>({x:p.X/scale,y:p.Y/scale})));
}

/** Rotations are normalized to the top-left of the rotated contour, then x/y are applied. */
export function transformedPoints(tool, clearance=0) {
  const points=clean(tool.points || []);
  if(points.length<3) return [];
  const raw=box(points),r=n(tool.rotation)*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  const rotated=points.map(p=>({x:(p.x-raw.x)*c-(p.y-raw.y)*s,y:(p.x-raw.x)*s+(p.y-raw.y)*c}));
  const b=box(rotated);
  return offsetPolygon(rotated.map(p=>({x:p.x-b.x+n(tool.x),y:p.y-b.y+n(tool.y)})),n(clearance));
}
export function bounds(tool) {
  const p=transformedPoints(tool);
  return p.length ? box(p) : {x:n(tool.x),y:n(tool.y),minX:n(tool.x),minY:n(tool.y),maxX:n(tool.x),maxY:n(tool.y),width:0,height:0};
}
const intersectsRect=(a,b,epsilon=EPS)=>a.x<b.x+b.width-epsilon&&a.x+a.width>b.x+epsilon&&a.y<b.y+b.height-epsilon&&a.y+a.height>b.y+epsilon;
function pointInside(p,poly) {
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const a=poly[i],b=poly[j];
    if(Math.abs(cross(a,b,p))<EPS && p.x>=Math.min(a.x,b.x)-EPS && p.x<=Math.max(a.x,b.x)+EPS && p.y>=Math.min(a.y,b.y)-EPS && p.y<=Math.max(a.y,b.y)+EPS) return true;
    if((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}
function polygonsOverlap(a,b) {
  if(!a.length||!b.length||!intersectsRect(box(a),box(b)))return false;
  for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){
    const p=a[i],q=a[(i+1)%a.length],r=b[j],s=b[(j+1)%b.length];
    if(cross(p,q,r)*cross(p,q,s)<-EPS && cross(r,s,p)*cross(r,s,q)<-EPS)return true;
  }
  return a.some(p=>pointInside(p,b))||b.some(p=>pointInside(p,a));
}
function selfIntersects(p) {
  const on=(a,b,c)=>Math.abs(cross(a,b,c))<EPS&&c.x>=Math.min(a.x,b.x)-EPS&&c.x<=Math.max(a.x,b.x)+EPS&&c.y>=Math.min(a.y,b.y)-EPS&&c.y<=Math.max(a.y,b.y)+EPS;
  for(let i=0;i<p.length;i++)for(let j=i+2;j<p.length;j++){
    if(i===0&&j===p.length-1)continue;
    const a=p[i],b=p[(i+1)%p.length],c=p[j],d=p[(j+1)%p.length];
    if((cross(a,b,c)*cross(a,b,d)<-EPS&&cross(c,d,a)*cross(c,d,b)<-EPS)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))return true;
  }
  return false;
}

/** Deterministic grid packing. Locked modules and every tool inside them stay in place. */
export function autoArrange(project,{preserveLocked=true}={}) {
  const tools=copy(project.tools||[]),oldModules=copy(project.modules||[]),grid=Math.max(1,n(project.grid,42));
  // Fillers are explicit user-created parts, so packing must never discard them.
  const lockedIds=new Set(oldModules.filter(m=>!tools.some(t=>t.moduleId===m.id)||(preserveLocked&&(m.locked||tools.some(t=>t.moduleId===m.id&&t.locked)))).map(m=>m.id));
  const modules=oldModules.filter(m=>lockedIds.has(m.id));
  const reservedTools=new Set(tools.filter(t=>lockedIds.has(t.moduleId)).map(t=>t.id));
  // A fixed tool without a module receives a stationary enclosing module.
  for(const t of tools.filter(t=>preserveLocked&&t.locked&&!reservedTools.has(t.id))){
    const b=bounds(t),padding=n(project.wall,2.4)+n(project.clearance,.8)+.25;
    const x=Math.floor((b.x-padding)/grid)*grid,y=Math.floor((b.y-padding)/grid)*grid;
    const module={id:t.moduleId||`mod-${t.id}`,name:t.name,x,y,width:Math.ceil((b.maxX+padding-x)/grid)*grid,height:Math.ceil((b.maxY+padding-y)/grid)*grid,locked:true};
    t.moduleId=module.id;modules.push(module);reservedTools.add(t.id);
  }
  const padding=Math.max(n(project.wall,2.4),n(project.gap,3)/2)+.25;
  const pending=tools.filter(t=>!reservedTools.has(t.id)).sort((a,b)=>{const x=bounds(a),y=bounds(b);return y.width*y.height-x.width*x.height||String(a.id).localeCompare(String(b.id));});
  const unplaced=[];
  for(const tool of pending){
    const candidates=[];
    for(const rotation of [n(tool.rotation),n(tool.rotation)+90]){
      const b=box(transformedPoints({...tool,x:0,y:0,rotation},n(project.clearance,.8))),width=Math.ceil((b.width+2*padding)/grid)*grid,height=Math.ceil((b.height+2*padding)/grid)*grid;
      if(width>n(project.width)||height>n(project.height))continue;
      for(let y=0;y+height<=n(project.height)+EPS;y+=grid){
        for(let x=0;x+width<=n(project.width)+EPS;x+=grid){
          const candidate={x,y,width,height,rotation,b};
          if(modules.some(m=>intersectsRect(candidate,m)))continue;
          // Prefer a low packed height, then the left edge, then the current rotation.
          candidate.score=(y+height)*100000+x*100+((rotation%360+360)%360!==((n(tool.rotation)%360+360)%360)?1:0);
          candidates.push(candidate);break;
        }
        if(candidates.length&&candidates.at(-1).rotation===rotation)break;
      }
    }
    candidates.sort((a,b)=>a.score-b.score);
    const chosen=candidates[0];
    if(!chosen){tool.moduleId=null;tool.x=n(project.width)+grid;tool.y=unplaced.reduce((y,id)=>y+bounds(tools.find(t=>t.id===id)).height+grid,0);unplaced.push(tool.id);continue;}
    const id=tool.moduleId&&!modules.some(m=>m.id===tool.moduleId)?tool.moduleId:`mod-${tool.id}`;
    const module={id,name:tool.name,x:chosen.x,y:chosen.y,width:chosen.width,height:chosen.height,locked:false};
    modules.push(module);
    tool.moduleId=id;tool.rotation=((chosen.rotation%360)+360)%360;
    tool.x=module.x+(module.width-chosen.b.width)/2-chosen.b.x;tool.y=module.y+(module.height-chosen.b.height)/2-chosen.b.y;
  }
  return {tools,modules,unplaced};
}

export function validateLayout(project) {
  const issues=[],modules=project.modules||[],tools=project.tools||[],clearance=n(project.clearance,.8),height=n(project.insertHeight,20),base=n(project.base,2.4),wall=n(project.wall,2.4);
  if(!(n(project.width)>0&&n(project.height)>0&&height>base&&base>0&&wall>0))issues.push({type:'depth',ids:[],message:'Zkontrolujte rozměry šuplíku, výšku inzertu a tloušťku dna i stěny.'});
  for(let i=0;i<modules.length;i++){
    const m=modules[i];
    if(m.width<=0||m.height<=0||m.x<-.001||m.y<-.001||m.x+m.width>n(project.width)+.001||m.y+m.height>n(project.height)+.001)issues.push({type:'outside',ids:[m.id],message:`Modul „${m.name||m.id}“ přesahuje šuplík.`});
    for(let j=i+1;j<modules.length;j++)if(intersectsRect(m,modules[j],.001))issues.push({type:'overlap',ids:[m.id,modules[j].id],message:`Moduly „${m.name||m.id}“ a „${modules[j].name||modules[j].id}“ se překrývají.`});
  }
  const polygons=new Map();
  for(const t of tools){
    const poly=transformedPoints(t,clearance),m=modules.find(m=>m.id===t.moduleId);polygons.set(t.id,poly);
    const raw=transformedPoints(t);
    if(poly.length<3||Math.abs(area(poly))<EPS||selfIntersects(raw)||selfIntersects(poly))issues.push({type:'overlap',ids:[t.id],message:`Kontura „${t.name}“ se kříží nebo není platná. Upravte konturu či zmenšete vůli.`});
    if(!m)issues.push({type:'outside',ids:[t.id],message:`Nástroj „${t.name}“ zatím nemá umístěný modul.`});
    else if(poly.some(p=>p.x<m.x+wall+.25-.001||p.y<m.y+wall+.25-.001||p.x>m.x+m.width-wall-.25+.001||p.y>m.y+m.height-wall-.25+.001))issues.push({type:'outside',ids:[t.id,m.id],message:`Kolem „${t.name}“ není dost místa na stěnu. Zvětšete modul nebo spusťte rozvržení.`});
    if(!(n(t.depth,10)>0&&n(t.depth,10)<=height-base+.001))issues.push({type:'depth',ids:[t.id],message:`Hloubka kapsy „${t.name}“ musí být větší než 0 a nejvýše ${(height-base).toFixed(1)} mm.`});
  }
  for(let i=0;i<tools.length;i++)for(let j=i+1;j<tools.length;j++)if(polygonsOverlap(polygons.get(tools[i].id),polygons.get(tools[j].id)))issues.push({type:'overlap',ids:[tools[i].id,tools[j].id],message:`Kapsy „${tools[i].name}“ a „${tools[j].name}“ se překrývají.`});
  return issues;
}
function selected(project,moduleId) {
  const modules=(project.modules||[]).filter(m=>!moduleId||m.id===moduleId);
  if(!modules.length)throw new Error('Nejprve umístěte alespoň jeden modul.');
  const ids=new Set(modules.map(m=>m.id)),tools=moduleId?(project.tools||[]).filter(t=>ids.has(t.moduleId)):(project.tools||[]);
  const validation=validateLayout({...project,modules,tools});
  if(validation.length)throw new Error(validation[0].message);
  const origin=moduleId?{x:modules[0].x,y:modules[0].y}:{x:0,y:0};
  return {modules,tools,origin,width:moduleId?modules[0].width:n(project.width),height:moduleId?modules[0].height:n(project.height)};
}
const xml=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const fmt=value=>(Math.round(value*10000)/10000).toString();
const path=points=>points.map((p,i)=>`${i?'L':'M'}${fmt(p.x)},${fmt(p.y)}`).join(' ')+' Z';
export function exportSVG(project,{moduleId=null}={}) {
  const {modules,tools,origin,width,height}=selected(project,moduleId);
  const shift=p=>({x:p.x-origin.x,y:p.y-origin.y});
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}mm" height="${fmt(height)}mm" viewBox="0 0 ${fmt(width)} ${fmt(height)}"><title>${xml(project.name||'Šuplík Studio')}</title><desc>Rozměry v mm. Černá = modul; červená = kapsa včetně vůle ${n(project.clearance,.8)} mm. Ploché dno, rozteč modulů ${n(project.grid,42)} mm.</desc><g id="modules" fill="none" stroke="black" stroke-width="0.15">${modules.map(m=>`<rect x="${fmt(m.x-origin.x+.25)}" y="${fmt(m.y-origin.y+.25)}" width="${fmt(m.width-.5)}" height="${fmt(m.height-.5)}"/>`).join('')}</g><g id="pockets" fill="none" stroke="red" stroke-width="0.15">${tools.map(t=>`<path id="${xml(t.id)}" data-depth-mm="${n(t.depth,10)}" d="${path(transformedPoints(t,n(project.clearance,.8)).map(shift))}"><title>${xml(t.name)}</title></path>`).join('')}</g></svg>`;
}
export function exportDXF(project,{moduleId=null}={}) {
  const {modules,tools,origin,height}=selected(project,moduleId),lines=[];
  const add=(code,value)=>lines.push(String(code),String(value));
  add(0,'SECTION');add(2,'HEADER');add(9,'$ACADVER');add(1,'AC1015');add(9,'$INSUNITS');add(70,4);add(0,'ENDSEC');add(0,'SECTION');add(2,'ENTITIES');
  const polygon=(points,layer)=>{add(0,'LWPOLYLINE');add(100,'AcDbEntity');add(8,layer);add(100,'AcDbPolyline');add(90,points.length);add(70,1);for(const p of points){add(10,fmt(p.x-origin.x));add(20,fmt(height-(p.y-origin.y)));}};
  for(const m of modules)polygon([{x:m.x+.25,y:m.y+.25},{x:m.x+m.width-.25,y:m.y+.25},{x:m.x+m.width-.25,y:m.y+m.height-.25},{x:m.x+.25,y:m.y+m.height-.25}],'MODULES');
  for(const t of tools)polygon(transformedPoints(t,n(project.clearance,.8)),'POCKETS');
  add(0,'ENDSEC');add(0,'EOF');return lines.join('\r\n')+'\r\n';
}

/** Binary STL, millimetres. Each module is a watertight solid with real recessed pockets. */
export function exportSTL(project,{moduleId=null}={}) {
  const {modules,tools,origin}=selected(project,moduleId),triangles=[],height=n(project.insertHeight,20);
  const vertex=(p,z)=>[p.x-origin.x,p.y-origin.y,z];
  const triangle=(a,b,c)=>triangles.push([a,b,c]);
  function face(polys,z,up=true){
    const flat=[],holes=[];let count=0;
    for(let i=0;i<polys.length;i++){if(i)holes.push(count);for(const p of polys[i]){flat.push(p.x,p.y);count++;}}
    const index=earcut(flat,holes,2);
    for(let i=0;i<index.length;i+=3){let a={x:flat[index[i]*2],y:flat[index[i]*2+1]},b={x:flat[index[i+1]*2],y:flat[index[i+1]*2+1]},c={x:flat[index[i+2]*2],y:flat[index[i+2]*2+1]};if((cross(a,b,c)>0)!==up)[b,c]=[c,b];triangle(vertex(a,z),vertex(b,z),vertex(c,z));}
  }
  function sides(poly,z0,z1,inner=false){
    let p=poly;if((area(p)>0)===inner)p=[...p].reverse();
    for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];triangle(vertex(a,z0),vertex(b,z0),vertex(b,z1));triangle(vertex(a,z0),vertex(b,z1),vertex(a,z1));}
  }
  for(const m of modules){
    const outer=[{x:m.x+.25,y:m.y+.25},{x:m.x+m.width-.25,y:m.y+.25},{x:m.x+m.width-.25,y:m.y+m.height-.25},{x:m.x+.25,y:m.y+m.height-.25}];
    const pockets=tools.filter(t=>t.moduleId===m.id).map(t=>({poly:clean(transformedPoints(t,n(project.clearance,.8))),z:height-n(t.depth,10)}));
    face([outer,...pockets.map(p=>p.poly)],height,true);face([outer],0,false);sides(outer,0,height);
    for(const p of pockets){face([p.poly],p.z,true);sides(p.poly,p.z,height,true);}
  }
  const bytes=new Uint8Array(84+triangles.length*50),view=new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('Suplik Studio | mm | modular flat-bottom inserts').slice(0,80));view.setUint32(80,triangles.length,true);
  let offset=84;
  for(const [a,b,c] of triangles){
    const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);let normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal);normal=normal.map(v=>length?v/length:0);
    for(const xyz of [normal,a,b,c])for(const value of xyz){view.setFloat32(offset,value,true);offset+=4;}view.setUint16(offset,0,true);offset+=2;
  }
  return bytes;
}

const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=bytes=>{let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
/** Dependency-free ZIP (stored entries); supports Unicode filenames. */
export function zipFiles(files) {
  const encoder=new TextEncoder(),chunks=[],central=[];let position=0,centralSize=0;
  const header=(size)=>{const bytes=new Uint8Array(size);return {bytes,v:new DataView(bytes.buffer)};};
  for(const file of files){
    const name=encoder.encode(String(file.name).replace(/\\/g,'/').replace(/^\/+/,'')),data=typeof file.data==='string'?encoder.encode(file.data):new Uint8Array(file.data),crc=crc32(data);
    const h=header(30+name.length);h.v.setUint32(0,0x04034b50,true);h.v.setUint16(4,20,true);h.v.setUint16(6,0x800,true);h.v.setUint16(12,0x21,true);h.v.setUint32(14,crc,true);h.v.setUint32(18,data.length,true);h.v.setUint32(22,data.length,true);h.v.setUint16(26,name.length,true);h.bytes.set(name,30);chunks.push(h.bytes,data);
    const c=header(46+name.length);c.v.setUint32(0,0x02014b50,true);c.v.setUint16(4,20,true);c.v.setUint16(6,20,true);c.v.setUint16(8,0x800,true);c.v.setUint16(14,0x21,true);c.v.setUint32(16,crc,true);c.v.setUint32(20,data.length,true);c.v.setUint32(24,data.length,true);c.v.setUint16(28,name.length,true);c.v.setUint32(42,position,true);c.bytes.set(name,46);central.push(c.bytes);centralSize+=c.bytes.length;position+=h.bytes.length+data.length;
  }
  const e=header(22);e.v.setUint32(0,0x06054b50,true);e.v.setUint16(8,files.length,true);e.v.setUint16(10,files.length,true);e.v.setUint32(12,centralSize,true);e.v.setUint32(16,position,true);
  const out=new Uint8Array(position+centralSize+22);let i=0;for(const part of [...chunks,...central,e.bytes]){out.set(part,i);i+=part.length;}return out;
}

export function createDemoProject() {
  const polygon=(coords)=>coords.map(([x,y])=>({x,y}));
  const tools=[
    {id:'tool-pliers',name:'Kombinované kleště',points:polygon([[14,0],[23,0],[26,25],[32,39],[40,62],[47,109],[43,119],[35,117],[27,76],[24,62],[20,62],[17,76],[9,117],[1,119],[0,109],[7,62],[15,39],[17,25]]) ,depth:13,color:'#e7a039'},
    {id:'tool-wrench',name:'Očkoplochý klíč 17',points:polygon([[7,0],[11,0],[10,12],[17,17],[24,12],[23,0],[27,0],[34,9],[32,21],[23,29],[23,112],[31,120],[31,135],[23,143],[11,143],[3,135],[3,120],[11,112],[11,29],[2,21],[0,9]]),depth:7,color:'#a8b3bd'},
    {id:'tool-screwdriver',name:'Šroubovák PH2',points:polygon([[10,0],[14,0],[15,12],[14,87],[23,94],[24,134],[20,145],[4,145],[0,134],[1,94],[10,87],[9,12]]),depth:12,color:'#6d9c82'},
    {id:'tool-cutter',name:'Odlamovací nůž',points:polygon([[8,0],[21,0],[22,20],[28,26],[28,116],[23,124],[4,124],[0,116],[0,27],[6,20]]),depth:10,color:'#df975b'},
    {id:'tool-hex',name:'Imbusový klíč 6',points:polygon([[0,0],[65,0],[65,7],[9,7],[9,103],[0,103]]),depth:6,color:'#b5a1cf'},
    {id:'tool-caliper',name:'Posuvné měřítko',points:polygon([[0,15],[10,15],[10,0],[15,0],[15,15],[34,15],[34,4],[39,4],[39,23],[31,23],[31,32],[129,32],[129,38],[30,38],[30,52],[22,52],[22,38],[14,38],[14,55],[8,55],[8,23],[0,23]]),depth:8,color:'#a4b9bd'},
  ].map(t=>({...t,x:0,y:0,rotation:0,locked:false,moduleId:null}));
  const project={version:1,name:'Dílna · ruční nářadí',width:420,height:294,grid:42,gap:3,clearance:.8,wall:2.4,base:2.4,insertHeight:20,tools,modules:[]};
  // A readable first project: tool silhouettes stay upright, while Auto can compact later.
  const layout=[[0,0,84,168],[84,0,84,168],[168,0,42,168],[210,0,42,168],[252,0,84,126],[0,168,168,84]];
  tools.forEach((t,i)=>{
    const [x,y,width,height]=layout[i],m={id:`mod-${t.id}`,name:t.name,x,y,width,height,locked:false};
    const b=box(transformedPoints(t,project.clearance));
    t.moduleId=m.id;t.x=x+(width-b.width)/2-b.x;t.y=y+(height-b.height)/2-b.y;
    project.modules.push(m);
  });
  return project;
}
