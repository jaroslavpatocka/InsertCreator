// Custom pockets use the ordinary module/tool model, so every preview and export shares one outline.
import {clone,uid,validateProject} from './model.js';
import {bounds,validateLayout} from './geometry.js';
import {moduleIntersects,modulePadding} from './module-footprint.js';
import {maxPocketDepth} from './print-material.js';
import {effectivePocketMargin} from './pocket-margin.js';
import {normalizePocketWall,validatePocketWall,pocketLayoutOutline,pocketFloorOutlines} from './pocket-wall.js';
import {i18nError,t} from './i18n.js';

const EPS=1e-7;
const value=(options,key,fallback)=>options[key]===undefined?fallback:options[key];
const fail=message=>{throw i18nError(message);};
const number=(value,min,max)=>{
  if(value===null||value===''||typeof value==='boolean'||!Number.isFinite(Number(value))||Number(value)<min||Number(value)>max)
    fail('Zadejte platné rozměry vlastního modulu a kapsy.');
  return Number(value);
};
const text=(value,fallback,max=100)=>String(value??fallback).replace(/[\u0000-\u001f\u007f-\u009f]/g,'').trim().slice(0,max);
const area=points=>points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a.x*b.y-b.x*a.y;},0)/2;
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const on=(p,a,b)=>Math.abs(cross(a,b,p))<EPS&&p.x>=Math.min(a.x,b.x)-EPS&&p.x<=Math.max(a.x,b.x)+EPS&&p.y>=Math.min(a.y,b.y)-EPS&&p.y<=Math.max(a.y,b.y)+EPS;
function intersects(a,b,c,d){
  const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
  return ((abC>EPS&&abD< -EPS)||(abC< -EPS&&abD>EPS))&&((cdA>EPS&&cdB< -EPS)||(cdA< -EPS&&cdB>EPS))||on(c,a,b)||on(d,a,b)||on(a,c,d)||on(b,c,d);
}
function extent(points){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const point of points){minX=Math.min(minX,point.x);minY=Math.min(minY,point.y);maxX=Math.max(maxX,point.x);maxY=Math.max(maxY,point.y);}
  return{minX,minY,width:maxX-minX,height:maxY-minY};
}
function simplePolygon(points){
  if(points.length<3||points.length>6000||Math.abs(area(points))<.00001)fail('Vlastní tvar musí mít alespoň tři body a platnou plochu.');
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    if(Math.hypot(a.x-b.x,a.y-b.y)<.00001)fail('Body vlastního tvaru nesmí ležet na sobě.');
    const previous=points[(i+points.length-1)%points.length];
    if(Math.abs(cross(previous,a,b))<EPS&&(previous.x-a.x)*(b.x-a.x)+(previous.y-a.y)*(b.y-a.y)>EPS)
      fail('Hrany vlastního tvaru se nesmí křížit ani překrývat.');
    for(let j=i+2;j<points.length;j++){
      if(i===0&&j===points.length-1)continue;
      if(intersects(a,b,points[j],points[(j+1)%points.length]))fail('Hrany vlastního tvaru se nesmí křížit ani překrývat.');
    }
  }
  return points;
}

