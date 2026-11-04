import {setLang} from './i18n.js';
import {setProjectUnit} from './units.js';
import {moduleMesh,previewBatch} from './preview-mesh.js';

// Neighbouring modules of one project share their joint plan.
let plannedKey=null,planned=null;
const batchFor=(project,key)=>{if(key!==plannedKey){planned=previewBatch(project);plannedKey=key;}return planned;};

self.onmessage=({data})=>{
  const {id,project,moduleId,projectKey,lang,unit}=data;
  try{
    if(lang)setLang(lang,{save:false});
    setProjectUnit(unit);
    const batch=batchFor(project,projectKey),mesh=moduleMesh(project,moduleId,batch);
    self.postMessage({id,result:{...mesh,joints:batch?.jointPlan?.joints.length||0,unjoined:batch?.jointPlan?.unjoined.length||0}},[mesh.vertices.buffer]);
  }catch(error){self.postMessage({id,error:{message:error?.message||String(error),i18n:error?.i18n||null}});}
};
