import {pocketOutline} from './finger-grip.js';
import {getToolSize,orderTools} from './tool-size.js';

const BINS=32,EPS=1e-8;
const cache=new Map();
const compare=(a,b)=>String(a)<String(b)?-1:String(a)>String(b)?1:0;
const wrap=degrees=>((degrees%360)+360)%360;
const hash=value=>{let result=2166136261;for(let i=0;i<value.length;i++){result^=value.charCodeAt(i);result=Math.imul(result,16777619);}return(result>>>0).toString(16);};
const average=values=>values.reduce((a,b)=>a+b,0)/Math.max(1,values.length);
const rms=(a,b)=>Math.sqrt(a.reduce((sum,value,i)=>sum+(value-b[i])**2,0)/a.length);
const cloneAnalysis=result=>({...result,profile:[...result.profile],envelope:[...result.envelope],centerline:[...result.centerline],intervals:[...result.intervals]});

/** Raw-shape analysis in millimetres; rotation is an absolute tool.rotation in degrees. */
export function analyzeToolShape(tool){
  if(!Array.isArray(tool?.points)||tool.points.length<3||tool.points.length>6000)throw Error('Nástroj nemá platný obrys pro porovnání sady.');
  const key=JSON.stringify(tool.points);if(cache.has(key))return cloneAnalysis(cache.get(key));
  const points=tool.points.map(p=>({x:Number(p?.x),y:Number(p?.y)}));
  if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw Error('Obrys nástroje obsahuje neplatné souřadnice.');
  let mass=0,cx=0,cy=0,xx=0,yy=0,xy=0,perimeter=0;
  for(let i=0;i<points.length;i++){
    const p=points[i],q=points[(i+1)%points.length],w=p.x*q.y-q.x*p.y;
    mass+=w;cx+=(p.x+q.x)*w;cy+=(p.y+q.y)*w;xx+=(p.x*p.x+p.x*q.x+q.x*q.x)*w;yy+=(p.y*p.y+p.y*q.y+q.y*q.y)*w;xy+=(2*p.x*p.y+p.x*q.y+q.x*p.y+2*q.x*q.y)*w;perimeter+=Math.hypot(q.x-p.x,q.y-p.y);
  }
  if(Math.abs(mass)<EPS)throw Error('Obrys nástroje nemá platnou plochu.');cx/=3*mass;cy/=3*mass;
  const angle=.5*Math.atan2(2*(xy/(12*mass)-cx*cy),xx/(6*mass)-cx*cx-yy/(6*mass)+cy*cy),axis={x:Math.cos(angle),y:Math.sin(angle)},normal={x:-axis.y,y:axis.x};
  const along=points.map(p=>p.x*axis.x+p.y*axis.y),across=points.map(p=>p.x*normal.x+p.y*normal.y),lo=Math.min(...along),hi=Math.max(...along),left=Math.min(...across),right=Math.max(...across),length=hi-lo,width=right-left;
  if(length<EPS||width<EPS)throw Error('Obrys nástroje nemá měřitelné rozměry.');
  let profile=[],envelope=[],centerline=[],intervals=[];
  for(let sample=0;sample<BINS;sample++){
    const station=lo+length*(sample+.5)/BINS,crossings=[];
    for(let i=0;i<points.length;i++){
      const next=(i+1)%points.length,a=along[i],b=along[next];if((a>station)!==(b>station)){const t=(station-a)/(b-a);crossings.push(across[i]+(across[next]-across[i])*t);}
    }
    crossings.sort((a,b)=>a-b);let filled=0,center=0;
    for(let i=0;i+1<crossings.length;i+=2){const span=crossings[i+1]-crossings[i];filled+=span;center+=(crossings[i+1]+crossings[i])/2*span;}
    profile.push(filled/width);envelope.push(crossings.length?(crossings.at(-1)-crossings[0])/width:0);centerline.push(filled?(center/filled-(left+right)/2)/width:0);intervals.push(Math.floor(crossings.length/2));
  }
  const first=average(profile.slice(1,8)),last=average(profile.slice(-8,-1));let flip=first>last+.025;
  if(Math.abs(first-last)<=.025){
    // Symmetric ends have no semantic handle. Quantized tie-breaking avoids an
    // arbitrary 180-degree flip merely from vertex order or floating point noise.
    for(let i=0;i<BINS;i++){const difference=Math.round(profile[i]*100)-Math.round(profile[BINS-1-i]*100);if(difference){flip=difference>0;break;}}
  }
  if(flip){profile.reverse();envelope.reverse();centerline=centerline.reverse().map(value=>-value);intervals.reverse();}
  let rotation=wrap(90-angle*180/Math.PI+(flip?180:0));rotation=wrap(Math.round(rotation*1e6)/1e6);
  const area=Math.abs(mass)/2,aspect=length/width,head=average(profile.slice(-8,-1)),tip=average(profile.slice(1,8));
  const result={rotation,length,width,aspect,area,fill:area/(length*width),profile,envelope,centerline,intervals,endRatio:Math.min(tip,head)/Math.max(tip,head,EPS),broadFraction:profile.filter(value=>value>.65).length/BINS,multipleFraction:intervals.filter(value=>value>1).length/BINS,compactness:perimeter/Math.sqrt(area),eligible:length>=25&&width>=3&&area>=50&&aspect>=1.6};
  if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(key,result);return cloneAnalysis(result);
}

