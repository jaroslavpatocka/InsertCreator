import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {createExportPreview} from '../dist/export-preview.js';

const fixture=()=>({width:504,height:378,printMode:'solid',bottomMode:'magnet',connectors:true,multiMaterial:{enabled:true,bodyColor:'#ff0000'},modules:Array.from({length:7},(_,index)=>({id:'m'+index,name:index?'Module '+index:'<unsafe name>',x:index*42,y:0,width:42,height:84})),tools:[{id:'t',moduleId:'m0',name:'Tool',points:[{x:0,y:0},{x:1,y:0},{x:1,y:1}]}]});
const result=index=>({html:`<g data-result="${index}"><polygon points="0,0 1,0 1,1"/></g>`,viewBox:'0 0 10 10',stats:{reducedDetail:false},warnings:[]});
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
function mount(options){
  const win=new Window(),host=win.document.createElement('div');win.document.body.append(host);
  const view=createExportPreview(options);host.innerHTML=view.html;view.mount(host);
  return{win,host,view};
}

test('carousel renders selected modules only, escapes metadata and keeps full manufacturing context',async()=>{
  const project=fixture(),calls=[],before=JSON.stringify(project),client={run:async(operation,source,options)=>{calls.push({operation,source,options});return result(calls.length);}};
  const {host,view}=mount({project,entries:[project.modules[0],project.modules[3]],client});
  project.modules[0].name='edited after opening';await settle();
  assert.equal(host.querySelectorAll('[data-preview-slide]').length,2);
  assert.equal(host.querySelector('.export-preview__caption strong').textContent,'<unsafe name>');assert.equal(host.querySelector('unsafe'),null);
  assert.equal(calls.length,2);assert.equal(calls[0].operation,'preview');
  assert.equal(calls[0].source.modules.length,7,'connector mates must remain available to planning');
  assert.equal(calls[0].source.modules[0].name,'<unsafe name>');assert.equal(calls[0].source.printMode,'solid');assert.equal(calls[0].source.multiMaterial.enabled,true);
  assert.equal(calls[0].options.lang,'cs');assert.equal(calls[0].options.unit,'mm');
  assert.deepEqual(calls.map(call=>call.source.previewModuleIds),[['m0'],['m3']]);
  assert.equal(calls[0].source.previewCuts,false);assert.equal(host.querySelectorAll('svg').length,2);
  assert.equal(before.includes('previewModuleIds'),false);assert.equal(project.previewModuleIds,undefined);
  view.dispose();
});

test('previous/next and keyboard navigate all modules while retaining at most three generated SVGs',async()=>{
  const calls=[],client={run:async(_operation,source)=>{calls.push(source.previewModuleIds[0]);return result(calls.length);}};
  const {host,view,win}=mount({project:fixture(),client});await settle();
  assert.deepEqual(calls,['m0','m1']);
  assert.equal(host.querySelector('[data-preview-prev]').disabled,true);
  const next=host.querySelector('[data-preview-next]');next.click();await settle();
  assert.equal(host.querySelector('[data-preview-counter]').textContent,'2 / 7');assert.deepEqual(calls,['m0','m1','m2']);
  const track=host.querySelector('[data-preview-track]');track.dispatchEvent(new win.KeyboardEvent('keydown',{key:'End',bubbles:true}));await settle();
  assert.equal(host.querySelector('[data-preview-counter]').textContent,'7 / 7');assert.equal(next.disabled,true);
  assert.ok(host.querySelectorAll('svg').length<=3);assert.ok(calls.includes('m6'));assert.ok(calls.includes('m5'));
  host.querySelector('[data-preview-prev]').click();await settle();assert.equal(host.querySelector('[data-preview-counter]').textContent,'6 / 7');
  track.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Home',bubbles:true}));await settle();assert.equal(host.querySelector('[data-preview-counter]').textContent,'1 / 7');
  assert.ok(host.querySelectorAll('svg').length<=3);view.dispose();
});

test('disposal aborts a pending render and never paints its late response',async()=>{
  let finish,signal;const client={run(_operation,_source,options){signal=options.signal;return new Promise(resolve=>finish=resolve);}};
  const {host,view}=mount({project:fixture(),client});assert.equal(signal.aborted,false);
  view.dispose();assert.equal(signal.aborted,true);finish(result(1));await settle();
  assert.equal(host.querySelector('svg'),null);view.dispose();
});

test('empty selection makes no manufacturing requests and explains how to see a preview',async()=>{
  let calls=0;const {host,view}=mount({project:fixture(),entries:[],client:{run(){calls++;}}});await settle();
  assert.equal(calls,0);assert.equal(host.querySelector('[data-preview-track]'),null);
  assert.match(host.textContent,/označte alespoň jeden modul/);view.dispose();
});

test('failed and simplified previews are explicit and never masquerade as exact geometry',async()=>{
  let calls=0;const client={async run(){if(!calls++)throw Error('Invalid geometry');return{...result(2),stats:{reducedDetail:true}};}};
  const {host,view}=mount({project:fixture(),entries:fixture().modules.slice(0,2),client});await settle();
  assert.match(host.querySelector('[data-preview-image="0"]').textContent,/Náhled nelze zobrazit/);
  assert.equal(host.querySelector('[data-preview-status="0"]').textContent,'Invalid geometry');
  assert.match(host.querySelector('[data-preview-status="1"]').textContent,/Zjednodušený náhled/);view.dispose();
});

test('static previews remove interactive fallback tab stops',async()=>{
  const client={async run(){return{...result(1),html:'<g tabindex="0" role="button"><path d="M0 0L1 1"/></g>'};}};
  const {host,view}=mount({project:fixture(),entries:fixture().modules.slice(0,1),client});await settle();
  assert.equal(host.querySelector('svg [tabindex],svg [role="button"]'),null);assert.equal(host.querySelector('svg').getAttribute('role'),'img');view.dispose();
});
