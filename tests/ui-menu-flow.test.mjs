import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject,validateProject} from '../dist/model.js';
import {validateLayout} from '../dist/geometry.js';
import {openModal} from '../dist/ui.js';

// This is a DOM interaction check, not browser layout or physical phone QA.
const mobile=import.meta.url.includes('/mobil/tests/');
const prefix=mobile?'insertcreator-mobile:':'';
const win=new Window({url:mobile?'http://localhost:5174':'http://localhost:5173'});
win.happyDOM.setWindowSize({width:1280,height:900});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(fn,delay,...args)=>{const timer=nativeTimeout(fn,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
globalThis.requestAnimationFrame=fn=>setTimeout(()=>fn(performance.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;
win.scrollTo=()=>{};win.HTMLElement.prototype.scrollIntoView=()=>{};
win.HTMLCanvasElement.prototype.getContext=()=>null;
localStorage.setItem(prefix+'suplik-studio-lang','"cs"');
localStorage.setItem(prefix+'suplik-studio-unit','"mm"');
const fixture=validateProject({...blankProject(),id:'menu-flow',name:'Přehledné ovládání',width:336,height:252,sizeLabels:false,
  modules:[{id:'tool-module',name:'Nástrojový modul',x:0,y:0,width:126,height:126,sizeMode:'manual'},{id:'blank-module',name:'Výplň',x:168,y:0,width:84,height:84,sizeMode:'manual'}],
  tools:[{id:'tool',name:'Zkušební nástroj',points:[{x:0,y:0},{x:20,y:0},{x:20,y:60},{x:0,y:60}],x:20,y:20,rotation:0,depth:8,moduleId:'tool-module',fingerGrips:[]}]});
assert.deepEqual(validateLayout(fixture),[]);
localStorage.setItem(prefix+'suplik-studio-projects-v1',JSON.stringify([fixture]));
localStorage.setItem(prefix+'suplik-studio-current',JSON.stringify(fixture.id));
if(mobile)localStorage.setItem('suplik-studio-projects-v1','original desktop storage');
await import('../dist/app.js');
const $=selector=>win.document.querySelector(selector);
const $$=selector=>[...win.document.querySelectorAll(selector)];
const section=key=>$(`details[data-inspector-section="${key}"]`);
const click=selector=>{const el=typeof selector==='string'?$(selector):selector;assert.ok(el,'Missing '+selector);if(typeof el.click==='function')el.click();else el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));};
const action=name=>click(`#app [data-action="${name}"]`);
const store=()=>localStorage.getItem(prefix+'suplik-studio-projects-v1');
const saved=()=>JSON.parse(store()).find(p=>p.id===fixture.id);
const logical=()=>{const p=saved();delete p.updatedAt;return p;};
const change=(selector,value)=>{const el=$(selector);assert.ok(el,'Missing '+selector);el.value=String(value);el.dispatchEvent(new win.Event('change',{bubbles:true}));};
const visibleThroughDisclosures=el=>{assert.ok(el);for(let p=el.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open)return false;return true;};
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
after(()=>{win.dispatchEvent(new win.Event('pagehide'));win.happyDOM.abort();});

test('a fresh drawer shows labelled task groups with settings and module additions collapsed',()=>{
  const before=store();
  for(const key of ['drawer-dimensions','drawer-clearance','drawer-layout','assembly-tools','assembly-modules','manufacturing']){
    const group=section(key);assert.ok(group,`${key} is discoverable`);assert.equal(group.open,false,`${key} starts collapsed`);
    assert.ok(group.querySelector(':scope > summary')?.textContent.trim(),`${key} has a meaningful heading`);
  }
  assert.ok($('.add-module-menu'));assert.equal($('.add-module-menu').open,false);
  assert.ok($('.add-module-menu [data-action="add-shape"]'));assert.ok($('.add-module-menu [data-action="add-custom-module"]'));
  assert.ok(visibleThroughDisclosures($('.heading-actions [data-action="capture"]')),'adding a photo stays readily available');
  assert.equal(store(),before);assert.equal($('#app [data-action="undo"]').disabled,true);
});

test('picking a tool keeps related fields together without opening every setting',()=>{
  const before=store();click('#board-svg [data-tool="tool"]');
  for(const key of ['tool-shape','tool-position','pocket-settings','finger-grips','pocket-magnets','size-label','tool-set','module-options','tool-actions']){
    const group=section(key);assert.ok(group,key);assert.equal(group.open,false,`${key} stays collapsed until requested`);
  }
  const owner=field=>$(`[data-field="${field}"]`)?.closest('[data-inspector-section]')?.dataset.inspectorSection;
  assert.equal(owner('toolLength'),'tool-shape');assert.equal(owner('toolBreadth'),'tool-shape');
  assert.equal(owner('rotation'),'tool-position');assert.equal(owner('depth'),'pocket-settings');
  assert.ok($('#drawer-settings').compareDocumentPosition($('#manufacturing-settings'))&win.Node.DOCUMENT_POSITION_FOLLOWING,'selection appears before manufacturing');
  for(const summary of $$('.inspector summary'))assert.equal(summary.querySelector('button,input,select,a[href]'),null,'disclosure headings have one unambiguous click target');
  assert.equal(store(),before);assert.equal($('#app [data-action="undo"]').disabled,true);
});

test('context properties and dimensions reveal their closed settings group',()=>{
  const before=store();
  for(const [contextAction,field] of [['context-properties','name'],['context-dimensions','toolLength']]){
    const shape=section('tool-shape');assert.ok(shape);shape.open=false;
    $('#board-svg [data-tool="tool"]').dispatchEvent(new win.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:80,clientY:80}));
    click(`[data-context-action="${contextAction}"]`);
    const input=$(`[data-field="${field}"][data-scope="tool"]`);assert.ok(input);
    assert.equal(section('tool-shape').open,true);assert.ok(visibleThroughDisclosures(input));assert.equal(win.document.activeElement,input);
  }
  section('tool-shape').open=false;action('grid');assert.equal(store(),before);
});

