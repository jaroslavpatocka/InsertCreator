import Clipper from './vendor/clipper.js';
import {bounds,validateLayout,LAYOUT_PAIR_LIMIT} from './geometry.js';
import {pocketLayoutOutline} from './pocket-wall.js';
import {containsPocketWalls,moduleIntersects,modulePadding} from './module-footprint.js';
import {clone} from './model.js';
import {i18nError} from './i18n.js';

const EPS=1e-7,SCALE=10000;
const extent=points=>{
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const p of points){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
  return{minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};
};
const failure=()=>i18nError('Nástroje se s tímto přídavkem nevejdou. Zvětšete šuplík nebo uvolněte místo kolem modulu.');
const issueError=issue=>Object.assign(Error(issue.message),{i18n:issue.i18n});

/** Spread contour centres as one similarity of their arrangement, never scale the tools.
 * Already safe positions are returned exactly. Rounded half-wall envelopes include
 * finger access; integer intersections keep the search independent of contour size. */
export function spacePocketCenters(project,tools){
  if(tools.length<2)return tools.map(tool=>({...tool}));
  // The production validator is the oracle for an already safe arrangement.
  // Give unassigned photo tools one temporary module for the internal-wall check.
  const moduleId=tools[0].moduleId||'pocket-growth-preview',ids=new Set(tools.map(tool=>tool.id));
  const checkTools=tools.map(tool=>({...tool,moduleId}));
  const issues=validateLayout({...project,modules:project.modules.filter(module=>module.id===moduleId),tools:checkTools});
  const incomplete=issues.find(issue=>issue.code==='layout-complexity');
  // Too many diagnostics can hide an overlap in a modest photo group. Let the
  // existing exact spacing search repair it, bounded to at most 20k pairs and
  // 24 bisections. A work/point/topology limit must never enter that repair loop.
  if(incomplete&&(incomplete.limitKind!=='issues'||tools.length*(tools.length-1)/2>LAYOUT_PAIR_LIMIT))throw issueError(incomplete);
  const pairIssue=!!incomplete||issues.some(issue=>issue.type==='overlap'&&issue.ids.length===2&&issue.ids.every(id=>ids.has(id)));
  if(!pairIssue)return tools.map(tool=>({...tool}));
  const entries=tools.map(tool=>{
    const b=bounds(tool),cx=b.x+b.width/2,cy=b.y+b.height/2;
    const path=pocketLayoutOutline(tool,project).map(p=>({X:Math.round((p.x-cx)*SCALE),Y:Math.round((p.y-cy)*SCALE)}));
    if(!Clipper.Clipper.Orientation(path))path.reverse();
    const offset=new Clipper.ClipperOffset(2,.002*SCALE),grown=[];
    offset.AddPath(path,Clipper.JoinType.jtRound,Clipper.EndType.etClosedPolygon);
    offset.Execute(grown,(Number(project.wall)/2+.005)*SCALE);
    if(!grown.length)throw failure();
    return{tool,cx,cy,paths:grown,box:extent(grown.flat().map(p=>({x:p.X/SCALE,y:p.Y/SCALE})))};
  });
  const anchor=entries[0];
  const positioned=factor=>entries.map(entry=>{
    const dx=(entry.cx-anchor.cx)*factor,dy=(entry.cy-anchor.cy)*factor;
    return{...entry,dx,dy};
  });
  function safe(factor){
    const placed=positioned(factor);
    for(let i=0;i<placed.length;i++)for(let j=i+1;j<placed.length;j++){
      const a=placed[i],b=placed[j],x=b.dx-a.dx,y=b.dy-a.dy;
      if(a.box.maxX<=b.box.minX+x||b.box.maxX+x<=a.box.minX||a.box.maxY<=b.box.minY+y||b.box.maxY+y<=a.box.minY)continue;
      const engine=new Clipper.Clipper(),intersection=[];
      engine.AddPaths(a.paths,Clipper.PolyType.ptSubject,true);
      engine.AddPaths(b.paths.map(path=>path.map(p=>({X:p.X+Math.round(x*SCALE),Y:p.Y+Math.round(y*SCALE)}))),Clipper.PolyType.ptClip,true);
      engine.Execute(Clipper.ClipType.ctIntersection,intersection,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero);
      if(intersection.some(path=>Math.abs(Clipper.Clipper.Area(path))>1))return false;
    }
    return true;
  }
  if(safe(1))return tools.map(tool=>({...tool}));
  let upper=1;
  for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
    const a=entries[i],b=entries[j],dx=b.cx-a.cx,dy=b.cy-a.cy;
    const x=Math.abs(dx)>EPS?(dx>0?a.box.maxX-b.box.minX:b.box.maxX-a.box.minX)/Math.abs(dx):Infinity;
    const y=Math.abs(dy)>EPS?(dy>0?a.box.maxY-b.box.minY:b.box.maxY-a.box.minY)/Math.abs(dy):Infinity;
    const separation=Math.min(x,y);
    if(!Number.isFinite(separation))throw failure();
    upper=Math.max(upper,separation+.001);
  }
  if(!safe(upper))throw failure();
  let lower=1;
  for(let iteration=0;iteration<24;iteration++){
    const middle=(lower+upper)/2;if(safe(middle))upper=middle;else lower=middle;
  }
  // A small extra separation avoids integer clipping rounding back to contact.
  const factor=upper+1e-5;
  return entries.map(({tool,cx,cy})=>({...tool,x:tool.x+(cx-anchor.cx)*(factor-1),y:tool.y+(cy-anchor.cy)*(factor-1)}));
}

