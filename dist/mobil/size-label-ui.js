// Size label editing: the label drawn on its module with hover handles, the panel fields and the gesture maths.
import {esc} from './ui.js';
import {t} from './i18n.js';
import {LABEL_DEFAULTS,LABEL_LIMITS} from './label-style.js';

const FALLBACK_INK='#4c613c';
const outline=polygons=>polygons.map(poly=>poly.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')+'Z').join(' ');

const ICONS={
  move:'M0-6V6M-6 0H6M-2-4L0-6L2-4M-2 4L0 6L2 4M-4-2L-6 0L-4 2M4-2L6 0L4 2',
  rotate:'M5.2 1.4A5.4 5.4 0 1 1 2.6-4.7M2.6-4.7L2.9-8M2.6-4.7L5.9-4.4',
  size:'M-5 5L5-5M.5-5H5V-.5M-5 .5V5H-.5'
};

/** A label can be far smaller than a finger, so its handles sit in a bar beside it and never cover the text. */
function handleBar(label,{px,coarse,frame,color}){
  const pitch=(coarse?44:26)*px,radius=(coarse?15:10)*px,gap=7*px,width=pitch*4,height=pitch,top=label.y-gap-height,left=label.center.x-width/2;
  const y=frame&&top<frame.y?label.y+label.height+gap:top,x=frame?Math.max(frame.x,Math.min(frame.x+frame.width-width,left)):left,midY=y+height/2,id=esc(label.toolId);
  const titles={move:t('Táhněte pro přesun popisku'),rotate:t('Táhněte pro otočení popisku · Shift: po 15°'),size:t('Táhněte pro změnu velikosti popisku'),color:t('Barva popisku')};
  const buttons=['move','rotate','size','color'].map((kind,index)=>{
    const cx=x+pitch*(index+.5);
    return`<g class="label-knob label-knob-${kind}" data-label-gesture="${kind}" data-label-tool="${id}" aria-label="${esc(titles[kind])}"><title>${esc(titles[kind])}</title><rect class="label-knob-hit" x="${cx-pitch/2}" y="${y}" width="${pitch}" height="${height}"/>${kind==='color'?`<circle class="label-swatch" cx="${cx}" cy="${midY}" r="${radius*.8}" style="fill:${esc(color)}"/>`:`<path class="label-icon" transform="translate(${cx} ${midY}) scale(${radius/8})" d="${ICONS[kind]}"/>`}</g>`;
  }).join('');
  // The bridge keeps the hover alive on the way from the label to the bar.
  const bridgeTop=y<label.y?y+height:label.y+label.height,bridgeBottom=y<label.y?label.y:y;
  return`<g class="label-handles"><rect class="label-bridge" x="${label.center.x-width/4}" y="${bridgeTop}" width="${width/2}" height="${Math.max(0,bridgeBottom-bridgeTop)}"/><rect class="label-bar" x="${x}" y="${y}" width="${width}" height="${height}" rx="${height/2}"/>${buttons}</g>`;
}

/** One label on the board. The bar stays in the markup; CSS reveals it on hover, or for the selected tool on touch. */
export function labelMarkup(label,{px=.5,coarse=false,active=false,ink=FALLBACK_INK,plateFill=null,frame=null}={}){
  const color=label.color||ink,id=esc(label.toolId),plate=outline([label.plate]);
  return`<g class="model-size-label${active?' active':''}" data-tool-label="${id}" aria-label="${esc(label.text)}">${label.background?`<path class="label-plate" d="${plate}"${plateFill?` style="fill:${esc(plateFill)}"`:''}/>`:''}<path class="label-ink" d="${outline(label.screenPolygons)}" fill="${esc(color)}"/><path class="label-outline" d="${plate}"/><path class="label-hit" data-label-gesture="move" data-label-tool="${id}" d="${plate}"/>${handleBar(label,{px,coarse,frame,color})}</g>`;
}

const fixed=value=>Math.round(value*100)/100;
const normalAngle=value=>fixed(((value%360)+360)%360)%360;

/**
 * The style a gesture would save. A gesture always pins position and angle, so the label stays
 * exactly where it is shown even if the planner had picked them automatically.
 */
export function labelGestureStyle(gesture,point,{step=1}={}){
  const {mode,label,start}=gesture,{center,anchor}=label,style={dx:fixed(center.x-anchor.x),dy:fixed(center.y-anchor.y),rotation:label.rotation};
  if(mode==='move'){
    const dx=point.x-start.x,dy=point.y-start.y;
    return{style:{...style,dx:fixed(style.dx+dx),dy:fixed(style.dy+dy)},transform:`translate(${dx} ${dy})`};
  }
  if(mode==='rotate'){
    const angle=(Math.atan2(point.y-center.y,point.x-center.x)-Math.atan2(start.y-center.y,start.x-center.x))*180/Math.PI,turn=Math.round(angle/step)*step,rotation=normalAngle(label.rotation+turn);
    return{style:{...style,rotation},transform:`rotate(${turn} ${center.x} ${center.y})`};
  }
  const ratio=Math.hypot(point.x-center.x,point.y-center.y)/(Math.hypot(start.x-center.x,start.y-center.y)||1);
  const size=Math.min(LABEL_LIMITS.size.max,Math.max(LABEL_LIMITS.size.min,Math.round(label.size*ratio*10)/10)),scale=size/label.size;
  return{style:{...style,size},transform:`translate(${center.x} ${center.y}) scale(${scale}) translate(${-center.x} ${-center.y})`};
}

/** The same choices in the right-hand panel, for the drawer defaults and for one tool. */
export function labelStyleFields({scope,style,light,colors,input,rotation=null}){
  const raised=light&&!style.background,relief=style.relief??(raised?LABEL_DEFAULTS.raised:LABEL_DEFAULTS.engraved),color=style.color||colors.textColor;
  return`<div class="label-style-fields">${input(t('Velikost písmen'),style.size,'labelSize',{scope,min:LABEL_LIMITS.size.min,max:LABEL_LIMITS.size.max})}${input(t(raised?'Výška nápisu':'Hloubka nápisu'),relief,'labelRelief',{scope,min:LABEL_LIMITS.relief.min,max:LABEL_LIMITS.relief.max})}${rotation===null?'':input(t('Otočení popisku'),rotation,'labelRotation',{scope,type:'angle',min:0,max:360})}<label class="field label-color-field"><span>${t('Barva popisku')}</span><input type="color" value="${esc(color)}" data-label-swatch data-label-scope="${scope}" aria-label="${t('Barva popisku')}"></label><label class="check-row"><input type="checkbox" data-label-background data-label-scope="${scope}" ${style.background?'checked':''} ${light?'':'disabled'}>${t('Pozadí pod textem')}</label></div><p class="muted-note">${t(light?(raised?'Bez pozadí stojí písmena přímo na dně modulu.':'Text je vyrytý do destičky.'):'V plném modelu je text vždy vyrytý do horní plochy, pozadí nepotřebuje.')}${colors.enabled?'':' '+t('Barvu vytiskne jen vícebarevný tisk.')}</p>`;
}

/** Opens the native colour picker from a board handle, next to the pointer. */
export function pickLabelColor(value,{x,y},onPick){
  const field=document.createElement('input');field.type='color';field.value=value;field.className='label-color-picker';
  field.style.left=`${x}px`;field.style.top=`${y}px`;document.body.append(field);
  field.addEventListener('change',()=>{onPick(field.value);field.remove();},{once:true});
  field.addEventListener('blur',()=>field.remove(),{once:true});
  field.click();
}
