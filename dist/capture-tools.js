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

export function toolFromCaptureItem(item,{scale,depth,id}){
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
  return{id,name:String(item.name??'').trim().slice(0,80)||t('Nástroj'),points:captureToolPoints(item,scale),depth,x:0,y:0,rotation:0,locked:false,moduleId:null,...metadata};
}
