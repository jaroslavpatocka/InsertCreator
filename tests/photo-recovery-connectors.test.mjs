import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {recoverDarkTools} from '../dist/photo-recovery.js';
import {traceMask} from '../dist/trace.js';

const WIDTH=240,HEIGHT=200;

function connectorScene(angle=0,connected=true){
  const originalCanvas=createCanvas(WIDTH,HEIGHT),enhancedCanvas=createCanvas(WIDTH,HEIGHT),truthCanvas=createCanvas(WIDTH,HEIGHT);
  const original=originalCanvas.getContext('2d'),enhanced=enhancedCanvas.getContext('2d'),truth=truthCanvas.getContext('2d');
  // The recess has colour evidence even when a dark neck disappears from the
  // brightness enhancement. Keep the enhanced anchors independent of it.
  const pixels=original.createImageData(WIDTH,HEIGHT);
  for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){
    const texture=((x*13+y*7)%7)-3;
    pixels.data.set([10+texture,65+texture,94+texture,255],(y*WIDTH+x)*4);
  }
  original.putImageData(pixels,0,0);
  enhanced.fillStyle='#fff';enhanced.fillRect(0,0,WIDTH,HEIGHT);
  for(const ctx of [original,enhanced,truth]){
    ctx.translate(WIDTH/2,HEIGHT/2);ctx.rotate(angle*Math.PI/180);ctx.translate(-WIDTH/2,-HEIGHT/2);
  }
  if(connected){
    original.fillStyle='#0b1117';original.fillRect(115,85,connected==='one-edge'?WIDTH-115:11,10);
    truth.fillStyle='#fff';truth.fillRect(115,85,11,10);
  }
  // A short U-joint: neither anchor is a long ratchet shaft. The four-pixel
  // absent mask interval is real material only in the positive source image.
  for(const [x,y,w,h] of [[112,60,17,27],[108,91,25,54],[53,119,18,25]]){
    original.fillStyle='#c4ccd2';original.fillRect(x,y,w,h);
    enhanced.fillStyle='#000';enhanced.fillRect(x,y,w,h);
    truth.fillStyle='#fff';truth.fillRect(x,y,w,h);
  }
  const image=ctx=>{const result=ctx.getImageData(0,0,WIDTH,HEIGHT);return {width:WIDTH,height:HEIGHT,data:result.data};};
  const anchors=image(enhanced);
  // Explicit binary anchor masks avoid treating the canvas's partly covered
  // boundary pixels as extra photographed material in the truth comparison.
  for(let p=0;p<anchors.data.length;p+=4)anchors.data[p]=anchors.data[p+1]=anchors.data[p+2]=anchors.data[p]<128?0:255;
  return {original:image(original),enhanced:anchors,truth:Uint8Array.from(image(truth).data.filter((_,i)=>i%4===3),v=>+(v>127))};
}

function point(x,y,angle){
  const a=angle*Math.PI/180,dx=x-WIDTH/2,dy=y-HEIGHT/2;
  return Math.round(HEIGHT/2+dx*Math.sin(a)+dy*Math.cos(a))*WIDTH+Math.round(WIDTH/2+dx*Math.cos(a)-dy*Math.sin(a));
}
function mask(image){return Uint8Array.from({length:WIDTH*HEIGHT},(_,p)=>+(image.data[p*4]<224));}
function iou(a,b){let intersection=0,union=0;for(let p=0;p<a.length;p++){intersection+=+(a[p]&&b[p]);union+=+(a[p]||b[p]);}return intersection/union;}

for(const angle of [0,-32,32,90])test(`a stubby connector keeps its photographed dark neck (${angle} degrees)`,()=>{
  const fixture=connectorScene(angle),sourceCopy=new Uint8ClampedArray(fixture.original.data),enhancedCopy=new Uint8ClampedArray(fixture.enhanced.data);
  const recovered=recoverDarkTools(fixture.original,fixture.enhanced),result=mask(recovered);
  assert.equal(traceMask(mask(fixture.enhanced),WIDTH,HEIGHT,{minArea:4,smoothing:0}).contours.length,3,'baseline deliberately omits the connector neck');
  assert.equal(traceMask(result,WIDTH,HEIGHT,{minArea:4,smoothing:0}).contours.length,2,'one complete U-joint and its independent neighbour');
  assert.equal(result[point(120,89,angle)],1,'the source-proven dark neck joins both anchors');
  assert.equal(result[point(88,130,angle)],0,'the real background before the neighbouring tool stays empty');
  assert.ok(iou(result,fixture.truth)>.96,'the recovered silhouette follows the independent source truth');
  assert.deepEqual(fixture.original.data,sourceCopy,'source RGB evidence remains unchanged');
  assert.deepEqual(fixture.enhanced.data,enhancedCopy,'baseline anchors remain unchanged');
});

for(const angle of [0,-32,32,90])test(`short aligned pieces separated by photographed recess stay separate (${angle} degrees)`,()=>{
  const fixture=connectorScene(angle,false),recovered=recoverDarkTools(fixture.original,fixture.enhanced);
  assert.deepEqual(recovered.data,fixture.enhanced.data,'short distance and matching alignment cannot replace two observed source edges');
  assert.equal(traceMask(mask(recovered),WIDTH,HEIGHT,{minArea:4,smoothing:0}).contours.length,3);
  assert.equal(mask(recovered)[point(120,89,angle)],0,'no material exists in the photographed gap');
});

for(const angle of [0,32])test(`one dark source boundary cannot justify a connector (${angle} degrees)`,()=>{
  const fixture=connectorScene(angle,'one-edge'),recovered=recoverDarkTools(fixture.original,fixture.enhanced);
  assert.deepEqual(recovered.data,fixture.enhanced.data,'a manufactured neck needs two independently observed source boundaries');
});
