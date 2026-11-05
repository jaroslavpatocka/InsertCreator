import test from 'node:test';
import assert from 'node:assert/strict';
import {assetLinks} from './assetlinks.mjs';

test('association uses the supplied release certificate and exact Android package',()=>{
  const cert='0123456789abcdef'.repeat(4),result=assetLinks([cert,cert.toUpperCase()],'com.insertcreator.app');
  assert.deepEqual(result,[{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:'com.insertcreator.app',sha256_cert_fingerprints:[cert.toUpperCase().match(/../g).join(':')]}}]);
});
test('missing, partial, and placeholder certificates cannot produce a hosting association',()=>{
  for(const values of [[],['REPLACE_WITH_SHA256'],['AA:BB'],['00'.repeat(32)],['FF'.repeat(32)]])assert.throws(()=>assetLinks(values));
});
test('the generator refuses malformed or ambiguous Android identifiers',()=>{
  for(const name of ['../app','https://insertcreator.com','com..app','com.insertcreator.app/other'])assert.throws(()=>assetLinks(['0123456789abcdef'.repeat(4)],name));
});
