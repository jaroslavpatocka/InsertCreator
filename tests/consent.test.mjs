import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Window} from 'happy-dom';

const dist=new URL('../dist/',import.meta.url);
const read=name=>fs.readFileSync(new URL(name,dist),'utf8');
const source=read('consent.js');

function start({saved,shell=true}={}){
  const window=new Window({url:'https://insertcreator.com/'});
  window.document.body.innerHTML=`<div id="app">${shell?'<div class="app-shell"></div>':''}</div>`;
  if(saved)window.localStorage.setItem('insertcreator-analytics-consent',JSON.stringify(saved));
  new window.Function(source).call(window);
  const $=selector=>window.document.querySelector(selector);
  return {window,$,gaScript:()=>[...window.document.querySelectorAll('script')].find(script=>/googletagmanager/.test(script.src))};
}

test('the page itself contains no analytics and no inline script',()=>{
  const html=read('index.html');
  assert.doesNotMatch(html,/googletagmanager|gtag|G-6CMM/);
  assert.doesNotMatch(html,/<script(?![^>]*\bsrc=)[^>]*>/);
  assert.match(html,/<script src="\.\/consent\.js"/);
});

test('without a choice the bar is shown and nothing is requested from Google',()=>{
  const {$,gaScript}=start();
  assert.ok($('.consent-bar'));
  assert.equal(gaScript(),undefined);
  assert.ok($('.consent-bar a[href="./privacy.html"]'));
});

test('declining is as easy as accepting: one press on the same layer',()=>{
  const {$}=start();
  assert.equal($('[data-consent=denied]').className,$('[data-consent=granted]').className);
});

test('declining keeps analytics off and is remembered',()=>{
  const {window,$,gaScript}=start();
  $('[data-consent=denied]').click();
  assert.equal($('.consent-bar'),null);
  assert.equal(gaScript(),undefined);
  assert.equal(JSON.parse(window.localStorage.getItem('insertcreator-analytics-consent')).choice,'denied');
  const again=start({saved:{choice:'denied',at:Date.now()}});
  assert.equal(again.$('.consent-bar'),null);
  assert.equal(again.gaScript(),undefined);
});

test('accepting starts analytics once, with advertising storage denied',()=>{
  const {window,$,gaScript}=start();
  $('[data-consent=granted]').click();
  assert.ok(gaScript());
  const consent=[...window.dataLayer].map(args=>[...args]).find(args=>args[0]==='consent');
  assert.equal(consent[2].ad_storage,'denied');
  assert.equal(consent[2].ad_personalization,'denied');
});

test('a stored acceptance starts analytics without showing the bar',()=>{
  const {$,gaScript}=start({saved:{choice:'granted',at:Date.now()}});
  assert.equal($('.consent-bar'),null);
  assert.ok(gaScript());
});

test('an old choice expires and the visitor is asked again',()=>{
  const {$,gaScript}=start({saved:{choice:'granted',at:Date.now()-366*24*60*60*1000}});
  assert.ok($('.consent-bar'));
  assert.equal(gaScript(),undefined);
});

test('withdrawing later stops analytics and removes its cookies',()=>{
  const {window,$}=start({saved:{choice:'granted',at:Date.now()}});
  window.document.cookie='_ga=GA1.1.1; path=/';
  const button=window.document.createElement('button');button.dataset.consentSettings='';window.document.body.append(button);
  button.click();
  $('[data-consent=denied]').click();
  assert.equal(window['ga-disable-G-6CMM882CWH'],true);
  assert.doesNotMatch(window.document.cookie,/_ga=[^;]/,'no analytics identifier may survive');
});

test('a redirected phone never starts the desktop app, so it sees no bar and no analytics',()=>{
  const {$,gaScript}=start({shell:false});
  assert.equal($('.consent-bar'),null);
  assert.equal(gaScript(),undefined);
});

test('the privacy pages are bundled offline and available in both languages',()=>{
  const worker=read('sw.js');
  for(const name of ['consent.js','privacy.html','privacy-en.html'])assert.ok(worker.includes(`./${name}`),name);
  assert.match(read('privacy.html'),/Google Analytics/);
  assert.match(read('privacy-en.html'),/Google Analytics/);
});
