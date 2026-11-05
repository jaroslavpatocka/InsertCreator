// Google Analytics runs only after an explicit choice. Nothing is requested from
// Google, and no analytics cookie exists, until the visitor presses Accept.
(() => {
  'use strict';
  const ID='G-6CMM882CWH',KEY='insertcreator-mobile:analytics-consent',MAX_AGE=365*24*60*60*1000;
  const text={
    cs:{label:'Souhlas s měřením návštěvnosti',body:'Pomocí Google Analytics chceme vidět, kolik lidí aplikaci používá. Spustí se jen s vaším souhlasem. Fotky ani návrhy se neodesílají.',accept:'Přijmout',reject:'Odmítnout',more:'Zásady ochrany soukromí',page:'./privacy.html'},
    en:{label:'Consent to visitor measurement',body:'We would like to use Google Analytics to see how many people use the app. It only starts with your consent. Photos and designs are never sent.',accept:'Accept',reject:'Decline',more:'Privacy policy',page:'./privacy-en.html'}
  };
  const copy=()=>text[document.documentElement.lang==='en'?'en':'cs'];
  const read=()=>{
    try{
      const saved=JSON.parse(localStorage.getItem(KEY)||'null');
      if((saved?.choice==='granted'||saved?.choice==='denied')&&Date.now()-saved.at<MAX_AGE)return saved.choice;
    }catch{}
    return null;
  };
  const write=choice=>{try{localStorage.setItem(KEY,JSON.stringify({choice,at:Date.now()}));}catch{}};
  let loaded=false,bar=null;

  function startAnalytics(){
    window[`ga-disable-${ID}`]=false;
    if(loaded)return;loaded=true;
    window.dataLayer=window.dataLayer||[];
    window.gtag=function(){window.dataLayer.push(arguments);};
    window.gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
    window.gtag('js',new Date());
    window.gtag('config',ID,{allow_google_signals:false,allow_ad_personalization_signals:false});
    const script=document.createElement('script');script.async=true;script.src=`https://www.googletagmanager.com/gtag/js?id=${ID}`;document.head.append(script);
  }
  function stopAnalytics(){
    window[`ga-disable-${ID}`]=true;
    const host=location.hostname,parts=host.split('.'),domains=['',host,'.'+host];
    if(parts.length>2)domains.push('.'+parts.slice(-2).join('.'));
    for(const entry of document.cookie.split(';')){
      const name=entry.split('=')[0].trim();
      if(name==='_ga'||name.startsWith('_ga_'))for(const domain of domains)document.cookie=`${name}=; Max-Age=0; path=/${domain?`; domain=${domain}`:''}`;
    }
  }
  const closeBar=()=>{bar?.remove();bar=null;};
  function choose(choice){write(choice);closeBar();if(choice==='granted')startAnalytics();else stopAnalytics();}
  function showBar(){
    if(bar)return;const words=copy();
    bar=document.createElement('section');bar.className='consent-bar';bar.setAttribute('role','region');bar.setAttribute('aria-label',words.label);
    const body=document.createElement('p'),link=document.createElement('a'),actions=document.createElement('div');
    body.textContent=words.body+' ';link.href=words.page;link.textContent=words.more;link.target='_blank';link.rel='noopener';body.append(link);
    actions.className='consent-actions';
    for(const [choice,label] of [['denied',words.reject],['granted',words.accept]]){
      const button=document.createElement('button');button.type='button';button.className='btn btn-light';button.dataset.consent=choice;button.textContent=label;button.onclick=()=>choose(choice);actions.append(button);
    }
    bar.append(body,actions);document.body.append(bar);
  }
  // Wait for the app so the bar never covers the startup screen.
  function whenAppStarts(callback){
    if(document.querySelector('.app-shell'))return callback();
    const root=document.querySelector('#app');if(!root)return;
    const observer=new MutationObserver(()=>{if(document.querySelector('.app-shell')){observer.disconnect();callback();}});
    observer.observe(root,{childList:true,subtree:true});
  }
  document.addEventListener('click',event=>{if(event.target.closest?.('[data-consent-settings]')){event.preventDefault();showBar();}});
  whenAppStarts(()=>{const choice=read();if(choice==='granted')startAnalytics();else if(choice===null)showBar();});
})();
