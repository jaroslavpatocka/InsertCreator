import {normalizeCamera3D} from './preview3d.js';

const finite=value=>Number.isFinite(value);

export function wheelPixels(event,pageHeight){
  if(!finite(event.deltaY))return 0;
  const multiplier=event.deltaMode===1?16:event.deltaMode===2?Math.max(1,pageHeight):1;
  return Math.max(-3000,Math.min(3000,event.deltaY*multiplier));
}

// Account for the SVG's default xMidYMid meet mapping, including letterboxing.
function mapping(svg,frame){
  const rect=svg.getBoundingClientRect(),width=Math.max(1,rect.width||svg.clientWidth||1),height=Math.max(1,rect.height||svg.clientHeight||1);
  const scale=Math.min(width/frame.width,height/frame.height);
  return {left:rect.left+(width-frame.width*scale)/2,top:rect.top+(height-frame.height*scale)/2,width:frame.width*scale,height:frame.height*scale,pageHeight:height};
}

export function normalizeCamera2D(camera={}){
  return {zoom:Math.max(.5,Math.min(3,finite(camera.zoom)?camera.zoom:1)),panX:finite(camera.panX)?camera.panX:0,panY:finite(camera.panY)?camera.panY:0};
}

/** Right-button pan and cursor-anchored wheel zoom. Left-button editing belongs to the board. */
export function createViewControls2D(svg,{getCamera,setCamera,getFrame,render,requestFrame=callback=>requestAnimationFrame(callback),cancelFrame=id=>cancelAnimationFrame(id)}){
  let gesture=null,pending=null,suppressClick=false,disposed=false;
  const host=svg.ownerDocument?.defaultView;
  const schedule=()=>{if(disposed||pending!==null)return;pending=requestFrame(()=>{pending=null;if(!disposed)render();});};
  const update=camera=>{setCamera(normalizeCamera2D(camera));schedule();};
  const finish=event=>{
    if(!gesture||(event?.pointerId!==undefined&&event.pointerId!==gesture.pointerId))return;
    const active=gesture;gesture=null;suppressClick=suppressClick||active.moved;
    svg.classList.remove('is-navigating');
    try{svg.releasePointerCapture?.(active.pointerId);}catch{}
  };
  const down=event=>{
    if(event.button===0){suppressClick=false;return;}
    if(gesture||event.button!==2||event.isPrimary===false||!finite(event.clientX)||!finite(event.clientY))return;
    suppressClick=false;
    gesture={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,lastX:event.clientX,lastY:event.clientY,moved:false};
    try{svg.setPointerCapture?.(event.pointerId);}catch{}
    event.preventDefault();event.stopPropagation();
  };
  const move=event=>{
    if(!gesture||event.pointerId!==gesture.pointerId||!finite(event.clientX)||!finite(event.clientY))return;
    if(event.pointerType==='mouse'&&!(event.buttons&2)){finish(event);return;}
    if(!gesture.moved&&Math.hypot(event.clientX-gesture.startX,event.clientY-gesture.startY)<3)return;
    gesture.moved=true;svg.classList.add('is-navigating');
    const frame=getFrame(),screen=mapping(svg,frame),camera=normalizeCamera2D(getCamera());
    const dx=event.clientX-gesture.lastX,dy=event.clientY-gesture.lastY;
    gesture.lastX=event.clientX;gesture.lastY=event.clientY;
    update({...camera,panX:camera.panX-dx*frame.width/screen.width,panY:camera.panY-dy*frame.height/screen.height});
    event.preventDefault();event.stopPropagation();
  };
  const wheel=event=>{
    const frame=getFrame(),screen=mapping(svg,frame),delta=wheelPixels(event,screen.pageHeight);event.preventDefault();
    if(!delta)return;
    const camera=normalizeCamera2D(getCamera()),next=normalizeCamera2D({...camera,zoom:camera.zoom*Math.exp(-delta*.0015)});
    const fx=finite(event.clientX)?(event.clientX-screen.left)/screen.width-.5:0,fy=finite(event.clientY)?(event.clientY-screen.top)/screen.height-.5:0;
    const ratio=camera.zoom/next.zoom;
    update({...next,panX:camera.panX+fx*frame.width*(1-ratio),panY:camera.panY+fy*frame.height*(1-ratio)});
  };
  const click=event=>{if(suppressClick||event.button===2){suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}};
  const context=event=>event.preventDefault();
  const blur=()=>finish();
  svg.addEventListener('pointerdown',down);svg.addEventListener('pointermove',move);
  svg.addEventListener('pointerup',finish);svg.addEventListener('pointercancel',finish);svg.addEventListener('lostpointercapture',finish);
  svg.addEventListener('wheel',wheel,{passive:false});svg.addEventListener('click',click,true);svg.addEventListener('contextmenu',context);
  host?.addEventListener('blur',blur);host?.addEventListener('resize',schedule);
  return {dispose(){
    if(disposed)return;
    disposed=true;finish();if(pending!==null){cancelFrame(pending);pending=null;}
    svg.removeEventListener('pointerdown',down);svg.removeEventListener('pointermove',move);svg.removeEventListener('pointerup',finish);svg.removeEventListener('pointercancel',finish);svg.removeEventListener('lostpointercapture',finish);
    svg.removeEventListener('wheel',wheel);svg.removeEventListener('click',click,true);svg.removeEventListener('contextmenu',context);
    host?.removeEventListener('blur',blur);host?.removeEventListener('resize',schedule);
  }};
}

