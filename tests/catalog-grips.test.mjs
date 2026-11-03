import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {catalogItems,catalogSets} from '../dist/catalog/index.js';
import {catalogTool,mountLibraryFolders,setCatalogSource} from '../dist/catalog-ui.js';
import {automaticFingerGrips,pocketOutline} from '../dist/finger-grip.js';
import {blankProject,validateProject} from '../dist/model.js';
import {getLang,setLang} from '../dist/i18n.js';

const size=points=>({width:Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),height:Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))});

test('every real catalogue outline receives the common connected automatic bays without modifying the source',()=>{
  for(const item of catalogItems()){
    const before=structuredClone(item),tool=catalogTool(item);
    assert.deepEqual(tool.fingerGrips,automaticFingerGrips({...tool,id:item.id}),item.id);
    assert.equal(tool.fingerGrips.length,2,item.id);assert.ok(tool.fingerGrips.every(g=>g.radius===9),item.id);
    const restored=validateProject({...blankProject(),tools:[{...tool,id:item.id}]}).tools[0];
    assert.ok(pocketOutline(restored,0).length>3,item.id);assert.deepEqual(item,before,item.id);
  }
});

test('catalogue screwdrivers place bays at their narrow central shaft and avoid excess width around the handle',()=>{
  for(const id of ['screwdriver-slotted-2-5x75','screwdriver-ph2x100']){
    const item=catalogItems().find(item=>item.id===id),tool=catalogTool(item),raw=size(tool.points),pocket=size(pocketOutline(tool,.8));
    const station=tool.fingerGrips[0].x/raw.width;
    assert.ok(station>.5&&station<=.65,id+' must use the nearby shaft');
    assert.ok(pocket.height<=raw.height+1.61,id+' bays must fit within the existing handle footprint plus clearance');
  }
});

test('catalogue conversion preserves explicitly supplied manual bays and explicit deletion',()=>{
  const item=catalogItems().find(item=>item.id==='combination-wrench-13mm'),automatic=catalogTool(item);
  for(const fingerGrips of [[],automatic.fingerGrips.map((grip,index)=>({...grip,id:'custom-'+index,radius:7}))]){
    const source={...item,fingerGrips},before=structuredClone(source),tool=catalogTool(source);
    assert.deepEqual(tool.fingerGrips,fingerGrips);assert.notEqual(tool.fingerGrips,fingerGrips);assert.deepEqual(source,before);
    const restored=validateProject({...blankProject(),tools:[{...tool,id:'restored'}]}).tools[0];assert.deepEqual(restored.fingerGrips,fingerGrips);
  }
});

test('each-tool catalogue storage requests individual automatic modules in both direct and batch add flows',async()=>{
  const win=new Window({url:'http://localhost:5173'}),oldDocument=globalThis.document,oldWindow=globalThis.window,oldLang=getLang();
  const set=catalogSets().find(set=>set.id==='combination-wrench-set-8-19mm'),items=set.tools,added=[];
  globalThis.window=win;globalThis.document=win.document;setLang('cs',{save:false});
  setCatalogSource(async()=>({categories:[{id:'wrenches',cs:'Klíče',en:'Wrenches'}],items,sets:[set]}));
  try{
    win.document.body.innerHTML='<main></main><footer></footer>';
    const body=win.document.querySelector('main'),footer=win.document.querySelector('footer');
    mountLibraryFolders({body,footer},{mine:()=>({body:'',footer:''}),onAdd:(tools,opts)=>added.push({tools,opts}),onSave:()=>0});
    body.querySelector('[data-library-folder="catalog"]').click();
    for(let attempt=0;attempt<30&&!body.querySelector('[data-set-layout]');attempt++)await new Promise(resolve=>setTimeout(resolve,5));
    const layout=body.querySelector('[data-set-layout]');assert.ok(layout);layout.value='each';layout.dispatchEvent(new win.Event('change',{bubbles:true}));
    body.querySelector('[data-set-add]').click();
    assert.equal(added.at(-1).opts.set.layout,'auto');assert.equal(added.at(-1).opts.group,undefined);assert.equal(added.at(-1).tools.length,items.length);
    const selected=body.querySelector('[data-catalog-select-set]');selected.checked=true;selected.dispatchEvent(new win.Event('change',{bubbles:true}));
    footer.querySelector('[data-catalog-add-selected]').click();
    assert.equal(added.at(-1).opts.collections[0].layout,'auto');assert.equal(added.at(-1).opts.collections[0].count,items.length);
    layout.value='group';layout.dispatchEvent(new win.Event('change',{bubbles:true}));body.querySelector('[data-set-add]').click();
    assert.equal(added.at(-1).opts.set.layout,'shared');assert.ok(added.at(-1).opts.group,'a grouped set remains an explicit shared choice');
  }finally{setCatalogSource(null);setLang(oldLang,{save:false});globalThis.document=oldDocument;globalThis.window=oldWindow;win.happyDOM.cancelAsync();}
});
