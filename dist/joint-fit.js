// A small, independent print of the same mating geometry used by production modules.
import {blankProject,validateProject} from './model.js';
import {preparePrintBatch} from './print-batch.js';

/** Two real puzzle coupons. The user's drawer and its tools are never modified or exported. */
export async function prepareJointFitTest(project,options={}){
  // Match the production tab's height, including the roof over blind magnet pockets.
  const base=project?.bottomMode==='magnet'?Math.max(project.base??2.4,Number(project.magnetDepth??2.2)+1.2):project?.base??2.4,clearance=project?.jointClearance??.2;
  const sample=validateProject({...blankProject(),id:'joint-fit-test',name:'Puzzle fit test',
    width:44,height:42,grid:42,base,insertHeight:Math.max(3,Number(base)+1.2),
    bedWidth:project?.bedWidth??220,bedHeight:project?.bedHeight??220,
    connectors:true,jointClearance:clearance,bottomMode:'plain',printMode:'solid',sizeLabels:false,
    modules:[
      {id:'joint-fit-tab',name:`Tab - clearance ${clearance} mm`,x:0,y:0,width:22,height:20,sizeMode:'manual'},
      {id:'joint-fit-socket',name:`Socket - clearance ${clearance} mm`,x:22,y:0,width:22,height:20,sizeMode:'manual'}
    ],tools:[]
  });
  const result=await preparePrintBatch(sample,{...options,moduleIds:sample.modules.map(module=>module.id)});
  return{...result,clearance:sample.jointClearance};
}
