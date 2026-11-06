// Local 5×7 block font and a conservative, shared plan for actual engraved size labels.
import Clipper from './vendor/clipper.js';
import {pocketOutline} from './finger-grip.js';
import {sizeText} from './tool-size.js';
import {containsPocketWalls} from './module-footprint.js';
import {getLang} from './i18n.js';
import {hashText} from './mesh-client.js';
import {moduleMagnetLift} from './print-material.js';
import {LABEL_DEFAULTS,labelStyleFor} from './label-style.js';

const SCALE=10000,PAD=.8,CELL=.5,CLEAR=.6;
const round=v=>Math.round(v*SCALE)/SCALE;
const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}].map(p=>({x:round(p.x),y:round(p.y)}));
const number=(v,f)=>Number.isFinite(Number(v))?Number(v):f;
const area=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.y-b.x*a.y;},0)/2;
const box=points=>{const xs=points.map(p=>p.x),ys=points.map(p=>p.y);return{x:Math.min(...xs),y:Math.min(...ys),maxX:Math.max(...xs),maxY:Math.max(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};};
const overlap=(a,b)=>a.x<b.maxX&&a.maxX>b.x&&a.y<b.maxY&&a.maxY>b.y;
const integers=paths=>paths.map(p=>p.map(v=>({X:Math.round(v.x*SCALE),Y:Math.round(v.y*SCALE)})));
const floats=paths=>paths.map(p=>p.map(v=>({x:v.X/SCALE,y:v.Y/SCALE})));
function clip(subject,obstacles=[],operation=Clipper.ClipType.ctUnion){
  const engine=new Clipper.Clipper(),result=[];
  engine.AddPaths(integers(subject),Clipper.PolyType.ptSubject,true);
  if(obstacles.length)engine.AddPaths(integers(obstacles),Clipper.PolyType.ptClip,true);
  engine.Execute(operation,result,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero);
  return floats(result);
}
function offset(poly,distance){
  const path=integers([poly])[0];if(!Clipper.Clipper.Orientation(path))path.reverse();
  const engine=new Clipper.ClipperOffset(2,.02*SCALE),result=[];
  engine.AddPath(path,Clipper.JoinType.jtRound,Clipper.EndType.etClosedPolygon);engine.Execute(result,distance*SCALE);
  return floats(result);
}
const FONT={
  '0':['01110','10001','10011','10101','11001','10001','01110'],
  '1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','10001','00001','00010','00100','01000','11111'],
  '3':['11110','00001','00001','01110','00001','00001','11110'],
  '4':['00010','00110','01010','10010','11111','00010','00010'],
  '5':['11111','10000','10000','11110','00001','00001','11110'],
  '6':['01110','10000','10000','11110','10001','10001','01110'],
  '7':['11111','00001','00010','00100','01000','01000','01000'],
  '8':['01110','10001','10001','01110','10001','10001','01110'],
  '9':['01110','10001','10001','01111','00001','00001','01110'],
  A:['01110','10001','10001','11111','10001','10001','10001'],
  B:['11110','10001','10001','11110','10001','10001','11110'],
  C:['01111','10000','10000','10000','10000','10000','01111'],
  D:['11110','10001','10001','10001','10001','10001','11110'],
  E:['11111','10000','10000','11110','10000','10000','11111'],
  F:['11111','10000','10000','11110','10000','10000','10000'],
  G:['01111','10000','10000','10111','10001','10001','01111'],
  H:['10001','10001','10001','11111','10001','10001','10001'],
  I:['01110','00100','00100','00100','00100','00100','01110'],
  J:['00111','00010','00010','00010','10010','10010','01100'],
  K:['10001','10010','10100','11000','10100','10010','10001'],
  L:['10000','10000','10000','10000','10000','10000','11111'],
  M:['10001','11011','10101','10101','10001','10001','10001'],
  N:['10001','11001','10101','10011','10001','10001','10001'],
  O:['01110','10001','10001','10001','10001','10001','01110'],
  P:['11110','10001','10001','11110','10000','10000','10000'],
  Q:['01110','10001','10001','10001','10101','10010','01101'],
  R:['11110','10001','10001','11110','10100','10010','10001'],
  S:['01111','10000','10000','01110','00001','00001','11110'],
  T:['11111','00100','00100','00100','00100','00100','00100'],
  U:['10001','10001','10001','10001','10001','10001','01110'],
  V:['10001','10001','10001','10001','10001','01010','00100'],
  W:['10001','10001','10001','10101','10101','10101','01010'],
  X:['10001','10001','01010','00100','01010','10001','10001'],
  Y:['10001','10001','01010','00100','00100','00100','00100'],
  Z:['11111','00001','00010','00100','01000','10000','11111'],
  m:['00000','00000','11010','10101','10101','10101','10101'],
  i:['00100','00000','01100','00100','00100','00100','01110'],
  n:['00000','00000','11110','10001','10001','10001','10001'],
  '/':['00001','00001','00010','00100','01000','10000','10000'],
  '.':['00000','00000','00000','00000','00000','00110','00110'],
  '-':['00000','00000','00000','11111','00000','00000','00000'],
  '+':['00000','00100','00100','11111','00100','00100','00000'],
  '"':['01010','01010','01010','00000','00000','00000','00000'],
  "'":['00100','00100','00100','00000','00000','00000','00000'],
  '(' :['00010','00100','01000','01000','01000','00100','00010'],
  ')' :['01000','00100','00010','00010','00010','00100','01000'],
  ' ':['000','000','000','000','000','000','000']
};
const normalize=text=>String(text||'').trim().replace(/\s+/g,' ').replace(/,/g,'.').replace(/[−–—]/g,'-').replace(/[″“”]/g,'"').replace(/[′’]/g,"'").replace(/½/g,'1/2').replace(/¼/g,'1/4').replace(/¾/g,'3/4');

