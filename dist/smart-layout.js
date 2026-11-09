import Clipper from './vendor/clipper.js';
import {autoArrange,minimizeAutoModules,refitModules,pocketOutline,transformedPoints,validateLayout} from './geometry.js';
import {automaticFingerGrips,fingerGripOutline} from './finger-grip.js';
import {arrangeToolSets} from './set-layout.js';
import {analyzeToolShape,findToolSets,setCoherence} from './tool-sets.js';
import {orderTools} from './tool-size.js';
import {addToolGroup} from './set-module.js';
import {moduleOutline,moduleIntersects,modulePadding,steppedModuleFootprint} from './module-footprint.js';
import {tightenLayout} from './space-layout.js';
import {effectivePocketMargin} from './pocket-margin.js';
import {releaseSoloMargins,restoreSoloMargins} from './module-margin.js';

const EPS=.001,SCALE=10000,CELL=2,MAX_CANDIDATES=32000,footprints=new WeakMap();
const copy=value=>typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));
const number=(value,fallback=0)=>Number.isFinite(+value)?+value:fallback;
const compareId=(a,b)=>String(a)<String(b)?-1:String(a)>String(b)?1:0;
const area=module=>{if(!module.cells)return Math.max(0,module.width-.5)*Math.max(0,module.height-.5);const grid=module.width/(Math.max(...module.cells.map(cell=>cell.x))+1),points=moduleOutline(module,grid,{inset:.25});return Math.abs(points.reduce((sum,p,index)=>{const q=points[(index+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)/2);};
const box=points=>{let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of points){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}return{minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};};
const intersects=(a,b)=>a.x<b.x+b.width-EPS&&a.x+a.width>b.x+EPS&&a.y<b.y+b.height-EPS&&a.y+a.height>b.y+EPS;
const inside=(module,project)=>module&&module.x>=-EPS&&module.y>=-EPS&&module.x+module.width<=project.width+EPS&&module.y+module.height<=project.height+EPS;
const angle=value=>{const result=((value%360)+360)%360;return Math.round(result*1e6)/1e6;};
const intPath=points=>{const path=points.map(p=>({X:Math.round(p.x*SCALE),Y:Math.round(p.y*SCALE)}));if(!Clipper.Clipper.Orientation(path))path.reverse();return path;};
function expanded(points,distance){
  const engine=new Clipper.ClipperOffset(2,.02*SCALE),result=[];engine.AddPath(intPath(points),Clipper.JoinType.jtRound,Clipper.EndType.etClosedPolygon);engine.Execute(result,distance*SCALE);
  if(!result.length)throw Error('Obrys kapsy nelze bezpečně rozšířit.');
  result.sort((a,b)=>Math.abs(Clipper.Clipper.Area(b))-Math.abs(Clipper.Clipper.Area(a)));
  return result[0].map(p=>({x:p.X/SCALE,y:p.Y/SCALE}));
}
function intersectionArea(a,b,operation=Clipper.ClipType.ctIntersection){
  const engine=new Clipper.Clipper(),result=[];engine.AddPath(intPath(a),Clipper.PolyType.ptSubject,true);engine.AddPath(intPath(b),Clipper.PolyType.ptClip,true);engine.Execute(operation,result,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero);
  return Math.abs(result.reduce((sum,path)=>sum+Clipper.Clipper.Area(path),0))/(SCALE*SCALE);
}
function principalAngle(points){
  let mass=0,cx=0,cy=0,xx=0,yy=0,xy=0;
  for(let i=0;i<points.length;i++){const p=points[i],q=points[(i+1)%points.length],w=p.x*q.y-q.x*p.y;mass+=w;cx+=(p.x+q.x)*w;cy+=(p.y+q.y)*w;xx+=(p.x*p.x+p.x*q.x+q.x*q.x)*w;yy+=(p.y*p.y+p.y*q.y+q.y*q.y)*w;xy+=(2*p.x*p.y+p.x*q.y+q.x*p.y+2*q.x*q.y)*w;}
  if(Math.abs(mass)<1e-8)throw Error('Kontura nástroje nemá platnou plochu.');cx/=3*mass;cy/=3*mass;
  return .5*Math.atan2(2*(xy/(12*mass)-cx*cy),xx/(6*mass)-cx*cx-yy/(6*mass)+cy*cy)*180/Math.PI;
}
function profile(points){
  const bounds=box(points),start=Math.floor(bounds.minY/CELL),length=Math.ceil(bounds.maxY/CELL)-start+1,left=new Float64Array(length).fill(Infinity),right=new Float64Array(length).fill(-Infinity);
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],first=Math.floor(Math.min(a.y,b.y)/CELL),last=Math.floor(Math.max(a.y,b.y)/CELL);
    for(let row=first;row<=last;row++){
      const low=Math.max(Math.min(a.y,b.y),row*CELL),high=Math.min(Math.max(a.y,b.y),(row+1)*CELL),index=row-start;
      if(index<0||index>=length)continue;
      const x1=b.y===a.y?Math.min(a.x,b.x):a.x+(b.x-a.x)*(low-a.y)/(b.y-a.y),x2=b.y===a.y?Math.max(a.x,b.x):a.x+(b.x-a.x)*(high-a.y)/(b.y-a.y);
      left[index]=Math.min(left[index],x1,x2);right[index]=Math.max(right[index],x1,x2);
    }
  }
  return{start,left,right};
}
function contactX(a,b,dy){
  const shift=Math.round(dy/CELL),lo=Math.max(a.start,b.start+shift),hi=Math.min(a.start+a.left.length,b.start+b.left.length+shift);let x=-Infinity;
  for(let row=lo;row<hi;row++){const ai=row-a.start,bi=row-shift-b.start;if(Number.isFinite(a.right[ai])&&Number.isFinite(b.left[bi]))x=Math.max(x,a.right[ai]-b.left[bi]);}
  return x;
}
function usefulGrips(tool){
  if(!tool.fingerGrips?.length)return false;
  const raw=tool.points;
  return tool.fingerGrips.every(grip=>{
    if(grip.shape&&grip.shape!=='circle'){
      const polygon=fingerGripOutline(grip),surface=Math.abs(polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p.x*q.y-q.x*p.y;},0)/2);
      return intersectionArea(polygon,raw,Clipper.ClipType.ctDifference)>=Math.max(6,surface*.12);
    }
    const circle=Array.from({length:64},(_,i)=>({x:grip.x+Math.cos(i*Math.PI/32)*grip.radius,y:grip.y+Math.sin(i*Math.PI/32)*grip.radius}));
    return intersectionArea(circle,raw,Clipper.ClipType.ctDifference)>=Math.max(6,Math.PI*grip.radius*grip.radius*.12);
  });
}
function orientations(tool,project,separation,{nest=false}={}){
  const aligned=90-principalAngle(tool.points),rotations=[aligned,aligned+180,aligned+90,aligned+270,...(nest?[]:[number(tool.rotation),number(tool.rotation)+90,number(tool.rotation)+180,number(tool.rotation)+270])];
  const unique=[...new Set(rotations.map(angle))],padding=modulePadding(project,.26),grid=number(project.grid,42),result=[];
  for(const rotation of unique){
    const source=pocketOutline({...tool,x:0,y:0,rotation},project),bounds=box(source),polygon=source.map(p=>({x:p.x-bounds.minX,y:p.y-bounds.minY}));
    const width=Math.ceil((bounds.width+2*padding-EPS)/grid)*grid,height=Math.ceil((bounds.height+2*padding-EPS)/grid)*grid;
    if(width>project.width+EPS||height>project.height+EPS)continue;
    result.push({tool,rotation,bounds,polygon,width,height,...(nest?{profile:profile(expanded(polygon,separation/2+.06))}:{})});
  }
  return result.sort((a,b)=>area(a)-area(b)||Math.max(a.width,a.height)-Math.max(b.width,b.height)||a.rotation-b.rotation);
}
function singleOption(orientation,module){
  const {tool,bounds,width,height,rotation}=orientation;
  return{...module,width,height,items:[{tool,x:(width-bounds.width)/2-bounds.minX,y:(height-bounds.height)/2-bounds.minY,rotation}]};
}
const hash=string=>{let value=2166136261;for(let i=0;i<string.length;i++){value^=string.charCodeAt(i);value=Math.imul(value,16777619);}return(value>>>0).toString(16);};
function pairOption(a,b,dx,dy,project){
  const padding=modulePadding(project,.26),grid=number(project.grid,42),minX=Math.min(0,dx),minY=Math.min(0,dy),w=Math.max(a.bounds.width,dx+b.bounds.width)-minX,h=Math.max(a.bounds.height,dy+b.bounds.height)-minY;
  const width=Math.ceil((w+2*padding-EPS)/grid)*grid,height=Math.ceil((h+2*padding-EPS)/grid)*grid;
  if(width>project.width+EPS||height>project.height+EPS)return null;
  // A shared rectangle alone is not contour nesting: the pocket bounds must
  // actually interleave while their full, expanded silhouettes remain separate.
  if(Math.min(a.bounds.width,dx+b.bounds.width)-Math.max(0,dx)<.5||Math.min(a.bounds.height,dy+b.bounds.height)-Math.max(0,dy)<.5)return null;
  const offsetX=(width-w)/2-minX,offsetY=(height-h)/2-minY;
  return{width,height,bbox:w*h,items:[{tool:a.tool,rotation:a.rotation,x:offsetX-a.bounds.minX,y:offsetY-a.bounds.minY},{tool:b.tool,rotation:b.rotation,x:offsetX+dx-b.bounds.minX,y:offsetY+dy-b.bounds.minY}],a,b,dx,dy};
}
function exactPair(option,project,separation){
  const a=option.a.polygon,b=option.b.polygon.map(p=>({x:p.x+option.dx,y:p.y+option.dy}));
  if(intersectionArea(expanded(a,separation+.025),b)>1e-7)return false;
  const module={id:'candidate',x:0,y:0,width:option.width,height:option.height},tools=option.items.map(item=>({...item.tool,x:item.x,y:item.y,rotation:item.rotation,moduleId:module.id}));
  return validateLayout({...project,width:module.width,height:module.height,modules:[module],tools}).length===0;
}
function matching(count,pairs,singles){
  if(count>16){const used=new Set(),chosen=[];for(const pair of [...pairs.values()].sort((a,b)=>b.gain-a.gain||a.i-b.i||a.j-b.j))if(!used.has(pair.i)&&!used.has(pair.j)){used.add(pair.i);used.add(pair.j);chosen.push(pair);}return chosen;}
  const cache=new Map();
  const solve=mask=>{
    if(!mask)return{cost:0,count:0,pairs:[]};if(cache.has(mask))return cache.get(mask);
    let i=0;while(!(mask&(1<<i)))i++;const rest=mask&~(1<<i),alone=solve(rest);let best={cost:alone.cost+singles[i],count:alone.count+1,pairs:alone.pairs};
    for(let j=i+1;j<count;j++)if(rest&(1<<j)){const pair=pairs.get(`${i}:${j}`);if(!pair)continue;const next=solve(rest&~(1<<j)),cost=next.cost+area(pair.option),number=next.count+1;if(cost<best.cost-EPS||(Math.abs(cost-best.cost)<EPS&&number<best.count))best={cost,count:number,pairs:[pair,...next.pairs]};}
    cache.set(mask,best);return best;
  };
  return solve((1<<count)-1).pairs;
}
function metric(result,project){
  const placedModules=result.modules.filter(module=>inside(module,project)),ids=new Set(placedModules.map(module=>module.id)),placed=new Set(result.tools.filter(tool=>ids.has(tool.moduleId)).map(tool=>tool.id));
  const bounds=placedModules.length?box(placedModules.flatMap(module=>[{x:module.x,y:module.y},{x:module.x+module.width,y:module.y+module.height}])):{width:0,height:0};
  return{placed,area:result.modules.reduce((sum,module)=>sum+area(module),0),modules:result.modules.length,bbox:bounds.width*bounds.height};
}
function better(a,b){return a.placed.size>b.placed.size||(a.placed.size===b.placed.size&&(a.area<b.area-EPS||(Math.abs(a.area-b.area)<EPS&&(a.modules<b.modules||(a.modules===b.modules&&a.bbox<b.bbox-EPS)))));}
function pack(project,fixed,atoms,order,{moduleShape='rectangular',maxPositions=Infinity}={}){
  const tools=project.tools.map(copy),byId=new Map(tools.map(tool=>[tool.id,tool])),modules=fixed.map(copy),grid=number(project.grid,42),unplaced=[];
  const ranks=new Map(orderTools(tools,'asc').map((tool,index)=>[tool.id,index]));
  const family=atom=>{
    const tool=atom.options[0].items[0]?.tool,set=(project.toolSets||[]).find(set=>set.toolIds.includes(tool?.id));
    if(set)return`set:${set.id}`;
    const type=tool?.category||tool?.type||tool?.catalog?.category;if(type)return`type:${type}`;
    try{const shape=analyzeToolShape(tool);return`shape:${Math.round(Math.log2(shape.aspect)*2)}:${Math.round(shape.fill*5)}:${Math.round(shape.endRatio*3)}`;}catch{return atom.id;}
  };
  const ranked=typeof order==='function'?order([...atoms]):[...atoms].sort((a,b)=>{
    if(order===3){const grouped=compareId(family(a),family(b));if(grouped)return grouped;return(ranks.get(a.options[0].items[0]?.tool.id)||0)-(ranks.get(b.options[0].items[0]?.tool.id)||0)||compareId(a.id,b.id);}
    const aa=a.options[0],bb=b.options[0];const score=option=>order===1?Math.max(option.width,option.height):order===2?option.width:option.width*option.height;
    return score(bb)-score(aa)||compareId(a.id,b.id);
  });
  // Tools that stay parked must not land on modules already parked outside the drawer.
  let outsideY=fixed.filter(module=>!inside(module,project)).reduce((bottom,module)=>Math.max(bottom,module.y+module.height+grid),0),positions=0,searchLimited=false;
  for(const atom of ranked){
    const protectedShape=atom.preserveFootprint||atom.module.sizeMode==='manual'||atom.module.pocketMargin!=null||atom.module.setLayout==='uniform'&&(project.toolSets||[]).some(set=>set.layout==='uniform'&&set.id===atom.module.setId);
    const options=atom.options.map(option=>{
      // The same option comes back in every packing order, and its cut is the slow part.
      const known=moduleShape==='stepped'&&!protectedShape&&footprints.get(option);if(known)return{...option,...known};
      const module={...atom.module,x:0,y:0,width:option.width,height:option.height};
      if(!protectedShape){delete module.cells;delete module.shape;}
      const own=option.items.map(item=>({...item.tool,moduleId:module.id,x:item.x,y:item.y,rotation:item.rotation}));
      const footprint=moduleShape==='stepped'&&!protectedShape?steppedModuleFootprint({...project,tools:own},module):module;
      const fields={width:footprint.width,height:footprint.height,...(footprint.cells?{shape:'stepped',cells:footprint.cells}:{shape:'rectangular'})};
      if(moduleShape==='stepped'&&!protectedShape)footprints.set(option,fields);
      return{...option,...fields};
    });
    let chosen=null;
    search:for(const option of options){
      for(let y=0;y+option.height<=project.height+EPS;y+=grid){let found=false;
        for(let x=0;x+option.width<=project.width+EPS;x+=grid){
          if(++positions>maxPositions){searchLimited=true;break search;}
          const rect={...option,x,y};if(modules.some(module=>intersects(rect,module)&&moduleIntersects(rect,module,grid)))continue;
          const score=(y+option.height)*1e6+x*100+option.height;
          if(!chosen||score<chosen.score)chosen={option,x,y,score};found=true;break;
        }
        if(found)break;
      }
    }
    // Parked modules may overlap one another, but every partial result must
    // remain inside the persisted coordinate range even with hundreds of tools.
    const option=chosen?.option||options[0],parkX=Math.max(0,Math.floor((4000-option.width)/grid)*grid),parkY=Math.max(0,Math.floor((4000-option.height)/grid)*grid),x=chosen?chosen.x:Math.min(Math.ceil(project.width/grid)*grid+grid,parkX),y=chosen?chosen.y:Math.min(Math.ceil(outsideY/grid)*grid,parkY);
    const module={...atom.module,x,y,width:option.width,height:option.height};delete module.cells;delete module.shape;if(option.cells){module.shape='stepped';module.cells=copy(option.cells);}modules.push(module);if(!chosen)outsideY+=option.height+grid;
    for(const item of option.items){const target=byId.get(item.tool.id);Object.assign(target,copy(item.tool),{moduleId:module.id,x:x+item.x,y:y+item.y,rotation:item.rotation});if(!chosen)unplaced.push(target.id);}
  }
  return{tools,modules,unplaced,...(searchLimited?{searchLimited:true}:{})};
}

