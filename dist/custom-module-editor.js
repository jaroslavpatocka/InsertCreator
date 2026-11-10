import {customModuleOptions,customPocketPoints} from './custom-module.js';
import {bounds} from './geometry.js';
import {modulePadding} from './module-footprint.js';
import {maxPocketDepth} from './print-material.js';
import {validatePocketWall,pocketLayoutOutline,pocketFloorOutlines,pocketWallOffset} from './pocket-wall.js';
import {planSizeLabels,SIZE_LABEL_REASONS} from './size-labels.js';
import {esc,icon,openModal} from './ui.js';
import {errorText,i18nError,t} from './i18n.js';
import {inputValue,parseLength,unitFor} from './units.js';

const clone=value=>JSON.parse(JSON.stringify(value));
const path=points=>points.map((point,index)=>`${index?'L':'M'}${point.x},${point.y}`).join(' ')+'Z';
const SHAPES=[['rectangle','Obdélník'],['rounded-rect','Zaoblený obdélník'],['ellipse','Ovál'],['polygon','Vlastní obrys']];
const WALLS=[['vertical','Kolmá'],['draft','Šikmá'],['chamfer','Zkosená horní hrana'],['roundTop','Zaoblená horní hrana'],['roundBottom','Zaoblené dno']];
const numeric=['width','height','pocketWidth','pocketHeight','depth','pocketMargin','cornerRadius'];
const defaults=project=>({name:t('Vlastní modul'),pocketName:t('Univerzální kapsa'),label:'',width:84,height:84,pocketWidth:60,pocketHeight:60,depth:Math.max(.5,Math.min(12,maxPocketDepth(project))),pocketMargin:0,cornerRadius:6,shape:'rounded-rect',points:[],pocketWall:null});

