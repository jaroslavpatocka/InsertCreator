import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';

const win=new Window({url:'http://localhost:5173'});
globalThis.window=win;globalThis.document=win.document;globalThis.localStorage=win.localStorage;
const {mountLibraryFolders,setCatalogSource}=await import('../dist/catalog-ui.js');
const {setLang}=await import('../dist/i18n.js');
setLang('cs',{save:false});
const item={id:'key',name:'Klíč',category:'wrenches',points:[{x:0,y:0},{x:80,y:0},{x:80,y:20},{x:0,y:20}],depth:8,unit:'mm'};
const catalog={items:[item],categories:[{id:'wrenches',cs:'Klíče',en:'Wrenches'}]};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const waitFor=async fn=>{const start=Date.now();while(!fn()){assert.ok(Date.now()-start<2000,'catalogue UI settles');await new Promise(resolve=>setTimeout(resolve,2));}};
const mount=({source=()=>catalog,onAdd=()=>{},onSave=()=>1}={})=>{
  document.body.innerHTML='<main></main><footer></footer><div id="toast"></div>';
  setCatalogSource(source);
  const body=document.querySelector('main'),footer=document.querySelector('footer');
  mountLibraryFolders({body,footer},{mine:()=>({tools:[],card:()=>'',empty:'Moje vlastní nástroje',footer:''}),onAdd,onSave});
  const tab=folder=>body.querySelector(`[data-library-folder="${folder}"]`);
  tab('catalog').click();
  return{body,footer,tab,panel:body.querySelector('#library-panel')};
};
const select=async view=>{await waitFor(()=>view.body.querySelector('[data-catalog-add]'));return view.body.querySelector('[data-catalog-add]');};
const frames=[];
globalThis.requestAnimationFrame=callback=>{frames.push(callback);return frames.length;};
const paint=async()=>{assert.ok(frames.length,'work waits for a frame');frames.shift()(Date.now());await new Promise(resolve=>setTimeout(resolve,2));};
after(()=>{setCatalogSource(null);win.happyDOM.cancelAsync();});

test('pending catalogue has animated accessible indeterminate loading and disappears only after data is ready',async()=>{
  const data=deferred(),view=mount({source:()=>data.promise});
  const status=view.panel.querySelector('[data-loading-ui]');
  assert.ok(status);assert.equal(status.getAttribute('role'),'status');assert.equal(status.getAttribute('aria-busy'),null);
  assert.match(status.querySelector('[data-loading-title]').textContent,/Načítám katalog/);
  assert.match(status.querySelector('[data-loading-message]').textContent,/nástroje a sady/);
  assert.equal(status.querySelector('[data-loading-progress]').hasAttribute('value'),false,'no guessed percentage');
  assert.equal(view.footer.querySelector('[data-catalog-add-selected]').disabled,true);
  data.resolve(catalog);await select(view);
  assert.equal(view.panel.querySelector('[data-loading-ui]'),null);
});

test('slow catalogue keeps honest progress and explains that tabs stay available',async()=>{
  const nativeTimeout=globalThis.setTimeout,data=deferred();let slow;
  globalThis.setTimeout=(callback,delay,...args)=>delay===8000?(slow=callback,{unref(){}}):nativeTimeout(callback,delay,...args);
  let view;
  try{view=mount({source:()=>data.promise});}finally{globalThis.setTimeout=nativeTimeout;}
  assert.equal(typeof slow,'function');slow();
  assert.match(view.panel.querySelector('[data-loading-message]').textContent,/déle než obvykle/);
  assert.match(view.panel.querySelector('[data-loading-detail]').textContent,/přejít do svých nástrojů/);
  assert.equal(view.panel.querySelector('[data-loading-progress]').hasAttribute('value'),false);
  data.resolve(catalog);await select(view);
});

test('catalogue errors stop the animation, offer retry and recover without reopening the modal',async()=>{
  let attempts=0;const view=mount({source:()=>++attempts===1?Promise.reject(Error('offline')):catalog});
  await waitFor(()=>view.panel.querySelector('[data-catalog-retry]'));
  assert.match(view.panel.querySelector('[role="alert"]').textContent,/offline/);
  assert.equal(view.panel.querySelector('[data-loading-ui]'),null);
  view.panel.querySelector('[data-catalog-retry]').click();
  assert.ok(view.panel.querySelector('[data-loading-ui]'));
  await select(view);assert.equal(attempts,2);
});

test('late catalogue success and failure cannot replace a different tab or closed modal',async()=>{
  for(const fail of [false,true]){
    const data=deferred(),view=mount({source:()=>data.promise});
    view.tab('mine').click();
    if(fail)data.reject(Error('late'));else data.resolve(catalog);
    await new Promise(resolve=>setTimeout(resolve,2));
    assert.equal(view.panel.textContent,'Moje vlastní nástroje');assert.equal(view.panel.querySelector('[data-loading-ui],[role="alert"]'),null);
  }
  const data=deferred(),view=mount({source:()=>data.promise});view.body.remove();data.resolve(catalog);
  await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(view.panel.querySelector('[data-catalog-add]'),null,'detached catalogue does not redraw');
});

test('adding paints first, ignores duplicate clicks and keeps the busy state through an async callback',async()=>{
  const done=deferred();let calls=0;
  const view=mount({onAdd:()=>{calls++;return done.promise;}}),button=await select(view);
  button.click();assert.equal(calls,0,'packing cannot run before the first painted loading state');
  assert.ok(view.panel.querySelector('[data-catalog-operation] [data-loading-ui]'));
  assert.equal(button.disabled,true);
  button.dispatchEvent(new win.MouseEvent('click',{bubbles:true}));
  await paint();assert.equal(calls,1);assert.ok(view.panel.querySelector('[data-catalog-operation]'));
  done.resolve();await waitFor(()=>!view.panel.querySelector('[data-catalog-operation]'));
  assert.equal(button.disabled,false);
});

test('closing or switching tabs before the paint cancels the queued addition',async()=>{
  for(const close of [false,true]){
    let calls=0;const view=mount({onAdd:()=>calls++}),button=await select(view);button.click();
    if(close)view.body.remove();else view.tab('mine').click();
    await paint();assert.equal(calls,0);
    assert.equal(view.panel.querySelector('[data-catalog-operation]'),null);
    if(!close)assert.equal(view.panel.textContent,'Moje vlastní nástroje');
  }
});

test('failed add and save release controls and display an actionable error',async()=>{
  for(const action of ['add','save']){
    const view=mount({onAdd:()=>{throw Error('Chyba rozložení');},onSave:()=>Promise.reject(Error('Chyba uložení'))});await select(view);
    const button=view.panel.querySelector(`[data-catalog-${action}]`);button.click();await paint();
    await waitFor(()=>!view.panel.querySelector('[data-catalog-operation]'));
    assert.equal(button.disabled,false);assert.match(document.querySelector('#toast').textContent,/Chyba/);
  }
});
