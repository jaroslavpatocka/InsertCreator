import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
import {createCanvas} from '@napi-rs/canvas';
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
win.HTMLCanvasElement.prototype.getContext=function(type){return type==='2d'?createCanvas(this.width||300,this.height||150).getContext('2d'):null;};
localStorage.setItem('suplik-studio-lang','"cs"');localStorage.setItem('suplik-studio-unit','"mm"');

const roughPoints=[{x:0,y:0},{x:20,y:0}];
for(let y=1;y<80;y++)roughPoints.push({x:20+.22*Math.sin(y*1.8),y});
roughPoints.push({x:20,y:80},{x:0,y:80});
for(let y=79;y>0;y--)roughPoints.push({x:.22*Math.sin(y*1.5),y});
const rectangle=[{x:0,y:0},{x:20,y:0},{x:20,y:80},{x:0,y:80}];
const initial=validateProject({...blankProject(),id:'contour-ui',name:'Vyhlazení uložené kontury',width:420,height:336,
  modules:[{id:'shared',name:'Uložené nástroje',x:0,y:0,width:252,height:168,sizeMode:'manual',grouped:true}],
  tools:[{id:'rough',name:'Zubatý nástroj',x:35,points:roughPoints},{id:'locked',name:'Zamčený nástroj',x:90,points:roughPoints,locked:true},
    {id:'smooth',name:'Rovný nástroj',x:145,points:rectangle}].map(tool=>({...tool,y:40,rotation:0,depth:8,moduleId:'shared',fingerGrips:[]}))});
assert.deepEqual(validateLayout(initial),[]);
localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([initial]));localStorage.setItem('suplik-studio-current','"contour-ui"');
await import('../dist/app.js');
after(()=>win.happyDOM.abort());

const $=selector=>win.document.querySelector(selector);
const state=()=>{const project=JSON.parse(localStorage.getItem('suplik-studio-projects-v1')).find(p=>p.id==='contour-ui');delete project.updatedAt;return project;};
const click=element=>{assert.ok(element,'expected an available UI control');if(typeof element.click==='function')element.click();else element.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));};
const action=name=>click($(`#app [data-action="${name}"]`));
function select(id){
  click($(`#board-svg [data-tool="${id}"]`));
  const section=$('[data-inspector-section="tool-shape"]');assert.ok(section,'tool shape details must be available');section.open=true;
  const button=section.querySelector('[data-action="smooth-contour"]');assert.ok(button,'smoothing belongs to the selected tool shape controls');return button;
}
function shaftRoughness(points){
  const sides=[[],[]];
  for(let y=10.5;y<70;y++){
    const crossings=[];
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length];
      if((a.y<=y&&b.y>y)||(b.y<=y&&a.y>y))crossings.push(a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y));
    }
    crossings.sort((a,b)=>a-b);assert.equal(crossings.length,2);sides[0].push(crossings[0]);sides[1].push(crossings[1]);
  }
  return Math.sqrt(sides.reduce((sum,values)=>{const mean=values.reduce((a,b)=>a+b,0)/values.length;return sum+values.reduce((a,b)=>a+(b-mean)**2,0)/values.length;},0)/2);
}

test('selected saved contour can be smoothed from its inspector and restored with one undo',()=>{
  const before=state(),button=select('rough');assert.equal(button.disabled,false);
  assert.equal($('#app [data-action="undo"]').disabled,true);
  click(button);
  const next=state();assert.notDeepEqual(next.tools[0].points,before.tools[0].points,'the repaired contour must be persisted');
  assert.ok(shaftRoughness(next.tools[0].points)<shaftRoughness(before.tools[0].points)*.5,'the saved shaft must become materially straighter');
  assert.deepEqual(next.tools.slice(1),before.tools.slice(1));assert.deepEqual(next.modules,before.modules);
  assert.deepEqual(validateLayout(next),[]);
  assert.match($('#toast').textContent,/Obrys vyhlazen/);
  assert.equal($('#app [data-action="undo"]').disabled,false);
  action('undo');assert.deepEqual(state(),before,'one undo restores every original point and project property');
  assert.equal($('#app [data-action="undo"]').disabled,true,'smoothing creates exactly one history entry');
});

test('locked selected tool disables contour smoothing and leaves persistence and undo unchanged',()=>{
  const before=state(),button=select('locked');assert.equal(button.disabled,true);
  click(button);assert.deepEqual(state(),before);assert.equal($('#app [data-action="undo"]').disabled,true);
});

test('an already regular contour does not create an empty undo entry',()=>{
  const before=state(),button=select('smooth');assert.equal(button.disabled,false);
  click(button);assert.deepEqual(state(),before);assert.equal($('#app [data-action="undo"]').disabled,true);
  assert.match($('#toast').textContent,/Obrys se nezměnil/);
});
