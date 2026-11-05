/* Root entry only. Keep the desktop application and its data in place. */
(() => {
  'use strict';
  const current = new URL(window.location.href);
  // Capture the classic script URL synchronously; currentScript is null later
  // in promise callbacks. Resolve the unchanged desktop entry beside this file.
  const scriptURL = document.currentScript?.src || new URL('./mobile-route.js', current).href;
  const desktopURL = new URL('./app.js', scriptURL).href;
  const mobile = new URL('/mobil/', current);
  mobile.search = current.search;
  mobile.searchParams.delete('view');
  mobile.hash = current.hash;
  const choice = current.searchParams.get('view');
  const atRoot = current.pathname === '/' || current.pathname === '/index.html';
  let coarse = false;
  try { coarse = !!window.matchMedia?.('(pointer: coarse)').matches; } catch {}
  const width = Number(window.innerWidth) || document.documentElement.clientWidth;
  const touch = Number(window.navigator.maxTouchPoints) > 0 || coarse;
  const useMobile = choice === 'mobile' || (choice !== 'desktop' && width > 0 && width <= 1024 && touch);
  const ready = callback => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, {once: true});
    else callback();
  };
  const english = () => {
    const language = document.documentElement.lang || window.navigator.language || 'cs';
    return !/^(cs|sk)(-|$)/i.test(language);
  };
  const text = (cs, en) => english() ? en : cs;
  const styleButton = element => {
    Object.assign(element.style, {display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '44px', minHeight: '44px', padding: '10px 14px', border: '1px solid #ac7a29', borderRadius: '8px', background: '#edaa42', color: '#30291c', font: '600 14px system-ui, sans-serif', lineHeight: '1.4', textDecoration: 'none', cursor: 'pointer'});
    element.addEventListener('focus', () => {element.style.outline = '3px solid #2e4933'; element.style.outlineOffset = '3px';});
    element.addEventListener('blur', () => {element.style.outline = ''; element.style.outlineOffset = '';});
  };
  const showFailure = error => ready(() => {
    console.error('InsertCreator could not start.', error);
    const root = document.getElementById('app') || document.body;
    const box = document.createElement('section');
    box.dataset.mobileRouteError = '';
    box.setAttribute('role', 'alert');
    Object.assign(box.style, {maxWidth: '560px', margin: '40px auto', padding: '24px', font: '16px/1.6 system-ui, sans-serif', color: '#28342b'});
    const heading = document.createElement('h1');
    heading.textContent = text('Aplikaci se nepodařilo načíst', 'The app could not load');
    const message = document.createElement('p');
    message.textContent = text('Zkontrolujte připojení a zkuste stránku načíst znovu.', 'Check your connection and try loading the page again.');
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.dataset.mobileRouteReload = '';
    reload.textContent = text('Načíst znovu', 'Reload');
    styleButton(reload);
    reload.addEventListener('click', () => window.location.reload());
    box.append(heading, message, reload);
    root.replaceChildren(box);
  });

  if (atRoot && useMobile) {
    // Return before importing any desktop code, including when navigation is
    // asynchronous. No resize listener can bounce between the two products.
    try { window.location.replace(mobile.href); } catch (error) { showFailure(error); }
    return;
  }

  ready(() => {
    if (document.querySelector('[data-mobile-route-link]')) return;
    const link = document.createElement('a');
    link.dataset.mobileRouteLink = '';
    link.href = mobile.href;
    link.textContent = text('Mobilní verze', 'Mobile version');
    styleButton(link);
    Object.assign(link.style, {position: 'fixed', right: '12px', bottom: '12px', zIndex: '10'});
    document.body.append(link);
  });
  const loadDesktop = () => import(desktopURL);
  loadDesktop().catch(showFailure);
})();
