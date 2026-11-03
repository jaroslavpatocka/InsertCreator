// Tool catalogue: ready-made 2D outlines so a drawer insert can be designed without photos.
// Loaded lazily (dynamic import) by the library UI. Every item uses this shape:
// {
//   id:'combination-wrench-din3113-13',      // stable, unique, [a-z0-9-]
//   category:'wrenches',                     // one of CATEGORIES ids
//   name:{cs:'Očkoplochý klíč 13 mm',en:'Combination wrench 13 mm'},
//   points:[{x,y},...],                      // closed outline, top view, millimetres, ≥3 and ≤6000 points, no self-intersections
//   depth:12,                                 // suggested pocket depth in mm (≈ tool thickness + margin)
//   unit:'mm',                                // native unit of the tool's nominal size ('mm'|'in'), becomes tool.unit when added
//   size:13,                                  // optional nominal size for sorting/filtering (in the native unit)
//   tags:['13 mm','DIN 3113'],               // optional search keywords (any language)
//   accuracy:'standard'|'typical'|'measured', // standard = from a published norm, typical = representative shape, measured = from an open dataset
//   source:{name,license,url}                 // provenance; license must allow redistribution
// }
import parametric from './parametric.js';
import imported from './imported.js';

export const CATEGORIES=[
  {id:'wrenches',cs:'Klíče',en:'Wrenches'},
  {id:'hex-keys',cs:'Imbusy a torxy',en:'Hex & Torx keys'},
  {id:'sockets',cs:'Nástrčné hlavice a bity',en:'Sockets & bits'},
  {id:'screwdrivers',cs:'Šroubováky',en:'Screwdrivers'},
  {id:'pliers',cs:'Kleště',en:'Pliers'},
  {id:'measuring',cs:'Měření a značení',en:'Measuring & marking'},
  {id:'cutting',cs:'Řezání a nože',en:'Cutting & knives'},
  {id:'striking',cs:'Kladiva a průbojníky',en:'Hammers & punches'},
  {id:'other',cs:'Ostatní',en:'Other'}
];

let cache=null;
/** All catalogue items, validated and de-duplicated by id (parametric wins). */
export function catalogItems(){
  if(cache)return cache;
  const seen=new Set(),out=[];
  for(const item of [...parametric,...imported]){
    if(!item||seen.has(item.id)||!Array.isArray(item.points)||item.points.length<3)continue;
    if(!CATEGORIES.some(c=>c.id===item.category))continue;
    seen.add(item.id);out.push(item);
  }
  return cache=out;
}
