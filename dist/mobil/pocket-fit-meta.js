/** Stable signature of normalized geometry; scaling or reshaping invalidates it. */
export function pocketFitSignature(points){
  const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));let hash=2166136261;
  const encoded=points.map(p=>`${Math.round((p.x-x)*1e6)},${Math.round((p.y-y)*1e6)}`).join(';');
  for(let i=0;i<encoded.length;i++){hash^=encoded.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return(hash>>>0).toString(16).padStart(8,'0');
}
