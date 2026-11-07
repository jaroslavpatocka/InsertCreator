import {getCaptureEditModel,applyCaptureEdit,resetCaptureEdit,cloneContourModel,flattenContour,nearestContourSegment,insertContourNode,moveContourNode,curveContourNode,straightContourNode,deleteContourNode,resizeContourModel} from './capture-contour-edit.js';
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
export function bindCaptureContourEditor(canvas,{getItems,getActiveIndex,onSelect,getPhotoScale,getView,getPocketMargin=()=>null,isBusy=()=>false,onUpdate=()=>{},onError=()=>{}}){
  const document=canvas.ownerDocument,host=document.defaultView;
  const previousTabIndex=canvas.getAttribute('tabindex'),previousDescription=canvas.getAttribute('aria-describedby');canvas.tabIndex=0;
  if(!document.getElementById('capture-contour-editor-styles')){
    const link=document.createElement('link');link.id='capture-contour-editor-styles';link.rel='stylesheet';link.href=new URL('./capture-contour-editor.css',import.meta.url).href;document.head.append(link);
  }
  const surface=canvas.closest('.capture-canvas')||canvas.parentElement,area=document.createElement('div'),toolbar=document.createElement('div');
  area.className='capture-editor-area';surface.replaceWith(area);area.append(surface,toolbar);toolbar.className='capture-contour-toolbar';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label',t('Úprava obrysu'));
  const actions=document.createElement('div');actions.className='capture-contour-actions';toolbar.append(actions);
  const buttons={};
  const button=(action,label)=>{const el=document.createElement('button');el.type='button';el.className='btn btn-light';el.dataset.contourAction=action;el.textContent=t(label);actions.append(el);buttons[action]=el;return el;};
  button('toggle','Upravit obrys').setAttribute('aria-pressed','true');button('undo','Zpět');button('redo','Znovu');button('reset','Vrátit rozpoznaný obrys');
  const hint=document.createElement('p');hint.className='capture-contour-hint';hint.id=`capture-contour-hint-${++nextHint}`;hint.textContent=t('Kliknutím na obrys přidáte bod. Bod přetáhněte; nabídka umožní křivku nebo změnu rozměrů.');toolbar.append(hint);canvas.setAttribute('aria-describedby',[previousDescription,hint.id].filter(Boolean).join(' '));
  const numeric=document.createElement('div');numeric.className='capture-contour-fields';toolbar.append(numeric);
  const inputs={};
  for(const [key,label] of [['length','Délka'],['width','Šířka'],['x','X bodu'],['y','Y bodu']]){
    const wrap=document.createElement('label'),text=document.createElement('span'),input=document.createElement('input');wrap.className='field';text.textContent=t(label);input.type='text';input.inputMode='decimal';input.autocomplete='off';input.spellcheck=false;input.dataset.contourField=key;input.setAttribute('aria-label',t(label));wrap.append(text,input);numeric.append(wrap);inputs[key]=input;
  }
  const status=document.createElement('p');status.className='capture-contour-status';status.setAttribute('aria-live','polite');toolbar.append(status);
  const histories=new WeakMap(),dirtyFields=new Set(),invalidFields=new Set(),fieldOwners=new Map();let enabled=true,selected=null,selectedItem=null,drag=null,menu=null,space=false,disposed=false,suppressClick=false,invalidModel=null;
  const clearFields=()=>{dirtyFields.clear();invalidFields.clear();for(const owner of fieldOwners.values())owner.handled=true;for(const input of Object.values(inputs))input.removeAttribute('aria-invalid');};
  const current=()=>{const index=getActiveIndex(),item=Number.isInteger(index)?getItems()[index]:null;return item?{index,item}:null;};
  const history=item=>{if(!histories.has(item))histories.set(item,{past:[],future:[]});return histories.get(item);};
  const modelOf=item=>getCaptureEditModel(item,getPhotoScale());
  const closeMenu=()=>{menu?.close();menu=null;};
  const notify=index=>{onUpdate(index);refresh();};
  const record=(item,before)=>{if(same(before,snapshot(item)))return;const h=history(item);h.past.push(before);if(h.past.length>50)h.past.shift();h.future=[];};
  const fail=error=>onError(errorText(error));
  const surfaces=new Map();let focusSurface=canvas;
  const surfaceOf=event=>surfaces.has(event?.currentTarget)?event.currentTarget:focusSurface;
  const local=event=>{const target=surfaceOf(event),rect=target.getBoundingClientRect(),view=surfaces.get(target).getView(),scale=getPhotoScale();return{x:((event.clientX-rect.left)*target.width/(rect.width||target.width)-view.x)/view.zoom,y:((event.clientY-rect.top)*target.height/(rect.height||target.height)-view.y)/view.zoom,scale};};
  const inModel=(point,model)=>({x:(point.x-model.origin.x)/point.scale,y:(point.y-model.origin.y)/point.scale});
  const cssScale=event=>{const target=surfaceOf(event),rect=target.getBoundingClientRect();return target.width/(rect.width||target.width)/surfaces.get(target).getView().zoom;};
  const stop=event=>{event.preventDefault();event.stopImmediatePropagation?.();};
  const clearSelection=()=>{selected=null;selectedItem=null;};

  function refresh(){
    if(disposed)return;
    const active=current();if(active?.item!==selectedItem){selected=null;selectedItem=active?.item||null;}
    const h=active?history(active.item):null,busy=isBusy();
    buttons.toggle.setAttribute('aria-pressed',String(enabled));for(const target of surfaces.keys())target.classList.toggle('is-contour-editing',enabled&&!busy);
    buttons.undo.disabled=busy||!h?.past.length;buttons.redo.disabled=busy||!h?.future.length;buttons.reset.disabled=busy||!active?.item.editedPoints;
    buttons.toggle.disabled=busy;
    const model=active?modelOf(active.item):null,node=model&&selected!==null?model.nodes[selected]:null;
    if(model){const dimensions=getToolDimensions({points:flattenContour(model.nodes)});for(const key of ['length','width'])if(document.activeElement!==inputs[key]&&!dirtyFields.has(key)&&!invalidFields.has(key))inputs[key].value=inputValue(dimensions[key],{digits:5});}
    for(const key of ['x','y'])if(document.activeElement!==inputs[key]&&!dirtyFields.has(key)&&!invalidFields.has(key))inputs[key].value=node?inputValue(node[key],{digits:5}):'';
    for(const key of ['length','width','x','y'])inputs[key].disabled=busy||!enabled||!model||(['x','y'].includes(key)&&!node);
    for(const [key,input] of Object.entries(inputs)){input.title=unit();input.closest('label').querySelector('span').textContent=t({length:'Délka',width:'Šířka',x:'X bodu',y:'Y bodu'}[key])+` (${unit()})`;}
    status.textContent=active?(node?t('Vybraný bod {n} · ručně upravený obrys',{n:selected+1}):active.item.editedPoints?t('Ručně upravený obrys'):t('Vyberte místo na obrysu.')):t('Klikněte na nalezený obrys.');
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
    const previous=drag;drag=null;restore(previous.item,previous.before);selected=previous.previousSelection;invalidModel=null;
    try{previous.surface.releasePointerCapture?.(previous.id);}catch{}
    notify(previous.index);
  }

  function down(event){
    if(disposed||!enabled||isBusy()||space||event.button!==0||event.isPrimary===false||drag||event.altKey)return;
    if(!validateFields()){stop(event);return;}
    closeMenu();focusSurface=surfaceOf(event);let active=current(),point=local(event),model=active?modelOf(active.item):null,hit=null;
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
    if(!drag||event.pointerId!==drag.id)return;
    stop(event);if(event.pointerType!=='touch'&&!(event.buttons&1)){cancel();return;}
    drag.moved ||= Math.hypot(event.clientX-drag.start.x,event.clientY-drag.start.y)>2;
    if(!drag.moved)return;
    const point=inModel(local(event),drag.model),next=moveContourNode(drag.model,drag.node,{x:point.x+drag.offset.x,y:point.y+drag.offset.y},{handle:drag.handle});
    try{applyCaptureEdit(drag.item,getPhotoScale(),next);drag.invalid=false;invalidModel=null;onError('');}
    catch{drag.invalid=true;invalidModel=next;}
    notify(drag.index);
  }

  function up(event){
    if(!drag||event.pointerId!==drag.id)return;stop(event);
    const previous=drag;drag=null;
    try{previous.surface.releasePointerCapture?.(previous.id);}catch{}
    if(previous.invalid){restore(previous.item,previous.before);selected=previous.previousSelection;invalidModel=null;onError(t('Kontura se nesmí křížit sama se sebou.'));}
    else record(previous.item,previous.before);
    notify(previous.index);
    if(!previous.invalid&&!previous.moved)menuAt(event);
  }

  function key(event){
    if(event.code==='Space'||event.key===' '){space=true;return;}
    if(!surfaces.has(event.target))return;focusSurface=event.target;
    const active=current();if(!active||isBusy())return;
    if(event.key==='Escape'){stop(event);closeMenu();if(drag)cancel();else{clearSelection();refresh();onUpdate(active.index);}return;}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){stop(event);runAction(event.shiftKey?'redo':'undo');return;}
    if(!enabled||selected===null)return;
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
    if(!validateFields())return;clearFields();onError('');
    if(action==='toggle'){enabled=!enabled;refresh();onUpdate(active?.index);return;}
    if(!active)return;
    if(action==='reset'){const before=snapshot(active.item);resetCaptureEdit(active.item);record(active.item,before);selected=null;notify(active.index);return;}
    const h=history(active.item),from=action==='undo'?h.past:h.future,to=action==='undo'?h.future:h.past;
    if(!from.length)return;to.push(snapshot(active.item));restore(active.item,from.pop());selected=null;notify(active.index);
  }
  actions.addEventListener('click',event=>{const action=event.target.closest('[data-contour-action]')?.dataset.contourAction;if(action)runAction(action);});
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
  const blur=()=>{space=false;cancel();};
  const listeners=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',cancelEvent],['lostpointercapture',cancelEvent],['click',click],['keydown',key]];
  function bindSurface(target,{getView:surfaceView=getView}={}){
    if(surfaces.has(target))return()=>{};
    const attributes={tabindex:target.getAttribute('tabindex'),'aria-describedby':target.getAttribute('aria-describedby')};
    surfaces.set(target,{getView:surfaceView,attributes});target.tabIndex=0;if(target!==canvas)target.setAttribute('aria-describedby',hint.id);
    for(const [name,listener] of listeners)target.addEventListener(name,listener,true);
    return()=>{if(drag?.surface===target)cancel();for(const [name,listener] of listeners)target.removeEventListener(name,listener,true);surfaces.delete(target);target.classList.remove('is-contour-editing');for(const [name,value] of Object.entries(attributes))if(value===null)target.removeAttribute(name);else target.setAttribute(name,value);if(focusSurface===target)focusSurface=canvas;};
  }
  bindSurface(canvas);host?.addEventListener('keyup',keyup);host?.addEventListener('blur',blur);
  refresh();
  return{
    get dragging(){return !!drag;},get draggingSurface(){return drag?.surface||null;},cancel,refresh,bindSurface,
    validate:validateFields,
    draw(ctx,scale=1){
      const active=current();if(!enabled||!active||active.item!==selectedItem)return;
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
    destroy(){if(disposed)return;cancel();disposed=true;closeMenu();for(const [target,{attributes}] of surfaces){for(const [name,listener] of listeners)target.removeEventListener(name,listener,true);target.classList.remove('is-contour-editing');for(const [name,value] of Object.entries(attributes))if(value===null)target.removeAttribute(name);else target.setAttribute(name,value);}surfaces.clear();host?.removeEventListener('keyup',keyup);host?.removeEventListener('blur',blur);toolbar.remove();if(previousTabIndex===null)canvas.removeAttribute('tabindex');else canvas.setAttribute('tabindex',previousTabIndex);if(previousDescription===null)canvas.removeAttribute('aria-describedby');else canvas.setAttribute('aria-describedby',previousDescription);if(area.isConnected){area.replaceWith(surface);}}
  };
}
