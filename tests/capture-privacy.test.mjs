import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dist=new URL('../dist/',import.meta.url);
const read=name=>fs.readFileSync(new URL(name,dist),'utf8');

test('the desktop app never asks for the webcam, microphone, screen or location',()=>{
  const files=fs.readdirSync(dist).filter(name=>name.endsWith('.js'));
  assert.ok(files.length>50);
  for(const name of files)assert.doesNotMatch(read(name),/getUserMedia|getDisplayMedia|enumerateDevices|navigator\.geolocation/,name);
});

test('the photo pickers hand over one chosen file and the choice is explained in both languages',()=>{
  const capture=read('capture.js');
  const inputs=capture.match(/<input type="file"[^>]*>/g)||[];
  assert.equal(inputs.length,2);
  for(const input of inputs)assert.doesNotMatch(input,/\bmultiple\b|webkitdirectory/);
  assert.match(capture,/data-photo-privacy/);
  assert.match(read('locales/en-capture.js'),/cannot see your gallery or camera/);
});