/** Large drawers use bounded greedy candidates, not exponential pair matching. */
async function largeArrange(project,{mode='compact',moduleShape='rectangular',onProgress,signal}={}){
  const source=copy(project),before=metric(source,source),original={tools:source.tools,modules:source.modules},grid=number(source.grid,42),maxPositions=120000;
  if(source.tools.length>3000||source.modules.length>4000)throw Error('Projekt je příliš velký. Limit je 3000 nástrojů a 4000 modulů.');
  const abort=()=>{if(signal?.aborted)throw new DOMException('Chytré rozvržení bylo zrušeno.','AbortError');};
  const progress=(value,message)=>{abort();try{onProgress?.({stage:'packing',progress:value,message});}catch{}abort();};
  const pause=async()=>{await new Promise(resolve=>setTimeout(resolve,0));abort();};
  progress(.01,'Kontroluji rozměry, zámky a přístup pro prsty…');await pause();
  const placed=source.modules.filter(module=>inside(module,source)),placedIds=new Set(placed.map(module=>module.id)),initialIssue=validateLayout({...source,modules:placed,tools:source.tools.filter(tool=>placedIds.has(tool.moduleId))})[0];
  if(initialIssue)throw Error(initialIssue.message);
  // A parked tool must pass the same contour/depth checks as a placed one.
  for(const tool of source.tools){
    const poly=pocketOutline(tool,source),bounds=box(poly),padding=modulePadding(source,.26),width=bounds.width+2*padding,height=bounds.height+2*padding;
    const issue=validateLayout({...source,width,height,modules:[{id:'check',x:0,y:0,width,height,pocketMargin:effectivePocketMargin(tool,source)}],tools:[{...tool,x:tool.x+padding-bounds.minX,y:tool.y+padding-bounds.minY,moduleId:'check'}]})[0];
    if(issue)throw Error(issue.message);
  }
  const sets=findToolSets(source).sets,originalScore=setCoherence(source,sets).score,own=(p,module)=>p.tools.filter(tool=>tool.moduleId===module.id);
  const value=result=>({...metric(result,source),score:mode==='sets'?setCoherence({...source,...result},sets).score:0});
  const improves=(a,b)=>a.placed.size>b.placed.size||(a.placed.size===b.placed.size&&(a.score>b.score||(a.score===b.score&&better(a,b))));
  const safe=(result,required=before.placed)=>{
    const after=metric(result,source);if([...required].some(id=>!after.placed.has(id)))return false;
    const modules=result.modules.filter(module=>inside(module,source)),ids=new Set(modules.map(module=>module.id));
    return !validateLayout({...source,...result,modules,tools:result.tools.filter(tool=>ids.has(tool.moduleId))}).length;
  };
  let best=original,bestMetric=value(best),searchLimited=false;
  const consider=result=>{searchLimited||=!!result.searchLimited;const after=value(result);if(improves(after,bestMetric)&&safe(result)){best=result;bestMetric=after;}};
  const uniform=(p,module)=>module.setLayout==='uniform'&&(p.toolSets||[]).some(set=>set.layout==='uniform'&&(set.id===module.setId||own(p,module).some(tool=>set.toolIds.includes(tool.id))));
  const atomsFor=(p,{rigidOnly=false}={})=>{
    const fixed=[],atoms=[],reserved=new Set(),ids=new Set(p.modules.map(module=>module.id));
    const allocate=base=>{let id=base,index=2;while(ids.has(id))id=`${base}-${index++}`;ids.add(id);return id;};
    const single=(tool,module)=>{
      const rotations=[...new Set([number(tool.rotation),number(tool.rotation)+90])],padding=modulePadding(source),options=[];
      for(const rotation of rotations){const bounds=box(pocketOutline({...tool,x:0,y:0,rotation},source)),width=Math.ceil((bounds.width+2*padding-1e-7)/grid)*grid,height=Math.ceil((bounds.height+2*padding-1e-7)/grid)*grid;options.push({width,height,items:[{tool,x:(width-bounds.width)/2-bounds.minX,y:(height-bounds.height)/2-bounds.minY,rotation}]});}
      return{id:module.id,module,options};
    };
    for(const module of p.modules){
      const members=own(p,module);for(const tool of members)reserved.add(tool.id);
      if(module.locked||!members.length||members.some(tool=>tool.locked)){fixed.push(copy(module));continue;}
      if(!rigidOnly&&module.sizeMode!=='manual'&&module.pocketMargin==null&&!uniform(p,module)&&members.length===1){atoms.push(single(members[0],copy(module)));continue;}
      atoms.push({id:module.id,module:copy(module),...(rigidOnly?{preserveFootprint:true}:{}),options:[{width:module.width,height:module.height,items:members.map(tool=>({tool,x:tool.x-module.x,y:tool.y-module.y,rotation:tool.rotation||0}))}]});
    }
    for(const tool of p.tools.filter(tool=>!reserved.has(tool.id))){if(tool.locked)throw Error('Zamčený nástroj musí mít vlastní platný modul.');const id=allocate(`mod-${hash(tool.id)}`);atoms.push(single(tool,{id,name:tool.name,sizeMode:'auto',locked:false}));}
    return{fixed,atoms};
  };
  const minimized=minimizeAutoModules(source).project;consider(minimized);
  const baseline=atomsFor(minimized);
  for(const order of [0,3]){consider(pack(minimized,baseline.fixed,baseline.atoms,order,{moduleShape,maxPositions}));await pause();}
  progress(.35,'Narovnávám obrysy a porovnávám protilehlé směry…');await pause();
  // Whole-family shelves are bounded alternatives even above the pair-nesting limit.
  const families=[],used=new Set();
  for(const family of sets.slice(0,8)){
    if(family.layout==='uniform')continue;
    const members=family.toolIds.map(id=>minimized.tools.find(tool=>tool.id===id));if(members.length<2||members.some(tool=>!tool||tool.locked||used.has(tool.id)))continue;
    const memberIds=new Set(members.map(tool=>tool.id)),touching=baseline.atoms.filter(atom=>atom.options[0].items.some(item=>memberIds.has(item.tool.id)));
    if(members.some(tool=>baseline.fixed.some(module=>module.id===tool.moduleId))||touching.some(atom=>atom.module.sizeMode==='manual'||atom.module.pocketMargin!=null||uniform(minimized,atom.module)||atom.options[0].items.some(item=>!memberIds.has(item.tool.id))))continue;
    let prepared;try{prepared=members.map(tool=>Object.hasOwn(tool,'fingerGrips')?tool:{...tool,fingerGrips:automaticFingerGrips(tool,{radius:9})});}catch{continue;}
    if(prepared.some(tool=>!usefulGrips(tool)))continue;
    try{
      const arrangement=family.arrangement||'compact',order=family.order||'asc',id=`large-family-${hash(family.id)}`,result=addToolGroup({...source,tools:[],modules:[],toolSets:[]},orderTools(prepared,order),{name:family.name,moduleId:id,arrangement,order,alternate:arrangement==='compact',separation:Math.max(source.wall,source.gap),checkManufacturing:false,toolSet:{id:family.id,name:family.name,layout:'shared'}}),module=result.project.modules.find(module=>module.id===result.moduleId);
      if(!result.placed||!module)continue;
      const registered=(source.toolSets||[]).some(set=>set.id===family.id),previous=source.modules.find(module=>module.id===members[0].moduleId),newModule={...module,id:module.id,sizeMode:'auto',grouped:true,...(previous?.unit?{unit:previous.unit}:{})};if(!registered){delete newModule.setId;delete newModule.setLayout;}
      let nextId=newModule.id,index=2;while(source.modules.some(module=>module.id===nextId)||families.some(atom=>atom.id===nextId))nextId=`${newModule.id}-${index++}`;newModule.id=nextId;
      families.push({id:nextId,module:newModule,options:[{width:module.width,height:module.height,items:result.project.tools.map(tool=>({tool,x:tool.x-module.x,y:tool.y-module.y,rotation:tool.rotation||0}))}]});for(const tool of members)used.add(tool.id);
    }catch{}
    await pause();
  }
  if(families.length)for(const order of [0,3]){consider(pack(minimized,baseline.fixed,[...baseline.atoms.filter(atom=>!atom.options[0].items.some(item=>used.has(item.tool.id))),...families],order,{moduleShape,maxPositions}));await pause();}
  progress(.7,'Ověřuji stěny, vůli a zachování celé sestavy…');await pause();
  // Retain a user's manual margin unless removing it actually places more tools.
  if(bestMetric.placed.size<source.tools.length){
    const reference={...source,tools:best.tools,modules:best.modules},proposal=refitModules(reference,{includeManual:true,moduleIds:reference.modules.filter(module=>module.sizeMode==='manual').map(module=>module.id)}),ids=proposal.resizedModules.sort((a,b)=>b.before.width*b.before.height-b.after.width*b.after.height-(a.before.width*a.before.height-a.after.width*a.after.height)).slice(0,8).map(module=>module.id);
    const required=new Set(bestMetric.placed),count=bestMetric.placed.size;
    const tryShrink=chosen=>{const fitted=refitModules(reference,{includeManual:true,moduleIds:chosen}).project,{fixed,atoms}=atomsFor(fitted,{rigidOnly:true}),candidate=pack(fitted,fixed,atoms,0,{moduleShape,maxPositions});searchLimited||=!!candidate.searchLimited;return metric(candidate,source).placed.size>count&&safe(candidate,required)?candidate:null;};
    let accepted=ids.length?tryShrink(ids):null,kept=accepted?ids:[];
    if(!accepted)for(const id of ids){const candidate=tryShrink([id]);if(candidate&&(!accepted||improves(value(candidate),value(accepted)))){accepted=candidate;kept=[id];}await pause();}
    if(accepted){const target=metric(accepted,source).placed.size;for(const id of [...kept]){const reduced=kept.filter(value=>value!==id);if(!reduced.length)continue;const candidate=tryShrink(reduced);if(candidate&&metric(candidate,source).placed.size>=target){accepted=candidate;kept=reduced;}await pause();}consider(accepted);}
  }
  const after=metric(best,source),unplaced=best.tools.filter(tool=>!after.placed.has(tool.id)).map(tool=>tool.id),resizedModules=[];
  for(const old of source.modules){const module=best.modules.find(module=>module.id===old.id);if(module&&module.width<=old.width+EPS&&module.height<=old.height+EPS&&(module.width<old.width-EPS||module.height<old.height-EPS))resizedModules.push({id:old.id,name:old.name||old.id,before:{width:old.width,height:old.height},after:{width:module.width,height:module.height}});}
  const coherence=setCoherence({...source,...best},sets),oldCoherence=setCoherence(source,sets),setSummary=sets.map(set=>{const satisfied=coherence.satisfied.includes(set.id),shared=new Set(best.tools.filter(tool=>set.toolIds.includes(tool.id)).map(tool=>tool.moduleId)).size===1;return{id:set.id,name:set.name,toolIds:set.toolIds,requested:set.layout,applied:satisfied?(shared?'shared':set.layout==='uniform'?'uniform':'auto'):null,status:satisfied?(oldCoherence.satisfied.includes(set.id)?'preserved':'applied'):'unavailable',...(!satisfied?{reason:'Celou sadu se nepodařilo bezpečně umístit podle zvolené volby.'}:{})};});
  progress(1,'Chytré rozvržení je připravené.');
  return{tools:best.tools,modules:best.modules,unplaced,stats:{beforeArea:before.area,afterArea:after.area,savedPercent:before.area?Math.max(0,(1-after.area/before.area)*100):0,beforeModules:before.modules,afterModules:after.modules,sharedModules:best.modules.filter(module=>best.tools.filter(tool=>tool.moduleId===module.id).length>1).length,changed:JSON.stringify({tools:best.tools,modules:best.modules})!==JSON.stringify(original),resizedModules,reason:unplaced.length?(searchLimited?'limit':'drawer'):'ok',strategy:'greedy',searchLimited,manufacturingChecked:false,...(mode==='sets'?{setScoreBefore:originalScore,setScoreAfter:coherence.score,setsApplied:coherence.satisfied,setSummary,warnings:[]}:{} )}};
}

