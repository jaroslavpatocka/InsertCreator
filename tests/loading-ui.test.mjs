import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
import {loadingMarkup,updateLoading} from '../dist/loading-ui.js';

test('startup loading has readable Czech text and its assets are available offline',()=>{
  const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../dist/sw.js',import.meta.url),'utf8');
  assert.match(html,/Načítám aplikaci…/);
  assert.match(html,/<link[^>]+href="\.\/loading-ui\.css"/);
  for(const asset of ['loading-ui.css','loading-ui.js']) assert.ok(worker.includes(`'./${asset}'`),`${asset} is cached offline`);
});

function render(options={},container='div'){
  const document=new Window().document;
  const host=document.createElement(container);
  document.body.append(host);
  host.innerHTML=loadingMarkup(options);
  return {host,root:host.querySelector('[data-loading-ui]')};
}

test('loading is a labelled indeterminate status until real progress arrives',()=>{
  const {root}=render({title:'Preparing print files',message:'Checking module geometry',detail:'Everything stays on this device.'});
  assert.equal(root.getAttribute('role'),'status');
  assert.equal(root.getAttribute('aria-busy'),null);
  assert.equal(root.getAttribute('aria-live'),'polite');
  assert.equal(root.querySelectorAll('[aria-live]').length,0,'Only the outer status announces changes');
  const progress=root.querySelector('progress');
  assert.equal(progress.getAttribute('aria-label'),'Preparing print files');
  assert.equal(progress.hasAttribute('value'),false);
  assert.equal(root.querySelector('[data-loading-percent]').hidden,true);
  assert.equal(root.querySelector('[data-loading-detail]').textContent,'Everything stays on this device.');
});

test('compact loading remains valid inside a paragraph and safely escapes text and hooks',()=>{
  const malicious='<img src=x onerror=alert(1)>';
  const {host,root}=render({compact:true,title:malicious,message:'A & B < C',detail:'"Quoted"',hooks:{message:{id:'message" onmouseover="bad','data-legacy':'yes',onclick:'bad'},progress:{'aria-label':'cannot override'}}},'p');
  assert.equal(root.tagName,'SPAN');
  assert.equal(host.childElementCount,1);
  assert.equal(root.querySelector('div,p,h1,h2,h3,img'),null);
  assert.equal(root.querySelector('[data-loading-title]').textContent,malicious);
  assert.equal(root.querySelector('[data-loading-message]').textContent,'A & B < C');
  assert.equal(root.querySelector('[data-loading-message]').id,'message" onmouseover="bad');
  assert.equal(root.querySelector('[data-legacy]').getAttribute('data-legacy'),'yes');
  assert.equal(root.querySelector('[onclick],[onmouseover]'),null);
  assert.equal(root.querySelector('progress').getAttribute('aria-label'),malicious);
});

test('partial loading updates preserve nodes, legacy selectors and existing progress',()=>{
  const {host,root}=render({title:'Preparing',message:'First step',detail:'Local processing',progress:.25,hooks:{message:{'data-smart-message':''},progress:{'data-smart-progress':''},percent:{'data-smart-percent':''}}});
  const nodes=[...root.querySelectorAll('*')];
  assert.equal(updateLoading(host,{message:'Second step'}),root);
  assert.deepEqual([...root.querySelectorAll('*')],nodes);
  assert.equal(root.querySelector('[data-smart-message]').textContent,'Second step');
  assert.equal(root.querySelector('[data-loading-title]').textContent,'Preparing');
  assert.equal(root.querySelector('[data-loading-detail]').textContent,'Local processing');
  assert.equal(root.querySelector('[data-smart-progress]').value,.25);
  assert.equal(root.querySelector('[data-smart-percent]').textContent,'25 %');
});

test('real item counts become native progress and can return to indeterminate',()=>{
  const {root}=render({title:'Creating 3D preview',progress:{value:2,max:5}});
  const progress=root.querySelector('progress'),percent=root.querySelector('[data-loading-percent]');
  assert.equal(progress.max,5);
  assert.equal(progress.value,2);
  assert.equal(percent.textContent,'40 %');
  updateLoading(root,{progress:{value:5,max:5}});
  assert.equal(progress.value,5);
  assert.equal(percent.textContent,'100 %');
  updateLoading(root,{progress:null});
  assert.equal(progress.hasAttribute('value'),false);
  assert.equal(percent.hidden,true);
  assert.equal(root.dataset.loadingDeterminate,'false');
  updateLoading(root,{progress:0});
  assert.equal(progress.hasAttribute('value'),true);
  assert.equal(progress.value,0);
  assert.equal(percent.textContent,'0 %');
  assert.equal(percent.hidden,false);
});

test('invalid and out of range progress cannot render broken percentages',()=>{
  for(const progress of [NaN,Infinity,'0.5',{}, {value:1,max:0},{value:1,max:Infinity}]){
    const {root}=render({title:'Working',progress});
    assert.equal(root.querySelector('progress').hasAttribute('value'),false);
    assert.equal(root.querySelector('[data-loading-percent]').hidden,true);
  }
  const {root}=render({progress:2});
  assert.equal(root.querySelector('progress').value,1);
  updateLoading(root,{progress:-1});
  assert.equal(root.querySelector('progress').value,0);
});

test('clearing copy hides empty fields and keeps the progress label in sync',()=>{
  const {root}=render({title:'First title',message:'Current step',detail:'Extra detail'});
  updateLoading(root,{title:'',detail:null});
  assert.equal(root.querySelector('[data-loading-title]').hidden,true);
  assert.equal(root.querySelector('[data-loading-detail]').hidden,true);
  assert.equal(root.querySelector('progress').getAttribute('aria-label'),'Current step');
  updateLoading(root,{title:'New title',detail:'<new detail>'});
  assert.equal(root.querySelector('[data-loading-title]').hidden,false);
  assert.equal(root.querySelector('[data-loading-detail]').textContent,'<new detail>');
  assert.equal(root.querySelector('[data-loading-detail]').children.length,0);
  assert.equal(root.querySelector('progress').getAttribute('aria-label'),'New title');
  assert.equal(updateLoading(null,{message:'Gone'}),null);
});
