// Catalogue set options: one module per set (default) or one per tool, scale (% or longest length),
// project tool-set registration and the explicit choice when a set does not fit the drawer.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';

const win=new Window({url:'http://localhost:5173'});
const html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(Date.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;
win.scrollTo=()=>{};
const nativeSetTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeSetTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};

const {setCatalogSource,scaleFactor,longestSide,mountLibraryFolders}=await import('../dist/catalog-ui.js');
const {setLang}=await import('../dist/i18n.js');
const {setAppUnit}=await import('../dist/units.js');
const {validateLayout}=await import('../dist/geometry.js');
const {setCoherence}=await import('../dist/tool-sets.js');
const {openModal}=await import('../dist/ui.js');

const rect=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const CATEGORIES=[{id:'wrenches',cs:'Klíče',en:'Wrenches'},{id:'hex-keys',cs:'Imbusy a torxy',en:'Hex & Torx keys'}];
const key=s=>({id:'key-'+s,category:'wrenches',name:{cs:`Klíček ${s} mm`,en:`Small wrench ${s} mm`},points:rect(60+s*4,10+s),depth:6,unit:'mm',size:s,accuracy:'standard',source:{name:'Test',license:'CC0'}});
const hex=s=>({id:'hex-'+s,category:'hex-keys',name:{cs:`Imbus ${s} mm`,en:`Hex key ${s} mm`},points:rect(50+s*10,10+s*3),depth:6,unit:'mm',size:s,accuracy:'typical',source:{name:'Test',license:'CC0'}});
const items=[...[8,10,13].map(key),...[2,3,4].map(hex)];
const sets=[
  {id:'key-set',category:'wrenches',name:{cs:'Sada klíčků',en:'Small wrench set'},items:['key-8','key-10','key-13'],unit:'mm',source:{name:'Test'}},
  {id:'hex-set',category:'hex-keys',name:{cs:'Sada imbusů',en:'Hex key set'},items:['hex-2','hex-3','hex-4'],unit:'mm',source:{name:'Test'}}
];
const source=async()=>({categories:CATEGORIES,items,sets,setsCategory:{id:'sets',cs:'Sady nářadí',en:'Tool sets'}});
setCatalogSource(source);

// Explicit print bed: these scenarios are not about the bed (see the bed tests in catalog-set-options.test.mjs).
const seedProject=async()=>{const {createDemoProject}=await import('../dist/geometry.js'),{validateProject}=await import('../dist/model.js');const p=validateProject({...createDemoProject(),id:'test-drawer',limitToBed:false});localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([p]));localStorage.setItem('suplik-studio-current',JSON.stringify(p.id));};
await seedProject();
await import('../dist/app.js');

const $=s=>win.document.querySelector(s);
const $$=s=>[...win.document.querySelectorAll(s)];
const click=s=>{const el=typeof s==='string'?$(s):s;assert.ok(el,'Missing '+s);el.click();};
const waitFor=async fn=>{const start=Date.now();while(!fn()){if(Date.now()-start>5000)throw Error('Timed out waiting for UI');await new Promise(r=>setTimeout(r,10));}};
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id===JSON.parse(localStorage.getItem('suplik-studio-current')));
const tab=id=>$(`[data-library-folder="${id}"]`);
async function openSets(){click('#app [data-action="library"]');if(tab('catalog').getAttribute('aria-selected')!=='true')click(tab('catalog'));await waitFor(()=>$('.catalog-grid')||$('.catalog-empty'));click('.catalog-chip[data-catalog-category="sets"]');}
async function openItems(){click('#app [data-action="library"]');if(tab('catalog').getAttribute('aria-selected')!=='true')click(tab('catalog'));await waitFor(()=>$('.catalog-grid')||$('.catalog-empty'));click('.catalog-chip[data-catalog-category="all"]');}
const chooseLayout=(setId,value)=>{const s=$(`[data-set-layout="${setId}"]`);s.value=value;s.dispatchEvent(new win.Event('change',{bubbles:true}));};
const type=(sel,value)=>{const el=$(sel);assert.ok(el,'Missing '+sel);el.value=value;el.dispatchEvent(new win.Event('input',{bubbles:true}));};
const bbox=points=>{const xs=points.map(p=>p.x),ys=points.map(p=>p.y);return{w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};};
const newOf=(before,p=saved())=>p.tools.filter(t=>!before.has(t.id));
const ids=p=>new Set(p.tools.map(t=>t.id));
const toolIssues=(p,toolIds)=>validateLayout(p).filter(i=>i.ids.some(id=>toolIds.has(id)||p.modules.some(m=>m.id===id&&p.tools.some(t=>toolIds.has(t.id)&&t.moduleId===m.id))));
const placedInDrawer=(p,t)=>{const m=p.modules.find(m=>m.id===t.moduleId);return !!m&&m.x>=-.001&&m.y>=-.001&&m.x+m.width<=p.width+.001&&m.y+m.height<=p.height+.001;};

