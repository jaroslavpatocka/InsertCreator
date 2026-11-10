import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {createCanvas} from '@napi-rs/canvas';
import {bindCaptureContourEditor} from '../dist/capture-contour-editor.js';
import * as navigation from '../dist/capture-view.js';
import {flattenContour} from '../dist/capture-contour-edit.js';
import {capturePhotoGeometry,capturePocketGeometry} from '../dist/capture-tools.js';
import {captureSelectionItem} from '../dist/capture-selection-result.js';
import {setLang} from '../dist/i18n.js';
import {setAppUnit} from '../dist/units.js';

const clone=value=>structuredClone(value),epsilon=.000101;
const rectangle=[{x:0,y:0},{x:100,y:0},{x:100,y:50},{x:0,y:50}];
const jaws=[{x:0,y:0},{x:12,y:0},{x:12,y:45},{x:28,y:45},{x:28,y:0},{x:40,y:0},{x:40,y:60},{x:0,y:60}];
const neck=[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:11,y:20},{x:11,y:40},{x:20,y:40},{x:20,y:60},{x:0,y:60},{x:0,y:40},{x:9,y:40},{x:9,y:20},{x:0,y:20}];
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y}),cross=(a,b)=>a.x*b.y-a.y*b.x;
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const box=points=>({x0:Math.min(...points.map(p=>p.x)),x1:Math.max(...points.map(p=>p.x)),y0:Math.min(...points.map(p=>p.y)),y1:Math.max(...points.map(p=>p.y))});
const area=points=>Math.abs(points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a.x*b.y-b.x*a.y;},0))/2;
function segmentDistance(p,a,b){const d=sub(b,a),length=d.x*d.x+d.y*d.y,t=Math.max(0,Math.min(1,((p.x-a.x)*d.x+(p.y-a.y)*d.y)/(length||1)));return Math.hypot(p.x-a.x-d.x*t,p.y-a.y-d.y*t);}
const boundaryDistance=(p,polygon)=>Math.min(...polygon.map((a,i)=>segmentDistance(p,a,polygon[(i+1)%polygon.length])));
function inside(p,polygon,tolerance=epsilon){
 if(boundaryDistance(p,polygon)<=tolerance)return true;
 let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;
}
/** Independent segment coverage: split source edges at all candidate crossings,
 * then test both endpoints and every open interval, rather than only vertices
 * or the bounding box. The candidate is a validated simple polygon, no holes. */
function assertCovers(source,candidate,label='source silhouette'){
 assert.ok(area(candidate)+epsilon>=area(source),label+' area cannot decrease below the source');
 for(const [index,a] of source.entries()){
  const b=source[(index+1)%source.length],ab=sub(b,a),length=ab.x*ab.x+ab.y*ab.y,positions=[0,1];
  for(const [j,c] of candidate.entries()){
   const d=candidate[(j+1)%candidate.length],cd=sub(d,c),ac=sub(c,a),det=cross(ab,cd);
   if(Math.abs(det)>1e-12){const t=cross(ac,cd)/det,u=cross(ac,ab)/det;if(t>0&&t<1&&u>=0&&u<=1)positions.push(t);}
   else if(Math.abs(cross(ac,ab))<1e-8)for(const p of [c,d]){const t=((p.x-a.x)*ab.x+(p.y-a.y)*ab.y)/(length||1);if(t>0&&t<1)positions.push(t);}
  }
  positions.sort((x,y)=>x-y);
  const checks=positions.concat(positions.slice(1).map((end,i)=>(end+positions[i])/2));
  for(const t of checks){const p=mix(a,b,t);assert.ok(inside(p,candidate),`${label}: source edge${index} at t${t.toFixed(7)} (${p.x},${p.y}) was cut inward by ${boundaryDistance(p,candidate)}mm`);}
 }
}

