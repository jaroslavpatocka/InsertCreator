// First-run guide. The same file runs on desktop and mobile; each app.js supplies a small host object.
// The project itself drives the guide: photo, catalogue and module flows stay untouched, and the
// guide advances only when something really arrived in the drawer, so a cancelled flow changes nothing.
import {esc,icon,toast} from './ui.js';
import {t as tr,plural,getLang,LANGS,LANG_NAMES} from './i18n.js';
import {readLocal,writeLocal} from './model.js';
import {UNITS,fmtLen,getAppUnit,inputValue,parseLength} from './units.js';

const KEY='suplik-studio-start-guide';
const STEPS=['welcome','drawer','tools','arrange','check','export'];
const FULL=new Set(['welcome','drawer','tools']);
const PROGRESS=[['drawer','Šuplík'],['tools','Nástroje'],['arrange','Rozložení'],['check','Kontrola'],['export','Výroba']];
const contentCount=p=>p.tools.length+p.modules.length;

// Earlier versions opened a generated sample on first run and stored it. Only a complete match
// counts as "nothing made yet": any name, setting or shape that differs keeps the project, and a
// sample stored in another language stays too. When in doubt the project is never removed.
const fingerprint=({id,updatedAt,...project})=>JSON.stringify(project);
const seededTool=({x,y,moduleId,...tool})=>JSON.stringify(tool);
export const isUntouchedDemo=(project,demo)=>fingerprint(project)===fingerprint(demo);
export function withoutDemoTools(library,demo){
  const seeded=new Set(demo.tools.map(seededTool));
  return library.filter(tool=>!seeded.has(seededTool(tool)));
}

/** People who already have work never see the guide unless they ask for it. */
export function initialGuideState(saved,hasWork){
  if(saved?.status==='done')return{status:'done'};
  if(saved?.status==='active'&&STEPS.includes(saved.step))return{status:'active',step:saved.step,baseline:Number(saved.baseline)||0,projectId:saved.projectId||''};
  return hasWork?{status:'done'}:{status:'active',step:'welcome',baseline:0,projectId:''};
}
/** Next state after the project changed. Returns the same object when nothing has to move. */
export function reconcileGuide(state,{id,count}){
  if(state.status!=='active')return state;
  const rebased={...state,projectId:id,baseline:count};
  if(!state.projectId)return rebased;
  if(state.projectId!==id)return count?{status:'done'}:{...rebased,step:FULL.has(state.step)?state.step:'tools'};
  if(state.step==='welcome')return count?{status:'done'}:state;
  if(FULL.has(state.step))return count>state.baseline?{...rebased,step:'arrange'}:count<state.baseline?rebased:state;
  return count?state:{...rebased,step:'tools'};
}

function progress(step){
  const current=PROGRESS.findIndex(([id])=>id===step);
  return `<ol class="start-guide-progress">${PROGRESS.map(([id,label],i)=>`<li class="${i<current?'is-done':i===current?'is-current':''}"${i===current?' aria-current="step"':''}><span>${i<current?icon('check'):i+1}</span><b>${esc(tr(label))}</b></li>`).join('')}</ol>`;
}
const skipButton=()=>`<button type="button" class="start-guide-skip" data-guide="skip">${esc(tr('Přeskočit průvodce'))}</button>`;
const choice=(action,glyph,title,text,primary=false)=>`<button type="button" class="start-guide-choice${primary?' is-primary':''}" data-guide="${action}"><span class="start-guide-choice-icon">${icon(glyph)}</span><span><strong>${esc(tr(title))}</strong><small>${esc(tr(text))}</small></span>${icon('chevron')}</button>`;
const heading=(title,text)=>`<h2 id="start-guide-title" tabindex="-1">${esc(tr(title))}</h2><p class="start-guide-lead">${esc(tr(text))}</p>`;