/** Grow just the edited module. Keep exact positions whenever safe; if pockets
 * touch, increase centre spacing uniformly. All other modules remain untouched. */
export function growModuleForMargins(project,moduleId){
  const next=clone(project),module=next.modules.find(item=>item.id===moduleId);
  if(!module)throw i18nError('Vybraný modul neexistuje.');
  const own=next.tools.filter(tool=>tool.moduleId===moduleId);
  if(module.locked)throw i18nError('Nejprve odemkněte polohu modulu.');
  if(!own.length)return next;
  const reservesFit=tools=>next.connectors!==true||next.bottomMode==='grid'||tools.every(tool=>{
    const pocket=pocketLayoutOutline(tool,next),padding=modulePadding(next);
    if(module.cells)return containsPocketWalls(module,pocket,padding-.25,next.grid);
    return pocket.every(p=>p.x>=module.x+padding-EPS&&p.y>=module.y+padding-EPS&&
      p.x<=module.x+module.width-padding+EPS&&p.y<=module.y+module.height-padding+EPS);
  });
  const isolated={...next,width:Math.max(next.width,module.x+module.width),height:Math.max(next.height,module.y+module.height),modules:[module],tools:own};
  if(!validateLayout(isolated).length&&reservesFit(own))return next;
  if(own.some(tool=>tool.locked))throw i18nError('Nejprve odemkněte polohu modulu.');
  const spaced=spacePocketCenters(next,own),content=extent(spaced.flatMap(tool=>pocketLayoutOutline(tool,next))),padding=modulePadding(next),grid=next.grid;
  // A stepped module may already have enough room once its centres are spread.
  // Keep its notch, especially when another module occupies that empty corner.
  if(!validateLayout({...isolated,tools:spaced}).length&&reservesFit(spaced)){
    const byId=new Map(spaced.map(tool=>[tool.id,tool]));
    next.tools=next.tools.map(tool=>byId.get(tool.id)||tool);return next;
  }
  const width=Math.max(module.width,Math.ceil((content.width+2*padding-EPS)/grid)*grid);
  const height=Math.max(module.height,Math.ceil((content.height+2*padding-EPS)/grid)*grid);
  if(width>3000||height>3000||!Number.isFinite(width+height))throw failure();
  const parked=module.x+module.width>next.width+EPS||module.y+module.height>next.height+EPS;
  // Expand towards free space around the original module. Trying every possible
  // left/up extension also handles modules against the drawer's right/bottom edge.
  const axis=(origin,oldSize,size,limit)=>{
    const values=[origin];
    for(let shift=grid;shift<=size-oldSize+EPS;shift+=grid)values.push(origin-shift);
    const edge=Math.floor(origin/grid)*grid;if(!values.some(value=>Math.abs(value-edge)<EPS))values.push(edge);
    return values.filter(value=>value>=-EPS&&(parked||value+size<=limit+EPS));
  };
  const xs=axis(module.x,module.width,width,next.width),ys=axis(module.y,module.height,height,next.height);
  for(const y of ys)for(const x of xs){
    const candidate={...module,x,y,width,height};delete candidate.shape;delete candidate.cells;
    if(next.modules.some(other=>other.id!==moduleId&&moduleIntersects(candidate,other,grid)))continue;
    const dx=Math.max(x+padding-content.minX,Math.min(0,x+width-padding-content.maxX));
    const dy=Math.max(y+padding-content.minY,Math.min(0,y+height-padding-content.maxY));
    const moved=spaced.map(tool=>({...tool,x:tool.x+dx,y:tool.y+dy}));
    const issue=validateLayout({...next,width:Math.max(next.width,x+width),height:Math.max(next.height,y+height),modules:[candidate],tools:moved})[0];
    if(issue){if(issue.type!=='outside'&&issue.ids.length<2)throw issueError(issue);continue;}
    Object.assign(module,candidate);delete module.shape;delete module.cells;
    const byId=new Map(moved.map(tool=>[tool.id,tool]));next.tools=next.tools.map(tool=>byId.get(tool.id)||tool);
    return next;
  }
  throw failure();
}
