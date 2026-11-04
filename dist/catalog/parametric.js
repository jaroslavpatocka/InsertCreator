// Parametric catalogue outlines (Agent 2): top-view silhouettes generated at load time from nominal dimensions.
// Licence: CC0-1.0 (the repository declares no licence; these generated shapes are dedicated to the public domain).
// Every outline is the OUTER silhouette (no inner holes); millimetres; x = tool length axis.
// Pocket depth convention: flat tools = max thickness + ~2 mm; round tools lying on their side
// (sockets, screwdrivers, extensions, punches, pencils) = 0.6 × diameter + 2 mm so the tool stays grippable.
//
// DIMENSION TABLES USED (nominal values; "≈" = approximation of the norm's max/limit dimension):
// * DIN 3113 form A / ISO 7738 combination wrench, overall length l (mm), max values per size s:
//   6:105 7:110 8:120 9:130 10:140 11:150 12:160 13:170 14:180 15:190 16:200 17:210 18:220 19:230
//   20:245 21:255 22:270 23:280 24:290 27:320 30:350 32:370.
//   Sizes 25:300 26:310 28:330 29:340 (needed by 6–32 mm sets) = lengths interpolated between those → 'typical'.
//   Head widths from ISO 3318 limit formulae (≈): open end b1 ≈ 2.1·s + 7, ring end d ≈ 1.45·s + 4;
//   thickness open ≈ 0.33·s + 3, ring ≈ 0.38·s + 4.5; open jaw angled 15° to the shank axis.
// * DIN 3110 / ISO 10102 double open-end wrench overall length (mm, ≈ max): 6×7:120 8×9:135 8×10:140
//   10×11:150 10×13:160 12×13:170 13×15:180 13×17:185 14×15:185 16×17:200 17×19:210 18×19:215
//   19×22:230 21×23:250 22×24:255 24×27:280 27×30:300 30×32:320; heads as above, 15° jaws.
//   Pairs 20×22:235 24×26:270 25×28:285 27×32:310 (common in sets) = interpolated lengths → 'typical'.
// * SAE combination wrenches (ASME B107.100 sets only minima) – typical overall lengths (in):
//   1/4:4.2 5/16:4.7 3/8:5.3 7/16:6.0 1/2:6.6 9/16:7.3 5/8:8.0 11/16:8.6 3/4:9.3 13/16:10 7/8:10.6
//   15/16:11.3 1:12; heads from the ISO 3318 formulae with s converted to mm  → accuracy 'typical'.
// * ISO 2936 hex key (L), long leg l1 / short leg l2 (mm): 1.5:46.5/15.5 2:52/18 2.5:58.5/20.5 3:66/23
//   4:74/29 5:85/33 6:96/38 8:108/44 10:122/50 12:137/57; bar width = across corners s/cos30°.
//   SAE keys (0.050"–3/8") and Torx keys: legs interpolated from that table  → 'typical'.
//   Torx tip size (ISO 10664, across points, mm): T8 2.31 T9 2.50 T10 2.74 T15 3.27 T20 3.86 T25 4.43 T27 4.99
//   T30 5.52 T40 6.65 T45 7.82 T50 8.83.
// * DIN 3124 / ISO 2725-1 sockets (short series), lying on side: length 1/4" 25 mm; 3/8" 28 mm (≤19),
//   31 mm (>19); 1/2" 38 mm (8–24), 42 mm (>24). Outer diameter (≈ ISO 3318 max) socket end 1.3·s + 2.2,
//   drive end 1/4" 12.5, 3/8" 17, 1/2" 22 mm. SAE 3/8" sockets same formulae → 'typical'.
// * ISO 1173 bits: hex 6.35 mm across flats (7.33 across corners), C6.3 length 25 mm, E6.3 length 50 mm.
// * ISO 2380-2 slotted blade widths/lengths (2.5×75, 3×100 (+ 3×80 common in sets → typical), 4×100, 5.5×125, 6.5×150, 8×175),
//   ISO 8764-2 cross-recess blade lengths (PH0×60, PH1×80, PH2×100, PH3×150; PZ same); handles typical.
// * Everything else (ratchets, extensions, pliers, measuring, cutting, striking) = representative
//   shapes from common catalogue dimensions → accuracy 'typical'. Extra sizes (1/2" joint, T-bar, 1/4" bit adapter,
//   chisels 18/26 mm, pin punch 7 mm) exist because common commercial tool sets contain them.
import Clipper from '../vendor/clipper.js';

