// Cache ownership includes registration scope, so another product on the same
// origin (or another mobile installation path) cannot be deleted or read.
const CACHE_PREFIX='insertcreator-mobile:'+encodeURIComponent(self.registration.scope)+':';
const CACHE=CACHE_PREFIX+'v5-local-photo-text';
const ASSETS=['./','./mobile.css','./mobile-platform.js','./mobile-shell.js','./icon-192.png','./icon-512.png','./icon-apple.png','./index.html','./style.css','./loading-ui.css','./loading-ui.js','./app.js','./manufacturing-client.js','./manufacturing-worker.js','./print-batch.js','./manufacturing-coordinates.js','./magnet-pockets.js','./joint-fit.js','./tool-dimensions.js','./editor-cache.js','./context-menu.js','./module-footprint.js','./print-material.js','./three-mf.js','./preview-mesh.js','./preview-live.js','./webgl-preview.js','./mesh-client.js','./mesh-worker.js','./space-layout.js','./gridfinity-baseplate.js','./ruler-calibration.js','./capture.js','./capture-context-menu.js','./capture-preview.js','./capture-tools.js','./capture-guide.js','./capture-guide.css','./trace.js','./contour-smoothing.js','./tool-contour.js','./functional-pocket.js','./pocket-fit-meta.js','./pocket-margin.js','./module-margin.js','./pocket-growth.js','./tool-functional-pocket.js','./auto-trace.js','./recognize.js','./recognize-worker.js','./neural.js','./neural-core.js','./neural-worker.js','./finger-grip.js','./geometry.js','./smart-layout.js','./tool-sets.js','./tool-categories.js','./photo-enhance.js','./photo-recovery.js','./contour-refine.js','./contour-shape.js','./capture-view.js','./photo-layout.js','./photo-module.js','./module-joints.js','./set-layout.js','./set-module.js','./tool-size.js','./size-labels.js','./bulk-edit.js','./module-edit.js','./smart-layout-client.js','./smart-layout-worker.js','./print-geometry.js','./preview3d.js','./view-controls.js','./fit-sheet.js','./model.js','./ui.js','./i18n.js','./units.js','./locales/en-app.js','./locales/en-capture.js','./locales/en-core.js','./catalog-ui.js','./catalog/index.js','./catalog/parametric.js','./catalog/imported.js','./catalog/sets.js','./vendor/earcut.js','./vendor/clipper.js','./fonts/dm-sans.ttf','./fonts/manrope.ttf','./icon.svg','./manifest.webmanifest','./licenses.html','./licenses-en.html','./licenses.css','./consent.js','./privacy.html','./privacy-en.html','./vendor/earcut.LICENSE','./vendor/clipper.LICENSE','./vendor/jsbn.LICENSE','./vendor/ort/LICENSE','./vendor/ort/ThirdPartyNotices.txt','./models/U2NET-LICENSE','./models/REMBG-LICENSE','./models/README.txt','./fonts/DM-Sans-OFL.txt','./fonts/Manrope-OFL.txt','./catalog/sources/polyhaven/LICENSE.txt','./catalog/sources/polyhaven/README.md','./catalog/sources/freecad-library/LICENSE-Assets.txt','./catalog/sources/freecad-library/README.md','./vendor/clipper.README.md','./tool-magnet.js','./tool-magnet-ui.js','./locales/en-magnet.js'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url),scope=new URL(self.registration.scope);
  if(event.request.method!=='GET'||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE).catch(()=>null);
    try{
      const response=await fetch(event.request);
      if(response.ok&&cache)try{await cache.put(event.request,response.clone());}catch{}
      return response;
    }catch{
      const cached=await cache?.match(event.request);
      if(cached)return cached;
      return new Response('Tento soubor ještě není dostupný offline. Připojte se a načtěte jej znovu.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
    }
  })());
});
