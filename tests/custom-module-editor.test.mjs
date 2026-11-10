import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {blankProject} from '../dist/model.js';
import {openCustomModuleEditor} from '../dist/custom-module-editor.js';
import {createCustomModule,updateCustomModule} from '../dist/custom-module.js';
import {pocketOutline} from '../dist/finger-grip.js';
import {pocketLayoutOutline,pocketFloorOutlines} from '../dist/pocket-wall.js';
import {setLang} from '../dist/i18n.js';

const win=new Window({url:'http://localhost:5173'});
win.document.write('<div id="modal-root"></div>');
for(const key of ['window','document','localStorage','HTMLElement','SVGElement'])globalThis[key]=key==='window'?win:win[key];
globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
setLang('cs',{save:false});
const $=selector=>document.querySelector(selector);
const copy=value=>JSON.parse(JSON.stringify(value));
const field=key=>$(`[data-custom-field="${key}"]`);
function typed(key,value,type='input'){field(key).value=String(value);field(key).dispatchEvent(new win.Event(type,{bubbles:true}));}
const click=selector=>{assert.ok($(selector),selector);$(selector).click();};
function layout(){const svg=$('.cme-preview');svg.getBoundingClientRect=()=>({left:40,top:30,width:600,height:420,right:640,bottom:450});const captured=new Set();svg.setPointerCapture=id=>captured.add(id);svg.releasePointerCapture=id=>captured.delete(id);return svg;}
function pointer(type,target,x,y,extra={}){const [vx,vy,vw,vh]=$('.cme-preview').getAttribute('viewBox').split(' ').map(Number),scale=Math.min(600/vw,420/vh),clientX=40+(600-vw*scale)/2+(x-vx)*scale,clientY=30+(420-vh*scale)/2+(y-vy)*scale;target.dispatchEvent(new win.PointerEvent(type,{pointerId:1,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX,clientY,bubbles:true,cancelable:true,...extra}));}
const key=eventKey=>$('.cme-preview').dispatchEvent(new win.KeyboardEvent('keydown',{key:eventKey,bubbles:true,cancelable:true}));

