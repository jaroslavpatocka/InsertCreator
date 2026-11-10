// Deterministic component evidence. No neural model, RGB edit or mask mutation.
// Reuses traceMask labels/contours; it never allocates a second label raster.
const percentile=(values,fraction)=>values.length?values.slice().sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*fraction))]:null;
const delta=(data,a,b)=>Math.max(Math.abs(data[a*4]-data[b*4]),Math.abs(data[a*4+1]-data[b*4+1]),Math.abs(data[a*4+2]-data[b*4+2]));
const directions=[[-1,0],[1,0],[0,-1],[0,1]];
export function analyzeAlphaComponents(image,{source=image,labels,contours,signal}={}){
 const checkAbort=()=>{if(signal?.aborted)throw new DOMException('Component analysis cancelled','AbortError');};checkAbort();
 const {width,height,data}=image,n=width*height;if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||n>64000000||data?.length!==n*4||!labels||labels.length!==n||!Array.isArray(contours)||contours.some(c=>!Number.isInteger(c.componentId)||c.componentId<1)||new Set(contours.map(c=>c.componentId)).size!==contours.length||source.width!==width||source.height!==height||source.data.length!==data.length)throw Error('Matching source frame, existing labels and contours required');
 const sample=source.data,opaque=p=>sample[p*4+3]>=250,rows=new Map(contours.map(c=>[c.componentId,{id:c.componentId,area:0,bounds:{x0:width,y0:height,x1:0,y1:0},edges:[],edgeCount:0,edgeStride:1,alphaHistogram:new Uint32Array(256),textureSamples:0,textureHigh:0}]));
 const noise=[];for(let p=0;p+1<n;p+=Math.max(1,Math.floor(n/30000)))if(p%width+1<width&&!labels[p]&&!labels[p+1]&&opaque(p)&&opaque(p+1))noise.push(delta(sample,p,p+1));
 const noiseMedian=percentile(noise,.5)??1,threshold=Math.max(6,noiseMedian*4+2);
 for(let p=0;p<n;p++){
  if((p&16383)===0)checkAbort();
  const row=rows.get(labels[p]);if(!row)continue;const x=p%width,y=Math.floor(p/width);row.area++;row.bounds.x0=Math.min(row.bounds.x0,x);row.bounds.y0=Math.min(row.bounds.y0,y);row.bounds.x1=Math.max(row.bounds.x1,x);row.bounds.y1=Math.max(row.bounds.y1,y);
  row.alphaHistogram[data[p*4+3]]++;
  for(let d=0;d<4;d++){const[dx,dy]=directions[d],xx=x+dx,yy=y+dy;if(xx>=0&&yy>=0&&xx<width&&yy<height&&!labels[yy*width+xx]){if(row.edgeCount++%row.edgeStride===0)row.edges.push(p*4+d);if(row.edges.length>8192){row.edges=row.edges.filter((_,i)=>i%2===0);row.edgeStride*=2;}}}
 }
 for(const row of rows.values())row.textureRadius=Math.max(1,Math.round(.004*Math.sqrt(row.area)));
 for(let p=0;p<n;p+=32){const row=rows.get(labels[p]);if(!row)continue;const radius=row.textureRadius,x=p%width,y=Math.floor(p/width);if(x+radius<width&&y+radius<height&&labels[p+radius]===row.id&&labels[p+radius*width]===row.id&&opaque(p)&&opaque(p+radius)&&opaque(p+radius*width)){row.textureSamples++;row.textureHigh+=+(Math.max(delta(sample,p,p+radius),delta(sample,p,p+radius*width))>threshold*2);}}
 const components=[];
 for(const row of rows.values()){
  checkAbort();
  const featherReach=Math.min(1024,Math.max(32,Math.ceil(.25*Math.sqrt(row.area))));
  const contrasts=[],feathers=[];let boundarySamples=0,valid=0,supported=0,continuous=0,broad=0,softCensored=0;
  for(let e=0;e<row.edges.length;e+=Math.max(1,Math.floor(row.edges.length/6000))){
   const packed=row.edges[e],p=Math.floor(packed/4),[dx,dy]=directions[packed%4],x=p%width,y=Math.floor(p/width);boundarySamples++;
   let edgeContrast=-1,inner=p,outer=-1;
   for(let distance=1;distance<=8;distance++){
    const ix=x-dx*distance,iy=y-dy*distance;if(ix>=0&&iy>=0&&ix<width&&iy<height&&labels[iy*width+ix]===row.id)inner=iy*width+ix;
    const ox=x+dx*distance,oy=y+dy*distance;if(ox<0||oy<0||ox>=width||oy>=height||labels[oy*width+ox])break;outer=oy*width+ox;
    if(opaque(inner)&&opaque(outer))edgeContrast=Math.max(edgeContrast,delta(sample,inner,outer));
   }
   if(edgeContrast>=0){valid++;contrasts.push(edgeContrast);supported+=+(edgeContrast>=threshold);continuous+=+(edgeContrast<threshold);}
   let insideDistance=null,outsideDistance=null;
   for(let k=0;k<=featherReach;k++){
    const xx=x-dx*k,yy=y-dy*k;if(xx<0||yy<0||xx>=width||yy>=height||labels[yy*width+xx]!==row.id)break;
    if(data[(yy*width+xx)*4+3]>=250){insideDistance=k;break;}
   }
   for(let k=1;k<=featherReach;k++){
    const xx=x+dx*k,yy=y+dy*k;if(xx<0||yy<0||xx>=width||yy>=height)break;const q=yy*width+xx;if(labels[q]&&labels[q]!==row.id)break;
    if(data[q*4+3]<=5){outsideDistance=k;break;}
   }
   if(insideDistance!==null&&outsideDistance!==null){const feather=insideDistance+outsideDistance;feathers.push(feather);broad+=+(feather>8);}else softCensored++;
  }
  const alphaQuantile=fraction=>{let sum=0;for(let i=0;i<256;i++)if((sum+=row.alphaHistogram[i])>=row.area*fraction)return i;return 255;},featherP90=percentile(feathers,.9),featherThreshold=Math.max(3,.02*Math.sqrt(row.area));
  const evidence={noiseMedian,noiseThreshold:threshold,boundarySamples,sourceBoundaryCoverage:valid/Math.max(1,boundarySamples),edgeSupportFraction:valid?supported/valid:null,backgroundContinuationFraction:valid?continuous/valid:null,sourceContrastP50:percentile(contrasts,.5),sourceContrastP90:percentile(contrasts,.9),textureFraction:row.textureHigh/Math.max(1,row.textureSamples),textureRadius:row.textureRadius,alphaP10:alphaQuantile(.1),alphaP50:alphaQuantile(.5),alphaP90:alphaQuantile(.9),featherP50:percentile(feathers,.5),featherP90,featherThreshold,featherReach,featherRelativeP90:featherP90===null?null:featherP90/Math.sqrt(row.area),broadFeatherFraction:broad/Math.max(1,feathers.length),featherMeasuredFraction:feathers.length/Math.max(1,boundarySamples),featherCensoredFraction:softCensored/Math.max(1,boundarySamples)};
  // Evidence changes assignment only. Pending candidates and original pixels
  // remain recoverable; this function never deletes a component or its alpha.
  let decision='keep',reason='source-boundary-supported';
  if(!boundarySamples){decision='pending';reason='no-measurable-component-boundary';}
  else if(evidence.sourceBoundaryCoverage>=.65){
   if(evidence.edgeSupportFraction<.8){decision='pending';reason='insufficient-source-boundary-support';}
  }else if(featherP90!==null&&featherP90>featherThreshold&&evidence.featherMeasuredFraction>=.5&&evidence.textureFraction<.05){decision='pending';reason='wide-soft-alpha-without-source-context';}
  else reason='sharp-alpha-or-material-detail-without-source-context';
  const{edges,edgeStride,alphaHistogram,textureSamples,textureHigh,...base}=row;components.push({...base,decision,reason,evidence});
 }
 return{width,height,method:'source-rgb-and-alpha-component-evidence',sourcePixelsChanged:0,components};
}
