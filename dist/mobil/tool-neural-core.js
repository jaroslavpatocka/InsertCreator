// Pure image/instance transforms for the new local recognizer. No app state,
// manufacturing reserve, source scaling, network or model runtime lives here.
export const INSTANCE_SIZE=1024;
export function validateInstanceImage(image){
  if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<16||image.height<16||image.width*image.height>16000000||image.data?.length!==image.width*image.height*4)throw Error('Fotografie nemá platná obrazová data nebo je příliš velká.');
}
export function prepareInstanceInput(image){
  validateInstanceImage(image);
  const {width,height,data}=image,size=INSTANCE_SIZE,ratio=size/Math.max(width,height),resizedWidth=Math.max(1,Math.round(width*ratio)),resizedHeight=Math.max(1,Math.round(height*ratio)),scaleX=resizedWidth/width,scaleY=resizedHeight/height;
  const values=new Float32Array(3*size*size);values.fill(114/255);
  const pixel=(x,y,k)=>{const p=(y*width+x)*4,a=data[p+3]/255;return(data[p+k]*a+255*(1-a))/255;};
  for(let y=0;y<resizedHeight;y++)for(let x=0;x<resizedWidth;x++){
    const sx=Math.max(0,Math.min(width-1,(x+.5)/scaleX-.5)),sy=Math.max(0,Math.min(height-1,(y+.5)/scaleY-.5)),x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),fx=sx-x0,fy=sy-y0;
    for(let k=0;k<3;k++)values[k*size*size+y*size+x]=(pixel(x0,y0,k)*(1-fx)+pixel(x1,y0,k)*fx)*(1-fy)+(pixel(x0,y1,k)*(1-fx)+pixel(x1,y1,k)*fx)*fy;
  }
  return{values,transform:{width,height,resizedWidth,resizedHeight,scaleX,scaleY,size}};
}
const boxIoU=(a,b)=>{const intersection=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));return intersection/Math.max(1e-12,(a.x1-a.x0)*(a.y1-a.y0)+(b.x1-b.x0)*(b.y1-b.y0)-intersection);};
export function readInstanceDetections(values,dims,transform,{confidence=.4,nmsIoU=.9,maxDetections=300}={}){
  if(dims?.length!==3||dims[0]!==1||dims[1]!==37||!Number.isInteger(dims[2])||values.length!==37*dims[2])throw Error('Rozpoznávání nevrátilo platné oblasti nástrojů.');
  const count=dims[2],proposals=[];
  for(let i=0;i<count;i++){
    const score=values[4*count+i],x=values[i],y=values[count+i],w=values[2*count+i],h=values[3*count+i];
    if(!Number.isFinite(score)||score<confidence||![x,y,w,h].every(Number.isFinite)||w<=0||h<=0)continue;
    const inputBox={x0:x-w/2,y0:y-h/2,x1:x+w/2,y1:y+h/2};
    if(inputBox.x0>=transform.resizedWidth||inputBox.y0>=transform.resizedHeight||inputBox.x1<=0||inputBox.y1<=0)continue;
    const coefficients=Array.from({length:32},(_,c)=>values[(5+c)*count+i]);if(coefficients.some(c=>!Number.isFinite(c)))continue;
    proposals.push({id:'anchor-'+i,anchorIndex:i,score,inputBox,coefficients,box:{x0:Math.max(0,inputBox.x0/transform.scaleX),y0:Math.max(0,inputBox.y0/transform.scaleY),x1:Math.min(transform.width,inputBox.x1/transform.scaleX),y1:Math.min(transform.height,inputBox.y1/transform.scaleY)}});
  }
  proposals.sort((a,b)=>b.score-a.score||a.anchorIndex-b.anchorIndex);
  const kept=[];
  for(const proposal of proposals){if(kept.every(other=>boxIoU(proposal.inputBox,other.inputBox)<=nmsIoU))kept.push(proposal);if(kept.length>=maxDetections)break;}
  return kept;
}
/** Upsample logits first, then clip the true box. Return a compact source-grid ROI. */
export function decodeInstanceMask(instance,prototypes,dims,transform,{includeProbability=true}={}){
  if(dims?.length!==4||dims[0]!==1||dims[1]!==32||dims[2]!==dims[3]||prototypes.length!==32*dims[2]*dims[3])throw Error('Rozpoznávání nevrátilo platné masky nástrojů.');
  const size=dims[2],box=instance.box,x=Math.max(0,Math.floor(box.x0)),y=Math.max(0,Math.floor(box.y0)),right=Math.min(transform.width,Math.ceil(box.x1)),bottom=Math.min(transform.height,Math.ceil(box.y1)),width=right-x,height=bottom-y;
  const data=new Uint8Array(width*height),probability=includeProbability?new Uint8Array(width*height):null,scale=transform.size/size;
  const sx0=Math.max(0,Math.floor((x+.5)*transform.scaleX/scale-.5)),sy0=Math.max(0,Math.floor((y+.5)*transform.scaleY/scale-.5)),sx1=Math.min(size-1,Math.ceil((right-.5)*transform.scaleX/scale-.5)),sy1=Math.min(size-1,Math.ceil((bottom-.5)*transform.scaleY/scale-.5)),gridWidth=sx1-sx0+1,gridHeight=sy1-sy0+1,logits=new Float32Array(gridWidth*gridHeight);
  for(let gy=0;gy<gridHeight;gy++)for(let gx=0;gx<gridWidth;gx++){
    const p=(gy+sy0)*size+gx+sx0;let value=0;for(let c=0;c<32;c++)value+=instance.coefficients[c]*prototypes[c*size*size+p];logits[gy*gridWidth+gx]=value;
  }
  let area=0;
  for(let dy=0;dy<height;dy++)for(let dx=0;dx<width;dx++){
    if(x+dx+.5<box.x0||x+dx+.5>=box.x1||y+dy+.5<box.y0||y+dy+.5>=box.y1)continue;
    const sx=Math.max(sx0,Math.min(sx1,(x+dx+.5)*transform.scaleX/scale-.5)),sy=Math.max(sy0,Math.min(sy1,(y+dy+.5)*transform.scaleY/scale-.5)),ax=Math.floor(sx),ay=Math.floor(sy),bx=Math.min(sx1,ax+1),by=Math.min(sy1,ay+1),fx=sx-ax,fy=sy-ay;
    const value=(logits[(ay-sy0)*gridWidth+ax-sx0]*(1-fx)+logits[(ay-sy0)*gridWidth+bx-sx0]*fx)*(1-fy)+(logits[(by-sy0)*gridWidth+ax-sx0]*(1-fx)+logits[(by-sy0)*gridWidth+bx-sx0]*fx)*fy;
    const p=dy*width+dx;data[p]=+(value>0);area+=data[p];if(probability)probability[p]=Math.round(255/(1+Math.exp(-value)));
  }
  return{id:instance.id,score:instance.score,box:{...box},area,mask:{x,y,width,height,data},...(probability?{probability:{x,y,width,height,data:probability}}:{})};
}
