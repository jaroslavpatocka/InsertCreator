// One placement policy for manufacturing holes and puzzle-joint keepouts.
// Coordinates remain in the editor's world frame (X right, Y down).
import {containsPocketWalls,validateModuleFootprint} from './module-footprint.js';
import {i18nError} from './i18n.js';

const EPS=1e-7,number=(value,fallback)=>Number.isFinite(+value)?+value:fallback;
const defaultRound=value=>Math.round(value*10000)/10000;
const defaultCircle=(x,y,r)=>Array.from({length:48},(_,i)=>({x:defaultRound(x+Math.cos(i*Math.PI/24)*r),y:defaultRound(y+Math.sin(i*Math.PI/24)*r)}));

/** The four real blind magnet pockets, including the greedy stepped-module policy.
 * Placement uses one canonical precision for whole models, print cuts and joint
 * keepouts. The mesher may tessellate these circles with a finer clipping kernel.
 */
export function magnetPocketCenters(project,module,{diameter=number(project?.magnetDiameter,6.2),wall=number(project?.wall,2.4)}={}){
  const grid=number(project?.grid,42),footprint=validateModuleFootprint(module,grid),radius=diameter/2,edge=Math.max(1.2,wall),inset=radius+edge;
  const tooSmall=()=>i18nError('Modul „{name}“ je příliš malý pro čtyři bezpečně oddělené magnetové kapsy.',{name:module.name||module.id});
  if(Math.min(module.width-.5,module.height-.5)<2*diameter+2*edge+.5)throw tooSmall();
  const xs=[module.x+.25+inset,module.x+module.width-.25-inset],ys=[module.y+.25+inset,module.y+module.height-.25-inset];
  if(!footprint.cells)return xs.flatMap(x=>ys.map(y=>({x,y,radius})));
  const candidates=[],seen=new Set();
  const consider=(x,y)=>{
    const id=`${defaultRound(x)},${defaultRound(y)}`;if(seen.has(id))return;seen.add(id);
    if(containsPocketWalls(module,defaultCircle(x,y,radius),edge,grid))candidates.push({x,y,radius});
  };
  for(const x of xs)for(const y of ys)consider(x,y);
  for(const cell of footprint.cells){
    const x=module.x+cell.x*grid,y=module.y+cell.y*grid;consider(x+grid/2,y+grid/2);
    for(const dx of [.25+inset,grid-.25-inset])for(const dy of [.25+inset,grid-.25-inset])consider(x+dx,y+dy);
  }
  const chosen=[];
  while(chosen.length<4){
    const eligible=candidates.filter(p=>chosen.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>=2*radius+edge+.5-EPS));
    const score=p=>chosen.length?Math.min(...chosen.map(q=>Math.hypot(p.x-q.x,p.y-q.y))):Math.hypot(p.x-(module.x+module.width/2),p.y-(module.y+module.height/2));
    eligible.sort((a,b)=>score(b)-score(a)||a.y-b.y||a.x-b.x);
    if(!eligible.length)throw tooSmall();chosen.push(eligible[0]);
  }
  return chosen;
}
