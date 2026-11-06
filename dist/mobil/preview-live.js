// Live 3D view: workers prepare modules in parallel; the complete scene is revealed together.
import {createGLPreview} from './webgl-preview.js';
import {createMeshPool,meshKeys} from './mesh-client.js';
import {usesPrintParts} from './preview-mesh.js';
import {baseplateEntry,boundsFor,cutPreviewMarkup,labelNotes,modulePreviewWire,previewFrame,previewHud,sceneNotes,selectionPreviewMarkup,wirePath} from './preview3d.js';
import {materialConfig} from './print-material.js';
import {esc} from './ui.js';
import {t} from './i18n.js';
import {jointPreviewMarkup,NO_PREVIEW_JOINTS} from './preview-joints.js';

const BASEPLATE='__gridfinity-baseplate';
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
const hsl=(h,s,l)=>{const a=s*Math.min(l,1-l),f=n=>{const k=(n+h/30)%12;return l-a*Math.max(-1,Math.min(k-3,9-k,1));};return[f(0),f(8),f(4)];};
const COLORS={idle:hsl(88,.23,.62),active:hsl(39,.47,.62),baseplate:hsl(185,.13,.62),wire:rgb('#718d91')};
const localized=error=>error?.i18n?t(error.i18n.cs,error.i18n.params):error?.message||String(error);

function packBaseplate(entry){
  if(entry.faces.length){
    const vertices=new Float32Array(entry.faces.length*18);let cursor=0;
    for(const face of entry.faces)for(const point of face.points){vertices.set(point,cursor);vertices.set(face.normal,cursor+3);cursor+=6;}
    return{vertices,ranges:[{zone:'body',first:0,count:entry.faces.length*3}]};
  }
  const edges=entry.wireEdges||[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]],vertices=new Float32Array(edges.length*12);let cursor=0;
  for(const edge of edges)for(const index of edge){vertices.set(entry.wire[index],cursor);vertices.set([0,0,1],cursor+3);cursor+=6;}
  return{vertices,ranges:[{zone:'wire',first:0,count:edges.length*2}],lines:true};
}

