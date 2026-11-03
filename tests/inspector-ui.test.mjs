import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {blankProject,validateProject} from '../dist/model.js';
import {validateLayout} from '../dist/geometry.js';

const win=new Window({url:'http://localhost:5173'});
const html=await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8');
win.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
for(const key of ['window','document','localStorage','Image','ResizeObserver','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
Object.defineProperty(globalThis,'navigator',{value:win.navigator,configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
globalThis.cancelAnimationFrame=clearTimeout;win.scrollTo=()=>{};
const nativeTimeout=globalThis.setTimeout;
globalThis.setTimeout=(callback,delay,...args)=>{const timer=nativeTimeout(callback,delay,...args);if(delay>=4000)timer.unref?.();return timer;};
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
const points=[{x:0,y:0},{x:20,y:0},{x:20,y:80},{x:0,y:80}];
const tools=Array.from({length:12},(_,i)=>({id:'tool-'+i,name:`Dlouhý název nástroje ${i+1}`,points,x:60+i%6*140,y:70+Math.floor(i/6)*140,rotation:0,depth:8,moduleId:'shared',fingerGrips:[]}));
const initial=validateProject({...blankProject(),id:'inspector-review',name:'Dvanáct členů sady',width:1260,height:840,
  modules:[{id:'shared',name:'Společný modul',x:0,y:0,width:1008,height:420,sizeMode:'manual',grouped:true}],tools,
  toolSets:[{id:'set',name:'Velká sada',toolIds:tools.map(t=>t.id),layout:'shared'}]});
assert.deepEqual(validateLayout(initial),[]);
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([initial]));localStorage.setItem('suplik-studio-current','"inspector-review"');
await import('../dist/app.js');
const $=selector=>win.document.querySelector(selector),$$=selector=>[...win.document.querySelectorAll(selector)];
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id==='inspector-review');
const state=()=>{const p=saved();delete p.updatedAt;return p;};
const click=(selector,options={})=>{const el=typeof selector==='string'?$(selector):selector;assert.ok(el,'Missing control '+selector);el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true,...options}));};
const action=name=>click(`#app [data-action="${name}"]`);
const target=id=>`#board-svg .tool-outline[data-tool="${id}"]`;
const checked=()=>$$('[data-tool-check]:checked').map(el=>el.dataset.toolCheck);
function check(id,value){const el=$(`[data-tool-check="${id}"]`);assert.ok(el);el.checked=value;el.dispatchEvent(new win.Event('change',{bubbles:true}));}
const visibleWithoutExpansion=element=>{for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!parent.open)return false;return !element.hidden;};
function assertHighlighted(ids){
  const selected=new Set(ids);
  for(const tool of tools){
    const pocket=$(target(tool.id)),body=$(`#board-svg .tool-body[data-tool="${tool.id}"]`),list=$(`.tool-list [data-select="${tool.id}"]`),member=$(`.module-members [data-select="${tool.id}"]`);
    for(const [element,label] of [[pocket,'pocket'],[body,'body'],[list,'list'],...(member?[[member,'module member']]:[])]){
      assert.ok(element,`${label} ${tool.id} exists`);assert.equal(element.dataset.toolSelected,String(selected.has(tool.id)),`${label} ${tool.id} selected state`);
      assert.equal(element.classList.contains('is-selected'),selected.has(tool.id),`${label} ${tool.id} selected class`);
    }
    for(const element of [pocket,list,...(member?[member]:[])])assert.equal(element.getAttribute('aria-pressed'),String(selected.has(tool.id)));
  }
  const selectedBodies=ids.map(id=>$(`#board-svg .tool-body[data-tool="${id}"]`));
  if(selectedBodies.length>1)assert.equal(new Set(selectedBodies.map(el=>el.getAttribute('fill'))).size,1,'all selected bodies use the same visible fill');
  if(selectedBodies.length&&selected.size<tools.length){const other=tools.find(t=>!selected.has(t.id));assert.notEqual(selectedBodies[0].getAttribute('fill'),$(`#board-svg .tool-body[data-tool="${other.id}"]`).getAttribute('fill'),'selection visibly differs from an unselected neighbour');}
}
after(()=>win.happyDOM.abort());