test('expanded settings, focus and scroll survive edits and undo remains a single project transaction',()=>{
  click('#board-svg [data-tool="tool"]');const before=logical();
  const pocket=section('pocket-settings');assert.ok(pocket);pocket.open=true;
  const depth=$('[data-field="depth"][data-scope="tool"]');assert.ok(depth);depth.focus();
  $('.inspector-scroll').scrollTop=170;change('[data-field="depth"][data-scope="tool"]',9);
  assert.equal(saved().tools[0].depth,9);assert.equal(section('pocket-settings').open,true);
  assert.equal(win.document.activeElement,$('[data-field="depth"][data-scope="tool"]'),'editing does not lose the focused setting');
  assert.equal($('.inspector-scroll').scrollTop,170);
  assert.deepEqual(saved().tools[0].points,before.tools[0].points);assert.deepEqual(saved().modules,before.modules);
  action('undo');assert.deepEqual(logical(),before);
  assert.equal($('#app [data-action="undo"]').disabled,true,'one undo restores the exact project');
  section('pocket-settings').open=false;action('grid');
});

test('dimension and manufacturing shortcuts reveal their actual controls without editing project data',async()=>{
  const before=store();action('drawer-tab');await paint();
  assert.equal(section('drawer-dimensions').open,true);
  const width=$('#drawer-settings [data-field="width"]');assert.ok(visibleThroughDisclosures(width));
  assert.equal(win.document.activeElement,width,'dimension shortcut focuses the first relevant field');
  action('selection-tab');assert.ok($('[data-field="name"][data-scope="tool"]'),'selection can be reached without clicking the canvas again');
  action('3d');action('manufacturing-settings');await paint();
  assert.equal(section('manufacturing').open,true);assert.equal(section('manufacturing-construction').open,true);
  assert.ok(visibleThroughDisclosures($('#print-light')));assert.equal(win.document.activeElement,$('#print-light'));
  assert.equal(store(),before);assert.equal($('#app [data-action="undo"]').disabled,true);
  action('2d');
});

