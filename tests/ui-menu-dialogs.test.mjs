import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject,validateProject} from '../dist/model.js';

// DOM interactions verify disclosure/focus behavior, not rendered browser geometry.
const mobile=import.meta.url.includes('/mobil/tests/'),prefix=mobile?'insertcreator-mobile:':'';
const win=new Window({url:mobile?'http://localhost:5174':'http://localhost:5173'});
win.happyDOM.setWindowSize({width:1280,height:900});
win.document.write((await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(fn,delay,...args)=>{const timer=nativeTimeout(fn,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
globalThis.requestAnimationFrame=fn=>setTimeout(()=>fn(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;
win.scrollTo=()=>{};win.HTMLElement.prototype.scrollIntoView=()=>{};win.HTMLCanvasElement.prototype.getContext=()=>null;
localStorage.setItem(prefix+'suplik-studio-lang','"cs"');localStorage.setItem(prefix+'suplik-studio-unit','"mm"');
const fixture=validateProject({...blankProject(),id:'menu-dialogs',name:'Menu dialogs',width:336,height:252,sizeLabels:false,
  modules:[{id:'tool-module',name:'Nástrojový modul',x:0,y:0,width:126,height:126,sizeMode:'manual'},{id:'blank-module',name:'Výplň',x:168,y:0,width:84,height:84,sizeMode:'manual'}],
  tools:[{id:'tool',name:'Zkušební nástroj',points:[{x:0,y:0},{x:20,y:0},{x:20,y:60},{x:0,y:60}],x:20,y:20,rotation:0,depth:8,moduleId:'tool-module',fingerGrips:[]}]});
localStorage.setItem(prefix+'suplik-studio-projects-v1',JSON.stringify([fixture]));localStorage.setItem(prefix+'suplik-studio-current',JSON.stringify(fixture.id));
await import('../dist/app.js');
const $=selector=>win.document.querySelector(selector),$$=selector=>[...win.document.querySelectorAll(selector)];
const click=selector=>{const el=typeof selector==='string'?$(selector):selector;assert.ok(el,'Missing '+selector);el.click();};
const action=name=>click(`#app [data-action="${name}"]`);
const saved=()=>JSON.parse(localStorage.getItem(prefix+'suplik-studio-projects-v1')).find(project=>project.id===fixture.id);
const logical=()=>{const project=saved();delete project.updatedAt;return project;};
const visible=element=>{assert.ok(element);for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!parent.open)return false;return true;};
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const change=(selector,value)=>{const el=$(selector);assert.ok(el,selector);if(el.type==='checkbox')el.checked=value;else el.value=String(value);el.dispatchEvent(new win.Event('change',{bubbles:true}));};
after(()=>{win.dispatchEvent(new win.Event('pagehide'));win.happyDOM.abort();});

test('export groups start closed, retain expansion and checkbox focus across redraws, and keep export outside groups',async()=>{
  const before=logical();action('export');
  for(const key of ['modules','printer'])assert.equal($(`[data-export-section="${key}"]`).open,false);
  assert.ok(visible($('[data-do-export]')),'the primary export action remains available');
  click('[data-export-section="modules"]>summary');click('[data-export-section="printer"]>summary');
  $('.export-module-list').scrollTop=73;
  $('[data-export-module="blank-module"]').focus();change('[data-export-module="blank-module"]',false);await paint();
  for(const key of ['modules','printer'])assert.equal($(`[data-export-section="${key}"]`).open,true);
  assert.equal(win.document.activeElement,$('[data-export-module="blank-module"]'),'changing a checkbox must preserve its keyboard position');
  assert.equal($('.export-module-list').scrollTop,73);assert.equal($('[data-export-module="blank-module"]').checked,false);
  $('[data-export-select="all"]').focus();click('[data-export-select="all"]');await paint();
  assert.equal(win.document.activeElement,$('[data-export-select="all"]'));
  assert.ok($$('[data-export-module]').every(input=>input.checked));assert.deepEqual(logical(),before,'module selection is presentation state');
  $('.modal [data-field="bedWidth"]').focus();change('.modal [data-field="bedWidth"]',320);await paint();
  assert.equal($('[data-export-section="printer"]').open,true);assert.equal(win.document.activeElement,$('.modal [data-field="bedWidth"]'));
  assert.deepEqual(saved().tools,before.tools);assert.deepEqual(saved().modules,before.modules);assert.equal(saved().bedWidth,320);
  assert.ok(visible($('[data-do-export]')));click('[data-modal-close]');await paint();action('undo');assert.deepEqual(logical(),before);
});

test('floating module menu closes outside or with Escape, and summary keys cannot rotate or delete a tool',()=>{
  const before=logical(),summary=$('.add-module-menu>summary');assert.equal($('.add-module-menu').open,false);
  summary.focus();for(const key of ['r','R','Delete','Backspace'])summary.dispatchEvent(new win.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
  assert.deepEqual(logical(),before);assert.equal($('.modal'),null);
  click(summary);assert.equal($('.add-module-menu').open,true);
  $('.add-module-menu [data-action="add-shape"]').dispatchEvent(new win.PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,pointerType:'touch'}));
  assert.equal($('.add-module-menu').open,true,'an inside pointerdown must not dismiss the action');
  win.document.body.dispatchEvent(new win.PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,pointerType:'touch'}));assert.equal($('.add-module-menu').open,false);
  summary.focus();click(summary);summary.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal($('.add-module-menu').open,false);assert.equal(win.document.activeElement,summary);assert.deepEqual(logical(),before);
});

if(mobile)test('mobile More starts with four closed groups and exposes every existing action after expansion',()=>{
  win.happyDOM.setWindowSize({width:390,height:844});action('mobile-design');const before=logical();action('mobile-more');
  const groups=$$('[data-mobile-menu-group]');assert.equal(groups.length,4);assert.ok(groups.every(group=>!group.open));
  assert.ok(visible($('[data-mobile-menu="export"]')),'export stays directly available');
  for(const group of groups)click(group.querySelector(':scope > summary'));
  for(const name of ['projects','new-drawer','library','save-project','import-json','add-custom-module','add-shape','export','help'])assert.ok(visible($(`[data-mobile-menu="${name}"]`)),name);
  for(const preference of $$('.modal [data-action="set-lang"],.modal [data-action="set-unit"]'))assert.ok(visible(preference));
  assert.ok(visible($('[data-mobile-install]')));click('[data-mobile-menu="projects"]');assert.ok($('[data-new]'),'expanded actions reach the real drawer manager');
  click('[data-modal-close]');assert.deepEqual(logical(),before);win.happyDOM.setWindowSize({width:1280,height:900});
});