/** Strict persisted schema; deleted tool IDs are discarded without removing a singleton set. */
export function validateToolSets(sets,knownToolIds){
  if(!Array.isArray(sets)||sets.length>300)throw Error('Sady nástrojů musí být pole s nejvýše 300 položkami.');
  const known=knownToolIds instanceof Set?knownToolIds:new Set(knownToolIds),ids=new Set(),members=new Set(),result=[];
  for(const set of sets){
    if(!set||typeof set.id!=='string'||!set.id.trim()||set.id.length>100||ids.has(set.id))throw Error('Sady musí mít jedinečné platné identifikátory.');ids.add(set.id);
    if(!Array.isArray(set.toolIds)||set.toolIds.length>300||set.toolIds.some(id=>typeof id!=='string'||!id||id.length>100))throw Error('Sada musí obsahovat platné identifikátory nástrojů.');
    const layout=set.layout??'auto';if(!['auto','uniform','shared'].includes(layout))throw Error('Zvolte automatické, sjednocené nebo společné uspořádání sady.');
    if(Object.hasOwn(set,'arrangement')&&!['ordered','compact'].includes(set.arrangement))throw Error('Zvolte přehledné nebo úsporné uložení sady.');
    if(Object.hasOwn(set,'order')&&!['asc','desc'].includes(set.order))throw Error('Zvolte vzestupné nebo sestupné pořadí velikostí.');
    const preferences={...(Object.hasOwn(set,'arrangement')?{arrangement:set.arrangement}:{}),...(Object.hasOwn(set,'order')?{order:set.order}:{})};
    const toolIds=[...new Set(set.toolIds)].filter(id=>known.has(id));
    for(const id of toolIds){if(members.has(id))throw Error('Nástroj může patřit pouze do jedné sady.');members.add(id);}
    if(toolIds.length)result.push({id:set.id,name:String(set.name||'Sada nástrojů').slice(0,100),toolIds,layout,...preferences});
  }
  return result;
}
function shapeDistance(a,b){
  if(!a.eligible||!b.eligible||Math.max(a.length,b.length)/Math.min(a.length,b.length)>4||Math.max(a.width,b.width)/Math.min(a.width,b.width)>4)return Infinity;
  const aspect=Math.max(a.aspect,b.aspect)/Math.min(a.aspect,b.aspect),profile=rms(a.profile,b.profile),end=Math.abs(a.endRatio-b.endRatio),multiple=Math.abs(a.multipleFraction-b.multipleFraction);
  if(aspect>2.3||profile>.33||end>.45||multiple>.2||Math.abs(a.broadFraction-b.broadFraction)>.32)return Infinity;
  const center=Math.min(rms(a.centerline,b.centerline),rms(a.centerline,b.centerline.map(value=>-value)));
  return profile*.5+rms(a.envelope,b.envelope)*.12+center*.1+Math.log(aspect)*.12+Math.abs(a.fill-b.fill)*.08+Math.abs(a.broadFraction-b.broadFraction)*.08;
}