/** Bounded contour-aware pair nesting, followed by deterministic modular packing. */
async function compactArrange(project,{onProgress,signal,moduleShape='rectangular'}={}){
  const abort=()=>{if(signal?.aborted)throw new DOMException('Chytré rozvržení bylo zrušeno.','AbortError');};
  const progress=(stage,value,message)=>{abort();try{onProgress?.({stage,progress:value,message});}catch{}abort();};
  const pause=async()=>{await new Promise(resolve=>setTimeout(resolve,0));abort();};
  abort();if(!project||!Array.isArray(project.tools)||!Array.isArray(project.modules))throw Error('Projekt neobsahuje platné nástroje a moduly.');
  const source=copy(project),toolIds=new Set(),moduleIds=new Set();
  for(const module of source.modules){
    if(!module||typeof module.id!=='string'||!module.id||moduleIds.has(module.id))throw Error('Moduly musí mít jedinečné platné identifikátory.');moduleIds.add(module.id);
    if(!['x','y','width','height'].every(key=>Number.isFinite(Number(module[key])))||module.x<0||module.y<0||module.width<=0||module.height<=0)throw Error('Modul nemá platné rozměry nebo polohu.');
  }
  for(const tool of source.tools){if(!tool||typeof tool.id!=='string'||!tool.id||toolIds.has(tool.id))throw Error('Nástroje musí mít jedinečné platné identifikátory.');toolIds.add(tool.id);}
  const original={tools:copy(source.tools),modules:copy(source.modules),unplaced:[]},before=metric(original,source);original.unplaced=source.tools.filter(tool=>!before.placed.has(tool.id)).map(tool=>tool.id);
  let best=original,bestMetric=before;
  const finish=message=>{
    const after=metric(best,source),changed=JSON.stringify(best.tools)!==JSON.stringify(original.tools)||JSON.stringify(best.modules)!==JSON.stringify(original.modules);
    progress('complete',1,message);
    return{...best,unplaced:best.tools.filter(tool=>!after.placed.has(tool.id)).map(tool=>tool.id),stats:{beforeArea:before.area,afterArea:after.area,savedPercent:before.area?Math.max(0,(1-after.area/before.area)*100):0,beforeModules:before.modules,afterModules:after.modules,sharedModules:best.modules.filter(module=>best.tools.filter(tool=>tool.moduleId===module.id).length>1).length,changed}};
  };
  progress('prepare',.01,'Kontroluji rozměry, zámky a přístup pro prsty…');await pause();
  const grid=number(source.grid,42),separation=Math.max(number(source.wall,2.4),number(source.gap,3));
  if(!(source.width>0&&source.height>0&&grid>0&&source.wall>0))throw Error('Zkontrolujte rozměry šuplíku, rastr a tloušťku stěny.');
  if(source.tools.length>24||source.tools.reduce((sum,tool)=>sum+(tool.points?.length||0),0)>12000||Math.ceil(source.width/grid)*Math.ceil(source.height/grid)>20000)return finish('Sestava je pro chytré rozvržení příliš velká. Podporuje nejvýše 24 nástrojů a omezeně složité obrysy; sestava se nezměnila.');
  const placedModules=source.modules.filter(module=>inside(module,source)),placedIds=new Set(placedModules.map(module=>module.id));
  const initialIssues=validateLayout({...source,modules:placedModules,tools:source.tools.filter(tool=>placedIds.has(tool.moduleId))});
  if(initialIssues.length)throw Error('Nejdříve opravte sestavu: '+initialIssues[0].message);
  for(const tool of source.tools){
    const poly=pocketOutline(tool,source),bounds=box(poly),padding=modulePadding(source,.26),w=bounds.width+2*padding,h=bounds.height+2*padding;
    const check=validateLayout({...source,width:w,height:h,modules:[{id:'check',x:0,y:0,width:w,height:h,pocketMargin:effectivePocketMargin(tool,source)}],tools:[{...tool,x:tool.x+padding-bounds.minX,y:tool.y+padding-bounds.minY,moduleId:'check'}]});
    if(check.length)throw Error('Nejdříve opravte nástroj: '+check[0].message);
  }
  const fixed=[],rigid=[],free=[],reserved=new Set(),byModule=new Map(source.modules.map(module=>[module.id,source.tools.filter(tool=>tool.moduleId===module.id)]));
  for(const module of source.modules){
    const own=byModule.get(module.id),locked=module.locked||own.some(tool=>tool.locked);
    if(locked||!own.length){fixed.push(copy(module));for(const tool of own)reserved.add(tool.id);continue;}
    const uniform=module.setLayout==='uniform'&&(source.toolSets||[]).some(set=>set.layout==='uniform'&&(set.id===module.setId||own.some(tool=>set.toolIds.includes(tool.id))));
    const explicitShared=(source.toolSets||[]).some(set=>set.layout==='shared'&&set.id===module.setId);
    if(module.sizeMode==='manual'||module.pocketMargin!=null||uniform||explicitShared||own.length>1&&!module.grouped&&!module.setId){
      rigid.push({id:module.id,module:copy(module),options:[{width:module.width,height:module.height,items:own.map(tool=>({tool,x:tool.x-module.x,y:tool.y-module.y,rotation:tool.rotation||0}))}]});for(const tool of own)reserved.add(tool.id);
    }
  }
  for(const tool of source.tools){if(tool.locked&&!reserved.has(tool.id))throw Error('Zamčený nástroj musí mít vlastní platný modul.');if(!reserved.has(tool.id))free.push(tool);}
  free.sort((a,b)=>compareId(a.id,b.id));
  const singleAtoms=[],singleCosts=[],nesting=[],usedIds=new Set([...fixed,...rigid.map(atom=>atom.module)].map(module=>module.id));
  const allocate=id=>{let next=id,index=2;while(usedIds.has(next))next=`${id}-${index++}`;usedIds.add(next);return next;};
  for(const tool of free){
    const originalModule=source.modules.find(module=>module.id===tool.moduleId),id=allocate(originalModule?.id||`mod-${hash(tool.id)}`),module={...(originalModule||{}),id,name:originalModule?.name||tool.name,locked:false,sizeMode:'auto'};
    const available=orientations(tool,source,separation);
    if(!available.length){const bounds=box(pocketOutline(tool,source)),width=Math.ceil((bounds.width+2*modulePadding(source,.26))/grid)*grid,height=Math.ceil((bounds.height+2*modulePadding(source,.26))/grid)*grid;available.push({tool,rotation:tool.rotation||0,bounds,width,height});}
    const options=available.map(orientation=>singleOption(orientation,module));singleAtoms.push({id,module,options});singleCosts.push(Math.min(...options.map(area)));
    let prepared=tool;
    if(!Object.hasOwn(tool,'fingerGrips')){try{prepared={...tool,fingerGrips:automaticFingerGrips(tool,{radius:9})};}catch{prepared=null;}}
    nesting.push(prepared&&usefulGrips(prepared)?orientations(prepared,source,separation,{nest:true}):[]);
  }
  const consider=result=>{
    const value=metric(result,source);if([...before.placed].some(id=>!value.placed.has(id))||!better(value,bestMetric))return;
    const ids=new Set(result.modules.filter(module=>inside(module,source)).map(module=>module.id));
    if(validateLayout({...source,modules:result.modules.filter(module=>ids.has(module.id)),tools:result.tools.filter(tool=>ids.has(tool.moduleId))}).length)return;
    best=result;bestMetric=value;
  };
  for(let order=0;order<4;order++)consider(pack(source,fixed,[...rigid,...singleAtoms],order,{moduleShape}));
  // A whole family can use the space between three or more contours. Pair-only
  // nesting cannot insert a newly added member into an existing automatic group.
  const families=findToolSets(source).sets,familyAtoms=[],familyMembers=new Set();
  for(const family of families){
    const members=family.toolIds.map(id=>free.find(tool=>tool.id===id));
    if(members.length<2||members.some(tool=>!tool)||family.layout==='uniform'||members.some(tool=>familyMembers.has(tool.id)))continue;
    let prepared;try{prepared=members.map(tool=>Object.hasOwn(tool,'fingerGrips')?tool:{...tool,fingerGrips:automaticFingerGrips(tool,{radius:9})});}catch{continue;}
    if(prepared.some(tool=>!usefulGrips(tool)))continue;
    const options=[],id=allocate(`smart-family-${hash(family.id)}`),arrangement=family.arrangement||'compact',order=family.order||'asc';
    for(const policy of [...new Set([arrangement,'ordered'])]){
      try{
        const candidate=addToolGroup({...source,tools:[],modules:[],toolSets:[]},orderTools(prepared,order),{name:family.name,moduleId:id,arrangement:policy,order,alternate:policy==='compact',separation,toolSet:{id:family.id,name:family.name,layout:'shared'}});
        const module=candidate.project.modules.find(module=>module.id===candidate.moduleId);
        if(!module||!inside(module,source))continue;
        const items=candidate.project.tools.map(tool=>({tool,x:tool.x-module.x,y:tool.y-module.y,rotation:tool.rotation||0}));
        options.push({width:module.width,height:module.height,items});
      }catch{}
      await pause();
    }
    if(!options.length)continue;
    options.sort((a,b)=>area(a)-area(b));
    const first=members[0],previous=source.modules.find(module=>module.id===first.moduleId),registered=(source.toolSets||[]).find(set=>set.id===family.id);
    const module={id,name:family.name,sizeMode:'auto',grouped:true,locked:false,...(registered?{setId:family.id,setLayout:'shared'}:{}),...(previous?.unit?{unit:previous.unit}:{})};
    familyAtoms.push({id,module,options});for(const tool of members)familyMembers.add(tool.id);
  }
  if(familyAtoms.length)for(let order=0;order<4;order++)consider(pack(source,fixed,[...rigid,...singleAtoms.filter(atom=>!atom.options[0].items.some(item=>familyMembers.has(item.tool.id))),...familyAtoms],order,{moduleShape}));
  progress('orientations',.12,'Narovnávám obrysy a porovnávám protilehlé směry…');await pause();
  const pairs=new Map();let candidates=0;
  outer:for(let i=0;i<free.length;i++)for(let j=i+1;j<free.length;j++){
    let candidate=null;
    for(const a of nesting[i])for(const b of nesting[j]){
      const values=[0,CELL,-CELL,grid/2,-grid/2,grid,-grid,a.bounds.height-b.bounds.height,(a.bounds.height-b.bounds.height)/2,a.bounds.height*.25,-a.bounds.height*.25,b.bounds.height*.25,-b.bounds.height*.25,a.bounds.height*.5,-b.bounds.height*.5];
      for(const dy of [...new Set(values.map(value=>Math.round(value/CELL)*CELL))]){
        if(++candidates>MAX_CANDIDATES)break outer;
        const dx=contactX(a.profile,b.profile,dy);if(!Number.isFinite(dx))continue;
        const option=pairOption(a,b,dx,dy,source);if(!option||area(option)>=singleCosts[i]+singleCosts[j]-EPS)continue;
        if(!candidate||area(option)<area(candidate)-EPS||(Math.abs(area(option)-area(candidate))<EPS&&option.bbox<candidate.bbox-EPS))candidate=option;
      }
    }
    if(candidate&&exactPair(candidate,source,separation))pairs.set(`${i}:${j}`,{i,j,option:candidate,gain:singleCosts[i]+singleCosts[j]-area(candidate)});
    progress('nesting',.12+.7*((i*free.length+j+1)/(Math.max(1,free.length*free.length))),`Hledám místo pro celé kapsy včetně prstů (${pairs.size} vhodných dvojic)…`);await pause();
  }
  const optimal=matching(free.length,pairs,singleCosts),greedy=[...pairs.values()].sort((a,b)=>b.gain-a.gain||a.i-b.i||a.j-b.j),alternate=[];const taken=new Set();
  for(const pair of greedy)if(!taken.has(pair.i)&&!taken.has(pair.j)){taken.add(pair.i);taken.add(pair.j);alternate.push(pair);}
  const groupIds=new Map();
  for(const plan of [optimal,alternate]){
    const paired=new Set(plan.flatMap(pair=>[pair.i,pair.j])),groups=plan.map(pair=>{
      const ids=[free[pair.i].id,free[pair.j].id].sort(compareId),key=JSON.stringify(ids);if(!groupIds.has(key))groupIds.set(key,allocate(`smart-${hash(key)}`));const id=groupIds.get(key);
      const module={id,name:`${free[pair.i].name} + ${free[pair.j].name}`.slice(0,100),grouped:true,sizeMode:'auto',locked:false};
      const previous=source.modules.find(module=>module.id===free[pair.i].moduleId);
      if(previous&&Object.hasOwn(previous,'unit'))module.unit=previous.unit;else if(Object.hasOwn(source,'unit'))module.unit=source.unit;
      return{id,module,options:[pair.option]};
    });
    for(let order=0;order<3;order++){consider(pack(source,fixed,[...rigid,...singleAtoms.filter((atom,i)=>!paired.has(i)),...groups],order,{moduleShape}));await pause();}
  }
  progress('validate',.96,'Ověřuji stěny, vůli a zachování celé sestavy…');await pause();
  return finish(best===original?'Úspornější bezpečné rozvržení nebylo nalezeno.':'Chytré rozvržení je připravené.');
}

