import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const ORIGIN='https://insertcreator.com';
const fail=message=>{throw Error('SEO: '+message);};
const text=html=>html.replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|#160);/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const values=source=>{
  const result={};
  for(const match of source.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g))result[match[1].toLowerCase()]=match[2]??match[3]??match[4]??'';
  return result;
};
const tags=(html,name)=>[...html.matchAll(new RegExp('<'+name+'\\b([^>]*?)>','gi'))].map(match=>values(match[1]));
const hasRel=(attrs,value)=>(attrs.rel||'').toLowerCase().split(/\s+/).includes(value);

/** Check the shipped crawl graph, including the separate mobile entry. No network required. */
export function validateSEO(projectRoot=process.cwd(),{readFile=filename=>fs.readFileSync(filename),isFile=filename=>fs.existsSync(filename)&&fs.statSync(filename).isFile()}={}){
  const dist=path.resolve(projectRoot,'dist');
  const read=relative=>{
    const filename=path.resolve(dist,relative);
    if(!isFile(filename))fail('Chybí soubor '+relative);
    return readFile(filename).toString('utf8');
  };
  const localFile=url=>{
    let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{fail('Neplatná URL '+url.href);}
    const filename=path.resolve(dist,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
    const relative=path.relative(dist,filename);
    if(relative.startsWith('..'+path.sep)||path.isAbsolute(relative))fail('Odkaz opouští web '+url.href);
    return filename;
  };
  const sitemap=read('sitemap.xml');
  if(!/xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/.test(sitemap))fail('Sitemap nemá standardní namespace.');
  const urls=[...sitemap.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map(match=>match[1].trim());
  if(!urls.length||new Set(urls).size!==urls.length)fail('Sitemap je prázdná nebo obsahuje duplicity.');
  if(!urls.includes(ORIGIN+'/')||!urls.includes(ORIGIN+'/en/'))fail('Sitemap neobsahuje obě domovské jazykové verze.');
  const robots=read('robots.txt');
  if(!/^Sitemap:\s*https:\/\/insertcreator\.com\/sitemap\.xml\s*$/mi.test(robots))fail('robots.txt neuvádí sitemap.');
  if(/^Disallow:\s*\/\s*$/mi.test(robots))fail('robots.txt blokuje celý web.');
  const titles=new Set(),descriptions=new Set(),pages=new Map();
  let structuredData=0,localLinks=0;
  function inspect(url,{mobile=false}={}){
    let address;try{address=new URL(url);}catch{fail('Neplatná URL v sitemap '+url);}
    if(address.origin!==ORIGIN||address.search||address.hash||!address.pathname.endsWith('/'))fail('Neplatná kanonická URL '+url);
    const filename=localFile(address),relative=path.relative(dist,filename);
    const html=read(relative),links=tags(html,'link'),metas=tags(html,'meta');
    if(!links.some(attrs=>hasRel(attrs,'icon')&&attrs.type==='image/png'&&attrs.sizes==='96x96'))fail('Chybí PNG favicon pro vyhledávače v '+relative);
    const canonical=links.filter(attrs=>hasRel(attrs,'canonical'));
    if(canonical.length!==1||canonical[0].href!==(mobile?ORIGIN+'/':url))fail('Nesprávná canonical URL v '+relative);
    const title=text(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');
    const descriptionsHere=metas.filter(attrs=>(attrs.name||'').toLowerCase()==='description');
    const description=descriptionsHere[0]?.content?.trim();
    if(!title||descriptionsHere.length!==1||!description)fail('Chybí jednoznačný titulek nebo popis v '+relative);
    if(!mobile){
      if(titles.has(title.toLowerCase())||descriptions.has(description.toLowerCase()))fail('Duplicitní titulek nebo popis v '+relative);
      titles.add(title.toLowerCase());descriptions.add(description.toLowerCase());
    }
    const lang=tags(html,'html')[0]?.lang;
    if(lang!==(address.pathname==='/en/'?'en':'cs'))fail('Nesprávný jazyk v '+relative);
    if(!metas.some(attrs=>attrs.name==='viewport'&&/width=device-width/.test(attrs.content||'')))fail('Chybí mobilní viewport v '+relative);
    if(metas.some(attrs=>/^(robots|googlebot)$/i.test(attrs.name||'')&&/\b(noindex|nofollow|none)\b/i.test(attrs.content||'')))fail('Stránka blokuje indexaci v '+relative);
    if([...html.matchAll(/<h1\b/gi)].length!==1)fail('Stránka musí mít jeden statický hlavní nadpis v '+relative);
    const og=metas.filter(attrs=>attrs.property==='og:url');
    if(og.length!==1||og[0].content!==(mobile?ORIGIN+'/':url))fail('Nesprávná Open Graph URL v '+relative);
    const image=metas.find(attrs=>attrs.property==='og:image')?.content;
    if(!image?.startsWith(ORIGIN+'/'))fail('Chybí absolutní lokální obrázek pro sdílení v '+relative);
    if(!isFile(localFile(new URL(image))))fail('Chybí obrázek pro sdílení v '+relative);
    const anchors=tags(html,'a').map(attrs=>attrs.href).filter(Boolean);
    for(const spec of [...anchors,...links.map(attrs=>attrs.href),...tags(html,'script').map(attrs=>attrs.src),...tags(html,'img').map(attrs=>attrs.src)].filter(Boolean)){
      if(/^(?:#|mailto:|tel:|data:|blob:)/i.test(spec))continue;
      if(/^javascript:/i.test(spec))fail('Necrawlable JavaScript odkaz v '+relative);
      let target;try{target=new URL(spec,address);}catch{fail('Neplatný odkaz '+spec+' v '+relative);}
      if(target.origin!==ORIGIN)continue;
      if(!isFile(localFile(target)))fail('Nefunkční lokální odkaz '+spec+' v '+relative);
      localLinks++;
    }
    const entities=[];
    for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
      const attrs=values(match[1]);
      if(attrs.type!=='application/ld+json')continue;
      let data;try{data=JSON.parse(match[2]);}catch{fail('Neplatné JSON-LD v '+relative);}
      if(data['@context']!=='https://schema.org')fail('JSON-LD nemá schema.org context v '+relative);
      if(/"(?:aggregateRating|review)"\s*:/.test(match[2]))fail('Neověřené hodnocení v JSON-LD '+relative);
      entities.push(...(Array.isArray(data['@graph'])?data['@graph']:[data]));
      if(mobile){
        const policy=metas.find(attrs=>(attrs['http-equiv']||'').toLowerCase()==='content-security-policy')?.content;
        const hash=createHash('sha256').update(match[2]).digest('base64');
        if(!policy?.includes("'sha256-"+hash+"'"))fail('Mobilní CSP neobsahuje přesný hash JSON-LD v '+relative);
      }
      structuredData++;
    }
    const about=html.match(/<section\b[^>]*\bclass="[^"]*\bic-about\b[^"]*"[^>]*>([\s\S]*?)<\/section>/i)?.[1];
    if(mobile||address.pathname==='/'){
      if(!about||!/<h1\b/.test(about)||/\bhidden(?:\s|=|>)/i.test(about)||/style=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(about))fail('Chybí viditelný obsah aplikace v '+relative);
      if(!/Gridfinity/.test(about)||!/STL/.test(about)||!/1:1/.test(about))fail('Chybí podstatný obsah aplikace v '+relative);
      if(!/type="application\/ld\+json"/.test(html))fail('Chybí strukturovaná data aplikace v '+relative);
    }
    const page={url,html,links,anchors,about,entities,filename};
    if(!mobile)pages.set(url,page);
    return page;
  }
  for(const url of urls)inspect(url);
  const home=pages.get(ORIGIN+'/'),english=pages.get(ORIGIN+'/en/');
  for(const page of [home,english])for(const [language,target] of [['cs',ORIGIN+'/'],['en',ORIGIN+'/en/'],['x-default',ORIGIN+'/']]){
    if(!page.links.some(attrs=>hasRel(attrs,'alternate')&&attrs.hreflang===language&&attrs.href===target))fail('Chybí obousměrné hreflang '+language+' v '+page.url);
  }
  const mobile=inspect(ORIGIN+'/mobil/',{mobile:true});
  const application=page=>page.entities.find(entity=>entity['@type']==='SoftwareApplication');
  const app=application(home);
  if(!app||app['@id']!==ORIGIN+'/#app'||app.url!==ORIGIN+'/'||Number(app.offers?.price)!==0)fail('Chybí správná identita bezplatné aplikace v JSON-LD.');
  if(JSON.stringify(app)!==JSON.stringify(application(mobile)))fail('Mobilní a desktopové JSON-LD nepopisuje stejnou aplikaci.');
  const core=about=>text(about.replace(/<nav\b[\s\S]*?<\/nav>/gi,'').replace(/<noscript\b[\s\S]*?<\/noscript>/gi,''));
  if(core(home.about)!==core(mobile.about))fail('Desktop a mobil nemají shodný podstatný veřejný obsah.');
  if(!home.links.some(attrs=>hasRel(attrs,'alternate')&&attrs.media&&attrs.href===ORIGIN+'/mobil/'))fail('Desktop neodkazuje na mobilní alternativu.');
  const seen=new Set(),queue=[ORIGIN+'/'];
  while(queue.length){
    const current=queue.shift();if(seen.has(current))continue;seen.add(current);
    for(const href of pages.get(current)?.anchors||[]){
      const linked=new URL(href,current);linked.search='';linked.hash='';
      if(pages.has(linked.href)&&!seen.has(linked.href))queue.push(linked.href);
    }
  }
  const orphaned=urls.filter(url=>!seen.has(url));
  if(orphaned.length)fail('Osiřelé stránky bez crawlable cesty z úvodu: '+orphaned.join(', '));
  const pngFile=path.join(dist,'social-preview.png');
  if(!isFile(pngFile))fail('Chybí social-preview.png.');
  const png=readFile(pngFile);
  if(!Buffer.from(png.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))||png.readUInt32BE(16)!==1200||png.readUInt32BE(20)!==630)fail('Sdílený náhled musí být PNG 1200 × 630.');
  const favicon=readFile(path.join(dist,'favicon-96.png'));
  if(!Buffer.from(favicon.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))||favicon.readUInt32BE(16)!==96||favicon.readUInt32BE(20)!==96)fail('Favicon musí být čtvercové PNG 96 × 96.');
  return{canonicalPages:urls.length,mobilePages:1,localLinks,structuredData};
}

const script=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1]).toLowerCase()===script.toLowerCase()){
  try{const result=validateSEO();console.log(`SEO: ${result.canonicalPages} kanonických stránek, mobilní alternativa, ${result.localLinks} místních odkazů a ${result.structuredData} bloků JSON-LD ověřeno.`);}catch(error){console.error(error.message);process.exitCode=1;}
}
