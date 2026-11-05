import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function assetLinks(fingerprints,packageName='com.insertcreator.app') {
  if(!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2,}$/.test(packageName))throw Error('Invalid Android package name.');
  if(!Array.isArray(fingerprints)||!fingerprints.length)throw Error('Supply the real Play App Signing SHA-256 fingerprint.');
  const normalized=[...new Set(fingerprints.map(value=>{
    const hex=String(value).replaceAll(':','').toUpperCase();
    if(!/^[0-9A-F]{64}$/.test(hex)||/^(00){32}$/.test(hex)||/^(FF){32}$/.test(hex))throw Error('Expected a real SHA-256 certificate fingerprint (32 hexadecimal bytes).');
    return hex.match(/../g).join(':');
  }))];
  return [{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:packageName,sha256_cert_fingerprints:normalized}}];
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),fingerprints=[];let packageName='com.insertcreator.app';
  for(let i=0;i<args.length;i+=2){
    if(!args[i+1])throw Error('Usage: node android/scripts/assetlinks.mjs --fingerprint <PLAY_APP_SIGNING_SHA256> [--package com.insertcreator.app]');
    if(args[i]==='--fingerprint')fingerprints.push(args[i+1]);
    else if(args[i]==='--package')packageName=args[i+1];
    else throw Error('Unknown option '+args[i]);
  }
  const output=fileURLToPath(new URL('../hosting/.well-known/assetlinks.json',import.meta.url));
  const data=assetLinks(fingerprints,packageName);
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.writeFile(output,JSON.stringify(data,null,2)+'\n');
  console.log('Prepared '+output+'. Upload to https://insertcreator.com/.well-known/assetlinks.json after verifying the final Play signing certificate.');
}
