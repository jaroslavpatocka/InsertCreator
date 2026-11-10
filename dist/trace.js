/** Local image-to-outline processing. No uploads, models, or network requests. */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function validateImage(image) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 2 || image.height < 2 || !image.data || image.data.length !== image.width * image.height * 4) {
    throw new Error('Obrázek nemá platná pixelová data.');
  }
  if (image.width * image.height > 16000000) throw new Error('Pro zpracování zmenšete fotografii na nejvýše 16 megapixelů.');
}

function luminance(image) {
  const gray = new Uint8Array(image.width * image.height);
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    const j = i * 4, a = image.data[j + 3] / 255;
    const g = Math.round((image.data[j] * .2126 + image.data[j + 1] * .7152 + image.data[j + 2] * .0722) * a + 255 * (1 - a));
    gray[i] = g; hist[g]++;
  }
  return { gray, hist };
}

function percentile(hist, proportion, count) {
  let sum = 0;
  for (let i = 0; i < 256; i++) if ((sum += hist[i]) >= Math.max(1, count * proportion)) return i;
  return 255;
}

function otsu(hist, total) {
  let weighted = 0;
  for (let i = 0; i < 256; i++) weighted += i * hist[i];
  let left = 0, leftSum = 0, best = -1, first = 127, last = 127;
  for (let t = 0; t < 255; t++) {
    left += hist[t]; leftSum += t * hist[t];
    const right = total - left;
    if (!left || !right) continue;
    const difference = leftSum / left - (weighted - leftSum) / right;
    const score = left * right * difference * difference;
    if (score > best + 1e-6) { best = score; first = last = t; }
    else if (Math.abs(score - best) <= 1e-6) last = t;
  }
  return Math.round((first + last) / 2);
}

function blur(gray, width, height) {
  const result = new Uint8Array(gray.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0, count = 0;
    for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) {
      for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) { sum += gray[yy * width + xx]; count++; }
    }
    result[y * width + x] = Math.round(sum / count);
  }
  return result;
}

function morphology(mask, width, height, dilate) {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let value = dilate ? 0 : 1;
    outer: for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      const on = xx >= 0 && yy >= 0 && xx < width && yy < height ? mask[yy * width + xx] : 0;
      if (dilate ? on : !on) { value = dilate ? 1 : 0; break outer; }
    }
    result[y * width + x] = value;
  }
  return result;
}

function labelComponents(mask, width, height, barriers = null) {
  const labels = new Int32Array(mask.length), queue = new Int32Array(mask.length), components = [];
  let id = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    id++;
    let head = 0, tail = 1, minX = width, minY = height, maxX = 0, maxY = 0;
    queue[0] = start; labels[start] = id;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (x > 0 && mask[p - 1] && !labels[p - 1] && !(barriers?.[p - 1] & 1)) { labels[p - 1] = id; queue[tail++] = p - 1; }
      if (x + 1 < width && mask[p + 1] && !labels[p + 1] && !(barriers?.[p] & 1)) { labels[p + 1] = id; queue[tail++] = p + 1; }
      if (y > 0 && mask[p - width] && !labels[p - width] && !(barriers?.[p - width] & 2)) { labels[p - width] = id; queue[tail++] = p - width; }
      if (y + 1 < height && mask[p + width] && !labels[p + width] && !(barriers?.[p] & 2)) { labels[p + width] = id; queue[tail++] = p + width; }
    }
    components.push({ id, start, area: tail, minX, minY, maxX, maxY });
  }
  return { labels, components };
}

export function polygonArea(points) {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) sum += points[j].x * points[i].y - points[i].x * points[j].y;
  return sum / 2;
}

function segmentDistanceSq(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1) : 0;
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}

