import test from 'node:test';
import assert from 'node:assert/strict';
import { darkMetalBackgroundImage } from '../dist/photo-metal-background.js';
import { recognizeTools } from '../dist/recognize.js';
import { readableImage } from '../dist/photo-enhance.js';

// Geometric truth is independent of the image preparation: silver C-head,
// narrow shaft and ring on a charcoal surface. A black band remains physical
// material even when an antialiased hairline happens to equal the background.
function wrenchImage({ angle = 0, gap = 0, blackBand = true, bandGap = 1, background = [40,40,40], gradient = false, oneSided = false, foreign = false, weakTool = false, weakLevel = 20, softShadow = false } = {}) {
  const width=520,height=340,tool={x:260,y:170,angle},data=new Uint8ClampedArray(width*height*4),truth=new Uint8Array(width*height);
  const c=Math.cos(angle),s=Math.sin(angle);
  const shape=(x,y)=>x>=-100&&x<=85&&Math.abs(y)<=12 || Math.hypot(x+100,y)<=30&&!(x < -95&&Math.abs(y)<13) || Math.hypot(x-100,y)<=21&&Math.hypot(x-100,y)>=12;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x,xx=(x+.5-tool.x)*c+(y+.5-tool.y)*s,yy=-(x+.5-tool.x)*s+(y+.5-tool.y)*c;
    const change=gradient?Math.round(3*(x/width-.5)+2*(y/height-.5)):0;
    const shade=softShadow?Math.round(24*Math.exp(-(((xx-20)/60)**2+((yy-22)/18)**2))):0,bg=background.map(v=>v+change-shade);
    let rgb=bg;
    if(shape(xx,yy)){
      truth[p]=1;rgb=[210,212,214];
      if(blackBand&&xx>=-67&&xx<-63)rgb=[8,9,10];
      const hairline=blackBand?bandGap:gap;
      if(hairline&&xx>=-68&&xx<-68+hairline){rgb=bg;if(!blackBand)truth[p]=0;}
    }
    if(oneSided&&xx>=-67&&xx<-63&&yy>=-12)rgb=[8,9,10];
    if(foreign&&xx>=-69&&xx<-62&&yy>=13&&yy<25)rgb=[205,207,209];
    if(weakTool&&x>=320&&x<460&&y>=270&&y<286)rgb=[weakLevel,weakLevel,weakLevel];
    data.set([...rgb,255],p*4);
  }
  return {width,height,data,truth,tool};
}
const point=(image,x,y)=>({x:image.tool.x+x*Math.cos(image.tool.angle)-y*Math.sin(image.tool.angle),y:image.tool.y+x*Math.sin(image.tool.angle)+y*Math.cos(image.tool.angle)});
const pixel=(image,at)=>image.data[(Math.floor(at.y)*image.width+Math.floor(at.x))*4];
const preparedOrOriginal=(image,prepared)=>prepared?.image??image;
function foregroundLabels(image){
  const {width:w,height:h,data}=image,labels=new Int32Array(w*h),queue=new Int32Array(w*h);let next=0;
  for(let start=0;start<labels.length;start++){
    if(labels[start]||data[start*4]>=128)continue;const id=++next;let head=0,tail=1;queue[0]=start;labels[start]=id;
    while(head<tail){const p=queue[head++],x=p%w;const push=n=>{if(!labels[n]&&data[n*4]<128){labels[n]=id;queue[tail++]=n;}};if(x)push(p-1);if(x+1<w)push(p+1);if(p>=w)push(p-w);if(p+w<labels.length)push(p+w);}
  }
  return {labels,at:at=>labels[Math.floor(at.y)*w+Math.floor(at.x)]};
}
const detail=prepared=>JSON.stringify(prepared&&{name:prepared.name,wideFragments:prepared.wideFragments,ambiguousMaterial:prepared.ambiguousMaterial});

