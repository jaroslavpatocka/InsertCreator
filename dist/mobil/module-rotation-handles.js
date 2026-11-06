import {esc} from './ui.js';
import {t} from './i18n.js';

/** Four explicit rotation targets outside the resize edges, with screen-sized hit areas. */
export function moduleRotationHandles(module,project,{px,coarse=false,gesture=null,frame=null}={}){
  const locked=module.locked||project.tools.some(tool=>tool.moduleId===module.id&&tool.locked);
  const title=t(locked?'Nejprve odemkněte polohu modulu.':'Táhněte pro otočení modulu · Shift: po 15°');
  const radius=coarse?10:8,offset=coarse?23:16,hit=coarse?44:24;
  const obstacles=project.modules.filter(other=>other.id!==module.id);
  const hitRects=(x,y)=>{
    let pieces=[{x:x-hit*px/2,y:y-hit*px/2,width:hit*px,height:hit*px}];
    // A neighbouring module keeps its own click targets, including on touch screens.
    for(const other of obstacles)pieces=pieces.flatMap(piece=>{
      const l=Math.max(piece.x,other.x-2*px),r=Math.min(piece.x+piece.width,other.x+other.width+2*px);
      const top=Math.max(piece.y,other.y-2*px),bottom=Math.min(piece.y+piece.height,other.y+other.height+2*px);
      if(l>=r||top>=bottom)return[piece];
      return[{x:piece.x,y:piece.y,width:piece.width,height:top-piece.y},{x:piece.x,y:bottom,width:piece.width,height:piece.y+piece.height-bottom},{x:piece.x,y:top,width:l-piece.x,height:bottom-top},{x:r,y:top,width:piece.x+piece.width-r,height:bottom-top}].filter(part=>part.width>0&&part.height>0);
    });
    return pieces.map(piece=>`<rect class="rotation-hit" x="${piece.x}" y="${piece.y}" width="${piece.width}" height="${piece.height}"/>`).join('');
  };
  let html='<g class="rotation-handles">';
  for(const [corner,sx,sy] of [['nw',-1,-1],['ne',1,-1],['se',1,1],['sw',-1,1]]){
    const x=module.x+(sx>0?module.width:0),y=module.y+(sy>0?module.height:0);
    let cx=x+sx*offset*px,cy=y+sy*offset*px;
    // Keep the full target reachable at the drawer/view edge, including on a narrow phone.
    if(frame&&x>=frame.x&&x<=frame.x+frame.width&&y>=frame.y&&y<=frame.y+frame.height){
      const inset=hit*px/2;
      cx=Math.max(frame.x+inset,Math.min(frame.x+frame.width-inset,cx));
      cy=Math.max(frame.y+inset,Math.min(frame.y+frame.height-inset,cy));
    }
    html+=`<g class="rotation-handle${locked?' disabled':''}" data-rotate-corner="${corner}" ${locked?'aria-disabled="true"':`data-rotate-of="${esc(module.id)}" tabindex="0" role="button"`} aria-label="${esc(title)}"><title>${esc(title)}</title><path class="rotation-link" d="M${x} ${y}L${cx} ${cy}"/>${hitRects(cx,cy)}<g class="rotation-grip" transform="translate(${cx} ${cy}) scale(${px})"><circle r="${radius}"/><path d="M4 -1A4 4 0 1 0 1 4M4 -5V-1H0"/></g></g>`;
  }
  if(gesture?.moved){
    const text=t('Otočení modulu: {angle}°',{angle:gesture.degrees})+(gesture.error?' · '+t('Nelze umístit'):''),fs=11*px,width=Math.max(90*px,text.length*fs*.57+12*px),height=21*px;
    const x=module.x+module.width/2-width/2,y=module.y-36*px;
    html+=`<g class="rotation-label${gesture.error?' limited':''}" role="status" aria-live="polite"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${4*px}"/><text x="${x+width/2}" y="${y+height*.68}" text-anchor="middle" font-size="${fs}">${esc(text)}</text></g>`;
  }
  return html+'</g>';
}
