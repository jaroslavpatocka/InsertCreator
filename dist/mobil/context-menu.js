// Small accessible context menu. Business actions remain owned by the editor.
let active=null;
export function closeContextMenu({restoreFocus=false}={}){active?.close(restoreFocus);}
export function openContextMenu({items,title,x=0,y=0,onAction,returnFocus}={}){
  closeContextMenu();
  const menu=document.createElement('div');menu.className='model-context-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label',title||'');
  const heading=document.createElement('div');heading.className='model-context-title';heading.textContent=title||'';menu.append(heading);
  for(const item of items||[]){
    const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitem');button.dataset.contextAction=item.action;button.textContent=item.label;button.disabled=!!item.disabled;if(item.danger)button.className='danger';menu.append(button);
  }
  document.body.append(menu);const size=menu.getBoundingClientRect(),width=window.innerWidth||1024,height=window.innerHeight||768;
  menu.style.left=Math.max(8,Math.min(Number.isFinite(x)?x:8,width-(size.width||250)-8))+'px';menu.style.top=Math.max(8,Math.min(Number.isFinite(y)?y:8,height-(size.height||320)-8))+'px';
  const controller=new AbortController(),options={signal:controller.signal,capture:true};
  const close=restore=>{controller.abort();menu.remove();if(active?.menu===menu)active=null;if(restore&&returnFocus?.isConnected)returnFocus.focus({preventScroll:true});};
  active={menu,close};
  const buttons=()=>[...menu.querySelectorAll('button:not(:disabled)')];
  menu.addEventListener('click',event=>{const button=event.target.closest('[data-context-action]');if(!button||button.disabled)return;const action=button.dataset.contextAction;close(false);onAction?.(action);});
  menu.addEventListener('keydown',event=>{
    event.stopPropagation();
    const list=buttons(),index=list.indexOf(document.activeElement);let next;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
    if(event.key==='Tab'){close(false);return;}
    if(event.key==='ArrowDown')next=(index+1)%list.length;
    else if(event.key==='ArrowUp')next=(index-1+list.length)%list.length;
    else if(event.key==='Home')next=0;else if(event.key==='End')next=list.length-1;
    if(next!==undefined){event.preventDefault();list[next]?.focus();}
  });
  document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target))close(false);},options);
  document.addEventListener('focusin',event=>{if(!menu.contains(event.target))close(false);},options);
  // Scroll inside a tall menu stays usable; moving its underlying viewport dismisses it.
  document.addEventListener('scroll',event=>{if(!menu.contains(event.target))close(false);},options);
  window.addEventListener('resize',()=>close(false),{signal:controller.signal});
  buttons()[0]?.focus({preventScroll:true});return{menu,close:()=>close(false)};
}
