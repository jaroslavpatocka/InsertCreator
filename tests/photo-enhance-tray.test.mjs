// Known synthetic tool silhouettes on coloured cut foam; no product-photo pixels.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {fileURLToPath} from 'node:url';
import {recognizeTools} from '../dist/recognize.js';

// Snapshot the original Windows canvas labels (bold 10px sans-serif) instead
// of relying on a different system font on Linux. The 40x16 opaque cells retain
// every original label/background pixel; three cells read 12mm, 13mm and 14mm.
// Each cell was verified byte-for-byte against the original direct text render.
const printedLabels=await loadImage(fileURLToPath(new URL('./fixtures/tray-labels.png',import.meta.url)));
const WIDTH=600,HEIGHT=420;
function trayFixture({foamColor='#008fca',gripColor='#d65d35',recesses=true,colouredShafts=false,smallHeads=false,smallBars=false,edgeTool=false,insetTools=false}={}){
  const photo=createCanvas(WIDTH,HEIGHT),ctx=photo.getContext('2d');
  const truth=createCanvas(WIDTH,HEIGHT),known=truth.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,WIDTH,HEIGHT);
  ctx.fillStyle='#202225';ctx.fillRect(25,25,550,370);
  const tools=[];
  function record(name,paint,minimumIoU=.9){
    known.clearRect(0,0,WIDTH,HEIGHT);known.fillStyle='#fff';paint(known);
    const pixels=known.getImageData(0,0,WIDTH,HEIGHT).data,mask=new Uint8Array(WIDTH*HEIGHT);
    let x0=WIDTH,y0=HEIGHT,x1=0,y1=0;
    for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++)if(pixels[(y*WIDTH+x)*4+3]>=128){mask[y*WIDTH+x]=1;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}
    tools.push({name,mask,minimumIoU,bounds:{x0,y0,x1,y1}});
  }
  const rows=[90,170,250];
  // The recesses connect through a blue web, even though the tools remain separate.
  if(recesses){
    ctx.fillStyle=foamColor;ctx.fillRect(102,65,14,210);
    for(const y of rows){
      ctx.beginPath();ctx.roundRect(107,y-24,67,48,5);ctx.fill();
      ctx.beginPath();ctx.roundRect(164,y-17,70,34,4);ctx.fill();
    }
  }
  for(const [i,y] of rows.entries()){
    const shape=target=>{target.beginPath();target.roundRect(115,y-18,55,36,3);target.fill();target.fillRect(165,y-11,60,22);};
    const gradient=ctx.createLinearGradient(0,y-18,0,y+18);gradient.addColorStop(0,'#a5adb5');gradient.addColorStop(.45,'#eef1f2');gradient.addColorStop(1,'#a8aeb3');ctx.fillStyle=gradient;shape(ctx);
    if(colouredShafts){ctx.fillStyle=gripColor;ctx.fillRect(170,y-11,55,22);}
    record(`socket ${i+1}`,shape);
    // Small, separate printed size glyphs, not raised objects or loose tools.
    ctx.drawImage(printedLabels,0,i*16,40,16,245,y-9,40,16);
  }
  // A real coloured grip has its own clear outline and joins a neutral metal head.
  const grip=target=>{target.fillRect(355,312,26,36);target.beginPath();target.roundRect(378,317,103,26,6);target.fill();};
  ctx.fillStyle='#bdc4cb';ctx.fillRect(355,312,26,36);
  ctx.fillStyle=gripColor;ctx.beginPath();ctx.roundRect(378,317,103,26,6);ctx.fill();
  record('tool with coloured grip',grip);
  const ring={x:425,y:115,r:15,rim:2};
  ctx.fillStyle='#d5d8dc';ctx.beginPath();ctx.arc(ring.x,ring.y,ring.r,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#202225';ctx.beginPath();ctx.arc(ring.x,ring.y,ring.r-ring.rim,0,Math.PI*2);ctx.fill();
  record('thin hollow socket',target=>{target.beginPath();target.arc(ring.x,ring.y,ring.r,0,Math.PI*2);target.fill();});
  if(smallHeads)for(const [i,x] of [100,115,130].entries()){
    const r=i===1?5:4.5,shape=target=>{target.beginPath();target.arc(x,350,r,0,Math.PI*2);target.fill();};
    // A one-pixel raster difference is a significant area fraction of a 9px head.
    ctx.fillStyle='#d5d8dc';shape(ctx);record(`small round head ${i+1}`,shape,.8);
  }
  if(edgeTool){
    const shape=target=>target.fillRect(28,280,16,80);
    ctx.fillStyle='#d5d8dc';shape(ctx);record('bright tool three pixels from tray edge',shape);
  }
  if(smallBars)for(const [i,x] of [100,110,120].entries()){
    const shape=target=>target.fillRect(x,350,6,10);
    ctx.fillStyle='#d5d8dc';shape(ctx);record(`small narrow part ${i+1}`,shape);
  }
  if(insetTools)for(const [i,y] of [150,200,250].entries()){
    const shape=target=>target.fillRect(360,y,120,36);
    ctx.fillStyle=foamColor;shape(ctx);ctx.fillStyle='#c4cbd2';ctx.fillRect(368,y+6,35,24);
    record(`coloured body with metal inset ${i+1}`,shape);
  }
  return {image:ctx.getImageData(0,0,WIDTH,HEIGHT),tools};
}
function bounds(contour){
  const xs=contour.points.map(p=>p.x),ys=contour.points.map(p=>p.y);
  return {x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys)};
}
function silhouette(contour){
  const canvas=createCanvas(WIDTH,HEIGHT),ctx=canvas.getContext('2d');
  ctx.beginPath();contour.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();
  const data=ctx.getImageData(0,0,WIDTH,HEIGHT).data;
  return Uint8Array.from({length:WIDTH*HEIGHT},(_,i)=>+(data[i*4+3]>=128));
}
function iou(a,b){let intersection=0,union=0;for(let i=0;i<a.length;i++){intersection+=+(a[i]&&b[i]);union+=+(a[i]||b[i]);}return union?intersection/union:0;}

