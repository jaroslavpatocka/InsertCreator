// Reflective metal on a measured dark neutral backdrop. Source pixels and scale remain immutable.
import { plainBackgroundModel } from './photo-background-model.js';
const lum=(r,g,b)=>.2126*r+.7152*g+.0722*b;
// Recover a dark grip only when the original photograph supplies both of its
// boundaries. Bright components are anchors, never a reason to fill their hull.
function components(image) {
  const { width, height, data } = image, labels = new Int32Array(width * height), queue = new Int32Array(labels.length), pieces = [];
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] || data[start * 4] >= 224) continue;
    if (pieces.length >= 512) return { labels, pieces: [], overflow: true };
    const id = pieces.length + 1, pixels = []; let head = 0, tail = 1, sx = 0, sy = 0, xx = 0, xy = 0, yy = 0;
    queue[0] = start; labels[start] = id;
    while (head < tail) {
      const p = queue[head++], x = p % width + .5, y = Math.floor(p / width) + .5;
      pixels.push(p); sx += x; sy += y; xx += x * x; xy += x * y; yy += y * y;
      const push = n => { if (!labels[n] && data[n * 4] < 224) { labels[n] = id; queue[tail++] = n; } };
      if (p % width) push(p - 1); if (p % width + 1 < width) push(p + 1);
      if (p >= width) push(p - width); if (p + width < labels.length) push(p + width);
    }
    const x = sx / tail, y = sy / tail, angle = .5 * Math.atan2(2 * (xy / tail - x * y), xx / tail - x * x - yy / tail + y * y);
    pieces.push({ id, pixels, x, y, ax: Math.cos(angle), ay: Math.sin(angle), area: tail });
  }
  for (const piece of pieces) if (piece.area < 12) for (const p of piece.pixels) labels[p] = 0;
  return { labels, pieces: pieces.filter(p => p.area >= 12) };
}

function bounds(piece, frame, width) {
  let lo = Infinity, hi = -Infinity, left = Infinity, right = -Infinity;
  for (const p of piece.pixels) {
    const x = p % width + .5 - frame.x, y = Math.floor(p / width) + .5 - frame.y;
    const s = x * frame.ax + y * frame.ay, t = -x * frame.ay + y * frame.ax;
    lo = Math.min(lo, s); hi = Math.max(hi, s); left = Math.min(left, t); right = Math.max(right, t);
  }
  return { lo, hi, left, right, length: hi - lo + 1, width: right - left + 1 };
}

function section(sample, frame, s, center, radius, minWidth, requireDark, maxWidth = radius * 1.7, longitudinalRadius = 1.5) {
  const profile = new Float32Array(2 * radius + 1);
  for (let t = -radius; t <= radius; t++) {
    let sum = 0;
    for (const ds of [-longitudinalRadius, 0, longitudinalRadius]) sum += sample(frame.x + (s + ds) * frame.ax - (center + t) * frame.ay, frame.y + (s + ds) * frame.ay + (center + t) * frame.ax);
    profile[t + radius] = sum / 3;
  }
  const value = t => profile[t + radius], mean = (a, b) => { let v = 0; for (let t = a; t <= b; t++) v += value(t); return v / (b - a + 1); };
  const top = [], bottom = [], minimum = Math.max(2, minWidth * .25);
  for (let t = -radius + 4; t <= radius - 4; t++) {
    const nearLeft = mean(t - 1, t), farLeft = mean(t - 4, t - 2), nearRight = mean(t, t + 1), farRight = mean(t + 2, t + 4);
    const nearTop = nearLeft - mean(t + 1, t + 2), broadTop = farLeft - mean(t + 1, t + 3);
    const nearBottom = nearRight - mean(t - 2, t - 1), broadBottom = farRight - mean(t - 3, t - 1);
    // Across an absent anchor connection, broad support must outlast woven
    // background texture. A narrow edge may refine an already anchored rim.
    const useNearTop = !requireDark && nearTop >= broadTop * .65, useNearBottom = !requireDark && nearBottom >= broadBottom * .65;
    const left = useNearTop ? nearTop : broadTop * (requireDark ? 1 : .65), right = useNearBottom ? nearBottom : broadBottom * (requireDark ? 1 : .65);
    const outsideLeft = useNearTop ? nearLeft : farLeft, outsideRight = useNearBottom ? nearRight : farRight;
    if (t < -minimum && left >= 6 && outsideLeft < 150) top.push({ t: t + .5, edge: left, outside: outsideLeft });
    if (t > minimum && right >= 6 && outsideRight < 150) bottom.push({ t: t - .5, edge: right, outside: outsideRight });
  }
  top.sort((a, b) => b.edge - a.edge); bottom.sort((a, b) => b.edge - a.edge);
  const peaks = list => list.filter((p, i) => !list.slice(0, i).some(q => Math.abs(q.t - p.t) < 3)).slice(0, 8);
  const pairs = [];
  for (const a of peaks(top)) for (const b of peaks(bottom)) {
    const width = b.t - a.t;
    if (width < minWidth || width > maxWidth || Math.abs(a.t + b.t) > radius * .65) continue;
    const inside = [];
    for (let t = Math.ceil(a.t + 3); t <= b.t - 3; t += 2) inside.push(value(t));
    inside.sort((x, y) => x - y);
    const contrast = Math.min(a.outside, b.outside) - inside[inside.length >> 1];
    if (requireDark && !(contrast >= 5)) continue;
    pairs.push({ top: center + a.t, bottom: center + b.t, score: Math.min(a.edge, b.edge) + (a.edge + b.edge) * .15 });
  }
  return pairs.sort((a, b) => b.score - a.score).slice(0, 12);
}

