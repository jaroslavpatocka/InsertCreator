/** Two perpendicular references define an affine metric plane, not a perspective homography. */
const invalid = () => new Error('Označte čtyři body dvou pravítek a zadejte obě skutečné vzdálenosti od 1 do 5000 mm.');
const apply = (matrix, point) => ({x:matrix.a*point.x+matrix.c*point.y+matrix.e,y:matrix.b*point.x+matrix.d*point.y+matrix.f});

/** Pixel-to-pixel transform with one uniform output pxPerMm and no image reflection. */
export function calibrateRulers(imageSize, points, distancesMm, maxSize = 1400) {
  const {width:sw,height:sh}=imageSize||{};
  if(!Number.isInteger(sw)||!Number.isInteger(sh)||sw<2||sh<2||sw*sh>16000000||!Number.isInteger(maxSize)||maxSize<32||maxSize>2048)throw invalid();
  if(!Array.isArray(points)||points.length!==4||points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>sw-1||p.y>sh-1)||!Array.isArray(distancesMm)||distancesMm.length!==2||distancesMm.some(d=>!Number.isFinite(d)||d<1||d>5000))throw invalid();
  const u={x:points[1].x-points[0].x,y:points[1].y-points[0].y},v={x:points[3].x-points[2].x,y:points[3].y-points[2].y};
  const lu=Math.hypot(u.x,u.y),lv=Math.hypot(v.x,v.y),cross=u.x*v.y-u.y*v.x;
  if(lu<12||lv<12)throw new Error('Značky pravítka jsou příliš blízko. Použijte delší úsek alespoň 12 pixelů.');
  if(Math.abs(cross)/(lu*lv)<.25)throw new Error('Směry pravítek jsou téměř rovnoběžné. Na podkladu musí být navzájem kolmé.');
  u.x/=distancesMm[0];u.y/=distancesMm[0];
  // Reversing either ruler must never mirror the photographed tools.
  const orientation=Math.sign(cross);v.x*=orientation/distancesMm[1];v.y*=orientation/distancesMm[1];
  const determinant=u.x*v.y-u.y*v.x,trace=u.x*u.x+u.y*u.y+v.x*v.x+v.y*v.y;
  const largest=(trace+Math.sqrt(Math.max(0,trace*trace-4*determinant*determinant)))/2,condition=largest/determinant;
  if(!Number.isFinite(condition)||condition>8)throw new Error('Rozměry pravítek nebo úhel fotografie vyžadují příliš velké zkreslení. Zkontrolujte vzdálenosti a vyfoťte podklad více shora.');
  const metric={a:v.y/determinant,b:-u.y/determinant,c:-v.x/determinant,d:u.x/determinant,e:0,f:0};
  const corners=[{x:0,y:0},{x:sw-1,y:0},{x:sw-1,y:sh-1},{x:0,y:sh-1}].map(p=>apply(metric,p));
  const minX=Math.min(...corners.map(p=>p.x)),minY=Math.min(...corners.map(p=>p.y));
  const widthMm=Math.max(...corners.map(p=>p.x))-minX,heightMm=Math.max(...corners.map(p=>p.y))-minY;
  const pxPerMm=Math.min(Math.sqrt(determinant),(maxSize-1)/Math.max(widthMm,heightMm));
  const width=Math.min(maxSize,Math.max(2,Math.ceil(widthMm*pxPerMm)+1)),height=Math.min(maxSize,Math.max(2,Math.ceil(heightMm*pxPerMm)+1));
  if(Math.min(width,height)<16)throw new Error('Po kalibraci by fotografie byla příliš úzká. Zkontrolujte obě pravítka a jejich rozměry.');
  const transform={a:metric.a*pxPerMm,b:metric.b*pxPerMm,c:metric.c*pxPerMm,d:metric.d*pxPerMm,e:-minX*pxPerMm,f:-minY*pxPerMm};
  const det=transform.a*transform.d-transform.b*transform.c;
  const inverse={a:transform.d/det,b:-transform.b/det,c:-transform.c/det,d:transform.a/det,e:0,f:0};
  inverse.e=-(inverse.a*transform.e+inverse.c*transform.f);inverse.f=-(inverse.b*transform.e+inverse.d*transform.f);
  return {width,height,widthMm,heightMm,pxPerMm,transform,inverse,points:points.map(p=>apply(transform,p))};
}

/** Bilinear rewarp before recognition; both references genuinely change the resulting geometry. */
export function rectifyRulers(image, points, distancesMm, maxSize = 1400) {
  if(!image?.data||image.data.length!==image.width*image.height*4)throw new Error('Obrázek nemá platná pixelová data.');
  const result=calibrateRulers(image,points,distancesMm,maxSize),{width,height,inverse}=result;
  const data=new Uint8ClampedArray(width*height*4),sw=image.width,sh=image.height,source=image.data;
  let transparent=false;for(let p=3;p<source.length;p+=4)if(source[p]<250){transparent=true;break;}
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=inverse.a*x+inverse.c*y+inverse.e,sy=inverse.b*x+inverse.d*y+inverse.f,out=(y*width+x)*4;
    if(sx<-.000001||sy<-.000001||sx>sw-1+.000001||sy>sh-1+.000001){data.fill(255,out,out+4);if(transparent)data[out+3]=0;continue;}
    const cx=Math.max(0,Math.min(sw-1,sx)),cy=Math.max(0,Math.min(sh-1,sy)),x0=Math.floor(cx),y0=Math.floor(cy),x1=Math.min(x0+1,sw-1),y1=Math.min(y0+1,sh-1),fx=cx-x0,fy=cy-y0;
    for(let k=0;k<4;k++)data[out+k]=source[(y0*sw+x0)*4+k]*(1-fx)*(1-fy)+source[(y0*sw+x1)*4+k]*fx*(1-fy)+source[(y1*sw+x0)*4+k]*(1-fx)*fy+source[(y1*sw+x1)*4+k]*fx*fy;
  }
  return {...result,imageData:typeof ImageData==='function'?new ImageData(data,width,height):{data,width,height}};
}
