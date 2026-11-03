import {validateFingerGrips} from './finger-grip.js';
import {validateToolSets} from './tool-sets.js';
import {t,t as tr,i18nError} from './i18n.js';
import {fmtLen} from './units.js';

export const uid=()=>globalThis.crypto?.randomUUID?.()||`id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const clone=value=>JSON.parse(JSON.stringify(value));
// Ranges of length fields are shown in the current display unit; angles stay plain numbers.
const range=(min,max,length)=>length?`${fmtLen(min,{suffix:false})}–${fmtLen(max)}`:`${min}–${max}`;
const finite=(value,min,max,label,length=true)=>{const n=Number(value);if(!Number.isFinite(n)||n<min||n>max)throw i18nError('Neplatná hodnota: {label} ({range}).',{label:t(label),range:range(min,max,length)});return n;};
const text=(s,max=100)=>String(s??'').slice(0,max);
export function validateProject(input){
  const p=input?.project||input;
  if(!p||typeof p!=='object'||!Array.isArray(p.tools)||!Array.isArray(p.modules))throw i18nError('Soubor neobsahuje projekt Šuplík Studia.');
  if(p.tools.length>300||p.modules.length>400)throw i18nError('Projekt je příliš velký. Limit je 300 nástrojů a 400 modulů.');
  const out={id:text(p.id||uid()),name:text(p.name||t('Nový šuplík')),width:finite(p.width,42,3000,'šířka'),height:finite(p.height,42,3000,'hloubka'),grid:finite(p.grid??42,10,100,'rastr'),gap:finite(p.gap??3,0,30,'mezera'),clearance:finite(p.clearance??.8,0,5,'vůle'),wall:finite(p.wall??2.4,1,15,'stěna'),base:finite(p.base??2.4,1,20,'dno'),insertHeight:finite(p.insertHeight??20,3,100,'výška inzertu'),tools:[],modules:[],updatedAt:text(p.updatedAt||new Date().toISOString())};
  out.printMode=['solid','light'].includes(p.printMode)?p.printMode:'solid';
  out.bottomMode=['plain','grid','magnet','adhesive'].includes(p.bottomMode)?p.bottomMode:'plain';
  out.bedWidth=finite(p.bedWidth??220,50,2000,'šířka tiskové plochy');
  out.bedHeight=finite(p.bedHeight??220,50,2000,'hloubka tiskové plochy');
  out.limitToBed=p.limitToBed!==false;
  out.unit=['mm','in'].includes(p.unit)?p.unit:'';
  out.sizeLabels=p.sizeLabels===true;
  out.magnetDiameter=finite(p.magnetDiameter??6.2,3,20,'průměr kapsy pro magnet');
  out.magnetDepth=finite(p.magnetDepth??2.2,1,8,'hloubka kapsy pro magnet');
  const ids=new Set();
  out.modules=p.modules.map(m=>{
    const id=text(m.id||uid());if(ids.has(id))throw i18nError('Duplicitní identifikátor modulu.');ids.add(id);
    let setFields={};
    if(Object.hasOwn(m,'setId')||Object.hasOwn(m,'setLayout')){
      if(typeof m.setId!=='string'||!m.setId.trim()||m.setId.length>100||!['uniform','shared'].includes(m.setLayout))throw i18nError('Modul sady musí mít platný identifikátor sady a způsob uspořádání.');
      setFields={setId:m.setId,setLayout:m.setLayout};
    }
    return{id,name:text(m.name||t('Modul')),x:finite(m.x,0,4000,'pozice X'),y:finite(m.y,0,4000,'pozice Y'),width:finite(m.width,5,3000,'šířka modulu'),height:finite(m.height,5,3000,'hloubka modulu'),...(['mm','in'].includes(m.unit)?{unit:m.unit}:{}),locked:!!m.locked,sizeMode:m.sizeMode==='manual'?'manual':'auto',...(m.grouped===true?{grouped:true}:{}),...setFields};
  });
  const toolIds=new Set();
  out.tools=p.tools.map(t=>{
    if(!Array.isArray(t.points)||t.points.length<3||t.points.length>6000)throw i18nError('Kontura musí mít 3 až 6000 bodů.');
    const id=text(t.id||uid());if(toolIds.has(id))throw i18nError('Duplicitní identifikátor nástroje.');toolIds.add(id);
    let points=t.points.map(p=>({x:finite(p.x,-3000,3000,'bod X'),y:finite(p.y,-3000,3000,'bod Y')}));
    const minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y));points=points.map(p=>({x:p.x-minX,y:p.y-minY}));
    const width=Math.max(...points.map(p=>p.x)),height=Math.max(...points.map(p=>p.y));
    if(width<.1||height<.1)throw i18nError('Kontura nemá platnou plochu.');
    if(width>3000||height>3000)throw i18nError('Kontura nesmí v žádném směru přesáhnout {max}.',{max:fmtLen(3000)});
    const sizeFields={};
    if(Object.hasOwn(t,'sizeLabel')){if(typeof t.sizeLabel!=='string')throw i18nError('Popisek velikosti musí být text.');sizeFields.sizeLabel=t.sizeLabel.replace(/[\u0000-\u001f]/g,'').trim().slice(0,24);}
    if(Object.hasOwn(t,'nominalSize')){
      const size=t.nominalSize;
      if(!size||typeof size.value!=='number'||!Number.isFinite(size.value)||size.value<=0||size.value>3000||!['mm','in'].includes(size.unit))throw i18nError('Zadejte platnou jmenovitou velikost nástroje.');
      sizeFields.nominalSize={value:size.value,unit:size.unit};
    }
    return{id,name:text(t.name||tr('Nástroj')),...(['mm','in'].includes(t.unit)?{unit:t.unit}:{}),...sizeFields,points,x:finite(t.x??0,-1000000,1000000,'X nástroje'),y:finite(t.y??0,-1000000,1000000,'Y nástroje'),rotation:finite(t.rotation??0,-3600,3600,'otočení',false),depth:finite(t.depth??12,.5,99,'hloubka kapsy'),locked:!!t.locked,moduleId:ids.has(t.moduleId)?t.moduleId:null,...(Object.hasOwn(t,'fingerGrips')?{fingerGrips:validateFingerGrips(t.fingerGrips,{minX,minY})}:{})};
  });
  if(Object.hasOwn(p,'toolSets'))out.toolSets=validateToolSets(p.toolSets,toolIds);
  return out;
}
export function readLocal(key,fallback){try{const value=localStorage.getItem(key);return value?JSON.parse(value):fallback;}catch{return fallback;}}
export function writeLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
export function blankProject(){return{id:uid(),name:t('Můj nový šuplík'),width:504,height:378,grid:42,gap:3,clearance:.8,wall:2.4,base:2.4,insertHeight:20,printMode:'light',bottomMode:'plain',bedWidth:220,bedHeight:220,limitToBed:true,magnetDiameter:6.2,magnetDepth:2.2,unit:'',tools:[],modules:[]};}
