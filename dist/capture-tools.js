import {simpleOutline} from './finger-grip.js';
import {getToolDimensions,resizeToolDimensions} from './tool-dimensions.js';
import {CATEGORIES} from './tool-categories.js';
import {t,i18nError} from './i18n.js';
import {fitFunctionalPocket,fitHybridPocket} from './functional-pocket.js';
import {pocketFitSignature} from './pocket-fit-meta.js';

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
  if(!cached||cached.reference!==reference||cached.scale!==scale||cached.mode!==mode){
    const source=sourcePoints(item,scale);
    const fitted=mode==='hybrid'?fitHybridPocket(source):mode==='functional'?fitFunctionalPocket(source):{points:source,axis:null,primitives:[],kind:'measured'};
    cached={reference,scale,mode,geometry:fitted};geometryCache.set(item,cached);
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
export function capturePhotoGeometry(item,scale){
  const geometry=capturePocketGeometry(item,scale),source=sourcePoints(item,scale);
  const xs=source.map(point=>point.x),ys=source.map(point=>point.y);
  const px=item.contour.points.map(point=>point.x),py=item.contour.points.map(point=>point.y);
  const center={x:(Math.min(...px)+Math.max(...px))/2,y:(Math.min(...py)+Math.max(...py))/2};
  const origin={x:center.x-(Math.max(...xs)+Math.min(...xs))*scale/2,y:center.y-(Math.max(...ys)+Math.min(...ys))*scale/2};
  const photo=point=>({x:origin.x+point.x*scale,y:origin.y+point.y*scale});
  return{...geometry,points:geometry.points.map(photo),axis:geometry.axis?{start:photo(geometry.axis.start),end:photo(geometry.axis.end)}:null};
}

export function captureItemDimensions(item,scale){
  return getToolDimensions({points:sourcePoints(item,scale)});
}

/** Commit only a valid resize to this item, without changing photo calibration. */
export function resizeCaptureItem(item,scale,dimensions){
  const next=resizeToolDimensions({points:sourcePoints(item,scale),x:0,y:0,rotation:0},dimensions);
  const measured=getToolDimensions(next);
  item.editedPoints=next.points;
  return measured;
}

/** Photo positions use the outline's bounds anchor, matching the editor's transforms.
 *  A corrected outline stays centred on its original photograph, including after repeated resizes. */
export function toolFromCaptureItem(item,{scale,depth,id,preservePosition=false}){
  const metadata={};
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
  if(item.pocketShape==='hybrid'||item.pocketShape==='functional')metadata.pocketFit={mode:item.pocketShape,signature:pocketFitSignature(points)};
  let x=0,y=0;
  if(preservePosition){
    const photo=capturePhotoGeometry(item,scale).points;
    x=Math.min(...photo.map(point=>point.x))/scale;
    y=Math.min(...photo.map(point=>point.y))/scale;
  }
  return{id,name:String(item.name??'').trim().slice(0,80)||t('Nástroj'),points,depth,x,y,rotation:0,locked:false,moduleId:null,...metadata};
}