/** Local millimetre polygon. Arbitrary points are authoritative; the editor scales them explicitly. */
export function customPocketPoints(options={}){
  const shape=value(options,'shape','rounded-rect'),width=number(value(options,'pocketWidth',60),.1,3000),height=number(value(options,'pocketHeight',60),.1,3000);
  if(shape==='rectangle')return[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
  if(shape==='ellipse')return Array.from({length:96},(_,i)=>{const a=i*Math.PI/48;return{x:width/2+width/2*Math.cos(a),y:height/2+height/2*Math.sin(a)};});
  if(shape==='rounded-rect'||shape==='rounded-rectangle'){
    const radius=number(value(options,'cornerRadius',Math.min(6,width/2,height/2)),0,Math.min(width,height)/2);
    if(!radius)return customPocketPoints({...options,shape:'rectangle'});
    const points=[];
    for(const [x,y,start]of [[width-radius,radius,-90],[width-radius,height-radius,0],[radius,height-radius,90],[radius,radius,180]])
      for(let i=0;i<=12;i++){const a=(start+i*7.5)*Math.PI/180;const point={x:x+radius*Math.cos(a),y:y+radius*Math.sin(a)};if(!points.length||Math.hypot(point.x-points.at(-1).x,point.y-points.at(-1).y)>EPS)points.push(point);}
    if(Math.hypot(points[0].x-points.at(-1).x,points[0].y-points.at(-1).y)<EPS)points.pop();
    return simplePolygon(points);
  }
  if(shape!=='polygon'||!Array.isArray(options.points))fail('Vyberte platný tvar vlastní kapsy.');
  if(options.points.length>6000)fail('Kontura musí mít 3 až 6000 bodů.');
  const source=options.points.map(point=>({x:number(point?.x,-3000,3000),y:number(point?.y,-3000,3000)})),box=extent(source);
  if(box.width<.1||box.height<.1)fail('Vlastní tvar musí mít alespoň tři body a platnou plochu.');
  return simplePolygon(source);
}

export function isCustomModule(project,moduleId){
  const own=(project.tools??[]).filter(tool=>tool.moduleId===moduleId);
  return own.length===1&&own[0].customPocket===true;
}
function source(project,moduleId){
  const module=project.modules.find(item=>item.id===moduleId),own=project.tools.filter(tool=>tool.moduleId===moduleId);
  if(!module||own.length!==1||own[0].customPocket!==true)fail('Vybraný modul neobsahuje jednu vlastní univerzální kapsu.');
  return{module,tool:own[0]};
}
const samePoints=(a,b)=>a.length===b.length&&a.every((point,i)=>Math.abs(point.x-b[i].x)<EPS&&Math.abs(point.y-b[i].y)<EPS);
/** Read persisted standard geometry, including edits performed by the normal contour tools. */
export function customModuleOptions(project,moduleId){
  const {module,tool}=source(project,moduleId),box=extent(tool.points),points=tool.points.map(p=>({x:p.x-box.minX,y:p.y-box.minY}));
  const options={name:module.name,pocketName:tool.name,label:tool.sizeLabel??'',width:module.width,height:module.height,pocketWidth:box.width,pocketHeight:box.height,depth:tool.depth,pocketMargin:effectivePocketMargin(tool,project),pocketWall:normalizePocketWall(tool.pocketWall),shape:'polygon',points};
  for(const shape of ['rectangle','ellipse','rounded-rect']){
    const cornerRadius=shape==='rounded-rect'?box.width-points[0]?.x:0;
    try{if(samePoints(points,customPocketPoints({...options,shape,cornerRadius}))){options.shape=shape;options.cornerRadius=cornerRadius;break;}}catch{}
  }
  return options;
}
function settings(project,options){
  const width=number(value(options,'width',84),5,3000),height=number(value(options,'height',84),5,3000),raw=customPocketPoints(options),box=extent(raw),points=raw.map(p=>({x:p.x-box.minX,y:p.y-box.minY}));
  const pocketMargin=number(value(options,'pocketMargin',value(options,'clearance',0)),0,10),depth=number(value(options,'depth',Math.min(12,maxPocketDepth(project))),.5,99);
  const pocketWall=validatePocketWall(value(options,'pocketWall',null),depth);
  if(depth>maxPocketDepth(project)+EPS)fail('Hloubka vlastní kapsy přesahuje dostupnou výšku inzertu.');
  if(project.bottomMode==='grid'&&[project.grid,width,height].some((value,i)=>i===0?Math.abs(value-42)>EPS:Math.abs(value/42-Math.round(value/42))>EPS))
    fail('Rozměry i poloha modulu musí být v násobcích 42 mm pro Gridfinity patky.');
  return{width,height,points,pocketMargin,pocketWall,depth,name:text(options.name,t('Vlastní modul'))||t('Vlastní modul'),pocketName:text(options.pocketName,t('Univerzální kapsa'))||t('Univerzální kapsa'),label:text(options.label,'',24)};
}
function checked(project,module,tool,{allowOutside=false}={}){
  validateProject(project);
  if(tool.depth>maxPocketDepth(project,tool)+EPS)fail('Hloubka vlastní kapsy přesahuje dostupnou výšku inzertu.');
  validatePocketWall(tool.pocketWall,tool.depth);
  const polygon=pocketLayoutOutline(tool,project),padding=modulePadding(project);
  pocketFloorOutlines(tool,project);
  if(polygon.some(p=>p.x<module.x+padding-.001||p.y<module.y+padding-.001||p.x>module.x+module.width-padding+.001||p.y>module.y+module.height-padding+.001))
    fail('Kolem vlastní kapsy není dost místa na stěnu. Zvětšete modul nebo zmenšete kapsu.');
  for(const issue of validateLayout(project,{affectedIds:[module.id]})){
    if(allowOutside&&issue.type==='outside'&&issue.ids.length===1&&issue.ids[0]===module.id)continue;
    throw Object.assign(Error(issue.message),{i18n:issue.i18n});
  }
  return project;
}
function centerTool(module,tool){const box=bounds(tool);tool.x=module.x+(module.width-box.width)/2;tool.y=module.y+(module.height-box.height)/2;}

/** Add one module without moving its neighbours. A full drawer parks it intact beside the drawer. */
export function createCustomModule(project,options={}){
  validateProject(project);
  if(project.modules.length>=4000||project.tools.length>=3000)fail('Projekt je příliš velký. Limit je 3000 nástrojů a 4000 modulů.');
  const config=settings(project,options),next=clone(project),moduleId=uid(),toolId=uid();
  const module={id:moduleId,name:config.name,x:0,y:0,width:config.width,height:config.height,locked:false,sizeMode:'manual',grouped:true,pocketMargin:config.pocketMargin};
  const tool={id:toolId,name:config.pocketName,customPocket:true,moduleId,points:config.points,x:0,y:0,rotation:0,depth:config.depth,pocketMargin:config.pocketMargin,sizeLabel:config.label,locked:false,...(config.pocketWall?{pocketWall:config.pocketWall}:{})};
  centerTool(module,tool);
  // Validate the geometry in isolation before looking for a place in an unfinished project.
  checked({...next,width:Math.max(next.width,module.width),height:Math.max(next.height,module.height),modules:[module],tools:[tool]},module,tool);
  const grid=Number(next.grid);let spot=null;
  for(let y=0;y+module.height<=next.height+EPS&&!spot;y+=grid)for(let x=0;x+module.width<=next.width+EPS;x+=grid){
    if(!next.modules.some(existing=>moduleIntersects({...module,x,y},existing,grid))){spot={x,y};break;}
  }
  const placed=!!spot;
  if(!spot){
    const x=Math.ceil(next.width/grid)*grid+grid;
    for(let y=0;y<=4000;y+=grid)if(!next.modules.some(existing=>moduleIntersects({...module,x,y},existing,grid))){spot={x,y};break;}
    if(!spot)fail('Vedle šuplíku už není místo pro další vlastní modul.');
  }
  Object.assign(module,spot);centerTool(module,tool);next.modules.push(module);next.tools.push(tool);
  if(config.label)next.sizeLabels=true;
  checked(next,module,tool,{allowOutside:!placed});
  return{project:next,moduleId,toolId,placed};
}

/** Atomically edit the same module and pocket. Keep its placement, rotation and attached features. */
export function updateCustomModule(project,moduleId,options={}){
  validateProject(project);
  const original=source(project,moduleId);
  if(original.module.locked||original.tool.locked)fail('Nejprve odemkněte polohu modulu.');
  const config=settings(project,{...customModuleOptions(project,moduleId),...options}),next=clone(project),{module,tool}=source(next,moduleId);
  const oldBox=bounds(tool),cx=oldBox.x+oldBox.width/2+(config.width-module.width)/2,cy=oldBox.y+oldBox.height/2+(config.height-module.height)/2;
  Object.assign(module,{name:config.name,width:config.width,height:config.height,pocketMargin:config.pocketMargin,sizeMode:'manual',grouped:true});
  Object.assign(tool,{name:config.pocketName,points:config.points,depth:config.depth,pocketMargin:config.pocketMargin,sizeLabel:config.label});
  if(config.pocketWall)tool.pocketWall=config.pocketWall;else delete tool.pocketWall;
  const newBox=bounds(tool),x=cx-newBox.width/2,y=cy-newBox.height/2;
  // Reopening and saving a rotated shape must not create history for floating point roundoff.
  if(Math.abs(x-tool.x)>=EPS)tool.x=x;
  if(Math.abs(y-tool.y)>=EPS)tool.y=y;
  if(config.label&&config.label!==(original.tool.sizeLabel??''))next.sizeLabels=true;
  const placed=module.x+module.width<=next.width+EPS&&module.y+module.height<=next.height+EPS;
  // Existing parked modules may be edited in place; an edit never newly parks a previously placed one.
  const wasOutside=original.module.x+original.module.width>project.width+EPS||original.module.y+original.module.height>project.height+EPS;
  checked(next,module,tool,{allowOutside:wasOutside});
  return{project:next,moduleId,toolId:tool.id,placed};
}
