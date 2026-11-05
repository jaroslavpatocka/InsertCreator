import {validatePocketMargin,optionalPocketMargin} from './pocket-margin.js';

const copy=value=>JSON.parse(JSON.stringify(value));

/** Give only incoming tools the new module's margin while their module is being packed. */
export function prepareModuleMargins(project,tools,pocketMargin){
  const margin=validatePocketMargin(pocketMargin),inherited=[];
  const prepared=tools.map(tool=>{
    const next=copy(tool),override=optionalPocketMargin(tool.pocketMargin);
    if(override===undefined){next.pocketMargin=margin;inherited.push(tool.id);}
    else next.pocketMargin=override;
    return next;
  });
  return{tools:prepared,plan:{margin,ids:prepared.map(tool=>tool.id),inherited,previousModules:project.modules.map(module=>module.id)}};
}

/** Transfer temporary inherited values to newly created modules after packing.
 * Existing modules and their tools retain their own settings. Unplaced tools
 * retain an explicit margin until they have a module that can supply it. */
export function applyCreatedModuleMargins(project,plan){
  if(!plan)return project;
  const margin=validatePocketMargin(plan.margin),next=copy(project),ids=new Set(plan.ids),inherited=new Set(plan.inherited),previous=new Set(plan.previousModules);
  const newModuleIds=new Set(next.tools.filter(tool=>ids.has(tool.id)&&tool.moduleId&&!previous.has(tool.moduleId)).map(tool=>tool.moduleId));
  const modules=new Set();
  for(const module of next.modules)if(newModuleIds.has(module.id)){module.pocketMargin=margin;modules.add(module.id);}
  for(const tool of next.tools)if(inherited.has(tool.id)&&modules.has(tool.moduleId))delete tool.pocketMargin;
  return next;
}