after(()=>{setLang('cs');setAppUnit('mm');setCatalogSource(null);});

test('pure helpers: scaleFactor by percent and by longest length, with validation',()=>{
  const list=[key(13)];const long=longestSide(list);assert.equal(long,112);
  assert.equal(scaleFactor(null,list,'mm'),1);
  assert.equal(scaleFactor({mode:'percent',text:'110 %'},list,'mm'),1.1);
  assert.equal(scaleFactor({mode:'percent',text:'92,5'},list,'mm'),.925);
  assert.ok(Math.abs(scaleFactor({mode:'length',text:'224 mm'},list,'mm')-2)<1e-9);
  assert.ok(Math.abs(scaleFactor({mode:'length',text:'8 in'},list,'mm')-203.2/112)<1e-9);
  assert.ok(Math.abs(scaleFactor({mode:'length',text:'4'},list,'in')-101.6/112)<1e-9,'bare number uses the item unit');
  assert.throws(()=>scaleFactor({mode:'percent',text:'19'},list,'mm'),/od 20 do 500 %/);
  assert.throws(()=>scaleFactor({mode:'percent',text:'abc'},list,'mm'),/platné měřítko/);
  assert.throws(()=>scaleFactor({mode:'length',text:'2000 mm'},list,'mm'),/od 20 do 500 %/);
});

test('"Přidat sadu" adds ONE module with every tool by default, registered as a shared tool set, one undo step',async()=>{
  const before=saved(),old=ids(before),modulesBefore=before.modules.length;
  await openSets();
  assert.equal($('[data-set-layout="key-set"]').value,'group','one module is the default');
  assert.deepEqual($$('[data-set-layout="key-set"] option').map(o=>o.textContent),['Jeden modul pro celou sadu','Samostatný modul pro každý nástroj']);
  click('[data-set-add="key-set"]');
  assert.ok($('.modal')===null,'no extra dialog when the set fits');
  const p=saved(),added=newOf(old,p);
  assert.equal(added.length,3);
  assert.equal(p.modules.length,modulesBefore+1,'exactly one new module');
  const moduleIds=new Set(added.map(t=>t.moduleId));assert.equal(moduleIds.size,1);
  const m=p.modules.find(x=>x.id===[...moduleIds][0]);
  assert.ok(m&&m.grouped,'grouped set module');
  assert.ok(m.x>=0&&m.y>=0&&m.x+m.width<=p.width+.001&&m.y+m.height<=p.height+.001,'module placed inside the drawer');
  assert.deepEqual(toolIssues(p,new Set(added.map(t=>t.id))),[],'no layout issues for the set');
  assert.ok(added.every(t=>Array.isArray(t.fingerGrips)),'finger grips added before packing');
  const set=(p.toolSets||[]).find(s=>s.toolIds.includes(added[0].id));
  assert.ok(set,'registered in project.toolSets');assert.equal(set.layout,'shared');assert.equal(set.name,'Sada klíčků');
  assert.deepEqual([...set.toolIds].sort(),added.map(t=>t.id).sort());
  assert.equal($('#toast').textContent,'Sada přidána jako jeden modul.');
  click('#app [data-action="undo"]');
  const u=saved();assert.equal(u.tools.length,before.tools.length,'one undo removes the set');assert.equal(u.modules.length,modulesBefore);
  assert.ok(!(u.toolSets||[]).some(s=>s.name==='Sada klíčků'));
});

