import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject,validateProject} from '../dist/model.js';
import {autoArrange,resizeModule,validateLayout,exportSTL,exportSVG,exportDXF,printStats} from '../dist/geometry.js';
import {bulkMove,bulkRotate,bulkSetDepth,bulkLock,bulkDelete} from '../dist/bulk-edit.js';

const rectangle=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const fixture=()=>validateProject({...blankProject(),width:588,height:420,limitToBed:true,bedWidth:220,bedHeight:220,
  modules:[{id:'large',name:'Larger than the printer',x:0,y:0,width:252,height:252,sizeMode:'manual',grouped:true,locked:false}],
  tools:[{id:'long',name:'Measured long tool',points:rectangle(40,230),fingerGrips:[],depth:10,x:100,y:10,rotation:0,moduleId:'large',locked:false}]});
const printer=project=>[project.limitToBed,project.bedWidth,project.bedHeight,project.printMode,project.bottomMode];

test('legacy checked 220 mm bed never blocks editing a larger module or changes saved printer settings',()=>{
  const source=fixture(),snapshot=structuredClone(source),settings=printer(source);
  assert.deepEqual(validateLayout(source),[]);
  const enlarged=resizeModule(source,'large',{width:294,height:294});assert.equal(enlarged.modules[0].width,294);
  const moved=bulkMove(enlarged,['long'],{dx:42,dy:42});assert.equal(moved.modules[0].x,42);assert.equal(moved.modules[0].y,42);
  const rotated=bulkRotate(moved,['long']);assert.equal(rotated.tools[0].rotation,90);
  const deepened=bulkSetDepth(rotated,['long'],12);assert.equal(deepened.tools[0].depth,12);
  const automatic=resizeModule(deepened,'large',{mode:'auto'});assert.equal(automatic.modules[0].sizeMode,'auto');assert.ok(automatic.modules[0].width>220);
  const arranged={...automatic,...autoArrange(automatic)};assert.deepEqual(arranged.unplaced,[]);
  const locked=bulkLock(arranged,['long'],true),unlocked=bulkLock(locked,['long'],false),deleted=bulkDelete(unlocked,['long']);
  assert.equal(locked.modules[0].locked,true);assert.equal(unlocked.modules[0].locked,false);assert.equal(deleted.tools.length,0);
  for(const project of [enlarged,moved,rotated,deepened,automatic,arranged,locked,unlocked,deleted]){
    assert.deepEqual(printer(project),settings);assert.deepEqual(validateLayout(project),[]);
    const restored=validateProject(JSON.parse(JSON.stringify(project)));assert.deepEqual(printer(restored),settings);assert.equal(restored.tools.length,project.tools.length);
    if(project.tools.length)assert.deepEqual(project.tools[0].points,source.tools[0].points);
  }
  assert.deepEqual(source,snapshot,'Editing is atomic and does not migrate the source flag');
});

test('only final STL export and print estimates enforce the saved bed; 2D exports and internal mesh checks stay available',()=>{
  const project=fixture(),snapshot=structuredClone(project);
  assert.throws(()=>exportSTL(project),/tiskovou plochu/);assert.throws(()=>printStats(project),/tiskovou plochu/);
  assert.ok(exportSTL(project,{checkBed:false}).length>84);assert.ok(printStats(project,{checkBed:false}).volumeMm3>0);
  assert.match(exportSVG(project),/<svg/);assert.match(exportDXF(project),/\$INSUNITS/);
  assert.ok(exportSTL({...project,limitToBed:false}).length>84);
  assert.deepEqual(project,snapshot,'Export checks cannot change the drawer or disable its stored preference');
});
