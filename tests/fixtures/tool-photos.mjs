import {createCanvas} from '@napi-rs/canvas';

// Synthetic, deterministic photographs: these do not contain pixels from the
// user's screenshot. Separate truth layers describe physical tools, not colors.
function silhouette(ctx,tool){
  const tip=-tool.length/2,join=tool.length/2-tool.handleLength;
  ctx.beginPath();
  ctx.roundRect(tip,-tool.shaftWidth/2,join-tip+8,tool.shaftWidth,1.5);ctx.fill();
  ctx.beginPath();
  ctx.roundRect(join,-tool.handleWidth/2,tool.handleLength,tool.handleWidth,tool.radius??8);ctx.fill();
}

function inToolFrame(ctx,tool,draw){
  ctx.save();ctx.translate(tool.x,tool.y);ctx.rotate(tool.angle);draw();ctx.restore();
}

function paintTool(ctx,tool){
  inToolFrame(ctx,tool,()=>{
    const tip=-tool.length/2,join=tool.length/2-tool.handleLength;
    ctx.fillStyle='#62676d';
    ctx.beginPath();ctx.roundRect(tip,-tool.shaftWidth/2,join-tip+8,tool.shaftWidth,1.5);ctx.fill();
    ctx.fillStyle='#aab0b5';ctx.fillRect(tip+4,-tool.shaftWidth/2+2,join-tip-2,Math.max(2,tool.shaftWidth*.35));
    ctx.fillStyle=tool.color;
    ctx.beginPath();ctx.roundRect(join,-tool.handleWidth/2,tool.handleLength,tool.handleWidth,tool.radius??8);ctx.fill();
    if(tool.transition){
      const gradient=ctx.createLinearGradient(join-18,0,join+28,0);
      gradient.addColorStop(0,'#62676d');gradient.addColorStop(.45,'#937254');gradient.addColorStop(1,tool.color);
      ctx.fillStyle=gradient;ctx.fillRect(join-18,-tool.shaftWidth/2,46,tool.shaftWidth);
    }
    if(tool.blackGrip){
      ctx.fillStyle='#232527';
      ctx.beginPath();ctx.roundRect(join+18,-tool.handleWidth*.28,tool.handleLength-35,tool.handleWidth*.56,5);ctx.fill();
      ctx.fillStyle=tool.color;
      for(let x=join+36;x<tool.length/2-22;x+=22)ctx.fillRect(x,-tool.handleWidth*.2,5,tool.handleWidth*.4);
    }
    if(tool.longitudinalHighlight){
      // A colored specular band stays enclosed inside one continuous object.
      const highlight=ctx.createLinearGradient(0,-3,0,3);
      highlight.addColorStop(0,'rgba(239,220,181,0)');highlight.addColorStop(.5,'#efdeb8');highlight.addColorStop(1,'rgba(239,220,181,0)');
      ctx.fillStyle=highlight;ctx.fillRect(tip+10,-3,tool.length-20,6);
    }
  });
}

function binaryLayer(width,height,tool,shaftOnly=false){
  const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
  ctx.fillStyle='#000';
  inToolFrame(ctx,tool,()=>{
    if(shaftOnly){
      // Measure the thin exposed shaft, away from its handle and antialiased rim.
      const tip=-tool.length/2,join=tool.length/2-tool.handleLength;
      ctx.fillRect(tip+6,-tool.shaftWidth/2+2,join-tip-12,Math.max(1,tool.shaftWidth-4));
    }else silhouette(ctx,tool);
  });
  const rgba=ctx.getImageData(0,0,width,height).data;
  return Uint8Array.from({length:width*height},(_,i)=>+(rgba[i*4+3]>=128));
}

function photo(width,height,tools,pxPerMm=2){
  const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
  ctx.fillStyle='#fafaf8';ctx.fillRect(0,0,width,height);
  const toolMasks=tools.map(tool=>binaryLayer(width,height,tool));
  const shaftMasks=tools.map(tool=>binaryLayer(width,height,tool,true));
  for(const tool of tools)paintTool(ctx,tool);
  const truth=new Uint8Array(width*height);
  for(const mask of toolMasks)for(let i=0;i<mask.length;i++)truth[i]|=mask[i];
  return {width,height,data:ctx.getImageData(0,0,width,height).data,truth,toolMasks,shaftMasks,tools,pxPerMm};
}

export function slantedScrewdriversPhoto(){
  const angle=Math.PI*.23,normal={x:-Math.sin(angle),y:Math.cos(angle)};
  const colors=['#c52b28','#e0b72b','#c52b28','#d4ad25','#bf3027','#cfaa29'];
  return photo(820,760,colors.map((color,i)=>({
    x:410+normal.x*(i-2.5)*61,y:380+normal.y*(i-2.5)*61,
    angle:angle+(i%2?Math.PI:0),length:450-(i%3)*20,
    handleLength:145+(i%2)*10,handleWidth:38,shaftWidth:10,color,blackGrip:true
  })));
}

export function parallelScrewdriversPhoto({gap=2,touching=false,angle=0}={}){
  const handleWidth=40,spacing=handleWidth+(touching?0:gap);
  return photo(360,510,['#c52b28','#d9b329'].map((color,i)=>({
    x:180+(i-.5)*spacing*Math.cos(angle),y:255+(i-.5)*spacing*Math.sin(angle),angle:Math.PI/2+angle,length:380,
    handleLength:140,handleWidth,shaftWidth:10,color,blackGrip:!touching,radius:touching?4:8
  })));
}

export function connectedScrewdriverPhoto(){
  return photo(530,390,[{x:265,y:195,angle:.25,length:390,handleLength:145,
    handleWidth:42,shaftWidth:10,color:'#bd342a',blackGrip:true,transition:true}]);
}

export function longitudinalHighlightPhoto(){
  return photo(530,390,[{x:265,y:195,angle:-.32,length:390,handleLength:145,
    handleWidth:42,shaftWidth:10,color:'#374b56',longitudinalHighlight:true}]);
}

export function rasterizeContours(contours,width,height){
  const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
  ctx.fillStyle='#000';
  for(const contour of contours){
    ctx.beginPath();contour.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();
  }
  const rgba=ctx.getImageData(0,0,width,height).data;
  return Uint8Array.from({length:width*height},(_,i)=>+(rgba[i*4+3]>=128));
}

export function maskMetrics(actual,expected){
  let intersection=0,union=0,expectedArea=0,actualArea=0;
  for(let i=0;i<expected.length;i++){
    intersection+=+(actual[i]&&expected[i]);union+=+(actual[i]||expected[i]);
    expectedArea+=expected[i];actualArea+=actual[i];
  }
  return {iou:union?intersection/union:0,recall:expectedArea?intersection/expectedArea:0,
    precision:actualArea?intersection/actualArea:0};
}