function fixture(t,{outline=rectangle,scale=2,origin={x:80,y:120},shape='measured',unit='mm',empty=false}={}){
 const win=new Window({url:'http://localhost/'});for(const key of ['document','localStorage','HTMLElement'])globalThis[key]=win[key];globalThis.window=win;setLang('cs',{save:false});setAppUnit(unit,{save:false});
 win.document.body.innerHTML='<div class="capture-canvas"><canvas width="1000" height="700"></canvas></div><div class="capture-guide-preview"><canvas width="720" height="500"></canvas></div>';
 const canvas=win.document.querySelector('.capture-canvas canvas'),detail=win.document.querySelector('.capture-guide-preview canvas'),center={x:origin.x+50*scale,y:origin.y+25*scale},zoom=8/scale;
 const surfaces=new Map([[canvas,{view:{zoom,x:500-center.x*zoom,y:350-center.y*zoom},rect:{left:71,top:43,width:500,height:350}}],[detail,{view:{zoom:zoom*1.5,x:360-center.x*zoom*1.5,y:250-center.y*zoom*1.5},rect:{left:29,top:97,width:360,height:250}}]]),backing=new Map(),cleanup=[];
 for(const [surface,state] of surfaces){surface.getBoundingClientRect=()=>state.rect;backing.set(surface,createCanvas(surface.width,surface.height));surface.getContext=type=>type==='2d'?backing.get(surface).getContext('2d'):null;}
 const toPhoto=p=>({x:origin.x+p.x*scale,y:origin.y+p.y*scale}),toMm=p=>({x:(p.x-origin.x)/scale,y:(p.y-origin.y)/scale}),bounds=box(outline),source=outline.map(toPhoto),item={name:'Protected source',category:'wrenches',sizeLabel:'17 mm',depth:'8',checked:true,pocketShape:shape,contour:{points:clone(source)},info:{minX:origin.x+bounds.x0*scale,minY:origin.y+bounds.y0*scale,width:bounds.x1-bounds.x0,height:bounds.y1-bounds.y0,center:toPhoto({x:(bounds.x0+bounds.x1)/2,y:(bounds.y0+bounds.y1)/2})}},items=empty?[]:[item],errors=[],created=[];
 let active=empty?null:0,editor;
 const current=()=>items[active],profile=()=>current()?capturePhotoGeometry(current(),scale,{includeMargin:true,pocketMargin:0}).points.map(toMm):[];
 const draw=()=>{for(const [surface,state] of surfaces){const ctx=surface.getContext('2d');ctx.resetTransform();ctx.fillStyle='#fff';ctx.fillRect(0,0,surface.width,surface.height);ctx.save();ctx.setTransform(state.view.zoom,0,0,state.view.zoom,state.view.x,state.view.y);ctx.lineWidth=1/state.view.zoom;ctx.strokeStyle='#c59652';ctx.beginPath();source.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.stroke();if(current()){ctx.strokeStyle='#224e6a';ctx.beginPath();capturePhotoGeometry(current(),scale).points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.stroke();}editor?.draw(ctx,surface.width/state.rect.width/state.view.zoom,surface);ctx.restore();}};
 for(const [surface,state] of surfaces)cleanup.push(navigation.bindCanvasView(surface,{getView:()=>state.view,setView:view=>state.view=view,draw,canTouchPan:()=>!editor?.dragging&&state.view.zoom>1,onNavigationStart:()=>editor?.cancel()}));
 editor=bindCaptureContourEditor(canvas,{getItems:()=>items,getActiveIndex:()=>active,onSelect:index=>active=index,getPhotoScale:()=>scale,getView:()=>surfaces.get(canvas).view,getPocketMargin:()=>0,onUpdate:draw,onRedraw:draw,onError:message=>errors.push(message),onCreateContour:model=>{
  const photo=flattenContour(model.nodes).map(p=>({x:model.origin.x+p.x*scale,y:model.origin.y+p.y*scale})),added=captureSelectionItem({contour:{points:photo},method:'freehand'},{scale,image:{width:1000,height:700},name:'Drawn protected source',pocketShape:'measured'});items.push(added);active=items.length-1;created.push(clone(model));editor.refresh();
 }});const unbindDetail=editor.bindSurface(detail,{getView:()=>surfaces.get(detail).view});
 function pointer(type,p,{surface=canvas,pointerType='mouse',pointerId=1,...rest}={}){const {rect,view}=surfaces.get(surface),photo=toPhoto(p),event=new win.PointerEvent(type,{bubbles:true,cancelable:true,button:0,buttons:type==='pointerup'?0:1,pointerType,pointerId,isPrimary:pointerId===1,clientX:rect.left+(photo.x*view.zoom+view.x)*rect.width/surface.width,clientY:rect.top+(photo.y*view.zoom+view.y)*rect.height/surface.height,...rest});surface.dispatchEvent(event);return event;}
 const action=name=>{const button=win.document.querySelector(`[data-contour-action="${name}"]`);assert.ok(button,'missing '+name);assert.equal(button.disabled,false,name+' is enabled');button.click();},click=(p,options={})=>{pointer('pointerdown',p,options);pointer('pointerup',p,options);},stroke=(points,options={})=>{pointer('pointerdown',points[0],options);for(const p of points.slice(1))pointer('pointermove',p,options);pointer('pointerup',points.at(-1),options);},brush=(mode='round',radius=32)=>{action('smooth');win.document.querySelector(`[data-contour-brush="shape"][data-shape="${mode}"]`).click();const input=win.document.querySelector('[data-contour-brush="radius"]');input.value=String(radius);input.dispatchEvent(new win.Event('input',{bubbles:true}));};
 t.after(async()=>{editor.destroy();unbindDetail();cleanup.reverse().forEach(fn=>fn());await win.happyDOM.close();});return{win,canvas,detail,surfaces,backing,editor,item,items,errors,created,source,origin,scale,current,profile,toPhoto,toMm,draw,pointer,click,stroke,action,brush,coverage:(label)=>assertCovers(outline,profile(),label)};
}

