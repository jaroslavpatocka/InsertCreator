import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareSelectionLighting} from '../dist/photo-selection-light.js';
const sha=data=>createHash('sha256').update(data).digest('hex');
function photo(width=160,height=90){return{width,height,data:new Uint8ClampedArray(width*height*4)};}
function rgb(image,x,y){return[...image.data.slice((y*image.width+x)*4,(y*image.width+x)*4+3)];}

test('light analysis preserves source bytes, geometry and true dark material',async()=>{
 const image=photo();for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const value=x>=50&&x<110&&y>=25&&y<65?24:Math.round(120+100*x/(image.width-1));image.data.set([value,value,value,255],(y*image.width+x)*4);}
 const before=sha(image.data),result=await prepareSelectionLighting(image);assert.equal(sha(image.data),before);assert.notEqual(result.image.data,image.data);assert.equal(result.image.width,image.width);assert.equal(result.image.height,image.height);assert.deepEqual(rgb(result.image,80,45),[24,24,24]);assert.equal(result.diagnostics.geometricResampling,false);assert.equal(result.diagnostics.inpaintedPixels,0);assert.ok(result.diagnostics.shadowAdjustedPixels>0);
});

test('bounded local correction increases the measured gradient of a blurred visible edge',async()=>{
 const image=photo(160,90);for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const value=Math.round(35+185/(1+Math.exp((x-80)/1.6)));image.data.set([value,value,value,255],(y*image.width+x)*4);}
 const result=await prepareSelectionLighting(image),gradient=source=>{let peak=0,index=0;for(let x=70;x<90;x++){const delta=Math.abs(source.data[(45*source.width+x+1)*4]-source.data[(45*source.width+x-1)*4])/2;if(delta>peak){peak=delta;index=x;}}return{peak,index};},before=gradient(image),after=gradient(result.image);
 assert.ok(after.peak>before.peak,JSON.stringify({before,after}));assert.ok(Math.abs(after.index-before.index)<=1,'visible edge must stay at its source position');assert.ok(result.diagnostics.maxSharpening<=8);assert.ok(result.diagnostics.sharpenedPixels>0);
});

test('saturated highlights are reported and compressed without fabricated texture or colour',async()=>{
 const image=photo(80,60);for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const value=x>=30&&x<50?255:150;image.data.set([value,value,value,255],(y*image.width+x)*4);}
 const result=await prepareSelectionLighting(image);assert.equal(result.diagnostics.clippedPixels,20*60);assert.ok(result.diagnostics.specularCompressedPixels>0);assert.equal(result.diagnostics.requiresManual,true);const pixel=rgb(result.image,40,30);assert.equal(pixel[0],pixel[1]);assert.equal(pixel[1],pixel[2]);assert.ok(pixel[0]<255);assert.equal(result.diagnostics.inpaintedPixels,0);
});

test('flat sensor noise is not amplified into invented material and lighting can be cancelled',async()=>{
 const image=photo(80,60);for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const value=150+(x+y)%2;image.data.set([value,value,value,255],(y*image.width+x)*4);}
 const result=await prepareSelectionLighting(image),values=[];for(let y=10;y<50;y++)for(let x=10;x<70;x++)values.push(result.image.data[(y*image.width+x)*4]);assert.ok(Math.max(...values)-Math.min(...values)<=3);
 const controller=new AbortController();controller.abort();await assert.rejects(prepareSelectionLighting(image,{signal:controller.signal}),{name:'AbortError'});
});