test('Ctrl, Shift and checkboxes keep every selected silhouette, list row and module member visibly synchronized',()=>{
  const before=state(),stored=localStorage.getItem('suplik-studio-projects-v1');click(target('tool-0'));
  click(target('tool-1'),{ctrlKey:true});assert.deepEqual(checked(),['tool-1']);assertHighlighted(['tool-1']);
  click(target('tool-2'),{shiftKey:true});assert.deepEqual(checked(),['tool-1','tool-2']);assertHighlighted(['tool-1','tool-2']);
  check('tool-0',true);assertHighlighted(['tool-0','tool-1','tool-2']);
  check('tool-1',false);assert.deepEqual(checked(),['tool-0','tool-2']);assertHighlighted(['tool-0','tool-2']);
  assert.deepEqual($$('.bulk-selected-list [data-select]').map(el=>el.dataset.select),['tool-0','tool-2'],'the properties panel names the exact bulk selection');
  action('select-all-tools');assert.equal(checked().length,12);assertHighlighted(tools.map(t=>t.id));
  assert.deepEqual(state(),before);assert.equal(localStorage.getItem('suplik-studio-projects-v1'),stored);
  assert.ok($('#app [data-action="undo"]').disabled,'selection does not create history');
  click(target('tool-3'));assert.deepEqual(checked(),[],'an ordinary click exits bulk selection');assertHighlighted(['tool-3']);
  assert.ok($('[data-field="name"]'),'ordinary selection returns to individual properties');
});

test('selection actions remain outside the independently scrollable settings and operate on the visible selection',()=>{
  const before=state();check('tool-0',true);check('tool-1',true);
  const inspector=$('.inspector'),header=$('.inspector-selection'),scroll=$('.inspector-scroll');
  assert.ok(inspector&&header&&scroll);assert.ok(header.parentElement===inspector,'selection actions are direct inspector content');assert.ok(scroll.parentElement===inspector,'settings have their own inspector region');assert.ok(!scroll.contains(header));
  assert.ok(scroll.getAttribute('aria-label'),'the keyboard-scrollable region has a name');assert.equal(scroll.getAttribute('tabindex'),'0');assert.equal(scroll.getAttribute('role'),'region');
  assert.ok(header.compareDocumentPosition(scroll)&win.Node.DOCUMENT_POSITION_FOLLOWING,'actions appear before the long settings');
  assert.match(header.querySelector('.bulk-heading').textContent,/2/);
  for(const name of ['bulk-rotate','bulk-angle','bulk-move','bulk-delete']){
    const button=header.querySelector(`[data-action="${name}"]`);assert.ok(button,`${name} is in the selection header`);assert.ok(visibleWithoutExpansion(button),`${name} needs no expanded menu`);
    assert.equal($$(`#app [data-action="${name}"]`).length,1,`${name} has one unambiguous control`);
  }
  const secondary=header.querySelector('details.bulk-more');assert.ok(secondary);assert.ok(secondary.querySelector('summary'));assert.ok(secondary.querySelector('.bulk-secondary-actions'));
  assert.ok(secondary.querySelector('[data-action="bulk-align"]'));assert.ok(secondary.querySelector('[data-action="bulk-grips-auto"]'));
  for(const name of ['bulk-flip','bulk-align','bulk-depth','bulk-grips-auto','bulk-grips-clear','bulk-lock','bulk-unlock','bulk-create-set'])assert.equal($$(`#app [data-action="${name}"]`).length,1,`${name} remains a unique available action`);
  assert.deepEqual($$('.bulk-selected-list [data-select]').map(el=>el.dataset.select),['tool-0','tool-1']);
  assert.ok(!$('#drawer-settings [data-field="name"]'),'bulk selection cannot be mistaken for editing one active name');
  scroll.scrollTop=500;action('bulk-rotate');
  assert.deepEqual(saved().tools.slice(0,3).map(t=>t.rotation),[90,90,0]);assert.deepEqual(saved().modules,before.modules);assert.deepEqual(validateLayout(saved()),[]);
  assert.match($('.inspector-selection .bulk-heading').textContent,/2/);assertHighlighted(['tool-0','tool-1']);
  action('undo');assert.deepEqual(state(),before);action('select-no-tools');
});

