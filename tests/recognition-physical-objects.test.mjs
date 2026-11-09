import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Worker as NativeWorker} from 'node:worker_threads';
import {recognizeToolRegions} from '../dist/tool-recognition.js';
import {recognizeTools} from '../dist/recognize.js';

const palette=[[195,38,48],[30,76,190],[225,195,30],[24,30,25]];
const sha=data=>createHash('sha256').update(data).digest('hex');
const rounded=(x,y,x0,y0,w,h,r)=>x>=x0&&x<=x0+w&&y>=y0&&y<=y0+h&&Math.hypot(Math.max(0,x0+r-x,x-x0-w+r),Math.max(0,y0+r-y,y-y0-h+r))<=r;

/** Independent source geometry and physical identities, never inferred from color. */
export function physicalPhoto(spec){
  const width=640,height=400,data=new Uint8ClampedArray(width*height*4),labels=new Uint8Array(width*height),empty=new Uint8Array(width*height);
  const bg=spec.background??[255,255,255],colors=spec.order??[0,1,2,3];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let rgb=bg,id=0,protectedEmpty=false;
    if(spec.shape==='helix'){
      const handle=rounded(x,y,340,155,190,90,26),shaft=x>=95&&x<=340&&Math.abs(y-200)<=11+3*Math.sin((x-95)*Math.PI/7),collar=x>=300&&x<=340&&Math.abs(y-200)<=14;
      if(handle||shaft||collar){
        id=1;
        if(handle)rgb=palette[colors[Math.min(3,Math.floor((x-340)/47.5))]];
        else{const light=195+50*Math.sin(x*Math.PI/7+(y-200)*.5);rgb=[light,light+1,light+2];}
        if(collar){rgb=spec.rim?bg:[175,183,188];if(spec.rim&&Math.abs(y-200)>=12)rgb=[115,120,125];}
      }
      if(spec.gap&&x>=300&&x<300+spec.gap){id=0;rgb=bg;}
      if(spec.gap&&id&&x>=300+spec.gap)id=2;
      protectedEmpty=!!spec.gap&&x>=302&&x<298+spec.gap&&Math.abs(y-200)<=9;
    }else if(spec.shape==='bars'){
      const angle=(spec.angle??0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),dx=x-320,dy=y-200,u=dx*c+dy*s,v=-dx*s+dy*c;
      const count=spec.count??2,length=spec.length??140,gap=spec.gap??20,total=count*length+(count-1)*gap;
      for(let j=0;j<count;j++){
        const start=-total/2+j*(length+gap),local=u-start;
        if(local>=0&&local<length&&Math.abs(v)<14){id=j+1;rgb=palette[colors[Math.min(3,Math.floor(local/length*4))]];}
        if(j<count-1&&u>=start+length+1.5&&u<start+length+gap-1.5&&Math.abs(v)<10)protectedEmpty=true;
      }
    }else if(spec.shape==='side-by-side'){
      const count=spec.count??2,gap=spec.gap??6,width=24,left=320-(count*width+(count-1)*gap)/2;
      for(let j=0;j<count;j++){
        const start=left+j*(width+gap);
        if(x>=start&&x<start+width&&y>=65&&y<335){id=j+1;rgb=palette[colors[Math.min(3,Math.floor((y-65)/67.5))]];}
        if(j<count-1&&x>=start+width+1.5&&x<start+width+gap-1.5&&y>80&&y<320)protectedEmpty=true;
      }
    }else if(spec.shape==='jaw'){
      if(x>=160&&x<480&&y>=75&&y<285&&(x<210||x>=430||y>=230)){id=1;rgb=palette[colors[Math.min(3,Math.floor((x-160)/80))]];}
      protectedEmpty=x>=230&&x<410&&y>=90&&y<205;
    }else if(spec.shape==='mixed-sizes'){
      if(x>=155&&x<171&&y>=45&&y<235){id=1;rgb=[96,103,108];}
      if(rounded(x,y,130,225,65,125,14)){id=1;rgb=palette[colors[0]];}
      if(x>=335&&x<351&&y>=105&&y<190){id=2;rgb=[80,87,91];}
      if(rounded(x,y,395,245,30,40,5)){id=3;rgb=palette[colors[2]];}
      protectedEmpty=x>205&&x<320&&y>110&&y<180;
    }else throw new Error('Unknown physical fixture '+spec.shape);
    labels[y*width+x]=id;empty[y*width+x]=+protectedEmpty;
    data.set([...rgb.map(value=>Math.max(0,Math.min(255,Math.round(value)))),255],(y*width+x)*4);
  }
  return{width,height,data,labels,empty,name:spec.name,spec};
}

function inside(x,y,points){let odd=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)odd=!odd;}return odd;}
function nearContour(x,y,points,radius){
  if(inside(x,y,points))return true;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[j],b=points[i],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/length)):0;
    if(Math.hypot(x-a.x-t*dx,y-a.y-t*dy)<=radius)return true;
  }
  return false;
}
const bounds=points=>({minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))});

