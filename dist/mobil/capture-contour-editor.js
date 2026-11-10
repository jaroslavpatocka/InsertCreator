import {getCaptureEditModel,applyCaptureEdit,resetCaptureEdit,cloneContourModel,flattenContour,nearestContourSegment,insertContourNode,moveContourNode,curveContourNode,straightContourNode,deleteContourNode,resizeContourModel,smoothContourModel,limitCaptureEdit,assertCaptureEditSafety} from './capture-contour-edit.js';
import {buildFreehandContour} from './capture-freehand.js';
import {getToolDimensions} from './tool-dimensions.js';
import {openContextMenu} from './context-menu.js';
import {t,errorText} from './i18n.js';
import {inputValue,parseLength,unit} from './units.js';
import {capturePhotoGeometry} from './capture-tools.js';

const fields=['editedPoints','contourEdit','contourEditOrigin','contourReserveRatio','pocketShape'];
const snapshot=item=>Object.fromEntries(fields.filter(key=>Object.hasOwn(item,key)).map(key=>[key,structuredClone(item[key])]));
const restore=(item,value)=>{for(const key of fields)delete item[key];Object.assign(item,structuredClone(value));};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
let nextHint=0;

/** Direct point/curve editing. Navigation observes touch first and can cancel
 * this editor when a second finger starts a pinch; ordinary mouse pan bubbles. */
