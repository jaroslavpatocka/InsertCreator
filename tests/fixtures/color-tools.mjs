// Independent analytic physical geometry and deterministic photographic colors.
// Ring centers are material holes, but the manufacturing truth is the outer
// pocket silhouette; jaws remain exterior background in both truth layers.
export const backgrounds = {
  white:[255,255,255], offwhite:[248,246,239], gray:[145,148,151],
  charcoal:[34,37,41], blue:[20,91,143], green:[54,100,58], red:[135,39,44]
};
export const palettes = {
  silver:[[211,215,219],[211,215,219],[195,58,42]],
  black:[[18,21,25],[18,21,25],[18,21,25]],
  red:[[190,46,42],[190,46,42],[190,46,42]],
  blue_yellow:[[32,80,185],[220,186,35],[32,80,185]],
  multicolor:[[211,215,219],[211,215,219],[220,186,35]]
};
const shaft=(x,y)=>x>=-135&&x<=123&&Math.abs(y)<=10;
const wrench=(x,y,filled=false)=>shaft(x,y)
  ||(Math.hypot(x+135,y)<=33&&!(x< -128&&Math.abs(y)<14))
  ||(Math.hypot(x-140,y)<=26&&(filled||Math.hypot(x-140,y)>=15));
const rounded=(x,y,x0,y0,w,h,r)=>{
  if(x<x0||x>x0+w||y<y0||y>y0+h)return false;
  return Math.hypot(Math.max(0,x0+r-x,x-x0-w+r),Math.max(0,y0+r-y,y-y0-h+r))<=r;
};
const screwdriver=(x,y)=>rounded(x,y,-165,-6,220,12,1.5)||rounded(x,y,40,-23,125,46,9);
export const physicalShape=(tool,x,y,filled=false)=>tool.type==='wrench'?wrench(x,y,filled):tool.type==='bar'?Math.abs(x)<=180&&Math.abs(y)<=30:screwdriver(x,y);
export const onTool=(tool,x,y)=>({x:tool.x+x*Math.cos(tool.angle)-y*Math.sin(tool.angle),y:tool.y+x*Math.sin(tool.angle)+y*Math.cos(tool.angle)});
const clamp=v=>Math.max(0,Math.min(255,Math.round(v)));
const noise=(x,y)=>((x*17+y*29+(x*y)%13)%11)-5;
export function renderCase(spec){
  const width=spec.width??640,height=spec.height??460;
  const tools=spec.tools??[
    {type:'wrench',x:325,y:92,angle:-.08},
    {type:'wrench',x:315,y:236,angle:.12},
    {type:'screwdriver',x:320,y:371,angle:-.1}
  ];
  const base=spec.background??backgrounds[spec.bg??'white'];
  const palette=spec.colors??palettes[spec.palette??'multicolor'];
  const data=new Uint8ClampedArray(width*height*4),truth=new Uint8Array(width*height),material=new Uint8Array(width*height);
  const toolMasks=tools.map(()=>new Uint8Array(width*height));
  const bgAt=(x,y)=>base.map(v=>clamp(v+(spec.gradient?18*(x/width-.5)+12*(y/height-.5):0)+(spec.texture?noise(x,y)*.5:0)));
  const jaws=tools.filter(tool=>tool.type==='wrench').map(tool=>onTool(tool,-148,0));
  const gaps=spec.gaps??[{x:320,y:165},{x:320,y:305}];
  for(let p=0;p<width*height;p++){
    const x=p%width+.5,y=Math.floor(p/width)+.5,bg=bgAt(x,y);
    if(spec.shadow){
      const shadow=spec.shadow,dx=Math.max(shadow.x-x,0,x-shadow.x-shadow.width),dy=Math.max(shadow.y-y,0,y-shadow.y-shadow.height);
      const strength=shadow.sigma?Math.exp(-(dx*dx+dy*dy)/(2*shadow.sigma*shadow.sigma)):(dx||dy?0:1);
      const factor=1-shadow.delta/Math.max(...base)*strength;
      for(let c=0;c<3;c++)bg[c]=clamp(bg[c]*factor);
    }
    data.set([...bg,255],p*4);
    for(let i=0;i<tools.length;i++){
      const tool=tools[i],c=Math.cos(tool.angle),s=Math.sin(tool.angle);
      const xx=(x-tool.x)*c+(y-tool.y)*s,yy=-(x-tool.x)*s+(y-tool.y)*c;
      if(physicalShape(tool,xx,yy,true)){truth[p]=1;toolMasks[i][p]=1;}
      if(!physicalShape(tool,xx,yy))continue;
      material[p]=1;
      let color=[...palette[i%palette.length]];
      if(spec.invisible)color=[...bg];
      else {
        const silver=spec.palette==='silver'||spec.palette==='multicolor';
        const rim=[[-1.1,0],[1.1,0],[0,-1.1],[0,1.1]].some(([dx,dy])=>!physicalShape(tool,xx+dx,yy+dy));
        if(tool.type==='wrench'&&silver){
          const level=rim?165:213+Math.round(15*Math.cos(xx*.045)); color=[level,level+1,level+2];
          if(xx> -118&&xx< -109&&!rim)color=i%2?[225,55,155]:[35,163,215];
          if(xx> -95&&xx<106&&yy> -2&&yy<3&&!rim)color=[255,255,255];
          if(Math.abs(yy+6)<1&&xx> -75&&xx<105&&Math.floor(xx/11)%2===0)color=[95,95,95];
        }else if(tool.type==='screwdriver'&&(silver||spec.palette==='blue_yellow')){
          if(xx<43)color=[125,135,145];
          else if(xx>65&&xx<150&&Math.abs(yy)<11)color=[22,25,29];
          if(xx>70&&xx<145&&Math.floor(xx/13)%3===0&&Math.abs(yy)<16)color=[...palette[i%palette.length]];
          if(xx>30&&xx<50)color=[55,57,59];
        }
        if(spec.palette==='black'&&Math.abs(yy)<2)color=[64,68,72];
        if(spec.palette==='black'&&rim)color=[12,14,18];
        if(spec.invisibleConnector&&tool.type==='screwdriver'&&xx>20&&xx<62)color=[...bg];
      }
      data.set([...color.map(clamp),255],p*4);
    }
  }
  return {width,height,data,truth,material,toolMasks,tools,jaws,gaps,pxPerMm:spec.pxPerMm??2};
}

