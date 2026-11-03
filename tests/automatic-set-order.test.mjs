import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {autoArrange,validateLayout} from '../dist/geometry.js';
test('ordinary Auto keeps requested nominal order for individual modules with unequal physical dimensions',()=>{
  const rectangle=(width,height)=>[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
  for(const order of ['asc','desc']){
    let project=validateProject({...blankProject(),width:840,height:630,tools:[140,60,100].map((length,index)=>({id:['z','a','m'][index],name:'Tool '+(index+1),points:rectangle(20,length),nominalSize:{value:index+1,unit:'mm'},depth:8,fingerGrips:[],x:0,y:0})),toolSets:[{id:'family',name:'Ordered family',toolIds:['z','a','m'],layout:'auto',order}]});
    for(let cycle=0;cycle<3;cycle++){
      project=validateProject({...project,...autoArrange(project)});assert.deepEqual(validateLayout(project),[]);
      const byId=new Map(project.modules.map(module=>[module.id,module]));
      const physical=project.tools.slice().sort((a,b)=>byId.get(a.moduleId).y-byId.get(b.moduleId).y||byId.get(a.moduleId).x-byId.get(b.moduleId).x);
      assert.deepEqual(physical.map(t=>t.nominalSize.value),order==='asc'?[1,2,3]:[3,2,1]);
      assert.equal(new Set(project.modules.map(m=>`${m.width}x${m.height}`)).size,3,'automatic modules retain their individual sizes');
    }
  }
});