export function createLivePreview({onChange,createCanvas=()=>document.createElement('canvas'),pool=null}={}){
  if(typeof Worker!=='function')return null;
  const canvas=createCanvas();canvas.className='board-gl';canvas.setAttribute('aria-hidden','true');
  const renderer=createGLPreview(canvas,{onStateChange:()=>onChange?.()});if(!renderer)return null;
  const meshes=pool||createMeshPool();
  const jointInfo=new Map();let scene=null,view=null;

  const finished=(id,key,error,result)=>{
    if(!scene||scene.keys.get(id)!==key||error?.cancelled)return;
    // Uploads can fail independently of the worker (for example when GPU memory is exhausted).
    // Settle that module and repaint the status even when no buffer could be created.
    if(!error)try{renderer.setMesh(id,result);}catch(cause){error=cause;}
    scene.pending.delete(id);
    if(error){scene.failed.set(id,localized(error));renderer.removeMesh(id);scene.shown.delete(id);scene.facets.delete(id);scene.parts.delete(id);scene.skipped.delete(id);scene.cuts.delete(id);scene.jointProfiles.delete(id);}
    else{
      scene.failed.delete(id);scene.shown.set(id,key);scene.facets.set(id,result.facets);
      scene.parts.set(id,result.parts);scene.skipped.set(id,result.skippedLabels||[]);scene.cuts.set(id,result.cuts||[]);scene.jointProfiles.set(id,result.jointProfiles||[]);if(jointInfo.size>32)jointInfo.clear();jointInfo.set(scene.projectKey,{joints:result.joints,unjoined:result.unjoined});
    }
    onChange?.();
  };
  const sync=project=>{
    const sharedLayout=usesPrintParts(project),{projectKey,modules:keys}=meshKeys(project,{sharedLayout});
    if(scene?.projectKey===projectKey)return;
    const snapshot=JSON.parse(JSON.stringify(project)),sourceModules=snapshot.modules||[],bounds=boundsFor(snapshot);
    const next={projectKey,project:snapshot,keys,pending:new Set(),failed:new Map(),shown:scene?.shown||new Map(),facets:scene?.facets||new Map(),parts:scene?.parts||new Map(),skipped:scene?.skipped||new Map(),cuts:scene?.cuts||new Map(),jointProfiles:scene?.jointProfiles||new Map(),wires:new Map(),warnings:sceneNotes(snapshot,{labels:false}),...bounds};
    next.reference=renderer.reference(bounds.reference);
    for(const id of renderer.ids())if(id!==BASEPLATE&&!keys.has(id)){renderer.removeMesh(id);next.shown.delete(id);next.facets.delete(id);next.parts.delete(id);next.skipped.delete(id);next.cuts.delete(id);next.jointProfiles.delete(id);}
    for(const module of sourceModules)next.wires.set(module.id,modulePreviewWire(snapshot,module));
    renderer.removeMesh(BASEPLATE);
    if(snapshot.bottomMode==='grid'){
      try{const {entry,warning}=baseplateEntry(snapshot);renderer.setMesh(BASEPLATE,packBaseplate(entry));if(warning)next.warnings.push(warning);}
      catch(error){next.warnings.push(t('Podkladovou mřížku nelze zobrazit: {error}',{error:error?.message||String(error)}));}
    }
    scene=next;
    meshes.keep('mesh',[...keys.values()]);
    meshes.keep('plan',sharedLayout?[projectKey]:[]);
    const order=[...sourceModules].sort((a,b)=>b.width*b.height-a.width*a.height);
    for(const module of order){
      const key=keys.get(module.id);
      if(next.shown.get(module.id)===key&&renderer.has(module.id))continue;
      next.pending.add(module.id);
    }
    const build=batch=>{
      if(scene!==next)return;
      for(const module of order){
        if(!next.pending.has(module.id))continue;
        const key=keys.get(module.id),options={projectKey,weight:module.width*module.height,...(sharedLayout?{batch}:{})};
        meshes.run('mesh',key,snapshot,module.id,options).then(result=>finished(module.id,key,null,result),error=>finished(module.id,key,error));
      }
    };
    // Every worker used to plan the same complete set of print joints before its
    // first mesh. Share one background plan, including its Maps, across all modules.
    if(sharedLayout&&next.pending.size)meshes.run('plan',projectKey,snapshot,null,{projectKey}).then(({batch})=>build(batch),error=>{
      if(scene!==next)return;
      for(const id of [...next.pending])finished(id,keys.get(id),error);
    });
    else build();
  };
  const status=()=>{
    const total=scene.keys.size,ready=[...scene.keys].filter(([id,key])=>scene.shown.get(id)===key&&renderer.has(id)).length,warnings=[...scene.warnings,...labelNotes(scene.project,[...scene.skipped.values()].flat())],unjoined=jointInfo.get(scene.projectKey)?.unjoined||0;
    if(unjoined)warnings.unshift(t('Na {n} vnitřních hranách mezi díly není bezpečné místo pro spojku. Podrobnosti jsou v assembly.json.',{n:unjoined}));
    if(scene.project.connectors&&scene.project.bottomMode!=='grid'&&total&&jointInfo.get(scene.projectKey)?.joints===0)warnings.unshift(t(NO_PREVIEW_JOINTS));
    // Put blocking errors first so label notes cannot hide why the mesh is missing.
    const errors=[...scene.failed].map(([id,message])=>`${scene.project.modules.find(item=>item.id===id)?.name||t('Modul')}: ${message}`);
    warnings.unshift(...errors);
    return{total,ready,warnings,errors};
  };
  return{
    canvas,
    retry(){scene=null;},
    get broken(){return meshes.broken||renderer.failed;},
    render(project,{activeIds,camera,viewport,refresh=true}){
      if(refresh||!scene)sync(project);
      const frame=previewFrame(scene.fitSize,camera,viewport),colors=materialConfig(project),zones={body:rgb(colors.bodyColor),floor:rgb(colors.floorColor),text:rgb(colors.textColor)};
      const color=(id,zone)=>{
        if(id===BASEPLATE)return zone==='wire'?COLORS.wire:COLORS.baseplate;
        const active=activeIds.has(id);
        return colors.enabled?zones[zone]:active?COLORS.active:COLORS.idle;
      };
      view={center:scene.center,right:frame.right,down:frame.down,towards:frame.towards,bounds:frame.viewBounds,fitSize:scene.fitSize,viewport:frame.size,reference:scene.reference,color};
      renderer.draw(view);
      const projectPoint=frame.project(scene.center),{total,ready,warnings,errors}=status();let html='';
      for(const [id,wire] of scene.wires){
        const failed=scene.failed.has(id);if(!failed&&renderer.has(id))continue;
        const name=scene.project.modules.find(item=>item.id===id)?.name||t('Modul'),active=activeIds.has(id),stroke=failed?active?'#bf8d35':'#b56c52':'#8fa07d';
        html+=`<g data-module="${esc(id)}"${failed?' data-invalid-module="true"':' data-pending-module="true"'} role="button" tabindex="0" aria-label="${esc(name)}${failed?' — neplatný modul':''}" data-module-selected="${active}"><path d="${wirePath(wire,projectPoint)}" fill="none" stroke="${stroke}" stroke-width="1.2" stroke-dasharray="5 3" vector-effect="non-scaling-stroke"/></g>`;
      }
      if(colors.enabled)for(const [id,wire] of scene.wires)if(activeIds.has(id)&&renderer.has(id))html+=selectionPreviewMarkup(wire,frame,scene.center);
      if(project.previewCuts)for(const [id,cuts] of scene.cuts)if(scene.shown.get(id)===scene.keys.get(id))html+=cutPreviewMarkup(cuts,frame,scene.center);
      html+=jointPreviewMarkup([...scene.jointProfiles].filter(([id])=>scene.shown.get(id)===scene.keys.get(id)).flatMap(([,profiles])=>profiles),frame,scene.center);
      const facets=[...scene.keys.keys()].reduce((sum,id)=>sum+(scene.facets.get(id)||0),0);
      html+=previewHud(scene.project,frame,[]);
      const busy=ready<total-scene.failed.size,notice=busy?t('Připravuji 3D model: {ready} z {total} modulů',{ready,total}):(errors.length?errors:warnings).join(' ');
      return{html,notice,busy,viewBox:frame.viewBox,camera:frame.state,frame:{width:frame.width,height:frame.height,fitSize:scene.fitSize,center:[...scene.center],viewport:frame.size},warnings,stats:{triangles:facets,ready,total,failed:scene.failed.size,joints:jointInfo.get(scene.projectKey)?.joints||0}};
    },
    pick(x,y,rect){
      if(!view)return null;
      const id=renderer.pick(x-rect.left,y-rect.top,view);
      return id===BASEPLATE?null:id;
    }
  };
}