test('group expansion is presentation state and does not create history or alter geometry',()=>{
  const before=store();
  for(const key of ['assembly-tools','assembly-modules']){
    const group=section(key);assert.ok(group);group.open=true;action('grid');assert.equal(section(key).open,true);
    section(key).open=false;action('grid');assert.equal(section(key).open,false);
  }
  assert.equal(store(),before);assert.deepEqual(validateLayout(saved()),[]);assert.equal($('#app [data-action="undo"]').disabled,true);
});

test('the module list selects empty and occupied containers without accidentally editing a tool',()=>{
  const before=store();section('assembly-modules').open=true;
  for(const id of ['blank-module','tool-module']){
    click(`[data-module-select="${id}"]`);
    assert.equal($(`[data-module-select="${id}"]`).getAttribute('aria-pressed'),'true');
    assert.ok($('[data-field="moduleX"][data-scope="module"]'));
    assert.equal($('[data-field="name"][data-scope="tool"]'),null,'a container selection does not expose an unrelated tool name');
    assert.equal(section('module-options').open,false);
  }
  section('assembly-tools').open=true;click('.tool-list [data-select="tool"]');
  assert.equal($('[data-field="name"][data-scope="tool"]').value,fixture.tools[0].name);
  section('assembly-modules').open=false;action('grid');assert.equal(store(),before);
});

test('a collapsed dialog summary participates in the keyboard focus loop and Escape closes the dialog',async()=>{
  const before=store(),modal=openModal({title:'Nastavení',body:'<details><summary data-test-summary>Rozměry a poloha</summary><input aria-label="Skrytý rozměr"></details>'});
  const close=modal.el.querySelector('[data-modal-close]'),summary=modal.el.querySelector('summary');
  // happy-dom has no layout: supply only the two rectangles a browser exposes
  // for this closed disclosure. Its input stays absent from the focus loop.
  for(const el of [close,summary])el.getClientRects=()=>[{x:0,y:0,width:44,height:44}];
  await paint();summary.focus();
  const tab=new win.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});summary.dispatchEvent(tab);
  assert.equal(tab.defaultPrevented,true);assert.equal(win.document.activeElement,close,'Tab wraps from the last visible disclosure to Close');
  const backwards=new win.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true});close.dispatchEvent(backwards);
  assert.equal(backwards.defaultPrevented,true);assert.equal(win.document.activeElement,summary,'Shift+Tab includes the summary rather than hidden fields');
  summary.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal($('.modal'),null);assert.equal(store(),before);
});

if(mobile)test('phone navigation keeps grouped settings reachable and preserves the desktop namespace',async()=>{
  const before=store();
  for(const width of [320,390,1024]){
    win.happyDOM.setWindowSize({width,height:844});action('mobile-settings');
    assert.equal($('.app-shell').dataset.mobilePanel,'settings');action('drawer-tab');await paint();
    assert.equal(section('drawer-dimensions').open,true);assert.ok(visibleThroughDisclosures($('[data-field="width"]')));
    action('selection-tab');assert.equal($('.app-shell').dataset.mobilePanel,'tools');assert.equal($('.app-shell').dataset.mobileDetail,'true');assert.ok(section('pocket-settings'));
    action('mobile-tools');assert.equal($('.app-shell').dataset.mobilePanel,'tools');assert.ok(section('assembly-tools'));
    action('mobile-properties');assert.equal($('.app-shell').dataset.mobileDetail,'true');assert.ok(section('pocket-settings'));
    action('mobile-design');
  }
  assert.equal(store(),before);assert.equal(localStorage.getItem('suplik-studio-projects-v1'),'original desktop storage');
  win.happyDOM.setWindowSize({width:1280,height:900});
});
