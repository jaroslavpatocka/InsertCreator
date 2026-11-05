// Desktop hosting overlay based on verified live sw.js; original asset list preserved.
const CACHE='insertcreator-v51-mobile-route';
const ASSETS=['./','./index.html','./style.css','./loading-ui.css','./loading-ui.js','./app.js','./manufacturing-client.js','./manufacturing-worker.js','./print-batch.js','./manufacturing-coordinates.js','./magnet-pockets.js','./joint-fit.js','./tool-dimensions.js','./editor-cache.js','./context-menu.js','./module-footprint.js','./print-material.js','./three-mf.js','./preview-mesh.js','./preview-live.js','./webgl-preview.js','./mesh-client.js','./mesh-worker.js','./space-layout.js','./gridfinity-baseplate.js','./ruler-calibration.js','./capture.js','./capture-context-menu.js','./capture-preview.js','./capture-tools.js','./capture-guide.js','./capture-guide.css','./trace.js','./contour-smoothing.js','./tool-contour.js','./functional-pocket.js','./pocket-fit-meta.js','./pocket-margin.js','./module-margin.js','./pocket-growth.js','./tool-functional-pocket.js','./auto-trace.js','./recognize.js','./recognize-worker.js','./neural.js','./neural-core.js','./neural-worker.js','./finger-grip.js','./geometry.js','./smart-layout.js','./tool-sets.js','./tool-categories.js','./photo-enhance.js','./photo-recovery.js','./contour-refine.js','./contour-shape.js','./capture-view.js','./photo-layout.js','./photo-module.js','./module-joints.js','./set-layout.js','./set-module.js','./tool-size.js','./size-labels.js','./bulk-edit.js','./module-edit.js','./smart-layout-client.js','./smart-layout-worker.js','./print-geometry.js','./preview3d.js','./view-controls.js','./fit-sheet.js','./model.js','./ui.js','./i18n.js','./units.js','./locales/en-app.js','./locales/en-capture.js','./locales/en-core.js','./catalog-ui.js','./catalog/index.js','./catalog/parametric.js','./catalog/imported.js','./catalog/sets.js','./vendor/earcut.js','./vendor/clipper.js','./fonts/dm-sans.ttf','./fonts/manrope.ttf','./icon.svg','./manifest.webmanifest','./licenses.html','./licenses-en.html','./licenses.css','./vendor/earcut.LICENSE','./vendor/clipper.LICENSE','./vendor/jsbn.LICENSE','./vendor/ort/LICENSE','./vendor/ort/ThirdPartyNotices.txt','./models/U2NET-LICENSE','./models/REMBG-LICENSE','./models/README.txt','./fonts/DM-Sans-OFL.txt','./fonts/Manrope-OFL.txt','./catalog/sources/polyhaven/LICENSE.txt','./catalog/sources/polyhaven/README.md','./catalog/sources/freecad-library/LICENSE-Assets.txt','./catalog/sources/freecad-library/README.md','./vendor/clipper.README.md','./tool-magnet.js','./tool-magnet-ui.js','./locales/en-magnet.js','./mobile-route.js'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>/^insertcreator-v\d+(?:-|$)/.test(key)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin||url.pathname==='/mobil'||url.pathname.startsWith('/mobil/'))return;
  // Clone before returning the network response; cache storage remains optional.
  const network=fetch(event.request).then(response=>({response,copy:response.ok?response.clone():null}));
  event.waitUntil(network.then(({copy})=>copy?caches.open(CACHE).then(cache=>cache.put(event.request,copy)):undefined).catch(()=>{}));
  event.respondWith(network.then(({response})=>response).catch(async error=>{
    try{const cached=await(await caches.open(CACHE)).match(event.request);if(cached)return cached;}catch{}
    throw error;
  }));
});