test('"Samostatný modul pro každý nástroj" restores one module per tool (uniform tool set) and is remembered',async()=>{
  const before=saved(),old=ids(before);
  await openSets();
  chooseLayout('key-set','each');
  assert.equal($('[data-set-layout="hex-set"]').value,'each','all cards follow the choice');
  click('[data-set-add="key-set"]');
  const p=saved(),added=newOf(old,p);
  assert.equal(added.length,3);assert.equal(new Set(added.map(t=>t.moduleId)).size,3,'n modules');
  const set=(p.toolSets||[]).find(s=>s.toolIds.includes(added[0].id));
  assert.equal(set?.layout,'uniform');
  const own=p.modules.filter(m=>added.some(t=>t.moduleId===m.id));
  assert.equal(new Set(own.map(m=>m.width+'x'+m.height)).size,1,'all set modules have equal dimensions');
  assert.deepEqual(setCoherence(p,[set]).satisfied,[set.id],'equal modules and headings are immediately coherent');
  await openSets();
  assert.equal($('[data-set-layout="key-set"]').value,'each','choice remembered for the session');
  chooseLayout('key-set','group');
  click('[data-modal-close]');
  click('#app [data-action="undo"]');assert.equal(saved().tools.length,before.tools.length,'one undo step');
});

test('footer batch passes exact collection ranges and scales once, and rejects an invalid scale atomically',async()=>{
  const calls=[];
  const modal=openModal({title:'Batch contract',wide:true});
  mountLibraryFolders(modal,{mine:()=>({body:'',footer:''}),onAdd:(tools,options)=>calls.push({tools,options}),onSave:()=>0});
  if(tab('catalog').getAttribute('aria-selected')!=='true')click(tab('catalog'));
  await waitFor(()=>$('[data-catalog-category="all"]'));
  click('[data-catalog-category="all"]');
  await waitFor(()=>$('[data-catalog-select="hex-4"]'));
  const check=selector=>{const el=$(selector);assert.ok(el,selector);el.checked=!el.checked;el.dispatchEvent(new win.Event('change',{bubbles:true}));};
  check('[data-catalog-select="hex-4"]');
  type('[data-scale="i:hex-4"] [data-scale-pct]','125');
  for(const id of ['key-set','hex-set'])check(`[data-catalog-select-set="${id}"]`);
  click('[data-set-toggle="key-set"]');
  check('[data-set-member="key-set"][data-index="1"]');
  type('[data-scale="s:key-set"] [data-scale-pct]','110');
  type('[data-scale="s:hex-set"] [data-scale-pct]','600');
  chooseLayout('key-set','each');
  click('[data-catalog-add-selected]');
  assert.equal(calls.length,0,'no callback before every scale is valid');
  type('[data-scale="s:hex-set"] [data-scale-pct]','80');
  click('[data-catalog-add-selected]');
  assert.equal(calls.length,1,'one callback for the whole batch');
  const {tools,options}=calls[0];
  assert.equal(tools.length,6);
  assert.deepEqual(options.collections,[
    {start:1,count:2,name:'Sada klíčků',unit:'mm',layout:'uniform',arrangement:'ordered',order:'asc'},
    {start:3,count:3,name:'Sada imbusů',unit:'mm',layout:'uniform',arrangement:'ordered',order:'asc'}
  ]);
  assert.deepEqual(tools.map(t=>t.name),['Imbus 4 mm','Klíček 8 mm','Klíček 13 mm','Imbus 2 mm','Imbus 3 mm','Imbus 4 mm']);
  for(const [i,width] of [112.5,101.2,123.2,56,64,72].entries())assert.ok(Math.abs(bbox(tools[i].points).w-width)<.001,`scaled tool ${i}`);
  modal.close();
});