test('dark neutral metal preparation keeps source pixels, dimensions, jaws and ring openings',()=>{
  const image=wrenchImage({gradient:true}),original=image.data.slice(),prepared=darkMetalBackgroundImage(image);
  assert.ok(prepared,detail(prepared));assert.equal(prepared.name,'plain-background');assert.equal(prepared.wideFragments,false);
  assert.equal(prepared.image.width,image.width);assert.equal(prepared.image.height,image.height);assert.deepEqual(image.data,original);
  for(const [x,y] of [[-110,0],[100,0],[0,50]])assert.ok(pixel(prepared.image,point(image,x,y))>240,`background opening moved at ${x},${y}`);
  for(const [x,y] of [[-100,-20],[0,0],[100,-17]])assert.ok(pixel(prepared.image,point(image,x,y))<128,`measured silver material omitted at ${x},${y}`);
});

test('a measured black band reconnects a compact head across only its one-pixel antialiased hairline',()=>{
  const image=wrenchImage(),prepared=darkMetalBackgroundImage(image);assert.ok(prepared,detail(prepared));
  const labels=foregroundLabels(prepared.image),head=labels.at(point(image,-100,-20)),shaft=labels.at(point(image,0,0));
  assert.ok(head&&shaft);assert.equal(head,shaft,'one physical wrench must remain one component');
  assert.ok(pixel(prepared.image,point(image,-67.5,0))<128,'the supported band may span its bounded antialiasing seam');
  assert.equal(prepared.ambiguousBridge,true,'the pixel-identical alternative of a real one-pixel gap requires review');
});

test('a rotated source-supported band preserves the head and the real open jaw',()=>{
  const image=wrenchImage({angle:.23}),prepared=darkMetalBackgroundImage(image);assert.ok(prepared,detail(prepared));
  const labels=foregroundLabels(prepared.image);assert.equal(labels.at(point(image,-100,-20)),labels.at(point(image,0,0)));
  assert.ok(labels.at(point(image,0,0)));assert.ok(pixel(prepared.image,point(image,-110,0))>240,'rotated jaw is background');
  assert.equal(prepared.ambiguousBridge,true,'the unobserved rotated hairline must retain an explicit review flag');
});

for(const gap of [1,2,3])test(`a genuine ${gap}-pixel background gap cannot be joined without an observed dark band`,()=>{
  const image=wrenchImage({gap,blackBand:false}),prepared=darkMetalBackgroundImage(image);
  if(!prepared)return;
  const labels=foregroundLabels(prepared.image),head=labels.at(point(image,-100,-20)),shaft=labels.at(point(image,0,0));
  assert.ok(head&&shaft,detail(prepared));assert.notEqual(head,shaft,'separate physical pieces were merged by guessing a bridge');
  assert.ok(pixel(prepared.image,point(image,-68+gap/2,0))>240,'a visible full-background gap must remain background');
});

test('one-sided dark material cannot supply a fabricated opposite connector boundary',()=>{
  const image=wrenchImage({oneSided:true}),prepared=darkMetalBackgroundImage(image);
  if(!prepared)return;
  const labels=foregroundLabels(prepared.image),head=labels.at(point(image,-100,-20)),shaft=labels.at(point(image,0,0));
  assert.notEqual(head,shaft,'a dark stripe reaching the border has no measured lower boundary at the shaft');
});

test('connector recovery does not absorb a nearby independent silver part',()=>{
  const image=wrenchImage({foreign:true}),prepared=darkMetalBackgroundImage(image);
  if(!prepared)return;
  const labels=foregroundLabels(prepared.image),foreign=labels.at(point(image,-65,18)),shaft=labels.at(point(image,0,0));
  assert.ok(foreign&&shaft,detail(prepared));assert.notEqual(foreign,shaft,'a measured neighbouring component became part of the wrench');
});

test('a weak sharp dark part remains visible alongside brighter silver tools',()=>{
  const image=wrenchImage({weakTool:true}),prepared=darkMetalBackgroundImage(image);
  if(!prepared)return;
  for(const [x,y] of [[330,275],[400,280],[450,282]])assert.ok(pixel(prepared.image,{x,y})<128,'the visible weak tool was silently removed');
});

test('the specialized metal fallback leaves white, colored, empty and ordinary dark photos to their established paths',()=>{
  for(const background of [[250,250,250],[40,55,90]])assert.equal(darkMetalBackgroundImage(wrenchImage({background})),null);
  const dark=wrenchImage({blackBand:false});
  for(let p=0;p<dark.truth.length;p++)if(dark.truth[p])dark.data.set([16,18,20,255],p*4);
  assert.equal(darkMetalBackgroundImage(dark),null,'a dark-only object lacks dominant bright metal evidence');
  const empty=wrenchImage();for(let p=0;p<empty.width*empty.height;p++)empty.data.set([40,40,40,255],p*4);
  assert.equal(darkMetalBackgroundImage(empty),null);
});