test('advanced settings and scroll position survive same-context redraws, while a different tool starts at the top',()=>{
  const before=state();click(target('tool-0'));
  const section=$('#drawer-settings details.inspector-section[data-inspector-section]');assert.ok(section,'advanced settings are grouped with a labelled summary');
  const key=section.dataset.inspectorSection;section.open=true;$('.inspector-scroll').scrollTop=230;
  action('grid');
  assert.equal($('.inspector-scroll').scrollTop,230,'a redraw does not throw the user back to the top');
  assert.ok($(`#drawer-settings details[data-inspector-section="${key}"]`).open,'an expanded settings group remains expanded');
  click(target('tool-1'));assert.equal($('.inspector-scroll').scrollTop,0,'a newly selected tool begins with its basic controls');
  const members=$('.module-members > div');assert.ok(members);assert.equal(members.querySelectorAll('[data-select]').length,12,'the complete large set remains available inside the member list');
  assert.ok(members.getAttribute('aria-label'));
  assert.deepEqual(state(),before);action('grid');
});

test('keyboard checkbox selection restores focus across bulk-context redraws without trapping Tab',()=>{
  const before=state();
  const toggleFocused=(id,value)=>{
    const input=$(`[data-tool-check="${id}"]`);assert.ok(input);input.focus();
    assert.ok(win.document.activeElement===input,'the checkbox is focused before editing');
    input.checked=value;input.dispatchEvent(new win.Event('change',{bubbles:true}));
    const restored=$(`[data-tool-check="${id}"]`);assert.ok(restored);
    assert.ok(win.document.activeElement===restored,'focus follows the same checkbox after the inspector redraw');
    assert.equal(win.document.activeElement.dataset.toolCheck,id);assert.equal(restored.checked,value);
    const tab=new win.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});restored.dispatchEvent(tab);
    assert.equal(tab.defaultPrevented,false,'native Tab navigation is not intercepted');
  };
  toggleFocused('tool-4',true);assert.deepEqual(checked(),['tool-4']);assertHighlighted(['tool-4']);assert.match($('.inspector-selection .bulk-heading').textContent,/1/);
  toggleFocused('tool-7',true);assert.deepEqual(checked(),['tool-4','tool-7']);assertHighlighted(['tool-4','tool-7']);assert.match($('.inspector-selection .bulk-heading').textContent,/2/);
  toggleFocused('tool-7',false);assert.deepEqual(checked(),['tool-4']);assertHighlighted(['tool-4']);
  toggleFocused('tool-4',false);assert.deepEqual(checked(),[]);
  assert.deepEqual(state(),before);assert.ok($('#app [data-action="undo"]').disabled,'keyboard selection creates no project edits');
});

test('desktop pane height fits below the real heading and adapts to page scroll, resize and mobile without editing data',async()=>{
  const before=state(),stored=localStorage.getItem('suplik-studio-projects-v1');
  const history=()=>({undo:$('#app [data-action="undo"]').disabled,redo:$('#app [data-action="redo"]').disabled}),priorHistory=history();
  const editor=$('.workbench');assert.ok(editor);
  const originalRect=editor.getBoundingClientRect,originalWidth=win.innerWidth,originalHeight=win.innerHeight;
  const visualViewportDescriptor=Object.getOwnPropertyDescriptor(win,'visualViewport');
  let top=300;editor.getBoundingClientRect=()=>({...originalRect.call(editor),top});
  Object.defineProperty(win,'visualViewport',{value:undefined,configurable:true});
  const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const resize=async(width,height)=>{win.happyDOM.setWindowSize({width,height});win.dispatchEvent(new win.Event('resize'));await paint();};
  const paneHeight=()=>editor.style.getPropertyValue('--editor-pane-height');
  try{
    await resize(1200,768);assert.equal(paneHeight(),'452px','initial view leaves room for the heading and steps');
    top=-40;win.dispatchEvent(new win.Event('scroll'));await paint();assert.equal(paneHeight(),'736px','a pane already at the sticky edge can use the full remaining viewport');
    top=300;await resize(1200,900);assert.equal(paneHeight(),'584px','resizing recalculates available room below the heading');
    await resize(1200,320);assert.equal(paneHeight(),'280px','very short windows keep a usable pane and permit page scrolling');
    await resize(375,768);assert.equal(paneHeight(),'','mobile layout uses its own responsive sizing');
    assert.deepEqual(state(),before);assert.equal(localStorage.getItem('suplik-studio-projects-v1'),stored);assert.deepEqual(history(),priorHistory);
  }finally{
    editor.getBoundingClientRect=originalRect;
    if(visualViewportDescriptor)Object.defineProperty(win,'visualViewport',visualViewportDescriptor);else delete win.visualViewport;
    await resize(originalWidth,originalHeight);
  }
});