function assertKnownTools(result,tools){
  assert.equal(result.quality.status,'ready',result.quality.reasons.join(' '));
  const masks=result.contours.map(silhouette),used=new Set();
  for(const tool of tools){
    const overlaps=masks.map(mask=>iou(mask,tool.mask)),best=Math.max(...overlaps),index=overlaps.indexOf(best);
    assert.ok(best>(tool.minimumIoU??.9),`${tool.name} must match the known physical silhouette, IoU=${best.toFixed(3)}`);
    assert.ok(!used.has(index),'one merged contour must not account for several tools');used.add(index);
    const actual=bounds(result.contours[index]);
    for(const key of ['x0','x1','y0','y1'])assert.ok(Math.abs(actual[key]-tool.bounds[key])<=2.5,`${tool.name} ${key} includes foam or clips the tool: ${actual[key]} vs ${tool.bounds[key]}`);
  }
  assert.equal(result.contours.length,tools.length,'blue foam and printed size labels must not add tool contours');
}

test('socket contours exclude connected blue recesses and printed labels while retaining a real coloured grip',async()=>{
  const {image,tools}=trayFixture(),result=await recognizeTools(image,{pxPerMm:2});
  assert.equal(result.enhanced,'dark-tray');assertKnownTools(result,tools);
  assert.equal(result.mask[130*WIDTH+109],0,'the connecting blue foam web is excluded');
  assert.equal(result.mask[330*WIDTH+435],1,'the coloured grip remains part of its real tool');
});

