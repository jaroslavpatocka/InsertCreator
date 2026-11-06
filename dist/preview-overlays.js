// Pure projected overlays shared by the SVG and WebGL previews. Keep this
// module independent of preview3d so a cached older renderer stays compatible.
const dot3=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

export function wirePath(module,projectPoint){
  const edges=module.wireEdges||[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  return edges.map(([a,b])=>{const p=projectPoint(module.wire[a]),q=projectPoint(module.wire[b]);return`M${p.x.toFixed(3)} ${p.y.toFixed(3)}L${q.x.toFixed(3)} ${q.y.toFixed(3)}`;}).join('');
}

/** The same projected cut overlay is used over the WebGL canvas and SVG mesh. */
export function cutPreviewMarkup(cuts,frame,center){
  if(!cuts?.length)return'';
  const projectPoint=frame.project(center),paths=[];
  for(const cut of cuts){
    if(dot3(cut.normal,frame.towards)<=.00001)continue;
    const [a,b]=cut.points.map(projectPoint);paths.push(`M${a.x.toFixed(3)} ${a.y.toFixed(3)}L${b.x.toFixed(3)} ${b.y.toFixed(3)}`);
  }
  return paths.length?`<path data-preview-cuts="true" d="${paths.join('')}" fill="none" stroke="#c47724" stroke-width="1.6" stroke-dasharray="6 3" vector-effect="non-scaling-stroke" pointer-events="none"/>`:'';
}

export function selectionPreviewMarkup(wire,frame,center){
  return `<path data-preview-selection="true" d="${wirePath(wire,frame.project(center))}" fill="none" stroke="#c89136" stroke-width="1.1" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
}
