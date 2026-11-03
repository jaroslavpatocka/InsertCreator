import test from 'node:test';
import assert from 'node:assert/strict';
import {exportFitPDF,fitSheetPages} from '../dist/fit-sheet.js';
import {createDemoProject} from '../dist/geometry.js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

test('PDF opens as six actual A4 pages, disables automatic scale and contains a 100mm gauge',async()=>{
  const p=createDemoProject(),bytes=exportFitPDF(p),pdf=await pdfjs.getDocument({data:bytes,useSystemFonts:true}).promise;
  assert.equal(pdf.numPages,6);assert.equal((await pdf.getViewerPreferences()).PrintScaling,'None');
  const page=await pdf.getPage(1);assert.ok(Math.abs(page.view[2]*25.4/72-210)<.0001);assert.ok(Math.abs(page.view[3]*25.4/72-297)<.0001);
  const text=(await page.getTextContent()).items.map(i=>i.str).join(' ');assert.match(text,/100 mm/);assert.match(text,/83.5 x 167.5 mm/);
  const source=new TextDecoder().decode(exportFitPDF(p));
  // The independently parsed PDF retains both the mm drawing transform and exact gauge endpoints.
  assert.match(source,/2\.83465 0 0 -2\.83465/);
  const gauge=source.match(/0\.5 w ([\d.]+) ([\d.]+) m ([\d.]+) \2 l S/);assert.ok(gauge);
  assert.ok(Math.abs((+gauge[3]-+gauge[1])*25.4/72-100)<.0001);
  await pdf.destroy();
});

test('large modules tile at 1:1 with 5mm overlap and never shrink to a page',async()=>{
  const p={...createDemoProject(),tools:[],modules:[{id:'large',name:'Large',x:0,y:0,width:420,height:294}]};
  const tiles=fitSheetPages(p);assert.equal(tiles.length,6);assert.deepEqual(tiles.map(p=>[p.x,p.y]),[[0,0],[185,0],[370,0],[0,235],[185,235],[370,235]]);
  const pdf=await pdfjs.getDocument({data:exportFitPDF(p)}).promise;assert.equal(pdf.numPages,6);await pdf.destroy();
});

test('fit PDF refuses invalid layouts and cannot silently exclude unplaced tools',()=>{
  const p=createDemoProject();p.tools.push({...p.tools[0],id:'waiting',moduleId:null,x:600});assert.throws(()=>exportFitPDF(p));
  assert.equal(fitSheetPages(p,{moduleId:p.modules[0].id}).length,1);
});

test('fit PDF labels follow language and unit while the drawing and gauge stay 1:1 metric',async()=>{
  const {setLang}=await import('../dist/i18n.js'),{setAppUnit}=await import('../dist/units.js');
  const p=createDemoProject(),metric=new TextDecoder().decode(exportFitPDF(p));
  setLang('en',{save:false});setAppUnit('in',{save:false});
  try{
    const bytes=exportFitPDF(p),source=new TextDecoder().decode(bytes);
    assert.ok(/^[\x00-\x7f]*$/.test(source),'PDF text must be ASCII for the standard Helvetica font');
    for(const label of ['1:1 SIZE CHECK','exactly 100 mm, ticks every 1 in','clearance 0.031 in','tile 1,1 of 1 x 1','3.287 x 6.594 in'])assert.ok(source.includes(label),label);
    // Same pocket geometry as the metric sheet; only labels and the inch ticks differ.
    const drawing=s=>s.match(/cm\n0 0 190 240 re W n\n[\s\S]*?Q\n/g);assert.deepEqual(drawing(source),drawing(metric));
    const gauge=source.match(/0\.5 w ([\d.]+) ([\d.]+) m ([\d.]+) \2 l S/);assert.ok(Math.abs((+gauge[3]-+gauge[1])*25.4/72-100)<.0001);
    const ticks=[...source.matchAll(/0\.3 w ([\d.]+) /g)].slice(0,3).map(m=>+m[1]*25.4/72-10);
    ticks.forEach((x,i)=>assert.ok(Math.abs(x-25.4*(i+1))<.0001));
    const pdf=await pdfjs.getDocument({data:bytes,useSystemFonts:true}).promise;
    const text=(await (await pdf.getPage(1)).getTextContent()).items.map(i=>i.str).join(' ');assert.match(text,/Print: A4/);await pdf.destroy();
  }finally{setLang('cs',{save:false});setAppUnit('mm',{save:false});}
});