test('custom module editor works on isolated physical geometry drafts',async t=>{
  t.after(async()=>{await win.happyDOM.close();});
  await t.test('each shape saves dimensions, margin, depth, names and label synchronously',()=>{
    for(const shape of ['rectangle','rounded-rect','ellipse','polygon']){
      const project=blankProject(),before=copy(project);let saved;
      const modal=openCustomModuleEditor({project,onSave:options=>saved=options});layout();
      typed('shape',shape,'change');typed('width','126 mm');typed('height','84 mm');typed('pocketWidth','80 mm');typed('pocketHeight','40 mm');typed('depth','7 mm');typed('name','Moje zásuvka');typed('pocketName','Volné díly');typed('label','M3-M5');
      assert.equal($('[data-custom-save]').disabled,false,$('[data-custom-error]').textContent);
      assert.ok($('.cme-pocket').getAttribute('d').includes('L'),'preview uses actual outline vertices');
      assert.ok($('.cme-print-label path'),'preview contains the real manufacturing label polygons');
      assert.deepEqual(project,before,'no mutation before Save');assert.equal(saved,undefined);
      click('[data-custom-save]');assert.equal($('#modal-root').children.length,0,'Save closes synchronously');
      assert.equal(saved.shape,shape);assert.equal(saved.width,126);assert.equal(saved.height,84);assert.equal(saved.pocketWidth,80);assert.equal(saved.pocketHeight,40);assert.equal(saved.depth,7);assert.equal(saved.pocketMargin,0);assert.equal(saved.name,'Moje zásuvka');assert.equal(saved.pocketName,'Volné díly');assert.equal(saved.label,'M3-M5');assert.deepEqual(project,before);modal.close();
    }
  });
  await t.test('incomplete and out-of-wall dimensions cannot save; correcting restores valid Save',()=>{
    let calls=0;const modal=openCustomModuleEditor({project:blankProject(),onSave:()=>calls++});
    typed('pocketWidth','');assert.equal($('[data-custom-save]').disabled,true);assert.ok($('[data-custom-error]').textContent);click('[data-custom-save]');assert.equal(calls,0);
    typed('pocketWidth','100 mm');assert.equal($('[data-custom-save]').disabled,true);assert.match($('[data-custom-error]').textContent,/stěny/);
    typed('width','126 mm');assert.equal($('[data-custom-save]').disabled,false);typed('pocketMargin','0,8 mm');assert.equal(modal.getDraft().pocketMargin,.8);
    typed('depth','100 mm');assert.equal($('[data-custom-save]').disabled,true);typed('depth','6 mm');assert.equal($('[data-custom-save]').disabled,false);modal.close();
  });
  await t.test('cancel, backdrop and close discard all changes',()=>{
    const project=blankProject(),before=copy(project);let calls=0;
    for(const selector of ['[data-custom-cancel]','[data-modal-close]','.modal-backdrop']){
      openCustomModuleEditor({project,onSave:()=>calls++});typed('name','Changed');typed('shape','polygon','change');key('Insert');click(selector);assert.equal($('#modal-root').children.length,0);assert.deepEqual(project,before);assert.equal(calls,0);
    }
  });
  await t.test('mouse, pen and touch edit a real polygon vertex in millimetres',()=>{
    for(const pointerType of ['mouse','pen','touch']){
      let saved;const modal=openCustomModuleEditor({project:blankProject(),onSave:options=>saved=options});
      typed('shape','rectangle','change');typed('shape','polygon','change');const svg=layout();click('[data-custom-point="add"]');
      assert.equal(modal.getDraft().points.length,5);
      pointer('pointerdown',$('[data-custom-vertex="1"]'),42,12,{pointerType});pointer('pointermove',svg,45,17,{pointerType});pointer('pointerup',svg,45,17,{pointerType});
      assert.deepEqual(modal.getDraft().points[1],{x:33,y:5});assert.equal(Number(field('pointX').value),33);assert.equal(Number(field('pointY').value),5);click('[data-custom-save]');assert.deepEqual(saved.points[1],{x:33,y:5});
    }
  });
  await t.test('numeric point input and keyboard actions update the contour, reject self crossings and keep recovery visible',()=>{
    const modal=openCustomModuleEditor({project:blankProject()});typed('shape','rectangle','change');typed('shape','polygon','change');layout();
    key('Insert');assert.equal(modal.getDraft().points.length,5);key('ArrowDown');assert.equal(modal.getDraft().points[1].y,.5);key('Delete');assert.equal(modal.getDraft().points.length,4);
    typed('pointX','60 mm');typed('pointY','60 mm');assert.equal($('[data-custom-save]').disabled,true);assert.ok($('[data-custom-error]').textContent);assert.ok($('[data-custom-vertex="1"]'),'invalid polygon keeps draggable correction targets');
    typed('pointX','60 mm');typed('pointY','0 mm');assert.equal($('[data-custom-save]').disabled,false);modal.close();
  });
  await t.test('dragging an extremal vertex keeps the actual preview handle under the pointer',()=>{
    const modal=openCustomModuleEditor({project:blankProject()});typed('shape','rectangle','change');typed('shape','polygon','change');const svg=layout();
    pointer('pointerdown',$('[data-custom-vertex="0"]'),12,12);pointer('pointermove',svg,7,12);
    assert.equal(Number($('[data-custom-vertex="0"] .cme-point-dot').getAttribute('cx')),7,'bbox recentring must not halve visible movement');
    pointer('pointerup',svg,7,12);assert.equal(modal.getDraft().points[0].x,-10);assert.equal(Number(field('pocketWidth').value),70);modal.close();
  });
  await t.test('overlapping touch hit targets select the closest actual vertex on a dense curved outline',()=>{
    const modal=openCustomModuleEditor({project:blankProject()});typed('shape','ellipse','change');typed('shape','polygon','change');const svg=layout();
    // A later transparent target can cover the intended top vertex; geometry wins over stacking.
    pointer('pointerdown',$('[data-custom-vertex="95"]'),42,12,{pointerType:'touch'});
    assert.equal($('[data-custom-point-title]').textContent,'Bod 73');
    pointer('pointerup',svg,42,12,{pointerType:'touch'});modal.close();
  });
  await t.test('pointer cancel, blur and multiple touches roll back the current gesture',()=>{
    for(const cancel of ['pointercancel','blur','second-touch']){
      const modal=openCustomModuleEditor({project:blankProject()});typed('shape','rectangle','change');typed('shape','polygon','change');const svg=layout();click('[data-custom-point="add"]');const before=modal.getDraft();
      pointer('pointerdown',$('[data-custom-vertex="1"]'),42,12,{pointerType:'touch'});pointer('pointermove',svg,45,17,{pointerType:'touch'});
      if(cancel==='blur')win.dispatchEvent(new win.Event('blur'));
      else if(cancel==='second-touch')pointer('pointerdown',svg,50,20,{pointerType:'touch',pointerId:2});
      else pointer('pointercancel',svg,45,17,{pointerType:'touch'});
      assert.deepEqual(modal.getDraft().points,before.points,cancel);modal.close();
    }
  });
  await t.test('label planner exposes unsupported characters and lack of space without inventing a label',()=>{
    const modal=openCustomModuleEditor({project:blankProject()});typed('label','Měřítko');assert.match($('[data-custom-label-status]').textContent,/nepodporovaný znak/);assert.equal($('.cme-print-label'),null);
    typed('label','M3');assert.ok($('.cme-print-label'));typed('pocketWidth','78');typed('pocketHeight','78');assert.match($('[data-custom-label-status]').textContent,/dost bezpečného místa/);assert.equal($('.cme-print-label'),null);modal.close();
  });
  await t.test('reopening reads saved physical dimensions; a failed final validation leaves draft open',()=>{
    const result=createCustomModule(blankProject(),{name:'Saved',pocketName:'Pocket',shape:'ellipse',width:126,height:84,pocketWidth:80,pocketHeight:40,depth:6,pocketMargin:0,label:'10'});
    let calls=0;const modal=openCustomModuleEditor({project:result.project,moduleId:result.moduleId,onSave:()=>{calls++;throw Error('Revision changed');}});
    assert.equal(Number(field('width').value),126);assert.equal(Number(field('pocketWidth').value),80);assert.equal(field('name').value,'Saved');click('[data-custom-save]');assert.equal(calls,1);assert.match($('[data-custom-error]').textContent,/Revision changed/);assert.equal($('#modal-root').children.length,1);modal.close();
  });
  await t.test('existing rotation, off-centre placement, finger grips and label style preview exactly the saved geometry',()=>{
    const result=createCustomModule(blankProject(),{name:'Rotated',shape:'ellipse',width:126,height:126,pocketWidth:60,pocketHeight:20,depth:6,label:'10'}),source=result.project,tool=source.tools[0];
    tool.rotation=37;tool.x=20;tool.y=35;tool.fingerGrips=[{id:'grip',x:30,y:0,radius:4}];tool.labelStyle={size:4};
    let saved;const modal=openCustomModuleEditor({project:source,moduleId:result.moduleId,onSave:options=>saved=updateCustomModule(source,result.moduleId,options)}),preview=$('.cme-pocket').getAttribute('d');
    assert.equal($('[data-custom-save]').disabled,false,$('[data-custom-error]').textContent);click('[data-custom-save]');
    const actual=pocketOutline(saved.project.tools[0],saved.project),expected=actual.map((point,index)=>`${index?'L':'M'}${point.x},${point.y}`).join(' ')+'Z';
    assert.equal(preview,expected);assert.equal(saved.project.tools[0].rotation,37);assert.deepEqual(saved.project.tools[0].fingerGrips,tool.fingerGrips);modal.close();
  });
  await t.test('all wall profiles save their real angle or radius, and preview both top envelope and floor',()=>{
    for(const [type,value] of [['draft',10],['chamfer',1.5],['roundTop',2],['roundBottom',2]]){
      let saved;const modal=openCustomModuleEditor({project:blankProject(),onSave:options=>saved=createCustomModule(blankProject(),options)});
      typed('shape','rectangle','change');typed('wallType',type,'change');typed('wallValue',value);assert.equal($('[data-custom-save]').disabled,false,$('[data-custom-error]').textContent);
      assert.equal($('.cme-wall-section').hidden,false);assert.ok($('[data-custom-wall-section] .cme-section-profile'));assert.ok($('.cme-floor'));
      const top=$('.cme-pocket').getAttribute('d'),floor=$('.cme-floor').getAttribute('d');click('[data-custom-save]');
      const tool=saved.project.tools[0],makePath=points=>points.map((point,index)=>`${index?'L':'M'}${point.x},${point.y}`).join(' ')+'Z';
      assert.deepEqual(tool.pocketWall,{type,value});assert.equal(top,makePath(pocketLayoutOutline(tool,saved.project)));assert.equal(floor,makePath(pocketFloorOutlines(tool,saved.project)[0]));
      modal.close();
    }
  });
  await t.test('wall profile validation rejects insufficient shell space, excessive radius and a collapsed floor',()=>{
    const modal=openCustomModuleEditor({project:blankProject()});typed('shape','rectangle','change');typed('pocketWidth',78);typed('pocketHeight',78);assert.equal($('[data-custom-save]').disabled,false);
    typed('wallType','draft','change');assert.equal($('[data-custom-save]').disabled,true);assert.match($('[data-custom-error]').textContent,/stěny/);
    typed('width',126);typed('height',126);assert.equal($('[data-custom-save]').disabled,false);
    typed('wallType','roundTop','change');typed('wallValue','13 mm');assert.equal($('[data-custom-save]').disabled,true);assert.match($('[data-custom-error]').textContent,/hloubka/);
    typed('wallType','roundBottom','change');typed('pocketWidth',3);typed('pocketHeight',3);assert.equal($('[data-custom-save]').disabled,true);assert.match($('[data-custom-error]').textContent,/příliš velké/);
    typed('wallType','vertical','change');assert.equal($('[data-custom-save]').disabled,false);assert.equal($('.cme-wall-section').hidden,true);assert.equal(modal.getDraft().pocketWall,null);modal.close();
  });
  await t.test('wall angle remains in degrees when display lengths use inches; vertical clears the profile',()=>{
    const project={...blankProject(),unit:'in'};let saved;const modal=openCustomModuleEditor({project,onSave:options=>saved=options});
    typed('wallType','chamfer','change');assert.equal($('[data-custom-wall-unit]').textContent,'in');typed('wallValue','0.1 in');assert.equal(modal.getDraft().pocketWall.value,2.54);
    typed('wallType','draft','change');assert.equal($('[data-custom-wall-unit]').textContent,'°');typed('wallValue','12,5');assert.equal(modal.getDraft().pocketWall.value,12.5);
    typed('wallValue','');assert.equal($('[data-custom-save]').disabled,true);typed('wallType','vertical','change');assert.equal($('[data-custom-save]').disabled,false);click('[data-custom-save]');assert.equal(saved.pocketWall,null);
  });
  await t.test('reopening every saved wall profile selects its stored type and untouched Save preserves the profile',()=>{
    for(const [type,value] of [['draft',10],['chamfer',1.5],['roundTop',2],['roundBottom',2]]){
      const project=createCustomModule(blankProject(),{shape:'rectangle',width:126,height:126,pocketWidth:60,pocketHeight:40,depth:8,pocketWall:{type,value}}),before=copy(project.project);let saved;
      const modal=openCustomModuleEditor({project:project.project,moduleId:project.moduleId,onSave:options=>saved=updateCustomModule(project.project,project.moduleId,options)});
      assert.deepEqual(modal.getDraft().pocketWall,{type,value});assert.equal(field('wallType').value,type,'the displayed selector agrees with the stored draft');assert.equal(Number(field('wallValue').value),value);
      click('[data-custom-save]');assert.deepEqual(saved.project.tools[0].pocketWall,before.tools[0].pocketWall);assert.equal($('#modal-root').children.length,0);modal.close();
    }
  });
});
