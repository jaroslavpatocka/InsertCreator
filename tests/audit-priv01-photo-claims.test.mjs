// PRIV-01: user-facing photo-processing statements must be consistent. Photos are normally processed
// in the browser; only the optional background removal mode sends decoded pixels, dimensions and a
// job id to a service at the same address (origin). No categorical "never leaves the device" claim.
// privacy*.html / terms are maintained separately and are intentionally not scanned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dist=new URL('../dist/',import.meta.url);
const read=name=>fs.readFileSync(new URL(name,dist),'utf8');
const exists=name=>fs.existsSync(new URL(name,dist));
const surfaces=['index.html','en/index.html','navody/index.html','manifest.webmanifest','app.js','capture.js','consent.js','mobile-shell.js','locales/en-app.js','locales/en-capture.js'].filter(exists);

const categorical=[
  /Fotky zůstávají ve vašem zařízení/i,/Vše ve vašem zařízení/i,/Vše přímo ve vašem zařízení/i,
  /Fotografie se zpracovávají (přímo )?ve vašem zařízení/i,/Fotografie se nikam neodesílají/i,
  /Fotky zůstávají u vás/i,/Bez cloudu/i,/Fotografie a návrhy zůstávají v tomto zařízení/i,/zpracované v zařízení/i,
  /Fotka se zpracuje ve vašem zařízení/i,/serveru této aplikace na vašem PC/i,
  /Photos stay on your device/i,/processed locally on your device/i,/Photos are never uploaded/i,/never uploads it/i,
  /Your photos stay with you/i,/No cloud/i,/Everything right on your device/i,/Photos and designs stay on this device/i,
  /processed on your device and never uploaded/i,/server on your PC/i,/Photos and designs are never sent\./i,
];

test('no user-facing surface makes a categorical on-device photo claim',()=>{
  assert.ok(surfaces.length>=7,surfaces.join());
  for(const name of surfaces){const source=read(name);for(const pattern of categorical)assert.doesNotMatch(source,pattern,`${name}: ${pattern}`);}
});

test('the optional background route is described as same-address pixels, dimensions and job id',()=>{
  const capture=read('capture.js'),en=read('locales/en-capture.js');
  assert.match(capture,/pixely fotky, její rozměry a ID úlohy odešlou volitelné službě na serveru se stejnou adresou/);
  assert.match(capture,/typicky na PC, kde jste službu spustili/,'same origin is not stated to be necessarily the user device');
  assert.match(en,/sent to an optional service on the server at the same address this app runs from/);
  assert.match(read('app.js'),/Jen volitelné odstranění pozadí pošle pixely fotky, rozměry a ID úlohy službě na stejné adrese/);
  assert.match(read('locales/en-app.js'),/Only optional background removal sends the photo pixels, dimensions and a job ID/);
});

test('the notice before file selection is kept for both processing modes',()=>{
  const capture=read('capture.js');
  assert.match(capture,/<p data-photo-privacy[^>]*>\$\{\(state\.outlineMode==='background'\?privacyText\(\)/);
  assert.match(capture,/v tomto režimu ji zpracuje jen v prohlížeči/);
  assert.match(capture,/Fotka se zpracuje v tomto prohlížeči a nikam se neodesílá/);
  assert.match(read('locales/en-capture.js'),/cannot see your gallery or camera/);
});

test('landing pages describe browser processing with the optional same-address exception',()=>{
  const cs=read('index.html');
  assert.match(cs,/Fotografie se běžně zpracovávají přímo v prohlížeči\. Jen pokud na stejné adrese běží volitelná služba pro odstranění pozadí/);
  if(exists('en/index.html'))assert.match(read('en/index.html'),/Photos are normally processed right in your browser; only if an optional background removal service runs at the same address/);
});