/** Shape-only suggestions; explicit membership always has priority over detection. */
export function findToolSets(project){
  const tools=(Array.isArray(project?.tools)?project.tools:[]).filter(tool=>typeof tool?.id==='string'&&tool.id),known=new Set(tools.map(tool=>tool.id)),claimed=new Set(),usedIds=new Set(),sets=[];
  for(const source of Array.isArray(project?.toolSets)?project.toolSets:[]){
    if(!source||!Array.isArray(source.toolIds))continue;
    const toolIds=[...new Set(source.toolIds)].filter(id=>known.has(id)&&!claimed.has(id));if(!toolIds.length)continue;
    for(const id of toolIds)claimed.add(id);
    let id=typeof source.id==='string'&&source.id?source.id:`manual-${hash(JSON.stringify([...toolIds].sort(compare)))}`,suffix=2;const base=id;while(usedIds.has(id))id=`${base}-${suffix++}`;usedIds.add(id);
    sets.push({id,name:String(source.name||'Sada nástrojů'),toolIds,layout:['auto','uniform','shared'].includes(source.layout)?source.layout:'auto',...(['ordered','compact'].includes(source.arrangement)?{arrangement:source.arrangement}:{}),...(['asc','desc'].includes(source.order)?{order:source.order}:{}),source:'manual',confidence:1});
  }
  const shapes=[];
  for(const tool of tools.filter(tool=>!claimed.has(tool.id)).sort((a,b)=>compare(a.id,b.id))){try{const analysis=analyzeToolShape(tool);if(analysis.eligible)shapes.push({id:tool.id,analysis});}catch{}}
  const distances=shapes.map((a,i)=>shapes.map((b,j)=>i===j?0:shapeDistance(a.analysis,b.analysis))),clusters=shapes.map((shape,i)=>[i]);
  while(true){
    let best=null;
    for(let i=0;i<clusters.length;i++)for(let j=i+1;j<clusters.length;j++){
      let distance=0;for(const a of clusters[i])for(const b of clusters[j])distance=Math.max(distance,distances[a][b]);
      if(distance<=.2&&(!best||distance<best.distance-EPS))best={i,j,distance};
    }
    if(!best)break;clusters[best.i]=[...clusters[best.i],...clusters[best.j]].sort((a,b)=>a-b);clusters.splice(best.j,1);
  }
  let suggested=0;
  for(const cluster of clusters.filter(cluster=>cluster.length>=2).sort((a,b)=>compare(shapes[a[0]].id,shapes[b[0]].id))){
    const toolIds=cluster.map(index=>shapes[index].id),base=`suggested-${hash(JSON.stringify(toolIds))}`;let id=base,suffix=2;while(usedIds.has(id))id=`${base}-${suffix++}`;usedIds.add(id);
    let distance=0;for(const a of cluster)for(const b of cluster)distance=Math.max(distance,distances[a][b]);
    for(const toolId of toolIds)claimed.add(toolId);
    sets.push({id,name:`Podobné nástroje ${++suggested}`,toolIds,layout:'auto',source:'suggested',confidence:Math.round((1-Math.min(1,distance/.25)*.4)*1000)/1000});
  }
  return{sets,unassigned:tools.filter(tool=>!claimed.has(tool.id)).map(tool=>tool.id).sort(compare)};
}