test('textured dark material is not flattened into a trusted uniform background',()=>{
  const image=wrenchImage();
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
    const p=y*image.width+x;
    if(image.truth[p])continue;
    const level=(Math.floor(x/4)+Math.floor(y/4))%2?28:52;
    image.data.set([level,level,level,255],p*4);
  }
  assert.equal(darkMetalBackgroundImage(image),null,'unmodelled fabric/checker texture belongs to the established recognition path');
});

test('images beyond the dedicated recovery budget do not start an unbounded component search',()=>{
  const width=2001,height=1000,data=new Uint8ClampedArray(width*height*4);
  assert.equal(darkMetalBackgroundImage({width,height,data}),null);
  assert.equal(darkMetalBackgroundImage({width:10,height:10,data:new Uint8ClampedArray(400)}),null);
});

test('visible weak positive-contrast material is retained with review when the metal cutoff would omit it',()=>{
  const image=wrenchImage({weakTool:true,weakLevel:60}),prepared=darkMetalBackgroundImage(image);
  if(!prepared)return;
  assert.equal(prepared.ambiguousMaterial,true,'a sharp part below the positive-metal cutoff must not be silently dropped');
  for(const [x,y] of [[330,275],[400,280],[450,282]])assert.ok(pixel(prepared.image,{x,y})<128,'the visible weak part was omitted');
});

test('pixel-identical antialiasing and a real one-pixel gap beside a black band both require review',()=>{
  const hairline=wrenchImage({bandGap:1}),physicalGap=wrenchImage({bandGap:1});
  // Only physical truth differs; inference receives exactly identical pixels.
  for(let p=0;p<physicalGap.truth.length;p++){
    const x=p%physicalGap.width+.5-physicalGap.tool.x;
    if(x>=-68&&x<-67)physicalGap.truth[p]=0;
  }
  assert.deepEqual(hairline.data,physicalGap.data);
  for(const image of [hairline,physicalGap]){
    const prepared=darkMetalBackgroundImage(image);assert.ok(prepared,detail(prepared));
    assert.equal(prepared.ambiguousBridge,true,'an unverifiable one-pixel gap must not become a fully trusted tool');
  }
});

for(const gap of [2,3])test(`a true ${gap}-pixel background gap beside a dark band remains physically open`,()=>{
  const image=wrenchImage({bandGap:gap}),prepared=darkMetalBackgroundImage(image);
  if(!prepared)return;
  const labels=foregroundLabels(prepared.image);
  assert.notEqual(labels.at(point(image,-100,-20)),labels.at(point(image,0,0)),'a full background run was interpolated as metal');
  assert.ok(pixel(prepared.image,point(image,-68+gap/2,0))>240,'the visible gap was filled');
});

test('an interpolated band cannot be reported ready by the complete recognition flow',async()=>{
  const image=wrenchImage({softShadow:true}),selected=readableImage(image);
  assert.equal(selected?.ambiguousBridge,true,'the soft-shadow scene exercises the dedicated dark-metal fallback');
  const result=await recognizeTools(image,{pxPerMm:2});
  assert.notEqual(result.quality.status,'ready','source-indistinguishable seam and a real gap require user verification');
});



test('a two-pixel visible weak flange is preserved or explicitly left for source review',()=>{
  const image=wrenchImage({blackBand:false});
  // A narrow real extension sits directly against the shaft. Its sharp source
  // edge cannot be dismissed merely because retained bright material is near.
  for(let y=182;y<184;y++)for(let x=240;x<280;x++)image.data.set([60,60,60,255],(y*image.width+x)*4);
  const original=image.data.slice(),prepared=darkMetalBackgroundImage(image);
  assert.deepEqual(image.data,original,'small-part validation keeps the measurement source immutable');
  if(!prepared)return;
  const retained=[[245,182],[260,183],[275,183]].every(([x,y])=>pixel(prepared.image,{x,y})<128);
  assert.ok(retained||prepared.ambiguousMaterial===true,'a 2px by 40px sharp extension was silently erased');
});

