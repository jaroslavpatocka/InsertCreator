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
import sets from './sets.js';
import {CATEGORIES} from '../tool-categories.js';

export {CATEGORIES};

// Tool sets ('Sady nářadí'): ready-made groups of catalogue items, e.g. a 6–32 mm wrench set.
// Shape: {id:'combination-wrench-set-6-32mm', category:'wrenches' (the category of its contents),
//   name:{cs,en}, description:{cs,en}?, items:['catalogue-item-id', ...] (may repeat an id for duplicates),
//   unit:'mm'|'in', tags:[...], source:{name,note,url?} (what real sets the composition is based on)}
export const SETS_CATEGORY={id:'sets',cs:'Sady nářadí',en:'Tool sets'};

let cache=null,setCache=null;
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

/** Tool sets whose every item exists in the catalogue (incomplete sets are dropped). Each set gets resolved `tools` (catalogue items, in order). */
export function catalogSets(){
  if(setCache)return setCache;
  const byId=new Map(catalogItems().map(i=>[i.id,i]));
  return setCache=sets.filter(set=>set&&set.id&&Array.isArray(set.items)&&set.items.length&&set.items.every(id=>byId.has(id)))
    .map(set=>({...set,tools:set.items.map(id=>byId.get(id))}));
}