export const SIZE_LABEL_REASONS={
  'missing-size':'Nástroj nemá zadanou velikost pro tiskový popisek.',
  'unsupported-character':'Tiskový popisek obsahuje nepodporovaný znak. Použijte čísla a latinku bez diakritiky.',
  'no-space':'Vedle kapsy není dost bezpečného místa pro čitelný tiskový popisek.',
  'insufficient-height':'Nad dnem není dost materiálu pro bezpečně vyrytý popisek.',
  'invalid-pocket':'Bez platného obrysu kapsy nelze popisek bezpečně umístit.'
};

/** Font-row (Y-down) millimetre polygons. Characters are `size` mm high; a stroke is one seventh of that, so the default 3.5 mm gives 0.5 mm. */
export function sizeLabelGlyphs(input,size=LABEL_DEFAULTS.size){
  const text=normalize(input),pixels=[],cell=CELL*size/LABEL_DEFAULTS.size;let cursor=0;
  if(!text||text.length>24)return null;
  for(const char of text){
    const glyph=FONT[char]||FONT[char.toUpperCase()];if(!glyph)return null;
    // A tiny overlap also joins diagonal pixels; corner-only contacts would create pinched cavities.
    for(let row=0;row<7;row++)for(let col=0;col<glyph[row].length;col++)if(glyph[row][col]==='1')pixels.push(rect(cursor+col*cell-.03,row*cell-.03,cell+.06,cell+.06));
    cursor+=(glyph[0].length+1)*cell;
  }
  return{text,width:round(cursor-cell),height:round(7*cell),polygons:clip(pixels)};
}

/**
 * A shared plan for 2D, preview and STL. Coordinates are absolute drawer millimetres.
 * Both polygon fields use the editor's Y-down coordinates, just like the pockets.
 * The complete body is converted to physical Y-up coordinates at STL export.
 * Solid labels remove only the top of the body (.35 mm by default). Light labels receive an integral
 * plaque above the existing base, at least 1 mm thick; engraving stays entirely above that base.
 * A light label without a background has no plaque: its letters stand directly on the base.
 * All plates avoid every pocket + wall, even when no plaque is built, so a label can be switched freely.
 */