export function measurePhysical(photo,result){
  const ids=[...new Set(photo.labels)].filter(Boolean),instances=[];
  const nearMask=(p,radius)=>{
    const x=p%photo.width,y=Math.floor(p/photo.width);
    for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++)if(dx*dx+dy*dy<=radius*radius&&x+dx>=0&&x+dx<photo.width&&y+dy>=0&&y+dy<photo.height&&result.mask[(y+dy)*photo.width+x+dx])return true;
    return false;
  };
  const near1=new Uint8Array(photo.labels.length),near2=new Uint8Array(photo.labels.length);
  let emptyPixels=0,falseFill=0,truthPixels=0,coveredPixels=0,coveredWithin1px=0,coveredWithin2px=0;
  for(let p=0;p<photo.labels.length;p++){
    if(photo.labels[p]){truthPixels++;coveredPixels+=+!!result.mask[p];near1[p]=+nearMask(p,1);near2[p]=near1[p]||+nearMask(p,2);coveredWithin1px+=near1[p];coveredWithin2px+=near2[p];}
    if(photo.empty[p]){emptyPixels++;falseFill+=+!!result.mask[p];}
  }
  for(const id of ids){
    let pixels=0,covered=0,within1=0,within2=0;const hits=new Uint32Array(result.contours.length),points=[];
    for(let p=0;p<photo.labels.length;p++)if(photo.labels[p]===id){
      pixels++;covered+=+!!result.mask[p];within1+=near1[p];within2+=near2[p];const x=p%photo.width,y=Math.floor(p/photo.width);points.push({x,y});
      result.contours.forEach((contour,i)=>{if(inside(x+.5,y+.5,contour.points))hits[i]++;});
    }
    const dominant=hits.length?hits.indexOf(Math.max(...hits)):-1,sourceBounds=bounds(points),contourBounds=dominant>=0?bounds(result.contours[dominant].points):null;
    const dominantCoverageWithin2px=dominant<0?0:points.reduce((sum,p)=>sum+ +nearContour(p.x+.5,p.y+.5,result.contours[dominant].points,2),0)/pixels;
    instances.push({id,pixels,coverage:covered/pixels,coverageWithin1px:within1/pixels,coverageWithin2px:within2/pixels,dominantContour:dominant,dominantCoverage:dominant<0?0:hits[dominant]/pixels,dominantCoverageWithin2px,sourceBounds,contourBounds,boundsErrorPx:contourBounds?Math.max(...Object.keys(sourceBounds).map(key=>Math.abs(sourceBounds[key]-contourBounds[key]))):Infinity});
  }
  return{width:result.width,height:result.height,expectedInstances:ids.length,contours:result.contours.length,status:result.quality.status,method:result.method,coverage:coveredPixels/truthPixels,coverageWithin1px:coveredWithin1px/truthPixels,coverageWithin2px:coveredWithin2px/truthPixels,emptyPixels,falseFill,emptyFalseFill:emptyPixels?falseFill/emptyPixels:0,instances};
}

export const physicalSpecs=[
  {name:'one-helix-red-blue-yellow-black',shape:'helix'},
  {name:'one-helix-yellow-black-blue-red',shape:'helix',order:[2,3,1,0]},
  {name:'one-helix-black-yellow-red-blue',shape:'helix',order:[3,2,0,1]},
  {name:'one-helix-gray-visible-rim',shape:'helix',rim:true,background:[145,148,151]},
  {name:'two-physical-helix-pieces-gap6',shape:'helix',gap:6},
  {name:'two-physical-helix-pieces-gap20',shape:'helix',gap:20},
  ...[6,20].flatMap(gap=>[
    {name:`two-end-to-end-gap${gap}`,shape:'bars',gap},
    {name:`three-end-to-end-gap${gap}`,shape:'bars',gap,count:3,length:120},
    {name:`two-end-to-end-rotated37-gap${gap}`,shape:'bars',gap,angle:37},
    {name:`two-side-by-side-gap${gap}`,shape:'side-by-side',gap},
    {name:`three-side-by-side-gap${gap}`,shape:'side-by-side',gap,count:3}
  ]),
  {name:'one-open-U-jaw',shape:'jaw'},
  {name:'large-tool-and-two-small-tools',shape:'mixed-sizes'}
];

export function assertPhysical(metrics,label){
  assert.equal(metrics.width,640,label+' source width');assert.equal(metrics.height,400,label+' source height');
  assert.ok(['ready','review'].includes(metrics.status),label+' must produce usable proposals with an explicit quality status');
  assert.equal(metrics.contours,metrics.expectedInstances,label+' physical count');
  assert.ok(metrics.coverageWithin2px>=.99,`${label}: whole-material coverage within two source pixels ${metrics.coverageWithin2px}; raw ${metrics.coverage}`);
  assert.ok(metrics.emptyFalseFill<=.005,`${label}: protected empty region falsely filled ${metrics.falseFill}/${metrics.emptyPixels}`);
  assert.equal(new Set(metrics.instances.map(instance=>instance.dominantContour)).size,metrics.expectedInstances,label+' distinct physical identities');
  for(const instance of metrics.instances){
    // Manufacturing uses the contour polygon. Keep strict and raster-distance
    // measurements above, but allow at most two source pixels at its boundary.
    assert.ok(instance.dominantCoverageWithin2px>=.99,`${label} physical ${instance.id}: contour identity coverage within two source pixels ${instance.dominantCoverageWithin2px}; raw ${instance.dominantCoverage}`);
    assert.ok(instance.boundsErrorPx<=3,`${label} physical ${instance.id}: source-coordinate bounds drift ${instance.boundsErrorPx}px`);
  }
}

