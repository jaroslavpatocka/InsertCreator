import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const exec=promisify(execFile),script=fileURLToPath(import.meta.url);
const defaultProjectRoot=path.resolve(path.dirname(script),'..');
const fold=value=>process.platform==='win32'?value.toLowerCase():value;
const within=(root,target)=>{const rel=path.relative(root,target);return rel===''||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep));};
const compare=(a,b)=>a<b?-1:a>b?1:0;
async function maybeStat(file){try{return await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}

function safeRelative(value){
  if(typeof value!=='string'||!value||value.includes('\\')||path.posix.isAbsolute(value))throw Error('Unsafe managed path: '+value);
  for(const part of value.split('/'))if(!part||part==='.'||part==='..'||/[<>:"|?*\u0000-\u001f]/.test(part)||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))throw Error('Unsafe managed path: '+value);
  return value;
}
function child(root,relative){const result=path.resolve(root,...safeRelative(relative).split('/'));if(!within(root,result)||result===root)throw Error('Path escapes managed root: '+relative);return result;}
async function realDirectory(directory){
  const stat=await fs.lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Expected a physical directory: '+directory);
  if(fold(await fs.realpath(directory))!==fold(directory))throw Error('Directory contains a symbolic link or alias: '+directory);
}
async function directoryChain(root,target,{create=false}={}){
  if(!within(root,target))throw Error('Directory escapes project root: '+target);
  let current=root;
  for(const segment of path.relative(root,target).split(path.sep).filter(Boolean)){
    current=path.join(current,segment);let stat=await maybeStat(current);
    if(!stat&&create){await fs.mkdir(current);stat=await fs.lstat(current);}
    if(stat&&(stat.isSymbolicLink()||!stat.isDirectory()))throw Error('Unsafe directory in mobile destination: '+current);
  }
}
async function digest(file){
  const before=await fs.lstat(file,{bigint:true});
  if(before.isSymbolicLink()||!before.isFile())throw Error('Expected a physical file: '+file);
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(file)){hash.update(chunk);bytes+=chunk.length;}
  const after=await fs.lstat(file,{bigint:true});
  if(after.isSymbolicLink()||before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||BigInt(bytes)!==after.size)throw Error('File changed while being read: '+file);
  return{sha256:hash.digest('hex').toUpperCase(),bytes};
}
async function inventory(root){
  const files=[],directories=[];
  async function visit(directory,relative=''){
    const entries=(await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>compare(a.name,b.name));
    for(const entry of entries){
      const name=safeRelative(relative?relative+'/'+entry.name:entry.name),absolute=child(root,name),stat=await fs.lstat(absolute);
      if(stat.isSymbolicLink())throw Error('Symbolic links are not permitted: '+absolute);
      if(stat.isDirectory()){directories.push(name);await visit(absolute,name);}
      else if(stat.isFile())files.push({path:name,...await digest(absolute)});
      else throw Error('Unsupported runtime file: '+absolute);
    }
  }
  await visit(root);
  const seen=new Set();for(const entry of [...files,...directories.map(value=>({path:value}))]){const key=entry.path.toLowerCase();if(seen.has(key))throw Error('Case-colliding runtime paths: '+entry.path);seen.add(key);}
  return{files:files.sort((a,b)=>compare(a.path,b.path)),directories:directories.sort(compare)};
}
const equalFile=(a,b)=>a?.sha256===b?.sha256&&a?.bytes===b?.bytes;
function validateManifest(manifest){
  if(!manifest||manifest.version!==1||!(manifest.sourceCommit===null||typeof manifest.sourceCommit==='string')||!Array.isArray(manifest.files))throw Error('Invalid mobile-release.json manifest');
  const seen=new Set();
  for(const entry of manifest.files){
    safeRelative(entry.path);const key=entry.path.toLowerCase();
    if(seen.has(key)||!/^[A-F0-9]{64}$/.test(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0)throw Error('Invalid managed file record: '+entry.path);
    seen.add(key);
  }
  return manifest;
}
async function sourceCommitFor(sourceRoot){try{const result=await exec('git',['-C',sourceRoot,'rev-parse','HEAD'],{windowsHide:true});return result.stdout.trim()||null;}catch{return null;}}
async function removeEmptyParents(file,targetRoot){
  let current=path.dirname(file);
  while(current!==targetRoot&&within(targetRoot,current)){
    const stat=await maybeStat(current);if(!stat)return;
    if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Unsafe stale parent: '+current);
    try{await fs.rmdir(current);}catch(error){if(['ENOTEMPTY','EEXIST'].includes(error.code))return;throw error;}
    current=path.dirname(current);
  }
}
async function atomicFile(destination,source,root){
  await directoryChain(root,path.dirname(destination),{create:true});
  const temp=path.join(path.dirname(destination),'.mobile-sync-'+randomUUID()+'.tmp');
  let owned=false;
  try{await fs.copyFile(source,temp,1);owned=true;await fs.rename(temp,destination);}finally{if(owned)await fs.unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

/** Copy the complete mobile runtime to the fixed desktop dist/mobil destination. */
export async function syncMobile({projectRoot=defaultProjectRoot,sourceRoot=path.resolve(projectRoot,'../mobil/dist'),sourceCommit}={}){
  projectRoot=path.resolve(projectRoot);sourceRoot=path.resolve(sourceRoot);
  const distRoot=path.join(projectRoot,'dist'),targetRoot=path.join(distRoot,'mobil'),manifestFile=path.join(projectRoot,'mobile-release.json');
  await realDirectory(projectRoot);await realDirectory(sourceRoot);
  if(within(sourceRoot,targetRoot)||within(targetRoot,sourceRoot))throw Error('Mobile source and destination must not overlap');
  await directoryChain(projectRoot,targetRoot);
  const manifestStat=await maybeStat(manifestFile);
  if(manifestStat&&(manifestStat.isSymbolicLink()||!manifestStat.isFile()))throw Error('Unsafe mobile-release.json manifest');
  const previous=manifestStat?validateManifest(JSON.parse(await fs.readFile(manifestFile,'utf8'))):{version:1,sourceCommit:null,files:[]};
  const before=await inventory(sourceRoot);if(!before.files.length)throw Error('Refusing to synchronize an empty mobile runtime');
  if(sourceCommit!==undefined&&sourceCommit!==null&&!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sourceCommit))throw Error('sourceCommit must be a full Git commit hash or null');
  const provenance=sourceCommit===undefined?await sourceCommitFor(sourceRoot):sourceCommit;
  const current=await maybeStat(targetRoot)?await inventory(targetRoot):{files:[],directories:[]};
  const currentMap=new Map(current.files.map(entry=>[entry.path.toLowerCase(),entry])),oldMap=new Map(previous.files.map(entry=>[entry.path.toLowerCase(),entry])),newMap=new Map(before.files.map(entry=>[entry.path.toLowerCase(),entry]));
  const stale=previous.files.filter(entry=>!newMap.has(entry.path.toLowerCase()));
  for(const entry of previous.files){
    const existing=currentMap.get(entry.path.toLowerCase());
    if(existing&&existing.path!==entry.path)throw Error('Managed path changed case: '+entry.path);
    if(current.directories.includes(entry.path))throw Error('Managed file became a directory: '+entry.path);
    if(existing&&!equalFile(existing,entry)&&!equalFile(existing,newMap.get(entry.path.toLowerCase())))throw Error('Refusing to overwrite or remove an edited managed file: '+entry.path);
  }
  for(const entry of before.files){
    const existing=currentMap.get(entry.path.toLowerCase());
    if(existing&&existing.path!==entry.path)throw Error('Destination path case collision: '+entry.path);
    if(existing&&!oldMap.has(entry.path.toLowerCase())&&!equalFile(existing,entry))throw Error('Refusing to overwrite a foreign file: '+entry.path);
    if(current.directories.includes(entry.path))throw Error('Destination file conflicts with a directory: '+entry.path);
    const parts=entry.path.split('/');parts.pop();while(parts.length){if(currentMap.has(parts.join('/').toLowerCase()))throw Error('Destination parent is a file: '+entry.path);parts.pop();}
  }
  await directoryChain(projectRoot,distRoot,{create:true});
  const staging=await fs.mkdtemp(path.join(distRoot,'.mobile-sync-'));
  try{
    for(const directory of before.directories)await directoryChain(staging,child(staging,directory),{create:true});
    for(const entry of before.files){
      const staged=child(staging,entry.path);await directoryChain(staging,path.dirname(staged),{create:true});
      await fs.copyFile(child(sourceRoot,entry.path),staged,1);
      if(!equalFile(await digest(staged),entry))throw Error('Mobile source changed during copy: '+entry.path);
    }
    if(JSON.stringify(await inventory(sourceRoot))!==JSON.stringify(before))throw Error('Mobile source changed during copy; retry from a stable source');
    await directoryChain(projectRoot,targetRoot,{create:true});
    for(const directory of before.directories)await directoryChain(targetRoot,child(targetRoot,directory),{create:true});
    for(const entry of before.files){
      const destination=child(targetRoot,entry.path),stat=await maybeStat(destination),expected=currentMap.get(entry.path.toLowerCase());
      if(stat){
        const actual=await digest(destination);
        if(equalFile(actual,entry))continue;
        if(!equalFile(actual,expected))throw Error('Destination changed during synchronization: '+entry.path);
      }else if(expected)throw Error('Destination disappeared during synchronization: '+entry.path);
      await atomicFile(destination,child(staging,entry.path),targetRoot);
    }
    for(const entry of stale){
      const destination=child(targetRoot,entry.path);if(!await maybeStat(destination))continue;
      await directoryChain(targetRoot,path.dirname(destination));
      if(!equalFile(await digest(destination),entry))throw Error('Stale managed file changed during synchronization: '+entry.path);
      await fs.unlink(destination);await removeEmptyParents(destination,targetRoot);
    }
    for(const directory of before.directories)await directoryChain(targetRoot,child(targetRoot,directory),{create:true});
    const manifest={version:1,sourceCommit:provenance,files:before.files};
    const manifestTemp=path.join(projectRoot,'.mobile-release-'+randomUUID()+'.tmp');
    let manifestTempOwned=false;
    try{await fs.writeFile(manifestTemp,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});manifestTempOwned=true;await fs.rename(manifestTemp,manifestFile);}finally{if(manifestTempOwned)await fs.unlink(manifestTemp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    // The committed destination remains a valid snapshot if an author edits the
    // source during destination writes; report that race so callers do not publish.
    if(JSON.stringify(await inventory(sourceRoot))!==JSON.stringify(before))throw Error('Mobile source changed during synchronization; destination contains the recorded snapshot, retry before publishing');
    return manifest;
  }finally{
    const resolved=path.resolve(staging);
    if(path.dirname(resolved)!==distRoot||!path.basename(resolved).startsWith('.mobile-sync-'))throw Error('Unsafe staging cleanup target');
    const stat=await maybeStat(resolved);if(stat){if(stat.isSymbolicLink()||!stat.isDirectory()||fold(await fs.realpath(resolved))!==fold(resolved))throw Error('Unsafe staging cleanup directory');await fs.rm(resolved,{recursive:true,force:true});}
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===script){
  let sourceRoot;const args=process.argv.slice(2);
  if(args.length){if(args.length!==2||args[0]!=='--source')throw Error('Usage: node scripts/sync-mobile.mjs [--source <runtime-directory>]');sourceRoot=path.resolve(args[1]);}
  const manifest=await syncMobile({sourceRoot});console.log(`Synchronized ${manifest.files.length} mobile runtime files into dist/mobil; source commit ${manifest.sourceCommit||'unavailable'}.`);
}
