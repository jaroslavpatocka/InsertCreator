import {esc,icon,openModal} from './ui.js';
import {getLang} from './i18n.js';
import {installMobileApp,installGuidance} from './mobile-platform.js';

let panel='design',detail=false,viewOptions=false;
export function toggleMobileViewOptions(){viewOptions=!viewOptions;}
export const mobileText=(cs,en)=>getLang()==='en'?en:cs;
export const isMobileScreen=()=>window.innerWidth<=1024;
export const getMobilePanel=()=>panel;
export function setMobilePanel(next,{showDetail=false}={}){
  if(['design','tools','settings'].includes(next)){panel=next;detail=showDetail;}
}
export function selectMobileDetail(){detail=true;}
export function mountMobileShell({project,selectionName,hasSelection,preferences}){
  const shell=document.querySelector('.app-shell');if(!shell)return;
  shell.dataset.mobilePanel=panel;shell.dataset.mobileDetail=String(detail);
  shell.dataset.mobileViewOptions=String(viewOptions);
  const toolbar=document.querySelector('.board-toolbar'),primary=document.createElement('div'),advanced=document.createElement('div');
  primary.className='mobile-board-primary';advanced.className='mobile-board-advanced';advanced.id='mobile-view-options';
  for(const action of ['undo','redo','move-mode','smart-layout']){const button=toolbar?.querySelector(`[data-action="${action}"]`);if(button){if(!button.hasAttribute('aria-label'))button.setAttribute('aria-label',button.textContent.trim());primary.append(button);}}
  for(const selector of ['[data-action="grid"]','[data-action="labels"]','[data-smart-shape]']){const control=toolbar?.querySelector(selector);if(control)advanced.append(control);}
  toolbar?.replaceChildren(primary,advanced);
  const options=document.createElement('button');options.className='icon-btn mobile-view-options-toggle';options.dataset.action='mobile-view-options';options.setAttribute('aria-label',mobileText('Další volby náhledu a tvar modulů','More view options and module shape'));options.setAttribute('aria-controls',advanced.id);options.setAttribute('aria-expanded',String(viewOptions));options.innerHTML=icon('more');document.querySelector('.board-footer .tool-group')?.append(options);
  const make=document.createElement('button');make.className='icon-btn mobile-export-action';make.dataset.action='export';make.setAttribute('aria-label',mobileText('Vyrobit / export','Make / export'));make.innerHTML=icon('download');document.querySelector('.workspace-header')?.append(make);
  const landscapeProject=document.createElement('span');landscapeProject.className='mobile-landscape-project';landscapeProject.textContent=project.name;landscapeProject.title=project.name;document.querySelector('.workspace-header .segmented')?.before(landscapeProject);
  const oldNav=document.querySelector('.mobile-nav');
  const item=(name,action,glyph,cs,en)=>`<button type="button" data-action="${action}" ${panel===name?'class="active" aria-current="page"':''}>${icon(glyph)}<span>${mobileText(cs,en)}</span></button>`;
  if(oldNav)oldNav.innerHTML=item('design','mobile-design','drawer','Návrh','Design')+item('tools','mobile-tools','wrench','Nástroje','Tools')+`<button type="button" class="camera-nav" data-action="capture" aria-label="${mobileText('Přidat nástroj z fotografie','Add a tool from a photo')}">${icon('camera')}<span>${mobileText('Přidat','Add')}</span></button>`+item('settings','mobile-settings','ruler','Nastavení','Settings')+item('more','mobile-more','more','Více','More');
  const actions=document.createElement('div');actions.className='mobile-design-actions';
  actions.innerHTML=`<button class="btn btn-primary" data-action="capture">${icon('camera')}${mobileText('Přidat nástroj','Add a tool')}</button><button class="btn btn-dark" data-action="export">${icon('download')}${mobileText('Vyrobit / export','Make / export')}</button>`;
  document.querySelector('.page-heading')?.after(actions);
  const heading=document.createElement('div');heading.className='mobile-panel-heading';
  heading.innerHTML=`<div><small>${esc(project.name)}</small><h2>${panel==='settings'?mobileText('Nastavení šuplíku','Drawer settings'):detail?mobileText('Vlastnosti výběru','Selection properties'):mobileText('Nástroje v sestavě','Assembly tools')}</h2></div><button class="btn btn-light" data-action="${panel==='tools'&&detail?'mobile-tools':'mobile-design'}">${icon('arrow')}${panel==='tools'&&detail?mobileText('Seznam','List'):mobileText('Návrh','Design')}</button>`;
  document.querySelector('.inspector')?.prepend(heading);
  const bar=document.createElement('div');bar.className='mobile-selection-bar';
  bar.innerHTML=hasSelection?`<div><small>${mobileText('Aktivní výběr','Active selection')}</small><strong>${esc(selectionName)}</strong></div><button class="btn btn-light" data-action="mobile-properties">${icon('edit')}${mobileText('Upravit','Edit')}</button>`:`<span>${mobileText('Klepněte na nástroj. Jedním prstem posouvejte náhled, dvěma přibližujte.','Tap a tool. Drag with one finger to pan, pinch with two to zoom.')}</span>`;
  document.querySelector('.workspace')?.after(bar);
  // A short instruction remains available even when a tool is selected.
  const hint=document.createElement('p');hint.className='mobile-gesture-hint';
  hint.textContent=document.querySelector('#board-svg')?.classList.contains('view-3d')
    ?mobileText('Jeden prst otáčí · Dva prsty posouvají a přibližují','One finger orbits · Two fingers pan and zoom')
    :mobileText('Klepnutí vybírá · Dva prsty přiblíží · Přesun zapněte tlačítkem Přesunout','Tap to select · Pinch to zoom · Enable Move to move modules');bar.after(hint);
}

