import {validateFingerGrips} from './finger-grip.js';

export const uid=()=>globalThis.crypto?.randomUUID?.()||`id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const clone=value=>JSON.parse(JSON.stringify(value));
const finite=(value,min,max,label)=>{const n=Number(value);if(!Number.isFinite(n)||n<min||n>max)throw Error(`Neplatná hodnota: ${label} (${min}–${max}).`);return n;};
const text=(s,max=100)=>String(s??'').slice(0,max);
export function validateProject(input){
  const p=input?.project||input;
  if(!p||typeof p!=='object'||!Array.isArray(p.tools)||!Array.isArray(p.modules))throw Error('Soubor neobsahuje projekt Šuplík Studia.');
  if(p.tools.length>300||p.modules.length>400)throw Error('Projekt je příliš velký. Limit je 300 nástrojů a 400 modulů.');
  const out={id:text(p.id||uid()),name:text(p.name||'Nový šuplík'),width:finite(p.width,42,3000,'šířka'),height:finite(p.height,42,3000,'hloubka'),grid:finite(p.grid??42,10,100,'rastr'),gap:finite(p.gap??3,0,30,'mezera'),clearance:finite(p.clearance??.8,0,5,'vůle'),wall:finite(p.wall??2.4,1,15,'stěna'),base:finite(p.base??2.4,1,20,'dno'),insertHeight:finite(p.insertHeight??20,3,100,'výška inzertu'),tools:[],modules:[],updatedAt:text(p.updatedAt||new Date().toISOString())};
  out.printMode=['solid','light'].includes(p.printMode)?p.printMode:'solid';
  out.bottomMode=['plain','grid','magnet','adhesive'].includes(p.bottomMode)?p.bottomMode:'plain';
  out.bedWidth=finite(p.bedWidth??220,50,2000,'šířka tiskové plochy');
  out.bedHeight=finite(p.bedHeight??220,50,2000,'hloubka tiskové plochy');
  out.limitToBed=p.limitToBed!==false;
  out.magnetDiameter=finite(p.magnetDiameter??6.2,3,20,'průměr kapsy pro magnet');
  out.magnetDepth=finite(p.magnetDepth??2.2,1,8,'hloubka kapsy pro magnet');
  const ids=new Set();
  out.modules=p.modules.map(m=>{
    const id=text(m.id||uid());if(ids.has(id))throw Error('Duplicitní identifikátor modulu.');ids.add(id);
    return{id,name:text(m.name||'Modul'),x:finite(m.x,0,4000,'pozice X'),y:finite(m.y,0,4000,'pozice Y'),width:finite(m.width,5,3000,'šířka modulu'),height:finite(m.height,5,3000,'hloubka modulu'),locked:!!m.locked,sizeMode:m.sizeMode==='manual'?'manual':'auto'};
  });
  const toolIds=new Set();
  out.tools=p.tools.map(t=>{
    if(!Array.isArray(t.points)||t.points.length<3||t.points.length>6000)throw Error('Kontura musí mít 3 až 6000 bodů.');
    const id=text(t.id||uid());if(toolIds.has(id))throw Error('Duplicitní identifikátor nástroje.');toolIds.add(id);
    let points=t.points.map(p=>({x:finite(p.x,-3000,3000,'bod X'),y:finite(p.y,-3000,3000,'bod Y')}));
    const minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y));points=points.map(p=>({x:p.x-minX,y:p.y-minY}));
    const width=Math.max(...points.map(p=>p.x)),height=Math.max(...points.map(p=>p.y));
    if(width<.1||height<.1)throw Error('Kontura nemá platnou plochu.');
    if(width>3000||height>3000)throw Error('Kontura nesmí v žádném směru přesáhnout 3000 mm.');
    return{id,name:text(t.name||'Nástroj'),points,x:finite(t.x??0,-1000000,1000000,'X nástroje'),y:finite(t.y??0,-1000000,1000000,'Y nástroje'),rotation:finite(t.rotation??0,-3600,3600,'otočení'),depth:finite(t.depth??12,.5,99,'hloubka kapsy'),locked:!!t.locked,moduleId:ids.has(t.moduleId)?t.moduleId:null,...(Object.hasOwn(t,'fingerGrips')?{fingerGrips:validateFingerGrips(t.fingerGrips,{minX,minY})}:{})};
  });return out;
}
export function readLocal(key,fallback){try{const value=localStorage.getItem(key);return value?JSON.parse(value):fallback;}catch{return fallback;}}
export function writeLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
export function blankProject(){return{id:uid(),name:'Můj nový šuplík',width:504,height:378,grid:42,gap:3,clearance:.8,wall:2.4,base:2.4,insertHeight:20,printMode:'light',bottomMode:'plain',bedWidth:220,bedHeight:220,limitToBed:true,magnetDiameter:6.2,magnetDepth:2.2,tools:[],modules:[]};}