// Language comes first and keeps both names, so someone who cannot read the current one still finds it.
const segment=(kind,label,options,current)=>`<div class="start-guide-pref"><span class="start-guide-pref-label" id="start-guide-${kind}">${esc(label)}</span><div class="start-guide-segment" role="group" aria-labelledby="start-guide-${kind}">${options.map(([value,text,lang])=>`<button type="button" data-guide="${kind}" data-value="${value}" aria-pressed="${value===current}"${lang?` lang="${lang}"`:''}>${esc(text)}</button>`).join('')}</div></div>`;
const UNIT_NAMES={mm:'Milimetry (mm)',in:'Palce (in)'};
function welcomeStep(hasProjects){
  const prefs=segment('lang','Jazyk / Language',LANGS.map(lang=>[lang,LANG_NAMES[lang],lang]),getLang())+segment('unit',tr('Jednotky'),UNITS.map(u=>[u,tr(UNIT_NAMES[u])]),getAppUnit());
  return `<div class="start-guide-body">${heading('Vítejte v InsertCreatoru','Za pár minut navrhnete vložku do šuplíku přesně na své nářadí. Nejdřív si nastavte jazyk a jednotky, obojí půjde později změnit.')}<div class="start-guide-prefs">${prefs}</div><p class="start-guide-question">${esc(tr('Co chcete udělat?'))}</p><div class="start-guide-choices">${choice('start','plus','Vytvořit nový šuplík','Provedeme vás krok za krokem: rozměry, nástroje a výroba.',true)}${choice('open-existing','upload','Upravit existující šuplík',hasProjects?'Otevřete uložený šuplík nebo soubor JSON.':'Otevřete uložený projekt ze souboru JSON.')}</div></div><div class="start-guide-foot"><span></span>${skipButton()}</div>`;
}
function drawerStep(project){
  const u=getAppUnit(),field=(label,key,value)=>`<label class="field"><span>${esc(tr(label))} (${u})</span><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" name="${key}" data-mm="${value}" value="${esc(inputValue(value,{unit:u}))}"></label>`;
  return `<form data-guide-form novalidate><div class="start-guide-body">${progress('drawer')}${heading('Změřte šuplík','Stačí vnitřní rozměry. Vložka se do nich vejde a kdykoli je můžete změnit.')}<label class="field"><span>${esc(tr('Název šuplíku'))}</span><input type="text" autocomplete="off" name="name" maxlength="100" value="${esc(project.name)}"></label><div class="fields-row">${field('Vnitřní šířka','width',project.width)}${field('Vnitřní hloubka','height',project.height)}</div>${field('Výška inzertu','insertHeight',project.insertHeight)}<p class="muted-note">${esc(tr('Vložka nesmí být vyšší než volné místo v zavřeném šuplíku.'))} ${esc(tr('Lze zadat i jiné jednotky: 12 in, 3 1/2" nebo 30 cm.'))}</p><p class="start-guide-error" role="alert" hidden></p></div><div class="start-guide-foot"><button type="button" class="btn btn-light" data-guide="back">${esc(tr('Zpět'))}</button><span class="start-guide-actions"><button type="button" class="btn btn-light" data-guide="later">${esc(tr('Doplním později'))}</button><button type="submit" class="btn btn-primary">${esc(tr('Pokračovat'))}</button></span></div></form>`;
}
function toolsStep(project){
  const more=contentCount(project)>0;
  return `<div class="start-guide-body">${progress('tools')}${heading(more?'Přidejte další nástroje':'Jak chcete přidat nástroje?',more?'Vyberte, odkud další nástroje přijdou.':'Vyberte jednu možnost. Ostatní můžete použít později a kombinovat je.')}<div class="start-guide-choices">${choice('add-photo','camera','Vyfotit nářadí','Položte ho na A4 nebo k pravítku a obrysy najdeme automaticky.',true)}<details class="ui-disclosure start-guide-options" data-start-guide-section="sources"><summary>${esc(tr('Katalog a vlastní moduly'))}</summary><div class="ui-disclosure-body start-guide-choices">${choice('add-catalog','folder','Vybrat z katalogu','Hotové obrysy běžného nářadí, bez focení.')}${choice('add-module','grid','Vytvořit modul','Prázdný modul, přihrádka nebo kapsa se známým rozměrem.')}</div></details></div></div><div class="start-guide-foot"><button type="button" class="btn btn-light" data-guide="${more?'arrange':'back'}">${esc(tr('Zpět'))}</button>${skipButton()}</div>`;
}
function coachContent(step,project,issues){
  const tools=project.tools.length,summary=tools?plural(tools,['{n} nástroj','{n} nástroje','{n} nástrojů']):plural(project.modules.length,['{n} modul','{n} moduly','{n} modulů']);
  const button=(action,label,kind='light')=>`<button type="button" class="btn btn-${kind}" data-guide="${action}">${esc(tr(label))}</button>`;
  if(step==='arrange')return{title:'Rozmístěte nástroje',text:tr('V šuplíku máte {summary}.',{summary})+' '+tr(tools>1?'Přetáhněte je, nebo je nechte rozložit automaticky.':tools?'Přidejte další, nebo pokračujte.':'Přidejte nástroje, nebo pokračujte.'),actions:button('more','Přidat další')+(tools>1?button('layout','Rozložit nástroje'):'')+button('next','Pokračovat','primary')};
  if(step==='check')return{title:'Zkontrolujte vložku ve 3D',text:tr('Otáčejte modelem a podívejte se na kapsy a hloubku.')+(issues?' '+tr('Návrh má upozornění k vyřešení: {count}.',{count:issues}):''),actions:button('back','Zpět')+button('next','Pokračovat','primary')};
  return{title:'Připraveno k výrobě',text:tr('Než vytisknete celou vložku, ověřte rozměry na PDF v měřítku 1:1.'),actions:button('back','Zpět')+button('export','Exportovat','primary')};
}

