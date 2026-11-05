// Shared loading presentation. Callers supply translated text and real progress.
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const owns=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);

function progressState(progress){
  if(progress===null||progress===undefined)return null;
  const value=typeof progress==='number'?progress:progress?.value;
  const max=typeof progress==='number'?1:progress?.max;
  if(!Number.isFinite(value)||!Number.isFinite(max)||max<=0)return null;
  return {value:Math.min(max,Math.max(0,value)),max};
}

function attributes(hooks,required){
  const safe={};
  for(const [name,value] of Object.entries(hooks||{})){
    if((name==='id'||/^(?:data|aria)-[a-z0-9_.:-]+$/i.test(name))&&value!==null&&value!==undefined)safe[name]=value;
  }
  return Object.entries({...safe,...required}).map(([name,value])=>` ${name}="${escapeHTML(value)}"`).join('');
}

/**
 * An accessible, animated loading panel, or a phrasing-only compact status.
 * Progress is either a fraction (0..1), {value,max}, or null for indeterminate.
 * Optional hooks add escaped id/data-/aria- attributes to named inner nodes.
 */
export function loadingMarkup({title='',message='',detail='',progress=null,compact=false,hooks={}}={}){
  const state=progressState(progress),tag=compact?'span':'div';
  const label=String(title||message||'');
  const percent=state?`${Math.round(state.value/state.max*100)} %`:'';
  return `<${tag} class="loading-ui loading-ui--${compact?'compact':'panel'}" data-loading-ui data-loading-determinate="${Boolean(state)}" role="status" aria-live="polite" aria-atomic="false"><span class="loading-ui__indicator" aria-hidden="true"><span class="loading-ui__orbit"></span><span class="loading-ui__core"><svg viewBox="0 0 24 24" focusable="false"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 9 8-4.5M12 12v9M4 7.5l8 4.5m-4-6.8 8 4.6"/></svg></span></span><span class="loading-ui__content"><strong class="loading-ui__title"${attributes(hooks.title,{'data-loading-title':''})}${title?'':' hidden'}>${escapeHTML(title)}</strong><span class="loading-ui__message"${attributes(hooks.message,{'data-loading-message':''})}${message?'':' hidden'}>${escapeHTML(message)}</span><span class="loading-ui__meter"><span class="loading-ui__track"><progress${attributes(hooks.progress,{'data-loading-progress':'','aria-label':label})} max="${state?.max||1}"${state?` value="${state.value}"`:''}></progress><span class="loading-ui__sweep" aria-hidden="true"></span></span><span class="loading-ui__percent"${attributes(hooks.percent,{'data-loading-percent':'','aria-hidden':'true'})}${state?'':' hidden'}>${percent}</span></span><span class="loading-ui__detail"${attributes(hooks.detail,{'data-loading-detail':''})}${detail?'':' hidden'}>${escapeHTML(detail)}</span></span></${tag}>`;
}

/** Update an existing loader in place, preserving hooks, focus and DOM identity. */
export function updateLoading(rootOrContainer,options={}){
  const root=rootOrContainer?.matches?.('[data-loading-ui]')?rootOrContainer:rootOrContainer?.querySelector?.('[data-loading-ui]');
  if(!root)return null;
  for(const field of ['title','message','detail']){
    if(!owns(options,field))continue;
    const node=root.querySelector(`[data-loading-${field}]`);
    if(node){node.textContent=String(options[field]??'');node.hidden=!node.textContent;}
  }
  const progress=root.querySelector('[data-loading-progress]');
  if(progress){
    progress.setAttribute('aria-label',root.querySelector('[data-loading-title]')?.textContent||root.querySelector('[data-loading-message]')?.textContent||'');
    if(owns(options,'progress')){
      const state=progressState(options.progress),percent=root.querySelector('[data-loading-percent]');
      root.dataset.loadingDeterminate=String(Boolean(state));
      progress.max=state?.max||1;
      if(state)progress.value=state.value;else progress.removeAttribute('value');
      if(percent){percent.textContent=state?`${Math.round(state.value/state.max*100)} %`:'';percent.hidden=!state;}
    }
  }
  if(owns(options,'compact')){
    root.classList.toggle('loading-ui--compact',Boolean(options.compact));
    root.classList.toggle('loading-ui--panel',!options.compact);
  }
  return root;
}
