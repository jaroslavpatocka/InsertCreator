import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {detectPaper,rectifyImage} from '../dist/trace.js';

function contains(point,corners){
  let result=false;
  for(let i=0,j=corners.length-1;i<corners.length;j=i++){
    const a=corners[i],b=corners[j];
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)result=!result;
  }
  return result;
}
function sheet({width=400,height=520,corners,weak=false,island=true}={}){
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let rgb=[65,73,59];
    if(corners&&contains({x:x+.5,y:y+.5},corners)){
      // A real straight boundary survives a large brightness gradient and fold.
      let level=weak?70:116+84*y/height+25*x/width+(y>height*.52?15:0);
      if(island&&Math.hypot((x-width*.55)/1.2,y-height*.4)<width*.18)level=250;
      rgb=weak?[68,76,62]:[level,level,level];
    }
    data.set([...rgb,255],(y*width+x)*4);
  }
  return{width,height,data};
}
const portrait=[{x:48,y:30},{x:345,y:42},{x:337,y:490},{x:60,y:485}];
const landscape=[{x:48,y:45},{x:552,y:35},{x:560,y:385},{x:37,y:373}];
function assertCorners(actual,expected,image){
  assert.ok(actual,'all four supported physical paper edges must be found');
  const tolerance=3/Math.min(1,600/Math.max(image.width,image.height));
  actual.forEach((point,index)=>assert.ok(Math.hypot(point.x-expected[index].x,point.y-expected[index].y)<tolerance,`corner ${index}: ${JSON.stringify(point)} vs independent ${JSON.stringify(expected[index])}`));
}

test('A4 corners follow the complete sheet across a gradient, shadow, fold and bright interior island',()=>{
  const image=sheet({corners:portrait}),before=new Uint8ClampedArray(image.data);
  assertCorners(detectPaper(image),portrait,image);assert.deepEqual(image.data,before);
});

test('landscape perspective uses all four real edges rather than an interior brightness contour',()=>{
  const image=sheet({width:600,height:430,corners:landscape});
  assertCorners(detectPaper(image),landscape,image);
});

test('missing, clipped or weak paper edges cannot authorize an automatic homography',()=>{
  assert.equal(detectPaper(sheet()),null,'no sheet on the background');
  assert.equal(detectPaper(sheet({corners:portrait,weak:true})),null,'indistinct outside edges');
  const clipped=[{x:48,y:-35},{x:345,y:-25},{x:337,y:490},{x:60,y:485}];
  assert.equal(detectPaper(sheet({corners:clipped})),null,'an internal fold cannot substitute for the missing upper edge');
  const image=sheet();
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
    const level=70+175*Math.exp(-((x-210)**2/10000+(y-255)**2/22000));
    image.data.set([level,level,level,255],(y*image.width+x)*4);
  }
  assert.equal(detectPaper(image),null,'a smooth bright light spot has no four supported paper edges');
  for(const [width,height] of [[2,10000],[10000,2]])assert.equal(detectPaper({width,height,data:new Uint8ClampedArray(width*height*4).fill(255)}),null,'a valid narrow raster cannot allocate a zero-width detection grid');
});

test('large-photo downsampling and A4 rectification preserve independent 100 x 20 mm pixel truth',()=>{
  // Independent geometry: A4 is 1050 x 1485 source pixels, hence 5 px/mm.
  const full=createCanvas(1200,1650),context=full.getContext('2d');context.fillStyle='#42493b';context.fillRect(0,0,1200,1650);
  const gradient=context.createLinearGradient(75,80,1125,1565);gradient.addColorStop(0,'#828282');gradient.addColorStop(1,'#ededed');
  context.fillStyle=gradient;context.fillRect(75,80,1050,1485);
  context.fillStyle='#111';context.fillRect(275,480,500,100);
  const ratio=1400/1650,loaded=createCanvas(Math.round(1200*ratio),1400),draw=loaded.getContext('2d');draw.drawImage(full,0,0,loaded.width,loaded.height);
  const image=draw.getImageData(0,0,loaded.width,loaded.height),corners=detectPaper(image);
  const expected=[{x:75,y:80},{x:1125,y:80},{x:1125,y:1565},{x:75,y:1565}].map(p=>({x:p.x*loaded.width/1200,y:p.y*ratio}));
  assertCorners(corners,expected,image);
  const {imageData,pxPerMm}=rectifyImage(image,corners,210,297,1100);
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(let y=0;y<imageData.height;y++)for(let x=0;x<imageData.width;x++)if(imageData.data[(y*imageData.width+x)*4]<45){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
  assert.ok(Math.abs((x1-x0+1)/pxPerMm-100)<.6,'100 mm derives from the actual rectified dark pixels');
  assert.ok(Math.abs((y1-y0+1)/pxPerMm-20)<.6,'20 mm derives from the actual rectified dark pixels');
});