for(const pointerType of ['mouse','pen','touch'])for(const surfaceName of ['canvas','detail'])test(`protected ${pointerType} point on ${surfaceName} stops inward at the immutable source and still moves outward`,t=>{
 const f=fixture(t),source=clone(f.item.contour),options={surface:f[surfaceName],pointerType};assert.match(f.win.document.querySelector('[data-contour-safety="enabled"]').textContent,/Hrana nástroje je chráněná/);f.click({x:50,y:0},options);f.action('point');const original=clone(f.item),before=f.profile();
 f.pointer('pointerdown',{x:50,y:0},options);f.pointer('pointermove',{x:50,y:12},options);f.coverage('during inward point preview');f.pointer('pointerup',{x:50,y:12},options);f.coverage('after inward point release');assert.match(f.win.document.querySelector('.capture-contour-status').textContent,/Dosažena hrana nástroje/,'the constrained edit explains the protection limit');
 f.pointer('pointerdown',{x:50,y:0},options);f.pointer('pointermove',{x:50,y:-8},options);f.pointer('pointerup',{x:50,y:-8},options);f.coverage('outward point release');assert.ok(boundaryDistance({x:50,y:-8},f.profile())<epsilon,'explicit outward movement remains usable');assert.notDeepEqual(f.profile(),before);assert.deepEqual(f.item.contour,source);
 f.action('undo');f.coverage('undo');assert.deepEqual(f.profile(),before);f.action('redo');f.coverage('redo');const completed=clone(f.item);f.pointer('pointerdown',{x:50,y:-8},options);f.pointer('pointermove',{x:50,y:-12},options);f.pointer('pointercancel',{x:50,y:-12},options);assert.deepEqual(f.item,completed,'cancellation restores the entire safe state');assert.deepEqual(f.item.contour,original.contour);
});

for(const direction of ['inward','outward'])test(`protected Bezier handle ${direction} keeps full source coverage`,t=>{
 const f=fixture(t);f.click({x:50,y:0});f.action('curve');const model=f.item.contourEdit,node=model.nodes.find(p=>p.manual&&p.out);assert.ok(node?.out);const start=f.toMm({x:model.origin.x+node.out.x*f.scale,y:model.origin.y+node.out.y*f.scale}),end={x:start.x,y:start.y+(direction==='inward'?12:-8)};
 f.pointer('pointerdown',start);f.pointer('pointermove',end);f.coverage('Bezier preview');f.pointer('pointerup',end);f.coverage('Bezier release');if(direction==='outward')assert.ok(f.profile().some(p=>p.y<-.5),'outward curve is accepted');assert.deepEqual(f.item.contour.points,f.source);
});

test('deleting an original convex corner cannot cut material from the source silhouette',t=>{
 const f=fixture(t),before=clone(f.item.contour);f.click({x:100,y:50});f.action('delete');f.coverage('convex vertex deletion');assert.deepEqual(f.item.contour,before);assert.ok(inside({x:99,y:49},f.profile()),'the distant source corner remains in the zero-clearance tool profile');
});