test('tray separation follows the photographed colours and preserves distinguishable coloured tools',async t=>{
  for(const [name,foamColor,gripColor] of [
    ['green foam with purple grip','#32964a','#ae49c1'],
    ['red foam with blue grip','#bb3a25','#267dcc'],
    ['purple foam with green grip','#8845ae','#47bb6d'],
    ['same chromaticity, brighter grip','rgb(0,100,150)','rgb(0,160,240)'],
    ['same colour and brightness on separate tools','#008fca','#008fca'],
  ])await t.test(name,async()=>{
    const {image,tools}=trayFixture({foamColor,gripColor}),result=await recognizeTools(image,{pxPerMm:2});
    assert.equal(result.enhanced,'dark-tray');assertKnownTools(result,tools);
    assert.equal(result.mask[130*WIDTH+109],0,'the coloured foam web remains background');
    assert.equal(result.mask[330*WIDTH+435],1,'the differently coloured or brighter grip remains a tool');
  });
});

test('coloured bodies with metal insets remain tools beside a recess of the same colour',async()=>{
  const {image,tools}=trayFixture({insetTools:true}),result=await recognizeTools(image,{pxPerMm:2});
  assertKnownTools(result,tools);
  for(const y of [168,218,268])assert.equal(result.mask[y*WIDTH+450],1,'the coloured body is not erased as foam');
});

test('repeated coloured grips on a neutral mat are tools rather than a learned foam colour',async t=>{
  for(const gripColor of ['#008fca','#32964a','#d65d35','#bb3a25'])await t.test(gripColor,async()=>{
    const {image,tools}=trayFixture({recesses:false,colouredShafts:true,gripColor}),result=await recognizeTools(image,{pxPerMm:2});
    assertKnownTools(result,tools);
    for(const y of [90,170,250])assert.equal(result.mask[y*WIDTH+205],1,'repeated coloured shafts remain attached to their metal heads');
  });
});

test('small aligned round tool heads remain distinct real tools rather than printed glyphs',async()=>{
  const {image,tools}=trayFixture({recesses:false,smallHeads:true}),result=await recognizeTools(image,{pxPerMm:2});
  assertKnownTools(result,tools);
  for(const x of [100,115,130])assert.equal(result.mask[350*WIDTH+x],1,'a small round head remains present');
});

test('aligned small solid parts are not deleted as letters',async()=>{
  const {image,tools}=trayFixture({recesses:false,smallBars:true}),result=await recognizeTools(image,{pxPerMm:2});
  assertKnownTools(result,tools);
  for(const x of [103,113,123])assert.equal(result.mask[355*WIDTH+x],1,'a narrow solid part remains present');
});

test('a bright tool close to the tray edge retains its physical width and position',async()=>{
  const {image,tools}=trayFixture({recesses:false,edgeTool:true}),result=await recognizeTools(image,{pxPerMm:2});
  assertKnownTools(result,tools);
  assert.equal(result.mask[320*WIDTH+28],1,'the tool edge three pixels inside the tray is retained');
  assert.equal(result.mask[320*WIDTH+24],0,'the white area outside the tray is still excluded');
});

test('coloured tools on a light coloured plain background use the normal image path',async()=>{
  const canvas=createCanvas(WIDTH,HEIGHT),ctx=canvas.getContext('2d');
  ctx.fillStyle='#f0dfc9';ctx.fillRect(0,0,WIDTH,HEIGHT);
  const tools=[];
  for(const [i,colour] of ['#244a91','#952c4c','#216646'].entries()){
    const x=90+i*150,y=105,w=40,h=180;ctx.fillStyle=colour;ctx.fillRect(x,y,w,h);
    const mask=new Uint8Array(WIDTH*HEIGHT);for(let yy=y;yy<y+h;yy++)mask.fill(1,yy*WIDTH+x,yy*WIDTH+x+w);
    tools.push({name:`coloured tool ${i+1}`,mask,bounds:{x0:x,x1:x+w,y0:y,y1:y+h}});
  }
  const result=await recognizeTools(ctx.getImageData(0,0,WIDTH,HEIGHT),{pxPerMm:2});
  assert.equal(result.enhanced,undefined);assertKnownTools(result,tools);
});
