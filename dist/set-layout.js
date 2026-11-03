import {autoArrange,pocketOutline,transformedPoints,validateLayout,exportSTL} from './geometry.js';
import {automaticFingerGrips} from './finger-grip.js';
import {analyzeToolShape,findToolSets,setCoherence} from './tool-sets.js';
import {orderTools} from './tool-size.js';
import {addToolGroup} from './set-module.js';

const EPS=.001,copy=value=>structuredClone(value),area=m=>(m.width-.5)*(m.height-.5);
const bounds=points=>{let x=Infinity,y=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of points){x=Math.min(x,p.x);y=Math.min(y,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}return{x,y,maxX,maxY,width:maxX-x,height:maxY-y};};
const polygonArea=points=>Math.abs(points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p.x*q.y-q.x*p.y;},0)/2);
const inside=(m,p)=>m.x>=-EPS&&m.y>=-EPS&&m.x+m.width<=p.width+EPS&&m.y+m.height<=p.height+EPS;
const intersects=(a,b)=>a.x<b.x+b.width-EPS&&a.x+a.width>b.x+EPS&&a.y<b.y+b.height-EPS&&a.y+a.height>b.y+EPS;
const bedFits=(w,h,p)=>!p.limitToBed||((w-.5<=p.bedWidth+EPS&&h-.5<=p.bedHeight+EPS)||(h-.5<=p.bedWidth+EPS&&w-.5<=p.bedHeight+EPS));
const hash=value=>{let h=2166136261;for(const c of value){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return(h>>>0).toString(16);};
function metric(project,sets){
  const modules=project.modules.filter(m=>inside(m,project)),ids=new Set(modules.map(m=>m.id)),placed=new Set(project.tools.filter(t=>ids.has(t.moduleId)).map(t=>t.id));
  const b=modules.length?bounds(modules.flatMap(m=>[{x:m.x,y:m.y},{x:m.x+m.width,y:m.y+m.height}])):{width:0,height:0};
  return{placed,score:setCoherence(project,sets).score,area:project.modules.reduce((s,m)=>s+area(m),0),modules:project.modules.length,bbox:b.width*b.height};
}
const better=(a,b)=>a.placed.size>b.placed.size||(a.placed.size===b.placed.size&&(a.score>b.score||(a.score===b.score&&(a.area<b.area-EPS||(Math.abs(a.area-b.area)<EPS&&(a.modules<b.modules||(a.modules===b.modules&&a.bbox<b.bbox-EPS)))))));
function planOptions(project,set,allocate){
  const source=set.toolIds.map(id=>project.tools.find(t=>t.id===id)),padding=project.wall+.26,gap=Math.max(project.wall,project.gap),grid=project.grid;
  const ordered=set.arrangement||set.order?orderTools(source,set.order||'asc'):[...source].sort((a,b)=>analyzeToolShape(b).length-analyzeToolShape(a).length||a.id.localeCompare(b.id));
  const ids=new Map(source.map(t=>[t.id,allocate(`set-${hash(JSON.stringify([set.id,'uniform',t.id]))}`)])),sharedId=allocate(`set-${hash(JSON.stringify([set.id,'shared',set.toolIds.slice().sort()]))}`);
  const options=[];
  for(const layout of set.layout==='auto'?['uniform','shared']:[set.layout]){
    let tools=ordered.map(copy);
    if(layout==='shared'){
      try{tools=tools.map(t=>Object.hasOwn(t,'fingerGrips')?t:{...t,fingerGrips:automaticFingerGrips(t,{radius:9})});}
      catch{continue;}
      if(tools.some(t=>!t.fingerGrips?.length||polygonArea(pocketOutline(t,project.clearance))-polygonArea(transformedPoints(t,project.clearance))<6))continue;
      // The shared packer nests actual pockets (including grips) while retaining nominal size order.
      // Keep the regular shelf alternatives below as well: a different footprint may fit a free bay better.
      if(set.arrangement){
        try{
          const result=addToolGroup({...project,tools:[],modules:[],toolSets:[]},tools,{name:set.name,moduleId:sharedId,arrangement:set.arrangement,order:set.order||'asc',toolSet:{id:set.id,name:set.name,layout:'shared'}});
          const module=result.project.modules.find(m=>m.id===result.moduleId);
          if(result.placed&&bedFits(module.width,module.height,project)){
            const old=project.modules.find(m=>m.id===source[0].moduleId);
            if(old&&Object.hasOwn(old,'unit'))module.unit=old.unit;else if(Object.hasOwn(project,'unit'))module.unit=project.unit;
            options.push({set,layout,heading:-1,width:module.width,height:module.height,modules:[module],tools:result.project.tools,cost:area(module)});
          }
        }catch{}
      }
    }
    for(const heading of [0,90]){
      const items=tools.map(t=>{const rotation=analyzeToolShape(t).rotation+heading,b=bounds(pocketOutline({...t,x:0,y:0,rotation},project.clearance));return{tool:t,rotation,b};});
      const maxW=Math.max(...items.map(i=>i.b.width)),maxH=Math.max(...items.map(i=>i.b.height));
      const cellW=layout==='uniform'?Math.ceil((maxW+2*padding-EPS)/grid)*grid:maxW+gap;
      const cellH=layout==='uniform'?Math.ceil((maxH+2*padding-EPS)/grid)*grid:maxH+gap;
      if(layout==='uniform'&&!bedFits(cellW,cellH,project))continue;
      for(let columns=1;columns<=items.length;columns++){
        const rows=Math.ceil(items.length/columns),width=layout==='uniform'?cellW*columns:Math.ceil((columns*cellW-gap+2*padding-EPS)/grid)*grid,height=layout==='uniform'?cellH*rows:Math.ceil((rows*cellH-gap+2*padding-EPS)/grid)*grid;
        if(width>project.width+EPS||height>project.height+EPS||(layout==='shared'&&!bedFits(width,height,project)))continue;
        const modules=[],placed=[];
        if(layout==='shared'){
          const first=[...source].sort((a,b)=>a.id.localeCompare(b.id))[0],old=project.modules.find(m=>m.id===first.moduleId),module={id:sharedId,name:set.name,width,height,x:0,y:0,locked:false,sizeMode:'auto',grouped:true,setId:set.id,setLayout:'shared'};
          if(old&&Object.hasOwn(old,'unit'))module.unit=old.unit;else if(Object.hasOwn(project,'unit'))module.unit=project.unit;
          modules.push(module);
        }
        const contentW=columns*cellW-(layout==='shared'?gap:0),contentH=rows*cellH-(layout==='shared'?gap:0),ox=(width-contentW)/2,oy=(height-contentH)/2;
        for(const [i,item] of items.entries()){
          const col=i%columns,row=Math.floor(i/columns),moduleId=layout==='shared'?sharedId:ids.get(item.tool.id);
          if(layout==='uniform'){
            const old=project.modules.find(m=>m.id===item.tool.moduleId),module={...(old||{}),id:moduleId,name:item.tool.name,width:cellW,height:cellH,x:col*cellW,y:row*cellH,locked:false,sizeMode:'auto',setId:set.id,setLayout:'uniform'};
            delete module.grouped;modules.push(module);
          }
          const slotW=layout==='uniform'?cellW:maxW,slotH=layout==='uniform'?cellH:maxH;
          const left=ox+col*cellW,top=oy+row*cellH;
          placed.push({...item.tool,moduleId,rotation:item.rotation,x:left+(heading===90?(layout==='uniform'?padding:0):(slotW-item.b.width)/2)-item.b.x,y:top+(heading===0?slotH-(layout==='uniform'?padding:0)-item.b.height:(slotH-item.b.height)/2)-item.b.y});
        }
        options.push({set,layout,heading,width,height,modules,tools:placed,cost:modules.reduce((s,m)=>s+area(m),0)});
      }
    }
  }
  // Explicit order is a requirement, including nested compact rows. Do not rank a visually reversed shelf as coherent.
  if(set.arrangement||set.order)for(let i=options.length-1;i>=0;i--)if(!setCoherence({...project,tools:options[i].tools,modules:options[i].modules},[set]).satisfied.includes(set.id))options.splice(i,1);
  options.sort((a,b)=>a.cost-b.cost||a.width*a.height-b.width*b.height||a.heading-b.heading||a.width-b.width);
  const retained=options.slice(0,10);for(const layout of ['uniform','shared'])for(const heading of [0,90]){const option=options.find(p=>p.layout===layout&&p.heading===heading);if(option&&!retained.includes(option))retained.push(option);}
  return retained;
}

/** Coherent sets keep nominal order when requested. Explicit compact sets may use opposing 180° rows. */
export async function arrangeToolSets(project,{onProgress,signal,compactArrange}={}){
  const source=copy(project),abort=()=>{if(signal?.aborted)throw new DOMException('Rozvržení sad bylo zrušeno.','AbortError');};
  let lastProgress=0;
  const progress=(value,message)=>{abort();lastProgress=Math.max(lastProgress,value);try{onProgress?.({stage:'sets',progress:lastProgress,message});}catch{}abort();};
  const pause=async()=>{await new Promise(resolve=>setTimeout(resolve,0));abort();};
  abort();const warnings=[],manufacturingFailures=new Map();let sets=[],before,best,bestMetric;
  const finish=()=>{
    const result={tools:best.tools,modules:best.modules},after=metric({...source,...result},sets),coherence=setCoherence({...source,...result},sets);
    const beforeCoherence=setCoherence(source,sets),setSummary=sets.map(set=>{const satisfied=coherence.satisfied.includes(set.id),shared=new Set(result.tools.filter(t=>set.toolIds.includes(t.id)).map(t=>t.moduleId)).size===1;
      return{id:set.id,name:set.name,toolIds:set.toolIds,requested:set.layout,applied:satisfied?(shared?'shared':'uniform'):null,status:satisfied?(beforeCoherence.satisfied.includes(set.id)?'preserved':'applied'):'unavailable',...(!satisfied?{reason:warnings.find(w=>w.includes(set.name))||(manufacturingFailures.has(set.id)?manufacturingFailures.get(set.id)+' Sestava zůstává zachovaná.':'Celá sada se bezpečně nevejde do dostupného prostoru.')}:{})};});
    for(const summary of setSummary)if(summary.applied==='uniform'&&manufacturingFailures.has(summary.id))warnings.push(manufacturingFailures.get(summary.id)+' Použity stejně velké samostatné moduly.');
    for(const summary of setSummary)if(summary.status==='unavailable'&&!warnings.some(w=>w.includes(summary.name)))warnings.push(`${summary.name}: ${summary.reason}`);
    progress(1,'Rozvržení sad je připravené.');
    return{...result,unplaced:result.tools.filter(t=>!after.placed.has(t.id)).map(t=>t.id),stats:{beforeArea:before.area,afterArea:after.area,savedPercent:before.area?Math.max(0,(1-after.area/before.area)*100):0,beforeModules:source.modules.length,afterModules:result.modules.length,sharedModules:result.modules.filter(m=>result.tools.filter(t=>t.moduleId===m.id).length>1).length,changed:JSON.stringify(result)!==JSON.stringify({tools:source.tools,modules:source.modules}),setScoreBefore:before.score,setScoreAfter:after.score,setsApplied:coherence.satisfied,setSummary,warnings}};
  };
  if(!source||!Array.isArray(source.tools)||!Array.isArray(source.modules))throw Error('Projekt neobsahuje platné nástroje a moduly.');
  if(![source.width,source.height,source.grid,source.wall].every(value=>Number.isFinite(Number(value))&&Number(value)>0))throw Error('Zkontrolujte rozměry šuplíku, rastr a tloušťku stěny.');
  for(const [items,label] of [[source.tools,'Nástroje'],[source.modules,'Moduly']]){const ids=new Set();for(const item of items){if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id))throw Error(`${label} musí mít jedinečné identifikátory.`);ids.add(item.id);}}
  if(source.tools.length>24||source.tools.reduce((s,t)=>s+(t.points?.length||0),0)>12000||Math.ceil(source.width/source.grid)*Math.ceil(source.height/source.grid)>20000){
    before=metric(source,[]);best=source;warnings.push('Rozvržení sad podporuje nejvýše 24 nástrojů a omezeně složité obrysy. Sestava se nezměnila.');return finish();
  }
  progress(.02,'Hledám sady nástrojů a společný směr…');await pause();
  sets=findToolSets(source).sets;before=metric(source,sets);best=source;bestMetric=before;
  const placedModules=source.modules.filter(m=>inside(m,source)),placedIds=new Set(placedModules.map(m=>m.id));
  const issue=validateLayout({...source,modules:placedModules,tools:source.tools.filter(t=>placedIds.has(t.moduleId))})[0];if(issue)throw Error(issue.message);
  for(const tool of source.tools)pocketOutline(tool,source.clearance);
  const own=m=>source.tools.filter(t=>t.moduleId===m.id),protectedIds=new Set(source.modules.filter(m=>m.locked||m.sizeMode==='manual'||!own(m).length||own(m).some(t=>t.locked)||(!m.grouped&&m.setLayout!=='uniform'&&own(m).length>1)).map(m=>m.id));
  const blocked=new Set();for(const set of sets)if(set.toolIds.some(id=>protectedIds.has(source.tools.find(t=>t.id===id)?.moduleId))){blocked.add(set.id);warnings.push(`${set.name}: zamčené nebo ručně rozměrované moduly zůstaly zachované.`);}
  const usedIds=new Set(source.modules.map(m=>m.id)),allocate=id=>{let next=id,n=2;while(usedIds.has(next))next=`${id}-${n++}`;usedIds.add(next);return next;};
  const families=sets.filter(s=>!blocked.has(s.id)).map(set=>{const options=planOptions(source,set,allocate);if(!options.length)warnings.push(`${set.name}: požadované uspořádání celé sady se nevejde do šuplíku nebo na tiskovou plochu, případně chybí přístup pro prsty.`);return{set,options};});
  let beams=[[]];for(const family of families){beams=beams.flatMap(choices=>[null,...family.options].map(option=>[...choices,option])).sort((a,b)=>b.reduce((s,p)=>s+(p?p.set.toolIds.length:0),0)-a.reduce((s,p)=>s+(p?p.set.toolIds.length:0),0)||a.reduce((s,p)=>s+(p?.cost||0),0)-b.reduce((s,p)=>s+(p?.cost||0),0)).slice(0,24);}
  // Also try each family alone so one blocked bay cannot prevent other sets.
  for(let i=0;i<families.length;i++){const alternatives=new Set(families[i].options.slice(0,3));for(const layout of ['uniform','shared']){const option=families[i].options.find(p=>p.layout===layout);if(option)alternatives.add(option);}for(const option of alternatives){const choices=families.map(()=>null);choices[i]=option;beams.push(choices);}}
  const manufacturing=new Map();
  const consider=async candidate=>{const value=metric(candidate,sets);if([...before.placed].some(id=>!value.placed.has(id))||!better(value,bestMetric))return;
    const modules=candidate.modules.filter(m=>inside(m,candidate)),ids=new Set(modules.map(m=>m.id));if(validateLayout({...candidate,modules,tools:candidate.tools.filter(t=>ids.has(t.moduleId))}).length)return;
    for(const module of modules.filter(m=>m.setLayout==='shared'&&!source.modules.some(old=>old.id===m.id))){
      const own=candidate.tools.filter(t=>t.moduleId===module.id),signature=JSON.stringify({module:{width:module.width,height:module.height},tools:own.map(t=>({...t,x:t.x-module.x,y:t.y-module.y})),config:[source.wall,source.clearance,source.base,source.insertHeight,source.printMode,source.bottomMode,source.magnetDiameter,source.magnetDepth]});
      if(!manufacturing.has(signature)){
        progress(.8,'Ověřuji výrobní složitost společného modulu…');await pause();
        try{exportSTL(candidate,{moduleId:module.id});manufacturing.set(signature,true);}
        catch(error){manufacturing.set(signature,false);const set=sets.find(s=>s.id===module.setId);manufacturingFailures.set(module.setId,`${set?.name||module.name}: společný model nelze bezpečně vyrobit (${error.message}).`);}
      }
      if(!manufacturing.get(signature))return;
    }
    best=candidate;bestMetric=value;};
  for(const [index,choices] of beams.entries()){
    abort();const active=choices.filter(Boolean),activeIds=new Set(active.flatMap(p=>p.set.toolIds)),preservedIds=new Set(sets.filter(s=>!active.some(p=>p.set.id===s.id)).flatMap(s=>s.toolIds));
    const fixed=source.modules.filter(m=>protectedIds.has(m.id)||own(m).some(t=>preservedIds.has(t.id)));
    if(fixed.some(m=>own(m).some(t=>activeIds.has(t.id))))continue;
    const candidate=copy(source);candidate.modules=copy(fixed);const reservedIds=new Set(fixed.flatMap(m=>own(m).map(t=>t.id)));
    for(const t of candidate.tools)if(!reservedIds.has(t.id)&&!activeIds.has(t.id)){t.moduleId=null;}
    let fits=true;
    for(const plan of [...active].sort((a,b)=>b.width*b.height-a.width*a.height||a.set.id.localeCompare(b.set.id))){
      let position=null;for(let y=0;y+plan.height<=source.height+EPS&&!position;y+=source.grid)for(let x=0;x+plan.width<=source.width+EPS;x+=source.grid){if(!candidate.modules.some(m=>intersects({x,y,width:plan.width,height:plan.height},m))){position={x,y};break;}}
      if(!position){fits=false;break;}
      candidate.modules.push(...plan.modules.map(m=>({...m,x:m.x+position.x,y:m.y+position.y})));
      for(const t of plan.tools)Object.assign(candidate.tools.find(next=>next.id===t.id),copy(t),{x:t.x+position.x,y:t.y+position.y});
    }
    if(fits){
      const originalLocks=new Map(candidate.modules.map(m=>[m.id,m.locked]));candidate.modules.forEach(m=>m.locked=true);
      const result=autoArrange(candidate);candidate.tools=result.tools;candidate.modules=result.modules;for(const m of candidate.modules)if(originalLocks.has(m.id))m.locked=originalLocks.get(m.id);
      await consider(candidate);
    }
    progress(.1+.7*(index+1)/Math.max(1,beams.length),'Porovnávám stejné moduly a celé společné sady…');await pause();
  }
  const familyIds=new Set(sets.flatMap(set=>set.toolIds));
  if(compactArrange&&source.tools.some(t=>!familyIds.has(t.id))){
    const pinned=copy(best),moduleIds=new Set(pinned.modules.map(m=>m.id)),held=pinned.tools.filter(t=>familyIds.has(t.id)&&!moduleIds.has(t.moduleId));
    pinned.tools=pinned.tools.filter(t=>!held.some(h=>h.id===t.id));
    const locks=new Map(pinned.modules.filter(m=>protectedIds.has(m.id)||pinned.tools.some(t=>t.moduleId===m.id&&familyIds.has(t.id))).map(m=>[m.id,m.locked]));for(const m of pinned.modules)if(locks.has(m.id))m.locked=true;
    const result=await compactArrange(pinned,{signal,onProgress:event=>progress(.82+.16*(event.progress||0),'Dokončuji prostor pro ostatní nástroje…')});
    const resultTools=new Map([...result.tools,...held].map(t=>[t.id,t])),candidate={...source,...result,tools:source.tools.map(t=>resultTools.get(t.id))};for(const m of candidate.modules)if(locks.has(m.id))m.locked=locks.get(m.id);await consider(candidate);
  }
  return finish();
}
