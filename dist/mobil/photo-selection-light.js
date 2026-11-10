/** Bounded photometric analysis copy. No resampling, inpainting or learned model. */
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
export function validateSelectionImage(image){
 if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<2||image.height<2||image.width*image.height>64000000||image.data?.length!==image.width*image.height*4)throw new Error('Fotografie nemá platná pixelová data.');
}
export function selectionAbort(signal){if(signal?.aborted)throw new DOMException('Výběr byl zrušen.','AbortError');}
export async function selectionYield(signal){selectionAbort(signal);await new Promise(resolve=>setTimeout(resolve,0));selectionAbort(signal);}
const percentile=(hist,fraction,total)=>{let sum=0;for(let i=0;i<hist.length;i++)if((sum+=hist[i])>=total*fraction)return i;return hist.length-1;};

export async function prepareSelectionLighting(image,{signal,onProgress}={}){
 validateSelectionImage(image);selectionAbort(signal);const started=performance.now(),{width,height,data}=image,count=width*height,light=new Uint8Array(count),hist=new Uint32Array(256),noiseHist=new Uint32Array(256),gw=Math.min(48,Math.max(2,Math.ceil(width/32))),gh=Math.min(48,Math.max(2,Math.ceil(height/32))),sums=new Float64Array(gw*gh),counts=new Uint32Array(gw*gh),result=new Uint8ClampedArray(data.length);let clippedPixels=0,noiseSamples=0,deadline=performance.now()+22;
 const progress=value=>{onProgress?.({stage:'lighting',progress:value,message:'Vyrovnávám světlo a zvýrazňuji skutečné hrany…'});selectionAbort(signal);};
 progress(0);
 for(let y=0;y<height;y++){
  for(let x=0;x<width;x++){
   const index=y*width+x,p=index*4,a=data[p+3]/255,r=data[p]*a+255*(1-a),g=data[p+1]*a+255*(1-a),b=data[p+2]*a+255*(1-a),value=Math.round(.2126*r+.7152*g+.0722*b),cell=Math.min(gh-1,Math.floor(y*gh/height))*gw+Math.min(gw-1,Math.floor(x*gw/width));
   light[index]=value;hist[value]++;sums[cell]+=value;counts[cell]++;clippedPixels+=+(r>=250&&g>=250&&b>=250);
   if(x>0&&((x+y*7)&15)===0){noiseHist[Math.abs(value-light[index-1])]++;noiseSamples++;}
  }
  if(performance.now()>deadline){progress(y/height*.35);await selectionYield(signal);deadline=performance.now()+22;}
 }
 const grid=Float32Array.from(sums,(sum,i)=>sum/Math.max(1,counts[i])),smooth=new Float32Array(grid.length);
 for(let y=0;y<gh;y++)for(let x=0;x<gw;x++){
  let sum=0,n=0;for(let yy=Math.max(0,y-2);yy<=Math.min(gh-1,y+2);yy++)for(let xx=Math.max(0,x-2);xx<=Math.min(gw-1,x+2);xx++){sum+=grid[yy*gw+xx];n++;}smooth[y*gw+x]=sum/n;
 }
 const target=percentile(hist,.8,count),noise=Math.max(.5,percentile(noiseHist,.25,Math.max(1,noiseSamples))),threshold=Math.max(.75,noise*1.5),field=(x,y)=>{
  const gx=clamp((x+.5)*gw/width-.5,0,gw-1),gy=clamp((y+.5)*gh/height-.5,0,gh-1),xx=Math.floor(gx),yy=Math.floor(gy),fx=gx-xx,fy=gy-yy,x1=Math.min(gw-1,xx+1),y1=Math.min(gh-1,yy+1);
  return(smooth[yy*gw+xx]*(1-fx)+smooth[yy*gw+x1]*fx)*(1-fy)+(smooth[y1*gw+xx]*(1-fx)+smooth[y1*gw+x1]*fx)*fy;
 };
 let shadowAdjustedPixels=0,specularCompressedPixels=0,sharpenedPixels=0,darkProtectedPixels=0,maxSharpening=0;
 for(let y=0;y<height;y++){
  for(let x=0;x<width;x++){
   const index=y*width+x,p=index*4,a=data[p+3]/255,original=[data[p]*a+255*(1-a),data[p+1]*a+255*(1-a),data[p+2]*a+255*(1-a)],value=light[index],weight=clamp((value-32)/112,0,1),illumination=clamp((target-field(x,y))*.55,-24,40)*weight;
   let blur=0;const weights=[1,4,6,4,1];for(let k=-2;k<=2;k++){blur+=weights[k+2]*(light[y*width+clamp(x+k,0,width-1)]+light[clamp(y+k,0,height-1)*width+x]);}blur/=32;
   const residual=value-blur,sharp=clamp(Math.sign(residual)*Math.max(0,Math.abs(residual)-threshold)*.4,-8,8),contrast=clamp((value-field(x,y))*.35,-24,24),mapped=clamp(value+illumination+contrast+sharp,0,255),factor=value>0?mapped/value:0;
   let rgb=original.map(channel=>channel*factor),maximum=Math.max(...rgb);
   if(maximum>235){const compressed=235+(maximum-235)*.45,ratio=compressed/maximum;rgb=rgb.map(channel=>channel*ratio);specularCompressedPixels++;}
   if(value<=32){rgb=original;darkProtectedPixels++;}
   result[p]=rgb[0];result[p+1]=rgb[1];result[p+2]=rgb[2];result[p+3]=255;
   shadowAdjustedPixels+=+(illumination>2);sharpenedPixels+=+(Math.abs(sharp)>.1);maxSharpening=Math.max(maxSharpening,Math.abs(sharp));
  }
  if(performance.now()>deadline){progress(.35+y/height*.65);await selectionYield(signal);deadline=performance.now()+22;}
 }
 progress(1);
 return{image:{width,height,data:result},diagnostics:{method:'bounded-local-light-and-noise-aware-unsharp',clippedPixels,clippedFraction:clippedPixels/count,shadowAdjustedPixels,specularCompressedPixels,sharpenedPixels,darkProtectedPixels,maxSharpening,noiseEstimate:noise,requiresManual:clippedPixels>Math.max(16,count*.002),geometricResampling:false,inpaintedPixels:0,elapsedMs:performance.now()-started}};
}
