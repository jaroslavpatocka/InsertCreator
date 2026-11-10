import test from 'node:test';
import assert from 'node:assert/strict';
import {traceMask} from '../dist/trace.js';
import {analyzeAlphaComponents} from '../dist/alpha-contrast.js';

// Analytic controls exercise evidence and identity decisions, not NN quality.
function photo({scale=1,foreground=[25,25,25],background=[230,230,230],soft=0,atBorder=false,uniformSource=false,multicolor=false}={}){
 const width=Math.round(160*scale),height=Math.round(120*scale),source={width,height,data:new Uint8ClampedArray(width*height*4)},image={width,height,data:new Uint8ClampedArray(width*height*4)},x0=atBorder?0:30*scale,x1=130*scale,y0=atBorder?0:25*scale,y1=95*scale;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const p=(y*width+x)*4,d=Math.min(x+.5-x0,x1-x-.5,y+.5-y0,y1-y-.5),inside=d>=0,band=soft*scale,alpha=band?Math.round(Math.max(0,Math.min(1,.5+d/band))*255):inside?255:0;
  const material=multicolor?(x<(x0+x1)/2?[18,25,35]:y<(y0+y1)/2?[230,140,20]:[150,165,180]):foreground,rgb=inside&&!uniformSource?material:background;
  source.data.set([...rgb,255],p);image.data.set(alpha?[...rgb,alpha]:[0,0,0,0],p);
 }
 return{source,image};
}
function analyze({source,image},embedded=false,signal){const mask=Uint8Array.from({length:image.width*image.height},(_,p)=>+(image.data[p*4+3]>=128)),trace=traceMask(mask,image.width,image.height,{minArea:1,minComponentPixels:1,keepBorder:true,smoothing:.25,includeLabels:true});return analyzeAlphaComponents(image,{source:embedded?image:source,labels:trace.labels,contours:trace.contours,signal});}

test('dark tool, low-contrast light metal and multicolor material retain their sharp component',()=>{
 for(const options of [{foreground:[10,14,20]},{foreground:[238,238,238],background:[220,220,220]},{multicolor:true}])for(const embedded of [false,true]){
  const input=photo(options),before=structuredClone(input),result=analyze(input,embedded);assert.equal(result.components.length,1);assert.equal(result.components[0].decision,'keep');assert.deepEqual(input,before);
 }
});
test('a large flat plate touching the image boundary is retained without size or border veto',()=>{
 const input=photo({atBorder:true,foreground:[195,195,195]});for(const embedded of [false,true]){const component=analyze(input,embedded).components[0];assert.equal(component.decision,'keep');assert.equal(component.bounds.x0,0);assert.equal(component.bounds.y0,0);assert.equal(component.evidence.textureFraction,0);}
});
test('transparent black RGB is never treated as observed background contrast',()=>{
 const input=photo({soft:30,uniformSource:true,background:[150,150,150]}),component=analyze(input,true).components[0];assert.equal(component.decision,'pending');assert.equal(component.evidence.sourceBoundaryCoverage,0);assert.equal(component.evidence.edgeSupportFraction,null);
 assert.equal(analyze(input,false).components[0].decision,'pending','the opaque original confirms the unsupported boundary');
});
test('wide flat alpha without context stays pending at half, native and double scale',()=>{
 for(const scale of [.5,1,2]){const input=photo({scale,soft:30,uniformSource:true,background:[150,150,150]}),snapshot=structuredClone(input),component=analyze(input,true).components[0];assert.equal(component.decision,'pending');assert.ok(component.evidence.featherP90>component.evidence.featherThreshold);assert.ok(component.evidence.featherMeasuredFraction>=.5);assert.deepEqual(input,snapshot,'pending is classification only; raw alpha and RGB remain recoverable');}
});
test('opaque source can support a uniform tool whose broad alpha alone needs review',()=>{
 const input=photo({soft:12,foreground:[25,25,25]});assert.equal(analyze(input,false).components[0].decision,'keep');assert.equal(analyze(input,true).components[0].decision,'pending');
});
test('partial-opacity thin material is not removed merely because no opaque core was observed',()=>{
 const input=photo({foreground:[190,190,190]});for(let p=3;p<input.image.data.length;p+=4)if(input.image.data[p])input.image.data[p]=180;const component=analyze(input,true).components[0];assert.equal(component.decision,'keep');assert.equal(component.evidence.featherMeasuredFraction,0);
});
test('existing labels and source coordinate agreement are required, and abort is explicit',()=>{
 const input=photo(),mask=Uint8Array.from({length:input.image.width*input.image.height},(_,p)=>+(input.image.data[p*4+3]>=128)),trace=traceMask(mask,input.image.width,input.image.height,{includeLabels:true});assert.throws(()=>analyzeAlphaComponents(input.image,{labels:trace.labels,contours:[{points:[]}]}),/labels and contours/);assert.throws(()=>analyzeAlphaComponents(input.image,{source:{...input.source,width:1},labels:trace.labels,contours:trace.contours}),/Matching/);const controller=new AbortController();controller.abort();assert.throws(()=>analyze(input,false,controller.signal),{name:'AbortError'});
});
test('a full-frame alpha with no observable component boundary stays recoverable but unassigned',()=>{
 const width=32,height=24,image={width,height,data:new Uint8ClampedArray(width*height*4)};for(let p=0;p<image.data.length;p+=4)image.data.set([140,145,150,255],p);const input={source:structuredClone(image),image},before=structuredClone(input);
 for(const embedded of [false,true]){const component=analyze(input,embedded).components[0];assert.equal(component.decision,'pending');assert.equal(component.reason,'no-measurable-component-boundary');assert.equal(component.evidence.boundarySamples,0);assert.deepEqual(input,before);}
});
