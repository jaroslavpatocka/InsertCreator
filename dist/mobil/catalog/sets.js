// Tool sets based on typical commercial set compositions (see catalog/index.js for the schema).
// Names are generic (no brands). source.note names a commercial set only where its contents were checked
// against the maker's or retailers' listings; otherwise it describes a common generic composition.
// Piece count in the name = items.length = physical tools that need a pocket (cases, holders, bit
// assortments without a pocket etc. are mentioned in the description instead).
const SRC='Typické složení prodávaných sad';
const range=(a,b)=>Array.from({length:b-a+1},(_,i)=>a+i);
const cw=s=>`combination-wrench-${s}mm`;
const cwIn=f=>`combination-wrench-${f.replace('/','-')}in`;
const dow=(a,b)=>`double-open-end-wrench-${a}x${b}mm`;
const hex=s=>`hex-key-l-${String(s).replace('.','-')}mm`;
const hexIn=f=>`hex-key-l-${f.replace(/[./]/g,'-').replace(/^-/,'0-')}in`;
const tx=t=>`torx-key-l-t${t}`;
const sk=(drive,s)=>`socket-${drive}-${String(s).replace('.','-')}mm`;
const sl=(w,l)=>`screwdriver-slotted-${String(w).replace('.','-')}x${l}`;
const chisel=w=>`wood-chisel-${w}mm`;
const punch=d=>`pin-punch-${d}mm`;
const SAE=['1/4','5/16','3/8','7/16','1/2','9/16','5/8','11/16','3/4','13/16','7/8','15/16','1'];
const set=(id,category,unit,cs,en,dcs,den,items,tags,note,url)=>({id,category,name:{cs,en},description:{cs:dcs,en:den},items,unit,tags,source:{name:SRC,note,...(url?{url}:{})}});

