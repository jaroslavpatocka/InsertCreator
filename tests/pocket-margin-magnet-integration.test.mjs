import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
const win=new Window({url:'http://localhost:5173'});
win.document.write('<body><div id="modal-root"></div><div id="toast"></div></body>');
for(const key of ['window','document','localStorage','HTMLElement'])globalThis[key]=key==='window'?win:win[key];
globalThis.requestAnimationFrame=()=>0;
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');
const {blankProject,validateProject}=await import('../dist/model.js');
const {planPocketMagnets,openPocketMagnetDialog}=await import('../dist/tool-magnet-ui.js');
const {validateLayout}=await import('../dist/geometry.js');
const {closeModal}=await import('../dist/ui.js');
after(()=>win.happyDOM.abort());
const magnet={id:'magnet',x:3,y:40,diameter:6,height:2};
function fixture(override){return validateProject({...blankProject(),id:'margin-and-magnet',width:84,height:126,clearance:2,printMode:'solid',
  modules:[{id:'module',name:'Zero inherited margin',x:0,y:0,width:84,height:126,pocketMargin:0}],
  tools:[{id:'thin',name:'Thin tool',moduleId:'module',points:[{x:0,y:0},{x:6,y:0},{x:6,y:80},{x:0,y:80}],x:20,y:20,rotation:0,depth:8,fingerGrips:[],...(override===undefined?{}:{pocketMargin:override})}]});}
function open(project){return openPocketMagnetDialog({project,tool:project.tools[0],unit:'mm',errorText:error=>error.message,onSave:()=>{}});}
const shownWidth=modal=>{const path=modal.el.querySelector('[data-magnet-canvas] .grip-pocket').getAttribute('d'),numbers=path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number),xs=numbers.filter((_,i)=>i%2===0);return Math.max(...xs)-Math.min(...xs);};

test('magnet validation uses inherited module zero rather than a larger legacy drawer margin',()=>{
  const project=fixture(),before=structuredClone(project);
  assert.throws(()=>planPocketMagnets(project,'thin',[magnet]),/stěny|dno/);
  assert.deepEqual(project,before,'a magnet rejected by the actual pocket cannot change the drawer');
  const override=fixture(2),plan=planPocketMagnets(override,'thin',[magnet]);
  assert.deepEqual(validateLayout(plan.project),[]);assert.equal(plan.project.clearance,2);assert.equal(plan.project.modules[0].pocketMargin,0);assert.equal(plan.project.tools[0].pocketMargin,2);
});

test('magnet dialog preview and automatic placement use the same module/tool margin as validation',()=>{
  const zero=open(fixture());assert.equal(shownWidth(zero),6);assert.equal(zero.el.querySelectorAll('.magnet-mark').length,0);assert.match(zero.el.querySelector('[data-magnet-error]').textContent,/nevejdou/);closeModal();
  const wide=open(fixture(2));assert.ok(Math.abs(shownWidth(wide)-10)<1e-7);assert.equal(wide.el.querySelectorAll('.magnet-mark').length,1);assert.equal(wide.el.querySelector('[data-magnet-error]').textContent,'');closeModal();
});
