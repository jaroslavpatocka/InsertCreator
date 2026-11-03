// Nominal tool size is declared metadata (or an explicit unit in a name), never a measurement of its outline.
import {getLang,fmtNum} from './i18n.js';

const NUMBER=String.raw`(?:\d+(?:[.,]\d+)?(?:\s+|-)\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?|[.,]\d+)`;
const EXPLICIT=new RegExp(String.raw`(?:^|[^\d.,/])(${NUMBER})\s*(mm\b|in(?:ch(?:es)?)?\b|["″”])`,'i');
const localName=tool=>typeof tool?.name==='string'?tool.name:tool?.name?.[getLang()]||tool?.name?.cs||tool?.name?.en||'';
const sizeCode=tool=>{const match=String(localName(tool)).match(/\b(PH|PZ|TX|T)\s*(\d+)\b/i);return match?match[1].toUpperCase()+match[2]:'';};
function numeric(text){
  const value=text.trim().replace(',','.');
  const mixed=value.match(/^(\d+(?:\.\d+)?)(?:\s+|-)(\d+)\/(\d+)$/);
  if(mixed)return Number(mixed[1])+Number(mixed[2])/Number(mixed[3]);
  const fraction=value.match(/^(\d+)\/(\d+)$/);
  return fraction?Number(fraction[1])/Number(fraction[2]):Number(value);
}
function explicit(text){
  const match=String(text??'').match(EXPLICIT);if(!match)return null;
  const value=numeric(match[1]),unit=/^mm$/i.test(match[2])?'mm':'in';
  return Number.isFinite(value)&&value>0?{value,unit}:null;
}
function textFor(value,unit){
  if(unit==='in'){
    const ticks=Math.round(value*64);
    if(Math.abs(value-ticks/64)<1e-7){
      const whole=Math.floor(ticks/64);let numerator=ticks%64,denominator=64;
      while(numerator&&numerator%2===0){numerator/=2;denominator/=2;}
      return (numerator?`${whole?whole+' ':''}${numerator}/${denominator}`:String(whole))+' in';
    }
  }
  return fmtNum(value,6)+' '+unit;
}

/** {value, unit, mm, text} from explicit nominalSize, or a size label/name containing mm or in (fractions accepted). */
export function getToolSize(tool){
  const nominal=tool?.nominalSize;
  const size=nominal&&typeof nominal.value==='number'&&Number.isFinite(nominal.value)&&nominal.value>0&&['mm','in'].includes(nominal.unit)
    ?{value:nominal.value,unit:nominal.unit}:explicit(tool?.sizeLabel)||(sizeCode(tool)?null:explicit(localName(tool)));
  if(!size)return null;
  return{...size,mm:size.value*(size.unit==='in'?25.4:1),text:String(tool?.sizeLabel??'').trim()||sizeCode(tool)||textFor(size.value,size.unit)};
}
/** Manual text always wins. No nominal label is invented from the physical outline. */
export function sizeText(tool){return String(tool?.sizeLabel??'').trim()||sizeCode(tool)||getToolSize(tool)?.text||'';}

function physicalLength(tool){
  const points=Array.isArray(tool?.points)?tool.points:[];
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const point of points){const x=Number(point?.x),y=Number(point?.y);if(!Number.isFinite(x)||!Number.isFinite(y))continue;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  return points.length&&Number.isFinite(minX)?Math.max(maxX-minX,maxY-minY):Infinity;
}
/** Compare nominal sizes in mm; tools without a nominal size fall back to physical length for ordering only. */
export function compareToolSize(a,b,order='asc'){
  const av=getToolSize(a)?.mm??physicalLength(a),bv=getToolSize(b)?.mm??physicalLength(b),direction=order==='desc'?-1:1;
  if(av!==bv)return (av<bv?-1:1)*direction;
  return String(a?.id??'').localeCompare(String(b?.id??''));
}
/** A sorted copy; tools themselves and their nominal sizes are never changed. */
export function orderTools(tools,order='asc'){return[...tools].sort((a,b)=>compareToolSize(a,b,order));}