export function planSizeLabels(project,modules=project.modules||[],tools=project.tools||[]){
  const labels=[],skipped=[];if(!project.sizeLabels)return{labels,skipped};
  const settings=JSON.stringify([project.sizeLabelStyle,getLang(),project.wall,project.base,project.insertHeight,project.printMode,project.bottomMode,project.magnetDepth,project.magnetDiameter,project.multiMaterial,project.clearance,project.grid]);
  for(const module of modules){
    const own=tools.filter(t=>t.moduleId===module.id),key=hashText(settings+JSON.stringify(module)+JSON.stringify(own));
    let plan=moduleLabels.get(key);
    if(plan)moduleLabels.delete(key);else plan=planModuleLabels(project,module,own);
    moduleLabels.set(key,plan);if(moduleLabels.size>MODULE_LABEL_CACHE)moduleLabels.delete(moduleLabels.keys().next().value);
    labels.push(...plan.labels);skipped.push(...plan.skipped);
  }
  return{labels,skipped};
}
// Labels depend only on their own module, and every redraw asks for them.
const MODULE_LABEL_CACHE=200,moduleLabels=new Map();
const trig=degrees=>{const turn=((degrees%360)+360)%360,radians=turn*Math.PI/180;return turn===0?[1,0]:turn===90?[0,1]:turn===180?[-1,0]:turn===270?[0,-1]:[Math.cos(radians),Math.sin(radians)];};
const turnedBox=({width,height},rotation)=>{const [cos,sin]=trig(rotation).map(Math.abs);return{width:width*cos+height*sin,depth:width*sin+height*cos};};
/** The label's plate: a rectangle of the unturned size, turned about the centre of its bounding box. */
function plateAt(x,y,width,depth,rotation,size){
  if(rotation%90===0)return rect(x,y,width,depth);
  const [cos,sin]=trig(rotation),cx=x+width/2,cy=y+depth/2,w=size.width/2,h=size.height/2;
  return[[-w,-h],[w,-h],[w,h],[-w,h]].map(([u,v])=>({x:round(cx+u*cos-v*sin),y:round(cy+u*sin+v*cos)}));
}
function planModuleLabels(project,module,own){
  const labels=[],skipped=[];
  const wall=number(project.wall,2.4),base=number(project.base,2.4),height=number(project.insertHeight,20),light=project.printMode==='light';
  const effectiveBase=project.bottomMode==='magnet'?Math.max(base,number(project.magnetDepth,2.2)+1.2):base;
  const foot=project.bottomMode==='grid'?4.75:0,lift=moduleMagnetLift(project,own),baseTop=foot+effectiveBase+lift,top=light?baseTop+Math.min(1,height-base-lift):foot+height+effectiveBase-base;
  const available=height-base-lift,obstacles=[];let invalid=false;
  for(const tool of own){try{const poly=tool.poly||pocketOutline(tool,project);if(poly.length<3)throw Error();obstacles.push(...offset(poly,wall+CLEAR));}catch{invalid=true;}}
  const blocked=obstacles.map(poly=>({poly,bounds:box(poly)})),margin=Math.max(wall+.25,project.bottomMode==='grid'?4.1:1.25),inner={x:module.x+margin,y:module.y+margin,maxX:module.x+module.width-margin,maxY:module.y+module.height-margin};
  const fits=(x,y,width,depth,rotation,size)=>{
    if(x<inner.x-1e-6||x+width>inner.maxX+1e-6||y<inner.y-1e-6||y+depth>inner.maxY+1e-6)return null;
    const plate=plateAt(x,y,width,depth,rotation,size),bounds=box(plate),near=blocked.filter(item=>overlap(bounds,item.bounds));
    if(module.cells&&!containsPocketWalls(module,plate,margin,number(project.grid,42),{inset:0}))return null;
    if(near.length&&clip([plate],near.map(item=>item.poly),Clipper.ClipType.ctIntersection).some(p=>Math.abs(area(p))>1e-7))return null;
    return plate;
  };
  // Hand-placed labels claim their spot first, so an automatic neighbour cannot push them away.
  const placed=own.filter(tool=>labelStyleFor(project,tool).position);
  for(const tool of [...placed,...own.filter(tool=>!placed.includes(tool))]){
    const style=labelStyleFor(project,tool),raw=sizeText(tool),text=normalize(raw),failure=reason=>skipped.push({toolId:tool.id,moduleId:module.id,text,reason});
    if(!text){failure('missing-size');continue;}
    const glyphs=sizeLabelGlyphs(text,style.size);if(!glyphs){failure('unsupported-character');continue;}
    if(available<.8){failure('insufficient-height');continue;}
    if(invalid){failure('invalid-pocket');continue;}
    const pocket=box(tool.poly||pocketOutline(tool,project)),candidates=[],anchor={x:(pocket.x+pocket.maxX)/2,y:(pocket.y+pocket.maxY)/2};
    const size={width:glyphs.width+2*PAD,height:glyphs.height+2*PAD};
    let chosen=null;
    if(style.position){
      const rotation=style.rotation??0,{width,depth}=turnedBox(size,rotation),x=round(anchor.x+style.position.dx-width/2),y=round(anchor.y+style.position.dy-depth/2),plate=fits(x,y,width,depth,rotation,size);
      if(plate)chosen={x,y,width,height:depth,rotation,plate,manual:true};
    }
    for(const rotation of chosen?[]:style.rotation===null?[0,90]:[style.rotation]){
      const {width,depth}=turnedBox(size,rotation),maxX=inner.maxX-width,maxY=inner.maxY-depth;
      if(maxX<inner.x||maxY<inner.y)continue;
      const xs=[inner.x,maxX,(inner.x+maxX)/2,pocket.x,pocket.maxX-width,(pocket.x+pocket.maxX-width)/2,pocket.maxX+wall+CLEAR,pocket.x-width-wall-CLEAR];
      const ys=[inner.y,maxY,(inner.y+maxY)/2,pocket.y,pocket.maxY-depth,(pocket.y+pocket.maxY-depth)/2,pocket.maxY+wall+CLEAR,pocket.y-depth-wall-CLEAR];
      for(let i=0;i<=10;i++){xs.push(inner.x+(maxX-inner.x)*i/10);ys.push(inner.y+(maxY-inner.y)*i/10);}
      for(const x of new Set(xs.map(round)))for(const y of new Set(ys.map(round))){
        if(x<inner.x-1e-6||x>maxX+1e-6||y<inner.y-1e-6||y>maxY+1e-6)continue;
        const cx=x+width/2,cy=y+depth/2,dx=Math.max(pocket.x-cx,0,cx-pocket.maxX),dy=Math.max(pocket.y-cy,0,cy-pocket.maxY);
        candidates.push({x,y,width,height:depth,rotation,score:Math.hypot(dx,dy)+rotation*.0001});
      }
    }
    candidates.sort((a,b)=>a.score-b.score||a.rotation-b.rotation||a.y-b.y||a.x-b.x);
    for(const candidate of chosen?[]:candidates){
      const plate=fits(candidate.x,candidate.y,candidate.width,candidate.height,candidate.rotation,size);
      if(plate){chosen={...candidate,plate};break;}
    }
    if(!chosen){failure('no-space');continue;}
    const {x,y,width,height:labelHeight,rotation,plate}=chosen,[cos,sin]=trig(rotation),cx=x+width/2,cy=y+labelHeight/2,gx=glyphs.width/2,gy=glyphs.height/2;
    const screenPolygons=glyphs.polygons.map(poly=>poly.map(p=>({x:round(cx+(p.x-gx)*cos-(p.y-gy)*sin),y:round(cy+(p.x-gx)*sin+(p.y-gy)*cos)})));
    const raised=light&&!style.background,wanted=style.relief??(raised?LABEL_DEFAULTS.raised:LABEL_DEFAULTS.engraved);
    // Every construction keeps its letters above the base; a plaque or body floor keeps .3 mm under an engraving.
    const plaque=raised?Math.min(wanted,available):Math.min(Math.max(1,wanted+.65),available),labelTop=light?baseTop+plaque:top,labelDepth=raised?plaque:Math.min(wanted,(light?plaque:available)-.3);
    // Lettering and pockets share one frame. Reflecting only the glyph here
    // would mirror it a second time when the whole body is exported.
    const polygons=screenPolygons;
    labels.push({toolId:tool.id,moduleId:module.id,text,x,y,width,height:labelHeight,rotation,polygons,screenPolygons,plate,top:round(labelTop),depth:round(labelDepth),baseTop:round(baseTop),light,raised,background:light&&!raised,color:style.color,size:style.size,plateWidth:size.width,plateDepth:size.height,center:{x:round(cx),y:round(cy)},anchor:{x:round(anchor.x),y:round(anchor.y)},manual:!!chosen.manual,displaced:!!style.position&&!chosen.manual});
    for(const poly of offset(plate,CLEAR))blocked.push({poly,bounds:box(poly)});
  }
  return{labels,skipped};
}