export default [
  /* ---------- wrenches: combination, metric ---------- */
  set('combination-wrench-set-6-32mm','wrenches','mm','Sada očkoplochých klíčů 6–32 mm (26 ks)','Combination wrench set 6–32 mm (26 pcs)',
    'Kompletní řada 6–30 mm a 32 mm (31 mm se v sadách nevyskytuje).','Every size 6–30 mm plus 32 mm (31 mm is not part of such sets).',
    [...range(6,30),32].map(cw),['6-32 mm','6–32','26 ks','26 pcs','očkoplochý','combination','metric'],
    'Composition of e.g. Gedore 7-026 (6–30 mm + 32 mm, 26 pcs). Combination wrenches below 6 mm are not sold in such sets.','https://shop.gedore.com/en-at/6093740/'),
  set('combination-wrench-set-6-22mm','wrenches','mm','Sada očkoplochých klíčů 6–22 mm (17 ks)','Combination wrench set 6–22 mm (17 pcs)',
    'Všechny velikosti 6–22 mm po 1 mm.','Every size 6–22 mm in 1 mm steps.',
    range(6,22).map(cw),['6-22 mm','17 ks','17 pcs','očkoplochý','combination','metric'],'Common 17-piece 6–22 mm composition.'),
  set('combination-wrench-set-8-19mm','wrenches','mm','Sada očkoplochých klíčů 8–19 mm (12 ks)','Combination wrench set 8–19 mm (12 pcs)',
    'Všechny velikosti 8–19 mm po 1 mm.','Every size 8–19 mm in 1 mm steps.',
    range(8,19).map(cw),['8-19 mm','12 ks','12 pcs','očkoplochý','combination','metric'],'Composition of e.g. Bahco 111M/SH12 (8–19 mm, every size).','https://www.bahco.com/int_en/metric-flat-combination-wrench-set-with-micro-matte-finish---12-pcs-plastic-holder-111m-sh12.html'),
  set('combination-wrench-set-8-19mm-10pcs','wrenches','mm','Sada očkoplochých klíčů 8–19 mm (10 ks)','Combination wrench set 8–19 mm (10 pcs)',
    'Velikosti 8, 9, 10, 11, 12, 13, 14, 15, 17, 19 mm.','Sizes 8, 9, 10, 11, 12, 13, 14, 15, 17, 19 mm.',
    [8,9,10,11,12,13,14,15,17,19].map(cw),['8-19 mm','10 ks','10 pcs','očkoplochý','combination','metric'],'Composition of e.g. Stahlwille 13/10KT (8–19 mm, 10 pcs).','https://kctool.com/products/stahlwille-13-10kt-open-box-combination-spanner-set-metric-8-19mm-10-pieces'),
  set('combination-wrench-set-8-22mm-8pcs','wrenches','mm','Sada očkoplochých klíčů 8–22 mm (8 ks)','Combination wrench set 8–22 mm (8 pcs)',
    'Nejpoužívanější velikosti 8, 10, 12, 13, 14, 17, 19, 22 mm.','Most used sizes 8, 10, 12, 13, 14, 17, 19, 22 mm.',
    [8,10,12,13,14,17,19,22].map(cw),['8-22 mm','8 ks','8 pcs','očkoplochý','combination','metric'],'Composition of e.g. Bahco 111M/SH8 (8, 10, 12, 13, 14, 17, 19, 22 mm).','https://www.bahco.com/int_en/metric-flat-combination-wrench-set---8-pcs-plastic-holder-pb_111m-sh8_.html'),
  /* ---------- wrenches: combination, SAE ---------- */
  set('combination-wrench-set-sae-1-4-7-8in','wrenches','in','Sada očkoplochých klíčů 1/4"–7/8" (11 ks)','SAE combination wrench set 1/4"–7/8" (11 pcs)',
    'Palcové velikosti 1/4" až 7/8" po 1/16".','SAE sizes 1/4" to 7/8" in 1/16" steps.',
    SAE.slice(0,11).map(cwIn),['1/4"-7/8"','SAE','imperial','palcový','11 ks','11 pcs','combination'],'Common 11-piece SAE composition, e.g. Titan 17311 (1/4"–7/8").','https://www.titan-us.com/11-pc.-12-pt.-Full-Polished-SAE-Combination-Wrench-Set'),
  set('combination-wrench-set-sae-3-8-1in','wrenches','in','Sada očkoplochých klíčů 3/8"–1" (11 ks)','SAE combination wrench set 3/8"–1" (11 pcs)',
    'Palcové velikosti 3/8" až 1" po 1/16".','SAE sizes 3/8" to 1" in 1/16" steps.',
    SAE.slice(2).map(cwIn),['3/8"-1"','SAE','imperial','palcový','11 ks','11 pcs','combination'],'Composition of e.g. GearWrench 81934 (3/8"–1", 11 pcs).','https://www.gearwrench.com/all-tools/wrenches/combination-wrenches/81934-11-piece-12-point-long-pattern-combination-sae-wrench-set-tool-roll'),
  set('combination-wrench-set-sae-1-4-1in','wrenches','in','Sada očkoplochých klíčů 1/4"–1" (13 ks)','SAE combination wrench set 1/4"–1" (13 pcs)',
    'Všechny palcové velikosti 1/4" až 1" po 1/16".','Every SAE size 1/4" to 1" in 1/16" steps.',
    SAE.map(cwIn),['1/4"-1"','SAE','imperial','palcový','13 ks','13 pcs','combination'],'Common 13-piece SAE composition (1/4"–1", every 1/16").'),
  /* ---------- wrenches: double open-end ---------- */
  set('double-open-end-wrench-set-6-22mm','wrenches','mm','Sada plochých oboustranných klíčů 6×7–20×22 mm (8 ks)','Double open-end wrench set 6×7–20×22 mm (8 pcs)',
    '6×7, 8×9, 10×11, 12×13, 14×15, 16×17, 18×19, 20×22 mm.','6×7, 8×9, 10×11, 12×13, 14×15, 16×17, 18×19, 20×22 mm.',
    [[6,7],[8,9],[10,11],[12,13],[14,15],[16,17],[18,19],[20,22]].map(p=>dow(...p)),['6-22 mm','8 ks','8 pcs','plochý','open end','DIN 3110','metric'],'Composition of e.g. Gedore 6-8 (6×7–20×22 mm, 8 pcs).','https://shop.gedore.com/en-de/6077380/'),
  set('double-open-end-wrench-set-6-32mm','wrenches','mm','Sada plochých oboustranných klíčů 6×7–27×32 mm (12 ks)','Double open-end wrench set 6×7–27×32 mm (12 pcs)',
    '6×7 až 18×19, 20×22, 21×23, 24×26, 25×28, 27×32 mm.','6×7 to 18×19, 20×22, 21×23, 24×26, 25×28, 27×32 mm.',
    [[6,7],[8,9],[10,11],[12,13],[14,15],[16,17],[18,19],[20,22],[21,23],[24,26],[25,28],[27,32]].map(p=>dow(...p)),['6-32 mm','12 ks','12 pcs','plochý','open end','DIN 3110','metric'],'Composition of e.g. Gedore 6-12 (6×7–27×32 mm, 12 pcs).','https://www.gedore.com/en-de/products/assembly-tools-for-screws-,-a-,-nuts/spanners/double-open-ended-spanner-sets/6-(mm)-double-open-ended-spanner-set/6-12---6077700'),
  /* ---------- hex & torx keys ---------- */
  set('hex-key-set-1-5-10mm','hex-keys','mm','Sada imbusových klíčů 1,5–10 mm (9 ks)','Hex key set 1.5–10 mm (9 pcs)',
    '1,5; 2; 2,5; 3; 4; 5; 6; 8; 10 mm.','1.5, 2, 2.5, 3, 4, 5, 6, 8, 10 mm.',
    [1.5,2,2.5,3,4,5,6,8,10].map(hex),['1.5-10 mm','9 ks','9 pcs','imbus','allen','hex','metric'],'Composition of e.g. Wera 950/9 Hex-Plus (1.5–10 mm, 9 pcs).','https://www.weratools.com/en-us/tools/950-9-hex-plus-2-l-key-set-metric-chrome-plated'),
  set('hex-key-set-2-10mm','hex-keys','mm','Sada imbusových klíčů 2–10 mm (8 ks)','Hex key set 2–10 mm (8 pcs)',
    '2; 2,5; 3; 4; 5; 6; 8; 10 mm.','2, 2.5, 3, 4, 5, 6, 8, 10 mm.',
    [2,2.5,3,4,5,6,8,10].map(hex),['2-10 mm','8 ks','8 pcs','imbus','allen','hex','metric'],'Common 8-piece 2–10 mm composition.'),
  set('hex-key-set-sae-0-050-3-8in','hex-keys','in','Sada imbusových klíčů 0,050"–3/8" (13 ks)','SAE hex key set 0.050"–3/8" (13 pcs)',
    '0,050"; 1/16" až 3/8".','0.050", 1/16" to 3/8".',
    ['.050','1/16','5/64','3/32','7/64','1/8','9/64','5/32','3/16','7/32','1/4','5/16','3/8'].map(hexIn),['0.050"-3/8"','SAE','imperial','palcový','13 ks','13 pcs','imbus','allen'],'Composition of e.g. Bondhus 12137 (.050"–3/8", 13 pcs).','https://bondhustools.com/Item/bondhus_12137'),
  set('torx-key-set-t8-t40','hex-keys','mm','Sada klíčů Torx T8–T40 (9 ks)','Torx key set T8–T40 (9 pcs)',
    'T8, T9, T10, T15, T20, T25, T27, T30, T40.','T8, T9, T10, T15, T20, T25, T27, T30, T40.',
    [8,9,10,15,20,25,27,30,40].map(tx),['T8-T40','Torx','9 ks','9 pcs','hexalobular'],'Composition of e.g. Wera 967/9 TX (T8–T40, 9 pcs).','https://www.newark.com/wera/967l-9-hf-torx/torx-set-l-key-9pc/dp/35M2560'),
  set('torx-key-set-t10-t50','hex-keys','mm','Sada klíčů Torx T10–T50 (9 ks)','Torx key set T10–T50 (9 pcs)',
    'T10, T15, T20, T25, T27, T30, T40, T45, T50.','T10, T15, T20, T25, T27, T30, T40, T45, T50.',
    [10,15,20,25,27,30,40,45,50].map(tx),['T10-T50','Torx','9 ks','9 pcs','hexalobular'],'Common 9-piece T10–T50 composition.'),
  /* ---------- sockets ---------- */
  set('socket-set-1-4in-4-14mm','sockets','mm','Sada nástrčných hlavic 1/4" 4–14 mm (16 ks)','Socket set 1/4" 4–14 mm (16 pcs)',
    '12 hlavic 4–14 mm (vč. 5,5), ráčna, nástavce 50 a 100 mm, adaptér na bity. Bity a kufr nejsou započítány.','12 sockets 4–14 mm (incl. 5.5), ratchet, 50 and 100 mm extensions, bit adapter. Bits and case not counted.',
    [...[4,5,5.5,6,7,8,9,10,11,12,13,14].map(s=>sk('1-4in',s)),'ratchet-1-4in','extension-bar-1-4in-50mm','extension-bar-1-4in-100mm','bit-adapter-1-4in'],
    ['1/4"','4-14 mm','16 ks','16 pcs','hlavice','socket','ráčna','ratchet','metric'],'Common 1/4" composition; socket sizes as in e.g. Hazet 2200SC-2 (4–14 mm incl. 5.5 mm).'),
  set('socket-set-3-8in-8-22mm','sockets','mm','Sada nástrčných hlavic 3/8" 8–22 mm (18 ks)','Socket set 3/8" 8–22 mm (18 pcs)',
    '15 hlavic 8–22 mm, ráčna, nástavce 75 a 250 mm.','15 sockets 8–22 mm, ratchet, 75 and 250 mm extensions.',
    [...range(8,22).map(s=>sk('3-8in',s)),'ratchet-3-8in','extension-bar-3-8in-75mm','extension-bar-3-8in-250mm'],
    ['3/8"','8-22 mm','18 ks','18 pcs','hlavice','socket','ráčna','ratchet','metric'],'Common 3/8" 8–22 mm composition with ratchet and two extensions.'),
  set('socket-set-1-2in-10-32mm','sockets','mm','Sada nástrčných hlavic 1/2" 10–32 mm (15 ks)','Socket set 1/2" 10–32 mm (15 pcs)',
    '13 hlavic 10, 12, 13, 15–19, 22, 24, 27, 30, 32 mm, ráčna, nástavec 250 mm.','13 sockets 10, 12, 13, 15–19, 22, 24, 27, 30, 32 mm, ratchet, 250 mm extension.',
    [...[10,12,13,15,16,17,18,19,22,24,27,30,32].map(s=>sk('1-2in',s)),'ratchet-1-2in','extension-bar-1-2in-250mm'],
    ['1/2"','10-32 mm','15 ks','15 pcs','hlavice','socket','ráčna','ratchet','metric'],'Composition of e.g. Gedore 19 DMU-20 (13 sockets 10–32 mm, ratchet, extension).','https://www.klium.com/en/gedore-19-dmu-20-socket-spanner-set-1-2-15-piece-3014347-53479'),
  set('socket-set-1-2in-8-32mm','sockets','mm','Sada nástrčných hlavic 1/2" 8–32 mm (23 ks)','Socket set 1/2" 8–32 mm (23 pcs)',
    '18 hlavic 8–19, 21, 22, 24, 27, 30, 32 mm, ráčna, nástavce 125 a 250 mm, kloub, posuvná T-rukojeť.','18 sockets 8–19, 21, 22, 24, 27, 30, 32 mm, ratchet, 125 and 250 mm extensions, universal joint, sliding T-bar.',
    [...[8,9,10,11,12,13,14,15,16,17,18,19,21,22,24,27,30,32].map(s=>sk('1-2in',s)),'ratchet-1-2in','extension-bar-1-2in-125mm','extension-bar-1-2in-250mm','universal-joint-1-2in','sliding-t-bar-1-2in'],
    ['1/2"','8-32 mm','23 ks','23 pcs','hlavice','socket','ráčna','ratchet','metric'],'Composition of e.g. Gedore D 19 EMU-20 (18 sockets 8–32 mm, ratchet, 2 extensions, joint, T-bar).','https://www.kctool.com/gedore-d-19-emu-20-socket-set-1-2-23-pcs-ud-8-32-mm/'),
  set('socket-set-3-8in-sae-5-16-7-8in','sockets','in','Sada nástrčných hlavic 3/8" 5/16"–7/8" (12 ks)','SAE socket set 3/8" 5/16"–7/8" (12 pcs)',
    '10 palcových hlavic 5/16"–7/8", ráčna, nástavec 75 mm.','10 SAE sockets 5/16"–7/8", ratchet, 75 mm extension.',
    [...SAE.slice(1,11).map(f=>`socket-3-8in-${f.replace('/','-')}in`),'ratchet-3-8in','extension-bar-3-8in-75mm'],
    ['3/8"','5/16"-7/8"','SAE','imperial','palcový','12 ks','12 pcs','socket','ratchet'],'Common 3/8" SAE composition (5/16"–7/8") with ratchet and extension.'),
  set('socket-set-1-4-1-2in-4-32mm','sockets','mm','Kombinovaná sada hlavic 1/4" + 1/2" 4–32 mm (34 ks)','Combined socket set 1/4" + 1/2" 4–32 mm (34 pcs)',
    '1/4": 12 hlavic 4–14 mm, ráčna, nástavce 50/100 mm, adaptér na bity; 1/2": 15 hlavic 10–19, 22, 24, 27, 30, 32 mm, ráčna, nástavce 125/250 mm. Bity, svíčkové hlavice a kufr prodávaných sad nejsou započítány.',
    '1/4": 12 sockets 4–14 mm, ratchet, 50/100 mm extensions, bit adapter; 1/2": 15 sockets 10–19, 22, 24, 27, 30, 32 mm, ratchet, 125/250 mm extensions. Bits, spark-plug sockets and case of commercial sets not counted.',
    [...[4,5,5.5,6,7,8,9,10,11,12,13,14].map(s=>sk('1-4in',s)),'ratchet-1-4in','extension-bar-1-4in-50mm','extension-bar-1-4in-100mm','bit-adapter-1-4in',
     ...[10,11,12,13,14,15,16,17,18,19,22,24,27,30,32].map(s=>sk('1-2in',s)),'ratchet-1-2in','extension-bar-1-2in-125mm','extension-bar-1-2in-250mm'],
    ['1/4"','1/2"','4-32 mm','34 ks','34 pcs','hlavice','socket','ráčna','ratchet','metric'],'Core of the common combined 1/4" + 1/2" workshop case (often sold as 90–100+ pieces including bits); only items needing a pocket are listed.'),
  set('bit-set-25mm-with-holder','sockets','mm','Sada bitů 25 mm s držákem (11 ks)','Bit set 25 mm with holder (11 pcs)',
    'Magnetický držák a 10 bitů 25 mm (typy hrotů libovolné).','Magnetic holder and 10 bits 25 mm (any tip types).',
    ['bit-holder-1-4in',...Array(10).fill('bit-25mm-c6-3')],['1/4"','25 mm','bit','bity','11 ks','11 pcs','holder','držák'],'Common 10-bit + holder composition; bit tip types are not distinguished in the outline.'),
  /* ---------- screwdrivers ---------- */
  set('screwdriver-set-sl-ph-6pcs','screwdrivers','mm','Sada šroubováků plochý + PH (6 ks)','Screwdriver set slotted + Phillips (6 pcs)',
    'Plochý 3×80, 4×100, 5,5×125, 6,5×150; PH1×80, PH2×100.','Slotted 3×80, 4×100, 5.5×125, 6.5×150; PH1×80, PH2×100.',
    [sl(3,80),sl(4,100),sl(5.5,125),sl(6.5,150),'screwdriver-ph1x80','screwdriver-ph2x100'],['SL','PH','6 ks','6 pcs','šroubovák','screwdriver','Phillips','křížový'],'Composition of e.g. Wera Kraftform Plus 334/6.','https://www.klium.com/en/wera-334-6-screwdriver-set-kraftform-plus-laser-tip-in-holder-6-piece-05105650001-70447'),
  set('screwdriver-set-sl-ph0-6pcs','screwdrivers','mm','Sada šroubováků plochý + PH0–PH2 (6 ks)','Screwdriver set slotted + PH0–PH2 (6 pcs)',
    'Plochý 3×100, 4×100, 5,5×125; PH0×60, PH1×80, PH2×100.','Slotted 3×100, 4×100, 5.5×125; PH0×60, PH1×80, PH2×100.',
    [sl(3,100),sl(4,100),sl(5.5,125),'screwdriver-ph0x60','screwdriver-ph1x80','screwdriver-ph2x100'],['SL','PH','6 ks','6 pcs','šroubovák','screwdriver','Phillips','křížový'],'Composition of e.g. Wiha 30292 (SL 3/4/5.5, PH0/1/2).','https://www.wihatools.com/products/esd-safe-softfinish-slotted-phillips-screwdriver-6pc-set'),
  set('screwdriver-set-sl-pz-6pcs','screwdrivers','mm','Sada šroubováků plochý + PZ (6 ks)','Screwdriver set slotted + Pozidriv (6 pcs)',
    'Plochý 3×100, 4×100, 5,5×125, 6,5×150; PZ1×80, PZ2×100.','Slotted 3×100, 4×100, 5.5×125, 6.5×150; PZ1×80, PZ2×100.',
    [sl(3,100),sl(4,100),sl(5.5,125),sl(6.5,150),'screwdriver-pz1x80','screwdriver-pz2x100'],['SL','PZ','6 ks','6 pcs','šroubovák','screwdriver','Pozidriv'],'Common 6-piece slotted + Pozidriv composition.'),
  set('screwdriver-set-sl-ph-pz-7pcs','screwdrivers','mm','Sada šroubováků plochý + PH + PZ (7 ks)','Screwdriver set slotted + PH + PZ (7 pcs)',
    'Plochý 3×100, 4×100, 5,5×125, 6,5×150; PH1×80, PH2×100; PZ2×100.','Slotted 3×100, 4×100, 5.5×125, 6.5×150; PH1×80, PH2×100; PZ2×100.',
    [sl(3,100),sl(4,100),sl(5.5,125),sl(6.5,150),'screwdriver-ph1x80','screwdriver-ph2x100','screwdriver-pz2x100'],['SL','PH','PZ','7 ks','7 pcs','šroubovák','screwdriver'],'Common 7-piece mixed composition.'),
  /* ---------- pliers ---------- */
  set('pliers-set-3pcs','pliers','mm','Sada kleští (3 ks)','Pliers set (3 pcs)',
    'Kombinované 180 mm, půlkulaté 200 mm, boční štípací 160 mm.','Combination 180 mm, long-nose 200 mm, diagonal cutters 160 mm.',
    ['combination-pliers-180mm','long-nose-pliers-200mm','diagonal-cutters-160mm'],['3 ks','3 pcs','kleště','pliers'],'Composition of e.g. Knipex 00 20 11 assembly pack (180/200/160 mm).','https://www.drapertools.com/product/33778/knipex-00-20-11-pliers-assembly-pack-3-piece/'),
  set('pliers-set-4pcs','pliers','mm','Sada kleští se SIKO (4 ks)','Pliers set with water-pump pliers (4 pcs)',
    'Kombinované 180 mm, půlkulaté 200 mm, boční štípací 160 mm, instalatérské SIKO 250 mm.','Combination 180 mm, long-nose 200 mm, diagonal 160 mm, water-pump 250 mm.',
    ['combination-pliers-180mm','long-nose-pliers-200mm','diagonal-cutters-160mm','water-pump-pliers-250mm'],['4 ks','4 pcs','kleště','pliers','siko'],'Common 4-piece composition (3-piece assembly set + water-pump pliers).'),
  set('pliers-set-5pcs','pliers','mm','Dílenská sada kleští (5 ks)','Workshop pliers set (5 pcs)',
    'Kombinované 200 mm, půlkulaté 200 mm, boční štípací 180 mm, SIKO 250 mm, samosvorné 250 mm.','Combination 200 mm, long-nose 200 mm, diagonal 180 mm, water-pump 250 mm, locking 250 mm.',
    ['combination-pliers-200mm','long-nose-pliers-200mm','diagonal-cutters-180mm','water-pump-pliers-250mm','locking-pliers-250mm'],['5 ks','5 pcs','kleště','pliers','siko','locking'],'Common 5-piece workshop composition.'),
  /* ---------- measuring & marking ---------- */
  set('measuring-set-4pcs','measuring','mm','Základní měřicí sada (4 ks)','Basic measuring set (4 pcs)',
    'Ocelové pravítko 300 mm, úhelník 150 mm, posuvné měřítko 150 mm, svinovací metr 5 m.','Steel rule 300 mm, try square 150 mm, caliper 150 mm, 5 m tape.',
    ['steel-rule-300mm','try-square-150mm','digital-caliper-150mm','tape-measure-5m'],['4 ks','4 pcs','měření','measuring','šuplera','metr'],'Typical basic workshop measuring kit (rule, square, caliper, tape).'),
  set('marking-set-3pcs','measuring','mm','Sada na značení (3 ks)','Marking set (3 pcs)',
    'Tužka, tesařská tužka, rýsovací jehla.','Pencil, carpenter pencil, scriber.',
    ['pencil','carpenter-pencil','scriber'],['3 ks','3 pcs','značení','marking','tužka'],'Typical marking kit.'),
  /* ---------- cutting ---------- */
  set('wood-chisel-set-4pcs','cutting','mm','Sada dlát 6–25 mm (4 ks)','Wood chisel set 6–25 mm (4 pcs)',
    'Dláta 6, 12, 18, 25 mm.','Chisels 6, 12, 18, 25 mm.',
    [6,12,18,25].map(chisel),['6-25 mm','4 ks','4 pcs','dláto','chisel'],'Composition of e.g. Stanley 5002 (0-16-129: 6, 12, 18, 25 mm).','https://www.diy.com/departments/stanley-0-16-129-bevel-edge-chisel-set-4-piece-6mm-12mm-18mm-and-25mm-sta016129/3253560161293_BQ.prd'),
  set('wood-chisel-set-6pcs','cutting','mm','Sada dlát 6–26 mm (6 ks)','Wood chisel set 6–26 mm (6 pcs)',
    'Dláta 6, 10, 12, 16, 20, 26 mm.','Chisels 6, 10, 12, 16, 20, 26 mm.',
    [6,10,12,16,20,26].map(chisel),['6-26 mm','6 ks','6 pcs','dláto','chisel'],'Composition of e.g. Narex Wood Line Profi 8530 53 (6, 10, 12, 16, 20, 26 mm).','https://www.datart.cz/sada-dlat-narex-wood-line-profi-vel-6-10-12-16-20-26.html'),
  set('utility-knife-set-2pcs','cutting','mm','Sada odlamovacích nožů 9 + 18 mm (2 ks)','Utility knife set 9 + 18 mm (2 pcs)',
    'Odlamovací nože 9 mm a 18 mm.','Snap-off knives 9 mm and 18 mm.',
    ['utility-knife-9mm','utility-knife-18mm'],['9 mm','18 mm','2 ks','2 pcs','nůž','cutter'],'Common 2-piece snap-off knife composition.'),
  /* ---------- striking ---------- */
  set('pin-punch-set-2-8mm','striking','mm','Sada vyrážečů 2–8 mm (6 ks)','Pin punch set 2–8 mm (6 pcs)',
    'Vyrážeče 2, 3, 4, 5, 6, 8 mm.','Pin punches 2, 3, 4, 5, 6, 8 mm.',
    [2,3,4,5,6,8].map(punch),['2-8 mm','6 ks','6 pcs','vyrážeč','pin punch'],'Composition of e.g. Facom 248.JS6 or Bahco 3658A/6 (2, 3, 4, 5, 6, 8 mm).','https://www.facom.com/product/248js6/long-drift-punch-set-6-pc'),
  set('pin-punch-set-3-8mm','striking','mm','Sada vyrážečů 3–8 mm (6 ks)','Pin punch set 3–8 mm (6 pcs)',
    'Vyrážeče 3, 4, 5, 6, 7, 8 mm.','Pin punches 3, 4, 5, 6, 7, 8 mm.',
    range(3,8).map(punch),['3-8 mm','6 ks','6 pcs','vyrážeč','pin punch'],'Composition of e.g. Gedore 116 A (3–8 mm, 6 pcs).','https://www.rapidonline.com/gedore-8757670-116a-pin-punch-set-3-8mm-6-piece-64-9554'),
  set('punch-set-7pcs','striking','mm','Sada vyrážečů a důlčíku (7 ks)','Pin punch and centre punch set (7 pcs)',
    'Vyrážeče 2, 3, 4, 5, 6, 8 mm a důlčík.','Pin punches 2, 3, 4, 5, 6, 8 mm and a centre punch.',
    [...[2,3,4,5,6,8].map(punch),'centre-punch'],['2-8 mm','7 ks','7 pcs','vyrážeč','důlčík','pin punch','centre punch'],'Common pin punch set extended with a centre punch.'),
  set('machinist-hammer-set-2pcs','striking','mm','Sada zámečnických kladiv 300 + 500 g (2 ks)','Machinist hammer set 300 + 500 g (2 pcs)',
    'Zámečnická kladiva 300 g a 500 g.','Cross-pein hammers 300 g and 500 g.',
    ['machinist-hammer-300g','machinist-hammer-500g'],['300 g','500 g','2 ks','2 pcs','kladivo','hammer'],'Common 2-piece machinist hammer composition.')
];
