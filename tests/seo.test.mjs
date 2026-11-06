import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateSEO} from '../scripts/check-seo.mjs';

const project=fileURLToPath(new URL('../',import.meta.url));
const home=path.join(project,'dist','index.html');
const modifyHome=transform=>({readFile:filename=>filename===home?Buffer.from(transform(fs.readFileSync(filename,'utf8'))):fs.readFileSync(filename)});

test('the shipped SEO graph resolves from desktop to every canonical page and the mobile equivalent',()=>{
  const result=validateSEO(project);
  assert.ok(result.canonicalPages>=6);
  assert.equal(result.mobilePages,1);
  assert.ok(result.structuredData>=2);
});

test('SEO validation rejects a homepage canonical pointing at a duplicate host',()=>{
  assert.throws(()=>validateSEO(project,modifyHome(html=>html.replace('rel="canonical" href="https://insertcreator.com/"','rel="canonical" href="https://www.insertcreator.com/"'))),/Nesprávná canonical/);
});

test('SEO validation catches links that a crawler would follow to a missing page',()=>{
  assert.throws(()=>validateSEO(project,modifyHome(html=>html.replace('href="/navody/"','href="/missing-seo-guide/"'))),/Nefunkční lokální odkaz/);
});

test('SEO validation catches mobile content loss even if the canonical still matches',()=>{
  const mobile=path.join(project,'dist','mobil','index.html');
  assert.throws(()=>validateSEO(project,{readFile:filename=>filename===mobile?Buffer.from(fs.readFileSync(filename,'utf8').replace(/<section\b[^>]*class="[^"]*ic-about[^"]*"[^>]*>[\s\S]*?<\/section>/i,'')):fs.readFileSync(filename)}),/hlavní nadpis|viditelný obsah/);
});
