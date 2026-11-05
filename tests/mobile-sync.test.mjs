import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {watch} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {syncMobile} from '../scripts/sync-mobile.mjs';

const hash=buffer=>createHash('sha256').update(buffer).digest('hex').toUpperCase();
const tempBase=await fs.realpath(os.tmpdir());
async function fixture(t){
  const root=await fs.mkdtemp(path.join(tempBase,'insertcreator-mobile-sync-')),projectRoot=path.join(root,'desktop'),sourceRoot=path.join(root,'source');
  await fs.mkdir(path.join(projectRoot,'dist'),{recursive:true});await fs.mkdir(path.join(sourceRoot,'nested'),{recursive:true});
  await fs.writeFile(path.join(projectRoot,'dist','index.html'),'desktop unchanged');
  await fs.writeFile(path.join(sourceRoot,'index.html'),'<main>mobile</main>');await fs.writeFile(path.join(sourceRoot,'nested','app.js'),'export const value=1;\n');
  t.after(async()=>{const target=path.resolve(root);assert.equal(path.dirname(target),tempBase);assert.ok(path.basename(target).startsWith('insertcreator-mobile-sync-'));await fs.rm(target,{recursive:true,force:true});});
  const targetRoot=path.join(projectRoot,'dist','mobil');
  return{root,projectRoot,sourceRoot,targetRoot,manifestFile:path.join(projectRoot,'mobile-release.json'),run:options=>syncMobile({projectRoot,sourceRoot,sourceCommit:null,...options})};
}

test('mobile sync physically copies the complete nested binary runtime and records exact hashes',async t=>{
  const f=await fixture(t),binary=Buffer.from([0,255,32,128,13,10,0,42]),commit='a'.repeat(40);
  await fs.writeFile(path.join(f.sourceRoot,'nested','model.bin'),binary);
  const sourceBefore=await fs.readFile(path.join(f.sourceRoot,'nested','app.js'));
  const manifest=await f.run({sourceCommit:commit});
  assert.equal(manifest.version,1);assert.equal(manifest.sourceCommit,commit);assert.deepEqual(manifest.files.map(file=>file.path),['index.html','nested/app.js','nested/model.bin']);
  assert.deepEqual(JSON.parse(await fs.readFile(f.manifestFile,'utf8')),manifest);
  for(const entry of manifest.files){const content=await fs.readFile(path.join(f.targetRoot,...entry.path.split('/')));assert.equal(entry.sha256,hash(content));assert.equal(entry.bytes,content.length);assert.equal((await fs.lstat(path.join(f.targetRoot,...entry.path.split('/')))).isSymbolicLink(),false);}
  assert.deepEqual(await fs.readFile(path.join(f.targetRoot,'nested','model.bin')),binary);
  assert.deepEqual(await fs.readFile(path.join(f.sourceRoot,'nested','app.js')),sourceBefore);assert.equal(await fs.readFile(path.join(f.projectRoot,'dist','index.html'),'utf8'),'desktop unchanged');
  await fs.writeFile(path.join(f.sourceRoot,'nested','model.bin'),Buffer.from('new source bytes'));
  assert.deepEqual(await fs.readFile(path.join(f.targetRoot,'nested','model.bin')),binary,'the destination is neither a symlink nor a hard link');
  assert.deepEqual((await fs.readdir(path.join(f.projectRoot,'dist'))).sort(),['index.html','mobil'],'staging folders are removed');
});

test('repeat sync updates managed files, removes only unchanged stale managed files and preserves foreign files',async t=>{
  const f=await fixture(t);await fs.mkdir(path.join(f.sourceRoot,'obsolete'));await fs.writeFile(path.join(f.sourceRoot,'obsolete','old.js'),'old runtime');await f.run();
  await fs.writeFile(path.join(f.targetRoot,'foreign-notes.txt'),'keep me');await fs.unlink(path.join(f.sourceRoot,'obsolete','old.js'));await fs.rmdir(path.join(f.sourceRoot,'obsolete'));
  await fs.writeFile(path.join(f.sourceRoot,'nested','app.js'),'export const value=2;\n');
  const manifest=await f.run();
  assert.equal(await fs.readFile(path.join(f.targetRoot,'nested','app.js'),'utf8'),'export const value=2;\n');assert.equal(await fs.readFile(path.join(f.targetRoot,'foreign-notes.txt'),'utf8'),'keep me');
  await assert.rejects(fs.stat(path.join(f.targetRoot,'obsolete','old.js')),{code:'ENOENT'});assert.equal(manifest.files.some(file=>file.path==='foreign-notes.txt'),false);
});