test('footer adds two separately scaled sets with the chosen layout in one undo step',async()=>{
  const original=saved().id;
  click('#app [data-action="projects"]');click('[data-new]');
  const change=(selector,value)=>{const el=$(selector);assert.ok(el,selector);el.value=String(value);el.dispatchEvent(new win.Event('change',{bubbles:true}));};
  change('[data-field="drawerName"]','Hromadné sady');change('[data-field="drawerWidth"]',840);change('[data-field="drawerHeight"]',840);click('[data-create-drawer]');
  try{
    for(const layout of ['group','each']){
      const before=saved();
      await openItems();chooseLayout('key-set',layout);
      click('[data-catalog-select="hex-4"]');
      click('[data-catalog-select-set="key-set"]');click('[data-catalog-select-set="hex-set"]');
      click('[data-set-toggle="key-set"]');click('[data-set-member="key-set"][data-index="1"]');
      type('[data-scale="s:key-set"] [data-scale-pct]','110');type('[data-scale="s:hex-set"] [data-scale-pct]','80');
      click('[data-catalog-add-selected]');
      assert.ok(!$('.modal'),'both collections fit without a follow-up choice');
      const p=saved();assert.equal(p.tools.length,before.tools.length+6);
      assert.equal(p.toolSets.length,2);
      assert.equal(p.modules.length,layout==='group'?3:6,'standalone outline plus one or one-per-member module for each set');
      for(const set of p.toolSets){
        assert.equal(set.layout,layout==='group'?'shared':'uniform');
        assert.deepEqual(setCoherence(p,[set]).satisfied,[set.id]);
        const members=p.tools.filter(t=>set.toolIds.includes(t.id));
        const widths=members.map(t=>bbox(t.points).w);
        const sizes=widths.map(w=>Math.round(w*10)).sort((a,b)=>a-b);
        if(set.name==='Sada klíčků')assert.deepEqual(sizes,[1012,1232]);
        else assert.deepEqual(sizes,[560,640,720]);
      }
      assert.deepEqual(validateLayout(p),[]);
      click('#app [data-action="undo"]');
      assert.deepEqual(saved().tools,before.tools);assert.deepEqual(saved().modules,before.modules);assert.deepEqual(saved().toolSets||[],before.toolSets||[]);
    }
  }finally{
    click('#app [data-action="projects"]');click(`[data-open="${original}"]`);
    await openSets();chooseLayout('key-set','group');click('[data-modal-close]');
  }
});

test('scale 110 % makes every tool 1.1× larger; preview shows the resulting length',async()=>{
  const old=ids(saved());
  await openSets();
  const details=$('[data-scale="s:key-set"]');assert.ok(details,'scale disclosure on the set card');
  assert.equal(details.querySelector('summary').textContent.trim(),'Upravit měřítko');
  type('[data-scale="s:key-set"] [data-scale-pct]','110');
  assert.equal($('[data-scale="s:key-set"] [data-scale-len]').value,'123.2');
  assert.match($('[data-scale="s:key-set"] [data-scale-preview]').textContent,/112 mm → 123,2 mm/);
  assert.match($('[data-scale="s:key-set"] [data-scale-badge]').textContent,/110/);
  click('[data-set-add="key-set"]');
  const added=newOf(old);assert.equal(added.length,3);
  for(const s of [8,10,13]){const t=added.find(x=>x.name===`Klíček ${s} mm`),b=bbox(t.points);assert.ok(Math.abs(b.w-(60+s*4)*1.1)<.01&&Math.abs(b.h-(10+s)*1.1)<.01,`tool ${s} scaled: ${b.w}×${b.h}`);}
  click('#app [data-action="undo"]');
});

test('longest tool length "200 mm" and "8 in" scale the set accordingly',async()=>{
  for(const [text,target] of [['200 mm',200],['8 in',203.2]]){
    const old=ids(saved());
    await openSets();
    type('[data-scale="s:key-set"] [data-scale-len]',text);
    assert.equal($('[data-scale="s:key-set"] [data-scale-pct]').value,String(Math.round(target/112*1000)/10));
    click('[data-set-add="key-set"]');
    const added=newOf(old),longest=Math.max(...added.map(t=>{const b=bbox(t.points);return Math.max(b.w,b.h);}));
    assert.ok(Math.abs(longest-target)<.01,`${text}: longest ${longest}`);
    click('#app [data-action="undo"]');
  }
});

test('invalid scale shows a translated toast and adds nothing',async()=>{
  const count=saved().tools.length;
  await openSets();
  type('[data-scale="s:key-set"] [data-scale-pct]','1000');
  assert.match($('[data-scale="s:key-set"] [data-scale-preview]').textContent,/od 20 do 500 %/);
  assert.ok($('[data-scale="s:key-set"] [data-scale-preview]').classList.contains('invalid'));
  click('[data-set-add="key-set"]');
  assert.equal($('#toast').textContent,'Měřítko musí být od 20 do 500 %.');
  assert.ok($('.modal'),'catalogue stays open');
  type('[data-scale="s:key-set"] [data-scale-len]','abc');
  click('[data-set-add="key-set"]');
  assert.equal($('#toast').textContent,'Zadejte platné měřítko, například 110 % nebo délku 200 mm.');
  assert.equal(saved().tools.length,count);
  click('[data-modal-close]');
});

