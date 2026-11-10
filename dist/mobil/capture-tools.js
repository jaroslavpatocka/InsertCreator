import {simpleOutline,pocketOutline} from './finger-grip.js';
import {getToolDimensions,resizeToolDimensions} from './tool-dimensions.js';
import {CATEGORIES} from './tool-categories.js';
import {t,i18nError} from './i18n.js';
import {fitFunctionalPocket,fitHybridPocket} from './functional-pocket.js';
import {fitIdealPocket} from './ideal-pocket.js';
import {pocketFitSignature} from './pocket-fit-meta.js';
import {effectivePocketMargin,optionalPocketMargin} from './pocket-margin.js';
import {simple} from './contour-smoothing.js';

const categories=new Set(CATEGORIES.map(category=>category.id));
const geometryCache=new WeakMap();

/** Measured millimetre outline. Pocket fitting never overwrites this source. */
function sourcePoints(item,scale){
  if(item.editedPoints)return item.editedPoints.map(point=>({x:point.x,y:point.y}));
  return simpleOutline(item.contour.points.map(point=>({
    x:+((point.x-item.info.minX)/scale).toFixed(4),
    y:+((point.y-item.info.minY)/scale).toFixed(4)
  })));
}

/** Geometry in the measured source frame, including any outward fitting expansion. */
export function capturePocketGeometry(item,scale){
  const reference=item.editedPoints||item.contour.points,mode=item.pocketShape||'measured';
  let cached=geometryCache.get(item);
  const reserved=Number(item.contourReserveRatio)||0;
  if(!cached||cached.reference!==reference||cached.scale!==scale||cached.mode!==mode||cached.reserved!==reserved){
    const source=sourcePoints(item,scale);
    const fitted=mode==='ideal'?fitIdealPocket(source,{reserveRatio:reserved>0?0:.02}):mode==='hybrid'?fitHybridPocket(source):mode==='functional'?fitFunctionalPocket(source):{points:source,axis:null,primitives:[],kind:'measured'};
    cached={reference,scale,mode,reserved,geometry:fitted};geometryCache.set(item,cached);
  }
  const fitted=cached.geometry;
  return{...fitted,points:fitted.points.map(point=>({...point})),axis:fitted.axis?{start:{...fitted.axis.start},end:{...fitted.axis.end}}:null};
}

/** A fresh normalized manufacturing outline, without the project's pocket clearance. */
export function captureToolPoints(item,scale){
  const points=capturePocketGeometry(item,scale).points;
  const minX=Math.min(...points.map(point=>point.x)),minY=Math.min(...points.map(point=>point.y));
  return points.map(point=>({x:point.x-minX,y:point.y-minY}));
}

/** The fit and its axis in photo pixels, shared by both capture previews. */
export function capturePhotoGeometry(item,scale,{includeMargin=false,pocketMargin=0}={}){
  const geometry=capturePocketGeometry(item,scale),source=sourcePoints(item,scale);
  const xs=source.map(point=>point.x),ys=source.map(point=>point.y);
  const px=item.contour.points.map(point=>point.x),py=item.contour.points.map(point=>point.y);
  const center={x:(Math.min(...px)+Math.max(...px))/2,y:(Math.min(...py)+Math.max(...py))/2};
  const origin=item.contourEditOrigin||{x:center.x-(Math.max(...xs)+Math.min(...xs))*scale/2,y:center.y-(Math.max(...ys)+Math.min(...ys))*scale/2};
  const photo=point=>({x:origin.x+point.x*scale,y:origin.y+point.y*scale});
  let points=geometry.points;
  if(includeMargin){
    const margin=effectivePocketMargin(item,pocketMargin),minX=Math.min(...points.map(point=>point.x)),minY=Math.min(...points.map(point=>point.y));
    points=pocketOutline({points,x:minX,y:minY,rotation:0,fingerGrips:[]},margin);
  }
  return{...geometry,points:points.map(photo),axis:geometry.axis?{start:photo(geometry.axis.start),end:photo(geometry.axis.end)}:null};
}

export function captureItemDimensions(item,scale){
  return getToolDimensions({points:sourcePoints(item,scale)});
}

/** Actual cavity dimensions in mm, including its fitted reserve and per-side margin. */
export function capturePocketDimensions(item,scale,{pocketMargin=0}={}){
  const geometry=capturePhotoGeometry(item,scale,{includeMargin:true,pocketMargin});
  return getToolDimensions({points:geometry.points.map(point=>({x:point.x/scale,y:point.y/scale}))});
}

/** Check each proposal before the shared preview. A failed fit cannot discard
 * another tool, silently remove its reserve, or mutate the measured source. */