export function bindCaptureContourEditor(canvas,{getItems,getActiveIndex,onSelect,getPhotoScale,getView,getPocketMargin=()=>null,isBusy=()=>false,onUpdate=()=>{},onRedraw=()=>{},onCreateContour=null,sessionHistory=null,onError=()=>{}}){
  const document=canvas.ownerDocument,host=document.defaultView;
  const previousTabIndex=canvas.getAttribute('tabindex'),previousDescription=canvas.getAttribute('aria-describedby');canvas.tabIndex=0;
  if(!document.getElementById('capture-contour-editor-styles')){
    const link=document.createElement('link');link.id='capture-contour-editor-styles';link.rel='stylesheet';link.href=new URL('./capture-contour-editor.css',import.meta.url).href;document.head.append(link);
  }
  const surface=canvas.closest('.capture-canvas')||canvas.parentElement,area=document.createElement('div'),toolbar=document.createElement('div');
  area.className='capture-editor-area';surface.replaceWith(area);area.append(toolbar,surface);toolbar.className='capture-contour-toolbar';
  const palettes=[];
  const icons={point:'M5 19 9 5l4 8 8 4-16 2Z',curve:'M3 19C3 3 21 21 21 5M3 19l0-6m18-8v6',straight:'M4 19 12 5l8 14M9 5h6',smooth:'M3 17h5c5 0 3-10 8-10h5M5 12a7 7 0 1 0 14 0 7 7 0 1 0-14 0',delete:'m6 6 12 12M18 6 6 18',draw:'m4 16 12-12 4 4L8 20H4v-4Zm9-9 4 4',redraw:'M5 9a8 8 0 1 1-1 6M3 4v6h6m0 6 7-7 2 2-7 7H9v-2Z',toggle:'M12 3v18M3 12h18M9 6l3-3 3 3M6 9l-3 3 3 3m12-6 3 3-3 3m-9 3 3 3 3-3',undo:'M8 5 3 10l5 5M3 10h10a7 7 0 0 1 7 7',redo:'m16 5 5 5-5 5m5-5H11a7 7 0 0 0-7 7',reset:'M4 9a8 8 0 1 1-1 6M3 3v7h7'};
  function makePalette(container){
    container.classList.add('capture-contour-palette');container.setAttribute('role','group');container.setAttribute('aria-label',t('Úprava obrysu'));
    const actions=document.createElement('div');actions.className='capture-contour-actions';container.append(actions);const buttons={};
    for(const [action,label] of [['point','Bod'],['curve','Křivka'],['straight','Rovný bod'],['smooth','Vyhladit'],['delete','Smazat bod'],['draw','Nový obrys'],['redraw','Překreslit'],['toggle','Posun fotky'],['undo','Zpět'],['redo','Znovu'],['reset','Vrátit obrys']]){
      const el=document.createElement('button'),labelNode=document.createElement('span');el.type='button';el.className='capture-contour-tile';el.dataset.contourAction=action;
      el.innerHTML=`<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${icons[action]}"/></svg>`;labelNode.textContent=t(label);el.append(labelNode);actions.append(el);buttons[action]=el;
    }
    const brush=document.createElement('div');brush.className='capture-contour-brush';container.append(brush);
    const shapeGroup=document.createElement('div');shapeGroup.className='capture-contour-shapes';shapeGroup.setAttribute('role','group');shapeGroup.setAttribute('aria-label',t('Tvar vyhlazení'));brush.append(shapeGroup);
    for(const [shape,label] of [['round','Oblý roh'],['line','Rovně'],['corner','Ostrý roh'],['auto','Auto']]){const button=document.createElement('button');button.type='button';button.dataset.contourBrush='shape';button.dataset.shape=shape;button.textContent=t(label);shapeGroup.append(button);}
    const size=document.createElement('label'),sizeText=document.createElement('span'),radius=document.createElement('input'),output=document.createElement('output');size.className='capture-contour-brush-size';sizeText.textContent=t('Velikost štětce');radius.type='range';radius.min='8';radius.max='96';radius.step='1';radius.value='32';radius.dataset.contourBrush='radius';radius.setAttribute('aria-label',t('Poloměr štětce'));size.append(sizeText,radius,output);brush.append(size);
    const hint=document.createElement('p');hint.className='capture-contour-hint';hint.id=`capture-contour-hint-${++nextHint}`;container.append(hint);
    const palette={container,buttons,brush,radius,output,hint};palettes.push(palette);
    actions.addEventListener('click',event=>{const action=event.target.closest('[data-contour-action]')?.dataset.contourAction;if(action)runAction(action);});
    shapeGroup.addEventListener('click',event=>{const shape=event.target.closest('[data-shape]')?.dataset.shape;if(shape){cancel();brushShape=shape;refresh();onRedraw();}});
    radius.addEventListener('input',()=>{cancel();brushRadius=Math.max(8,Math.min(96,Number(radius.value)||32));refresh();onRedraw();});return palette;
  }
  const mainPalette=makePalette(toolbar),hint=mainPalette.hint;canvas.setAttribute('aria-describedby',[previousDescription,hint.id].filter(Boolean).join(' '));
  const details=document.createElement('div');details.className='capture-contour-details';area.append(details);
  const numeric=document.createElement('div');numeric.className='capture-contour-fields';details.append(numeric);
  const inputs={};
  for(const [key,label] of [['length','Délka'],['width','Šířka'],['x','X bodu'],['y','Y bodu']]){
    const wrap=document.createElement('label'),text=document.createElement('span'),input=document.createElement('input');wrap.className='field';text.textContent=t(label);input.type='text';input.inputMode='decimal';input.autocomplete='off';input.spellcheck=false;input.dataset.contourField=key;input.setAttribute('aria-label',t(label));wrap.append(text,input);numeric.append(wrap);inputs[key]=input;
  }
  const status=document.createElement('p');status.className='capture-contour-status';status.setAttribute('aria-live','polite');details.append(status);
  const histories=new WeakMap(),dirtyFields=new Set(),invalidFields=new Set(),fieldOwners=new Map();let enabled=true,selected=null,selectedItem=null,drag=null,menu=null,space=false,disposed=false,suppressClick=false,invalidModel=null,tool='point',brushShape='round',brushRadius=32,hover=null,edgeLimited=false;
  const clearFields=()=>{dirtyFields.clear();invalidFields.clear();for(const owner of fieldOwners.values())owner.handled=true;for(const input of Object.values(inputs))input.removeAttribute('aria-invalid');};
  const current=()=>{const index=getActiveIndex(),item=Number.isInteger(index)?getItems()[index]:null;return item?{index,item}:null;};
  const history=item=>{if(!histories.has(item))histories.set(item,{past:[],future:[]});return histories.get(item);};
  const modelOf=item=>getCaptureEditModel(item,getPhotoScale());
  const closeMenu=()=>{menu?.close();menu=null;};
  const notify=index=>{onUpdate(index);refresh();};
  const record=(item,before)=>{if(same(before,snapshot(item)))return;const h=sessionHistory||history(item);h.past.push(sessionHistory?{item,before,after:snapshot(item)}:before);if(h.past.length>50)h.past.shift();h.future=[];};
  const fail=error=>{if(error?.code==='CAPTURE_TOOL_EDGE'){edgeLimited=true;refresh();}onError(errorText(error));};
  const surfaces=new Map();let focusSurface=canvas;
  const surfaceOf=event=>surfaces.has(event?.currentTarget)?event.currentTarget:focusSurface;
  const local=event=>{const target=surfaceOf(event),rect=target.getBoundingClientRect(),view=surfaces.get(target).getView(),scale=getPhotoScale();return{x:((event.clientX-rect.left)*target.width/(rect.width||target.width)-view.x)/view.zoom,y:((event.clientY-rect.top)*target.height/(rect.height||target.height)-view.y)/view.zoom,scale};};
  const inModel=(point,model)=>({x:(point.x-model.origin.x)/point.scale,y:(point.y-model.origin.y)/point.scale});
  const cssScale=event=>{const target=surfaceOf(event),rect=target.getBoundingClientRect();return target.width/(rect.width||target.width)/surfaces.get(target).getView().zoom;};
  const stop=event=>{event.preventDefault();event.stopImmediatePropagation?.();};
  const clearSelection=()=>{selected=null;selectedItem=null;};
  const restoreHistory=(item,value)=>{const proposal={...item};restore(proposal,value);const scale=getPhotoScale(),points=capturePhotoGeometry(proposal,scale).points.map(p=>({x:p.x/scale,y:p.y/scale}));assertCaptureEditSafety(item,scale,{origin:{x:0,y:0}},points);restore(item,value);};

  function refresh(){
    if(disposed)return;
    const active=current();if(active?.item!==selectedItem){selected=null;selectedItem=active?.item||null;}
    const h=sessionHistory||(active?history(active.item):null),busy=isBusy();
    for(const target of surfaces.keys()){target.classList.toggle('is-contour-editing',enabled&&!busy);target.classList.toggle('is-contour-brushing',enabled&&tool==='smooth'&&!busy);}
    const model=active?modelOf(active.item):null,node=model&&selected!==null?model.nodes[selected]:null;
    if(model){const dimensions=getToolDimensions({points:flattenContour(model.nodes)});for(const key of ['length','width'])if(document.activeElement!==inputs[key]&&!dirtyFields.has(key)&&!invalidFields.has(key))inputs[key].value=inputValue(dimensions[key],{digits:5});}
    for(const key of ['x','y'])if(document.activeElement!==inputs[key]&&!dirtyFields.has(key)&&!invalidFields.has(key))inputs[key].value=node?inputValue(node[key],{digits:5}):'';
    for(const key of ['length','width','x','y'])inputs[key].disabled=busy||!enabled||!model||(['x','y'].includes(key)&&(!node||tool!=='point'));
    for(const [key,input] of Object.entries(inputs)){input.title=unit();input.closest('label').querySelector('span').textContent=t({length:'Délka',width:'Šířka',x:'X bodu',y:'Y bodu'}[key])+` (${unit()})`;}
    const instructions=!enabled?'Tažením posuňte fotografii. Kolečkem ji přiblížíte.':tool==='smooth'?'Vyhladit: držte levé tlačítko a přejíždějte hranu v kolečku. Více přejezdů zesílí úpravu. Zpět vrátí celý tah.':tool==='draw'?'Nový obrys: jedním tahem obkreslete celý nástroj. Uvolněním obrys uzavřete. Esc tah zruší.':tool==='redraw'?'Překreslit: jedním tahem nahraďte obrys vybraného nástroje. Uvolněním jej uzavřete. Esc tah zruší.':'Bod: kliknutím na hranu přidáte bod, tažením ho přesunete. Vyberte bod a použijte Křivka, Rovný bod nebo Smazat. Čtverečky mění zakřivení.';
    for(const {buttons,brush,radius,output,hint,container} of palettes){
      for(const [action,button] of Object.entries(buttons)){button.disabled=busy||(['curve','straight','delete'].includes(action)&&(!model||!node))||(['smooth','redraw'].includes(action)&&!model)||(action==='draw'&&!onCreateContour);if(['point','smooth','draw','redraw','toggle'].includes(action))button.setAttribute('aria-pressed',String(action==='toggle'?!enabled:enabled&&tool===action));}
      buttons.undo.disabled=busy||!h?.past.length;buttons.redo.disabled=busy||!h?.future.length;buttons.reset.disabled=busy||!active?.item.editedPoints;buttons.delete.disabled ||= (model?.nodes.length||0)<=3;
      brush.hidden=tool!=='smooth'||!enabled;radius.value=String(brushRadius);radius.disabled=busy;output.value=`${brushRadius*2} px`;hint.textContent=t(instructions)+' '+t('Hrana nástroje je chráněná.');hint.dataset.contourSafety='enabled';
      for(const button of container.querySelectorAll('[data-shape]')){button.setAttribute('aria-pressed',String(button.dataset.shape===brushShape));button.disabled=busy;}
    }
    status.textContent=edgeLimited?t('Dosažena hrana nástroje. Další zmenšení není bezpečné.'):active?(node?t('Vybraný bod {n} · ručně upravený obrys',{n:selected+1}):active.item.editedPoints?t('Ručně upravený obrys'):t('Vyberte místo na obrysu.')):t('Klikněte na nalezený obrys.');
  }

  function commit(next,{preserveFields=false,target=current()}={}){if(!target)return;const before=snapshot(target.item);applyCaptureEdit(target.item,getPhotoScale(),next);record(target.item,before);invalidModel=null;if(!preserveFields)clearFields();onError('');notify(target.index);}
  function menuAt(event){
    const active=current();if(!active||selected===null)return;closeMenu();
    menu=openContextMenu({title:t('Bod a profil kontury'),x:event.clientX,y:event.clientY,returnFocus:focusSurface,
      items:[{action:'move',label:t('Přesunout bod')},{action:'curve',label:t('Bézierova křivka')},{action:'straight',label:t('Rovný bod')},{action:'width',label:t('Rozšířit / zúžit')},{action:'length',label:t('Prodloužit / zkrátit')},{action:'delete',label:t('Smazat bod'),disabled:modelOf(active.item).nodes.length<=3}],
      onAction:action=>{
        if(disposed||isBusy())return;
        try{
          if(action==='curve')commit(curveContourNode(modelOf(active.item),selected));
          else if(action==='straight')commit(straightContourNode(modelOf(active.item),selected));
          else if(action==='delete'){commit(deleteContourNode(modelOf(active.item),selected));selected=null;notify(active.index);}
          else if(action==='width'||action==='length'){inputs[action].focus();inputs[action].select();return;}
          focusSurface.focus({preventScroll:true});
        }catch(error){fail(error);}
      }});menu.menu.classList.add('capture-contour-menu');
  }

  function cancel(){
    if(!drag)return;
    const previous=drag;drag=null;if(previous.item)restore(previous.item,previous.before);selected=previous.previousSelection;invalidModel=null;
    try{previous.surface.releasePointerCapture?.(previous.id);}catch{}
    notify(previous.index);
  }

  function beginStroke(event,value){
    const target=surfaceOf(event),rect=target.getBoundingClientRect(),view={...surfaces.get(target).getView()};
    drag={...value,id:event.pointerId,surface:target,scale:getPhotoScale(),mapping:{rect:{left:rect.left,top:rect.top,width:rect.width||target.width,height:rect.height||target.height},width:target.width,height:target.height,view},previousSelection:selected};
    clearSelection();suppressClick=true;stop(event);target.focus({preventScroll:true});try{target.setPointerCapture?.(event.pointerId);}catch{}clearFields();onError('');
  }
  function strokePoint(event){const {rect,width,height,view}=drag.mapping;return{x:((event.clientX-rect.left)*width/rect.width-view.x)/view.zoom,y:((event.clientY-rect.top)*height/rect.height-view.y)/view.zoom,scale:drag.scale};}
  function dab(point){
    const p={x:(point.x-drag.model.origin.x)/drag.scale,y:(point.y-drag.model.origin.y)/drag.scale};
    const result=smoothContourModel(drag.model,{center:p,radius:drag.radius,strength:.2,mode:drag.shape});
    if(result.changed){
      try{applyCaptureEdit(drag.item,drag.scale,result.model);drag.model=result.model;drag.changed=true;}
      catch(error){if(error?.code==='CAPTURE_TOOL_EDGE'){edgeLimited=true;return;}throw error;}
    }
  }
  function smoothDown(event,point){
    let target=current(),model=target?modelOf(target.item):null;
    const radius=brushRadius*cssScale(event)/point.scale;
    const distance=(candidate)=>nearestContourSegment(candidate,inModel(point,candidate))?.distance??Infinity;
    if(!model||distance(model)>radius){
      if(focusSurface!==canvas)return;
      let nearest=null;for(const [index,item] of getItems().entries()){const candidate=modelOf(item),d=distance(candidate);if(d<=radius&&(!nearest||d<nearest.d))nearest={index,item,model:candidate,d};}
      if(!nearest)return;target=nearest;model=nearest.model;onSelect(target.index);
    }
    beginStroke(event,{kind:'smooth',...target,model:cloneContourModel(model),before:snapshot(target.item),radius,shape:brushShape,spacing:Math.max(2,brushRadius*.35)*cssScale(event),carry:0,last:{x:point.x,y:point.y},changed:false});
    hover={surface:focusSurface,point:{x:point.x,y:point.y},radius:brushRadius*cssScale(event)};
    try{dab(point);}catch(error){cancel();fail(error);return;}notify(target.index);
  }

  function down(event){
    if(drag&&event.isPrimary===false){cancel();return;}
    if(disposed||!enabled||isBusy()||space||event.button!==0||event.isPrimary===false||drag||event.altKey)return;
    if(!validateFields()){stop(event);return;}
    edgeLimited=false;
    closeMenu();focusSurface=surfaceOf(event);let active=current(),point=local(event),model=active?modelOf(active.item):null,hit=null;
    if(tool==='smooth'){smoothDown(event,point);return;}
    if(tool==='draw'||tool==='redraw'){
      if(tool==='draw'&&!onCreateContour||tool==='redraw'&&!active)return;
      beginStroke(event,{kind:tool,item:tool==='redraw'?active.item:null,index:tool==='redraw'?active.index:null,before:tool==='redraw'?snapshot(active.item):null,origin:model?.origin||{x:0,y:0},points:[{x:point.x,y:point.y}]});onRedraw();return;
    }
    const radius=(event.pointerType==='touch'?22:9)*cssScale(event)/point.scale;
    if(model){
      const p=inModel(point,model),candidates=[];
      model.nodes.forEach((node,index)=>{if(node.manual||index===selected)candidates.push({index,point:node});if(index===selected)for(const handle of ['in','out'])if(node[handle])candidates.push({index,point:node[handle],handle});});
      for(const candidate of candidates){const distance=Math.hypot(p.x-candidate.point.x,p.y-candidate.point.y);if(distance<=radius&&(!hit||distance<hit.distance))hit={...candidate,distance};}
    }
    let inserted=false,previousSelection=selected,before=active?snapshot(active.item):null;
    if(!hit){
      let nearest=null;
      for(const [index,item] of getItems().entries()){
        if(focusSurface!==canvas&&index!==getActiveIndex())continue;
        const candidateModel=modelOf(item),edge=nearestContourSegment(candidateModel,inModel(point,candidateModel));
        if(!edge)continue;
        let distance=edge.distance;
        // Both the green profile and the blue manufacturing boundary are visible
        // editing targets. At high zoom the clearance can be much wider than the
        // hit radius; resolve a blue hit back to the un-offset editable profile.
        const margin=getPocketMargin();
        if(margin!==null&&(item.checked||index===getActiveIndex())){
          const visible=capturePhotoGeometry(item,point.scale,{includeMargin:true,pocketMargin:margin}).points;
          distance=Math.min(distance,nearestContourSegment({nodes:visible},point).distance/point.scale);
        }
        if(index===getActiveIndex()&&['ideal','hybrid','functional'].includes(item.pocketShape))distance=Math.min(distance,nearestContourSegment({nodes:item.contour.points},point).distance/point.scale);
        if(distance<=radius&&(!nearest||distance<nearest.distance))nearest={index,item,model:candidateModel,edge,distance};
      }
      if(!nearest)return;
      active={index:nearest.index,item:nearest.item};model=nearest.model;before=snapshot(active.item);previousSelection=active.item===selectedItem?selected:null;
      onSelect(active.index);selectedItem=active.item;
      try{const created=insertContourNode(model,inModel(point,model));model=created.model;selected=created.index;applyCaptureEdit(active.item,point.scale,model);inserted=true;hit={index:selected,point:model.nodes[selected]};}
      catch(error){fail(error);return;}
    }else selected=hit.index;
    selectedItem=active.item;const p=inModel(point,model),target=hit.handle?model.nodes[selected][hit.handle]:model.nodes[selected];
    drag={id:event.pointerId,surface:focusSurface,index:active.index,item:active.item,before,previousSelection,model:cloneContourModel(model),node:selected,handle:hit.handle,offset:{x:target.x-p.x,y:target.y-p.y},inserted,moved:false,invalid:false,start:{x:event.clientX,y:event.clientY}};
    suppressClick=true;stop(event);focusSurface.focus({preventScroll:true});try{focusSurface.setPointerCapture?.(event.pointerId);}catch{}clearFields();onError('');notify(active.index);
  }

  function move(event){
    if(enabled&&tool==='smooth'&&!space&&!event.altKey){const p=drag?strokePoint(event):local(event);hover={surface:surfaceOf(event),point:{x:p.x,y:p.y},radius:drag?.kind==='smooth'?drag.radius*drag.scale:brushRadius*cssScale(event)};if(!drag)onRedraw();}
    if(!drag||event.pointerId!==drag.id)return;
    stop(event);if(space||event.altKey||isBusy()||(drag.item&&getItems()[drag.index]!==drag.item)||event.pointerType!=='touch'&&!(event.buttons&1)){cancel();return;}
    if(drag.kind==='smooth'){
      const end=strokePoint(event),from=drag.last,dx=end.x-from.x,dy=end.y-from.y,distance=Math.hypot(dx,dy);let along=drag.spacing-drag.carry;
      try{while(along<=distance+1e-8){const fraction=Math.min(1,along/(distance||1));dab({x:from.x+dx*fraction,y:from.y+dy*fraction});along+=drag.spacing;}drag.carry=(drag.carry+distance)%drag.spacing;drag.last={x:end.x,y:end.y};notify(drag.index);}catch(error){cancel();fail(error);}return;
    }
    if(drag.kind==='draw'||drag.kind==='redraw'){
      const p=strokePoint(event),last=drag.points.at(-1),css=drag.mapping.width/drag.mapping.rect.width/drag.mapping.view.zoom;
      if(Math.hypot(p.x-last.x,p.y-last.y)>=css){if(drag.points.length>=24000){cancel();onError(t('Tah je příliš dlouhý. Nakreslete obrys znovu.'));return;}drag.points.push({x:p.x,y:p.y});onRedraw();}return;
    }
    drag.moved ||= Math.hypot(event.clientX-drag.start.x,event.clientY-drag.start.y)>2;
    if(!drag.moved)return;
    const point=inModel(local(event),drag.model),next=moveContourNode(drag.model,drag.node,{x:point.x+drag.offset.x,y:point.y+drag.offset.y},{handle:drag.handle});
    try{const limited=limitCaptureEdit(drag.item,getPhotoScale(),drag.safeModel||drag.model,next);if(!limited.limited||limited.progress>1e-5){applyCaptureEdit(drag.item,getPhotoScale(),limited.model);drag.safeModel=cloneContourModel(limited.model);}edgeLimited=limited.limited;drag.invalid=false;invalidModel=null;onError('');}
    catch{drag.invalid=true;invalidModel=next;}
    notify(drag.index);
  }

  function up(event){
    if(!drag||event.pointerId!==drag.id)return;stop(event);
    if(drag.kind==='smooth'||drag.kind==='draw'||drag.kind==='redraw'){
      // Include a final unreported pointer position, without an extra brush dab.
      move(event.pointerType==='touch'?event:{pointerId:event.pointerId,pointerType:event.pointerType,buttons:1,clientX:event.clientX,clientY:event.clientY,currentTarget:event.currentTarget,preventDefault:()=>{},stopImmediatePropagation:()=>{}});
      if(!drag)return;const stroke=drag;drag=null;try{stroke.surface.releasePointerCapture?.(stroke.id);}catch{}
      if(stroke.kind==='smooth'){record(stroke.item,stroke.before);notify(stroke.index);return;}
      try{
        const result=buildFreehandContour(stroke.points,{pxPerMm:stroke.scale,origin:stroke.origin});
        if(stroke.kind==='redraw'){applyCaptureEdit(stroke.item,stroke.scale,result.model);record(stroke.item,stroke.before);notify(stroke.index);}
        else onCreateContour(result.model);
        onError('');onRedraw();
      }catch(error){if(stroke.item)restore(stroke.item,stroke.before);fail(error);notify(stroke.index);}return;
    }
    const previous=drag;drag=null;
    try{previous.surface.releasePointerCapture?.(previous.id);}catch{}
    if(previous.invalid){restore(previous.item,previous.before);selected=previous.previousSelection;invalidModel=null;onError(t('Kontura se nesmí křížit sama se sebou.'));}
    else record(previous.item,previous.before);
    notify(previous.index);
    if(!previous.invalid&&!previous.moved)menuAt(event);
  }

  function key(event){
    if(event.code==='Space'||event.key===' '){space=true;cancel();hover=null;onRedraw();return;}
    if(!surfaces.has(event.target))return;focusSurface=event.target;
    const active=current();if(isBusy())return;
    if(event.key==='Escape'){stop(event);closeMenu();if(drag)cancel();else{clearSelection();refresh();onUpdate(active?.index);}return;}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){stop(event);runAction(event.shiftKey?'redo':'undo');return;}
    if(!active||!enabled||tool!=='point'||selected===null)return;
    try{
      if(event.key==='Delete'||event.key==='Backspace'){stop(event);commit(deleteContourNode(modelOf(active.item),selected));selected=null;notify(active.index);}
      else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
        stop(event);const model=modelOf(active.item),node=model.nodes[selected],step=event.shiftKey?1:.1;
        commit(moveContourNode(model,selected,{x:node.x+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),y:node.y+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)}));
      }else if(event.key==='Enter'){stop(event);const target=focusSurface,rect=target.getBoundingClientRect(),node=modelOf(active.item).nodes[selected],model=modelOf(active.item),view=surfaces.get(target).getView();menuAt({clientX:rect.left+((model.origin.x+node.x*getPhotoScale())*view.zoom+view.x)*(rect.width||target.width)/target.width,clientY:rect.top+((model.origin.y+node.y*getPhotoScale())*view.zoom+view.y)*(rect.height||target.height)/target.height});}
    }catch(error){fail(error);}
  }

  function runAction(action){
    if(isBusy())return;closeMenu();cancel();const active=current();
    if(action==='reset'&&active)for(const key of [...dirtyFields,...invalidFields])if(fieldOwners.get(key)?.item===active.item){dirtyFields.delete(key);invalidFields.delete(key);inputs[key].removeAttribute('aria-invalid');}
    if(!validateFields())return;clearFields();edgeLimited=false;onError('');
    if(action==='toggle'){enabled=!enabled;hover=null;refresh();onUpdate(active?.index);return;}
    if(['point','smooth','draw','redraw'].includes(action)){tool=action;enabled=true;hover=null;if(action!=='point')clearSelection();refresh();onUpdate(active?.index);return;}
    if(sessionHistory&&['undo','redo'].includes(action)){
      const from=action==='undo'?sessionHistory.past:sessionHistory.future,to=action==='undo'?sessionHistory.future:sessionHistory.past;if(!from.length)return;
      const step=from.at(-1);clearSelection();
      if(typeof step[action]==='function'){from.pop();to.push(step);step[action]();return;}
      const index=getItems().indexOf(step.item);if(index<0)return;
      try{restoreHistory(step.item,step[action==='undo'?'before':'after']);from.pop();to.push(step);onSelect(index);notify(index);focusSurface.focus({preventScroll:true});}catch(error){fail(error);}return;
    }
    if(!active)return;
    if(['curve','straight','delete'].includes(action)){
      if(selected===null)return;try{const model=modelOf(active.item);commit(action==='curve'?curveContourNode(model,selected):action==='straight'?straightContourNode(model,selected):deleteContourNode(model,selected));if(action==='delete')selected=null;tool='point';enabled=true;notify(active.index);focusSurface.focus({preventScroll:true});}catch(error){fail(error);}return;
    }
    if(action==='reset'){const before=snapshot(active.item);resetCaptureEdit(active.item);record(active.item,before);selected=null;notify(active.index);return;}
    const h=history(active.item),from=action==='undo'?h.past:h.future,to=action==='undo'?h.future:h.past;
    if(!from.length)return;const before=snapshot(active.item);try{restoreHistory(active.item,from.at(-1));from.pop();to.push(before);selected=null;notify(active.index);focusSurface.focus({preventScroll:true});}catch(error){fail(error);}
  }
  function ownField(key){
    const active=current();if(!active)return null;
    const previous=fieldOwners.get(key);
    if(previous&&(dirtyFields.has(key)||invalidFields.has(key)))return previous;
    const owner={...active,node:selected,handled:false};fieldOwners.set(key,owner);return owner;
  }
  function activateFieldOwner(key){
    const owner=fieldOwners.get(key),active=current();if(!owner)return;
    if(owner.item!==active?.item||(['x','y'].includes(key)&&owner.node!==selected)){
      onSelect(owner.index);selectedItem=owner.item;selected=owner.node;refresh();
    }
  }
  function focusField(key){if(ownField(key)){activateFieldOwner(key);if(document.activeElement!==inputs[key])inputs[key].focus({preventScroll:true});}}
  function applyField(key){
    const input=inputs[key],owner=fieldOwners.get(key)||ownField(key);if(!owner||isBusy())return false;
    // A browser may dispatch change only when focus leaves, after another tool
    // has already been selected. A completed old field must not run again.
    if(owner.handled&&!dirtyFields.has(key)&&!invalidFields.has(key)){refresh();return true;}
    try{const value=parseLength(input.value),model=modelOf(owner.item);
      dirtyFields.delete(key);invalidFields.delete(key);input.removeAttribute('aria-invalid');
      if(key==='length'||key==='width')commit(resizeContourModel(model,{[key]:value}),{preserveFields:true,target:owner});
      else if(owner.node!==null){const node=model.nodes[owner.node];commit(moveContourNode(model,owner.node,{x:key==='x'?value:node.x,y:key==='y'?value:node.y}),{preserveFields:true,target:owner});}
      owner.handled=true;
      if(owner.item!==current()?.item)queueMicrotask(refresh);
      dirtyFields.delete(key);invalidFields.delete(key);input.removeAttribute('aria-invalid');return true;
    }catch(error){invalidFields.add(key);input.setAttribute('aria-invalid','true');fail(error);refresh();return false;}
  }
  function validateFields(){
    for(const key of [...new Set([...dirtyFields,...invalidFields])])if(!applyField(key))break;
    if(invalidFields.size){const key=[...invalidFields][0],input=inputs[key];activateFieldOwner(key);input.focus();onError(t('Opravte neplatnou hodnotu úpravy obrysu.'));return false;}return true;
  }
  for(const [key,input] of Object.entries(inputs)){input.addEventListener('focus',()=>focusField(key));input.addEventListener('input',()=>{ownField(key);dirtyFields.add(key);});input.addEventListener('change',()=>applyField(key));}
  const cancelEvent=event=>{if(drag&&event.pointerId===drag.id){stop(event);cancel();}};
  const click=event=>{if(suppressClick){suppressClick=false;stop(event);}};
  const keyup=event=>{if(event.code==='Space'||event.key===' ')space=false;};
  const blur=()=>{space=false;hover=null;cancel();onRedraw();};
  const leave=event=>{if(!drag&&hover?.surface===surfaceOf(event)){hover=null;onRedraw();}};
  const navigation=()=>{hover=null;cancel();};
  const listeners=[['pointerdown',down],['pointermove',move],['pointerleave',leave],['wheel',navigation],['pointerup',up],['pointercancel',cancelEvent],['lostpointercapture',cancelEvent],['click',click],['keydown',key]];
  function bindSurface(target,{getView:surfaceView=getView}={}){
    if(surfaces.has(target))return()=>{};
    const attributes={tabindex:target.getAttribute('tabindex'),'aria-describedby':target.getAttribute('aria-describedby')};
    let palette=null;if(target!==canvas){const container=document.createElement('div');container.className='capture-contour-toolbar capture-contour-detail-tools';const wrapper=target.closest('.capture-guide-preview')||target.parentElement;wrapper.before(container);palette=makePalette(container);}
    surfaces.set(target,{getView:surfaceView,attributes,palette});target.tabIndex=0;if(target!==canvas)target.setAttribute('aria-describedby',[attributes['aria-describedby'],palette.hint.id].filter(Boolean).join(' '));
    for(const [name,listener] of listeners)target.addEventListener(name,listener,true);
    refresh();
    return()=>{if(drag?.surface===target)cancel();for(const [name,listener] of listeners)target.removeEventListener(name,listener,true);surfaces.delete(target);target.classList.remove('is-contour-editing','is-contour-brushing');if(palette){palette.container.remove();palettes.splice(palettes.indexOf(palette),1);}if(hover?.surface===target)hover=null;for(const [name,value] of Object.entries(attributes))if(value===null)target.removeAttribute(name);else target.setAttribute(name,value);if(focusSurface===target)focusSurface=canvas;};
  }
  bindSurface(canvas);host?.addEventListener('keyup',keyup);host?.addEventListener('blur',blur);
  refresh();
  return{
    get dragging(){return !!drag;},get draggingSurface(){return drag?.surface||null;},cancel,refresh,bindSurface,
    validate:validateFields,
    draw(ctx,scale=1,target=canvas){
      if(!enabled||isBusy())return;
      if(drag&&(drag.kind==='draw'||drag.kind==='redraw')&&drag.surface===target){ctx.save();ctx.lineWidth=2*scale;ctx.strokeStyle='#ce8713';ctx.setLineDash([5*scale,4*scale]);ctx.beginPath();drag.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.stroke();ctx.restore();}
      if(tool==='smooth'&&hover?.surface===target&&!space){ctx.save();ctx.lineWidth=1.5*scale;ctx.strokeStyle='#31594a';ctx.fillStyle='rgba(255,207,91,.12)';ctx.beginPath();ctx.arc(hover.point.x,hover.point.y,hover.radius,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();}
      const active=current();if(tool!=='point'||!active||active.item!==selectedItem)return;
      const model=invalidModel||modelOf(active.item),photo=p=>({x:model.origin.x+p.x*getPhotoScale(),y:model.origin.y+p.y*getPhotoScale()});
      ctx.save();ctx.lineWidth=1.5*scale;
      if(invalidModel){let points;try{points=flattenContour(model.nodes).map(photo);}catch{points=model.nodes.map(photo);}ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.strokeStyle='#bd3e38';ctx.stroke();}
      for(const [index,node] of model.nodes.entries()){
        if(!node.manual&&index!==selected)continue;const p=photo(node);
        if(index===selected)for(const handle of ['in','out'])if(node[handle]){const h=photo(node[handle]);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(h.x,h.y);ctx.strokeStyle='#477ca6';ctx.stroke();ctx.fillStyle='#fff';ctx.strokeStyle='#477ca6';ctx.beginPath();ctx.rect(h.x-4*scale,h.y-4*scale,8*scale,8*scale);ctx.fill();ctx.stroke();}
        ctx.beginPath();ctx.arc(p.x,p.y,(index===selected?6:4)*scale,0,Math.PI*2);ctx.fillStyle=index===selected?'#f3b63e':'#fff';ctx.strokeStyle='#273d32';ctx.fill();ctx.stroke();
      }
      ctx.restore();
    },
    destroy(){if(disposed)return;cancel();disposed=true;closeMenu();for(const [target,{attributes,palette}] of surfaces){for(const [name,listener] of listeners)target.removeEventListener(name,listener,true);target.classList.remove('is-contour-editing','is-contour-brushing');palette?.container.remove();for(const [name,value] of Object.entries(attributes))if(value===null)target.removeAttribute(name);else target.setAttribute(name,value);}surfaces.clear();host?.removeEventListener('keyup',keyup);host?.removeEventListener('blur',blur);toolbar.remove();if(previousTabIndex===null)canvas.removeAttribute('tabindex');else canvas.setAttribute('tabindex',previousTabIndex);if(previousDescription===null)canvas.removeAttribute('aria-describedby');else canvas.setAttribute('aria-describedby',previousDescription);if(area.isConnected){area.replaceWith(surface);}}
  };
}
