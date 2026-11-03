import {blankProject} from '../../dist/model.js';
import {autoArrange} from '../../dist/geometry.js';
import {automaticFingerGrips} from '../../dist/finger-grip.js';

export function screwdriverProject(seed=1,{count=6,slanted=true,grips=true,width=630,height=420,bed=300}={}){
  let value=seed>>>0;const random=()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};
  const tools=Array.from({length:count},(_,i)=>{
    const length=158+random()*24,handle=length*.33,w=25+random()*5,shaft=4.5+random()*1.5,join=length-handle;
    const coords=[[-shaft/2,0],[shaft/2,0],[shaft/2,join-3],[w/2-2,join+3],[w/2,join+9],[w/2,length-5],[w/2-4,length],[-w/2+4,length],[-w/2,length-5],[-w/2,join+9],[-w/2+2,join+3],[-shaft/2,join-3]];
    const angle=slanted?(.4+random()*.45)*(i%2?-1:1):0,c=Math.cos(angle),s=Math.sin(angle);
    let points=coords.map(([x,y])=>({x:x*c-y*s,y:x*s+y*c}));const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));points=points.map(p=>({x:p.x-x,y:p.y-y}));
    const tool={id:`screw-${seed}-${i}`,name:`Šroubovák ${i+1}`,unit:i%2?'in':'mm',color:i%2?'#e0b72b':'#c52b28',points,x:0,y:0,rotation:0,depth:11+i%3,locked:false,moduleId:null};
    if(grips)tool.fingerGrips=automaticFingerGrips(tool);
    return tool;
  });
  const project={...blankProject(),id:`smart-seed-${seed}`,name:'Šest šikmých šroubováků',width,height,bedWidth:bed,bedHeight:bed,limitToBed:true,printMode:'solid',tools};
  const result={...project,...autoArrange(project)};
  for(const module of result.modules)module.unit='mm';
  return result;
}
