import {exportSTL} from './geometry.js';
import {esc} from './ui.js';
import {t} from './i18n.js';

let cacheKey='',cached=[];
// Render the actual export mesh rather than a picture of a solid block.
export function printPreview(project,selected,selectedModule){
  const key=JSON.stringify(project);
  if(key!==cacheKey){
    const next=[];
    for(const m of project.modules){
      const bytes=exportSTL({...project,limitToBed:false},{moduleId:m.id}),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      const faces=[];
      for(let i=0;i<v.getUint32(80,true);i++){
        const off=84+i*50,normal=[0,1,2].map(c=>v.getFloat32(off+c*4,true));
        if(normal[0]*.702+normal[1]*.702+normal[2]*.5304<-.00001)continue;
        const pts=[0,1,2].map(j=>[v.getFloat32(off+12+j*12,true)+m.x,v.getFloat32(off+16+j*12,true)+m.y,v.getFloat32(off+20+j*12,true)]);
        const depth=pts.reduce((s,p)=>s+p[0]+p[1]+p[2]*.7556,0)/3;
        faces.push({pts,depth,shade:Math.max(0,normal[2]*.55+normal[0]*.18+normal[1]*.07)});
      }
      next.push({id:m.id,name:m.name,faces});
    }
    cacheKey=key;cached=next;
  }
  const pr=([x,y,z])=>({x:(x-y)*.78,y:(x+y)*.34-z*.9});
  const base=[[0,0,0],[project.width,0,0],[project.width,project.height,0],[0,project.height,0]].map(pr);
  const pts=base.concat(cached.flatMap(m=>m.faces.flatMap(f=>f.pts.map(pr))));
  const extent=pts.reduce((b,p)=>({minX:Math.min(b.minX,p.x),maxX:Math.max(b.maxX,p.x),minY:Math.min(b.minY,p.y),maxY:Math.max(b.maxY,p.y)}),{minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity});
  const minX=extent.minX-20,maxX=extent.maxX+20,minY=extent.minY-20,maxY=extent.maxY+30;
  const poly=points=>points.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  let html=`<polygon points="${poly(base)}" fill="#eef3e8" stroke="#b9c9a8" stroke-width="1"/>`;
  const faces=cached.flatMap(m=>m.faces.map(f=>({...f,m}))).sort((a,b)=>a.depth-b.depth);
  for(const f of faces){
    const active=f.m.id===selectedModule||project.tools.some(t=>t.id===selected&&t.moduleId===f.m.id);
    const light=58+f.shade*29,color=active?`hsl(39 47% ${light}%)`:`hsl(88 23% ${light}%)`;
    html+=`<polygon data-module="${esc(f.m.id)}" points="${poly(f.pts.map(pr))}" fill="${color}" stroke="${color}" stroke-width=".12" aria-label="${esc(f.m.name)}"/>`;
  }
  html+=`<text x="${(minX+maxX)/2}" y="${maxY-7}" text-anchor="middle" font-size="8" fill="#6f805e">${esc(t('Skutečná geometrie STL · {mode}',{mode:t(project.printMode==='light'?'úsporný tisk':'plný blok')}))}</text>`;
  return {html,viewBox:`${minX} ${minY} ${maxX-minX} ${maxY-minY}`};
}