function paint(image, labels, frame, rows, allowed) {
  const { width, height, data } = image, contacts = new Set();
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i], b = rows[i + 1];
    for (let s = a.s; s <= b.s; s += .5) {
      const f = (s - a.s) / (b.s - a.s), top = a.top + (b.top - a.top) * f, bottom = a.bottom + (b.bottom - a.bottom) * f;
      for (let t = top; t <= bottom; t += .5) {
        const x = Math.floor(frame.x + s * frame.ax - t * frame.ay), y = Math.floor(frame.y + s * frame.ay + t * frame.ax);
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const p = y * width + x;
        if (labels[p] && !allowed.has(labels[p])) return false;
        // Four-neighbour adjacency also merges components when auto-trace
        // labels the result; leaving foreign pixels untouched is insufficient.
        for (const n of [x ? p - 1 : p, x + 1 < width ? p + 1 : p, y ? p - width : p, y + 1 < height ? p + width : p]) {
          if (labels[n] && !allowed.has(labels[n])) return false;
        }
        if (allowed.has(labels[p])) contacts.add(labels[p]);
      }
    }
  }
  if (contacts.size !== allowed.size) return false;
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i], b = rows[i + 1];
    for (let s = a.s; s <= b.s; s += .5) {
      const f = (s - a.s) / (b.s - a.s), top = a.top + (b.top - a.top) * f, bottom = a.bottom + (b.bottom - a.bottom) * f;
      for (let t = top; t <= bottom; t += .5) {
        const x = Math.floor(frame.x + s * frame.ax - t * frame.ay), y = Math.floor(frame.y + s * frame.ay + t * frame.ax);
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const p = (y * width + x) * 4;
        data[p] = data[p + 1] = data[p + 2] = 0;
        labels[p / 4] = frame.id;
      }
    }
  }
  return true;
}

