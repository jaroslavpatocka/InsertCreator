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

/** A free single-tool module has no arrangement of its own to protect. While packing,
 * its margin rides on the tool so the module can move, shrink or merge like any other. */
export function releaseSoloMargins(project){
  const released=new Map(),modules=project.modules||[],tools=project.tools||[];
  if(!modules.some(module=>module.pocketMargin!=null))return{project,released};
  const members=new Map(),uniform=new Set();
  for(const tool of tools){const own=members.get(tool.moduleId);if(own)own.push(tool);else members.set(tool.moduleId,[tool]);}
  for(const set of project.toolSets||[])if(set.layout==='uniform')for(const id of set.toolIds||[])uniform.add(id);
  const freed=new Set();
  for(const module of modules){
    const own=members.get(module.id);
    if(module.pocketMargin==null||own?.length!==1||module.locked||module.sizeMode==='manual'||module.grouped===true||module.setId||module.setLayout==='uniform')continue;
    const[tool]=own;
    if(tool.locked||tool.pocketMargin!=null||uniform.has(tool.id))continue;
    released.set(tool.id,module.pocketMargin);freed.add(module.id);
  }
  if(!released.size)return{project,released};
  return{released,project:{...project,
    modules:modules.map(module=>{if(!freed.has(module.id))return module;const{pocketMargin,...rest}=module;return rest;}),
    tools:tools.map(tool=>released.has(tool.id)?{...tool,pocketMargin:released.get(tool.id)}:tool)}};
}

/** Return released margins to the modules that now hold only tools with that same value.
 * A module shared with any other margin keeps them on its tools, so no pocket changes size. */
export function restoreSoloMargins(result,released){
  if(!released.size)return result;
  const members=new Map();
  for(const tool of result.tools){const own=members.get(tool.moduleId);if(own)own.push(tool);else members.set(tool.moduleId,[tool]);}
  const inherited=new Set();
  const modules=result.modules.map(module=>{
    const own=members.get(module.id);
    if(!own||module.pocketMargin!=null)return module;
    const margin=released.get(own[0].id);
    if(margin===undefined||own.some(tool=>released.get(tool.id)!==margin||tool.pocketMargin!==margin))return module;
    for(const tool of own)inherited.add(tool.id);
    return{...module,pocketMargin:margin};
  });
  const tools=result.tools.map(tool=>{if(!inherited.has(tool.id))return tool;const{pocketMargin,...rest}=tool;return rest;});
  return{...result,tools,modules};
}
