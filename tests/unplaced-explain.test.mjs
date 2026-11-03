import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';

// Memory rule: compare ids, counts, booleans and strings only — never DOM elements or whole projects.
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
const $=selector=>win.document.querySelector(selector);
const click=selector=>{const el=$(selector);assert.ok(el,'Missing '+selector);el.click();};
const action=name=>click(`#app [data-action="${name}"]`);
const saved=()=>JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id===JSON.parse(localStorage.getItem('suplik-studio-current')));
const change=(selector,value)=>{const element=$(selector);assert.ok(element,'Missing '+selector);element.value=String(value);element.dispatchEvent(new win.Event('change',{bubbles:true}));};
const closeModals=()=>{while($('#modal-root [data-modal-close]'))click('#modal-root [data-modal-close]');};
const createDrawerFromUI=(name,width,height)=>{closeModals();action('projects');click('[data-new]');change('[data-field=drawerName]',name);change('[data-field=drawerWidth]',width);change('[data-field=drawerHeight]',height);click('[data-create-drawer]');closeModals();return saved();};
const addRect=(w,h)=>{action('add-shape');change('#shape-type','rect');change('[data-field=shapeWidth]',w);change('[data-field=shapeHeight]',h);click('[data-confirm]');closeModals();};
const unplacedIds=()=>{const p=saved();return p.tools.filter(t=>!p.modules.some(m=>m.id===t.moduleId)).map(t=>t.id);};
const issueText=()=>$('#app .issue-box[role=status]')?.textContent??'';
await import('../dist/app.js');

test('tools longer than the print bed collapse into one explained line',()=>{
  const p=createDrawerFromUI('Klíče',588,420);assert.equal(p.limitToBed,true);
  for(let i=0;i<3;i++)addRect(20,235);
  assert.equal(unplacedIds().length,3,'235 mm + wall cannot get a module on a 220 mm bed');
  const text=issueText();
  assert.match(text,/3 nástroje jsou delší než tisková plocha 220 × 220 mm/);
  assert.doesNotMatch(text,/zatím nemá umístěný modul/);
  assert.doesNotMatch(text,/nevešl/);
  assert.ok($('#app .issue-box[role=status] [data-action=print-bed]'));
  assert.ok($('#app .issue-box[role=status] [data-action=auto]'));
});

test('the selected unplaced tool explains why and the button opens the print bed settings',()=>{
  const id=unplacedIds()[0];click(`#app [data-select="${id}"]`);
  const note=$('#app .unplaced-why');assert.ok(note,'Explanation in the selected-tool panel');
  assert.match(note.textContent,/delší než tisková plocha 220 × 220 mm/);
  click('#app .unplaced-why [data-action=print-bed]');
  const details=$('#modal-root details.advanced');assert.ok(details,'Export dialog with printer settings');
  assert.equal(details.open,true);assert.ok(details.querySelector('[data-field=bedWidth]'));
  closeModals();
});

test('a tool that fits the bed is not blamed on it',()=>{
  // Turning the bed limit off leaves a plain "no room" / placed state, never the bed explanation.
  action('export');const box=$('#limit-bed');assert.ok(box);box.checked=false;box.dispatchEvent(new win.Event('change',{bubbles:true}));closeModals();
  assert.equal(saved().limitToBed,false);
  assert.doesNotMatch(issueText(),/tisková plocha/);
  action('auto');assert.equal(unplacedIds().length,0);assert.ok($('#app .issue-box[role=status]')===null);
});

test('no free room and larger than the drawer are told apart',()=>{
  createDrawerFromUI('Malý',100,100);
  // Rectangles get automatic finger grips, so a 40 mm square needs an 84 mm module: one fits a 100 mm drawer, the second does not.
  addRect(40,40);addRect(40,40);addRect(150,20);
  const text=issueText();
  assert.match(text,/1 nástroj se nevešel do šuplíku/);
  assert.match(text,/1 nástroj je větší než šuplík 100 × 100 mm/);
  assert.ok($('#app .issue-box[role=status] [data-action=expand]'));
  assert.ok($('#app .issue-box[role=status] [data-action=print-bed]')===null,'No bed action without a bed cause');
  const p=saved(),big=p.tools.find(t=>!p.modules.some(m=>m.id===t.moduleId)&&Math.max(...t.points.map(q=>q.x))-Math.min(...t.points.map(q=>q.x))>140);
  assert.ok(big);click(`#app [data-select="${big.id}"]`);
  assert.match($('#app .unplaced-why').textContent,/větší než šuplík/);assert.ok($('#app .unplaced-why [data-action=expand]'));
});

test('English explanation',()=>{
  click('#app .topbar [data-action=set-lang][data-value=en]');
  try{
    assert.match(issueText(),/1 tool did not fit into the drawer/);
    assert.match(issueText(),/1 tool is larger than the drawer/);
  }finally{click('#app .topbar [data-action=set-lang][data-value=cs]');}
});
