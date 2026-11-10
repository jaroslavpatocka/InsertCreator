import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';

const win=new Window({url:'http://localhost:5173'});
for(const key of ['window','document','localStorage'])globalThis[key]=key==='window'?win:win[key];
globalThis.requestAnimationFrame=callback=>setTimeout(callback,0);
const {mountCaptureGuide}=await import('../dist/capture-guide.js');
const {createStartGuide}=await import('../dist/start-guide.js');
const {setLang}=await import('../dist/i18n.js');
const {setAppUnit}=await import('../dist/units.js');
const {blankProject,writeLocal}=await import('../dist/model.js');
const $=selector=>win.document.querySelector(selector);
function input(selector,value){const field=$(selector);field.value=value;field.dispatchEvent(new win.Event('input',{bubbles:true}));}
function fixture(items=[{name:'Pliers',checked:true},{name:'Driver',checked:true}]){
  win.document.body.innerHTML='<div id="app"></div><div id="modal-root"></div><div id="toast"></div><div id="guide"></div>';
  const host=$('#guide'),updates=[],resizes=[];
  const guide=mountCaptureGuide({host,items,getDepth:()=> '10',getMaxDepth:()=>30,getPocketMargin:()=>.8,getDimensions:()=>({length:100,width:20}),onUpdate:(index,patch)=>updates.push({index,patch}),onResize:(index,changes)=>resizes.push({index,changes})});
  guide.open();return{host,guide,items,updates,resizes};
}

test('capture groups preserve an intentional opening and edits during review and relabeling',async()=>{
  setLang('cs',{save:false});setAppUnit('mm',{save:false});
  const {host,guide,items}=fixture();
  try{
    const sections=[...host.querySelectorAll('[data-guide-section]')];
    assert.equal(sections.length,3);assert.ok(sections.every(section=>!section.open));
    for(const selector of ['#capture-guide-name','#capture-guide-include','#capture-guide-next','#capture-guide-prev','#capture-guide-preview'])assert.equal($(selector).closest('details'),null,selector+' is available without opening settings');
    const pocket=$('#capture-guide-depth').closest('details');
    assert.equal($('#capture-guide-margin').closest('details'),pocket);
    assert.equal($('#capture-guide-wall-type').closest('details'),pocket);
    assert.equal($('#capture-guide-size-label').closest('details'),$('#capture-guide-category').closest('details'));
    pocket.open=true;input('#capture-guide-depth','12');input('#capture-guide-name','My pliers');
    $('#capture-guide-next').click();
    assert.equal($('.capture-guide-panel').dataset.guideIndex,'1');
    assert.equal($('#capture-guide-depth').closest('details').open,true,'the user can review the same setting on the next tool');
    assert.equal($('#capture-guide-size-label').closest('details').open,false,'unopened secondary settings stay folded');
    $('#capture-guide-prev').click();
    assert.equal($('#capture-guide-name').value,'My pliers');assert.equal($('#capture-guide-depth').value,'12');
    setLang('en',{save:false});
    assert.equal($('#capture-guide-depth').closest('details').open,true);
    assert.equal($('#capture-guide-depth').value,'12');
    assert.match(host.textContent,/Pocket depth, clearance and walls/);
    assert.match(host.textContent,/Size label and category/);
    assert.equal(items[0].depth,'12');
  }finally{guide.destroy();setLang('cs',{save:false});}
});

test('validation opens only the relevant settings and focuses its invalid field',()=>{
  const {guide}=fixture([{name:'Pliers',checked:true,depth:'invalid'}]);
  try{
    assert.equal($('#capture-guide-depth').closest('details').open,false);
    $('#capture-guide-next').click();
    assert.equal($('#capture-guide-depth').closest('details').open,true);
    assert.equal(document.activeElement,$('#capture-guide-depth'));
    assert.equal($('#capture-guide-depth').getAttribute('aria-invalid'),'true');
    assert.equal($('#capture-guide-size-label').closest('details').open,false);
    assert.equal($('#capture-guide-error').hidden,false);
    input('#capture-guide-depth','10');
    assert.equal($('#capture-guide-depth').hasAttribute('aria-invalid'),false);
  }finally{guide.destroy();}
});

test('unapplied dimensions are revealed before review can advance',async()=>{
  const {guide,resizes}=fixture();
  try{
    const dimensions=$('#capture-guide-length').closest('details');
    dimensions.open=true;input('#capture-guide-length','110');dimensions.open=false;
    $('#capture-guide-next').click();
    assert.equal($('.capture-guide-panel').dataset.guideIndex,'0');
    assert.equal(dimensions.open,true);
    assert.equal(document.activeElement,$('#capture-guide-resize'));
    $('#capture-guide-resize').click();await Promise.resolve();await Promise.resolve();
    assert.deepEqual(resizes,[{index:0,changes:{length:110}}]);
    $('#capture-guide-next').click();assert.equal($('.capture-guide-panel').dataset.guideIndex,'1');
  }finally{guide.destroy();}
});

test('start guide keeps main actions available and folds alternative sources and coach advice',()=>{
  win.document.body.innerHTML='<div id="app"></div><div id="modal-root"></div><div id="toast"></div>';
  writeLocal('suplik-studio-start-guide',null);
  const project=blankProject(),runs=[];
  const guide=createStartGuide({project:()=>project,hasWork:()=>false,issues:()=>0,run:(...args)=>runs.push(args),applyDrawer:()=>{}});
  guide.sync();
  assert.ok($('[data-guide="lang"]'));assert.ok($('[data-guide="unit"]'));
  $('[data-guide="start"]').click();$('[data-guide="later"]').click();
  assert.equal(guide.step,'tools');
  assert.equal($('[data-guide="add-photo"]').closest('details'),null);
  const sources=$('[data-guide="add-catalog"]').closest('details');
  assert.equal(sources.open,false);assert.equal($('[data-guide="add-module"]').closest('details'),sources);
  sources.open=true;$('[data-guide="add-catalog"]').click();assert.deepEqual(runs.at(-1),['catalog']);
  project.tools.push({id:'tool'});guide.sync();
  assert.equal(guide.step,'arrange');assert.equal($('.start-coach-details').open,false);
  assert.equal($('[data-guide="next"]').closest('details'),null);
  $('[data-guide="next"]').click();assert.equal(guide.step,'check');assert.deepEqual(runs.at(-1),['3d']);
  $('[data-guide="skip"]').click();assert.equal(guide.blocking,false);
});

test.after(async()=>{await win.happyDOM.close();});
