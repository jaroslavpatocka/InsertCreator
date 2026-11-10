import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {blankProject} from '../dist/model.js';
import {openCustomModuleEditor} from '../dist/custom-module-editor.js';
import {openFingerGripEditor} from '../dist/finger-grip-editor.js';
import {bindCaptureContourEditor} from '../dist/capture-contour-editor.js';
import {setLang} from '../dist/i18n.js';

function fixture(t){
  const win=new Window({url:'http://localhost:5173'});
  for(const key of ['document','localStorage','HTMLElement','SVGElement'])globalThis[key]=win[key];
  globalThis.window=win;globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0);
  win.document.body.innerHTML='<div id="modal-root"></div>';
  setLang('cs',{save:false});
  t.after(()=>win.happyDOM.close());
  const $=selector=>win.document.querySelector(selector);
  const typed=(selector,value,type='input')=>{const control=$(selector);assert.ok(control);control.value=String(value);control.dispatchEvent(new win.Event(type,{bubbles:true}));return control;};
  return{win,$,typed};
}

test('custom module settings start compact and preserve the opened group while editing a real draft',t=>{
  const {$,typed}=fixture(t),source=blankProject(),before=structuredClone(source);let saved;
  const modal=openCustomModuleEditor({project:source,onSave:options=>saved=options});
  const groups=[...modal.body.querySelectorAll('[data-custom-section]')];
  assert.equal(groups.length,4);assert.ok(groups.every(group=>!group.open));
  assert.ok(!$('[data-custom-save]').closest('details'),'Save stays outside collapsed groups');
  assert.ok(!$('.cme-preview').closest('details'),'the drawing remains available');
  $('[data-custom-section="module"]>summary').click();
  typed('[data-custom-field="width"]',126);
  assert.equal($('[data-custom-section="module"]').open,true);
  assert.match($('[data-custom-summary="module"]').textContent,/126/);
  assert.equal($('[data-custom-section="pocket"]').open,false);
  assert.deepEqual(source,before,'settings affect only the modal draft');
  $('[data-custom-save]').click();assert.equal(saved.width,126);assert.equal($('#modal-root').children.length,0);modal.close();
});

test('cutout groups remain independent across selection, shape conversion and adding another cutout',t=>{
  const {$,typed}=fixture(t),source={id:'tool',name:'Tool',points:[{x:0,y:0},{x:100,y:0},{x:100,y:20},{x:0,y:20}],depth:8,fingerGrips:[{id:'left',x:0,y:10,radius:9},{id:'right',x:100,y:10,radius:9}]},before=structuredClone(source);let saved;
  const modal=openFingerGripEditor({tool:source,onSave:grips=>saved=grips});
  assert.equal($('[data-grip-section="arrangement"]').open,false);
  assert.ok([...modal.body.querySelectorAll('[data-grip-details]')].every(group=>!group.open));
  assert.ok(!$('[data-grip-add]').closest('details'));assert.ok(!$('[data-grips-save]').closest('details'));
  $('[data-grip-details="left"]>summary').click();
  typed('[data-grip-row="left"] [data-field="fingerShape"]','ellipse','change');
  typed('[data-grip-row="left"] [data-field="fingerWidth"]',24);
  assert.match($('[data-grip-details="left"] [data-grip-size]').textContent,/24/);
  $('[data-grip-select="right"]').click();$('[data-grip-add]').click();
  assert.equal($('[data-grip-details="left"]').open,true,'a redraw keeps the chosen group open');
  assert.equal($('[data-grip-details="right"]').open,false);
  assert.equal([...modal.body.querySelectorAll('[data-grip-details]')].at(-1).open,false);
  assert.deepEqual(source,before);
  $('[data-grips-save]').click();assert.equal(saved[0].shape,'ellipse');assert.equal(saved[0].width,24);assert.equal(saved.length,3);modal.close();
});

test('contour numeric settings open for an intentional resize and reopen a hidden invalid draft for correction',t=>{
  const {win,$}=fixture(t);win.document.body.innerHTML='<div class="capture-canvas"><canvas width="800" height="500"></canvas></div>';
  const canvas=$('canvas');canvas.getBoundingClientRect=()=>({left:100,top:50,width:400,height:250});
  const item={name:'Tool',checked:true,pocketShape:'measured',contour:{points:[{x:100,y:150},{x:600,y:150},{x:600,y:350},{x:100,y:350}]},info:{minX:100,minY:150,width:250,height:100,center:{x:350,y:250}}},original=structuredClone(item.contour);
  const editor=bindCaptureContourEditor(canvas,{getItems:()=>[item],getActiveIndex:()=>0,onSelect:()=>{},getPhotoScale:()=>2,getView:()=>({x:0,y:0,zoom:1})});
  t.after(()=>editor.destroy());
  assert.equal($('[data-contour-section="dimensions"]').open,false);
  for(const action of ['point','smooth','draw','undo','redo'])assert.ok(!$(`[data-contour-action="${action}"]`).closest('details'),'primary editing tools stay available');
  for(const type of ['pointerdown','pointerup'])canvas.dispatchEvent(new win.PointerEvent(type,{bubbles:true,cancelable:true,button:0,buttons:type==='pointerup'?0:1,pointerId:1,pointerType:'mouse',isPrimary:true,clientX:275,clientY:125}));
  $('[data-context-action="width"]').click();
  const group=$('[data-contour-section="dimensions"]'),input=$('[data-contour-field="width"]');
  assert.equal(group.open,true);assert.equal(win.document.activeElement,input);
  input.value='bad';input.dispatchEvent(new win.Event('input',{bubbles:true}));group.querySelector('summary').click();assert.equal(group.open,false);
  assert.equal(editor.validate(),false);assert.equal(group.open,true);assert.equal(win.document.activeElement,input);assert.equal(input.getAttribute('aria-invalid'),'true');
  assert.deepEqual(item.contour,original,'invalid settings cannot alter the original measured contour');
});