test('a single catalogue item can be scaled, also when saved to my tools',async()=>{
  const old=ids(saved());
  await openItems();
  const sel='[data-scale="i:hex-4"]';assert.ok($(sel),'scale on the single item card');
  type(sel+' [data-scale-pct]','50');
  assert.match($(sel+' [data-scale-preview]').textContent,/90 mm → 45 mm/);
  click('[data-catalog-save="hex-4"]');
  const lib=JSON.parse(localStorage.getItem('suplik-studio-library-v1'));
  assert.ok(lib.some(t=>t.name==='Imbus 4 mm'&&Math.abs(bbox(t.points).w-45)<.01),'saved scaled');
  click('[data-catalog-add="hex-4"]');
  const added=newOf(old);assert.equal(added.length,1);
  const b=bbox(added[0].points);assert.ok(Math.abs(b.w-45)<.01&&Math.abs(b.h-11)<.01);
  click('#app [data-action="undo"]');
});

test('English labels for the set options',async()=>{
  setLang('en');
  try{
    await openSets();
    assert.equal($('.catalog-set-layout span').textContent,'Layout');
    assert.deepEqual($$('[data-set-layout="key-set"] option').map(o=>o.textContent),['One module for the whole set','A separate module for each tool']);
    assert.equal($('[data-scale="s:key-set"] summary').textContent.trim(),'Adjust scale');
    assert.match($('[data-scale="s:key-set"]').textContent,/Longest tool length/);
    assert.match($('[data-scale="s:key-set"] [data-scale-preview]').textContent,/Longest tool: 112 mm → 112 mm/);
    type('[data-scale="s:key-set"] [data-scale-pct]','600');
    click('[data-set-add="key-set"]');
    assert.equal($('#toast').textContent,'Scale must be between 20 and 500 %.');
    type('[data-scale="s:key-set"] [data-scale-pct]','100');
    const before=saved().tools.length;
    click('[data-set-add="key-set"]');
    assert.equal($('#toast').textContent,'Set added as one module.');
    assert.equal(saved().tools.length,before+3);
    click('#app [data-action="undo"]');
  }finally{setLang('cs');}
});

