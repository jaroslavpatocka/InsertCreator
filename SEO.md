# Viditelnost InsertCreatoru ve vyhledávání

Veřejná kanonická doména je `https://insertcreator.com/`. Desktop uvádí mobilní alternativu `/mobil/`; mobil má canonical na hlavní adresu a stejný veřejný popis aplikace. Anglická úvodní stránka `/en/` má vlastní canonical a vzájemné jazykové odkazy s českým úvodem.

`dist/robots.txt` povoluje procházení a odkazuje na `dist/sitemap.xml`. Sitemap obsahuje jen šest kanonických adres: český a anglický úvod, rozcestník návodů a tři návody. Mobilní varianta ani parametry editoru se do ní neduplikují. Datum poslední změny není uměle obnovováno.

Úvody a návody jsou čitelné přímo z HTML i bez JavaScriptu. JSON-LD popisuje skutečnou bezplatnou aplikaci a články; neobsahuje vymyšlená hodnocení. Náhled sdíleného odkazu má 1200 × 630 px. Souhlas s Analytics zůstává samostatný a nepodmiňuje používání editoru.

Logo pro vyhledávání je skutečné stávající logo v `favicon-96.png` (96 × 96 px) a `favicon.ico` (16, 32, 48 a 96 px). Všechny veřejné stránky na ně odkazují. Google v podporovaných formátech favicon uvádí PNG a ICO; původní SVG zůstává pro grafiku aplikace. Po nasazení musí Google znovu načíst úvod i ikonu, což podle jeho dokumentace může trvat dny až týdny. [Pravidla favicon Google](https://developers.google.com/search/docs/appearance/favicon-in-search).

## Kontrola a publikace

- `npm run check` ověřuje balík obou editorů i SEO.
- `npm test` zahrnuje kontrolu kanonických adres, lokálních odkazů, jazykových alternativ, mobilního obsahu a JSON-LD.
- `node scripts/check-seo.mjs` spustí jen kontrolu SEO.
- Po mobilní změně synchronizujte stabilní zdroj příkazem `node scripts/sync-mobile.mjs --source <cesta-k-mobil/dist>`; sledujte SHA-256 v `mobile-release.json` a zachovejte původní konce řádků ostatních souborů.
- Workflow **Check and deploy InsertCreator** lze spustit ručně na `main` s volbou `publish=true`. Vždy nejprve běží úplná kontrola a testy; nahrává se pouze stále aktuální revize `main`. Výchozí `publish=false` nemění dosavadní automatické nasazování přes `DEPLOY_ENABLED`.
- Za úspěšné nasazení považujte až úspěšný krok HTTPS ověření revize a všech souborů. `scripts/deploy_static.py` záměrně nezapisuje `.htaccess`; canonical neznamená, že je na serveru nastaven redirect z `www`.

## Google Search Console

Přihlášený vlastník přidá prefix `https://insertcreator.com/` do [Search Console](https://search.google.com/search-console/). Použije přesný ověřovací soubor nebo meta značku přidělenou Googlem. Není bezpečné token odhadovat ani kvůli ověření spouštět Analytics bez souhlasu. Pro celou doménu lze místo toho použít přesný DNS TXT token, pokud má vlastník přístup k DNS.

Po ověření odešle `https://insertcreator.com/sitemap.xml` v sekci Soubory Sitemap a přes Kontrolu URL ověří úvodní stránku a návody. Token ani odeslání nejsou hotové, dokud je přímo nepotvrdí Search Console.

Sitemap je zároveň zveřejněna v robots.txt, takže ji Google může objevit i bez přístupu do účtu. [Google: tvorba a odeslání sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [ověření vlastnictví](https://support.google.com/webmasters/answer/9008080).

## Další bezplatná práce

Přidávejte vlastní fotografie skutečných hotových vložek, rozměry a zkušenosti se zkušebním tiskem. Obrázky mají mít smysluplný alternativní text a být poblíž souvisejícího návodu. Nový návod propojte z rozcestníku i souvisejících článků a přidejte ho do sitemap.

Po získání dat v Search Console sledujte reálné vyhledávací dotazy, zobrazení a prokliky; opravujte chybné stránky a upravujte titulky podle jejich obsahu. Relevantní komunitní příspěvky s vlastními výsledky může zveřejnit provozovatel. Nekupujte odkazy a nepublikujte hromadný spam.

Google rozhoduje o procházení, indexaci i pozici. Technické SEO, platná sitemap ani strukturovaná data nezaručují zařazení nebo první místo. [Základní příručka Googlu](https://developers.google.com/search/docs/fundamentals/seo-starter-guide).
