import test from 'node:test';
import assert from 'node:assert/strict';
import {traceAlphaPhoto} from '../dist/photo-alpha.js';
import {traceMask,rectifyImage} from '../dist/trace.js';
import {rectifyRulers} from '../dist/ruler-calibration.js';
const image=()=>({width:32,height:32,data:new Uint8ClampedArray(32*32*4)});
test('real alpha preserves one-pixel parts, frame contacts and exact source masks',()=>{
 const im=image();for(const [x,y]of [[0,0],[15,16],[31,31]])im.data[(y*32+x)*4+3]=255;
 const before=im.data.slice(),result=traceAlphaPhoto(im);
 assert.equal(result.contours.length,3);assert.equal(result.mask.reduce((a,b)=>a+b,0),3);assert.equal(result.diagnostics.discardedForegroundPixels,0);assert.equal(result.diagnostics.clippedForegroundPixels,2);assert.equal(result.quality.status,'review');assert.ok(result.quality.reasons.some(s=>s.includes('oříznutý')));assert.deepEqual(im.data,before);
 for(const c of result.contours)assert.equal(c.area,1);
 assert.equal(traceMask(result.mask,32,32,{minArea:1}).contours.length,0,'legacy tracing defaults still reject tiny/frame components');
});
test('opaque checkerboard pixels are not transparency or an embedded foreground mask',()=>{
 const im=image();for(let p=0;p<32*32;p++){const g=((p%32>>2)+(p/32>>2))%2?230:255;im.data.set([g,g,g,255],p*4);}assert.equal(traceAlphaPhoto(im),null);
});
test('alpha source rewarps do not invent opaque foreground outside the source',()=>{
 const im=image();for(let y=9;y<23;y++)for(let x=10;x<22;x++)im.data.set([60,80,90,255],(y*32+x)*4);
 const transformed=rectifyRulers(im,[{x:4,y:4},{x:25,y:10},{x:4,y:4},{x:1,y:24}],[21,20],80).imageData;
 for(let p=0;p<transformed.width*transformed.height;p++)if(transformed.data[p*4]===255&&transformed.data[p*4+1]===255&&transformed.data[p*4+2]===255)assert.equal(transformed.data[p*4+3],0,'out-of-source fill remains transparent');
 const a4=rectifyImage(im,[{x:-4,y:-4},{x:35,y:-4},{x:35,y:35},{x:-4,y:35}],40,40,40).imageData;assert.equal(a4.data[3],0);
});