// User report "chyba umístění sady": the demo drawer plus a real combination wrench set left ~15 tools with
// "Nástroj … zatím nemá umístěný modul." Now the set is either placed, or the user gets an explicit choice.
test('real combination wrench set in the demo drawer: placed or an explicit choice, never silent unplaced tools',async()=>{
  setCatalogSource(null);
  try{
    const before=saved(),old=ids(before),size=[before.width,before.height];
    click('#app [data-action="library"]');if(tab('catalog').getAttribute('aria-selected')!=='true')click(tab('catalog'));
    await waitFor(()=>$('[data-catalog-category="sets"]'));click('.catalog-chip[data-catalog-category="sets"]');
    click('[data-set-add="combination-wrench-set-8-19mm"]');
    let p=saved(),added=newOf(old,p),addedIds=new Set(added.map(t=>t.id));
    assert.equal(added.length,12);
    assert.equal(new Set(added.map(t=>t.moduleId)).size,1,'one module for the set');
    const unplaced=added.some(t=>!placedInDrawer(p,t));
    if(unplaced||toolIssues(p,addedIds).length){
      assert.ok($('[data-fit="grow"]')&&$('[data-fit="new"]')&&$('[data-fit="keep"]'),'explicit choice offered');
      assert.equal($('#modal-title').textContent,'Sada se do šuplíku nevešla');
      assert.ok($('[data-fit="grow"]').classList.contains('primary'),'enlarging is the default');
      click('[data-fit="grow"]');
      p=saved();
      assert.deepEqual(toolIssues(p,addedIds).map(i=>i.message),[],'after enlarging the set is placed without issues');
      assert.ok(p.width>=size[0]&&p.height>=size[1]&&(p.width>size[0]||p.height>size[1]||p.limitToBed===false));
      assert.match($('#toast').textContent,/Šuplík zvětšen na/);
      click('#app [data-action="undo"]');
      const u=saved();assert.equal(u.tools.length,before.tools.length,'one undo reverts add + enlarge');assert.deepEqual([u.width,u.height],size);assert.equal(u.limitToBed,before.limitToBed);
    }else click('#app [data-action="undo"]');
    // Per-tool mode with the large 6–32 mm set: unplaced tools also get the choice; "new drawer" leaves this one untouched.
    const drawers=JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).length,current=saved().id;
    click('#app [data-action="library"]');await waitFor(()=>$('[data-set-layout="combination-wrench-set-6-32mm"]'));
    chooseLayout('combination-wrench-set-6-32mm','each');
    click('[data-set-add="combination-wrench-set-6-32mm"]');
    p=saved();added=newOf(old,p);addedIds=new Set(added.map(t=>t.id));
    assert.equal(added.length,26);
    assert.ok(added.some(t=>!placedInDrawer(p,t)),'precondition: some tool modules are missing or parked outside the drawer');
    assert.ok($('[data-fit="grow"]'),'per-tool mode offers enlarging too');
    assert.ok(!$('[data-fit="new"]').disabled);
    click('[data-fit="new"]');
    const all=JSON.parse(localStorage.getItem('suplik-studio-projects-v1'));
    assert.equal(all.length,drawers+1,'a new drawer was created');
    const fresh=saved();assert.notEqual(fresh.id,current);
    assert.equal(fresh.tools.length,26);
    assert.ok(fresh.tools.every(t=>placedInDrawer(fresh,t)),'every tool has a module inside the new drawer');
    assert.deepEqual(validateLayout(fresh),[],'the new drawer has no manufacturing issues');
    const coherence=setCoherence(fresh,fresh.toolSets);
    assert.deepEqual(coherence.satisfied,fresh.toolSets.map(s=>s.id),'the new drawer keeps equal module sizes and headings: '+JSON.stringify({details:coherence.details.map(s=>({uniform:s.uniform,headingAligned:s.headingAligned,headings:[...new Set(s.headings.map(v=>Math.round(v)))]})),moduleSizes:[...new Set(fresh.modules.map(m=>m.width+'x'+m.height))]}));
    assert.equal(all.find(x=>x.id===current).tools.length,before.tools.length,'original drawer unchanged');
    chooseLayoutReset();
  }finally{setCatalogSource(source);}
});
function chooseLayoutReset(){click('#app [data-action="library"]');const s=$('[data-set-layout]');if(s){s.value='group';s.dispatchEvent(new win.Event('change',{bubbles:true}));}click('[data-modal-close]');}

// ---- Print bed (user report "Nástroj „Očkoplochý klíč 17 mm“ zatím nemá umístěný modul.") ----
// A fresh demo drawer keeps the defaults: limitToBed with a 220 × 220 mm bed. 17–19 mm wrenches need a module
// longer than 220 mm, so the set never fits the bed; the app must say so and offer explicit fixes.
async function openRealSets(){click('#app [data-action="library"]');if(tab('catalog').getAttribute('aria-selected')!=='true')click(tab('catalog'));await waitFor(()=>$('.catalog-chip[data-catalog-category="sets"]'));click('.catalog-chip[data-catalog-category="sets"]');}
const freshDemo=()=>{click('#app [data-action="demo-drawer"]');const p=saved();assert.equal(p.limitToBed,true);assert.equal(p.bedWidth,220);assert.equal(p.bedHeight,220);return p;};
const unplacedOf=(p,toolIds)=>p.tools.filter(t=>toolIds.has(t.id)&&!placedInDrawer(p,t)).length;
const onBed=(m,bw=220,bh=220)=>(m.width-.5<=bw&&m.height-.5<=bh)||(m.height-.5<=bw&&m.width-.5<=bh);
// A drawer that is too small afterwards is a separate, explicit choice; enlarge it.
const finishDrawer=()=>{const grow=$('[data-fit="grow"]');if(grow){assert.equal(grow.disabled,false);click(grow);}};
async function addRealSet(id,layout){await openRealSets();chooseLayout(id,layout);click(`[data-set-add="${id}"]`);}

