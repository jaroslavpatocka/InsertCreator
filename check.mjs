import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const files=fs.readdirSync('dist').filter(name=>/\.js$/.test(name)).map(name=>path.join('dist',name));
for(const file of [...files,'serve.mjs']){
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status!==0){process.stderr.write(result.stderr);process.exit(result.status||1);}
}
const sw=fs.readFileSync('dist/sw.js','utf8');
const assets=sw.match(/const ASSETS=\[([^\]]+)\]/)?.[1].match(/'([^']+)'/g).map(item=>item.slice(1,-1));
if(!assets)throw Error('Chybí seznam offline souborů.');
for(const asset of assets)if(!fs.existsSync(path.join('dist',asset)))throw Error('V offline cache chybí soubor '+asset);
for(const file of files){
  const source=fs.readFileSync(file,'utf8');
  for(const match of source.matchAll(/(?:from\s*|import\s*\()['"](\.\/[^'"]+)['"]/g)){
    if(!fs.existsSync(path.resolve(path.dirname(file),match[1])))throw Error(`Chybí import ${match[1]} v ${file}`);
  }
}
console.log(`Ověřeno ${files.length+1} skriptů, všechny lokální importy a ${assets.length} offline souborů.`);