export function actualWorkers({captureInference=false}={}){
  const previous=globalThis.Worker,workers=new Set(),calls=[],created=[],terminated=[],inferenceResults=[];
  globalThis.Worker=class{
    constructor(url){
      this.url=String(url);created.push(this.url);this.native=new NativeWorker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{url:this.url}});workers.add(this);
      this.native.on('message',data=>{if(captureInference&&this.url.endsWith('/tool-neural-worker.js')&&data.type==='result')inferenceResults.push(structuredClone(data));this.onmessage?.({data});});this.native.on('error',error=>this.onerror?.({error,message:error.message,preventDefault(){}}));this.native.on('messageerror',error=>this.onmessageerror?.({error}));
    }
    postMessage(data,transfer){calls.push({url:this.url,type:data.type??null,width:data.width??data.image?.width,height:data.height??data.image?.height,pxPerMm:data.options?.pxPerMm,hasProbability:!!data.options?.probability});this.native.postMessage(data,transfer);}
    terminate(){if(workers.delete(this))terminated.push(this.url);return this.native.terminate();}
  };
  return{calls,created,terminated,inferenceResults,get active(){return workers.size;},async close(){await Promise.all([...workers].map(worker=>worker.terminate()));if(previous===undefined)delete globalThis.Worker;else globalThis.Worker=previous;}};
}

export async function evaluatePhysical(spec,recognizer=recognizeTools,pxPerMm=2){
  const photo=physicalPhoto(spec),before=sha(photo.data),start=performance.now();
  const source={width:photo.width,height:photo.height,data:photo.data};
  const result=await recognizer(source,{pxPerMm,kind:'reference'});
  assert.equal(sha(photo.data),before,spec.name+' source RGBA immutable');
  return{case:spec.name,sourceSha256:before,sourceUnchanged:true,pxPerMm,durationMs:performance.now()-start,metrics:measurePhysical(photo,result),neuralModel:result.neuralModel??null,neuralUnavailable:!!result.neuralUnavailable,context:result.neuralContext??result.diagnostics?.neuralContext??null,quality:result.quality};
}

if(!process.argv.includes('--fixture-library')){
  test('source-guided contour tracing preserves physical identity with a complete learned foreground',async t=>{
    // All physical fixtures remain controls, including gray material whose
    // binary-prior disagreement exposed the previous candidate-selection bug.
    for(const spec of physicalSpecs)await t.test(spec.name,async()=>{
      const photo=physicalPhoto(spec),before=sha(photo.data),probability=Float32Array.from(photo.labels,id=>id ? .999 : 0);
      const source={width:photo.width,height:photo.height,data:photo.data};
      const result=await recognizeToolRegions(source,{pxPerMm:2,kind:'reference',probability});
      assert.equal(sha(photo.data),before);assertPhysical(measurePhysical(photo,result),spec.name);
    });
  });

  test('actual local ONNX recognition preserves full material, separate tools and open jaws',{timeout:180000},async t=>{
    const workers=actualWorkers();
    try{
      const selected=['one-helix-red-blue-yellow-black','one-helix-gray-visible-rim','two-physical-helix-pieces-gap20','three-end-to-end-gap6','large-tool-and-two-small-tools','one-open-U-jaw'];
      for(const name of selected)await t.test(name,async()=>{
        const spec=physicalSpecs.find(candidate=>candidate.name===name),start=workers.calls.length,row=await evaluatePhysical(spec);
        t.diagnostic(JSON.stringify({...row,workerCalls:workers.calls.slice(start)}));
        const calls=workers.calls.slice(start),neuralCalls=calls.filter(call=>call.url.endsWith('/tool-neural-worker.js'));
        assert.equal(row.neuralUnavailable,false,name+' actual model must not silently fail');assert.equal(row.neuralModel,'fastsam-s',name+' must use the actual instance model');
        assert.equal(neuralCalls.length,1,name+' one actual instance inference');
        assert.ok(calls.filter(call=>call.url.endsWith('/recognize-worker.js')).every(call=>call.pxPerMm===2),name+' reference scale forwarded unchanged');
        assert.equal(workers.active,0,name+' inference and contour workers are released before the result is consumed');
        assertPhysical(row.metrics,name);
      });
      assert.ok(workers.calls.some(call=>call.url.endsWith('/tool-neural-worker.js')),'actual bundled instance worker must execute');
    }finally{await workers.close();}
  });
}