test('bed: 8–19 mm set in the default demo drawer explains the 220 mm bed; split (+ the remaining long tools) → all placed, one undo',async()=>{
  setCatalogSource(null);
  try{
    const before=freshDemo(),old=ids(before);
    await addRealSet('combination-wrench-set-8-19mm','group');
    let p=saved();const added=newOf(old,p),addedIds=new Set(added.map(t=>t.id));
    assert.equal(added.length,12,'nothing is dropped');
    assert.equal($('#modal-title').textContent,'Sada se nevejde na tiskovou plochu','explicit choice instead of a silent list of issues');
    assert.match($('.modal .help-intro').textContent,/ale tisková plocha je jen 220 × 220 mm/);
    assert.ok($('[data-fit="split"]').classList.contains('primary'),'splitting is the default');
    assert.equal($('[data-fit="split"]').disabled,false);
    assert.ok($('[data-fit="nobed"]')&&$('[data-fit="keep"]')&&$('[data-fit="bed"]')&&$('[data-field="fitBedWidth"]'));
    // Tools that cannot be printed on the bed even alone are named explicitly (the short ones never are).
    const note=$('[data-fit-too-long]')?.textContent||'';
    assert.doesNotMatch(note,/klíč (8|9|10|11|12|13|14|15|16) mm/);
    const stuck=added.filter(t=>note.includes(`„${t.name}“`)).map(t=>t.id);
    click('[data-fit="split"]');
    p=saved();
    const own=p.tools.filter(t=>addedIds.has(t.id));
    assert.equal(own.length,12);
    assert.ok(new Set(own.map(t=>t.moduleId)).size>=3,'several modules');
    for(const t of own)if(!stuck.includes(t.id))assert.ok(onBed(p.modules.find(x=>x.id===t.moduleId)),`${t.name}: module fits the bed`);
    if(stuck.length){
      assert.equal($('#modal-title').textContent,'Nástroje se nevejdou na tiskovou plochu','the remaining long tools are explained again');
      assert.equal($('[data-fit="split"]'),null,'no second split');
      for(const id of stuck)assert.match($('[data-fit-too-long]').textContent,new RegExp(added.find(t=>t.id===id).name));
      click('[data-fit="nobed"]');
    }
    finishDrawer();
    p=saved();
    assert.equal(p.limitToBed,!stuck.length);
    assert.equal(unplacedOf(p,addedIds),0,'every tool placed');
    assert.deepEqual(toolIssues(p,addedIds).map(i=>i.message),[],'valid layout');
    assert.ok($('.modal')===null);
    click('#app [data-action="undo"]');
    const u=saved();assert.equal(u.tools.length,before.tools.length,'one undo reverts the addition and the fixes');assert.equal(u.limitToBed,true);
  }finally{setCatalogSource(source);}
});

test('bed: "Vypnout omezení tiskovou plochou" places the whole set as one module',async()=>{
  setCatalogSource(null);
  try{
    const before=freshDemo(),old=ids(before);
    await addRealSet('combination-wrench-set-8-19mm','group');
    click('[data-fit="nobed"]');
    finishDrawer();
    const p=saved(),addedIds=new Set(newOf(old,p).map(t=>t.id));
    assert.equal(addedIds.size,12);assert.equal(p.limitToBed,false);
    assert.equal(new Set(p.tools.filter(t=>addedIds.has(t.id)).map(t=>t.moduleId)).size,1,'still one module');
    assert.equal(unplacedOf(p,addedIds),0);
    assert.deepEqual(toolIssues(p,addedIds).map(i=>i.message),[]);
    click('#app [data-action="undo"]');assert.equal(saved().tools.length,before.tools.length);
  }finally{setCatalogSource(source);}
});

test('bed: "Zvětšit tiskovou plochu" with inline sizes (prefilled with the needed size) places the set',async()=>{
  setCatalogSource(null);
  try{
    const before=freshDemo(),old=ids(before);
    await addRealSet('combination-wrench-set-8-19mm','group');
    const w=$('[data-field="fitBedWidth"]'),h=$('[data-field="fitBedHeight"]');
    assert.ok(Number(w.dataset.mm)>220,'needed width is prefilled');
    // Too small → the remaining problem is explained again.
    w.value='230';h.value='230';click('[data-fit="bed"]');
    assert.equal(saved().bedWidth,230);
    assert.ok($('[data-fit-bed]'),'still offered because 230 mm is not enough');
    const need=[Number($('[data-field="fitBedWidth"]').dataset.mm),Number($('[data-field="fitBedHeight"]').dataset.mm)];
    click('[data-fit="bed"]');
    finishDrawer();
    const p=saved(),addedIds=new Set(newOf(old,p).map(t=>t.id));
    assert.deepEqual([p.bedWidth,p.bedHeight],need);assert.equal(p.limitToBed,true);
    assert.equal(unplacedOf(p,addedIds),0);
    assert.deepEqual(toolIssues(p,addedIds).map(i=>i.message),[]);
    click('#app [data-action="undo"]');const u=saved();assert.equal(u.tools.length,before.tools.length);assert.equal(u.bedWidth,220);
  }finally{setCatalogSource(source);}
});

