import {selectPhotoRegion,tracePhotoBoundary} from './photo-selection.js';
import {getLang,errorText} from './i18n.js';
import {prepareSelectionLighting} from './photo-selection-light.js';
import {download} from './ui.js';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const copyPoint=p=>({x:p.x,y:p.y});
const copy=value=>structuredClone(value);
const message=(cs,en)=>getLang()==='en'?en:cs;
const modes=['roi','foreground','background','magnetic','manual','pick','pan'];
let nextId=0;
const MAX_HISTORY_MASK_BYTES=16*1024*1024,MAX_HISTORY_POINTS=200000;

function validSelectionMask(mask,width,height){
  if(!ArrayBuffer.isView(mask)||mask instanceof DataView||mask.length!==width*height)return false;
  for(const value of mask)if(!Number.isFinite(value)||value<0||value>1)return false;
  return true;
}

/** A cutout changes only alpha, at the original source size. It never uses the
 * lighting copy and does not infer a mask from a checkerboard photograph. */
export function makeSelectionCutout(image,mask){
  if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.data?.length!==image.width*image.height*4||!validSelectionMask(mask,image.width,image.height))throw new TypeError('Invalid source image or selection mask.');
  const data=new Uint8ClampedArray(image.data);
  for(let p=0;p<mask.length;p++)data[p*4+3]=Math.round(image.data[p*4+3]*mask[p]);
  return{width:image.width,height:image.height,data};
}

/** Interpolate a brush in source pixels. Adjacent disks overlap even after zoom. */
export function interpolateSelectionStroke(from,to,r){
  if(!(Number.isFinite(r)&&r>0))throw new TypeError('Brush radius must be positive.');
  const count=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.y-from.y)/Math.max(1e-9,r*.5))),points=[];
  for(let i=1;i<=count;i++)points.push({x:from.x+(to.x-from.x)*i/count,y:from.y+(to.y-from.y)*i/count,r});
  return points;
}

function cross(a,b,c){return(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
function onSegment(a,b,p){return Math.abs(cross(a,b,p))<1e-7&&p.x>=Math.min(a.x,b.x)-1e-7&&p.x<=Math.max(a.x,b.x)+1e-7&&p.y>=Math.min(a.y,b.y)-1e-7&&p.y<=Math.max(a.y,b.y)+1e-7;}
function intersects(a,b,c,d){
  if(Math.max(a.x,b.x)<Math.min(c.x,d.x)||Math.max(c.x,d.x)<Math.min(a.x,b.x)||Math.max(a.y,b.y)<Math.min(c.y,d.y)||Math.max(c.y,d.y)<Math.min(a.y,b.y))return false;
  return(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b);
}

/** Source-pixel validation has no millimetre or fit-reserve conversion. */
export function validateSelectionContour(contour,width,height){
  let points=contour?.points||contour;
  if(!Array.isArray(points))throw new Error(message('Obrys potřebuje alespoň tři body.','The outline needs at least three points.'));
  points=points.map(copyPoint).filter((p,i,a)=>!i||Math.hypot(p.x-a[i-1].x,p.y-a[i-1].y)>1e-7);
  if(points.length>1&&Math.hypot(points[0].x-points.at(-1).x,points[0].y-points.at(-1).y)<1e-7)points.pop();
  if(points.length<3||points.length>6000||!points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.y>=0&&p.x<=width&&p.y<=height))throw new Error(message('Body obrysu musí ležet ve fotografii (3 až 6000 bodů).','Outline points must lie within the photo (3 to 6000 points).'));
  let area=0;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];area+=a.x*b.y-a.y*b.x;
    for(let j=i+2;j<points.length;j++)if(!(i===0&&j===points.length-1)&&intersects(a,b,points[j],points[(j+1)%points.length]))throw new Error(message('Obrys se kříží. Vraťte bod a opravte jej.','The outline crosses itself. Undo and correct its points.'));
  }
  if(Math.abs(area)<.02)throw new Error(message('Obrys nemá dostatečnou plochu.','The outline has no area.'));
  return{points};
}

function contains(points,p){
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];if(onSegment(a,b,p))return true;
    if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}

/** Replaces only the supplied capture body/footer. The parent owns its modal.
 * All engine inputs and the applied contour use original source coordinates.
 * `engine` is an optional dependency for embedders/tests, never a model loader. */
