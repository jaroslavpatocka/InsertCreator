import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {addToolGroup} from '../dist/set-module.js';

const tool=id=>({id,name:id,points:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],depth:8,x:0,y:0,rotation:0,locked:false,moduleId:null,fingerGrips:[]});
const projectWithTools=count=>({...blankProject(),tools:Array.from({length:count},(_,i)=>tool(`existing-${i}`))});

test('a project containing 3000 tools survives import and JSON reload without losing tools',()=>{
  const source=projectWithTools(3000);
  source.toolSets=[{id:'all-tools',name:'All tools',layout:'shared',toolIds:source.tools.map(tool=>tool.id)}];
  const snapshot=structuredClone(source);
  const imported=validateProject({schemaVersion:1,project:source});
  const restored=validateProject(JSON.parse(JSON.stringify(imported)));
  assert.equal(restored.tools.length,3000);
  assert.deepEqual(restored,imported);
  assert.deepEqual(restored.tools.map(tool=>tool.id),source.tools.map(tool=>tool.id));
  assert.deepEqual(restored.toolSets[0].toolIds,source.tools.map(tool=>tool.id));
  assert.deepEqual(source,snapshot,'Import leaves the supplied project intact');
});

test('ordinary automatic tool insertion can exceed 400 existing tool modules',()=>{
  const source=projectWithTools(401);
  source.width=3000;source.height=3000;
  source.modules=source.tools.map((tool,i)=>({id:`module-${i}`,x:i%50*42,y:Math.floor(i/50)*42,width:42,height:42,sizeMode:'auto'}));
  source.tools=source.tools.map((tool,i)=>({...tool,moduleId:`module-${i}`,x:i%50*42+16,y:Math.floor(i/50)*42+16}));
  const project=validateProject(source),snapshot=structuredClone(project);
  const result=addToolGroup(project,[tool('new-tool')],{toolSet:{layout:'auto'}});
  assert.equal(result.project.tools.length,402);
  assert.equal(result.project.modules.length,402);
  assert.equal(validateProject(JSON.parse(JSON.stringify(result.project))).modules.length,402);
  assert.deepEqual(project,snapshot);
});

test('a project with 3000 singleton tool sets survives JSON reload',()=>{
  const source=projectWithTools(3000);
  source.toolSets=source.tools.map(tool=>({id:`set-${tool.id}`,name:tool.id,toolIds:[tool.id],layout:'auto'}));
  const restored=validateProject(JSON.parse(JSON.stringify(source)));
  assert.equal(restored.toolSets.length,3000);
  assert.deepEqual(restored.toolSets.map(set=>set.toolIds[0]),source.tools.map(tool=>tool.id));
});

test('import refuses tool 3001 while preserving the supplied project',()=>{
  const source=projectWithTools(3001),snapshot=structuredClone(source);
  assert.throws(()=>validateProject(source),/Limit je 3000 nástrojů/);
  assert.deepEqual(source,snapshot);
});

test('adding a shared tool group crosses the former 300-tool limit and reaches exactly 3000',()=>{
  for(const count of [300,2999]){
    const project=validateProject(projectWithTools(count)),snapshot=structuredClone(project),added=[tool('new-tool')];
    const result=addToolGroup(project,added,{toolSet:{layout:'shared'}});
    assert.equal(result.project.tools.length,count+1);
    assert.equal(result.project.modules.length,1);
    assert.ok(result.project.tools.find(tool=>tool.id==='new-tool').moduleId);
    assert.equal(validateProject(JSON.parse(JSON.stringify(result.project))).tools.length,count+1);
    assert.deepEqual(project,snapshot,'Adding tools leaves the original project intact');
    assert.equal(added[0].moduleId,null,'Adding tools leaves the supplied tool intact');
  }
});
