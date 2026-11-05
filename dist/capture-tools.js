import {simpleOutline} from './finger-grip.js';
import {getToolDimensions,resizeToolDimensions} from './tool-dimensions.js';
import {CATEGORIES} from './tool-categories.js';
import {t,i18nError} from './i18n.js';

const categories=new Set(CATEGORIES.map(category=>category.id));

/** A fresh millimetre outline; the calibrated photo contour always stays intact. */
export function captureToolPoints(item,scale){
  if(item.editedPoints)return item.editedPoints.map(point=>({x:point.x,y:point.y}));
  return simpleOutline(item.contour.points.map(point=>({
    x:+((point.x-item.info.minX)/scale).toFixed(4),
    y:+((point.y-item.info.minY)/scale).toFixed(4)
  })));
}

export function captureItemDimensions(item,scale){
  return getToolDimensions({points:captureToolPoints(item,scale)});
}

/** Commit only a valid resize to this item, without changing photo calibration. */
export function resizeCaptureItem(item,scale,dimensions){
  const next=resizeToolDimensions({points:captureToolPoints(item,scale),x:0,y:0,rotation:0},dimensions);
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
  let x=0,y=0;
  if(preservePosition){
    const photo=item.contour.points,px=photo.map(point=>point.x),py=photo.map(point=>point.y);
    const xs=points.map(point=>point.x),ys=points.map(point=>point.y);
    x=(Math.min(...px)+Math.max(...px))/(2*scale)-(Math.max(...xs)-Math.min(...xs))/2;
    y=(Math.min(...py)+Math.max(...py))/(2*scale)-(Math.max(...ys)-Math.min(...ys))/2;
  }
  return{id,name:String(item.name??'').trim().slice(0,80)||t('Nástroj'),points,depth,x,y,rotation:0,locked:false,moduleId:null,...metadata};
}
