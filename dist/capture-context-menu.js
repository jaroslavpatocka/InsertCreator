import {openContextMenu} from './context-menu.js';
import {t} from './i18n.js';

const finitePoint=point=>point&&Number.isFinite(point.x)&&Number.isFinite(point.y);
const positiveScale=scale=>Number.isFinite(scale)&&scale>0?scale:1;

function containsPoint(point,polygon){
  if(!Array.isArray(polygon)||polygon.length<3||!polygon.every(finitePoint))return false;
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[j],b=polygon[i],dx=b.x-a.x,dy=b.y-a.y;
    const length=Math.hypot(dx,dy),cross=(point.x-a.x)*dy-(point.y-a.y)*dx;
    // Include the visible polygon edge, including a repeated/zero-length vertex.
    if(length===0){if(Math.hypot(point.x-a.x,point.y-a.y)<1e-7)return true;}
    else if(Math.abs(cross)<=1e-7*length&&point.x>=Math.min(a.x,b.x)-1e-7&&point.x<=Math.max(a.x,b.x)+1e-7&&point.y>=Math.min(a.y,b.y)-1e-7&&point.y<=Math.max(a.y,b.y)+1e-7)return true;
    if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}

/** Hit the painted contour or number badge in raw photo pixels, in paint order. */
export function hitCaptureItem(items,point,{activeIndex=null,scale=1,getPoints=item=>item.contour?.points}={}){
  if(!Array.isArray(items)||!finitePoint(point))return null;
  const size=positiveScale(scale);
  const hits=index=>{
    const item=items[index];if(!item)return false;
    const center=item.info?.center,radius=(index===activeIndex?12:10)*size;
    return (finitePoint(center)&&Math.hypot(point.x-center.x,point.y-center.y)<=radius)||containsPoint(point,getPoints(item));
  };
  // The active contour is drawn after all remaining contours.
  if(Number.isInteger(activeIndex)&&items[activeIndex]&&hits(activeIndex))return activeIndex;
  for(let index=items.length-1;index>=0;index--)if(index!==activeIndex&&hits(index))return index;
  return null;
}

/**
 * Bind photo-only menus; callbacks retain ownership of selection and editing.
 * The returned cleanup function also exposes dismiss() to close its menu while
 * retaining listeners, for example while adding tools temporarily blocks edits.
 */
export function bindCaptureContextMenu(canvas,{
  getItems=()=>[],getActiveIndex=()=>null,isBusy=()=>false,
  getScale=()=>canvas.width/Math.max(250,canvas.clientWidth||550),
  getPoints=item=>item.contour?.points,
  toPhoto=point=>point,fromPhoto=point=>point,
  onSelect,onEdit,getDescription
}={}){
  let ownedMenu=null,disposed=false;
  const close=()=>{ownedMenu?.close();ownedMenu=null;};
  const open=(index,x,y)=>{
    const item=getItems()[index];
    if(disposed||isBusy()||!item)return;
    onSelect?.(index);
    if(disposed||isBusy())return;
    ownedMenu=openContextMenu({
      title:getDescription?.(item,index)||item.name||t('Nástroj'),x,y,returnFocus:canvas,
      items:[{action:'properties',label:t('Vlastnosti nástroje')},{action:'depth',label:t('Hloubka kapsy')}],
      onAction:action=>{if(!disposed&&!isBusy())onEdit?.(index,action==='depth'?'depth':'name');}
    });
  };
  const context=event=>{
    event.preventDefault();close();
    if(disposed||isBusy())return;
    const rect=canvas.getBoundingClientRect();
    const point={x:(event.clientX-rect.left)*canvas.width/(rect.width||canvas.width),y:(event.clientY-rect.top)*canvas.height/(rect.height||canvas.height)};
    const index=hitCaptureItem(getItems(),toPhoto(point),{activeIndex:getActiveIndex(),scale:getScale(),getPoints});
    if(index!==null)open(index,event.clientX,event.clientY);
  };
  const keyboard=event=>{
    if(event.target!==canvas||!(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey))return;
    event.preventDefault();close();
    if(disposed||isBusy())return;
    const index=getActiveIndex(),item=Number.isInteger(index)?getItems()[index]:null;
    if(!item||!finitePoint(item.info?.center))return;
    const rect=canvas.getBoundingClientRect(),center=fromPhoto(item.info.center);
    open(index,rect.left+center.x*(rect.width||canvas.width)/canvas.width,rect.top+center.y*(rect.height||canvas.height)/canvas.height);
  };
  canvas.addEventListener('contextmenu',context);
  canvas.addEventListener('keydown',keyboard);
  const cleanup=()=>{
    disposed=true;canvas.removeEventListener('contextmenu',context);canvas.removeEventListener('keydown',keyboard);close();
  };
  cleanup.dismiss=close;
  return cleanup;
}
