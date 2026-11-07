// Integration tests exercise a populated drawer. A first start is blank now and an untouched stored
// sample is dropped at boot, so call this before importing the app. Tool ids differ from the generated
// sample, which makes the project and library the user's own work; the geometry stays identical.
import {createDemoProject} from '../dist/geometry.js';

export function seedSample(){
  const sample=createDemoProject();
  const tools=sample.tools.map(tool=>({...tool,id:`fixture-${tool.id}`}));
  localStorage.setItem('suplik-studio-projects-v1',JSON.stringify([{...sample,id:'fixture-sample',tools}]));
  localStorage.setItem('suplik-studio-current',JSON.stringify('fixture-sample'));
  localStorage.setItem('suplik-studio-library-v1',JSON.stringify(tools.map(tool=>({...tool,x:0,y:0,moduleId:null}))));
  localStorage.setItem('suplik-studio-start-guide','{"status":"done"}');
}