function simplifyOpen(points, epsilon) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length), stack = [[0, points.length - 1]];
  keep[0] = keep[points.length - 1] = 1;
  while (stack.length) {
    const [a, b] = stack.pop(); let furthest = -1, distance = epsilon * epsilon;
    for (let i = a + 1; i < b; i++) { const d = segmentDistanceSq(points[i], points[a], points[b]); if (d > distance) { distance = d; furthest = i; } }
    if (furthest !== -1) { keep[furthest] = 1; stack.push([a, furthest], [furthest, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

export function simplifyContour(points, epsilon = 1.3) {
  if (points.length < 5 || epsilon <= 0) return points.map(p => ({ ...p }));
  let far = 1, distance = 0;
  for (let i = 1; i < points.length; i++) { const d = (points[i].x - points[0].x) ** 2 + (points[i].y - points[0].y) ** 2; if (d > distance) { distance = d; far = i; } }
  const originalArea = Math.abs(polygonArea(points));
  for (let attempt = 0; attempt < 5; attempt++) {
    const tolerance = epsilon / 2 ** attempt;
    const a = simplifyOpen(points.slice(0, far + 1), tolerance), b = simplifyOpen([...points.slice(far), points[0]], tolerance);
    const result = [...a.slice(0, -1), ...b.slice(0, -1)];
    if (result.length >= 3 && Math.abs(Math.abs(polygonArea(result)) - originalArea) <= Math.max(2, originalArea * .02)) return result;
  }
  return points;
}

function exteriorContour(labels, component, width, height) {
  const edges = new Map(), stride = width + 1, { id, minX, minY, maxX, maxY } = component;
  const add = (x1, y1, x2, y2, direction) => {
    const key = y1 * stride + x1;
    if (!edges.has(key)) edges.set(key, []);
    edges.get(key).push({ end: y2 * stride + x2, direction });
  };
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const p = y * width + x;
    if (labels[p] !== id) continue;
    if (!y || labels[p - width] !== id) add(x, y, x + 1, y, 0);
    if (x + 1 === width || labels[p + 1] !== id) add(x + 1, y, x + 1, y + 1, 1);
    if (y + 1 === height || labels[p + width] !== id) add(x + 1, y + 1, x, y + 1, 2);
    if (!x || labels[p - 1] !== id) add(x, y + 1, x, y, 3);
  }
  let largest = [], largestArea = 0;
  while (edges.size) {
    const start = edges.keys().next().value, points = [];
    let key = start, previous = 0, guard = 0;
    do {
      const choices = edges.get(key);
      if (!choices?.length) break;
      points.push({ x: key % stride, y: Math.floor(key / stride) });
      // Prefer a right turn at a shared vertex, keeping foreground on the right.
      let index = 0, rank = -1;
      for (let i = 0; i < choices.length; i++) {
        const turn = (choices[i].direction - previous + 4) % 4;
        const score = turn === 1 ? 4 : turn === 0 ? 3 : turn === 3 ? 2 : 1;
        if (score > rank) { rank = score; index = i; }
      }
      const edge = choices.splice(index, 1)[0];
      if (!choices.length) edges.delete(key);
      key = edge.end; previous = edge.direction;
    } while (key !== start && ++guard <= (maxX - minX + 1) * (maxY - minY + 1) * 4 + 4);
    const area = Math.abs(polygonArea(points));
    if (key === start && area > largestArea) { largest = points; largestArea = area; }
  }
  return largest;
}

/**
 * Returns absolute image-pixel outlines. threshold is in normalized 0–255 space.
 * minArea below 1 means fraction of image area; otherwise it is pixels squared.
 * Tools touching the image edge are omitted; internal holes are deliberately filled.
 */
export function traceImage(imageData, { threshold = null, invert = false, minArea = .001, smoothing = 1.3 } = {}) {
  validateImage(imageData);
  const { width, height } = imageData, { gray, hist } = luminance(imageData), count = gray.length;
  let low = percentile(hist, .001, count), high = percentile(hist, .999, count);
  // A thin tool can occupy less than the clipping percentile. Retain real contrast
  // in that case; component area filtering still removes isolated sensor pixels.
  if (high - low < 4) { low = percentile(hist, 0, count); high = percentile(hist, 1, count); }
  const normalized = new Uint8Array(count);
  const span = Math.max(1, high - low);
  for (let i = 0; i < count; i++) normalized[i] = clamp(Math.round((gray[i] - low) * 255 / span), 0, 255);
  const filtered = blur(normalized, width, height), contrastHist = new Uint32Array(256);
  for (const value of filtered) contrastHist[value]++;
  const selected = threshold === null || !Number.isFinite(Number(threshold)) ? otsu(contrastHist, count) : clamp(Math.round(Number(threshold)), 0, 255);
  let mask = new Uint8Array(count);
  if (high - low < 4 && threshold === null) return { contours: [], threshold: selected, mask, width, height };
  for (let i = 0; i < count; i++) mask[i] = invert ? +(filtered[i] >= selected) : +(filtered[i] <= selected);
  mask = morphology(morphology(mask, width, height, true), width, height, false);
  return { ...traceMask(mask, width, height, { minArea, smoothing }), threshold: selected };
}

/** Trace measured binary pixel edges without blurring away gaps or closing thin shafts. */
export function traceMask(mask, width, height, { minArea = .001, smoothing = 1.3, barriers = null, includeLabels = false, minComponentPixels = 12, keepBorder = false } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width * height > 16000000 || mask?.length !== width * height) throw new Error('Maska nemá platná pixelová data.');
  if (barriers && barriers.length !== mask.length) throw new Error('Mapa hran má jiný rozměr než maska.');
  const count = width * height;
  const { labels, components } = labelComponents(mask, width, height, barriers);
  const minimum = Math.max(Math.max(1,Number(minComponentPixels)||12), minArea < 1 ? count * Math.max(0, minArea) : minArea), contours = [], clean = new Uint8Array(count), accepted = new Set();
  for (const c of components) {
    if (c.area < minimum || (!keepBorder&&(c.minX <= 1 || c.minY <= 1 || c.maxX >= width - 2 || c.maxY >= height - 2))) continue;
    const points = simplifyContour(exteriorContour(labels, c, width, height), Math.max(0, Number(smoothing) || 0));
    if (points.length < 3) continue;
    accepted.add(c.id);
    contours.push({ points, area: Math.abs(polygonArea(points)), width: c.maxX - c.minX + 1, height: c.maxY - c.minY + 1, ...(includeLabels ? { componentId: c.id, seed: c.start } : {}) });
  }
  for (let i = 0; i < count; i++) if (accepted.has(labels[i])) clean[i] = 1;
  contours.sort((a, b) => b.area - a.area);
  return { contours, mask: clean, width, height, ...(includeLabels ? { labels } : {}) };
}

/** Detect a complete sheet from four supported outer edges; uncertain photos return null. */
export function detectPaper(imageData){
  validateImage(imageData);
  const image=imageData;
  const scale=Math.min(1,600/Math.max(image.width,image.height)),w=Math.max(2,Math.round(image.width*scale)),h=Math.max(2,Math.round(image.height*scale)),size=w*h;
  const channels=Array.from({length:3},()=>new Float32Array(size));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const sx=Math.min(image.width-1,Math.round(x/scale)),sy=Math.min(image.height-1,Math.round(y/scale)),p=(sy*image.width+sx)*4,alpha=image.data[p+3]/255;
    for(let k=0;k<3;k++)channels[k][y*w+x]=image.data[p+k]*alpha+255*(1-alpha);
  }
  const magnitude=new Float32Array(size),directions=new Float32Array(size),points=[];
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const p=y*w+x;let best=0,gx=0,gy=0;
    for(const channel of channels){const dx=(channel[p+1]-channel[p-1])/2,dy=(channel[p+w]-channel[p-w])/2,squared=dx*dx+dy*dy;if(squared>best){best=squared;gx=dx;gy=dy;}}
    magnitude[p]=Math.sqrt(best);directions[p]=Math.atan2(gy,gx);
  }
  for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){
    const p=y*w+x,mag=magnitude[p];if(mag<5)continue;
    const angle=directions[p],dx=Math.round(Math.cos(angle)),dy=Math.round(Math.sin(angle));
    if(mag<magnitude[(y+dy)*w+x+dx]||mag<magnitude[(y-dy)*w+x-dx])continue;
    points.push({x,y,angle:((angle*180/Math.PI)%180+180)%180,weight:Math.min(3,mag/8)});
  }
  const radius=Math.ceil(Math.hypot(w,h)),stride=radius*2+1,votes=new Float32Array(180*stride),cos=[],sin=[];
  for(let a=0;a<180;a++){cos.push(Math.cos(a*Math.PI/180));sin.push(Math.sin(a*Math.PI/180));}
  for(const p of points){const middle=Math.round(p.angle);for(let d=-10;d<=10;d++){const a=(middle+d+180)%180,r=Math.round(p.x*cos[a]+p.y*sin[a])+radius;votes[a*stride+r]+=p.weight;}}
  const peaks=[],minimum=Math.min(w,h)*.16;
  for(let a=0;a<180;a++)for(let r=1;r<stride-1;r++){
    const score=votes[a*stride+r];if(score>=minimum&&score>=votes[a*stride+r-1]&&score>=votes[a*stride+r+1])peaks.push({a,rho:r-radius,score,nx:cos[a],ny:sin[a]});
  }
  peaks.sort((a,b)=>b.score-a.score);
  const lines=[];
  for(const peak of peaks){
    if(lines.some(line=>Math.abs(line.nx*peak.nx+line.ny*peak.ny)>Math.cos(3*Math.PI/180)&&Math.abs(line.rho-(line.nx*peak.nx+line.ny*peak.ny<0?-peak.rho:peak.rho))<4))continue;
    const near=points.filter(p=>Math.abs(p.x*peak.nx+p.y*peak.ny-peak.rho)<2&&Math.abs(Math.cos(p.angle*Math.PI/180)*peak.nx+Math.sin(p.angle*Math.PI/180)*peak.ny)>Math.cos(20*Math.PI/180));
    if(near.length<minimum/3)continue;
    let total=0,mx=0,my=0;for(const p of near){total+=p.weight;mx+=p.x*p.weight;my+=p.y*p.weight;}mx/=total;my/=total;
    let xx=0,yy=0,xy=0;for(const p of near){const x=p.x-mx,y=p.y-my;xx+=p.weight*x*x;yy+=p.weight*y*y;xy+=p.weight*x*y;}
    const angle=.5*Math.atan2(2*xy,xx-yy);let nx=-Math.sin(angle),ny=Math.cos(angle);if(nx*peak.nx+ny*peak.ny<0){nx=-nx;ny=-ny;}
    const rho=nx*mx+ny*my,error=near.reduce((sum,p)=>sum+p.weight*(p.x*nx+p.y*ny-rho)**2,0)/total;
    if(error>1.8)continue;
    // Several Hough bins can refit to the same physical edge. Keep its
    // strongest line so a larger, slightly tilted duplicate cannot win on area.
    if(lines.some(line=>{const dot=line.nx*nx+line.ny*ny,sign=dot<0?-1:1;return Math.abs(dot)>Math.cos(3*Math.PI/180)&&Math.abs(line.rho-line.nx*w/2-line.ny*h/2-sign*(rho-nx*w/2-ny*h/2))<3;}))continue;
    lines.push({nx,ny,rho,score:peak.score,error});if(lines.length>=28)break;
  }
  const sample=(x,y)=>{
    if(x<0||y<0||x>w-1||y>h-1)return null;
    const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(x0+1,w-1),y1=Math.min(y0+1,h-1),fx=x-x0,fy=y-y0;
    return channels.map(values=>values[y0*w+x0]*(1-fx)*(1-fy)+values[y0*w+x1]*fx*(1-fy)+values[y1*w+x0]*(1-fx)*fy+values[y1*w+x1]*fx*fy);
  };
  const difference=(a,b)=>!a||!b?0:Math.sqrt(a.reduce((sum,v,i)=>sum+(v-b[i])**2,0)/3);
  const supported=(x,y,nx,ny)=>{
    for(const offset of [-1.5,0,1.5]){
      const px=x+nx*offset,py=y+ny*offset;
      const wide=difference(sample(px+nx*3,py+ny*3),sample(px-nx*3,py-ny*3));
      const sharp=difference(sample(px+nx,py+ny),sample(px-nx,py-ny));
      if(wide>=8&&sharp>=Math.max(4,wide*.4))return true;
    }
    return false;
  };
  const edgeEvidence=(a,b)=>{
    const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),tx=dx/length,ty=dy/length,nx=-ty,ny=tx,count=Math.max(12,Math.ceil(length/3));
    let countSupported=0,gap=0,maxGap=0;
    for(let i=1;i<count;i++){
      const t=i/count,yes=supported(a.x+dx*t,a.y+dy*t,nx,ny);
      countSupported+=+yes;if(yes)gap=0;else{gap++;maxGap=Math.max(maxGap,gap);}
    }
    const coverage=countSupported/(count-1);if(coverage<.72||maxGap/(count-1)>.2)return null;
    // A fold or an interior rectangle cannot truncate a still-visible sheet edge.
    const reach=Math.min(40,length*.18),continuation=(p,sign)=>{
      let outside=0,seen=0;for(let d=6;d<=reach;d+=3){const x=p.x+sign*tx*d,y=p.y+sign*ty*d;if(!sample(x+nx*3,y+ny*3)||!sample(x-nx*3,y-ny*3))continue;seen++;outside+=+supported(x,y,nx,ny);}
      return seen>=4&&outside/seen>.65;
    };
    if(continuation(a,-1)||continuation(b,1))return null;
    return coverage;
  };
  const intersect=(a,b)=>{const det=a.nx*b.ny-a.ny*b.nx;if(Math.abs(det)<.2)return null;return{x:(a.rho*b.ny-a.ny*b.rho)/det,y:(a.nx*b.rho-a.rho*b.nx)/det};};
  const center={x:w/2,y:h/2},pairs=[];
  for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
    const a=lines[i],b=lines[j],dot=a.nx*b.nx+a.ny*b.ny,sign=dot<0?-1:1;
    const separation=Math.abs(a.rho-a.nx*center.x-a.ny*center.y-sign*(b.rho-b.nx*center.x-b.ny*center.y));
    if(Math.abs(dot)>Math.cos(30*Math.PI/180)&&separation>Math.min(w,h)*.16)pairs.push({i,j});
  }
  let best=null;
  for(let p=0;p<pairs.length;p++)for(let q=p+1;q<pairs.length;q++){
    const a=pairs[p],b=pairs[q];if(new Set([a.i,a.j,b.i,b.j]).size!==4)continue;
    if(Math.abs(lines[a.i].nx*lines[b.i].nx+lines[a.i].ny*lines[b.i].ny)>Math.cos(40*Math.PI/180))continue;
    let corners=[intersect(lines[a.i],lines[b.i]),intersect(lines[a.j],lines[b.i]),intersect(lines[a.j],lines[b.j]),intersect(lines[a.i],lines[b.j])];
    if(corners.some(point=>!point||point.x<2||point.y<2||point.x>w-3||point.y>h-3))continue;
    const surface=Math.abs(polygonArea(corners));if(surface<size*.08||surface>size*.96||best&&surface<best.score)continue;
    const middle=corners.reduce((c,p)=>({x:c.x+p.x/4,y:c.y+p.y/4}),{x:0,y:0});corners.sort((p,q)=>Math.atan2(p.y-middle.y,p.x-middle.x)-Math.atan2(q.y-middle.y,q.x-middle.x));
    // A white sheet must contain a substantial bright surface, not only bright borders.
    const interior=[];for(let y=1;y<6;y++)for(let x=1;x<6;x++){
      const u=x/6,v=y/6,p={x:corners[0].x*(1-u)*(1-v)+corners[1].x*u*(1-v)+corners[2].x*u*v+corners[3].x*(1-u)*v,y:corners[0].y*(1-u)*(1-v)+corners[1].y*u*(1-v)+corners[2].y*u*v+corners[3].y*(1-u)*v},rgb=sample(p.x,p.y);interior.push(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722);
    }
    interior.sort((a,b)=>a-b);if(interior[Math.floor(interior.length*.7)]<145)continue;
    const edges=corners.map((corner,i)=>edgeEvidence(corner,corners[(i+1)%4]));if(edges.some(value=>value===null))continue;
    const score=surface*Math.min(...edges);if(!best||score>best.score)best={score,corners};
  }
  if(!best)return null;
  // Keep bilinear rectification inside the sheet. A fractional outside pixel
  // would otherwise blend the tabletop into an entire rectified border.
  const boundary=best.corners.map((point,i)=>{const next=best.corners[(i+1)%4],dx=next.x-point.x,dy=next.y-point.y,length=Math.hypot(dx,dy),nx=-dy/length,ny=dx/length;return{nx,ny,rho:nx*point.x+ny*point.y+.75};});
  const corners=boundary.map((line,i)=>intersect(boundary[(i+3)%4],line));
  if(corners.some(point=>!point||!Number.isFinite(point.x+point.y)))return null;
  let first=0;for(let i=1;i<4;i++)if(corners[i].x+corners[i].y<corners[first].x+corners[first].y)first=i;
  const result=[...corners.slice(first),...corners.slice(0,first)].map(point=>({x:Math.max(0,Math.min(image.width-1,Math.round(point.x/scale))),y:Math.max(0,Math.min(image.height-1,Math.round(point.y/scale)))}));
  try{quadTransform(result);}catch{return null;}
  return result;
}