export function prepareCaptureFit(item,scale,{pocketMargin=0,geometry=capturePocketDimensions}={}){
  const raw=item?.editedPoints||item?.contour?.points;
  if(!Array.isArray(raw)||raw.length<3||!Number.isFinite(scale)||scale<=0||raw.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))||!simple(raw))throw i18nError('Naměřený obrys není platný. Vyberte jej znovu nebo upravte jeho body.');
  const origin=raw[0];let rawArea=0;for(let i=0;i<raw.length;i++){const p=raw[i],q=raw[(i+1)%raw.length];rawArea+=(p.x-origin.x)*(q.y-origin.y)-(q.x-origin.x)*(p.y-origin.y);}
  if(!(Math.abs(rawArea)>1e-12))throw i18nError('Naměřený obrys není platný. Vyberte jej znovu nebo upravte jeho body.');
  const next={...item};delete next.pocketFitIssue;delete next.pocketFitNotice;
  try{
    geometry(next,scale,{pocketMargin});
    const fitted=capturePocketGeometry(next,scale);
    if(fitted.fallback==='source-offset')next.pocketFitNotice={type:'source-offset',filledOffsetHoles:fitted.filledOffsetHoles||0,filledOffsetHoleAreaRatio:fitted.filledOffsetHoleAreaRatio||0};
    return next;
  }catch(error){
    const requestedShape=next.pocketShape||'measured';
    if(requestedShape==='measured')throw error;
    const source=sourcePoints(next,scale),dimensions=captureItemDimensions(next,scale);
    if(!simple(source)||!(dimensions.length>0&&dimensions.width>0))throw error;
    next.pocketShape='measured';next.checked=false;
    // The measured alternative is checked independently, never through a
    // failing or externally supplied fitting callback.
    capturePocketDimensions(next,scale,{pocketMargin});
    next.pocketFitIssue={requestedShape,reason:String(error?.message||error)};
    return next;
  }
}

/** Commit only a valid resize to this item, without changing photo calibration. */
export function resizeCaptureItem(item,scale,dimensions){
  const editedPhoto=item.contourEditOrigin?capturePhotoGeometry(item,scale).points:null;
  const photoCenter=editedPhoto?{x:(Math.min(...editedPhoto.map(p=>p.x))+Math.max(...editedPhoto.map(p=>p.x)))/2,y:(Math.min(...editedPhoto.map(p=>p.y))+Math.max(...editedPhoto.map(p=>p.y)))/2}:null;
  const next=resizeToolDimensions({points:sourcePoints(item,scale),x:0,y:0,rotation:0},dimensions);
  const measured=getToolDimensions(next);
  item.editedPoints=next.points;
  if(photoCenter){
    item.contourEditOrigin={x:photoCenter.x-(Math.min(...next.points.map(p=>p.x))+Math.max(...next.points.map(p=>p.x)))*scale/2,y:photoCenter.y-(Math.min(...next.points.map(p=>p.y))+Math.max(...next.points.map(p=>p.y)))*scale/2};
    delete item.contourEdit;
  }
  return measured;
}

/** Photo positions use the outline's bounds anchor, matching the editor's transforms.
 *  A corrected outline stays centred on its original photograph, including after repeated resizes. */
export function toolFromCaptureItem(item,{scale,depth,id,preservePosition=false}){
  const metadata={};
  const margin=optionalPocketMargin(item.pocketMargin);if(margin!==undefined)metadata.pocketMargin=margin;
  if(item.category!=null&&item.category!==''){
    if(!categories.has(item.category))throw i18nError('Vyberte platnou kategorii nástroje.');
    metadata.category=item.category;
  }
  if(item.sizeLabel!=null){
    if(typeof item.sizeLabel!=='string')throw i18nError('Popisek velikosti musí být text.');
    const label=item.sizeLabel.replace(/[\u0000-\u001f]/g,'').trim();
    if(label.length>24)throw i18nError('Popisek velikosti může mít nejvýše 24 znaků.');
    if(label)metadata.sizeLabel=label;
  }
  const points=captureToolPoints(item,scale);
  if(['ideal','hybrid','functional'].includes(item.pocketShape))metadata.pocketFit={mode:item.pocketShape,signature:pocketFitSignature(points)};
  let x=0,y=0;
  if(preservePosition){
    const photo=capturePhotoGeometry(item,scale).points;
    x=Math.min(...photo.map(point=>point.x))/scale;
    y=Math.min(...photo.map(point=>point.y))/scale;
  }
  return{id,name:String(item.name??'').trim().slice(0,80)||t('Nástroj'),points,depth,x,y,rotation:0,locked:false,moduleId:null,...metadata};
}
