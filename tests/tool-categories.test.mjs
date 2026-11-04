import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CATEGORIES,inferCategory,toolCategory} from '../dist/tool-categories.js';
import {CATEGORIES as catalogCategories,catalogItems} from '../dist/catalog/index.js';
import {validateProject,blankProject} from '../dist/model.js';

const points=[{x:0,y:0},{x:20,y:0},{x:20,y:10}];
const validated=fields=>validateProject({...blankProject(),tools:[{id:'tool',name:'Nástroj',points,...fields}]}).tools[0];

test('the catalogue re-exports the shared category list and the module stays free of heavy imports',()=>{
  assert.equal(catalogCategories,CATEGORIES);
  assert.deepEqual(CATEGORIES.map(c=>c.id),['wrenches','hex-keys','sockets','screwdrivers','pliers','measuring','cutting','striking','other']);
  assert.doesNotMatch(fs.readFileSync(new URL('../dist/tool-categories.js',import.meta.url),'utf8'),/^\s*import\b/m);
});

test('inferCategory recognises Czech names with or without diacritics, in any case',()=>{
  const names={'Imbus':'hex-keys','Torx klíč':'hex-keys','Nástrčná hlavice':'sockets','Bit':'sockets','Ráčna':'sockets','Nástrčné klíče':'sockets','Očkoplochý klíč':'wrenches','Ráčnový klíč':'wrenches','Momentový klíč':'wrenches','Šroubovák':'screwdrivers','SROUBOVAK':'screwdrivers','Šroubovák Torx':'screwdrivers','Boční štípací kleště':'pliers','kleste':'pliers','Svinovací metr':'measuring','Vodováha':'measuring','Pilník':'cutting','Nůžky':'cutting','Gumová palička':'striking','Důlčík':'striking'};
  for(const [name,id] of Object.entries(names))assert.equal(inferCategory(name),id,name);
});

test('inferCategory recognises English names and settles overlapping keywords',()=>{
  const names={'Allen wrench':'hex-keys','Hex key 5 mm':'hex-keys','Torx bit T20':'sockets','Hex socket':'sockets','Screwdriver bit':'sockets','Bit adapter 1/4" square to 1/4" hex':'sockets','Ratchet':'sockets','Ratcheting wrench':'wrenches','Adjustable spanner':'wrenches','Phillips screwdriver':'screwdrivers','Diagonal cutters':'pliers','Box cutter':'cutting','Hacksaw':'cutting','Try square':'measuring','Ball-pein HAMMER':'striking'};
  for(const [name,id] of Object.entries(names))assert.equal(inferCategory(name),id,name);
});

test('inferCategory matches keywords at word starts only and falls back to other',()=>{
  for(const name of ['habit','Rabbit','Vrták','Tape','Nástroj','',null,undefined,42])assert.equal(inferCategory(name),'other',String(name));
});

test('inferCategory agrees with the real catalogue in both languages, except the Poly Haven ratchet',()=>{
  const items=catalogItems(),misses=[];
  for(const item of items)for(const lang of ['cs','en'])if(inferCategory(item.name[lang])!==item.category)misses.push(`${item.id}:${lang}`);
  assert.ok(items.length>=247,'catalogue size');
  assert.ok(1-misses.length/(items.length*2)>=.995,misses.join(', '));
  assert.deepEqual(misses,['polyhaven-ratchet-wrench:cs','polyhaven-ratchet-wrench:en']);
});

test('toolCategory prefers a valid stored category and infers otherwise',()=>{
  assert.equal(toolCategory({name:'Šroubovák',category:'pliers'}),'pliers');
  assert.equal(toolCategory({name:'Kladivo',category:'other'}),'other');
  assert.equal(toolCategory({name:'Šroubovák',category:'nonsense'}),'screwdrivers');
  assert.equal(toolCategory({name:'Šroubovák',category:'constructor'}),'screwdrivers');
  assert.equal(toolCategory({name:'Šroubovák',category:7}),'screwdrivers');
  assert.equal(toolCategory({name:'Kleště'}),'pliers');
  assert.equal(toolCategory({}),'other');
  assert.equal(toolCategory(null),'other');
});

test('tools without the metadata do not gain the fields',()=>{
  const tool=validated({});
  assert.equal(Object.hasOwn(tool,'category'),false);assert.equal(Object.hasOwn(tool,'setNames'),false);
});

test('category is cleaned, limited and survives a round trip',()=>{
  assert.equal(validated({category:'wrenches'}).category,'wrenches');
  assert.equal(validated({category:'  ho\u0000b\u001fby\u007f\n '}).category,'hobby');
  assert.equal(validated({category:'x'.repeat(60)}).category.length,40);
  assert.equal(validated({category:`${'x'.repeat(39)} tail`}).category,'x'.repeat(39));
  const project={...blankProject(),tools:[{id:'tool',name:'Nástroj',points,category:'pliers',setNames:['Sada']}]};
  const tool=validateProject(JSON.parse(JSON.stringify(validateProject(project)))).tools[0];
  assert.equal(tool.category,'pliers');assert.deepEqual(tool.setNames,['Sada']);
});

test('unusable category values are dropped without an error',()=>{
  for(const category of ['',' \n\t ','\u0000',7,null,true,{},['wrenches']])assert.equal(Object.hasOwn(validated({category}),'category'),false,String(category));
});

test('setNames are cleaned, limited and de-duplicated',()=>{
  assert.deepEqual(validated({setNames:[' Sada\u0000 A\n','Sada A','','  ',7,null,'Sada B']}).setNames,['Sada A','Sada B']);
  assert.equal(validated({setNames:['x'.repeat(150)]}).setNames[0].length,100);
  assert.deepEqual(validated({setNames:['x'.repeat(100),'x'.repeat(120)]}).setNames,['x'.repeat(100)]);
  const names=Array.from({length:20},(_,i)=>`Sada ${i}`);
  assert.deepEqual(validated({setNames:names}).setNames,names.slice(0,12));
  assert.deepEqual(validated({setNames:['','Sada','Sada',...names]}).setNames,['Sada',...names.slice(0,11)]);
});

test('unusable setNames values are dropped without an error',()=>{
  for(const setNames of [[],['',' \n'],[7,null],'Sada',7,null,{length:1,0:'Sada'}])assert.equal(Object.hasOwn(validated({setNames}),'setNames'),false,JSON.stringify(setNames));
});

test('the service worker caches the new module',()=>{
  assert.match(fs.readFileSync(new URL('../dist/sw.js',import.meta.url),'utf8'),/'\.\/tool-categories\.js'/);
});
