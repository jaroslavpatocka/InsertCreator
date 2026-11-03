import fs from 'node:fs';
const f='dist/app.js';let s=fs.readFileSync(f,'utf8');
s=s.replace("import {exportFitPDF}","import {printPreview} from './preview3d.js';\nimport {exportFitPDF}");
s=s.replace('function render3D(svg){',"function render3D(svg){\n  try{const p=printPreview(project,selected,selectedModule);svg.setAttribute('viewBox',p.viewBox);svg.innerHTML=p.html;return;}catch{}\n");
s=s.replace("if((e.pointerType==='touch'&&!moveMode)||view==='3d'||m.locked)","if(view==='3d'||m.locked)");
s=s.replace("const group=e.target.closest('[data-module]'),svg=","if(e.pointerType==='touch'&&!moveMode)return;\n  const group=e.target.closest('[data-module]'),svg=");
const needle="const a=e.target.closest('[data-action]');if(a)";
s=s.replace(needle,"const group=e.target.closest('[data-module]');if(group&&!moveMode){const m=project.modules.find(m=>m.id===group.dataset.module),t=project.tools.find(t=>t.moduleId===m?.id);selected=t?.id||null;selectedModule=t?null:m?.id;inspectorTab='tool';render();return;}"+needle);
fs.writeFileSync(f,s);