export function createViewControls(svg,{getCamera,setCamera,getFrame,render,requestFrame=callback=>requestAnimationFrame(callback),cancelFrame=id=>cancelAnimationFrame(id)}){
  let gesture=null,pending=null,suppressClick=false,disposed=false;
  const host=svg.ownerDocument?.defaultView;
  const schedule=()=>{if(disposed||pending!==null)return;pending=requestFrame(()=>{pending=null;if(!disposed)render();});};
  const update=camera=>{setCamera(normalizeCamera3D(camera));schedule();};
  const finish=event=>{
    if(!gesture||(event?.pointerId!==undefined&&event.pointerId!==gesture.pointerId))return;
    const active=gesture;gesture=null;suppressClick=suppressClick||active.moved;
    svg.classList.remove('is-navigating');
    try{svg.releasePointerCapture?.(active.pointerId);}catch{}
  };
  const down=event=>{
    if(gesture||![0,2].includes(event.button)||event.isPrimary===false)return;
    if(!finite(event.clientX)||!finite(event.clientY))return;
    suppressClick=false;
    gesture={pointerId:event.pointerId,mode:event.button===2?'pan':'orbit',startX:event.clientX,startY:event.clientY,lastX:event.clientX,lastY:event.clientY,moved:false};
    try{svg.setPointerCapture?.(event.pointerId);}catch{}
    event.preventDefault();
  };
  const move=event=>{
    if(!gesture||event.pointerId!==gesture.pointerId||!finite(event.clientX)||!finite(event.clientY))return;
    if(event.pointerType==='mouse'&&event.buttons===0){finish(event);return;}
    if(!gesture.moved&&Math.hypot(event.clientX-gesture.startX,event.clientY-gesture.startY)<3)return;
    gesture.moved=true;svg.classList.add('is-navigating');
    const dx=event.clientX-gesture.lastX,dy=event.clientY-gesture.lastY,camera=getCamera();
    gesture.lastX=event.clientX;gesture.lastY=event.clientY;
    if(gesture.mode==='orbit')update({...camera,yaw:camera.yaw-dx*.008,pitch:camera.pitch+dy*.008});
    else{const frame=getFrame(),screen=mapping(svg,frame);update({...camera,panX:camera.panX-dx*frame.width/screen.width,panY:camera.panY-dy*frame.height/screen.height});}
    event.preventDefault();
  };
  const wheel=event=>{
    const frame=getFrame(),screen=mapping(svg,frame),delta=wheelPixels(event,screen.pageHeight);event.preventDefault();
    if(!delta)return;
    const camera=getCamera(),next=normalizeCamera3D({...camera,zoom:camera.zoom*Math.exp(-delta*.0015)});
    const fx=finite(event.clientX)?(event.clientX-screen.left)/screen.width-.5:0,fy=finite(event.clientY)?(event.clientY-screen.top)/screen.height-.5:0;
    const ratio=camera.zoom/next.zoom;
    update({...next,panX:camera.panX+fx*frame.width*(1-ratio),panY:camera.panY+fy*frame.height*(1-ratio)});
  };
  const click=event=>{if(suppressClick||event.button===2){suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}};
  const context=event=>event.preventDefault();
  const blur=()=>finish();
  svg.addEventListener('pointerdown',down);svg.addEventListener('pointermove',move);
  svg.addEventListener('pointerup',finish);svg.addEventListener('pointercancel',finish);svg.addEventListener('lostpointercapture',finish);
  svg.addEventListener('wheel',wheel,{passive:false});svg.addEventListener('click',click,true);svg.addEventListener('contextmenu',context);
  host?.addEventListener('blur',blur);host?.addEventListener('resize',schedule);
  return {dispose(){
    disposed=true;finish();if(pending!==null){cancelFrame(pending);pending=null;}
    svg.removeEventListener('pointerdown',down);svg.removeEventListener('pointermove',move);svg.removeEventListener('pointerup',finish);svg.removeEventListener('pointercancel',finish);svg.removeEventListener('lostpointercapture',finish);
    svg.removeEventListener('wheel',wheel);svg.removeEventListener('click',click,true);svg.removeEventListener('contextmenu',context);
    host?.removeEventListener('blur',blur);host?.removeEventListener('resize',schedule);
  }};
}
