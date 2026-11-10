import {automaticFingerGrips,fingerGripDimensions,fingerGripOutline,pocketOutline,validateFingerGrips} from './finger-grip.js';
import {esc,icon,openModal} from './ui.js';
import {errorText,i18nError,t} from './i18n.js';
import {inputValue,parseLength} from './units.js';

const TYPES=[['circle','Kruh'],['ellipse','Ovál'],['rounded-rect','Zaoblený obdélník'],['rectangle','Obdélník']];
const clone=value=>JSON.parse(JSON.stringify(value));
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const path=points=>points.map((point,index)=>`${index?'L':'M'}${point.x},${point.y}`).join(' ')+'Z';
const id=()=>globalThis.crypto?.randomUUID?.()||`finger-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const typeOf=grip=>grip.shape||'circle';

/** The modal owns a draft. Only Save calls validate/onSave; closing discards it. */
export function openFingerGripEditor({tool,unit='mm',pocketMargin=0,validate=()=>{},onSave=()=>{},autoPlace=()=>automaticFingerGrips(tool,{radius:9})}){
  const source=clone(tool),minX=Math.min(...source.points.map(point=>point.x)),minY=Math.min(...source.points.map(point=>point.y));
  let draft=validateFingerGrips(clone(source.fingerGrips??[])),selected=draft[0]?.id??null,newShape='circle',view=null,initialView=null,gesture=null,closed=false,pending=false,blockedTouch=false,space=false,resizeObserver=null;
  const textDrafts=new Map(),fieldErrors=new Map(),touches=new Set(),rowDisclosureState=new Map();
  const local={...source,x:0,y:0,rotation:0},offset=point=>({x:point.x+minX,y:point.y+minY});
  const modal=openModal({title:t('Výřezy pro prsty'),subtitle:source.name,wide:true,body:'',footer:`<span class="footnote">${t('Poloha ({unit}) se měří od levého horního rohu původního nástroje. Hloubka výřezů odpovídá kapse.',{unit})}</span><button class="btn btn-primary" data-grips-save>${t('Uložit výřezy')}</button>`,onClose:()=>{closed=true;window.removeEventListener('blur',blur);window.removeEventListener('pointerup',outsideTouchEnd,true);window.removeEventListener('pointercancel',outsideTouchEnd,true);resizeObserver?.disconnect();}});
  modal.body.innerHTML=`<div class="grip-editor finger-grip-editor"><div class="fge-preview-column"><div data-grip-preview><svg class="finger-grip-preview fge-svg" tabindex="0" role="img" aria-label="${esc(t('Výřezy přesouvejte tažením. Úchyty mění velikost a otočení.'))}"></svg></div><div class="fge-view-actions"><button class="icon-btn" data-grip-view="out" aria-label="${esc(t('Oddálit'))}">${icon('zoomOut')}</button><button class="icon-btn" data-grip-view="in" aria-label="${esc(t('Přiblížit'))}">${icon('zoomIn')}</button><button class="btn btn-light" data-grip-view="fit">${icon('fit')}${t('Zobrazit vše')}</button></div><div class="grip-legend"><span>${t('Kapsa včetně výřezů')}</span><span>${t('Původní nástroj')}</span></div><p class="muted-note">${t('Výřez přesunete tažením. Úchyty mění velikost; horní úchyt otáčí tvar. Kolečko přibližuje, pravé tlačítko posouvá pohled.')}</p></div><div class="fge-properties"><div class="grip-edit-actions"><label class="fge-new-shape"><span>${t('Nový tvar')}</span><select data-grip-new-shape>${TYPES.map(([value,label])=>`<option value="${value}">${t(label)}</option>`).join('')}</select></label><button class="btn btn-light" data-grip-add>${t('Přidat další')}</button><button class="btn btn-light" data-grip-auto>${t('Automaticky umístit')}</button><button class="btn btn-light" data-grip-clear>${t('Smazat všechny')}</button></div><div class="grip-rows"></div><p class="form-error" data-grip-error role="status" aria-live="polite"></p></div></div>`;
  const svg=modal.body.querySelector('svg.fge-svg'),rows=modal.body.querySelector('.grip-rows'),error=modal.body.querySelector('[data-grip-error]'),save=modal.footer.querySelector('[data-grips-save]');
  const management=document.createElement('details'),managementSummary=document.createElement('summary'),managementBody=document.createElement('div');
  management.className='ui-disclosure editor-disclosure fge-management';management.dataset.gripSection='arrangement';managementSummary.textContent=t('Uspořádání výřezů');managementBody.className='ui-disclosure-body grip-edit-actions';managementBody.append(modal.body.querySelector('[data-grip-auto]'),modal.body.querySelector('[data-grip-clear]'));management.append(managementSummary,managementBody);modal.body.querySelector('.grip-edit-actions').after(management);
  const key=(gripId,field)=>`${gripId}:${field}`;
  const clearTexts=gripId=>{for(const target of [...textDrafts.keys()])if(target.startsWith(gripId+':')){textDrafts.delete(target);fieldErrors.delete(target);}};
  const selectedGrip=()=>draft.find(grip=>grip.id===selected);
  const outline=grip=>{try{return fingerGripOutline(grip);}catch{return[];}};
  function fit(){
    const points=[...source.points,...draft.flatMap(outline)];
    const x=Math.min(...points.map(point=>point.x)),y=Math.min(...points.map(point=>point.y)),width=Math.max(...points.map(point=>point.x))-x,height=Math.max(...points.map(point=>point.y))-y,pad=Math.max(12,Math.max(width,height)*.08);
    view={x:x-pad,y:y-pad,width:Math.max(1,width)+pad*2,height:Math.max(1,height)+pad*2};initialView={...view};
  }
  function screenScale(){const rect=svg.getBoundingClientRect();return Math.max(.0001,Math.min((rect.width||600)/view.width,(rect.height||400)/view.height));}
  function position(event){
    try{const matrix=svg.getScreenCTM?.();if(matrix&&svg.createSVGPoint){const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;const result=point.matrixTransform(matrix.inverse());if(Number.isFinite(result.x+result.y))return{x:result.x,y:result.y};}}catch{}
    const rect=svg.getBoundingClientRect(),width=rect.width||600,height=rect.height||400,scale=Math.min(width/view.width,height/view.height);
    return{x:view.x+(event.clientX-rect.left-(width-view.width*scale)/2)/scale,y:view.y+(event.clientY-rect.top-(height-view.height*scale)/2)/scale};
  }
  function validation(){
    if(fieldErrors.size)throw i18nError('Zadejte platné rozměry a polohu výřezu.');
    const grips=validateFingerGrips(draft),pocket=pocketOutline({...local,fingerGrips:grips},pocketMargin).map(offset);
    return{grips,pocket};
  }
  function renderScene(){
    if(closed)return;
    let pocket,invalid='';
    try{pocket=validation().pocket;}catch(problem){invalid=errorText(problem);try{pocket=pocketOutline({...local,fingerGrips:[]},pocketMargin).map(offset);}catch{pocket=source.points;}}
    error.textContent=invalid;save.disabled=!!invalid||pending;
    rows.querySelectorAll('[data-grip-row]').forEach(row=>{const active=row.dataset.gripRow===selected;row.classList.toggle('fge-row-selected',active);row.querySelector('[data-grip-select]')?.setAttribute('aria-pressed',String(active));const grip=draft.find(grip=>grip.id===row.dataset.gripRow),summary=row.querySelector('[data-grip-size]');if(grip&&summary)summary.textContent=gripSize(grip);});
    modal.body.querySelector('[data-grip-add]').disabled=draft.length>=12||pending;
    modal.body.querySelector('[data-grip-clear]').disabled=!draft.length||pending;
    svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.width} ${view.height}`);
    const scale=screenScale(),handle=22/scale,dot=5/scale;
    const painted=draft.map((grip,index)=>({grip,index})).sort((a,b)=>Number(a.grip.id===selected)-Number(b.grip.id===selected));
    svg.innerHTML=`<path class="grip-pocket" d="${path(pocket)}"/><path class="grip-tool" d="${path(source.points)}"/>${painted.map(({grip,index})=>{
      const points=outline(grip),active=grip.id===selected;
      return `<g class="fge-cutout ${active?'selected':''} ${invalid?'invalid':''}" data-grip-id="${esc(grip.id)}"><path class="fge-area" data-grip-action="move" d="${points.length?path(points):''}"/><text class="grip-number" style="font-size:${11/scale}px" x="${grip.x}" y="${grip.y}" pointer-events="none">${index+1}</text>${active?handles(grip,handle,dot):''}</g>`;
    }).join('')}`;
  }
  function handles(grip,hit,dot){
    const dimensions=fingerGripDimensions(grip),angle=dimensions.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),point=(x,y)=>({x:grip.x+x*c-y*s,y:grip.y+x*s+y*c});
    const one=(action,p,label)=>`<g data-grip-action="${action}" role="button" aria-label="${esc(t(label))}"><circle class="fge-handle-hit" cx="${p.x}" cy="${p.y}" r="${hit}"/><circle class="fge-handle" cx="${p.x}" cy="${p.y}" r="${dot}"/></g>`;
    if(typeOf(grip)==='circle')return one('radius',point(dimensions.width/2,0),'Změnit průměr výřezu');
    const top=point(0,-dimensions.height/2),rotation=point(0,-dimensions.height/2-35/screenScale());
    return one('width',point(dimensions.width/2,0),'Změnit šířku výřezu')+one('height',point(0,dimensions.height/2),'Změnit výšku výřezu')+one('size',point(dimensions.width/2,dimensions.height/2),'Změnit velikost výřezu')+`<path class="fge-rotation-line" d="M${top.x},${top.y}L${rotation.x},${rotation.y}"/>`+one('rotation',rotation,'Otočit výřez');
  }
  function field(grip,label,name,value,{angle=false,min,max}={}){
    const draftKey=key(grip.id,name),text=textDrafts.get(draftKey)??(angle?String(value):inputValue(value,{unit,digits:6}));
    return `<label class="field"><span>${t(label)}</span><div class="input-wrap"><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-field="${name}" value="${esc(text)}" ${fieldErrors.has(draftKey)?'aria-invalid="true"':''} ${min==null?'':`data-min="${min}"`} ${max==null?'':`data-max="${max}"`}><em>${angle?'°':esc(unit)}</em></div></label>`;
  }
  function renderRows(){
    for(const details of rows.querySelectorAll('[data-grip-details]'))rowDisclosureState.set(details.dataset.gripDetails,details.open);
    rows.innerHTML=draft.map((grip,index)=>{
      const dimensions=fingerGripDimensions(grip),circle=typeOf(grip)==='circle';
      return `<div class="grip-row ${grip.id===selected?'fge-row-selected':''}" data-grip-row="${esc(grip.id)}"><div class="grip-row-head"><button class="fge-select" data-grip-select="${esc(grip.id)}" aria-pressed="${grip.id===selected}">${t('Výřez {n}',{n:index+1})}</button><button class="icon-btn" data-grip-delete="${esc(grip.id)}" aria-label="${esc(t('Smazat výřez {n}',{n:index+1}))}">${icon('trash')}</button></div><label class="field"><span>${t('Tvar výřezu')}</span><select data-field="fingerShape">${TYPES.map(([value,label])=>`<option value="${value}" ${typeOf(grip)===value?'selected':''}>${t(label)}</option>`).join('')}</select></label><div class="fields-row three">${field(grip,'Poloha X','fingerX',grip.x)}${field(grip,'Poloha Y','fingerY',grip.y)}${circle?field(grip,'Průměr','fingerDiameter',grip.radius*2,{min:4,max:80}):''}</div>${circle?'':`<div class="fields-row three">${field(grip,'Šířka','fingerWidth',dimensions.width,{min:4,max:80})}${field(grip,'Výška','fingerHeight',dimensions.height,{min:4,max:80})}${field(grip,'Otočení','fingerRotation',dimensions.rotation,{angle:true})}</div>${typeOf(grip)==='rounded-rect'?field(grip,'Zaoblení rohů','fingerCornerRadius',dimensions.cornerRadius,{min:0,max:Math.min(dimensions.width,dimensions.height)/2}):''}`}</div>`;
    }).join('')||`<p class="muted-note">${t('Žádné výřezy. Přidejte vlastní nebo je nechte automaticky umístit.')}</p>`;
    for(const row of rows.querySelectorAll('[data-grip-row]')){
      const details=document.createElement('details'),summary=document.createElement('summary'),name=document.createElement('span'),size=document.createElement('small'),body=document.createElement('div');
      details.className='ui-disclosure editor-disclosure fge-row-details';details.dataset.gripDetails=row.dataset.gripRow;details.open=rowDisclosureState.get(row.dataset.gripRow)===true;name.textContent=t('Rozměry a poloha');size.dataset.gripSize='';summary.append(name,size);body.className='ui-disclosure-body';body.append(...[...row.children].filter(child=>!child.classList.contains('grip-row-head')));details.append(summary,body);row.append(details);
    }
  }
  function gripSize(grip){const dimensions=fingerGripDimensions(grip),length=value=>inputValue(value,{unit,digits:2});return(typeOf(grip)==='circle'?`Ø ${length(dimensions.width)}`:`${length(dimensions.width)} × ${length(dimensions.height)}`)+` ${unit}`;}
  function redraw({refit=false}={}){if(refit)fit();renderRows();renderScene();}
  function converted(grip,shape){
    const dimensions=fingerGripDimensions(grip),base={id:grip.id,x:grip.x,y:grip.y};
    if(shape==='circle')return{...base,radius:Math.max(dimensions.width,dimensions.height)/2};
    return{...base,shape,width:dimensions.width,height:dimensions.height,rotation:dimensions.rotation,...(shape==='rounded-rect'?{cornerRadius:Math.min(dimensions.width,dimensions.height)/4}:{})};
  }
  function select(gripId){selected=gripId;renderRows();renderScene();svg.focus();}
  function zoom(factor,anchor={x:view.x+view.width/2,y:view.y+view.height/2}){
    if(gesture)return;
    const width=clamp(view.width/factor,initialView.width/12,initialView.width*2),ratio=width/view.width,height=view.height*ratio;
    view={x:anchor.x-(anchor.x-view.x)*ratio,y:anchor.y-(anchor.y-view.y)*ratio,width,height};renderScene();
  }
  function finish(cancel=false){
    if(!gesture)return;const previous=gesture;gesture=null;
    if(cancel){if(previous.action==='pan')view=previous.view;else{const index=draft.findIndex(grip=>grip.id===previous.id);if(index>=0)draft[index]=previous.before;}}
    try{if(!svg.hasPointerCapture||svg.hasPointerCapture(previous.pointerId))svg.releasePointerCapture?.(previous.pointerId);}catch{}
    svg.style.cursor='';renderRows();renderScene();
  }
  function blur(){finish(true);touches.clear();blockedTouch=false;space=false;}
  window.addEventListener('blur',blur);
  function outsideTouchEnd(event){
    if(closed||!touches.has(event.pointerId)||event.target===svg||(event.target?.nodeType&&svg.contains(event.target)))return;
    if(gesture?.pointerId===event.pointerId)finish(true);
    touches.delete(event.pointerId);if(!touches.size)blockedTouch=false;
  }
  window.addEventListener('pointerup',outsideTouchEnd,true);window.addEventListener('pointercancel',outsideTouchEnd,true);
  svg.addEventListener('pointerdown',event=>{
    if(pending||closed)return;
    if(event.pointerType==='touch'){
      touches.add(event.pointerId);
      if(touches.size>1){finish(true);blockedTouch=true;event.preventDefault();return;}
      if(blockedTouch)return;
    }
    if(gesture||event.isPrimary===false||![0,1,2].includes(event.button))return;
    const target=event.target.closest?.('[data-grip-id]');let action=event.button!==0||space?'pan':event.target.closest?.('[data-grip-action]')?.dataset.gripAction;
    if(!action)return;
    if(action!=='pan'&&fieldErrors.size)return;
    event.preventDefault();svg.focus();
    if(action==='pan')gesture={action,pointerId:event.pointerId,button:event.button,start:position(event),view:{...view}};
    else{
      const grip=draft.find(item=>item.id===target?.dataset.gripId);if(!grip)return;
      const start=position(event);
      if(action!=='move'){
        // Touch hit circles may overlap on small cutouts. Resolve their shared
        // area by the closest visible control, with the centre always moving.
        let distance=Math.hypot(start.x-grip.x,start.y-grip.y);action='move';
        for(const control of target.querySelectorAll('[data-grip-action]')){
          const dot=control.querySelector('.fge-handle');if(!dot)continue;
          const next=Math.hypot(start.x-Number(dot.getAttribute('cx')),start.y-Number(dot.getAttribute('cy')));
          if(next<distance){distance=next;action=control.dataset.gripAction;}
        }
      }
      selected=grip.id;clearTexts(grip.id);gesture={action,id:grip.id,pointerId:event.pointerId,button:0,start,before:clone(grip)};
      renderRows();renderScene();
    }
    svg.style.cursor=action==='pan'?'grabbing':action==='move'?'grabbing':action==='rotation'?'crosshair':'nwse-resize';
    try{svg.setPointerCapture?.(event.pointerId);}catch{}
  });
  svg.addEventListener('pointermove',event=>{
    if(!gesture||event.pointerId!==gesture.pointerId||blockedTouch)return;
    const mask=gesture.button===2?2:gesture.button===1?4:1;if(!(event.buttons&mask)){finish(true);return;}
    event.preventDefault();const point=position(event),previous=gesture.before;
    if(gesture.action==='pan'){
      view={...view,x:view.x+gesture.start.x-point.x,y:view.y+gesture.start.y-point.y};
    }else{
      const next=clone(previous),angle=(previous.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),dx=point.x-previous.x,dy=point.y-previous.y,deltaX=point.x-gesture.start.x,deltaY=point.y-gesture.start.y;
      if(gesture.action==='move'){next.x=clamp(previous.x+point.x-gesture.start.x,-6000,6000);next.y=clamp(previous.y+point.y-gesture.start.y,-6000,6000);}
      else if(gesture.action==='radius')next.radius=clamp(previous.radius+Math.hypot(dx,dy)-Math.hypot(gesture.start.x-previous.x,gesture.start.y-previous.y),2,40);
      else if(gesture.action==='rotation')next.rotation=(((previous.rotation||0)+(Math.atan2(dy,dx)-Math.atan2(gesture.start.y-previous.y,gesture.start.x-previous.x))*180/Math.PI)%360+360)%360;
      else{
        if(['width','size'].includes(gesture.action))next.width=clamp(previous.width+(deltaX*c+deltaY*s)*2,4,80);
        if(['height','size'].includes(gesture.action))next.height=clamp(previous.height+(-deltaX*s+deltaY*c)*2,4,80);
        if(next.shape==='rounded-rect')next.cornerRadius=Math.min(next.cornerRadius,Math.min(next.width,next.height)/2);
      }
      draft[draft.findIndex(grip=>grip.id===gesture.id)]=next;
    }
    renderRows();renderScene();
  });
  const pointerEnd=(event,cancel)=>{
    if(gesture&&event.pointerId===gesture.pointerId&&(cancel||event.button===gesture.button))finish(cancel);
    if(event.pointerType==='touch'){touches.delete(event.pointerId);if(!touches.size)blockedTouch=false;}
  };
  svg.addEventListener('pointerup',event=>pointerEnd(event,false));
  svg.addEventListener('pointercancel',event=>pointerEnd(event,true));
  svg.addEventListener('lostpointercapture',event=>{if(gesture?.pointerId===event.pointerId)finish(true);});
  svg.addEventListener('contextmenu',event=>event.preventDefault());
  svg.addEventListener('wheel',event=>{event.preventDefault();if(!gesture)zoom(Math.exp(-clamp(event.deltaY,-240,240)*.0025),position(event));},{passive:false});
  modal.el.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&gesture){event.preventDefault();event.stopPropagation();finish(true);return;}
    if(event.target!==svg)return;
    if(event.code==='Space'||event.key===' '){event.preventDefault();space=true;return;}
    if(gesture||pending)return;
    if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();remove(selected);return;}
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||fieldErrors.size)return;
    const grip=selectedGrip();if(!grip)return;event.preventDefault();const step=event.shiftKey?10:event.altKey ? .1 : 1;
    grip.x=clamp(grip.x+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),-6000,6000);
    grip.y=clamp(grip.y+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0),-6000,6000);clearTexts(grip.id);redraw();
  },true);
  modal.el.addEventListener('keyup',event=>{if(event.code==='Space'||event.key===' ')space=false;});
  function remove(gripId){finish(true);draft=draft.filter(grip=>grip.id!==gripId);clearTexts(gripId);if(selected===gripId)selected=draft[0]?.id??null;redraw({refit:true});}
  rows.addEventListener('click',event=>{
    const deletion=event.target.closest('[data-grip-delete]');if(deletion){remove(deletion.dataset.gripDelete);return;}
    const selection=event.target.closest('[data-grip-select]');if(selection){finish(true);select(selection.dataset.gripSelect);}
  });
  const numericFields={fingerX:'x',fingerY:'y',fingerDiameter:'radius',fingerWidth:'width',fingerHeight:'height',fingerRotation:'rotation',fingerCornerRadius:'cornerRadius'};
  rows.addEventListener('focusin',event=>{const row=event.target.closest('[data-grip-row]');if(row&&row.dataset.gripRow!==selected){selected=row.dataset.gripRow;renderScene();}});
  const updateNumeric=event=>{
    if(pending)return;const input=event.target.closest('input[data-field]'),row=input?.closest('[data-grip-row]');if(!row)return;
    const index=draft.findIndex(grip=>grip.id===row.dataset.gripRow),field=input.dataset.field;if(index<0||!numericFields[field])return;
    const draftKey=key(draft[index].id,field),value=field==='fingerRotation'?Number(input.value.trim().replace(',','.')):parseLength(input.value,unit);
    textDrafts.set(draftKey,input.value);
    try{
      if(!input.value.trim()||!Number.isFinite(value))throw i18nError('Zadejte platné rozměry a polohu výřezu.');
      const next={...draft[index],[numericFields[field]]:field==='fingerDiameter'?value/2:value};
      draft[index]=validateFingerGrips([next])[0];fieldErrors.delete(draftKey);input.removeAttribute('aria-invalid');
    }catch(problem){fieldErrors.set(draftKey,errorText(problem));input.setAttribute('aria-invalid','true');}
    renderScene();
  };
  rows.addEventListener('input',updateNumeric);
  rows.addEventListener('change',event=>{
    updateNumeric(event);
    const input=event.target.closest('[data-field="fingerShape"]'),row=input?.closest('[data-grip-row]');if(!row||pending)return;
    const index=draft.findIndex(grip=>grip.id===row.dataset.gripRow);if(index<0)return;
    finish(true);draft[index]=converted(draft[index],input.value);
    for(const field of ['fingerDiameter','fingerWidth','fingerHeight','fingerRotation','fingerCornerRadius']){textDrafts.delete(key(draft[index].id,field));fieldErrors.delete(key(draft[index].id,field));}
    selected=draft[index].id;redraw({refit:true});
  });
  modal.body.querySelector('[data-grip-new-shape]').addEventListener('change',event=>newShape=event.target.value);
  modal.body.querySelector('[data-grip-add]').addEventListener('click',()=>{
    if(pending||draft.length>=12)return;finish(true);
    const point=source.points[Math.floor(source.points.length*((draft.length+1)*.381966%1))],grip=converted({id:id(),x:point.x,y:point.y,radius:9},newShape);
    draft.push(grip);selected=grip.id;redraw({refit:true});
  });
  modal.body.querySelector('[data-grip-auto]').addEventListener('click',()=>{
    if(pending)return;finish(true);try{draft=validateFingerGrips(autoPlace());textDrafts.clear();fieldErrors.clear();selected=draft[0]?.id??null;redraw({refit:true});}catch(problem){error.textContent=errorText(problem);}
  });
  modal.body.querySelector('[data-grip-clear]').addEventListener('click',()=>{if(pending)return;finish(true);draft=[];selected=null;textDrafts.clear();fieldErrors.clear();redraw({refit:true});});
  modal.body.querySelectorAll('[data-grip-view]').forEach(button=>button.addEventListener('click',()=>{finish(true);if(button.dataset.gripView==='fit'){fit();renderScene();}else zoom(button.dataset.gripView==='in'?1.25:.8);}));
  const thenable=value=>value&&typeof value.then==='function';
  function setPending(value){
    pending=value;
    modal.body.querySelectorAll('button,input,select').forEach(element=>element.disabled=value);
    if(!closed)renderScene();
  }
  function failed(problem){
    setPending(false);if(!closed)error.textContent=errorText(problem);
  }
  function saved(){if(!closed)modal.close();pending=false;}
  save.addEventListener('click',()=>{
    if(pending||closed)return;finish(false);
    try{
      const grips=validation().grips;setPending(true);
      const accept=plan=>{
        if(closed){pending=false;return;}
        try{const result=onSave(clone(grips),plan);if(thenable(result))result.then(saved,failed);else saved();}catch(problem){failed(problem);}
      };
      const plan=validate(clone(grips));if(thenable(plan))plan.then(accept,failed);else accept(plan);
    }catch(problem){failed(problem);}
  });
  fit();redraw();
  if(typeof ResizeObserver==='function'){resizeObserver=new ResizeObserver(()=>{if(!closed)renderScene();});resizeObserver.observe(svg);}
  return modal;
}