for(const shape of ['measured','ideal'])test(`thirty round passes on ${shape} profile cannot progressively erode its original floor`,async t=>{
 const f=fixture(t,{shape}),raw=clone(f.item.contour),before=f.profile();f.brush();const path=[{x:98,y:0},{x:100,y:0},{x:100,y:2}],states=[];for(let i=0;i<30;i++){f.stroke(path);f.coverage('round pass'+i);if([0,4,14,29].includes(i))states.push(clone(f.profile()));}assert.deepEqual(f.item.contour,raw);
 if(shape==='ideal'){assert.notDeepEqual(f.profile(),before,'a safe portion of existing fit reserve can be consumed');assert.equal(f.item.contourReserveRatio,.02);f.item.pocketShape='ideal';assert.equal(capturePocketGeometry(f.item,f.scale).reserveRatio,0,'reopening ideal never creates a second2percent reserve');f.item.pocketShape='measured';f.coverage('reopened measured profile');}
 const root=process.env.INSERTCREATOR_SAFETY_PROOF_DIR;if(root){const repo=new URL('../',import.meta.url).pathname.split('/').filter(Boolean).at(-1),dir=root+'/'+repo+'/'+shape;await fs.mkdir(dir,{recursive:true});f.draw();await fs.writeFile(dir+'/after-thirty.png',f.backing.get(f.canvas).toBuffer('image/png'));await fs.writeFile(dir+'/result.json',JSON.stringify({scope:'Independent source-edge coverage of actual pointer-edited polygons, zero mm pocket clearance, not native browser or physical tool truth.',source:rectangle,before,states,after:f.profile(),passes:30,sourceUnchanged:true,protectedSourceCovered:true},null,2)+'\n');}
});

for(const [label,outline,path,gap] of [['open jaws',jaws,[{x:12,y:45},{x:12,y:40},{x:12,y:45}],{x:20,y:20}],['two millimetre neck',neck,[{x:11,y:20},{x:11,y:25},{x:11,y:35}],{x:15,y:30}]])test(`repeated smoothing preserves ${label} material and its real gap at zero pocket clearance`,t=>{
 const f=fixture(t,{outline});f.brush('line',24);for(let i=0;i<20;i++){f.stroke(path);f.coverage(label+' pass'+i);}assert.equal(inside(gap,f.profile(),1e-6),false,'the remote open background gap is not filled as a coverage workaround');assert.deepEqual(f.item.contour.points,f.source);
});

test('a new drawn contour becomes the immutable floor for subsequent point and brush edits',t=>{
 const f=fixture(t,{empty:true}),drawn=[{x:20,y:10},{x:80,y:10},{x:80,y:40},{x:20,y:40}];f.action('draw');f.stroke([...drawn,drawn[0]]);assert.equal(f.created.length,1);const source=clone(f.current().contour);f.action('point');f.click({x:50,y:10});f.action('point');f.stroke([{x:50,y:10},{x:50,y:22}]);assertCovers(drawn,f.profile(),'accepted new freehand floor');f.brush();for(let i=0;i<12;i++){f.stroke([{x:78,y:10},{x:80,y:10},{x:80,y:12}]);assertCovers(drawn,f.profile(),'accepted new freehand after brush'+i);}assert.deepEqual(f.current().contour,source);
});

test('source protection is invariant to photo resolution, translated origin and display units',t=>{
 const a=fixture(t,{scale:2,origin:{x:80,y:120},unit:'mm'}),b=fixture(t,{scale:4,origin:{x:280,y:200},unit:'in'});for(const f of [a,b]){f.click({x:50,y:0});f.action('point');f.stroke([{x:50,y:0},{x:50,y:9}]);f.coverage('physical inward floor');f.stroke([{x:50,y:0},{x:50,y:-5}]);f.coverage('physical outward floor');f.brush('round',32);for(let i=0;i<5;i++){f.stroke([{x:98,y:0},{x:100,y:0},{x:100,y:2}]);f.coverage('physical brush floor');}}
 const left=a.profile(),right=b.profile();for(const p of left)assert.ok(boundaryDistance(p,right)<.001,'same mm result at2and4source px/mm');for(const p of right)assert.ok(boundaryDistance(p,left)<.001,'source translation and imperial display cannot shift protection');
});