export function mountPhotoSelection({host,footer,image,pxPerMm=1,initialContour=null,onApply=()=>{},onCancel=()=>{},onDownload=null,engine={selectPhotoRegion,tracePhotoBoundary,prepareSelectionLighting}}){
  if(!host||!footer||!image)throw new TypeError('Photo selection requires host, footer and image.');
  const document=host.ownerDocument,window=document.defaultView,width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
  if(!(Number.isInteger(width)&&width>0&&Number.isInteger(height)&&height>0))throw new TypeError('Invalid source image size.');
  if(!document.getElementById('capture-selection-styles')){
    const link=document.createElement('link');link.id='capture-selection-styles';link.rel='stylesheet';link.href=new URL('./capture-selection.css',import.meta.url).href;document.head.append(link);
  }
  const root=document.createElement('div');root.className='capture-selection';root.dataset.selectionRoot='';
  const id=`photo-selection-${++nextId}`;
  root.innerHTML=`<p class="capture-selection-intro"></p><div class="capture-selection-toolbar" role="group"></div><div class="capture-selection-options"><label class="capture-selection-brush"><span></span><input type="range" min="2" max="36" value="10" step="1" data-selection-brush><output>10 px</output></label><div class="capture-selection-zoom" role="group"></div></div><div class="capture-selection-light"><label><input type="checkbox" checked data-selection-lighting><span></span></label><div class="capture-selection-previews" role="group"></div><p data-selection-lighting-status role="status" aria-live="polite"></p></div><div class="capture-selection-surface"><canvas width="1200" height="760" data-selection-canvas tabindex="0"></canvas></div><div class="capture-selection-points"><span></span><label>X <input type="number" min="0" step="0.1" data-selection-coordinate="x"></label><label>Y <input type="number" min="0" step="0.1" data-selection-coordinate="y"></label><button type="button" class="btn btn-light" data-selection-action="add-point"></button></div><p class="capture-selection-hint" id="${id}-hint"></p><div class="capture-selection-components"></div><p class="capture-selection-status" id="${id}-status" role="status" aria-live="polite"></p>`;
  host.replaceChildren(root);footer.replaceChildren();footer.classList.add('capture-selection-footer');
  const canvas=root.querySelector('canvas'),toolbar=root.querySelector('.capture-selection-toolbar'),hint=root.querySelector('.capture-selection-hint'),status=root.querySelector('.capture-selection-status'),components=root.querySelector('.capture-selection-components'),pointFields=root.querySelector('.capture-selection-points'),brush=root.querySelector('[data-selection-brush]'),brushLabel=root.querySelector('.capture-selection-brush span'),zoomBar=root.querySelector('.capture-selection-zoom'),buttons={},listeners=[];
  const ctx=canvas.getContext('2d');
  function pixelCanvas(pixels){const el=document.createElement('canvas');el.width=width;el.height=height;const context=el.getContext('2d');if(context){const data=context.createImageData(width,height);data.data.set(pixels.data);context.putImageData(data,0,0);}return el;}
  const sourceCanvas=image.data?pixelCanvas(image):image;
  let fit=Math.min(canvas.width/width,canvas.height/height),overview={zoom:fit,x:(canvas.width-width*fit)/2,y:(canvas.height-height*fit)/2};
  let view={...overview},mode='roi',roi=null,foreground=[],background=[],anchors=[],contours=[],selected=-1,result=null,resultRevision=-1,revision=0,busy=false,disposed=false,settled=false,controller=null,drag=null,pinch=null,space=false,activePoint=-1,hover=null,lighting=true,preview='original',preparedLighting=null,correctedCanvas=null,lightingController=null,previewRevision=0,resizeObserver=null,raster=null,maskCanvas=null,cutoutCanvas=null,rasterController=null,rasterWork=null,exportController=null,downloadBusy=false;
  const pointers=new Map(),past=[];
  const labels={roi:message('1. Oblast','1. Area'),foreground:message('+ Přidat','+ Add'),background:message('− Odebrat','− Subtract'),magnetic:message('Magnetické body','Magnetic points'),manual:message('Rovné body','Straight points'),pick:message('Vybrat obrys','Choose outline'),pan:message('Posunout','Pan')};
  const listen=(el,type,fn,options)=>{el.addEventListener(type,fn,options);listeners.push(()=>el.removeEventListener(type,fn,options));};
  const makeButton=(parent,attribute,value,label)=>{const button=document.createElement('button');button.type='button';button.className='btn btn-light';button.dataset[attribute]=value;button.textContent=label;parent.append(button);return button;};
  toolbar.setAttribute('aria-label',message('Způsob výběru nástroje','Tool selection mode'));
  for(const name of modes){buttons[name]=makeButton(toolbar,'selectionMode',name,labels[name]);listen(buttons[name],'click',()=>setMode(name));}
  for(const [name,label] of [['out','−'],['in','+'],['fit',message('Celá fotka','Fit photo')]])listen(makeButton(zoomBar,'selectionZoom',name,label),'click',()=>{if(name==='fit'){view={...overview};draw();}else zoom(name==='in'?1.5:1/1.5,{x:canvas.width/2,y:canvas.height/2});});
  zoomBar.setAttribute('aria-label',message('Přiblížení fotografie','Photo zoom'));
  zoomBar.querySelector('[data-selection-zoom="in"]').setAttribute('aria-label',message('Přiblížit','Zoom in'));zoomBar.querySelector('[data-selection-zoom="out"]').setAttribute('aria-label',message('Oddálit','Zoom out'));
  for(const [name,label] of [['cancel',message('Zrušit','Cancel')],['undo',message('Zpět','Undo')],['reset',message('Od začátku','Reset')],['determine',message('Určit obrys','Determine outline')],['apply',message('Použít obrys','Apply outline')]])buttons[name]=makeButton(footer,'selectionAction',name,label);
  buttons.apply.classList.replace('btn-light','btn-primary');buttons.determine.classList.add('capture-selection-determine');
  root.querySelector('.capture-selection-intro').textContent=message('Vyberte jeden nástroj. Zeleně označte materiál, červeně pozadí. Když hrana není vidět, určete ji rovnými body.','Select one tool. Mark material in green and background in red. Where an edge is invisible, define it with straight points.');
  brushLabel.textContent=message('Poloměr štětce','Brush radius');canvas.setAttribute('aria-label',message('Fotografie pro výběr nástroje','Photo for selecting a tool'));canvas.setAttribute('aria-describedby',`${id}-hint ${id}-status`);
  pointFields.querySelector('span').textContent=message('Přesný bod v pixelech fotografie','Exact point in source pixels');
  const addPoint=pointFields.querySelector('button');addPoint.textContent=message('Přidat bod','Add point');
  pointFields.querySelector('[data-selection-coordinate="x"]').max=width;pointFields.querySelector('[data-selection-coordinate="y"]').max=height;
  const lightingInput=root.querySelector('[data-selection-lighting]'),lightingStatus=root.querySelector('[data-selection-lighting-status]'),previewBar=root.querySelector('.capture-selection-previews');
  root.querySelector('.capture-selection-light label span').textContent=message('Zvýraznit hrany, potlačit stíny a odlesky','Enhance edges, reduce shadows and glare');
  previewBar.setAttribute('aria-label',message('Náhled fotografie','Photo preview'));
  for(const [name,label] of [['original',message('Originál','Original')],['corrected',message('Upravená kopie','Working copy')],['mask',message('Silueta','Silhouette')],['cutout',message('Bez pozadí','Without background')]])listen(makeButton(previewBar,'selectionPreview',name,label),'click',()=>void showPreview(name));
  buttons.download=makeButton(previewBar,'selectionAction','download',message('Stáhnout PNG bez pozadí','Download PNG without background'));
  buttons.download.title=message('Pouze aktuální výběr. Původní rozměry fotografie a barvy, průhledné pozadí.','Current selection only. Original photo dimensions and colours, transparent background.');
  const snapshot=()=>({...copy({roi,foreground,background,anchors,contours,selected,result,resultRevision,mode,activePoint,lighting}),raster});
  const historyMaskBytes=()=>[...new Set(past.map(value=>value.raster).filter(Boolean))].reduce((sum,value)=>sum+value.mask.byteLength,0);
  const historyPoints=()=>past.reduce((sum,value)=>sum+value.foreground.length+value.background.length+value.anchors.length+value.contours.reduce((n,c)=>n+c.points.length,0),0);
  const save=()=>{const value=snapshot();past.push(value);while(past.length>40||historyMaskBytes()>MAX_HISTORY_MASK_BYTES||historyPoints()>MAX_HISTORY_POINTS)past.shift();return value;};
  function clearRasterLayers(){rasterController?.abort();rasterController=null;rasterWork=null;maskCanvas=null;cutoutCanvas=null;exportController?.abort();exportController=null;downloadBusy=false;}
  function restoreSnapshot(value){const{raster:previousRaster,...metadata}=value;({roi,foreground,background,anchors,contours,selected,result,resultRevision,mode,activePoint,lighting}=copy(metadata));raster=previousRaster;clearRasterLayers();}
  const currentCutout=()=>resultRevision===revision&&(raster||result?.method==='manual-polygon'&&contours.length>0);
  const abort=()=>{controller?.abort();controller=null;busy=false;};
  function invalidate(){abort();clearRasterLayers();revision++;contours=[];selected=-1;result=null;raster=null;resultRevision=-1;if(['mask','cutout'].includes(preview))preview='original';components.replaceChildren();}
  function edit(fn){save();invalidate();fn();refresh();draw();}
  function setStatus(value){status.textContent=value;}
  function setMode(next){if(disposed||!modes.includes(next))return;if(drag)cancelDrag();if(busy&&next!==mode)invalidate();mode=next;activePoint=-1;refresh();draw();}
  function refresh(){
    if(disposed)return;
    for(const name of modes)buttons[name].setAttribute('aria-pressed',String(name===mode));
    buttons.undo.disabled=!past.length;buttons.apply.disabled=busy||selected<0||resultRevision!==revision;buttons.determine.disabled=busy;buttons.determine.textContent=busy?message('Počítám…','Working…'):message('Určit obrys','Determine outline');
    buttons.download.disabled=busy||downloadBusy||!currentCutout();buttons.download.textContent=downloadBusy?message('Připravuji PNG…','Preparing PNG…'):message('Stáhnout PNG bez pozadí','Download PNG without background');
    for(const value of ['mask','cutout'])previewBar.querySelector(`[data-selection-preview="${value}"]`).disabled=busy||!currentCutout();
    root.setAttribute('aria-busy',String(busy));pointFields.hidden=!['magnetic','manual'].includes(mode);
    lightingInput.checked=lighting;for(const button of previewBar.querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.selectionPreview===preview));
    root.querySelector('.capture-selection-brush').hidden=!['foreground','background'].includes(mode);
    hint.textContent={roi:message('Tažením vymezte oblast kolem celého nástroje. Potom jej označte zeleným štětcem.','Drag an area around the complete tool, then mark it with the green brush.'),foreground:message('Zelený tah musí ležet uvnitř materiálu. Tenké spojnice obtáhněte malým štětcem.','Keep green strokes inside the material. Use a small brush along thin connectors.'),background:message('Červeně označte nežádoucí pozadí. Opačný tah přepíše starší označení.','Paint unwanted background red. An opposite stroke replaces earlier marks.'),magnetic:message('Přidávejte body po hraně. Určit obrys spojí sousední body podle kontrastu; výsledek zkontrolujte.','Place points along the edge. Determine outline follows contrast between them; check the result.'),manual:message('Přidávejte rohy v pořadí po obvodu. Určit obrys je uzavře přímkami; další křivky upravíte po použití.','Add corners in perimeter order. Determine outline closes straight segments; refine curves after applying.'),pick:message('Klikněte dovnitř požadovaného obrysu nebo vyberte jeho číslo níže. Použije se jen jeden.','Click inside the desired outline or choose its number below. Only one outline is applied.'),pan:message('Tažením posunete fotku. Dva prsty přibližují a posouvají ve všech režimech; kolečko přibližuje.','Drag to pan. Two fingers zoom and pan in all modes; the wheel zooms.')}[mode];
    canvas.style.cursor=mode==='pan'?'grab':'crosshair';
  }
  function draw(){
    canvas.dataset.selectionSourceWidth=width;canvas.dataset.selectionSourceHeight=height;canvas.dataset.selectionZoom=view.zoom;canvas.dataset.selectionX=view.x;canvas.dataset.selectionY=view.y;canvas.dataset.selectionPreview=preview;
    if(disposed||!ctx)return;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#18202c';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.save();ctx.translate(view.x,view.y);ctx.scale(view.zoom,view.zoom);
    if(preview==='mask'){ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);if(maskCanvas&&currentCutout())ctx.drawImage(maskCanvas,0,0,width,height);else if(!raster&&result?.method==='manual-polygon'){ctx.fillStyle='#fff';for(const c of contours){ctx.beginPath();c.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();}}ctx.restore();return;}
    if(preview==='cutout'){ctx.restore();ctx.save();ctx.beginPath();ctx.rect(view.x,view.y,width*view.zoom,height*view.zoom);ctx.clip();const tile=12*canvas.width/(canvas.getBoundingClientRect().width||canvas.width);ctx.fillStyle='#edf0f4';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#c4cbd4';for(let row=0;row*tile<canvas.height;row++)for(let column=0;column*tile<canvas.width;column++)if((row+column)%2)ctx.fillRect(column*tile,row*tile,tile,tile);ctx.translate(view.x,view.y);ctx.scale(view.zoom,view.zoom);if(cutoutCanvas&&currentCutout())ctx.drawImage(cutoutCanvas,0,0,width,height);ctx.restore();return;}
    else try{ctx.drawImage(preview==='corrected'&&correctedCanvas?correctedCanvas:sourceCanvas,0,0,width,height);}catch{}
    const screen=canvas.width/(canvas.getBoundingClientRect().width||canvas.width)/view.zoom;
    if(roi){ctx.fillStyle='rgba(0,0,0,.28)';ctx.beginPath();ctx.rect(0,0,width,height);ctx.rect(roi.x,roi.y,roi.width,roi.height);ctx.fill('evenodd');ctx.strokeStyle='#76bdff';ctx.lineWidth=2*screen;ctx.setLineDash([7*screen,4*screen]);ctx.strokeRect(roi.x,roi.y,roi.width,roi.height);ctx.setLineDash([]);}
    for(const [points,color] of [[foreground,'rgba(40,210,100,.65)'],[background,'rgba(255,60,65,.65)']]){ctx.fillStyle=color;ctx.beginPath();for(const p of points){ctx.moveTo(p.x+p.r,p.y);ctx.arc(p.x,p.y,p.r,0,Math.PI*2);}ctx.fill();}
    contours.forEach((contour,index)=>{ctx.beginPath();contour.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle=index===selected?'rgba(40,210,150,.18)':'rgba(255,204,50,.08)';ctx.fill();ctx.strokeStyle=index===selected?'#36f3bb':'#ffcd32';ctx.lineWidth=(index===selected?3:1.5)*screen;ctx.stroke();});
    if(anchors.length){ctx.beginPath();anchors.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle=mode==='manual'?'#ffca58':'#9ee8ff';ctx.lineWidth=2*screen;ctx.setLineDash(mode==='magnetic'?[5*screen,4*screen]:[]);ctx.stroke();ctx.setLineDash([]);anchors.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x,p.y,(i===activePoint?7:5)*screen,0,Math.PI*2);ctx.fillStyle=i===activePoint?'#fff':'#ffd566';ctx.fill();ctx.strokeStyle='#102030';ctx.lineWidth=screen;ctx.stroke();});}
    if(hover&&['foreground','background'].includes(mode)){ctx.beginPath();ctx.arc(hover.x,hover.y,brushRadius(),0,Math.PI*2);ctx.strokeStyle=mode==='foreground'?'#40ff8f':'#ff6262';ctx.lineWidth=screen;ctx.stroke();}ctx.restore();
  }
  function local(event){const r=canvas.getBoundingClientRect();return{x:(event.clientX-r.left)*canvas.width/(r.width||canvas.width),y:(event.clientY-r.top)*canvas.height/(r.height||canvas.height)};}
  const source=p=>({x:clamp((p.x-view.x)/view.zoom,0,width),y:clamp((p.y-view.y)/view.zoom,0,height)});
  const inside=p=>p.x>=view.x&&p.y>=view.y&&p.x<=view.x+width*view.zoom&&p.y<=view.y+height*view.zoom;
  function brushRadius(){return Number(brush.value)*canvas.width/(canvas.getBoundingClientRect().width||canvas.width)/view.zoom;}
  function clampView(){view.zoom=clamp(view.zoom,fit,fit*24);view.x=width*view.zoom<=canvas.width?(canvas.width-width*view.zoom)/2:clamp(view.x,canvas.width-width*view.zoom,0);view.y=height*view.zoom<=canvas.height?(canvas.height-height*view.zoom)/2:clamp(view.y,canvas.height-height*view.zoom,0);}
  function zoom(factor,at){const previous=view.zoom,next=clamp(previous*factor,fit,fit*24),ratio=next/previous;view={zoom:next,x:at.x-(at.x-view.x)*ratio,y:at.y-(at.y-view.y)*ratio};clampView();draw();}
  function cancelDrag(){if(!drag)return;const before=drag.before;drag=null;if(before){restoreSnapshot(before);if(past.at(-1)===before)past.pop();revision++;if(result)resultRevision=revision;}refresh();draw();}
  function paint(point){
    const key=mode==='foreground'?'foreground':'background',radius=drag.radius,added=interpolateSelectionStroke(drag.last,point,radius),opposite=key==='foreground'?background:foreground;
    // Latest user intent wins at overlapping seed disks, avoiding contradictory hard labels.
    const kept=opposite.filter(p=>!added.some(q=>Math.min(Math.hypot(p.x-q.x,p.y-q.y),Math.hypot(Math.floor(p.x)-Math.floor(q.x),Math.floor(p.y)-Math.floor(q.y)))<=p.r+q.r));
    if(key==='foreground'){foreground.push(...added);background=kept;}else{background.push(...added);foreground=kept;}drag.last=point;
  }
  function beginPinch(){
    cancelDrag();const pair=[...pointers.values()].slice(0,2),mid={x:(pair[0].x+pair[1].x)/2,y:(pair[0].y+pair[1].y)/2};pinch={distance:Math.max(1,Math.hypot(pair[0].x-pair[1].x,pair[0].y-pair[1].y)),mid,view:{...view}};
  }
  function down(event){
    if(disposed||event.button>0)return;event.preventDefault();event.stopPropagation();canvas.focus({preventScroll:true});const p=local(event);pointers.set(event.pointerId,p);try{canvas.setPointerCapture?.(event.pointerId);}catch{}
    if(pointers.size>=2){beginPinch();return;}if(drag||!inside(p))return;
    const point=source(p);
    if(mode==='pan'||space){drag={id:event.pointerId,kind:'pan',last:p};return;}
    if(mode==='pick'){const candidates=contours.map((c,i)=>({c,i})).filter(({c})=>contains(c.points,point));if(candidates.length){selected=candidates.reduce((a,b)=>polygonArea(a.c.points)<polygonArea(b.c.points)?a:b).i;renderComponents();refresh();draw();}return;}
    const before=save();invalidate();
    if(mode==='roi'){roi={x:point.x,y:point.y,width:0,height:0};foreground=[];background=[];anchors=[];drag={id:event.pointerId,kind:'roi',start:point,before};}
    else if(['foreground','background'].includes(mode)){drag={id:event.pointerId,kind:'brush',last:point,radius:brushRadius(),before};paint(point);}
    else{const tolerance=12*canvas.width/(canvas.getBoundingClientRect().width||canvas.width)/view.zoom;activePoint=anchors.findIndex(a=>Math.hypot(a.x-point.x,a.y-point.y)<=tolerance);if(activePoint<0){activePoint=anchors.length;anchors.push(point);}drag={id:event.pointerId,kind:'anchor',before};}
    setStatus('');refresh();draw();
  }
  function move(event){
    const p=local(event);hover=inside(p)?source(p):null;if(pointers.has(event.pointerId))pointers.set(event.pointerId,p);
    if(pinch&&pointers.size>=2){event.preventDefault();const pair=[...pointers.values()].slice(0,2),mid={x:(pair[0].x+pair[1].x)/2,y:(pair[0].y+pair[1].y)/2},distance=Math.max(1,Math.hypot(pair[0].x-pair[1].x,pair[0].y-pair[1].y)),next=clamp(pinch.view.zoom*distance/pinch.distance,fit,fit*24),ratio=next/pinch.view.zoom;view={zoom:next,x:mid.x-(pinch.mid.x-pinch.view.x)*ratio,y:mid.y-(pinch.mid.y-pinch.view.y)*ratio};clampView();draw();return;}
    if(!drag||drag.id!==event.pointerId){draw();return;}event.preventDefault();event.stopPropagation();
    if(event.pointerType!=='touch'&&event.buttons===0){cancelDrag();return;}
    const point=source(p);
    if(drag.kind==='pan'){view.x+=p.x-drag.last.x;view.y+=p.y-drag.last.y;drag.last=p;clampView();}
    else if(drag.kind==='roi')roi={x:Math.min(drag.start.x,point.x),y:Math.min(drag.start.y,point.y),width:Math.abs(point.x-drag.start.x),height:Math.abs(point.y-drag.start.y)};
    else if(drag.kind==='brush')paint(point);
    else if(drag.kind==='anchor')anchors[activePoint]=point;
    draw();
  }
  function up(event){
    pointers.delete(event.pointerId);if(pinch){if(pointers.size<2)pinch=null;drag=null;try{canvas.releasePointerCapture?.(event.pointerId);}catch{}return;}
    if(drag?.id===event.pointerId){const point=source(local(event));if(drag.kind==='roi')roi={x:Math.min(drag.start.x,point.x),y:Math.min(drag.start.y,point.y),width:Math.abs(point.x-drag.start.x),height:Math.abs(point.y-drag.start.y)};else if(drag.kind==='brush')paint(point);else if(drag.kind==='anchor')anchors[activePoint]=point;if(drag.kind==='roi'&&(roi.width<1||roi.height<1)){cancelDrag();setStatus(message('Oblast vymezte tažením kolem celého nástroje.','Drag an area around the complete tool.'));}else{drag=null;refresh();draw();}}try{canvas.releasePointerCapture?.(event.pointerId);}catch{}
  }
  function renderComponents(){
    components.replaceChildren();if(contours.length<=1)return;
    const label=document.createElement('span');label.textContent=message('Vyberte jeden obrys:','Choose one outline:');components.append(label);
    contours.forEach((c,index)=>{const button=makeButton(components,'selectionComponent',String(index),String(index+1));button.setAttribute('aria-label',message(`Obrys ${index+1}`,`Outline ${index+1}`));button.setAttribute('aria-pressed',String(index===selected));button.onclick=()=>{selected=index;renderComponents();refresh();draw();};});
  }
  function imageData(){if(image.data)return image;const buffer=document.createElement('canvas');buffer.width=width;buffer.height=height;const context=buffer.getContext('2d');if(!context)throw new Error(message('Pixely fotky nejsou dostupné. Použijte rovné body.','Photo pixels are unavailable. Use straight points.'));context.drawImage(image,0,0,width,height);return context.getImageData(0,0,width,height);}
  async function ensureRasterLayers(){
    if(!currentCutout())throw new Error(message('Nejprve určete aktuální výběr.','Determine the current selection first.'));
    if(maskCanvas&&cutoutCanvas)return;if(rasterWork)return rasterWork;
    const expected=result,currentRevision=revision,control=new AbortController(),signal=control.signal;rasterController=control;
    const check=()=>{if(signal.aborted||disposed||revision!==currentRevision||result!==expected)throw new DOMException('Selection changed.','AbortError');};
    const work=(async()=>{
      const layer=document.createElement('canvas');layer.width=width;layer.height=height;const context=layer.getContext('2d');if(!context)throw new Error(message('Náhled PNG není dostupný.','PNG preview is unavailable.'));
      if(raster){
        const rows=Math.min(64,height),tile=context.createImageData(width,rows);let deadline=performance.now()+22;
        for(let y=0;y<height;y+=rows){check();tile.data.fill(255);for(let dy=0;dy<Math.min(rows,height-y);dy++)for(let x=0;x<width;x++)tile.data[(dy*width+x)*4+3]=Math.round(raster.mask[(y+dy)*width+x]*255);context.putImageData(tile,0,y);if(performance.now()>deadline){await new Promise(resolve=>setTimeout(resolve,0));check();deadline=performance.now()+22;}}
      }else{
        context.fillStyle='#fff';for(const c of contours){context.beginPath();c.points.forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y));context.closePath();context.fill();}
      }
      check();const cutout=document.createElement('canvas');cutout.width=width;cutout.height=height;const cutoutContext=cutout.getContext('2d');if(!cutoutContext)throw new Error(message('Náhled PNG není dostupný.','PNG preview is unavailable.'));cutoutContext.drawImage(sourceCanvas,0,0,width,height);cutoutContext.globalCompositeOperation='destination-in';cutoutContext.drawImage(layer,0,0,width,height);cutoutContext.globalCompositeOperation='source-over';check();maskCanvas=layer;cutoutCanvas=cutout;
    })();rasterWork=work;
    try{await work;}finally{if(rasterController===control){rasterController=null;rasterWork=null;}}
  }
  async function downloadPng(){
    if(disposed||busy||downloadBusy||!currentCutout())return null;
    const currentRevision=revision,expected=result,control=new AbortController();exportController=control;downloadBusy=true;refresh();
    const current=()=>!disposed&&!control.signal.aborted&&revision===currentRevision&&result===expected&&!busy;
    try{
      await ensureRasterLayers();if(!current())return null;
      const rendered=cutoutCanvas,blob=await new Promise((resolve,reject)=>{if(typeof rendered.toBlob!=='function'){reject(new Error(message('Prohlížeč neumí uložit PNG.','The browser cannot encode PNG.')));return;}rendered.toBlob(value=>value?resolve(value):reject(new Error(message('PNG se nepodařilo vytvořit.','PNG could not be created.'))),'image/png');});
      if(!current())return null;const name='vyber-bez-pozadi.png';
      if(onDownload){const pixels=rendered.getContext('2d').getImageData(0,0,width,height),payload={blob,image:{width,height,data:pixels.data},name};await onDownload(payload);return payload;}
      download(name,blob,'image/png');return{blob,name,width,height};
    }catch(error){if(current())setStatus(errorText(error)||String(error));return null;}
    finally{if(exportController===control){exportController=null;downloadBusy=false;if(!disposed)refresh();}}
  }
  async function showPreview(next){
    if(disposed)return;const current=++previewRevision;lightingController?.abort();lightingController=null;
    if(['mask','cutout'].includes(next)){
      if(!currentCutout())return;try{await ensureRasterLayers();if(disposed||current!==previewRevision||!currentCutout())return;preview=next;lightingStatus.textContent=message('Bez pozadí je pouze aktuální výběr. PNG zachovává rozměry fotografie, původní barvy a průhledné otvory.','Background is removed only for the current selection. PNG preserves the photo dimensions, original colours and transparent holes.');refresh();draw();}catch(error){if(!disposed&&current===previewRevision&&error?.name!=='AbortError')setStatus(errorText(error)||String(error));}return;
    }
    if(next!=='corrected'){preview=next;refresh();draw();return;}
    if(correctedCanvas){preview='corrected';refresh();draw();return;}
    const signal=(lightingController=new AbortController()).signal;
    lightingStatus.textContent=message('Připravuji upravenou kopii…','Preparing the working copy…');
    try{const prepared=await(engine.prepareSelectionLighting||prepareSelectionLighting)(imageData(),{signal});if(disposed||signal.aborted||current!==previewRevision)return;preparedLighting=prepared;correctedCanvas=pixelCanvas(prepared.image);preview='corrected';lightingStatus.textContent=message('Upravená kopie zvýrazní dostupné hrany. Přepálenou nebo skrytou hranu určete body.','The working copy enhances available edges. Define clipped or hidden edges with points.');if(prepared.diagnostics?.requiresManual)lightingStatus.textContent+=' '+message('Fotografie obsahuje přepálená místa.','The photo contains clipped highlights.');refresh();draw();}
    catch(error){if(!disposed&&!signal.aborted&&current===previewRevision){lightingStatus.textContent=message('Upravená kopie není dostupná. Originál a rovné body můžete použít dál.','The working copy is unavailable. You can still use the original and straight points.');preview='original';refresh();draw();}}
    finally{if(lightingController?.signal===signal)lightingController=null;}
  }
  async function determine(){
    if(disposed||busy)return null;abort();clearRasterLayers();const thisRevision=revision,currentMode=mode,signal=(controller=new AbortController()).signal;busy=true;refresh();setStatus(message('Určuji obrys… Úprava nebo Zrušit výpočet přeruší.','Determining outline… Editing or Cancel stops the calculation.'));
    try{
      let output,method;
      if(currentMode==='manual'){output={contours:[validateSelectionContour(anchors,width,height)],quality:{status:'review',needsManual:false,reasons:['manual-outline']},diagnostics:{}};method='manual-polygon';}
      else if(currentMode==='magnetic'){if(anchors.length<3)throw new Error(message('Umístěte alespoň tři body po obvodu.','Place at least three points around the perimeter.'));output=await engine.tracePhotoBoundary(imageData(),{points:copy(anchors),closed:true,roi:copy(roi),lighting:lighting?'corrected':'original',preparedLighting,signal});method='magnetic-boundary';}
      else{if(!roi)throw new Error(message('Nejprve tažením vymezte oblast nástroje.','First drag an area around the tool.'));if(!foreground.length)throw new Error(message('Zeleným štětcem označte materiál nástroje.','Mark tool material with the green brush.'));output=await engine.selectPhotoRegion(imageData(),{roi:copy(roi),foreground:copy(foreground),background:copy(background),lighting:lighting?'corrected':'original',preparedLighting,signal,onProgress:progress=>{if(!disposed&&thisRevision===revision&&!signal.aborted)setStatus(message('Určuji obrys…','Determining outline…')+(typeof progress==='number'?` ${Math.round(progress*100)} %`:''));}});method='seeded-selection';}
      if(disposed||signal.aborted||revision!==thisRevision)return null;
      const valid=[];let rejected=0;for(const c of output.contours||[]){try{valid.push({...c,...validateSelectionContour(c,width,height)});}catch{rejected++;}}
      contours=valid;selected=valid.length===1?0:-1;result={quality:output.quality||{},diagnostics:{...output.diagnostics,rejectedContours:rejected},method};raster=(output.width===undefined||output.width===width)&&(output.height===undefined||output.height===height)&&validSelectionMask(output.mask,width,height)?Object.freeze({mask:output.mask.slice(),width,height}):null;resultRevision=revision;
      if(!valid.length)setStatus(message('Nebyl určen platný obrys. Upravte tahy, nebo použijte rovné body.','No valid outline was found. Adjust the strokes or use straight points.'));
      else if(valid.length>1){mode='pick';setStatus(message(`Nalezeno ${valid.length} obrysů. Vyberte právě jeden a zkontrolujte jeho hranu.`,`Found ${valid.length} outlines. Choose exactly one and check its edge.`));}
      else setStatus(output.quality?.needsManual?message('Část hrany je nejasná nebo přímá náhrada. Opravte ji body a obrys zkontrolujte.','Part of the edge is ambiguous or a straight fallback. Correct it with points and check the outline.'):message('Obrys zkontrolujte přiblížením. Jde o ručně potvrzovaný výběr, nikoli ověřené fyzické měření.','Zoom in and check the outline. This is a user-confirmed selection, not a verified physical measurement.'));
      const reasons=Array.isArray(output.quality?.reasons)?output.quality.reasons.filter(reason=>typeof reason==='string').join(' '):'';if(reasons)setStatus(`${status.textContent} ${reasons}`);
      renderComponents();if(raster)await showPreview('cutout');if(disposed||signal.aborted||thisRevision!==revision)return null;return copy({contours,quality:result.quality});
    }catch(error){if(!disposed&&!signal.aborted&&revision===thisRevision)setStatus(errorText(error)||String(error));return null;}
    finally{if(!disposed&&revision===thisRevision&&controller?.signal===signal){busy=false;controller=null;refresh();draw();}}
  }
  function destroy(){if(disposed)return;disposed=true;abort();clearRasterLayers();lightingController?.abort();resizeObserver?.disconnect();listeners.forEach(fn=>fn());pointers.clear();past.length=0;drag=null;pinch=null;footer.classList.remove('capture-selection-footer');}
  function cancel(){if(disposed||settled)return;settled=true;destroy();onCancel();}
  function apply(){if(disposed||settled||busy||selected<0||resultRevision!==revision)return;let contour;try{contour=validateSelectionContour(contours[selected],width,height);}catch(error){setStatus(errorText(error));return;}const applied={contour,mask:raster?new Uint8Array(raster):null,source:'interactive',method:result.method,pxPerMm,quality:{...copy(result.quality),status:'review',needsReview:true,manual:true},diagnostics:{...copy(result.diagnostics),selectedComponent:selected,sourceWidth:width,sourceHeight:height}};settled=true;destroy();onApply(applied);}
  listen(buttons.determine,'click',determine);listen(buttons.apply,'click',apply);listen(buttons.cancel,'click',cancel);listen(buttons.download,'click',downloadPng);
  listen(buttons.undo,'click',()=>{if(!past.length||disposed)return;abort();restoreSnapshot(past.pop());revision++;if(result)resultRevision=revision;renderComponents();refresh();draw();setStatus(message('Poslední úprava vrácena.','Last edit undone.'));});
  listen(buttons.reset,'click',()=>edit(()=>{roi=null;foreground=[];background=[];anchors=[];mode='roi';activePoint=-1;setStatus('');}));
  listen(brush,'input',()=>{brush.parentElement.querySelector('output').textContent=`${brush.value} px`;draw();});
  listen(lightingInput,'change',()=>{const next=lightingInput.checked;edit(()=>{lighting=next;});void showPreview(next?'corrected':'original');});
  listen(addPoint,'click',()=>{const x=pointFields.querySelector('[data-selection-coordinate="x"]'),y=pointFields.querySelector('[data-selection-coordinate="y"]'),point={x:Number(x.value),y:Number(y.value)};if(x.value===''||y.value===''||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.y<0||point.x>width||point.y>height){setStatus(message('Zadejte X a Y uvnitř fotografie.','Enter X and Y within the photo.'));return;}edit(()=>{anchors.push(point);activePoint=anchors.length-1;});});
  listen(canvas,'pointerdown',down);listen(canvas,'pointermove',move);listen(canvas,'pointerup',up);listen(canvas,'pointercancel',event=>{pointers.delete(event.pointerId);pinch=null;cancelDrag();});listen(canvas,'lostpointercapture',event=>{pointers.delete(event.pointerId);if(drag?.id===event.pointerId)cancelDrag();});listen(canvas,'pointerleave',()=>{hover=null;draw();});
  listen(canvas,'wheel',event=>{event.preventDefault();event.stopPropagation();zoom(Math.exp(-clamp(event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?canvas.height:1),-600,600)*.0015),local(event));},{passive:false});
  listen(canvas,'keydown',event=>{
    if(event.key===' '){space=true;event.preventDefault();}
    else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();buttons.undo.click();}
    else if(event.key==='Enter'){event.preventDefault();void determine();}
    else if((event.key==='Delete'||event.key==='Backspace')&&activePoint>=0&&['manual','magnetic'].includes(mode)){event.preventDefault();edit(()=>{anchors.splice(activePoint,1);activePoint=-1;});}
    else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)&&activePoint>=0&&['manual','magnetic'].includes(mode)){event.preventDefault();edit(()=>{const p=anchors[activePoint],step=event.shiftKey?10:1;p.x=clamp(p.x+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),0,width);p.y=clamp(p.y+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0),0,height);});}
  });
  listen(canvas,'keyup',event=>{if(event.key===' ')space=false;});listen(canvas,'blur',()=>{space=false;cancelDrag();});
  if(initialContour){try{const c=validateSelectionContour(initialContour,width,height);contours=[c];selected=0;result={method:'manual-polygon',quality:{status:'review',needsManual:false},diagnostics:{initialContour:true}};resultRevision=revision;anchors=copy(c.points);mode='manual';}catch(error){setStatus(errorText(error));}}
  function resize(){const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;const center=source({x:canvas.width/2,y:canvas.height/2}),ratio=view.zoom/fit;canvas.width=Math.max(1,Math.round(rect.width*Math.min(2,window.devicePixelRatio||1)));canvas.height=Math.max(1,Math.round(rect.height*Math.min(2,window.devicePixelRatio||1)));fit=Math.min(canvas.width/width,canvas.height/height);overview={zoom:fit,x:(canvas.width-width*fit)/2,y:(canvas.height-height*fit)/2};view={zoom:fit*ratio,x:canvas.width/2-center.x*fit*ratio,y:canvas.height/2-center.y*fit*ratio};clampView();draw();}
  if(window.ResizeObserver){resizeObserver=new window.ResizeObserver(resize);resizeObserver.observe(canvas);}
  refresh();resize();draw();void showPreview('corrected');
  return{destroy,determine,downloadPng,getState:()=>copy({roi,foreground,background,anchors,contours,selected,revision,busy,mode,view,resultRevision,disposed,lighting,preview,hasRaster:!!raster,canDownload:!!currentCutout()&&!busy&&!downloadBusy,historyMaskBytes:historyMaskBytes(),lightingDiagnostics:preparedLighting?.diagnostics||null})};
}

function polygonArea(points){return Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-p.y*q.x;},0)/2);}

export const openPhotoSelection=(image,options)=>mountPhotoSelection({...options,image});