test('edited stale managed files and conflicting foreign files are preserved with a clear refusal',async t=>{
  const f=await fixture(t);await f.run();
  await fs.writeFile(path.join(f.targetRoot,'nested','app.js'),'foreign edit');await fs.unlink(path.join(f.sourceRoot,'nested','app.js'));
  await assert.rejects(f.run(),/edited managed file/);assert.equal(await fs.readFile(path.join(f.targetRoot,'nested','app.js'),'utf8'),'foreign edit');
  const other=await fixture(t);await fs.mkdir(other.targetRoot);await fs.writeFile(path.join(other.targetRoot,'index.html'),'foreign content');
  await assert.rejects(other.run(),/foreign file/);assert.equal(await fs.readFile(path.join(other.targetRoot,'index.html'),'utf8'),'foreign content');
});

test('byte-identical initial files can be adopted without deleting unrelated target files',async t=>{
  const f=await fixture(t);await fs.mkdir(f.targetRoot);await fs.copyFile(path.join(f.sourceRoot,'index.html'),path.join(f.targetRoot,'index.html'));await fs.writeFile(path.join(f.targetRoot,'keep.txt'),'foreign');
  const manifest=await f.run();assert.ok(manifest.files.some(file=>file.path==='index.html'));assert.equal(await fs.readFile(path.join(f.targetRoot,'keep.txt'),'utf8'),'foreign');
});

test('unsafe managed paths are refused before target changes or outside deletion',async t=>{
  const f=await fixture(t),outside=path.join(f.projectRoot,'outside.txt');await fs.writeFile(outside,'must survive');
  for(const unsafe of ['../outside.txt','/outside.txt','C:/outside.txt','nested/../../outside.txt','nested\\outside.txt','nested//outside.txt','nested/CON.txt']){
    await fs.writeFile(f.manifestFile,JSON.stringify({version:1,sourceCommit:null,files:[{path:unsafe,sha256:hash(Buffer.from('must survive')),bytes:12}]}));
    await assert.rejects(f.run(),/Unsafe managed path/);assert.equal(await fs.readFile(outside,'utf8'),'must survive');
  }
  assert.deepEqual(await fs.readdir(path.join(f.projectRoot,'dist')),['index.html']);
});

test('source and destination junctions or symlinks cannot escape the fixed managed root',async t=>{
  const sourceLink=await fixture(t),outside=path.join(sourceLink.root,'external');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'secret.txt'),'external');
  await fs.symlink(outside,path.join(sourceLink.sourceRoot,'linked'),'junction');await assert.rejects(sourceLink.run(),/Symbolic links/);
  const targetLink=await fixture(t);await fs.symlink(outside,targetLink.targetRoot,'junction');await assert.rejects(targetLink.run(),/Unsafe directory/);
  assert.equal(await fs.readFile(path.join(outside,'secret.txt'),'utf8'),'external');
});

test('overlapping source and destination and empty releases cannot erase a managed release',async t=>{
  const f=await fixture(t);await f.run();const before=await fs.readFile(f.manifestFile,'utf8');
  await assert.rejects(f.run({sourceRoot:f.targetRoot}),/must not overlap/);
  const empty=path.join(f.root,'empty');await fs.mkdir(empty);await assert.rejects(f.run({sourceRoot:empty}),/empty mobile runtime/);
  assert.equal(await fs.readFile(f.manifestFile,'utf8'),before);assert.ok((await fs.readFile(path.join(f.targetRoot,'index.html'),'utf8')).includes('mobile'));
});

test('concurrent source edits are detected during the staged physical copy',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.sourceRoot,'a-large.bin'),Buffer.alloc(32*1024*1024,42));
  let mutation=null,started=false;
  const observer=watch(path.join(f.projectRoot,'dist'),(event,name)=>{
    if(!started&&String(name).startsWith('.mobile-sync-')){started=true;mutation=fs.writeFile(path.join(f.sourceRoot,'index.html'),'<main>concurrent edit</main>');}
  });
  try{await assert.rejects(f.run(),/changed/i);assert.equal(started,true);await mutation;}finally{observer.close();}
});
