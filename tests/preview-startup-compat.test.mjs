import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import * as preview from '../dist/preview3d.js';
import * as overlays from '../dist/preview-overlays.js';
import {createLivePreview} from '../dist/preview-live.js';
import {blankProject} from '../dist/model.js';
import {moduleMesh,previewBatch} from '../dist/preview-mesh.js';

test('the existing preview3d overlay exports retain the shared implementation',()=>{
  for(const name of ['wirePath','cutPreviewMarkup','selectionPreviewMarkup'])assert.equal(preview[name],overlays[name]);
});

test('the live preview starts with the older cached preview3d export contract and keeps cuts and selection',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'insertcreator-preview-compat-'));
  const previous=globalThis.Worker;globalThis.Worker=function(){};
  try{
    // These are the public exports from preview3d before commit 0ca64ff. A
    // cached copy has wirePath but neither of the two newer overlay exports.
    // Re-export the old contract instead of depending on Git history in CI.
    const oldExports=['PREVIEW_BUDGET','previewGeometryKey','createCamera3D','normalizeCamera3D','modulePreviewWire','boundsFor','labelNotes','sceneNotes','baseplateEntry','previewFrame','wirePath','previewHud','printPreview'];
    const legacy=path.join(directory,'cached-preview3d.mjs');
    fs.writeFileSync(legacy,`export {${oldExports.join(',')}} from ${JSON.stringify(new URL('../dist/preview3d.js',import.meta.url).href)};\n`);
    const cached=await import(pathToFileURL(legacy).href);
    assert.equal('cutPreviewMarkup' in cached,false);
    assert.equal('selectionPreviewMarkup' in cached,false);
    const source=fs.readFileSync(new URL('../dist/preview-live.js',import.meta.url),'utf8');
    // Use the production live module and real dependencies, changing only the
    // preview3d response as if the browser had retained its older HTTP cache.
    const isolated=source.replace(/from (['"])(\.\/[^'"]+)\1/g,(_match,_quote,spec)=>{
      const url=spec==='./preview3d.js'?pathToFileURL(legacy):new URL('../dist/'+spec.slice(2),import.meta.url);
      return 'from '+JSON.stringify(url.href);
    });
    const entry=path.join(directory,'live-with-cached-renderer.mjs');
    fs.writeFileSync(entry,isolated);
    const compatible=await import(pathToFileURL(entry).href);
    const project={...blankProject(),width:420,height:252,previewCuts:true,bedWidth:100,bedHeight:100,
      multiMaterial:{enabled:true,floor:false,text:false,bodyColor:'#ff0000'},
      modules:[{id:'m',name:'Wide module',x:42,y:42,width:168,height:84}],tools:[]};
    const options={activeIds:new Set(['m']),camera:{},viewport:{width:600,height:400}};
    const render=async factory=>{
      const gl=new Proxy({},{get:(_,name)=>name==='getShaderParameter'||name==='getProgramParameter'?()=>true:typeof name==='string'&&/^[A-Z0-9_]+$/.test(name)?1:()=>({})});
      const canvas={width:1,height:1,setAttribute(){},addEventListener(){},getContext:()=>gl};
      const pool={keep(){},broken:null,run(type,key,source,moduleId){const batch=previewBatch(source);return Promise.resolve(type==='plan'?{batch}:moduleMesh(source,moduleId,batch));}};
      const live=factory({createCanvas:()=>canvas,pool});assert.ok(live);
      live.render(project,options);await new Promise(resolve=>setTimeout(resolve,0));
      return live.render(project,options);
    };
    const actual=await render(compatible.createLivePreview),expected=await render(createLivePreview);
    assert.equal(actual.stats.ready,1);assert.equal(actual.stats.failed,0);
    assert.match(actual.html,/data-preview-cuts="true"/);
    assert.match(actual.html,/data-preview-selection="true"/);
    assert.equal(actual.html,expected.html,'a cached older renderer cannot change the projected overlays');
    assert.deepEqual(actual.stats,expected.stats);
  }finally{
    if(previous===undefined)delete globalThis.Worker;else globalThis.Worker=previous;
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('insertcreator-preview-compat-'));
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
