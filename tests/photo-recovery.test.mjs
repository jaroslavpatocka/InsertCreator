// Regression for a single multicolour tool whose black grip disappears against a dark mat.
// Synthetic source photographs carry an independently painted truth mask.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {recognizeTools} from '../dist/recognize.js';
import {readableImage} from '../dist/photo-enhance.js';
import {recoverDarkTools} from '../dist/photo-recovery.js';
import {traceMask} from '../dist/trace.js';

const WIDTH=720,HEIGHT=520;

function scene({angle=0,bridge='dark',weave=false}={}){
  const canvas=createCanvas(WIDTH,HEIGHT),ctx=canvas.getContext('2d');
  const truthCanvas=createCanvas(WIDTH,HEIGHT),truth=truthCanvas.getContext('2d');
  // A low-amplitude woven-looking pattern: real background variation must not
  // become a path connecting neighbouring bright objects.
  const pixels=ctx.createImageData(WIDTH,HEIGHT);
  for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){
    const p=(y*WIDTH+x)*4,texture=weave
      ?Math.round(20*(.7*Math.sin((x+y)*Math.PI/8)+.3*Math.sin((x-y)*Math.PI/8)))
      :((x*13+y*7)%7)-3;
    pixels.data.set([29+texture,31+texture,34+texture,255],p);
  }
  ctx.putImageData(pixels,0,0);
  for(const context of [ctx,truth]){
    context.translate(WIDTH/2,HEIGHT/2);context.rotate(angle*Math.PI/180);context.translate(-WIDTH/2,-HEIGHT/2);
  }
  const fill=(draw,color)=>{
    ctx.fillStyle=color;draw(ctx);truth.fillStyle='#fff';draw(truth);
  };
  // Ratchet head and shaft are one connected metal piece.
  fill(context=>{context.beginPath();context.arc(130,210,33,0,Math.PI*2);context.fill();},'#c5ccd0');
  const metal=ctx.createLinearGradient(0,201,0,219);metal.addColorStop(0,'#8b949c');metal.addColorStop(.5,'#e6e9eb');metal.addColorStop(1,'#aeb9c1');
  fill(context=>context.fillRect(130,201,240,18),metal);
  // A cyan grip, a long black section, then its visibly brighter end cap.
  // The gap cases keep the actual textured mat between the two visible pieces.
  for(const context of [ctx,truth]){
    context.save();context.beginPath();context.roundRect(350,188,230,44,16);context.clip();
    context.fillStyle=context===truth?'#fff':'#168c9c';context.fillRect(350,188,105,44);
    if(bridge==='dark'){
      context.fillStyle=context===truth?'#fff':'#0d1218';context.fillRect(455,188,100,44);
    }
    context.fillStyle=context===truth?'#fff':'#a3c8c9';context.fillRect(555,188,25,44);
    context.restore();
  }
  // A real neighbouring tool must retain its own contour.
  fill(context=>{context.beginPath();context.roundRect(180,345,300,28,8);context.fill();},'#b5bdc5');
  const image=ctx.getImageData(0,0,WIDTH,HEIGHT),mask=truth.getImageData(0,0,WIDTH,HEIGHT).data;
  return {image:{width:WIDTH,height:HEIGHT,data:image.data},truth:Uint8Array.from({length:WIDTH*HEIGHT},(_,i)=>+(mask[i*4+3]>127)),angle};
}

function transformed(x,y,angle){
  const a=angle*Math.PI/180,dx=x-WIDTH/2,dy=y-HEIGHT/2;
  return {x:Math.round(WIDTH/2+dx*Math.cos(a)-dy*Math.sin(a)),y:Math.round(HEIGHT/2+dx*Math.sin(a)+dy*Math.cos(a))};
}
const hasPixel=(result,x,y,angle=0)=>{const p=transformed(x,y,angle);return result.mask[p.y*WIDTH+p.x];};
function intersectionOverUnion(a,b){
  let intersection=0,union=0;
  for(let i=0;i<a.length;i++){intersection+=+(a[i]&&b[i]);union+=+(a[i]||b[i]);}
  return intersection/union;
}

for(const angle of [0,-25,25])test(`black grip and bright cap stay part of one tool on a dark mat (${angle} degrees)`,async()=>{
  const fixture=scene({angle}),sourceCopy=new Uint8ClampedArray(fixture.image.data);
  const result=await recognizeTools(fixture.image,{pxPerMm:2});
  assert.equal(result.enhanced,'dark-tray');
  assert.equal(result.contours.length,2,'the ratchet and the neighbouring tool each need one contour');
  assert.equal(hasPixel(result,505,210,angle),1,'the real black grip must remain inside the ratchet');
  assert.equal(hasPixel(result,565,210,angle),1,'the bright cap must remain inside the ratchet');
  assert.equal(hasPixel(result,330,359,angle),1,'the independent neighbouring tool is still recognised');
  assert.equal(hasPixel(result,330,285,angle),0,'the empty gap to the neighbouring tool stays empty');
  assert.ok(intersectionOverUnion(result.mask,fixture.truth)>.92,'recovered outline follows the photographed shape and size');
  assert.deepEqual(fixture.image.data,sourceCopy,'recognition must preserve the original photograph');
});

test('collinear bright pieces with real textured background between them stay separate',async()=>{
  const fixture=scene({bridge:'gap'}),result=await recognizeTools(fixture.image,{pxPerMm:2});
  assert.equal(result.enhanced,'dark-tray');
  assert.equal(result.contours.length,3,'a real gap must not be closed merely because objects align');
  assert.equal(hasPixel(result,505,210),0,'there is no photographed tool surface in the gap');
  assert.ok(intersectionOverUnion(result.mask,fixture.truth)>.92);
});