function quadTransform(corners) {
  if (!Array.isArray(corners) || corners.length !== 4 || corners.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Označte čtyři rohy papíru v pořadí levý horní, pravý horní, pravý dolní, levý dolní.');
  const [p0, p1, p2, p3] = corners;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4], c = corners[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < .01 || (sign && sign !== Math.sign(cross))) throw new Error('Rohy papíru se nesmí křížit ani ležet na jedné přímce.');
    sign = Math.sign(cross);
  }
  if (Math.abs(polygonArea(corners)) < 4) throw new Error('Označená plocha papíru je příliš malá.');
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  if (Math.abs(dx3) + Math.abs(dy3) > 1e-9) {
    const denominator = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(denominator) < 1e-9) throw new Error('Z této perspektivy nelze papír bezpečně narovnat.');
    g = (dx3 * dy2 - dx2 * dy3) / denominator;
    h = (dx1 * dy3 - dx3 * dy1) / denominator;
  }
  return { a: p1.x - p0.x + g * p1.x, b: p3.x - p0.x + h * p3.x, c: p0.x, d: p1.y - p0.y + g * p1.y, e: p3.y - p0.y + h * p3.y, f: p0.y, g, h };
}

/** Perspective-correct A4/reference rectangle using bilinear source sampling. */
export function rectifyImage(imageData, corners, widthMm = 210, heightMm = 297, maxSize = 1100) {
  validateImage(imageData);
  if (!(widthMm > 0) || !(heightMm > 0) || !Number.isFinite(widthMm + heightMm) || !(maxSize >= 16 && maxSize <= 4096)) throw new Error('Zadejte platné rozměry měřítka.');
  const transform = quadTransform(corners), pxPerMm = maxSize / Math.max(widthMm, heightMm);
  const width = Math.max(2, Math.round(widthMm * pxPerMm)), height = Math.max(2, Math.round(heightMm * pxPerMm));
  const data = new Uint8ClampedArray(width * height * 4), source = imageData.data, sw = imageData.width, sh = imageData.height;
  let transparent=false;for(let p=3;p<source.length;p+=4)if(source[p]<250){transparent=true;break;}
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / (width - 1), v = y / (height - 1), den = transform.g * u + transform.h * v + 1;
    const sx = (transform.a * u + transform.b * v + transform.c) / den, sy = (transform.d * u + transform.e * v + transform.f) / den, out = (y * width + x) * 4;
    if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) { data[out] = data[out + 1] = data[out + 2] = 255; data[out + 3] = transparent?0:255; continue; }
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1), fx = sx - x0, fy = sy - y0;
    for (let k = 0; k < 4; k++) data[out + k] = source[(y0 * sw + x0) * 4 + k] * (1 - fx) * (1 - fy) + source[(y0 * sw + x1) * 4 + k] * fx * (1 - fy) + source[(y1 * sw + x0) * 4 + k] * (1 - fx) * fy + source[(y1 * sw + x1) * 4 + k] * fx * fy;
  }
  const result = typeof ImageData === 'function' ? new ImageData(data, width, height) : { data, width, height };
  // Pixel-edge coordinates span width/height; this scale matches returned contours.
  return { imageData: result, pxPerMm, widthMm, heightMm };
}

/** Pixels per millimetre for two ruler marks; perspective must already be near-normal. */
export function calibrateSegment(a, b, distanceMm) {
  if(!a||!b||![a.x,a.y,b.x,b.y,distanceMm].every(Number.isFinite)||distanceMm<1||distanceMm>5000)throw new Error('Označte dvě různé značky pravítka a zadejte jejich skutečnou vzdálenost.');
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  if (distance < 12) throw new Error('Značky pravítka jsou příliš blízko. Použijte delší úsek alespoň 12 pixelů.');
  return distance / distanceMm;
}