/** All changes stay in the modal draft. Only a successful, synchronous Save commits. */
export function openCustomModuleEditor({project,moduleId=null,onSave=()=>{},onClose}){
  const source=clone(project),displayUnit=unitFor(source.modules?.find(module=>module.id===moduleId)?.unit,source.unit);
  const sourceModule=source.modules?.find(module=>module.id===moduleId),sourceTool=source.tools?.find(tool=>tool.moduleId===moduleId);
  let draft={...defaults(source),...(moduleId?customModuleOptions(source,moduleId):{})},selected=0,gesture=null,closed=false,lastProblem='',view=null;
  const activeTouches=new Set();
  const initial=clone(draft);
  const wallMemory=new Map(draft.pocketWall?[[draft.pocketWall.type,draft.pocketWall.value]]:[]);
  const field=(key,label)=>`<label class="field"><span>${t(label)}</span><div class="input-wrap"><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-custom-field="${key}" value="${esc(inputValue(draft[key],{unit:displayUnit,digits:5}))}"><em>${esc(displayUnit)}</em></div></label>`;
  const text=(key,label,max)=>`<label class="field"><span>${t(label)}</span><input type="text" data-custom-field="${key}" maxlength="${max}" value="${esc(draft[key])}"></label>`;
  const modal=openModal({title:t(moduleId?'Upravit vlastní modul':'Vlastní modul s kapsou'),subtitle:t('Navrhněte rozměry, obrys kapsy a tiskový popisek.'),wide:true,body:'',footer:`<button class="btn btn-light" data-custom-cancel>${t('Zrušit')}</button><button class="btn btn-primary" data-custom-save>${icon('check')}${t(moduleId?'Uložit modul':'Přidat modul')}</button>`,onClose:()=>{closed=true;window.removeEventListener('blur',blur);window.removeEventListener('pointerup',outsideEnd,true);window.removeEventListener('pointercancel',outsideEnd,true);onClose?.();}});
  modal.el.classList.add('custom-module-modal');
  modal.body.innerHTML=`<div class="custom-module-editor"><div class="cme-preview-column"><svg class="cme-preview" tabindex="0" role="img" aria-label="${esc(t('Náhled modulu a kapsy. Body vlastního obrysu přesouvejte tažením.'))}"></svg><div class="cme-legend"><span>${t('Modul')}</span><span>${t('Kapsa včetně vůle')}</span><span>${t('Tiskový popisek')}</span></div><p class="muted-note" data-custom-help></p><p class="muted-note" data-custom-label-status role="status"></p></div><div class="cme-properties">${text('name','Název modulu',100)}<div class="fields-row">${field('width','Šířka modulu')}${field('height','Hloubka modulu')}</div>${text('pocketName','Název kapsy',100)}<label class="field"><span>${t('Tvar kapsy')}</span><select data-custom-field="shape">${SHAPES.map(([value,label])=>`<option value="${value}" ${value===draft.shape?'selected':''}>${t(label)}</option>`).join('')}</select></label><div class="fields-row">${field('pocketWidth','Šířka kapsy')}${field('pocketHeight','Délka kapsy')}</div><div class="fields-row">${field('depth','Hloubka kapsy')}${field('pocketMargin','Vůle na každé straně')}</div><div data-custom-radius>${field('cornerRadius','Zaoblení rohů')}</div><div class="cme-vertices" data-custom-vertices><div class="cme-point-heading"><strong data-custom-point-title></strong><span data-custom-point-count></span></div><div class="fields-row">${field('pointX','Poloha bodu X')}${field('pointY','Poloha bodu Y')}</div><div class="cme-point-actions"><button class="btn btn-light" data-custom-point="previous" aria-label="${esc(t('Předchozí bod'))}">←</button><button class="btn btn-light" data-custom-point="next" aria-label="${esc(t('Další bod'))}">→</button><button class="btn btn-light" data-custom-point="add">${icon('plus')}${t('Přidat bod')}</button><button class="btn btn-light" data-custom-point="delete">${icon('trash')}${t('Smazat bod')}</button></div></div>${text('label','Tiskový popisek',24)}<p class="muted-note">${t('Použijte čísla a latinku bez diakritiky. Vzhled a polohu popisku lze dál upravit v aplikaci.')}</p><p class="form-error" data-custom-error role="alert" aria-live="polite"></p></div></div>`;
  const svg=modal.body.querySelector('.cme-preview'),error=modal.body.querySelector('[data-custom-error]'),save=modal.footer.querySelector('[data-custom-save]'),labelStatus=modal.body.querySelector('[data-custom-label-status]');
  const wallControls=document.createElement('div');wallControls.className='cme-wall-controls';
  wallControls.innerHTML=`<label class="field"><span>${t('Tvar stěny kapsy')}</span><select data-custom-field="wallType">${WALLS.map(([value,label])=>`<option value="${value}" ${value===(draft.pocketWall?.type||'vertical')?'selected':''}>${t(label)}</option>`).join('')}</select></label><label class="field" data-custom-wall-value><span data-custom-wall-label></span><div class="input-wrap"><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-custom-field="wallValue"><em data-custom-wall-unit></em></div><small class="muted-note" data-custom-wall-range></small></label>`;
  modal.body.querySelector('[data-custom-radius]').after(wallControls);
  // Keep related settings together while the drawing and Save stay available.
  const properties=modal.body.querySelector('.cme-properties'),pocketStart=properties.querySelector('[data-custom-field="pocketName"]').closest('.field'),labelStart=properties.querySelector('[data-custom-field="label"]').closest('.field');
  const grouped={module:[],pocket:[],wall:[wallControls],label:[]};let group='module';
  for(const child of [...properties.children]){if(child===pocketStart)group='pocket';if(child===labelStart)group='label';if(child!==wallControls&&child!==error)grouped[group].push(child);}
  for(const [key,title] of [['module','Rozměry modulu'],['pocket','Tvar a rozměry kapsy'],['wall','Stěny kapsy'],['label','Tiskový popisek']]){
    const details=document.createElement('details'),summary=document.createElement('summary'),name=document.createElement('span'),value=document.createElement('small'),body=document.createElement('div');
    details.className='ui-disclosure editor-disclosure cme-section';details.dataset.customSection=key;name.textContent=t(title);value.dataset.customSummary=key;summary.append(name,value);body.className='ui-disclosure-body editor-disclosure-body';body.append(...grouped[key]);details.append(summary,body);properties.insertBefore(details,error);
  }
  const section=document.createElement('figure');section.className='cme-wall-section';section.innerHTML=`<figcaption>${t('Řez stěnou')}</figcaption><svg data-custom-wall-section role="img" aria-label="${esc(t('Profil stěny od horní hrany ke dnu kapsy.'))}"></svg>`;
  svg.after(section);
  const floorLegend=document.createElement('span');floorLegend.className='cme-floor-legend';floorLegend.textContent=t('Dno kapsy');modal.body.querySelector('.cme-legend').append(floorLegend);
  const control=key=>modal.body.querySelector(`[data-custom-field="${key}"]`);
  const pointField=key=>control(key).closest('.field');
  const fieldsWithErrors=new Set();
  function updateWallControl(){
    const wall=draft.pocketWall,type=wall?.type||'vertical',angle=type==='draft';
    control('wallType').value=type;
    wallControls.querySelector('[data-custom-wall-value]').hidden=type==='vertical';section.hidden=type==='vertical';
    wallControls.querySelector('[data-custom-wall-label]').textContent=t(angle?'Úhel od svislice':type==='chamfer'?'Šířka zkosení':'Poloměr zaoblení');
    wallControls.querySelector('[data-custom-wall-unit]').textContent=angle?'°':displayUnit;
    wallControls.querySelector('[data-custom-wall-range]').textContent=t(angle?'Úhel 0,5–45°.':'Rozměr 0,2–20 mm, nejvýše hloubka kapsy.');
    control('wallValue').value=angle?String(wall?.value??10):inputValue(wall?.value??2,{unit:displayUnit,digits:5});
  }
  function updatePointFields(){
    const point=draft.points[selected]||{x:0,y:0};
    for(const [key,value] of [['pointX',point.x],['pointY',point.y]])control(key).value=inputValue(value,{unit:displayUnit,digits:5});
    modal.body.querySelector('[data-custom-point-title]').textContent=t('Bod {n}',{n:selected+1});
    modal.body.querySelector('[data-custom-point-count]').textContent=t('{n} bodů',{n:draft.points.length});
    modal.body.querySelector('[data-custom-point="delete"]').disabled=draft.points.length<=3;
    modal.body.querySelector('[data-custom-point="add"]').disabled=draft.points.length>=128;
    fieldsWithErrors.delete('pointX');fieldsWithErrors.delete('pointY');
    pointField('pointX').querySelector('input').removeAttribute('aria-invalid');pointField('pointY').querySelector('input').removeAttribute('aria-invalid');
  }
  function updatePolygonDimensions(){
    if(draft.shape!=='polygon'||!draft.points.length)return;
    for(const [key,axis] of [['pocketWidth','x'],['pocketHeight','y']]){
      draft[key]=Math.max(...draft.points.map(point=>point[axis]))-Math.min(...draft.points.map(point=>point[axis]));
      control(key).value=inputValue(draft[key],{unit:displayUnit,digits:5});
    }
  }
  function frame(points,width,height){
    const minX=Math.min(...points.map(point=>point.x)),minY=Math.min(...points.map(point=>point.y)),normalized=points.map(point=>({x:point.x-minX,y:point.y-minY}));
    const module={id:'custom-preview-module',name:draft.name,x:0,y:0,width,height,sizeMode:'manual',pocketMargin:draft.pocketMargin};
    const tool={...sourceTool,id:'custom-preview-pocket',moduleId:module.id,points:normalized,x:0,y:0,rotation:sourceTool?.rotation||0,depth:draft.depth,fingerGrips:clone(sourceTool?.fingerGrips||[]),name:draft.pocketName,customPocket:true,pocketMargin:draft.pocketMargin,sizeLabel:draft.label,pocketWall:draft.pocketWall};
    const box=bounds(tool),oldBox=sourceTool?bounds(sourceTool):null;
    const cx=oldBox?oldBox.x-sourceModule.x+oldBox.width/2+(width-sourceModule.width)/2:width/2,cy=oldBox?oldBox.y-sourceModule.y+oldBox.height/2+(height-sourceModule.height)/2:height/2;
    tool.x=cx-box.width/2;tool.y=cy-box.height/2;
    const angle=tool.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),rotated=normalized.map(point=>({x:point.x*c-point.y*s,y:point.x*s+point.y*c})),rx=Math.min(...rotated.map(point=>point.x)),ry=Math.min(...rotated.map(point=>point.y));
    const positions=rotated.map(point=>({x:point.x-rx+tool.x,y:point.y-ry+tool.y}));
    return{module,tool,positions,center:{x:cx,y:cy}};
  }
  function preview(){
    if(fieldsWithErrors.size)throw i18nError('Zadejte platné rozměry.');
    if(!draft.name.trim()||!draft.pocketName.trim())throw i18nError('Zadejte název modulu a kapsy.');
    const points=customPocketPoints(draft),width=Number(draft.width),height=Number(draft.height),wall=modulePadding(source);
    if(!(width>=5&&height>=5&&width<=3000&&height<=3000))throw i18nError('Zadejte platné rozměry modulu.');
    if(!(draft.pocketMargin>=0&&draft.pocketMargin<=10))throw i18nError('Vůle musí být v rozsahu 0–10 mm.');
    const {module,tool,positions}=frame(points,width,height);
    if(!(draft.depth>=.5&&draft.depth<=maxPocketDepth(source,tool)+.000001))throw i18nError('Hloubka kapsy musí zachovat dno modulu.');
    validatePocketWall(draft.pocketWall,draft.depth);
    const projectPreview={...source,sizeLabels:!!draft.label.trim(),modules:[module],tools:[tool]},pocket=pocketLayoutOutline(tool,projectPreview),floors=pocketFloorOutlines(tool,projectPreview);
    if(pocket.some(point=>point.x<wall-1e-6||point.x>width-wall+1e-6||point.y<wall-1e-6||point.y>height-wall+1e-6))throw i18nError('Kapsa včetně vůle musí zachovat stěny modulu.');
    tool.poly=pocket;
    const labels=draft.label.trim()?planSizeLabels(projectPreview):{labels:[],skipped:[]};
    return{points,pocket,floors,positions,labels,width,height};
  }
  function screenScale(){const rect=svg.getBoundingClientRect();return Math.max(.0001,Math.min((rect.width||600)/view.width,(rect.height||420)/view.height));}
  function position(event){
    try{const matrix=svg.getScreenCTM?.();if(matrix&&svg.createSVGPoint){const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;return point.matrixTransform(matrix.inverse());}}catch{}
    const rect=svg.getBoundingClientRect(),width=rect.width||600,height=rect.height||420,scale=Math.min(width/view.width,height/view.height);
    return{x:view.x+(event.clientX-rect.left-(width-view.width*scale)/2)/scale,y:view.y+(event.clientY-rect.top-(height-view.height*scale)/2)/scale};
  }
  function renderSection(){
    const sectionSvg=section.querySelector('svg');
    if(!draft.pocketWall){sectionSvg.innerHTML='';return;}
    try{
      validatePocketWall(draft.pocketWall,draft.depth);
      const depth=draft.depth,topOffset=pocketWallOffset(draft.pocketWall,depth,depth),bottomOffset=pocketWallOffset(draft.pocketWall,depth,0),left=-topOffset-4,right=-bottomOffset+5;
      const profile=Array.from({length:65},(_,index)=>{const h=depth*(1-index/64);return{x:-pocketWallOffset(draft.pocketWall,depth,h),y:depth-h};});
      sectionSvg.setAttribute('viewBox',`${left-1} -1 ${right-left+2} ${depth+4}`);
      sectionSvg.innerHTML=`<path class="cme-section-material" d="M${left},0 L${profile.map(point=>`${point.x},${point.y}`).join(' L')} L${right},${depth} L${right},${depth+2} L${left},${depth+2}Z"/><path class="cme-section-profile" d="${profile.map((point,index)=>`${index?'L':'M'}${point.x},${point.y}`).join(' ')} L${right},${depth}"/>`;
    }catch{sectionSvg.innerHTML='';}
  }
  function render(){
    if(closed)return;
    const length=value=>inputValue(value,{unit:displayUnit,digits:2});
    properties.querySelector('[data-custom-summary="module"]').textContent=`${length(draft.width)} × ${length(draft.height)} ${displayUnit}`;
    properties.querySelector('[data-custom-summary="pocket"]').textContent=t(SHAPES.find(([value])=>value===draft.shape)?.[1]||'Vlastní obrys');
    properties.querySelector('[data-custom-summary="wall"]').textContent=t(WALLS.find(([value])=>value===(draft.pocketWall?.type||'vertical'))?.[1]||'Kolmá');
    properties.querySelector('[data-custom-summary="label"]').textContent=draft.label.trim();
    let scene,problem='';try{scene=preview();}catch(failure){problem=errorText(failure);}
    lastProblem=problem;error.textContent=problem;save.disabled=!!problem;
    renderSection();floorLegend.hidden=!draft.pocketWall;modal.body.querySelector('.cme-legend span:nth-child(2)').textContent=t(draft.pocketWall?'Horní okraj kapsy':'Kapsa včetně vůle');
    modal.body.querySelector('[data-custom-radius]').hidden=draft.shape!=='rounded-rect';
    modal.body.querySelector('[data-custom-vertices]').hidden=draft.shape!=='polygon';
    modal.body.querySelector('[data-custom-help]').textContent=t(draft.shape==='polygon'?'Vyberte bod a přetáhněte jej. Šipky posouvají vybraný bod; Shift zvětší krok. Insert přidá bod a Delete jej smaže.':'Rozměry upravujte vpravo. Pro ruční úpravu jednotlivých bodů vyberte Vlastní obrys.');
    svg.classList.toggle('cme-invalid',!!problem);
    if(!scene){
      labelStatus.textContent='';
      if(draft.shape!=='polygon'||!draft.points.length||!draft.points.every(point=>Number.isFinite(point.x+point.y))||!(draft.width>0&&draft.height>0))return;
      const {positions}=frame(draft.points,draft.width,draft.height);
      scene={width:draft.width,height:draft.height,positions,pocket:positions,floors:[],labels:{labels:[],skipped:[]}};
    }
    const pad=Math.max(6,Math.max(scene.width,scene.height)*.08);view={x:-pad,y:-pad,width:scene.width+2*pad,height:scene.height+2*pad};svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.width} ${view.height}`);
    const scale=screenScale(),dot=4/scale,hit=22/scale;
    const labels=scene.labels.labels||[];
    svg.innerHTML=`<rect class="cme-shell" x="0" y="0" width="${scene.width}" height="${scene.height}" rx="1"/><path class="cme-pocket" d="${path(scene.pocket)}"/>${draft.pocketWall?(scene.floors||[]).map(floor=>`<path class="cme-floor" d="${path(floor)}"/>`).join(''):''}${labels.map(label=>`<g class="cme-print-label" aria-label="${esc(label.text)}"><path d="${label.screenPolygons.map(path).join(' ')}"/></g>`).join('')}${draft.shape==='polygon'?`<g>${scene.positions.map((point,index)=>`<g class="cme-vertex ${index===selected?'selected':''}" data-custom-vertex="${index}" role="button" aria-label="${esc(t('Bod {n}',{n:index+1}))}"><circle class="cme-point-hit" cx="${point.x}" cy="${point.y}" r="${hit}"/><circle class="cme-point-dot" cx="${point.x}" cy="${point.y}" r="${dot}"/><text x="${point.x+7/scale}" y="${point.y-7/scale}" font-size="${11/scale}">${index+1}</text></g>`).join('')}</g>`:''}`;
    const skipped=scene.labels.skipped?.[0];
    labelStatus.textContent=skipped?t(SIZE_LABEL_REASONS[skipped.reason]||'Popisek se do modulu nevejde.'):labels.length?t('Náhled zobrazuje skutečný tiskový popisek.'):'';
  }
  function finish(cancel=false){
    if(!gesture)return;const previous=gesture;gesture=null;
    if(cancel){draft.points=previous.before;selected=previous.index;}
    try{svg.releasePointerCapture?.(previous.pointerId);}catch{}
    updatePolygonDimensions();updatePointFields();render();
  }
  function blur(){finish(true);activeTouches.clear();}
  function outsideEnd(event){activeTouches.delete(event.pointerId);if(gesture?.pointerId===event.pointerId)finish(event.type==='pointercancel');}
  function pointAction(action){
    if(draft.shape!=='polygon'||gesture)return;
    if(action==='previous')selected=(selected+draft.points.length-1)%draft.points.length;
    if(action==='next')selected=(selected+1)%draft.points.length;
    if(action==='add'&&draft.points.length<128){const a=draft.points[selected],b=draft.points[(selected+1)%draft.points.length];draft.points.splice(selected+1,0,{x:(a.x+b.x)/2,y:(a.y+b.y)/2});selected++;}
    if(action==='delete'&&draft.points.length>3){draft.points.splice(selected,1);selected=Math.min(selected,draft.points.length-1);}
    updatePolygonDimensions();updatePointFields();render();svg.focus();
  }
  modal.body.addEventListener('input',event=>{
    const key=event.target.dataset.customField;if(!key||key==='shape'||key==='wallType')return;
    if(['name','pocketName','label'].includes(key)){draft[key]=event.target.value;render();return;}
    if(key==='wallValue'){
      const type=control('wallType').value,value=type==='draft'?Number(event.target.value.trim().replace(',','.')):parseLength(event.target.value,displayUnit);
      if(!Number.isFinite(value)){fieldsWithErrors.add(key);event.target.setAttribute('aria-invalid','true');render();return;}
      fieldsWithErrors.delete(key);event.target.removeAttribute('aria-invalid');draft.pocketWall={type,value};wallMemory.set(type,value);render();return;
    }
    const value=parseLength(event.target.value,displayUnit),isPoint=key==='pointX'||key==='pointY';
    if(!Number.isFinite(value)){fieldsWithErrors.add(key);event.target.setAttribute('aria-invalid','true');render();return;}
    fieldsWithErrors.delete(key);event.target.removeAttribute('aria-invalid');
    if(isPoint){if(draft.points[selected])draft.points[selected][key==='pointX'?'x':'y']=value;updatePolygonDimensions();}
    else if(numeric.includes(key)){
      if(draft.shape==='polygon'&&['pocketWidth','pocketHeight'].includes(key)&&draft[key]>0&&value>0){const axis=key==='pocketWidth'?'x':'y',ratio=value/draft[key];draft.points=draft.points.map(point=>({...point,[axis]:point[axis]*ratio}));}
      draft[key]=value;
    }
    render();
  });
  control('shape').addEventListener('change',event=>{
    finish(true);const shape=event.target.value;
    if(shape==='polygon'&&draft.shape!=='polygon'){try{draft.points=customPocketPoints(draft);}catch{draft.points=[{x:0,y:0},{x:draft.pocketWidth,y:0},{x:draft.pocketWidth,y:draft.pocketHeight},{x:0,y:draft.pocketHeight}];}selected=0;}
    draft.shape=shape;fieldsWithErrors.delete('cornerRadius');updatePointFields();render();
  });
  control('wallType').addEventListener('change',event=>{
    const type=event.target.value;draft.pocketWall=type==='vertical'?null:{type,value:wallMemory.get(type)??(type==='draft'?10:type==='chamfer'?1.5:2)};
    fieldsWithErrors.delete('wallValue');control('wallValue').removeAttribute('aria-invalid');updateWallControl();render();
  });
  modal.body.querySelectorAll('[data-custom-point]').forEach(button=>button.onclick=()=>pointAction(button.dataset.customPoint));
  svg.addEventListener('pointerdown',event=>{
    if(event.pointerType==='touch'){activeTouches.add(event.pointerId);if(activeTouches.size>1){finish(true);return;}}
    if(event.button!==0||gesture||draft.shape!=='polygon'||activeTouches.size>1)return;
    const start=position(event),currentFrame=frame(draft.points,draft.width,draft.height);
    const nearest=currentFrame.positions.map((point,index)=>({index,distance:Math.hypot(point.x-start.x,point.y-start.y)})).sort((a,b)=>a.distance-b.distance)[0];
    if(!nearest||nearest.distance>22/screenScale())return;
    event.preventDefault();selected=nearest.index;
    gesture={pointerId:event.pointerId,index:selected,start,before:clone(draft.points),worldStart:currentFrame.positions[selected],center:currentFrame.center};svg.focus();try{svg.setPointerCapture?.(event.pointerId);}catch{}updatePointFields();render();
  });
  svg.addEventListener('pointermove',event=>{
    if(!gesture||event.pointerId!==gesture.pointerId)return;event.preventDefault();
    const current=position(event),angle=(sourceTool?.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),dx=current.x-gesture.start.x,dy=current.y-gesture.start.y;
    // The pocket remains centred. An extremal vertex also changes its bounding-box centre;
    // solve that dependency so the visible handle follows the pointer without lagging.
    const others=gesture.before.filter((_,index)=>index!==gesture.index).map(point=>({x:point.x*c-point.y*s,y:point.x*s+point.y*c}));
    const solve=(axis,delta)=>{const min=Math.min(...others.map(point=>point[axis])),max=Math.max(...others.map(point=>point[axis])),wanted=gesture.worldStart[axis]+delta-gesture.center[axis];return wanted<(min-max)/2?2*wanted+max:wanted>(max-min)/2?2*wanted+min:wanted+(min+max)/2;};
    const x=solve('x',dx),y=solve('y',dy);
    draft.points[gesture.index]={x:Math.round((x*c+y*s)*1000)/1000,y:Math.round((-x*s+y*c)*1000)/1000};updatePointFields();render();
  });
  svg.addEventListener('lostpointercapture',()=>finish(true));
  svg.addEventListener('keydown',event=>{
    if(draft.shape!=='polygon'||gesture)return;
    if(['Delete','Backspace','Insert'].includes(event.key)){event.preventDefault();pointAction(event.key==='Insert'?'add':'delete');return;}
    const movement={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(!movement)return;
    event.preventDefault();const step=event.shiftKey?5:.5;draft.points[selected].x+=movement[0]*step;draft.points[selected].y+=movement[1]*step;updatePolygonDimensions();updatePointFields();render();
  });
  window.addEventListener('blur',blur);window.addEventListener('pointerup',outsideEnd,true);window.addEventListener('pointercancel',outsideEnd,true);
  modal.footer.querySelector('[data-custom-cancel]').onclick=()=>modal.close();
  save.onclick=()=>{
    if(gesture)finish(false);
    try{preview();const result=onSave(clone(draft));if(result&&typeof result.then==='function')throw i18nError('Uložení modulu musí být okamžité.');modal.close();}catch(failure){lastProblem=errorText(failure);error.textContent=lastProblem;}
  };
  // Useful to callers and tests without exposing mutable draft data.
  modal.getDraft=()=>clone(draft);modal.initialDraft=initial;modal.getError=()=>lastProblem;
  updateWallControl();updatePointFields();render();return modal;
}
