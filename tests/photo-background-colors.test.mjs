import test from 'node:test';
import assert from 'node:assert/strict';
import {recognizeTools} from '../dist/recognize.js';
import {cases,renderCase} from './fixtures/color-tools.mjs';
import {maskMetrics,rasterizeContours} from './fixtures/tool-photos.mjs';
import {createCanvas,ImageData} from '@napi-rs/canvas';

const details=result=>JSON.stringify({quality:result.quality,diagnostics:result.diagnostics});
function assertPhysicalTools(result,image){
  assert.equal(result.quality.status,'ready',details(result));
  assert.equal(result.contours.length,image.tools.length,details(result));
  const masks=result.contours.map(c=>rasterizeContours([c],image.width,image.height)),used=new Set();
  for(const [i,known]of image.toolMasks.entries()){
    const matches=masks.map(mask=>maskMetrics(mask,known));
    const best=matches.reduce((a,b,index)=>b.iou>matches[a].iou?index:a,0),metrics=matches[best];
    assert.ok(metrics.iou>.9&&metrics.recall>.9&&metrics.precision>.9,`physical tool ${i}: ${JSON.stringify(metrics)}`);
    assert.ok(!used.has(best),'one contour cannot stand in for two physical tools');used.add(best);
  }
  for(const point of [...image.jaws,...image.gaps]){
    if(point.x<0||point.x>=image.width||point.y<0||point.y>=image.height)continue;
    assert.equal(result.mask[Math.floor(point.y)*image.width+Math.floor(point.x)],0,'jaw or inter-tool background was filled');
  }
  assert.ok(maskMetrics(result.mask,image.truth).iou>.9,details(result));
}

test('known multicolour physical tools retain complete silhouettes on varied coloured backgrounds',{timeout:240000},async t=>{
  const visible=cases.filter(c=>c.expect==='visible'&&!c.shadow);
  for(const spec of visible)await t.test(spec.id,async()=>{
    const image=renderCase(spec),source=image.data.slice();
    const result=await recognizeTools(image,{pxPerMm:image.pxPerMm,kind:'reference'});
    assertPhysicalTools(result,image);
    assert.deepEqual(image.data,source,'recognition must retain the original photograph');
  });
});

test('invisible boundaries and long missing connectors cannot be approved as complete tools',{timeout:30000},async t=>{
  for(const spec of cases.filter(c=>c.expect==='uncertain'))await t.test(spec.id,async()=>{
    const image=renderCase(spec),result=await recognizeTools(image,{pxPerMm:image.pxPerMm,kind:'reference'});
    assert.notEqual(result.quality.status,'ready',details(result));
    if(spec.invisible){assert.equal(result.contours.length,0);assert.equal(result.mask.some(Boolean),false);}
    if(spec.invisibleConnector){
      assert.equal(result.mask[Math.floor(image.tools[2].y)*image.width+Math.floor(image.tools[2].x+40)],0,'a missing connector cannot be invented');
    }
  });
});

test('cast shadows on grey and chromatic surfaces cannot become approved merged or expanded material',{timeout:60000},async t=>{
  for(const spec of cases.filter(c=>c.shadow))await t.test(spec.id,async()=>{
    const image=renderCase(spec),result=await recognizeTools(image,{pxPerMm:image.pxPerMm,kind:'reference'});
    // Ambiguous hard-shadow drafts may need manual review, but must never be
    // approved with the background web included in a manufacturing contour.
    if(result.quality.status==='ready')assertPhysicalTools(result,image);
    else assert.ok(['review','retake'].includes(result.quality.status),details(result));
  });
});

test('printed mat labels do not become tools while thin socket rims and dense small parts survive',{timeout:30000},async t=>{
  for(const bg of ['gray','charcoal','blue'])await t.test(bg,async()=>{
    const image=renderCase({bg,palette:'multicolor'}),canvas=createCanvas(image.width,image.height),ctx=canvas.getContext('2d');
    ctx.putImageData(new ImageData(image.data,image.width,image.height),0,0);
    ctx.fillStyle=bg==='gray'?'#242424':'#dddddd';ctx.font='bold 12px sans-serif';
    ctx.fillText('13 mm WERA',250,166);ctx.fillText('24 mm JOKER',250,305);
    for(const[x,y,r]of[[65,210,8],[92,210,11]]){
      const mask=new Uint8Array(image.width*image.height);
      for(let yy=y-r;yy<y+r;yy++)for(let xx=x-r;xx<x+r;xx++)if(Math.hypot(xx+.5-x,yy+.5-y)<=r){mask[yy*image.width+xx]=1;image.truth[yy*image.width+xx]=1;}
      image.toolMasks.push(mask);image.tools.push({type:'ring',x,y,angle:0});
      ctx.fillStyle='#d0d4d8';ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=bg==='gray'?'#919497':bg==='charcoal'?'#222529':'#145b8f';ctx.beginPath();ctx.arc(x,y,r-2,0,Math.PI*2);ctx.fill();
    }
    for(const x of [65,80]){
      const mask=new Uint8Array(image.width*image.height);
      for(let y=310;y<320;y++)for(let xx=x;xx<x+6;xx++){mask[y*image.width+xx]=1;image.truth[y*image.width+xx]=1;}
      image.toolMasks.push(mask);image.tools.push({type:'small-part',x,y:310,angle:0});ctx.fillStyle='#d0d4d8';ctx.fillRect(x,310,6,10);
    }
    const pixels=ctx.getImageData(0,0,image.width,image.height);image.data=pixels.data;
    const result=await recognizeTools(image,{pxPerMm:image.pxPerMm,kind:'reference'});
    assert.equal(result.quality.status,'review',details(result));
    assert.equal(result.ambiguousPrinting,true,'detected label rows must request an explicit selection');
    const masks=result.contours.map(c=>rasterizeContours([c],image.width,image.height)),used=new Set();
    for(const [index,known]of image.toolMasks.entries()){
      const matches=masks.map(mask=>maskMetrics(mask,known)),best=matches.reduce((a,b,i)=>b.iou>matches[a].iou?i:a,0);
      assert.ok(matches[best].iou>.9&&matches[best].recall>.9&&matches[best].precision>.9,`real part ${index} was changed: ${JSON.stringify(matches[best])}`);
      assert.ok(!used.has(best),'printing must not merge two real parts');used.add(best);
    }
  });
});
