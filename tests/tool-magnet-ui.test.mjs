import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';

const win=new Window({url:'http://localhost:5173'});
win.document.write('<body><div id="modal-root"></div><div id="toast"></div></body>');
for(const key of ['window','document','localStorage','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
globalThis.requestAnimationFrame=()=>0;
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');

const {blankProject}=await import('../dist/model.js');
const {openPocketMagnetDialog,planPocketMagnets,pocketMagnetEffect,pocketMagnetMarks,pocketMagnetPanel}=await import('../dist/tool-magnet-ui.js');
const {closeModal}=await import('../dist/ui.js');
const {setLang,t}=await import('../dist/i18n.js');

const fixture=(extra={},tool={})=>({...blankProject(),width:252,height:84,printMode:'solid',modules:[{id:'mod',name:'Module',x:0,y:0,width:252,height:84}],tools:[{id:'t',name:'Klíč',moduleId:'mod',points:[{x:0,y:0},{x:150,y:0},{x:150,y:30},{x:0,y:30}],x:20,y:20,depth:10,...tool}],...extra});
const magnets=[{id:'a',x:75,y:15,diameter:6,height:2}];
const open=(project,overrides={})=>{
  const saved=[];
  const modal=openPocketMagnetDialog({project,tool:project.tools[0],unit:'mm',errorText:error=>error.message,onSave:plan=>saved.push(plan),...overrides});
  return{modal,saved,$:selector=>modal.el.querySelector(selector)};
};
const change=(el,value)=>{el.value=value;el.dispatchEvent(new win.Event('change',{bubbles:true}));};

test('a plan keeps the height when the floor has room and raises it only when needed',()=>{
  const project=fixture(),plan=planPocketMagnets(project,'t',magnets);
  assert.equal(plan.project.insertHeight,20);assert.equal(project.tools[0].pocketMagnets,undefined);
  assert.match(pocketMagnetEffect(plan),/zůstane/);
  const low=planPocketMagnets(fixture({insertHeight:12}),'t',magnets);
  assert.equal(low.project.insertHeight,13.4);assert.match(pocketMagnetEffect(low),/zvýší z 12 mm na 13,4 mm/);
});

test('a light plan reports the thicker module floor and removing magnets clears the field',()=>{
  const plan=planPocketMagnets(fixture({printMode:'light'}),'t',magnets);
  assert.ok(Math.abs(plan.lift-1)<1e-9);assert.match(pocketMagnetEffect(plan),/zesílí o 1 mm/);
  const cleared=planPocketMagnets(fixture({},{pocketMagnets:magnets}),'t',[]);
  assert.equal(Object.hasOwn(cleared.project.tools[0],'pocketMagnets'),false);
});

test('impossible plans explain themselves',()=>{
  assert.throws(()=>planPocketMagnets(fixture(),'t',[{...magnets[0],x:1,y:1}]),/stěny/);
  assert.throws(()=>planPocketMagnets(fixture({},{depth:98}),'t',magnets),/Nejvyšší možná výška/);
  assert.throws(()=>planPocketMagnets(fixture(),'none',magnets),/neexistuje/);
});

test('panel and board marks show exactly the stored holes',()=>{
  const tool={...fixture().tools[0],pocketMagnets:magnets};
  assert.match(pocketMagnetPanel(tool,{unit:'mm'}),/Ø 6 × 2 mm/);
  assert.match(pocketMagnetPanel(tool,{unit:'mm'}),/data-action="pocket-magnets-clear"/);
  assert.equal(/pocket-magnets-clear/.test(pocketMagnetPanel({...tool,pocketMagnets:[]},{unit:'mm'})),false);
  assert.match(pocketMagnetMarks(tool),/cx="95" cy="35" r="3.1"/);
  assert.equal(pocketMagnetMarks({...tool,pocketMagnets:[]}),'');
});

test('the dialog places a default magnet, applies the user size and saves it',()=>{
  const {saved,$}=open(fixture({insertHeight:12}));
  assert.equal($('[data-magnet-canvas]').querySelectorAll('.magnet-mark').length,1);
  assert.match($('[data-magnet-status]').textContent,/Díra Ø 6,2 × 2,2 mm/);
  change($('[data-magnet-field=diameter]'),'10');change($('[data-magnet-field=height]'),'3');
  assert.match($('[data-magnet-status]').textContent,/Díra Ø 10,2 × 3,2 mm/);
  assert.match($('[data-magnet-status]').textContent,/zvýší z 12 mm na 14,4 mm/);
  $('[data-magnets-save]').click();
  assert.equal(saved.length,1);
  const [magnet]=saved[0].project.tools[0].pocketMagnets;
  assert.equal(magnet.diameter,10);assert.equal(magnet.height,3);assert.equal(saved[0].project.insertHeight,14.4);
});

test('count re-spreads the holes and a position outside the floor blocks saving',()=>{
  const {saved,$}=open(fixture());
  change($('[data-magnet-count]'),'3');
  assert.equal($('[data-magnet-canvas]').querySelectorAll('.magnet-mark').length,3);
  change($('[data-magnet-field=x-0]'),'500');
  assert.match($('[data-magnet-error]').textContent,/stěny/);
  $('[data-magnets-save]').click();
  assert.equal(saved.length,0);
  closeModal();
});

test('a magnet too wide for the tool shows the reason instead of a broken preview',()=>{
  const {$}=open(fixture({},{points:[{x:0,y:0},{x:150,y:0},{x:150,y:4},{x:0,y:4}]}));
  assert.match($('[data-magnet-error]').textContent,/nevejdou/);
  assert.equal($('[data-magnet-canvas]').querySelectorAll('.magnet-mark').length,0);
  closeModal();
});

test('every message of the dialog and the print notes has an English translation',()=>{
  setLang('en',{save:false});
  try{
    assert.equal(t('Magnety v kapse'),'Magnets in the pocket');
    assert.match(t('Výška vložky se zvýší z {from} na {to}.',{from:'1',to:'2'}),/goes up from 1 to 2/);
  }finally{setLang('cs',{save:false});}
});