export async function smartArrange(project,options){
  const {project:source,released}=releaseSoloMargins(project);
  return restoreSoloMargins(await searchArrangement(source,options),released);
}

async function searchArrangement(project,{mode='compact',moduleShape='rectangular',merge=false,onProgress,signal}={}){
  if(!['compact','sets'].includes(mode))throw Error('Neznámý režim chytrého rozvržení.');
  if(!['rectangular','stepped'].includes(moduleShape))throw Error('Neznámý tvar modulů pro chytré rozvržení.');
  const run=source=>mode==='sets'?arrangeToolSets(source,{onProgress:progress,signal,compactArrange,moduleShape}):compactArrange(source,{onProgress:progress,signal,moduleShape});
  let lastProgress=0,share=1;
  const progress=event=>{const value=event.stage==='tighten'?event.progress:(event.progress||0)*share;lastProgress=Math.max(lastProgress,value);onProgress?.({...event,progress:lastProgress});};
  // Validate identifiers and fixed geometry before an automatic refit can mask bad input.
  if(!project||!Array.isArray(project.tools)||!Array.isArray(project.modules))return run(project);
  const source=copy(project),before=metric(source,source),original={tools:source.tools,modules:source.modules};
  // The last stage can take longest, so the earlier ones must not fill the bar.
  share=.95;
  // Every layout ends here: steps are cut, tools left outside are retried and, when allowed, modules are merged.
  const tighten=async found=>{
    const pause=async()=>{await new Promise(resolve=>setTimeout(resolve,0));if(signal?.aborted)throw new DOMException('Chytré rozvržení bylo zrušeno.','AbortError');};
    const tight=await tightenLayout(source,found,{moduleShape,mode,merge,pack,better,metric,pause,report:(value,message)=>progress({stage:'tighten',progress:value,message})});
    const after=metric(tight,source),unplaced=tight.tools.filter(tool=>!after.placed.has(tool.id)).map(tool=>tool.id);
    const fresh=mode==='sets'?setCoherence({...source,...tight},findToolSets(source).sets):null,setStats=fresh&&found.stats?.setSummary?{setScoreAfter:fresh.score,setsApplied:fresh.satisfied,setSummary:found.stats.setSummary.map(({reason,...set})=>{const satisfied=fresh.satisfied.includes(set.id);return{...set,status:satisfied?(set.status==='preserved'?'preserved':'applied'):'unavailable',applied:satisfied?set.applied||'shared':null,...(satisfied?{}:{reason:'Celou sadu se nepodařilo bezpečně umístit podle zvolené volby.'})};})}:{};
    const resizedModules=(found.stats?.resizedModules||[]).flatMap(item=>{const module=tight.modules.find(module=>module.id===item.id);return module?[{...item,after:{width:module.width,height:module.height}}]:[];});
    return{...found,tools:tight.tools,modules:tight.modules,unplaced,stats:{...found.stats,...setStats,resizedModules,afterArea:after.area,savedPercent:before.area?Math.max(0,(1-after.area/before.area)*100):0,afterModules:after.modules,sharedModules:tight.modules.filter(module=>tight.tools.filter(tool=>tool.moduleId===module.id).length>1).length,changed:JSON.stringify({tools:tight.tools,modules:tight.modules})!==JSON.stringify(original),mergedModules:tight.merged,reason:unplaced.length?(found.stats?.reason==='limit'||tight.searchLimited?'limit':'drawer'):'ok',...(tight.searchLimited?{searchLimited:true}:{})}};
  };
  for(const items of [source.tools,source.modules]){const ids=new Set();for(const item of items){if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id))return run(source);ids.add(item.id);}}
  if(source.modules.some(m=>!['x','y','width','height'].every(key=>Number.isFinite(Number(m[key])))||m.x<0||m.y<0||m.width<=0||m.height<=0)||![source.width,source.height,source.grid,source.wall].every(value=>Number.isFinite(Number(value))&&Number(value)>0))return run(source);
  if(source.tools.length>24||source.tools.reduce((sum,tool)=>sum+(tool.points?.length||0),0)>12000||Math.ceil(source.width/source.grid)*Math.ceil(source.height/source.grid)>20000)return tighten(await largeArrange(source,{mode,moduleShape,onProgress:progress,signal}));
  const placedModules=source.modules.filter(module=>inside(module,source)),placedModuleIds=new Set(placedModules.map(module=>module.id));
  if(validateLayout({...source,modules:placedModules,tools:source.tools.filter(tool=>placedModuleIds.has(tool.moduleId))}).length)return run(source);
  const safe=(candidate,required)=>{
    const value=metric(candidate,source);if([...required].some(id=>!value.placed.has(id)))return false;
    const modules=candidate.modules.filter(module=>inside(module,source)),ids=new Set(modules.map(module=>module.id));
    return !validateLayout({...source,...candidate,modules,tools:candidate.tools.filter(tool=>ids.has(tool.moduleId))}).length;
  };
  let prepared=minimizeAutoModules(source).project;
  const packed={...prepared,...autoArrange(prepared)};
  if(safe(packed,before.placed)&&better(metric(packed,source),metric(prepared,source)))prepared=packed;
  let result=await run(prepared),resultMetric=metric(result,source);
  // A manual module is a user constraint until its unused margin prevents another tool fitting.
  // Try all useful shrinks and individual alternatives, then remove unnecessary shrinks.
  if(resultMetric.placed.size<source.tools.length&&source.tools.length<=24&&Math.ceil(source.width/source.grid)*Math.ceil(source.height/source.grid)<=20000){
    const baseline={...source,tools:result.tools,modules:result.modules},proposal=refitModules(baseline,{includeManual:true,moduleIds:baseline.modules.filter(module=>module.sizeMode==='manual').map(module=>module.id)});
    const ids=proposal.resizedModules.map(module=>module.id).slice(0,24);
    let reclaimed=null,reclaimedIds=[];
    const tryIds=chosen=>{
      if(signal?.aborted)throw new DOMException('Chytré rozvržení bylo zrušeno.','AbortError');
      const refitted=refitModules(baseline,{includeManual:true,moduleIds:chosen}).project,candidate={...refitted,...autoArrange(refitted)},value=metric(candidate,source);
      if(value.placed.size<=resultMetric.placed.size||!safe(candidate,resultMetric.placed))return null;
      return candidate;
    };
    if(ids.length){reclaimed=tryIds(ids);if(reclaimed)reclaimedIds=ids;}
    if(!reclaimed)for(const id of ids){const candidate=tryIds([id]);if(candidate&&(!reclaimed||better(metric(candidate,source),metric(reclaimed,source)))){reclaimed=candidate;reclaimedIds=[id];}}
    if(reclaimed){
      const target=metric(reclaimed,source).placed.size;
      for(const id of [...reclaimedIds]){const reduced=reclaimedIds.filter(value=>value!==id);if(!reduced.length)continue;const candidate=tryIds(reduced);if(candidate&&metric(candidate,source).placed.size>=target){reclaimed=candidate;reclaimedIds=reduced;}}
      result=await run(reclaimed);resultMetric=metric(result,source);
    }
  }
  result=await tighten(result);resultMetric=metric(result,source);
  const after=metric(result,source),resizedModules=[];
  for(const old of source.modules){const current=result.modules.find(module=>module.id===old.id);if(current&&current.width<=old.width+EPS&&current.height<=old.height+EPS&&(current.width<old.width-EPS||current.height<old.height-EPS))resizedModules.push({id:old.id,name:old.name||old.id,before:{width:old.width,height:old.height},after:{width:current.width,height:current.height}});}
  const unplaced=result.tools.filter(tool=>!after.placed.has(tool.id)).map(tool=>tool.id),stats={...result.stats,beforeArea:before.area,afterArea:after.area,savedPercent:before.area?Math.max(0,(1-after.area/before.area)*100):0,beforeModules:before.modules,afterModules:after.modules,changed:JSON.stringify({tools:result.tools,modules:result.modules})!==JSON.stringify(original),resizedModules,reason:unplaced.length?(result.stats?.reason==='limit'?'limit':'drawer'):'ok'};
  if(mode==='sets'){const sets=findToolSets(source).sets;stats.setScoreBefore=setCoherence(source,sets).score;}
  return{...result,unplaced,stats};
}
