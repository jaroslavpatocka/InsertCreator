import test from 'node:test';
import assert from 'node:assert/strict';
import sets from '../dist/catalog/sets.js';
import parametric from '../dist/catalog/parametric.js';
import {CATEGORIES,catalogItems,catalogSets} from '../dist/catalog/index.js';
import {validateProject,blankProject} from '../dist/model.js';
import {pocketOutline} from '../dist/finger-grip.js';

const byId=new Map(catalogItems().map(i=>[i.id,i]));
// Drive accessories (ratchets, extensions, adapters…) are inch-specified even in metric socket sets.
const ACCESSORY=/^(ratchet|extension-bar|bit-|universal-joint|sliding-t-bar)/;
const count=name=>+(name.match(/\((\d+) (?:ks|pcs)\)$/)||[])[1];

test('every set resolves completely (none dropped by catalogSets)',()=>{
  assert.ok(sets.length>=25&&sets.length<=40,`count ${sets.length}`);
  for(const set of sets)for(const id of set.items)assert.ok(byId.has(id),`${set.id}: missing item ${id}`);
  assert.equal(catalogSets().length,sets.length);
  for(const set of catalogSets())assert.equal(set.tools.length,set.items.length);
});

test('set metadata is valid',()=>{
  const cats=new Set(CATEGORIES.map(c=>c.id));
  assert.equal(new Set(sets.map(s=>s.id)).size,sets.length,'unique ids');
  for(const set of sets){
    assert.match(set.id,/^[a-z0-9-]+$/);
    assert.ok(cats.has(set.category),`${set.id} category`);
    assert.ok(set.name.cs.trim()&&set.name.en.trim(),`${set.id} names`);
    assert.ok(set.description.cs.trim()&&set.description.en.trim(),`${set.id} description`);
    assert.ok(['mm','in'].includes(set.unit),set.id);
    assert.ok(Array.isArray(set.tags)&&set.tags.length,set.id);
    assert.ok(set.source?.name&&set.source.note,set.id);
    assert.ok(!/\b(Wera|Wiha|Knipex|Gedore|Bahco|Stahlwille|Stanley|Narex|Facom|Hazet)\b/i.test(set.name.cs+set.name.en),`${set.id} brand in name`);
  }
});

test('piece count in the name equals the number of items',()=>{
  for(const set of sets){
    assert.equal(count(set.name.cs),set.items.length,`${set.id} cs`);
    assert.equal(count(set.name.en),set.items.length,`${set.id} en`);
    assert.ok(set.tags.includes(`${set.items.length} ks`)&&set.tags.includes(`${set.items.length} pcs`),`${set.id} count tags`);
  }
});

test('metric sets hold metric tools, imperial sets imperial tools (drive accessories excepted)',()=>{
  for(const set of sets)for(const id of set.items){
    if(ACCESSORY.test(id))continue;
    assert.equal(byId.get(id).unit,set.unit,`${set.id}: ${id}`);
  }
});

test('sample compositions',()=>{
  const get=id=>{const s=sets.find(x=>x.id===id);assert.ok(s,id);return s;};
  const big=get('combination-wrench-set-6-32mm');
  assert.equal(big.items.length,26);
  const sizes=big.items.map(id=>byId.get(id).size);
  assert.deepEqual(sizes,[...Array.from({length:25},(_,i)=>6+i),32]);// 6–30 consecutive + 32 (no 31 mm in real sets)
  assert.equal(get('combination-wrench-set-8-19mm').items.length,12);
  assert.deepEqual(get('hex-key-set-1-5-10mm').items.map(id=>byId.get(id).size),[1.5,2,2.5,3,4,5,6,8,10]);
  const sock=get('socket-set-1-2in-8-32mm');
  assert.equal(sock.items.filter(id=>id.startsWith('socket-')).length,18);
  assert.ok(sock.items.includes('ratchet-1-2in'));
  assert.equal(get('bit-set-25mm-with-holder').items.filter(id=>id==='bit-25mm-c6-3').length,10);
});

const NEW=['combination-wrench-25mm','combination-wrench-26mm','combination-wrench-28mm','combination-wrench-29mm',
  'double-open-end-wrench-20x22mm','double-open-end-wrench-24x26mm','double-open-end-wrench-25x28mm','double-open-end-wrench-27x32mm',
  'hex-key-l-0-050in','torx-key-l-t8','torx-key-l-t9','socket-1-2in-8mm','socket-1-2in-9mm',
  'bit-adapter-1-4in','universal-joint-1-2in','sliding-t-bar-1-2in','screwdriver-slotted-3x80',
  'wood-chisel-18mm','wood-chisel-26mm','pin-punch-7mm'];
test('items added for sets are valid outlines with plausible sizes',()=>{
  for(const id of NEW){
    const item=parametric.find(i=>i.id===id);
    assert.ok(item,`missing ${id}`);
    const project=validateProject({...blankProject(),tools:[{id:item.id,name:item.name.cs,points:item.points,depth:item.depth}]});
    assert.equal(project.tools.length,1,id);
    assert.ok(pocketOutline(project.tools[0],.8).length,`${id} pocket`);
  }
  const w=parametric.find(i=>i.id==='combination-wrench-28mm'),xs=w.points.map(p=>p.x);
  const L=Math.max(...xs)-Math.min(...xs);
  assert.ok(L>310&&L<350,`28 mm wrench length ${L}`);
  assert.equal(w.accuracy,'typical');
  assert.equal(parametric.find(i=>i.id==='hex-key-l-0-050in').unit,'in');
});