test('a dedicated background proposal stays reviewable even without a dark band or connector recovery',async()=>{
  const image=wrenchImage({blackBand:false});
  // A detached soft cast shadow has no manufactured edge. It makes the general
  // background method uncertain while the dedicated metal proposal has no band
  // to repair; review must not depend on the presence of a repaired connector.
  for(let p=0;p<image.truth.length;p++)if(!image.truth[p]){
    const x=p%image.width+.5-image.tool.x,y=Math.floor(p/image.width)+.5-image.tool.y;
    const shade=Math.round(24*Math.exp(-(((x-20)/60)**2)-(((y-30)/12)**2))),level=40-shade;
    image.data.set([level,level,level,255],p*4);
  }
  const original=image.data.slice(),selected=readableImage(image);
  assert.equal(selected?.requiresReview,true,'the rejected general normalization exercises the dedicated fallback');
  assert.equal(selected.recoveredBands,0,'review cannot pass merely because a repaired band already requires it');
  assert.equal(selected.ambiguousBridge,false);
  const result=await recognizeTools(image,{pxPerMm:2});
  assert.equal(result.quality.status,'review','agreement on prepared pixels is not independent evidence of correct separation');
  assert.equal(result.requiresReview,true);assert.deepEqual(image.data,original);
  assert.equal(result.quality.reasons[0],'Na tmavém podkladu mohou sousední nebo málo kontrastní části splývat. Ověřte počet a oddělení nástrojů.');
});
test('the fallback review requirement retains a more specific source-bridge warning',async()=>{
  const image=wrenchImage({softShadow:true}),selected=readableImage(image);
  assert.equal(selected?.requiresReview,true);assert.equal(selected.ambiguousBridge,true);
  const result=await recognizeTools(image,{pxPerMm:2});
  assert.equal(result.quality.status,'review');assert.equal(result.requiresReview,true);
  assert.ok(result.quality.reasons[0].startsWith('Krátké přerušení obrysu bylo odhadnuto'),'generic fallback review must not replace the specific unresolved source-topology warning');
});

test('a raw retry cannot bypass source review after the prepared proposal was rejected',async()=>{
  const image=wrenchImage({softShadow:true}),source=image.data.slice();
  assert.equal(readableImage(image)?.requiresReview,true);
  const previousWorker=globalThis.Worker;
  try {
    for(const finalStatus of ['ready','retake']){
      let classicalCalls=0,neuralCalls=0;
      globalThis.Worker=class{
        constructor(url){this.neural=String(url).endsWith('neural-worker.js');}
        postMessage(message){
          if(this.neural){neuralCalls++;queueMicrotask(()=>this.onmessage?.({data:{id:message.id,type:'error',message:'Unavailable in the controlled retry fixture'}}));return;}
          const call=++classicalCalls,status=call===1?'retake':call===3?finalStatus:'ready';
          const result={contours:status==='retake'?[]:[{points:[{x:150,y:150},{x:300,y:150},{x:300,y:190},{x:150,y:190}]}],quality:{status,score0to1:.99,reasons:[]}};
          queueMicrotask(()=>this.onmessage?.({data:{result}}));
        }
        terminate(){}
      };
      const result=await recognizeTools(image,{pxPerMm:2});
      assert.equal(classicalCalls,3,'exercise prepared rejection, raw base and measured raw retry');
      assert.equal(neuralCalls,1,'exercise the ordinary recognition fallback');
      assert.equal(result.quality.status,finalStatus==='ready'?'review':'retake');
      if(finalStatus==='ready'){
        assert.equal(result.requiresReview,true);
        assert.equal(result.quality.reasons[0],'Na tmavém podkladu mohou sousední nebo málo kontrastní části splývat. Ověřte počet a oddělení nástrojů.');
        assert.equal(result.ambiguousBridge,undefined,'a raw retry did not use the proposed bridge');
      }
      assert.deepEqual(image.data,source);
    }
  } finally {
    if(previousWorker===undefined)delete globalThis.Worker;else globalThis.Worker=previousWorker;
  }
});