test('bed: per-tool mode explains the bed too (no split offered); "keep" leaves the tools outside',async()=>{
  setCatalogSource(null);
  try{
    const before=freshDemo(),old=ids(before);
    await addRealSet('combination-wrench-set-8-19mm','each');
    assert.equal(newOf(old).length,12);
    assert.equal($('#modal-title').textContent,'Nástroje se nevejdou na tiskovou plochu');
    assert.match($('.modal .help-intro').textContent,/na tiskovou plochu 220 × 220 mm/);
    assert.match($('[data-fit-too-long]').textContent,/Očkoplochý klíč 19 mm/);
    assert.equal($('[data-fit="split"]'),null);
    click('[data-fit="keep"]');
    assert.ok($('.modal')===null);assert.match($('#toast').textContent,/mimo šuplík/);
    assert.equal(saved().tools.length,before.tools.length+12,'tools stay in the project');
    click('#app [data-action="undo"]');assert.equal(saved().tools.length,before.tools.length);
    chooseLayoutReset();
  }finally{setCatalogSource(source);}
});

test('bed: a set whose tools all fit the bed is split into bed-sized modules, all placed, valid layout',async()=>{
  const bars=Array.from({length:8},(_,i)=>({id:'bar-'+i,category:'wrenches',name:{cs:`Tyčka ${i+1}`,en:`Rod ${i+1}`},points:rect(180,26),depth:6,unit:'mm',size:i+1,accuracy:'typical',source:{name:'Test'}}));
  setCatalogSource(async()=>({categories:CATEGORIES,items:bars,sets:[{id:'bar-set',category:'wrenches',name:{cs:'Sada tyček',en:'Rod set'},items:bars.map(b=>b.id),unit:'mm'}],setsCategory:{id:'sets',cs:'Sady nářadí',en:'Tool sets'}}));
  try{
    const before=freshDemo(),old=ids(before);
    await openSets();chooseLayout('bar-set','group');click('[data-set-add="bar-set"]');
    assert.equal($('#modal-title').textContent,'Sada se nevejde na tiskovou plochu');
    assert.equal($('[data-fit-too-long]'),null,'every tool fits the bed alone');
    assert.ok($('[data-fit="split"]').classList.contains('primary'));
    click('[data-fit="split"]');
    finishDrawer();
    const p=saved(),own=newOf(old,p),addedIds=new Set(own.map(t=>t.id));
    assert.equal(own.length,8);
    const mods=[...new Set(own.map(t=>t.moduleId))].map(id=>p.modules.find(m=>m.id===id));
    assert.ok(mods.length>=2,'split into several modules');assert.ok(mods.every(m=>onBed(m)),'each module fits the 220 mm bed');
    assert.equal(p.limitToBed,true);
    assert.equal(unplacedOf(p,addedIds),0);
    assert.deepEqual(toolIssues(p,addedIds).map(i=>i.message),[]);
    click('#app [data-action="undo"]');assert.equal(saved().tools.length,before.tools.length);
  }finally{setCatalogSource(source);}
});

test('bed: English texts',async()=>{
  setCatalogSource(null);setLang('en');
  try{
    freshDemo();
    await addRealSet('combination-wrench-set-8-19mm','group');
    assert.equal($('#modal-title').textContent,'The set does not fit the print bed');
    assert.match($('.modal .help-intro').textContent,/print bed is only 220 × 220 mm/);
    assert.match($('[data-fit="split"]').textContent,/Split the set into modules that fit the print bed/);
    assert.match($('[data-fit-bed]').textContent,/Enlarge the print bed/);
    assert.match($('[data-fit="nobed"]').textContent,/Turn off the print bed limit/);
    assert.match($('[data-fit-bed]').textContent,/At least [0-9]+ × [0-9]+ mm is needed/);
    click('[data-fit="keep"]');click('#app [data-action="undo"]');
  }finally{setLang('cs');setCatalogSource(source);}
});
