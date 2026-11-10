import {simple} from './contour-smoothing.js';
import {polygonArea} from './trace.js';
import {i18nError} from './i18n.js';

/** Validate a newly selected source outline before it enters calibrated editing. */
export function captureSelectionItem(selection,{scale,image,previous=null,name='Nástroj',pocketShape='ideal'}={}){
 const points=selection?.contour?.points?.map(p=>({x:p.x,y:p.y}));
 if(!Number.isFinite(scale)||scale<=0||!image||!points||points.length<3||points.length>6000||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>image.width||p.y>image.height)||Math.abs(polygonArea(points))<1||!simple(points))throw i18nError('Vybraný obrys není platný. Upravte body nebo výběr.');
 const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));
 if((maxX-minX)/scale<2||(maxY-minY)/scale<2)throw i18nError('Vybraný obrys je menší než 2 mm. Zkontrolujte měřítko.');
 const item={...previous,contour:{...selection.contour,points,area:Math.abs(polygonArea(points)),width:maxX-minX,height:maxY-minY},info:{minX,minY,width:(maxX-minX)/scale,height:(maxY-minY)/scale,center:{x:(minX+maxX)/2,y:(minY+maxY)/2}},pocketShape,isReference:false,checked:true,name:previous?.name||name,selectionSource:selection.method||'interactive',selectionDiagnostics:selection.diagnostics||{}};
 for(const key of ['editedPoints','contourEdit','contourEditOrigin','contourReserveRatio'])delete item[key];
 return item;
}

/** Scanline fill of source outlines; no geometric dilation or manufacturing margin. */
export function captureSelectionMask(contours,width,height){
 const mask=new Uint8Array(width*height);
 for(const contour of contours){
  const points=contour.points,minY=Math.max(0,Math.ceil(Math.min(...points.map(p=>p.y))-.5)),maxY=Math.min(height-1,Math.floor(Math.max(...points.map(p=>p.y))-.5));
  for(let y=minY;y<=maxY;y++){
   const row=y+.5,intersections=[];
   for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[j],b=points[i];if((a.y>row)!==(b.y>row))intersections.push(a.x+(row-a.y)*(b.x-a.x)/(b.y-a.y));
   }
   intersections.sort((a,b)=>a-b);
   for(let i=0;i+1<intersections.length;i+=2){const from=Math.max(0,Math.ceil(intersections[i]-.5)),to=Math.min(width,Math.ceil(intersections[i+1]-.5));if(to>from)mask.fill(1,y*width+from,y*width+to);}
  }
 }
 return mask;
}

/** Apply a user's local foreground correction to an existing full-photo cutout.
 * Other identified objects are protected; RGB always comes from the original. */
export function mergeCaptureCutout(original,cutout,selection,{previous=null,others=[]}={}){
 const {width,height}=original,points=selection.contour.points,stencil=captureSelectionMask([selection.contour],width,height);
 if(!cutout||cutout.width!==width||cutout.height!==height||cutout.data.length!==original.data.length)throw i18nError('Maska má jiný rozměr než fotografie.');
 const mask=selection.mask instanceof Uint8Array&&selection.mask.length===width*height?selection.mask:stencil;
 const supplied=selection.diagnostics?.roi,all=[...points,...(previous?.contour?.points||[])];
 const roi=supplied||{x:Math.min(...all.map(p=>p.x))-2,y:Math.min(...all.map(p=>p.y))-2,width:Math.max(...all.map(p=>p.x))-Math.min(...all.map(p=>p.x))+4,height:Math.max(...all.map(p=>p.y))-Math.min(...all.map(p=>p.y))+4};
 const x0=Math.max(0,Math.floor(roi.x)),y0=Math.max(0,Math.floor(roi.y)),x1=Math.min(width,Math.ceil(roi.x+roi.width)),y1=Math.min(height,Math.ceil(roi.y+roi.height));
 const protectedPixels=captureSelectionMask(others.map(item=>item.contour),width,height),data=new Uint8ClampedArray(cutout.data);
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
  const p=y*width+x;if(protectedPixels[p])continue;
  for(let c=0;c<3;c++)data[p*4+c]=original.data[p*4+c];
  data[p*4+3]=mask[p]&&stencil[p]?original.data[p*4+3]:0;
 }
 return{width,height,data};
}