function sampleField(field, width, height) {
  return (x,y)=>{
    x-=.5;y-=.5;if(x<0||y<0||x>=width-1||y>=height-1)return NaN;
    const ix=Math.floor(x),iy=Math.floor(y),dx=x-ix,dy=y-iy,p=iy*width+ix;
    return(field[p]*(1-dx)+field[p+1]*dx)*(1-dy)+(field[p+width]*(1-dx)+field[p+width+1]*dx)*dy;
  };
}
function outsideOf(mask,width,height){
  const outside=new Uint8Array(mask.length),q=new Int32Array(mask.length);let head=0,tail=0;
  const push=p=>{if(!mask[p]&&!outside[p]){outside[p]=1;q[tail++]=p;}};
  for(let x=0;x<width;x++){push(x);push((height-1)*width+x);}for(let y=1;y<height-1;y++){push(y*width);push(y*width+width-1);}
  while(head<tail){const p=q[head++],x=p%width;if(x)push(p-1);if(x+1<width)push(p+1);if(p>=width)push(p-width);if(p+width<mask.length)push(p+width);}
  return outside;
}
function rangeAt(field,width,height,p){
  const x=p%width,y=Math.floor(p/width);let low=255,high=0;
  for(let yy=Math.max(0,y-2);yy<=Math.min(height-1,y+2);yy++)for(let xx=Math.max(0,x-2);xx<=Math.min(width-1,x+2);xx++){const v=field[yy*width+xx];low=Math.min(low,v);high=Math.max(high,v);}
  return high-low;
}
function thresholdImage(mask,width,height){
  const data=new Uint8ClampedArray(mask.length*4);
  for(let p=0;p<mask.length;p++){const v=mask[p]?24:255;data[p*4]=data[p*4+1]=data[p*4+2]=v;data[p*4+3]=255;}
  return{width,height,data};
}
// Soft negative-polarity cast shadows have no sharp source boundary. Removing
// one never authorizes deleting a weak but visibly bounded real part below.
function removeSoftShadows(mask,negative,delta,width,height){
  const outside=outsideOf(mask,width,height),seen=new Uint8Array(mask.length),q=new Int32Array(mask.length);
  for(let start=0;start<mask.length;start++){
    if(!negative[start]||seen[start])continue;let head=0,tail=1,edge=0,strong=0,peak=0;q[0]=start;seen[start]=1;
    while(head<tail){const p=q[head++],x=p%width;peak=Math.max(peak,delta[p]);
      if((x&&outside[p-1])||(x+1<width&&outside[p+1])||(p>=width&&outside[p-width])||(p+width<mask.length&&outside[p+width])){edge++;strong+=+(rangeAt(delta,width,height,p)>=18);}
      const push=n=>{if(negative[n]&&!seen[n]){seen[n]=1;q[tail++]=n;}};
      if(x)push(p-1);if(x+1<width)push(p+1);if(p>=width)push(p-width);if(p+width<mask.length)push(p+width);
    }
    if(tail>16&&edge&&strong<edge*.8&&peak<40)for(let i=0;i<tail;i++)mask[q[i]]=0;
  }
}
function missingVisibleMaterial(low,prepared,delta,width,height){
  const outside=outsideOf(low,width,height),missing=new Uint8Array(low.length),seen=new Uint8Array(low.length),queue=new Int32Array(low.length);
  for(let p=0;p<low.length;p++)missing[p]=+(low[p]&&!prepared[p]);
  for(let start=0;start<low.length;start++){
    if(!missing[start]||seen[start])continue;let head=0,tail=1,edge=0,strong=0;queue[0]=start;seen[start]=1;
    while(head<tail){const p=queue[head++],x=p%width;
      if((x&&outside[p-1])||(x+1<width&&outside[p+1])||(p>=width&&outside[p-width])||(p+width<low.length&&outside[p+width])){edge++;strong+=+(rangeAt(delta,width,height,p)>=18);}
      const push=n=>{if(missing[n]&&!seen[n]){seen[n]=1;queue[tail++]=n;}};
      if(x)push(p-1);if(x+1<width)push(p+1);if(p>=width)push(p-width);if(p+width<low.length)push(p+width);
    }
    // A coherently sharp missing body is different from a few antialias or
    // cast-shadow pixels beside an already measured metal boundary.
    if(tail>=32&&edge>=4&&strong>=edge*.8)return true;
  }
  return false;
}
function neckWidth(labels,frame,end,width,height,maxWidth){
  const widths=[];
  for(const inset of [2,3,4,5]){
    const s=end-inset;let left=Infinity,right=-Infinity;
    for(let t=-Math.ceil(maxWidth);t<=Math.ceil(maxWidth);t++){
      const x=Math.floor(frame.x+s*frame.ax-t*frame.ay),y=Math.floor(frame.y+s*frame.ay+t*frame.ax);
      if(x<0||y<0||x>=width||y>=height||labels[y*width+x]!==frame.id)continue;
      left=Math.min(left,t);right=Math.max(right,t);
    }
    if(Number.isFinite(left))widths.push(right-left+1);
  }
  widths.sort((a,b)=>a-b);return widths[widths.length>>1]??0;
}
function measuredBridge(sample,raw,frame,from,to,innerFrom,innerTo,center,radius,minWidth,maxWidth){
  const step=(to-from)/Math.max(1,Math.ceil((to-from)/.5)),rows=[];let darkSupport=false,lastSupported=null,ambiguous=false;
  for(let s=innerFrom+.125;s<innerTo-.125;s+=.25)darkSupport ||= section(raw,frame,s,center,radius,minWidth,true,maxWidth,0).length>0;
  for(let s=from;s<=to+.001;s+=step){
    const options=section(sample,frame,s,center,radius,minWidth,true,maxWidth,0);
    if(!options.length){if(lastSupported===null||s-lastSupported>1.5)return null;ambiguous=true;continue;}
    const previous=rows.at(-1);
    const viable=options.filter(p=>!previous||(Math.abs(p.top-previous.top)+Math.abs(p.bottom-previous.bottom)<=Math.max(3,(s-previous.s)*3)));
    if(!viable.length)return null;
    const row=viable.sort((a,b)=>(b.score-(previous?Math.abs(b.top-previous.top)+Math.abs(b.bottom-previous.bottom):0)*3)-(a.score-(previous?Math.abs(a.top-previous.top)+Math.abs(a.bottom-previous.bottom):0)*3))[0];
    rows.push({...row,s});lastSupported=s;
    if(s>=innerFrom&&s<=innerTo&&section(raw,frame,s,center,radius,minWidth,true,maxWidth,0).length)darkSupport=true;
  }
  if(!rows.length||to-rows.at(-1).s>.001||!darkSupport)return null;
  const centers=rows.map(r=>(r.top+r.bottom)/2),widths=rows.map(r=>r.bottom-r.top);
  if(Math.max(...centers)-Math.min(...centers)>1.5||Math.max(...widths)-Math.min(...widths)>4)return null;
  rows.ambiguousBridge=ambiguous;return rows;
}
// Bilinear profiles can borrow an edge from either side of a true gap.
// Source-sized nearest-pixel material sections therefore bound every missing
// run independently. A one-pixel indistinguishable seam remains a reviewable
// proposal; a wider visibly empty gap is never bridged.
function sourceSections(delta,threshold,width,height,frame,rows,from,to){
  const step=(to-from)/Math.max(1,Math.ceil((to-from)/.25));let missing=0,ambiguous=false,index=0;
  for(let s=from;s<=to+.001;s+=step){
    while(index+1<rows.length&&rows[index+1].s<s)index++;
    const a=rows[index],b=rows[Math.min(index+1,rows.length-1)],f=a===b?0:Math.max(0,Math.min(1,(s-a.s)/(b.s-a.s)));
    const top=a.top+(b.top-a.top)*f,bottom=a.bottom+(b.bottom-a.bottom)*f,values=[];
    for(let t=top+2;t<=bottom-2;t+=1){
      const x=Math.floor(frame.x+s*frame.ax-t*frame.ay),y=Math.floor(frame.y+s*frame.ay+t*frame.ax);
      if(x<0||y<0||x>=width||y>=height)return null;values.push(delta[y*width+x]);
    }
    values.sort((a,b)=>a-b);if(!values.length)return null;
    if(values[values.length>>1]<threshold){missing+=step;ambiguous=true;if(missing>1.5+.001)return null;}else missing=0;
  }
  return{ambiguous};
}
// Only a short measured band between one elongated anchor and one compact
// head is recoverable here. Long handles retain photo-recovery.js unchanged.
function recoverBands(original,enhanced,contrast,rawValues,delta,threshold){
  const{width,height}=enhanced,{labels,pieces,overflow}=components(enhanced);if(overflow)return null;
  const recovery={image:enhanced,ambiguousBridge:false,recoveredBands:0};
  const sample=sampleField(contrast,width,height),raw=sampleField(rawValues,width,height),used=new Set();let attempts=0;
  for(const body of pieces){
    if(used.has(body.id))continue;const own=bounds(body,body,width);
    if(own.length<30||own.length<own.width*2.5)continue;
    for(const tip of pieces){
      if(tip.id===body.id||used.has(tip.id)||tip.area>body.area*.7)continue;
      const sign=(tip.x-body.x)*body.ax+(tip.y-body.y)*body.ay>=0?1:-1;
      const frame={id:body.id,x:body.x,y:body.y,ax:body.ax*sign,ay:body.ay*sign};
      const a=sign>0?own:{...own,lo:-own.hi,hi:-own.lo,left:-own.right,right:-own.left},b=bounds(tip,frame,width),gap=b.lo-a.hi;
      if(gap<1||gap>Math.min(6,a.width*.35)||b.length>a.length*.65||b.length>b.width*2||b.width<4)continue;
      const center=(b.left+b.right)/2;if(Math.abs(center-(a.left+a.right)/2)>a.width*.45)continue;
      if(++attempts>128)return recovery;
      const neck=neckWidth(labels,frame,a.hi,width,height,a.width);if(neck<5)continue;
      const radius=Math.ceil(Math.min(a.width*1.1,b.width*1.8)+5),minWidth=Math.max(5,neck*.5),maxWidth=neck*1.3+3;
      const rows=measuredBridge(sample,raw,frame,a.hi-1,b.lo+1,a.hi,b.lo,center,radius,minWidth,maxWidth);
      if(!rows||rows.length<2)continue;
      const support=sourceSections(delta,threshold,width,height,frame,rows,a.hi,b.lo);if(!support)continue;
      if(paint(enhanced,labels,frame,rows,new Set([body.id,tip.id]))){recovery.recoveredBands++;recovery.ambiguousBridge ||= rows.ambiguousBridge||support.ambiguous;used.add(body.id);used.add(tip.id);break;}
    }
  }
  return recovery;
}
/** Immutable source-sized preparation; null preserves the ordinary recognition path. */
export function darkMetalBackgroundImage(image){
  if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<16||image.height<16||image.width*image.height>2000000||image.data?.length!==image.width*image.height*4)return null;
  const model=plainBackgroundModel(image);if(!model||Math.max(...model.rgb)>90||Math.max(...model.rgb)-Math.min(...model.rgb)>16)return null;
  const{width,height,data}=image,size=width*height,low=new Uint8Array(size),mask=new Uint8Array(size),negative=new Uint8Array(size),delta=new Float32Array(size),contrast=new Float32Array(size),raw=new Float32Array(size);let count=0,bright=0;
  for(let p=0;p<size;p++){
    const bg=model.at(p%width,Math.floor(p/width)),alpha=data[p*4+3]/255;
    const r=data[p*4]*alpha+255*(1-alpha),g=data[p*4+1]*alpha+255*(1-alpha),b=data[p*4+2]*alpha+255*(1-alpha);
    const difference=lum(r-bg[0],g-bg[1],b-bg[2]),d=Math.max(Math.abs(r-bg[0]),Math.abs(g-bg[1]),Math.abs(b-bg[2]));
    const factor=(r*bg[0]+g*bg[1]+b*bg[2])/Math.max(1,bg[0]**2+bg[1]**2+bg[2]**2),chroma=Math.hypot(r-factor*bg[0],g-factor*bg[1],b-factor*bg[2])/Math.sqrt(3);
    delta[p]=d;contrast[p]=120-d;raw[p]=Math.max(r,g,b);low[p]=+(d>=model.threshold);
    mask[p]=+(low[p]&&(difference>=24||difference< -model.threshold||chroma>=8));negative[p]=+(mask[p]&&difference< -model.threshold);
    if(low[p]){count++;bright+=+(lum(r,g,b)>=155);}
  }
  if(count<Math.max(64,size*.0002)||count>size*.65||bright<count*.6)return null;
  removeSoftShadows(mask,negative,delta,width,height);
  const recovery=recoverBands(image,thresholdImage(mask,width,height),contrast,raw,delta,model.threshold);if(!recovery)return null;
  const prepared=recovery.image;
  for(let p=0;p<size;p++)mask[p]=+(prepared.data[p*4]<128);
  if(missingVisibleMaterial(low,mask,delta,width,height))return{requiresReview:true,name:'plain-background',wideFragments:true,ambiguousMaterial:true,image:thresholdImage(low,width,height)};
  return{requiresReview:true,name:'plain-background',wideFragments:false,ambiguousBridge:recovery.ambiguousBridge,recoveredBands:recovery.recoveredBands,image:prepared};
}