const sizeValue=tool=>getToolSize(tool)?.mm??Math.max(Math.max(...tool.points.map(p=>p.x))-Math.min(...tool.points.map(p=>p.x)),Math.max(...tool.points.map(p=>p.y))-Math.min(...tool.points.map(p=>p.y)));
function verticalRange(polygon,x){
  let lo=Infinity,hi=-Infinity;
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length];
    if(x<Math.min(a.x,b.x)-EPS||x>Math.max(a.x,b.x)+EPS)continue;
    if(Math.abs(a.x-b.x)<EPS){lo=Math.min(lo,a.y,b.y);hi=Math.max(hi,a.y,b.y);}
    else{const y=a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x);lo=Math.min(lo,y);hi=Math.max(hi,y);}
  }
  return{lo,hi};
}
/** Read rows from actual pockets. Compact rows may nest vertically, so bbox bottoms are not row identifiers. */
function sharedSequence(project,members){
  const items=members.map(tool=>{const polygon=pocketOutline(tool,project.clearance??.8);return{tool,polygon,left:Math.min(...polygon.map(p=>p.x)),right:Math.max(...polygon.map(p=>p.x)),before:new Set()};});
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
    const a=items[i],b=items[j],left=Math.max(a.left,b.left),right=Math.min(a.right,b.right);
    if(right-left<=.001)continue;
    const x=(left+right)/2,ar=verticalRange(a.polygon,x),br=verticalRange(b.polygon,x);
    if(ar.hi<=br.lo+.001)b.before.add(a);else if(br.hi<=ar.lo+.001)a.before.add(b);
  }
  const remaining=new Set(items),read=[];
  while(remaining.size){
    const row=[...remaining].filter(item=>![...item.before].some(other=>remaining.has(other))).sort((a,b)=>a.left-b.left||compare(a.tool.id,b.tool.id));
    if(!row.length)return null;
    read.push(...row.map(item=>item.tool));for(const item of row)remaining.delete(item);
  }
  return read;
}
function orderedMembers(project,set,members,own,shared,uniform){
  const order=['asc','desc'].includes(set.order)?set.order:set.arrangement?'asc':null;
  if(!order)return true;
  try{
    const physical=uniform?[...members].sort((a,b)=>{const am=own[members.indexOf(a)],bm=own[members.indexOf(b)];return am.y-bm.y||am.x-bm.x||compare(a.id,b.id);}):shared?sharedSequence(project,members):null;
    const expected=orderTools(members,order);
    return !!physical&&physical.length===expected.length&&physical.every((tool,index)=>Math.abs(sizeValue(tool)-sizeValue(expected[index]))<.000001);
  }catch{return false;}
}

/** Number of members in fully coherent sets, rather than partial pair rewards. Explicit preferences include physical size order. */
export function setCoherence(project,sets){
  const list=Array.isArray(sets)?sets:sets?.sets||[],tools=new Map((project?.tools||[]).map(tool=>[tool.id,tool])),modules=new Map((project?.modules||[]).map(module=>[module.id,module])),details=[],satisfied=[],unsatisfied=[];let score=0;
  const counts=new Map();for(const tool of tools.values())counts.set(tool.moduleId,(counts.get(tool.moduleId)||0)+1);
  const placed=module=>module&&['x','y','width','height'].every(key=>Number.isFinite(module[key]))&&module.width>0&&module.height>0&&module.x>=-.001&&module.y>=-.001&&module.x+module.width<=project.width+.001&&module.y+module.height<=project.height+.001;
  for(const set of list){
    const toolIds=[...new Set(set.toolIds||[])].filter(id=>tools.has(id)),members=toolIds.map(id=>tools.get(id)),own=members.map(tool=>modules.get(tool.moduleId));
    let headings=[],headingAligned=false;
    try{headings=members.map(tool=>{const rotation=Number(tool.rotation??0);if(!Number.isFinite(rotation))throw Error('Neplatné otočení.');return wrap(rotation-analyzeToolShape(tool).rotation);});const distance=heading=>Math.min(wrap(heading-headings[0]),wrap(headings[0]-heading));headingAligned=headings.length>0&&headings.every(heading=>distance(heading)<=2||((set.arrangement==='compact'||!set.arrangement&&set.layout!=='uniform')&&Math.abs(distance(heading)-180)<=2));}catch{}
    const allPlaced=members.length>0&&own.every(placed),shared=allPlaced&&own.every(module=>module.id===own[0].id)&&counts.get(own[0].id)===members.length,individual=allPlaced&&new Set(own.map(module=>module.id)).size===members.length&&own.every(module=>counts.get(module.id)===1),uniform=individual&&own.every(module=>Math.abs(module.width-own[0].width)<.001&&Math.abs(module.height-own[0].height)<.001);
    const orderAligned=orderedMembers(project,set,members,own,shared,individual),ok=headingAligned&&orderAligned&&(set.layout==='shared'?shared:set.layout==='uniform'?uniform:shared||individual);
    details.push({id:set.id,satisfied:ok,shared,uniform,headingAligned,orderAligned,toolIds,headings});(ok?satisfied:unsatisfied).push(set.id);if(ok)score+=toolIds.length;
  }
  return{score,satisfied,unsatisfied,details};
}