const SRC={name:'InsertCreator parametric (DIN/ISO dimensions)',license:'CC0-1.0',url:''};
const S=100,PI=Math.PI,D2R=PI/180;
const P=(x,y)=>({x,y});
const nseg=r=>Math.max(12,Math.min(48,Math.ceil(2*PI*r/2)));
const circle=(cx,cy,r,n=nseg(r))=>Array.from({length:n},(_,i)=>P(cx+r*Math.cos(2*PI*i/n),cy+r*Math.sin(2*PI*i/n)));
const rect=(x0,y0,x1,y1)=>[P(x0,y0),P(x1,y0),P(x1,y1),P(x0,y1)];
const box=(x0,x1,w,c=0)=>{const h=w/2;c=Math.min(c,h/2,(x1-x0)/3);return c?[P(x0+c,-h),P(x1-c,-h),P(x1,-h+c),P(x1,h-c),P(x1-c,h),P(x0+c,h),P(x0,h-c),P(x0,-h+c)]:rect(x0,-h,x1,h);};
function hull(pts){
  const a=[...pts].sort((p,q)=>p.x-q.x||p.y-q.y),cr=(o,p,q)=>(p.x-o.x)*(q.y-o.y)-(p.y-o.y)*(q.x-o.x),lo=[],up=[];
  for(const p of a){while(lo.length>1&&cr(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p);}
  for(const p of a.reverse()){while(up.length>1&&cr(up[up.length-2],up[up.length-1],p)<=0)up.pop();up.push(p);}
  return lo.slice(0,-1).concat(up.slice(0,-1));
}
const cap=(x0,y0,r0,x1,y1,r1)=>hull([...circle(x0,y0,r0),...circle(x1,y1,r1)]);
const rrect=(x0,y0,x1,y1,r)=>{r=Math.min(r,(x1-x0)/2,(y1-y0)/2);return hull([...circle(x0+r,y0+r,r),...circle(x1-r,y0+r,r),...circle(x1-r,y1-r,r),...circle(x0+r,y1-r,r)]);};
const rot=(pts,deg,cx=0,cy=0)=>{const c=Math.cos(deg*D2R),s=Math.sin(deg*D2R);return pts.map(p=>P(cx+(p.x-cx)*c-(p.y-cy)*s,cy+(p.x-cx)*s+(p.y-cy)*c));};
const mov=(pts,dx,dy)=>pts.map(p=>P(p.x+dx,p.y+dy));
const mirY=pts=>pts.map(p=>P(p.x,-p.y)).reverse();
const toI=pts=>{const q=pts.map(p=>({X:Math.round(p.x*S),Y:Math.round(p.y*S)}));if(!Clipper.Clipper.Orientation(q))q.reverse();return q;};
function clip(subj,clipPaths,type){
  const c=new Clipper.Clipper(),out=[];c.StrictlySimple=true;
  c.AddPaths(subj,Clipper.PolyType.ptSubject,true);if(clipPaths.length)c.AddPaths(clipPaths,Clipper.PolyType.ptClip,true);
  c.Execute(type,out,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero);return out;
}
/** Union of `add` minus `sub` → single outer outline (largest area), ≤400 points, origin at bbox min. */
function shape(add,sub=[]){
  let res=clip(add.map(toI),[],Clipper.ClipType.ctUnion);
  if(sub.length)res=clip(res,sub.map(toI),Clipper.ClipType.ctDifference);
  const best=res.reduce((a,b)=>Math.abs(Clipper.Clipper.Area(b))>Math.abs(Clipper.Clipper.Area(a))?b:a);
  let tol=.03*S,path=Clipper.Clipper.CleanPolygon(best,tol);
  while(path.length>400){tol*=1.5;path=Clipper.Clipper.CleanPolygon(best,tol);}
  if(!Clipper.Clipper.Orientation(path))path.reverse();
  const mx=Math.min(...path.map(p=>p.X)),my=Math.min(...path.map(p=>p.Y));
  return path.map(p=>P((p.X-mx)/S,(p.Y-my)/S));
}

const items=[];
const cz=v=>String(v).replace('.',',');
const slug=v=>String(v).replace(/[^a-z0-9]+/gi,'-').toLowerCase();
const rd=v=>Math.round(v*2)/2;
function add(id,category,cs,en,points,depth,unit,size,tags,accuracy,note){
  items.push({id,category,name:{cs,en},points,depth:rd(depth),unit,...(size!=null?{size}:{}),tags,accuracy,source:{...SRC,note}});
}
const roundDepth=d=>.6*d+2;
// inch fractions: [label, idPart, inches]
const FR=f=>{const [n,d]=f.split('/').map(Number);return{label:f+'"',id:d?`${n}-${d}in`:`${n}in`,v:d?n/d:n};};

/* ---------- wrenches ---------- */
function openHead(cx,s,b,angle){
  // head body + hex-root jaw opening (subtracted). Returns {body,notch}
  const dir=angle*D2R,ux=Math.cos(dir),uy=Math.sin(dir);
  const body=[circle(cx,0,b/2),circle(cx+ux*.3*s,uy*.3*s,b*.43)];
  const k=s/Math.sqrt(3),h=s/2;
  const local=[P(-k,0),P(-k/2,-h),P(2*b,-h),P(2*b,h),P(-k/2,h)];
  return{body,notch:mov(rot(local,angle),cx,0)};
}
const thick=s=>({open:.33*s+3,ring:.38*s+4.5});
function comboWrench(s,L){
  const D=1.45*s+4,b=2.1*s+7,xr=D/2,xo=L-b/2,w1=.55*s+4,w2=.5*s+4;
  const head=openHead(xo,s,b,15);
  return shape([circle(xr,0,D/2),[P(xr,-w1/2),P(xo,-w2/2),P(xo,w2/2),P(xr,w1/2)],...head.body],[head.notch]);
}
function doubleOpen(s1,s2,L){
  const b1=2.1*s1+7,b2=2.1*s2+7,x1=b1/2,x2=L-b2/2,w1=.5*s1+4,w2=.5*s2+4;
  const h1=openHead(x1,s1,b1,180+15),h2=openHead(x2,s2,b2,15);
  return shape([[P(x1,-w1/2),P(x2,-w2/2),P(x2,w2/2),P(x1,w1/2)],...h1.body,...h2.body],[h1.notch,h2.notch]);
}
const DIN3113={6:105,7:110,8:120,9:130,10:140,11:150,12:160,13:170,14:180,15:190,16:200,17:210,18:220,19:230,20:245,21:255,22:270,23:280,24:290,27:320,30:350,32:370};
const DIN3113X={25:300,26:310,28:330,29:340};
for(const [k,L] of Object.entries({...DIN3113,...DIN3113X})){
  const s=+k,std=k in DIN3113;
  add(`combination-wrench-${s}mm`,'wrenches',`Očkoplochý klíč ${s} mm`,`Combination wrench ${s} mm`,comboWrench(s,L),thick(s).ring+2,'mm',s,
    [`${s} mm`,'DIN 3113','ISO 7738','očkoplochý','combination','ring','open end'],std?'standard':'typical',std?`DIN 3113 A overall length ${L} mm; head widths ≈ ISO 3318 limits.`:`Length ${L} mm interpolated between DIN 3113 sizes; heads ≈ ISO 3318 formulae.`);
}
const SAE_COMBO=[['1/4',4.2],['5/16',4.7],['3/8',5.3],['7/16',6.0],['1/2',6.6],['9/16',7.3],['5/8',8.0],['11/16',8.6],['3/4',9.3],['13/16',10],['7/8',10.6],['15/16',11.3],['1',12]];
for(const [f,Lin] of SAE_COMBO){
  const q=FR(f),s=q.v*25.4;
  add(`combination-wrench-${q.id}`,'wrenches',`Očkoplochý klíč ${q.label}`,`Combination wrench ${q.label}`,comboWrench(s,Lin*25.4),thick(s).ring+2,'in',q.v,
    [q.label,'SAE','ASME B107.100','imperial','palcový','combination'],'typical',`Typical SAE length ${Lin} in; heads ≈ ISO 3318 formulae.`);
}
const DIN3110=[[6,7,120],[8,9,135],[8,10,140],[10,11,150],[10,13,160],[12,13,170],[13,15,180],[13,17,185],[14,15,185],[16,17,200],[17,19,210],[18,19,215],[19,22,230],[21,23,250],[22,24,255],[24,27,280],[27,30,300],[30,32,320]];
const DIN3110X=[[20,22,235],[24,26,270],[25,28,285],[27,32,310]];
for(const [a,b,L,x] of [...DIN3110,...DIN3110X.map(r=>[...r,1])]){
  add(`double-open-end-wrench-${a}x${b}mm`,'wrenches',`Plochý oboustranný klíč ${a}×${b} mm`,`Double open-end wrench ${a}×${b} mm`,doubleOpen(a,b,L),thick(b).open+2,'mm',a,
    [`${a} mm`,`${b} mm`,`${a}x${b}`,'DIN 3110','ISO 10102','plochý','open end'],x?'typical':'standard',x?`Length ≈ ${L} mm interpolated between DIN 3110 sizes; heads ≈ ISO 3318 formulae.`:`DIN 3110 overall length ≈ ${L} mm; heads ≈ ISO 3318 limits.`);
}

/* ---------- hex & torx keys ---------- */
const ISO2936=[[1.5,46.5,15.5],[2,52,18],[2.5,58.5,20.5],[3,66,23],[4,74,29],[5,85,33],[6,96,38],[8,108,44],[10,122,50],[12,137,57]];
const legs=s=>{const T=ISO2936;if(s<=T[0][0])return[T[0][1]*s/T[0][0]+(1-s/T[0][0])*20,T[0][2]];
  for(let i=1;i<T.length;i++)if(s<=T[i][0]){const t=(s-T[i-1][0])/(T[i][0]-T[i-1][0]);return[T[i-1][1]+t*(T[i][1]-T[i-1][1]),T[i-1][2]+t*(T[i][2]-T[i-1][2])];}
  return[T.at(-1)[1],T.at(-1)[2]];};
function lKey(e,L1,L2,ri){
  const R=ri+e,n=Math.max(4,Math.ceil(nseg(R)/4)),outer=[],inner=[];
  for(let i=0;i<=n;i++){const a=PI+PI/2*i/n;outer.push(P(R+R*Math.cos(a),R+R*Math.sin(a)));inner.push(P(R+ri*Math.cos(a),R+ri*Math.sin(a)));}
  return shape([rect(R-.05,0,L1,e),rect(0,R-.05,e,L2),[...outer,...inner.reverse()]]);
}
for(const [s,L1,L2] of ISO2936){
  const e=s/Math.cos(30*D2R);
  add(`hex-key-l-${slug(s)}mm`,'hex-keys',`Imbusový klíč ${cz(s)} mm`,`Hex key ${s} mm`,lKey(e,L1,L2,.6*s),e+2,'mm',s,
    [`${s} mm`,'ISO 2936','DIN 911','imbus','inbus','allen','L-key'],'standard',`ISO 2936 legs ${L1}/${L2} mm, across corners ${e.toFixed(2)} mm.`);
}
for(const q of [{label:'0.050"',id:'0-050in',v:.05},...['1/16','5/64','3/32','7/64','1/8','9/64','5/32','3/16','7/32','1/4','5/16','3/8'].map(FR)]){
  const s=q.v*25.4,e=s/Math.cos(30*D2R),[L1,L2]=legs(s);
  add(`hex-key-l-${q.id}`,'hex-keys',`Imbusový klíč ${q.label}`,`Hex key ${q.label}`,lKey(e,L1,L2,.6*s),e+2,'in',q.v,
    [q.label,'SAE','ASME B18.3','imperial','imbus','allen','L-key'],'typical','Legs interpolated from ISO 2936 by across-flats size.');
}
for(const [t,e] of [[8,2.31],[9,2.5],[10,2.74],[15,3.27],[20,3.86],[25,4.43],[27,4.99],[30,5.52],[40,6.65],[45,7.82],[50,8.83]]){
  const [L1,L2]=legs(e*.9);
  add(`torx-key-l-t${t}`,'hex-keys',`Klíč Torx T${t}`,`Torx L-key T${t}`,lKey(e,L1,L2,.6*e),e+2,'mm',e,
    [`T${t}`,'Torx','ISO 10664','hexalobular','L-key'],'typical',`Tip ${e} mm across points (ISO 10664); legs interpolated from ISO 2936.`);
}

/* ---------- sockets, ratchets, extensions, bits ---------- */
function socket(len,dd,ds){
  const xs=len*.45;
  return shape([box(0,xs+.5,dd,.8),box(xs,len,ds,.8)]);
}
const DRIVES={'1/4':{dd:12.5,len:s=>25,sizes:[4,5,5.5,6,7,8,9,10,11,12,13,14]},'3/8':{dd:17,len:s=>s>19?31:28,sizes:[8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]},'1/2':{dd:22,len:s=>s>24?42:38,sizes:[8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,27,30,32]}};
const sockD=s=>1.3*s+2.2;
for(const [dr,cfg] of Object.entries(DRIVES)){
  const q=FR(dr);
  for(const s of cfg.sizes){
    const len=cfg.len(s),ds=sockD(s),D=Math.max(ds,cfg.dd);
    add(`socket-${q.id}-${slug(s)}mm`,'sockets',`Nástrčná hlavice ${cz(s)} mm (${q.label})`,`Socket ${s} mm, ${q.label} drive`,socket(len,cfg.dd,ds),roundDepth(D),'mm',s,
      [`${s} mm`,q.label,'DIN 3124','ISO 2725-1','hlavice','socket','lying on side','na boku'],'standard',`DIN 3124 length ${len} mm; outer Ø ≈ ${ds.toFixed(1)} mm (ISO 3318 approx.). Lying on its side.`);
  }
}
for(const f of ['5/16','3/8','7/16','1/2','9/16','5/8','11/16','3/4','13/16','7/8']){
  const q=FR(f),s=q.v*25.4,ds=sockD(s),len=s>19?31:28,D=Math.max(ds,17);
  add(`socket-3-8in-${q.id}`,'sockets',`Nástrčná hlavice ${q.label} (3/8")`,`Socket ${q.label}, 3/8" drive`,socket(len,17,ds),roundDepth(D),'in',q.v,
    [q.label,'3/8"','SAE','ASME B107.110','imperial','socket','lying on side','na boku'],'typical','Metric DIN 3124 / ISO 3318 formulae applied to the SAE size. Lying on its side.');
}
function ratchet(L,hd,neck,hw){
  return shape([circle(hd/2,0,hd/2),cap(hd/2,0,neck/2,L*.35,0,neck/2*1.05),cap(L*.33,0,hw/2*.85,L-hw/2,0,hw/2),circle(hd*.55,hd*.42,hd*.12)]);
}
for(const [dr,L,hd,neck,hw,dep] of [['1/4',150,27,11,16,20],['3/8',200,36,14,22,26],['1/2',265,45,18,28,34]]){
  const q=FR(dr);
  add(`ratchet-${q.id}`,'sockets',`Ráčna ${q.label}`,`Ratchet ${q.label}`,ratchet(L,hd,neck,hw),dep,'in',q.v,[q.label,'ráčna','ratchet','DIN 3122'],'typical',`Typical ${L} mm ratchet, head Ø ${hd} mm.`);
}
const EXT={'1/4':{de:12.5,le:14,db:9,sq:6.35,lm:7,lens:[50,100,150]},'3/8':{de:17,le:18,db:12.5,sq:9.53,lm:10,lens:[75,125,250]},'1/2':{de:22,le:22,db:17,sq:12.7,lm:14,lens:[125,250]}};
for(const [dr,c] of Object.entries(EXT)){
  const q=FR(dr);
  for(const L of c.lens)add(`extension-bar-${q.id}-${L}mm`,'sockets',`Prodlužovací nástavec ${q.label} ${L} mm`,`Extension bar ${q.label} ${L} mm`,
    shape([box(0,c.le,c.de,.8),box(c.le-1,L-c.lm,c.db,.5),box(L-c.lm-.5,L,c.sq,.6)]),roundDepth(c.de),'in',q.v,[q.label,`${L} mm`,'prodloužení','extension','DIN 3123'],'typical',`Typical ${L} mm extension, female end Ø ${c.de} mm.`);
}
add('bit-holder-1-4in','sockets','Držák bitů 1/4" 60 mm','Bit holder 1/4" 60 mm',shape([box(0,45,12.5,1),box(44.5,60,7.33,.6)]),roundDepth(12.5),'in',.25,['1/4"','bit','držák','holder','magnetic'],'typical','Typical magnetic bit holder, ISO 1173 hex shank.');
add('bit-adapter-1-4in','sockets','Adaptér na bity 1/4" (čtyřhran → šestihran)','Bit adapter 1/4" square to 1/4" hex',shape([box(0,26,12.5,.8),box(25.5,32,6.35,.5)]),roundDepth(12.5),'in',.25,['1/4"','bit','adaptér','adapter','bit holder'],'typical','Typical 1/4" square-drive bit adapter, ~32 mm.');
add('universal-joint-1-2in','sockets','Kloub 1/2"','Universal joint 1/2"',shape([box(0,27,22,.8),box(25,47,26,2),box(45,72,22,.8)]),roundDepth(26),'in',.5,['1/2"','kloub','universal joint','kardan','DIN 3123'],'typical','Typical 1/2" universal joint, ~72 mm, lying straight on its side.');
add('sliding-t-bar-1-2in','sockets','Posuvná T-rukojeť 1/2" 250 mm','Sliding T-bar 1/2" 250 mm',shape([box(0,250,14,.6),rrect(110,-14,140,14,4)]),roundDepth(28),'in',.5,['1/2"','T-rukojeť','sliding T-bar','DIN 3122'],'typical','Typical 250 mm sliding T-bar, Ø 14 mm, head parked mid-bar.');
const bitTip=(L)=>shape([box(0,L-5,7.33,.5),[P(L-5.2,-3.67),P(L,-1.5),P(L,1.5),P(L-5.2,3.67)]]);
add('bit-25mm-c6-3','sockets','Bit 25 mm (1/4")','Bit 25 mm (1/4" hex)',bitTip(25),roundDepth(7.33),'mm',25,['1/4"','C6.3','ISO 1173','bit','25 mm'],'standard','ISO 1173 C6.3: 6.35 mm hex across flats, length 25 mm.');
add('bit-50mm-e6-3','sockets','Bit 50 mm (1/4")','Bit 50 mm (1/4" hex)',shape([box(0,11,7.33,.5),box(10.5,45,4.5,.3),[P(44.8,-2.25),P(50,-1.2),P(50,1.2),P(44.8,2.25)]]),roundDepth(7.33),'mm',50,['1/4"','E6.3','ISO 1173','bit','50 mm'],'standard','ISO 1173 E6.3: 6.35 mm hex, length 50 mm.');

/* ---------- screwdrivers ---------- */
function screwdriver(Lh,Dh,ds,Lb,tip,w){
  const r=Dh/2,end=Lh+Lb,tl=Math.min(10,Lb*.12);
  const parts=[hull([...circle(r*.9,0,r*.85),...circle(Lh-r*1.1,0,r),...circle(Lh-2,0,r*.62)]),box(Lh-3,end-tl+.3,ds)];
  if(tip==='sl')parts.push([P(end-tl,-ds/2),P(end,-w/2),P(end,w/2),P(end-tl,ds/2)]);
  else parts.push([P(end-tl,-ds/2),P(end-1,-.5),P(end,-.25),P(end,.25),P(end-1,.5),P(end-tl,ds/2)]);
  return shape(parts);
}
for(const [w,L,ds,Dh,Lh] of [[2.5,75,2.5,20,80],[3,80,3,22,85],[3,100,3,22,85],[4,100,4,25,95],[5.5,125,5,30,105],[6.5,150,6,33,110],[8,175,7,36,115]]){
  add(`screwdriver-slotted-${slug(w)}x${L}`,'screwdrivers',`Šroubovák plochý ${cz(w)} × ${L} mm`,`Slotted screwdriver ${w} × ${L} mm`,screwdriver(Lh,Dh,ds,L,'sl',w),roundDepth(Dh),'mm',w,
    [`${w} mm`,`SL ${w}`,'ISO 2380','plochý','slotted','flat'],'typical',L===80?`Blade ${w} × ${L} mm (length common in sets); handle typical.`:`Blade ${w} × ${L} mm per ISO 2380-2; handle typical.`);
}
const CROSS=[[0,60,3,25,95],[1,80,4.5,30,105],[2,100,6,33,110],[3,150,8,38,120]];
for(const [k,name,cs] of [['ph','Phillips','křížový'],['pz','Pozidriv','Pozidriv']])for(const [n,L,ds,Dh,Lh] of CROSS){
  if(k==='pz'&&n===0)continue;
  const tag=`${k.toUpperCase()}${n}`;
  add(`screwdriver-${k}${n}x${L}`,'screwdrivers',`Šroubovák ${cs} ${tag} × ${L} mm`,`${name} screwdriver ${tag} × ${L} mm`,screwdriver(Lh,Dh,ds,L,'ph'),roundDepth(Dh),'mm',n,
    [tag,name,'ISO 8764',k==='ph'?'křížový':'pozidriv','cross'],'typical',`Blade length ${L} mm per ISO 8764-2; handle typical.`);
}

/* ---------- pliers ---------- */
function pliers({L,head,tipW,jointW,spread,he}){
  const jaw=hull([...circle(tipW/2,0,tipW/2),...circle(head,0,jointW/2)]);
  const hx=L-he,ys=spread/2-he,mx=head+(L-head)*.55;
  const handles=hull([...circle(head,0,jointW*.45),...circle(mx,ys*.85,he*.9),...circle(mx,-ys*.85,he*.9),...circle(hx,ys,he),...circle(hx,-ys,he)]);
  const gap=Math.max(0,spread/2-2*he);// open V between the handle ends
  return shape([jaw,handles],gap>2?[[P(L+1,-gap),P(L-.3*(L-head),0),P(L+1,gap)]]:[]);
}
const PL=[
  ['combination-pliers',[160,180,200],'Kombinované kleště','Combination pliers',L=>({L,head:.3*L,tipW:.06*L,jointW:.15*L,spread:.29*L,he:.05*L}),L=>12+L/90,['kombinačky','DIN ISO 5746']],
  ['long-nose-pliers',[160,200],'Půlkulaté kleště','Long-nose pliers',L=>({L,head:.38*L,tipW:3.5,jointW:.12*L,spread:.26*L,he:.045*L}),L=>12+L/100,['ploché','DIN ISO 5745','needle nose']],
  ['diagonal-cutters',[160,180],'Boční štípací kleště','Diagonal cutters',L=>({L,head:.2*L,tipW:.065*L,jointW:.17*L,spread:.3*L,he:.05*L}),()=>15,['štípačky','DIN ISO 5749','side cutters']],
  ['tin-snips',[250],'Nůžky na plech','Tin snips',L=>({L,head:.32*L,tipW:5,jointW:.13*L,spread:.24*L,he:.045*L}),()=>16,['nůžky','snips','aviation']]
];
for(const [id,sizes,cs,en,par,dep,tags] of PL)for(const L of sizes)
  add(`${id}-${L}mm`,id==='tin-snips'?'cutting':'pliers',`${cs} ${L} mm`,`${en} ${L} mm`,pliers(par(L)),dep(L),'mm',L,[`${L} mm`,...tags],'typical',`Typical closed-jaw silhouette, overall length ${L} mm.`);
add('water-pump-pliers-250mm','pliers','Instalatérské kleště SIKO 250 mm','Water pump pliers 250 mm',
  shape([hull([...circle(62,0,16),...rot(circle(18,0,13),-35,62,0)]),hull([...circle(62,0,13),...circle(160,12,8),...circle(160,-12,8),...circle(242,17,8),...circle(242,-17,8)])]),18,'mm',250,['250 mm','siko','DIN ISO 8976','tongue and groove','groove-joint'],'typical','Typical 250 mm groove-joint pliers, jaws closed.');
add('locking-pliers-250mm','pliers','Samosvorné kleště 250 mm','Locking pliers 250 mm',
  shape([hull([...circle(9,0,8),...circle(58,4,17)]),hull([...circle(58,4,15),...circle(215,12,11)]),cap(210,12,7,250,12,7),hull([...circle(75,-8,9),...circle(215,-24,8)])]),20,'mm',250,['250 mm','zámkové','grip','vise-grip'],'typical','Typical 250 mm curved-jaw locking pliers, closed.');

/* ---------- measuring & marking ---------- */
for(const [L,W,TL] of [[150,18,165],[300,25,320]])add(`steel-rule-${L}mm`,'measuring',`Ocelové pravítko ${L} mm`,`Steel rule ${L} mm`,shape([rrect(0,0,TL,W,2),rrect(TL-W,0,TL,W,W/2)]),3,'mm',L,[`${L} mm`,'pravítko','měřítko','rule','DIN 866'],'typical',`Typical ${TL} × ${W} mm stainless rule.`);
add('digital-caliper-150mm','measuring','Digitální posuvné měřítko 150 mm','Digital caliper 150 mm',shape([
  rect(0,0,236,16),[P(0,0),P(14,0),P(14,-40),P(11,-40),P(0,-14)],[P(13.9,0),P(30,0),P(30,-12),P(18,-40),P(13.9,-40)],
  [P(4,15.9),P(14.1,15.9),P(14.1,32),P(12,32)],[P(13.9,15.9),P(24,15.9),P(16,32),P(13.9,32)],rrect(14,-16,96,27,4),circle(64,-17,6)]),18,'mm',150,
  ['150 mm','šuplera','posuvka','caliper','vernier','DIN 862'],'typical','Typical 150 mm digital caliper, jaws closed.');
for(const [m,W,H,dep] of [[3,58,56,26],[5,68,66,36],[8,80,78,44]])add(`tape-measure-${m}m`,'measuring',`Svinovací metr ${m} m`,`Tape measure ${m} m`,shape([rrect(0,0,W,H,H*.24),rect(-4,1,1,H*.32)]),dep,'mm',m*1000,[`${m} m`,'metr','svinovák','tape'],'typical',`Typical ${m} m tape case ${W} × ${H} mm, lying on its side.`);
for(const [L,bw,sl,sw,dep] of [[150,26,100,18,14],[300,36,180,26,16]])add(`try-square-${L}mm`,'measuring',`Příložný úhelník ${L} mm`,`Try square ${L} mm`,shape([rect(0,0,sw,sl),rect(0,0,L+sw,bw)]),dep,'mm',L,[`${L} mm`,'úhelník','square','DIN 875'],'typical',`Blade ${L} mm, stock ${sl} mm.`);
add('pencil','measuring','Tužka','Pencil',shape([box(0,158,8,.4),[P(157.8,-4),P(176,-.6),P(178,0),P(176,.6),P(157.8,4)]]),7,'mm',178,['tužka','pencil','HB'],'typical','Hexagonal pencil, 8 mm across corners.');
add('carpenter-pencil','measuring','Tesařská tužka','Carpenter pencil',shape([rrect(0,-6,165,6,1.5),[P(164.8,-6),P(180,-2),P(180,2),P(164.8,6)]]),9,'mm',180,['tesařská','carpenter','pencil'],'typical','Flat 12 × 7 mm carpenter pencil.');
add('scriber','measuring','Rýsovací jehla','Scriber',shape([box(0,128,6,.6),[P(127.8,-3),P(150,-.3),P(150,.3),P(127.8,3)]]),6,'mm',150,['rýsovací','jehla','scriber','marking'],'typical','Typical Ø 6 mm scriber, 150 mm.');

/* ---------- cutting ---------- */
add('utility-knife-18mm','cutting','Odlamovací nůž 18 mm','Utility knife 18 mm',shape([hull([...circle(15,0,14),...circle(140,0,11.5)]),[P(140,-9),P(176,-9),P(165,9),P(140,9)],circle(72,13,5)]),20,'mm',18,['18 mm','odlamovací','nůž','cutter','snap-off'],'typical','Typical 18 mm snap-off knife, blade extended 25 mm.');
add('utility-knife-9mm','cutting','Odlamovací nůž 9 mm','Utility knife 9 mm',shape([hull([...circle(9,0,9),...circle(112,0,7.5)]),[P(112,-4.5),P(138,-4.5),P(132,4.5),P(112,4.5)],circle(55,8.5,3.5)]),14,'mm',9,['9 mm','odlamovací','nůž','cutter','snap-off'],'typical','Typical 9 mm snap-off knife.');
add('junior-hacksaw','cutting','Pilka na kov junior','Junior hacksaw',shape([hull([...circle(26,48,24),...circle(150,78,8),...circle(258,16,8),...circle(8,6,6),...circle(258,4,4)])]),16,'mm',150,['pilka','na kov','junior','hacksaw','150 mm'],'typical','Typical junior hacksaw for 150 mm blades (outer silhouette, frame filled).');
for(const w of [6,8,10,12,16,18,20,25,26]){
  const bl=w<12?115:125,h=118;
  add(`wood-chisel-${w}mm`,'cutting',`Dláto ${w} mm`,`Wood chisel ${w} mm`,shape([hull([...circle(14,0,13),...circle(98,0,15),...circle(h-2,0,10)]),box(h-3,h+12,Math.max(9,w*.6),1),box(h+11,h+12+bl,w,.4)]),20,'mm',w,
    [`${w} mm`,'dláto','chisel','DIN 5139'],'typical',`Typical bench chisel, blade ${w} × ${bl} mm, handle Ø 30 mm.`);
}

/* ---------- striking ---------- */
function clawHammer(L,H,hw){
  const hx=L-hw/2,parts=[hull([...circle(16,0,15),...circle(L-hw*1.1,0,11)]),rect(L-hw,-6,L,.42*H),rrect(L-hw-2,.3*H,L+2,.45*H,2)];
  const Rc=.58*H,cx=hx-Rc;let prev=null;
  for(let i=0;i<=8;i++){const a=-70*D2R*i/8,c=circle(cx+Rc*Math.cos(a),Rc*Math.sin(a),(hw/2)*(1-.65*i/8));if(prev)parts.push(hull([...prev,...c]));prev=c;}
  return shape(parts);
}
for(const [g,L,H,hw,dep] of [[300,300,110,24,28],[500,330,128,28,32]])
  add(`claw-hammer-${g}g`,'striking',`Kladivo s vytahovákem ${g} g`,`Claw hammer ${g} g`,clawHammer(L,H,hw),dep,'mm',L,[`${g} g`,'kladivo','claw','tesařské'],'typical',`Typical ${g} g claw hammer, handle ${L} mm, head ${H} mm.`);
function peinHammer(L,H,hw,ball){
  const parts=[hull([...circle(16,0,15),...circle(L-hw*1.1,0,11)]),rrect(L-hw,ball?-.25*H:-.2*H,L,.5*H,2),rrect(L-hw-2,.38*H,L+2,.5*H,2)];
  if(ball)parts.push(rect(L-hw*.8,-.42*H,L-hw*.2,-.2*H),circle(L-hw/2,-.5*H+hw*.55,hw*.55));
  else parts.push([P(L-hw,-.2*H),P(L-hw/2-2,-.5*H),P(L-hw/2+2,-.5*H),P(L,-.2*H)]);
  return shape(parts);
}
for(const [g,L,H,hw,dep] of [[300,300,100,22,26],[500,330,115,26,30]]){
  add(`ball-pein-hammer-${g}g`,'striking',`Kladivo s kulovým nosem ${g} g`,`Ball-pein hammer ${g} g`,peinHammer(L,H,hw,true),dep,'mm',L,[`${g} g`,'kladivo','ball pein','kulové','ASME B107.400'],'typical',`Typical ${g} g ball-pein hammer, handle ${L} mm.`);
  add(`machinist-hammer-${g}g`,'striking',`Zámečnické kladivo ${g} g`,`Machinist (cross-pein) hammer ${g} g`,peinHammer(L,H,hw,false),dep,'mm',L,[`${g} g`,'kladivo','zámečnické','DIN 1041','cross pein'],'typical',`Typical DIN 1041 style ${g} g hammer, handle ${L} mm.`);
}
add('centre-punch','striking','Důlčík','Centre punch',shape([box(0,95,10,1.2),[P(94.8,-5),P(116,-1.6),P(120,-.4),P(120,.4),P(116,1.6),P(94.8,5)]]),roundDepth(10),'mm',120,['důlčík','centre punch','center punch','DIN 7250'],'typical','Typical Ø 10 × 120 mm centre punch.');
for(const d of [2,3,4,5,6,7,8]){
  const B=d<=3?8:d<=5?10:12,L=150,pl=Math.min(40,8*d+12);
  add(`pin-punch-${d}mm`,'striking',`Vyrážeč ${d} mm`,`Pin punch ${d} mm`,shape([box(0,L-pl-12,B,1),[P(L-pl-12.2,-B/2),P(L-pl,-d/2),P(L-pl,d/2),P(L-pl-12.2,B/2)],box(L-pl-.2,L,d,Math.min(.4,d/6))]),roundDepth(B),'mm',d,
    [`${d} mm`,'vyrážeč','průbojník','pin punch','DIN 6450'],'typical',`Typical pin punch, tip Ø ${d} mm, body Ø ${B} mm, ${L} mm.`);
}

export default items;
