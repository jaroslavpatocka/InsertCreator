import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

test('native tiling covers every source pixel, preserves model input and source alpha coordinates without resizing',t=>{
 const candidates=[process.env.INSERTCREATOR_BG_PYTHON,process.platform==='win32'?path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData/Local'),'Programs/Python/Python312/python.exe'):null,'python3','python'].filter(Boolean);
 const python=candidates.find(command=>{const probe=spawnSync(command,['-c','import sys;print(sys.version_info.major)'],{encoding:'utf8',windowsHide:true,timeout:5000});return!probe.error&&probe.status===0&&probe.stdout.trim()==='3';});
 if(!python){t.skip('Python3 unavailable; the HTTP backend controls remain independent of native dependencies');return;}
 const script=fileURLToPath(new URL('background-tiles.test.py',import.meta.url)),result=spawnSync(python,[script],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:2*1024*1024});
 assert.equal(result.error,undefined,String(result.error));assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.match(result.stderr,/Ran 9 tests/);t.diagnostic(result.stderr.trim());
});