export function openMobileMenu({preferences,onAction}){
  const rows=[['projects','folder','Moje šuplíky','My drawers'],['new-drawer','plus','Nový šuplík','New drawer'],['library','library','Knihovna a katalog','Library and catalog'],['save-project','save','Záloha projektu JSON','Back up project JSON'],['import-json','upload','Otevřít projekt JSON','Open project JSON'],['add-custom-module','edit','Vlastní modul s kapsou','Custom module with pocket'],['add-shape','grid','Prázdný modul','Empty module'],['export','download','Vyrobit / export','Make / export'],['help','help','Návod','Help']];
  const buttons=actions=>rows.filter(([action])=>actions.includes(action)).map(([action,glyph,cs,en])=>`<button type="button" class="btn btn-light" data-mobile-menu="${action}">${icon(glyph)}${mobileText(cs,en)}</button>`).join('');
  const group=(key,cs,en,body)=>`<details class="ui-disclosure" data-mobile-menu-group="${key}"><summary>${mobileText(cs,en)}</summary><div class="ui-disclosure-body mobile-menu">${body}</div></details>`;
  const modal=openModal({title:mobileText('Vaše mobilní dílna','Your mobile workshop'),body:`<div class="mobile-menu-groups"><div class="mobile-menu">${buttons(['export'])}</div>${group('drawers','Šuplíky','Drawers',buttons(['projects','new-drawer']))}${group('tools','Nástroje a moduly','Tools and modules',buttons(['library','add-custom-module','add-shape']))}${group('backup','Záloha a přenos projektu','Project backup and transfer',buttons(['save-project','import-json']))}${group('app','Aplikace a nápověda','App and help',`<div class="mobile-preferences"><h3>${mobileText('Jazyk a jednotky','Language and units')}</h3>${preferences}</div>${buttons(['help'])}<button type="button" class="btn btn-soft block-button" data-mobile-install>${icon('plus')}${mobileText('Přidat na plochu','Add to Home Screen')}</button><p class="muted-note">${mobileText('Samostatná mobilní verze. Návrhy zůstávají v tomto zařízení a fotky běžně zpracuje prohlížeč; jen volitelné odstranění pozadí je pošle službě na stejné adrese.','Independent mobile version. Designs stay on this device and photos are normally processed by your browser; only optional background removal sends them to a service at the same address.')}</p>`)}</div>`});
  modal.body.addEventListener('click',async event=>{
    const install=event.target.closest('[data-mobile-install]');
    if(install){
      const installed=await installMobileApp();if(!installed&&modal.el.isConnected){
        let note=modal.body.querySelector('[data-install-guidance]');if(!note){note=document.createElement('p');note.dataset.installGuidance='';note.className='tip';note.setAttribute('role','status');install.after(note);}note.textContent=installGuidance();
      }return;
    }
    const row=event.target.closest('[data-mobile-menu]'),pref=event.target.closest('[data-action]');
    if(row){modal.close();onAction(row.dataset.mobileMenu);}
    else if(pref){const action=pref.dataset.action,value=pref.dataset.value;modal.close();onAction(action,value);}
  });
}
