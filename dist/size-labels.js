// Local 5×7 block font and a conservative, shared plan for actual engraved size labels.
import Clipper from './vendor/clipper.js';
import {pocketOutline} from './finger-grip.js';
import {sizeText} from './tool-size.js';
import {containsPocketWalls} from './module-footprint.js';

const SCALE=10000,DEPTH=.35,PAD=.8,CELL=.5,CLEAR=.6;
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

/** Millimetre polygons; strokes are at least 0.5 mm wide and characters 3.5 mm high. */
export function sizeLabelGlyphs(input){
  const text=normalize(input),pixels=[];let cursor=0;
  if(!text||text.length>24)return null;
  for(const char of text){
    const glyph=FONT[char]||FONT[char.toUpperCase()];if(!glyph)return null;
    // A tiny overlap also joins diagonal pixels; corner-only contacts would create pinched cavities.
    for(let row=0;row<7;row++)for(let col=0;col<glyph[row].length;col++)if(glyph[row][col]==='1')pixels.push(rect(cursor+col*CELL-.03,row*CELL-.03,CELL+.06,CELL+.06));
    cursor+=(glyph[0].length+1)*CELL;
  }
  return{text,width:round(cursor-CELL),height:7*CELL,polygons:clip(pixels)};
}

/**
 * A shared plan for 2D, preview and STL. Coordinates are absolute drawer millimetres.
 * Solid labels remove only the top .35 mm. Light labels receive an integral 1 mm plaque above the
 * existing base; engraving stays entirely above that base. All plaques avoid every pocket + wall.
 */
export function planSizeLabels(project,modules=project.modules||[],tools=project.tools||[]){
  const labels=[],skipped=[];if(!project.sizeLabels)return{labels,skipped};
  const wall=number(project.wall,2.4),base=number(project.base,2.4),height=number(project.insertHeight,20),light=project.printMode==='light';
  const effectiveBase=project.bottomMode==='magnet'?Math.max(base,number(project.magnetDepth,2.2)+1.2):base;
  const foot=project.bottomMode==='grid'?4.75:0,baseTop=foot+effectiveBase,top=light?baseTop+Math.min(1,height-base):foot+height+effectiveBase-base;
  const available=height-base;
  for(const module of modules){
    const own=tools.filter(t=>t.moduleId===module.id),obstacles=[];let invalid=false;
    for(const tool of own){try{const poly=tool.poly||pocketOutline(tool,number(project.clearance,.8));if(poly.length<3)throw Error();obstacles.push(...offset(poly,wall+CLEAR));}catch{invalid=true;}}
    const blocked=obstacles.map(poly=>({poly,bounds:box(poly)})),margin=Math.max(wall+.25,project.bottomMode==='grid'?4.1:1.25),inner={x:module.x+margin,y:module.y+margin,maxX:module.x+module.width-margin,maxY:module.y+module.height-margin};
    for(const tool of own){
      const raw=sizeText(tool),text=normalize(raw),failure=reason=>skipped.push({toolId:tool.id,moduleId:module.id,text,reason});
      if(!text){failure('missing-size');continue;}
      const glyphs=sizeLabelGlyphs(text);if(!glyphs){failure('unsupported-character');continue;}
      if(available<.8){failure('insufficient-height');continue;}
      if(invalid){failure('invalid-pocket');continue;}
      const pocket=box(tool.poly||pocketOutline(tool,number(project.clearance,.8))),candidates=[];
      for(const rotation of [0,90]){
        const width=(rotation?glyphs.height:glyphs.width)+2*PAD,depth=(rotation?glyphs.width:glyphs.height)+2*PAD,maxX=inner.maxX-width,maxY=inner.maxY-depth;
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
      let chosen=null;
      for(const candidate of candidates){
        const plate=rect(candidate.x,candidate.y,candidate.width,candidate.height),bounds=box(plate),near=blocked.filter(item=>overlap(bounds,item.bounds));
        if(module.cells&&!containsPocketWalls(module,plate,margin,number(project.grid,42),{inset:0}))continue;
        if(near.length&&clip([plate],near.map(item=>item.poly),Clipper.ClipType.ctIntersection).some(p=>Math.abs(area(p))>1e-7))continue;
        chosen={...candidate,plate};break;
      }
      if(!chosen){failure('no-space');continue;}
      const {x,y,width,height:labelHeight,rotation,plate}=chosen;
      const polygons=glyphs.polygons.map(poly=>poly.map(p=>rotation?{x:round(x+PAD+glyphs.height-p.y),y:round(y+PAD+p.x)}:{x:round(x+PAD+p.x),y:round(y+PAD+p.y)}));
      labels.push({toolId:tool.id,moduleId:module.id,text,x,y,width,height:labelHeight,rotation,polygons,plate,top:round(top),depth:DEPTH,baseTop:round(baseTop),light});
      for(const poly of offset(plate,CLEAR))blocked.push({poly,bounds:box(poly)});
    }
  }
  return{labels,skipped};
}
