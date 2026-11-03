/** Pure U2Netp preprocessing/postprocessing. Images stay on this device. */
export const MODEL_SIZE=320;

export function validateNeuralImage(image){
  if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<2||image.height<2||image.width*image.height>16000000||!image.data||image.data.length!==image.width*image.height*4)throw new Error('Pro rozpoznávání použijte platnou fotografii do 16 megapixelů.');
}

/** RGB bilinear resize, image-maximum scaling, ImageNet normalization, NCHW. */
export function preprocess(image,size=MODEL_SIZE){
  validateNeuralImage(image);
  if(!Number.isInteger(size)||size<2||size>2048)throw new Error('Neplatné rozlišení modelu.');
  const {width,height,data}=image,stride=size*size,out=new Float32Array(stride*3);
  const rgb=(x,y,c)=>{const i=(y*width+x)*4,a=data[i+3]/255;return data[i+c]*a+255*(1-a);};
  let maximum=0;
  for(let y=0;y<size;y++){
    const sy=Math.max(0,Math.min(height-1,(y+.5)*height/size-.5)),y0=Math.floor(sy),y1=Math.min(height-1,y0+1),fy=sy-y0;
    for(let x=0;x<size;x++){
      const sx=Math.max(0,Math.min(width-1,(x+.5)*width/size-.5)),x0=Math.floor(sx),x1=Math.min(width-1,x0+1),fx=sx-x0;
      for(let c=0;c<3;c++){
        const top=rgb(x0,y0,c)*(1-fx)+rgb(x1,y0,c)*fx,bottom=rgb(x0,y1,c)*(1-fx)+rgb(x1,y1,c)*fx,value=top*(1-fy)+bottom*fy;
        out[c*stride+y*size+x]=value;if(value>maximum)maximum=value;
      }
    }
  }
  maximum=Math.max(maximum,1e-6);
  const mean=[.485,.456,.406],std=[.229,.224,.225];
  for(let c=0;c<3;c++)for(let i=0;i<stride;i++)out[c*stride+i]=(out[c*stride+i]/maximum-mean[c])/std[c];
  return out;
}

/** Normalize first mask channel and bilinearly restore original image dimensions. */
export function normalizePrediction(prediction,sourceWidth=MODEL_SIZE,sourceHeight=MODEL_SIZE,width=sourceWidth,height=sourceHeight){
  const count=sourceWidth*sourceHeight;
  if(!prediction||prediction.length<count||![sourceWidth,sourceHeight,width,height].every(n=>Number.isInteger(n)&&n>0)||width*height>16000000)throw new Error('Model nevrátil platnou masku.');
  let lo=Infinity,hi=-Infinity;
  for(let i=0;i<count;i++){const v=prediction[i];if(!Number.isFinite(v))throw new Error('Model vrátil neplatnou hodnotu masky.');if(v<lo)lo=v;if(v>hi)hi=v;}
  const out=new Float32Array(width*height),range=hi-lo;
  if(range<1e-7)return out;
  for(let y=0;y<height;y++){
    const sy=Math.max(0,Math.min(sourceHeight-1,(y+.5)*sourceHeight/height-.5)),y0=Math.floor(sy),y1=Math.min(sourceHeight-1,y0+1),fy=sy-y0;
    for(let x=0;x<width;x++){
      const sx=Math.max(0,Math.min(sourceWidth-1,(x+.5)*sourceWidth/width-.5)),x0=Math.floor(sx),x1=Math.min(sourceWidth-1,x0+1),fx=sx-x0;
      const top=prediction[y0*sourceWidth+x0]*(1-fx)+prediction[y0*sourceWidth+x1]*fx,bottom=prediction[y1*sourceWidth+x0]*(1-fx)+prediction[y1*sourceWidth+x1]*fx;
      out[y*width+x]=Math.max(0,Math.min(1,(top*(1-fy)+bottom*fy-lo)/range));
    }
  }
  return out;
}