export const cases=[];
for(const bg of Object.keys(backgrounds))for(const palette of Object.keys(palettes))cases.push({id:`${bg}-${palette}`,bg,palette,expect:'visible'});
for(const bg of ['white','charcoal','blue','green'])cases.push({id:`${bg}-multicolor-gradient`,bg,palette:'multicolor',gradient:true,expect:'visible'});
for(const bg of ['gray','charcoal','blue','red'])cases.push({id:`${bg}-multicolor-texture`,bg,palette:'multicolor',texture:true,expect:'visible'});
cases.push({id:'white-invisible',bg:'white',palette:'silver',invisible:true,expect:'uncertain'});
cases.push({id:'charcoal-invisible',bg:'charcoal',palette:'black',invisible:true,expect:'uncertain'});
cases.push({id:'charcoal-missing-connector',bg:'charcoal',palette:'multicolor',invisibleConnector:true,expect:'uncertain'});
cases.push({id:'red-same-red-background',background:[190,46,42],palette:'red',invisible:true,expect:'uncertain'});
cases.push({id:'highres-multicolor-white',bg:'white',palette:'multicolor',width:1500,height:1000,tools:[
  {type:'wrench',x:750,y:250,angle:.27},{type:'wrench',x:740,y:500,angle:-.21},{type:'screwdriver',x:760,y:770,angle:.19}
],expect:'visible',pxPerMm:2});
for(const bg of ['gray','blue','green','red']){
  cases.push({id:`${bg}-shared-hard-shadow`,bg,palette:'silver',height:500,
    tools:[{type:'bar',x:320,y:150,angle:0},{type:'bar',x:320,y:330,angle:0}],gaps:[{x:320,y:240}],
    shadow:{x:135,y:115,width:370,height:250,delta:20},expect:'visible'});
  cases.push({id:`${bg}-single-soft-shadow`,bg,palette:'silver',height:500,
    tools:[{type:'bar',x:320,y:250,angle:0}],gaps:[{x:320,y:340}],
    shadow:{x:152,y:232,width:360,height:60,delta:34,sigma:22},expect:'visible'});
}