test('an indistinguishable black section cannot justify an invented connection',async()=>{
  // A hypothetical grip with exactly the mat appearance supplies no image
  // evidence. Its pixel data are intentionally identical to the real-gap case.
  const fixture=scene({bridge:'indistinguishable',angle:25});
  const result=await recognizeTools(fixture.image,{pxPerMm:2});
  assert.equal(result.contours.length,3);
  assert.equal(hasPixel(result,505,210,25),0,'unobservable material must not be guessed into a manufacturing outline');
});

for(const angle of [0,-25,25])test(`strong diagonal mat texture cannot supply a false grip (${angle} degrees)`,()=>{
  const original=scene({bridge:'gap',weave:true,angle}).image;
  // Keep exactly the same two foreground anchors while making the source mat
  // much more textured. This isolates recovery from brightness preprocessing.
  const enhanced=readableImage(scene({bridge:'gap',angle}).image).image;
  const result=recoverDarkTools(original,enhanced);
  assert.ok(result.data.every((value,index)=>value===enhanced.data[index]),'background weave must not create a manufactured connection');
});

test('dark grip recovery preserves both input images and their dimensions',()=>{
  const original=scene().image,enhanced=readableImage(original).image;
  const originalCopy=new Uint8ClampedArray(original.data),enhancedCopy=new Uint8ClampedArray(enhanced.data);
  const result=recoverDarkTools(original,enhanced);
  assert.equal(result.width,WIDTH);assert.equal(result.height,HEIGHT);
  assert.notEqual(result.data,enhanced.data,'recovery writes its own image buffer');
  assert.deepEqual(original.data,originalCopy,'source photograph remains available unchanged');
  assert.deepEqual(enhanced.data,enhancedCopy,'the baseline enhancement remains unchanged');
  const p=(210*WIDTH+505)*4;
  assert.ok(result.data[p]<enhanced.data[p],'this fixture exercises a successful recovery, not just a no-op');
});

test('large source photographs retain calibrated coordinates after bounded-resolution recovery',async()=>{
  const fixture=scene(),scale=2,width=WIDTH*scale,height=HEIGHT*scale;
  const data=new Uint8ClampedArray(width*height*4),truth=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const source=Math.floor(y/scale)*WIDTH+Math.floor(x/scale),target=y*width+x;
    data.set(fixture.image.data.subarray(source*4,source*4+4),target*4);truth[target]=fixture.truth[source];
  }
  const sourceCopy=new Uint8ClampedArray(data),result=await recognizeTools({width,height,data},{pxPerMm:2*scale});
  assert.ok(width*height>1_000_000,'fixture exceeds the recovery processing grid');
  assert.equal(result.width,width);assert.equal(result.height,height);
  assert.equal(result.mask.length,width*height,'mask returns in original calibrated image coordinates');
  assert.equal(result.contours.length,2,'large-image recovery retains a whole ratchet and a separate neighbour');
  const pixel=(x,y)=>result.mask[(y*scale)*width+x*scale];
  assert.equal(pixel(505,210),1,'black grip is restored at its original position');
  assert.equal(pixel(565,210),1,'end cap is included at its original position');
  assert.equal(pixel(330,359),1,'the separate tool keeps its original position');
  assert.equal(pixel(330,285),0,'the gap to the separate tool remains empty');
  assert.ok(intersectionOverUnion(result.mask,truth)>.92,'dimensions and shape survive processing-grid resampling');
  assert.equal(data.byteLength,sourceCopy.byteLength,'caller photo buffer remains attached');
  assert.deepEqual(data,sourceCopy,'large source photograph is not modified');
});

test('a recovered grip cannot become connected to a separate piece beside its edge',()=>{
  const original=scene().image,enhanced=readableImage(original).image;
  // The photographed grip begins at y=188. A narrow independent bright piece
  // ends at y=186, leaving one real mat pixel row between their surfaces.
  // Rasterising a measured edge must not consume that last separating row.
  for(let y=180;y<=186;y++)for(let x=480;x<535;x++){
    const p=(y*WIDTH+x)*4;
    original.data.set([185,191,197,255],p);enhanced.data.set([0,0,0,255],p);
  }
  const result=recoverDarkTools(original,enhanced);
  const mask=Uint8Array.from({length:WIDTH*HEIGHT},(_,p)=>+(result.data[p*4]<224));
  const contours=traceMask(mask,WIDTH,HEIGHT,{minArea:4,smoothing:0}).contours;
  assert.ok(contours.length===3||contours.length===4,'recovery may preserve the gap or conservatively leave the ratchet split');
  const queue=[183*WIDTH+505],seen=new Uint8Array(mask.length);seen[queue[0]]=1;
  for(let head=0;head<queue.length;head++){
    const p=queue[head],x=p%WIDTH;
    const push=n=>{if(mask[n]&&!seen[n]){seen[n]=1;queue.push(n);}};
    if(x)push(p-1);if(x+1<WIDTH)push(p+1);
    if(p>=WIDTH)push(p-WIDTH);if(p+WIDTH<mask.length)push(p+WIDTH);
  }
  assert.equal(seen[210*WIDTH+505],0,'the independent piece cannot join the recovered black grip');
  assert.equal(seen[210*WIDTH+400],0,'the independent piece cannot join the cyan tool body');
});