export function createStartGuide(host){
  let state=null,painted='',root=null;
  const save=()=>writeLocal(KEY,state);
  const isOpen=()=>state?.status==='active'&&FULL.has(state.step);
  const modalOpen=()=>!!document.querySelector('#modal-root')?.children.length;
  const ensureRoot=()=>{
    if(root?.isConnected)return root;
    root=document.createElement('div');root.id='start-guide-root';
    root.addEventListener('click',onClick);root.addEventListener('submit',onSubmit);
    const app=document.querySelector('#app');if(app)app.after(root);else document.body.append(root);
    return root;
  };
  function paint(){
    const project=host.project(),active=state?.status==='active',full=isOpen(),issues=active&&!full?host.issues():0;
    const key=active?[state.step,getLang(),...(full?[contentCount(project)>0,getAppUnit(),host.hasWork()]:[project.tools.length,project.modules.length,issues])].join('|'):'';
    document.documentElement.classList.toggle('start-guide-open',full);document.querySelector('#app')?.toggleAttribute('inert',full);
    if(key===painted)return;
    const stepChanged=key.split('|')[0]!==painted.split('|')[0];painted=key;
    const target=ensureRoot();
    if(!active){target.innerHTML='';return;}
    if(full){
      const body=state.step==='welcome'?welcomeStep(host.hasWork()):state.step==='drawer'?drawerStep(project):toolsStep(project);
      target.innerHTML=`<div class="start-guide" role="dialog" aria-modal="true" aria-labelledby="start-guide-title"><section class="start-guide-card">${body}</section></div>`;
      if(stepChanged&&!modalOpen())(target.querySelector('input')||target.querySelector('h2'))?.focus();
      return;
    }
    const {title,text,actions}=coachContent(state.step,project,issues);
    target.innerHTML=`<section class="start-coach" aria-labelledby="start-coach-title"><button type="button" class="icon-btn start-coach-close" data-guide="skip" aria-label="${esc(tr('Přeskočit průvodce'))}">${icon('close')}</button><details class="start-coach-details ui-disclosure" data-start-guide-section="coach"><summary><h2 id="start-coach-title">${esc(tr(title))}</h2></summary><div class="ui-disclosure-body">${progress(state.step)}<p>${esc(text)}</p></div></details><div class="start-coach-actions">${actions}</div></section>`;
  }
  function go(step){const project=host.project();state={status:'active',step,baseline:contentCount(project),projectId:project.id};save();paint();}
  function finish({skipped=false}={}){state={status:'done'};save();paint();if(skipped)toast(tr('Průvodce kdykoli spustíte v nápovědě.'));}
  function onClick(event){
    const button=event.target.closest?.('[data-guide]');if(!button)return;
    const action=button.dataset.guide,step=state?.step;
    if(action==='skip')return finish({skipped:true});
    if(action==='start')return go('drawer');
    if(action==='lang'||action==='unit'){
      const value=button.dataset.value;host.run(action==='lang'?'set-lang':'set-unit',value);paint();
      root?.querySelector(`[data-guide="${action}"][data-value="${value}"]`)?.focus();return;
    }
    if(action==='open-existing')return host.run(host.hasWork()?'projects':'import-json');
    if(action==='later')return go('tools');
    if(action==='add-photo')return host.run('capture');
    if(action==='add-catalog')return host.run('catalog');
    if(action==='add-module')return host.run('add-shape');
    if(action==='more')return go('tools');
    if(action==='arrange')return go('arrange');
    if(action==='layout')return host.run('smart-layout');
    if(action==='next'){if(step==='arrange'){go('check');host.run('3d');}else go('export');return;}
    if(action==='back'){
      if(step==='drawer')return go('welcome');
      if(step==='tools')return go('drawer');
      if(step==='check'){go('arrange');host.run('2d');return;}
      return go('check');
    }
    if(action==='export'){finish();host.run('export');}
  }
  function onSubmit(event){
    event.preventDefault();
    const form=event.target,error=form.querySelector('.start-guide-error'),u=getAppUnit(),values={name:form.elements.name.value.trim()};
    for(const input of form.querySelectorAll('input'))input.removeAttribute('aria-invalid');
    const fail=(input,message)=>{error.textContent=message;error.hidden=false;input.setAttribute('aria-invalid','true');input.focus();};
    for(const [key,min,max] of [['width',42,3000],['height',42,3000],['insertHeight',3,100]]){
      const input=form.elements[key],mm=input.value===input.defaultValue?Number(input.dataset.mm):parseLength(input.value,u);
      if(!Number.isFinite(mm))return fail(input,tr('Zadejte platnou délku, například 12, 12,5 mm nebo 3 1/2 in.'));
      if(mm<min-.02||mm>max+.02)return fail(input,tr('Zadejte hodnotu od {min} do {max}.',{min:fmtLen(min,{unit:u}),max:fmtLen(max,{unit:u})}));
      values[key]=Math.min(max,Math.max(min,Math.round(mm*1e4)/1e4));
    }
    host.applyDrawer(values);go('tools');
  }
  document.addEventListener('keydown',event=>{
    if(!isOpen()||modalOpen()||event.defaultPrevented)return;
    if(event.key==='Escape'){event.preventDefault();finish({skipped:true});return;}
    if(event.key!=='Tab')return;
    const targets=[...root.querySelectorAll('button,input,summary'),...document.querySelectorAll('.consent-bar a,.consent-bar button')].filter(item=>!item.disabled&&item.getClientRects().length);if(!targets.length)return;
    const inside=root.contains(document.activeElement)||targets.includes(document.activeElement);
    if(!inside){event.preventDefault();targets[0].focus();}
    else if(event.shiftKey&&document.activeElement===targets[0]){event.preventDefault();targets.at(-1).focus();}
    else if(!event.shiftKey&&document.activeElement===targets.at(-1)){event.preventDefault();targets[0].focus();}
  });
  return{
    /** Called at the end of every render. The first call decides whether this visitor needs the guide. */
    sync(){
      const project=host.project();
      const booting=!state;
      if(booting){state=initialGuideState(readLocal(KEY,null),host.hasWork());save();}
      const next=reconcileGuide(state,{id:project.id,count:contentCount(project)});
      if(next!==state){state=next;save();}
      paint();
      if(booting&&state.step==='check')host.run('3d');
    },
    restart(){go(contentCount(host.project())?'tools':'welcome');},
    /** The next project continues this walk, e.g. tools that needed a bigger new drawer. */
    follow(id){if(state?.status==='active'){state={...state,projectId:id};save();}},
    /** The full-screen steps own the keyboard, so editor shortcuts cannot change hidden work. */
    get blocking(){return isOpen();},
    get step(){return state?.status==='active'?state.step:null;}
  };
}
