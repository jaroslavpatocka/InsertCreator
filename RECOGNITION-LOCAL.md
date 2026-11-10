## 10. 11. 2026 – původní rozlišení pro NN a oddělené měřítko

Na výslovný požadavek uživatele byla odstraněna nevratná redukce fotografie na1400px při načtení. Nový background režim posílá lokálnímu serveru celé původní dekódované RGBA, ještě před A4/dvojpravítkovým převzorkováním. Model s pevným vstupem1024×1024 dostane všechny původní pixely1:1 v překrývajících se výřezech, krok768px. Menší výřez se doplní bílou pouze mimo zdroj; žádný resize/stretch/interpolace vstupu do této NN. Jedna ONNX session pro všechny výřezy. Alpha se skládá váženými přesahy do původních rozměrů a přesných souřadnic; RGB zůstává soukromou kopií originálu. Pomocný scripts/background_tiles.py je nutná součást backendu.

Měřítko plyne výhradně z původních kalibračních bodů a skutečné referenční délky. Modelových1024px ani počet dlaždic se do mm nepřenáší. Kalibrace A4 a dvou pravítek v capture používá ve všech režimech nové native funkce bez pevných1100/1400px výstupů; původní RGB a serverová alpha dostanou totožnou transformaci a stejný pxPerMm. Tím je opravená i ověřená regrese slité2pxmezery mezi dvěma šroubováky ve staré automatické cestě. Samotný starší prohlížečový rozpoznávač zůstává samostatná volba; tvrzení o NN vstupu1:1 platí pro nový nativní background režim. Ověřená serverová alpha se vždy zpracuje přímo, i pokud je zcela neprůhledná; nesmí tiše spustit starší prohlížečovou síť. Drobný obrys z nové alpha cesty se nemaže jen kvůli rozměru pod2mm.

Limit je explicitních64milionů pixelů a20MB zdrojového souboru, nikoli automatické snížení rozlišení. Nedostatek paměti, větší zdroj či příliš velká plná rektifikace se hlásí; menší kopie se potichu nepoužije. Prohlížeč uchovává plný raster, takže zejména telefon může narazit na paměťový limit. Zdrojový guard pro interaktivní ROI byl sjednocen na64M; vlastní oblast výběru má stále samostatný paměťový limit. Čistě statický hosting nativní službu nenahradí.

Klient vyžaduje native-tiles marker, přesné source rozměry a shodný jednorázový jobId v odpovědi; starý zmenšující server odmítne. Průběh completed/total pochází jen z tohoto konkrétního výpočtu. Upload timeout180s, jednotlivá inference180s, celková úloha dle počtu výřezů nejvýše30min; zrušení zastaví pouze vlastní proces. API stále nevystavuje fotografie třetím stranám ani je neukládá.

Ověření: celá finální sada desktop **1637/1637**, mobil **1695/1695**, fail/skip/cancel0. Nové transportní a metrologické sady **15/15 v každé aplikaci** zahrnují9 případů100×20mm při1000×700,2000×1400 a4000×2800px, známou délku/A4/dvě pravítka, dotyk sCSSoffsetem,2%rezervu právějednou a skutečné STL dutiny se samostatnou0.8mm vůlí. Maxdigitální rozměrová odchylkaSTL **0.203999mm** pochází z jednoho zdrojového pixelu přiA4 převzorkování; nejde o fyzickou přesnost fotoaparátu/výtisku.11/11 skutečných fullsource HTTPpayloadhash a11/11 skutečně stažených PNGalpha souhlasí s analytickými transportními fixtures. Nejde o skutečnouNN v těchto metrologických případech. Samostatný >16M test skutečného ROI výběru zachoval37×11px a přesné source souřadnice bezWorkeru.

Skutečné nové NN běhy jsou oddělené: rucni naradi.png1261×860→2 native výřezy,31.028s; 2kleště.jpeg1542×2047→6 výřezů,76.693s. Byte-exact RGBA vstupy, nezměněný caller/RGB, stejné source rozměry a0browserNNworkerů. **Raw kvalita není univerzálně vyřešená:** první foto má28 návrhů proti27 fyzickým sestavám; horní černá lišta nože se obnovila, ale tyč pistole, poutko a hlava prvního šroubu mají stále chybějící maskové body. Druhá fotka má kromě kleští i nesprávně ponechaný kus papíru nahoře. To není úspěšný automatický výrobní obvod a nenazýváme to vyřešením všech malých nástrojů. Stav musí zůstat REVIEW; originál a opravy jsou dostupné. Obě raw masky, průběhy a PNG jsou v ../artifacts/native-resolution/actual/. Starší27/27STL důkaz po jedné opravě patří předchozí globální masce, nikoli této nové masce.

Finální protokol a přesné SHA: ../artifacts/native-resolution/release-result.json. Měření: ../artifacts/native-resolution/final-report.json. Fyzický telefon, nativní prohlížeč a nový výtisk v této změně neověřeny. Vše zůstává lokální; žádný push/deploy.

---

# Lokální rozpoznávání fyzických nástrojů

## Automatická maska před obrysem – lokální server

`npm.cmd run dev:background` spustí na portu 5180 statickou aplikaci i vlastní API. `/mobil/` používá stejnou službu a samostatné mobilní úložiště. Při dostupném modelu server vloží pevný capability marker do HTML; dialog potom před nahráním zvolí odstranění pozadí a vysvětlí přenos fotografie na vlastní PC. Běžný statický server zůstává s původním chováním. Nový port má nové origin úložiště; staré projekty se nemažou a lze je přenést JSON souborem.

`scripts/background-server.mjs` a `background-worker.py` používají BiRefNet Lite 1024 FP32 v izolovaném nativním CPU procesu. Pinned model: 224005088 B, SHA256 `5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333`. Model a Python závislosti jsou v sousedních `artifacts/background-model-bench`; nejsou commitované do statického webu. Current-PC Python 3.12, ONNX Runtime 1.20.1, NumPy 1.26.4, Pillow 10.4.0 byly připravené v izolovaném `--target`, nikoli globálně. Pro jiný checkout nastav `INSERTCREATOR_BG_PYTHON`, `INSERTCREATOR_BG_MODEL`, `INSERTCREATOR_BG_DEPS`; `.background/` je ignorované lokální místo. Žádný vzdálený placený endpoint ani klíč není potřeba.

API přijímá raw RGBA pouze ve vlastním origin, do 4 milionů pixelů, vrací pouze source-sized alpha. Originální RGB zůstává na klientovi. Jedna aktivní úloha, 429 při souběhu, timeout a ukončení vlastního procesu při zrušení. Obrázky se nezapisují do logů ani neposílají externí službě. Nativní jednovláknový benchmark měl peak 5.34 GiB a 37 s inference; skutečný celý čtyřvláknový HTTP průchod trval přibližně 18 s. Telefon je klient tohoto PC; model neběží v mobilním WASM. Pro veřejné nasazení je nutný vlastní výpočetní backend, samotné SFTP statických souborů nestačí. Zde se nic nepublikuje.

Původní 27 nástrojová fotografie má po native masce 27 obrysů, ale jen 118/122 přesných alpha kontrol. Neopravená kapsa hlavy prvního šroubu neprošla: 26/27 STL. Jedna deklarovaná uživatelská RGB oprava hlavy zachovala ostatních 26 obrysů a dala 27/27 platných funkčních STL se 122/122 body, bez zaplnění chráněných mezer/dřeva. Neúspěšná obecná RGB refinace je archivovaná; není součástí runtime. Doklady `../artifacts/background-model-bench/http-result.json` a `../artifacts/non-ai-recognition/newnative/`. Nejde o fyzickou zkoušku tisku ani záruku libovolné fotografie.

Celé integrační sady prošly 1602/1602 desktop a 1660/1660 mobil. Poslední oprava převzetí aktuálního typu kapsy při RAW reselection má vlastní 78/78 finální běh v každé aplikaci a skutečný 27-STL důkaz; šest změněných zdrojových/testových souborů proti původnímu freeze je explicitně odděleno od 1027 nezměněných souborů v `background-final-delta.json`. Tím se plný běh nepřipisuje nepravdivě homogennímu finálnímu stromu. Finální source/test freeze má 1033 souborů, backend/config dalších osm. Pět dalších actual HTTP fotografií zachovalo 7/7 celých identit a 41/41 materiálových bodů, bez vyplnění 1589 chráněných pixelů mezer; všechny zůstávají review. Galerie `../artifacts/background-corpus/` uvádí i nejistou vnitřní dutinu kleští.

## 10. 11. 2026 – odstranění pozadí, kontrolovatelná maska a vlastní výběr

Uživatel potvrdil běžné fotografie z mobilu i internetu, opravy Přidat/Ubrat/body a později dovolil neuronovou síť. Automatický návrh zůstává dostupný. Nový vlastní výběr funguje samostatně bez modelu; jeho pořadí je zdrojová fotografie → korekce pracovní kopie → skutečná maska popředí → průhledné PNG → vnější obrys → kalibrovaná kapsa. Žádný nový serverový upload ani publikace.

1. V nahrávání lze vybrat **Známý rozměr nástroje · i fotka z internetu** a **Vyberu nástroj přímo ve fotce**. Dva body označí skutečně známou délku, nikoli odhad podle názvu velikosti klíče.
2. Rámeček ohraničí celý nástroj. Souvislý zelený tah označí jeho materiál přes barevné přechody; červený tah označí pozadí nebo stín. Korekce světla a mírné doostření jsou jen analytická kopie. Originální RGBA a souřadnice se nemění.
3. **Určit obrys** vypočte pevný barevný minimax watershed, bez trénování nebo generování pixelů. **Bez pozadí** ukáže skutečnou masku na šachovnici, nikoli bíle přemalovanou fotografii. **Stáhnout PNG bez pozadí** zachová rozlišení, originální RGB a průhledné otvory. PNG obsahuje celou masku výběru; do kapsy se použije jeden zvolený obrys.
4. Slabou hranu lze určit magnetickými nebo rovnými body. Následná původní editace bodů/Bézier, výřezy, hloubka, vůle, rozložení a STL zůstávají k dispozici. Měřený zdroj, 2% tvarová rezerva a mm vůle jsou oddělené.
5. Skutečně průhledný PNG se importuje přímo z alpha kanálu před spuštěním NN. I jednopixelové části a materiál u rámu se zachovají; oříznutí je výslovně hlášené. Obyčejný screenshot šachovnice není průhledná fotografie.

Doklady v `../artifacts/non-ai-recognition/` obsahují přesně uložené uživatelské tahy, tři skutečné fotografie s jedním vybraným nástrojem v každé, před/po pracovní kopii, průhledné PNG a roundtrip alpha→obrys bez workeru/modelu. Nejde o nové automatické vyřešení celého 30fotkového korpusu. Neviditelná hrana, silné rozmazání nebo chybějící skutečný rozměr nemají z fotografie zaručenou rekonstrukci. Platné STL a digitální kontrolní rozměry nejsou zkouška fyzického usazení.

Výzkum Liftu je v `../artifacts/lift-research/`: veřejný klient volá vlastní cloudový `/v2/image-services/remove-bg`, konkrétní serverový model neodhaluje. Průhledné PNG je použitelný mezivýsledek; generativní přemalování nástroje není měřicí podklad. Samostatný nový BiRefNet Lite 1024 WASM benchmark v `../artifacts/background-model-bench/` skončil bez výstupu při téměř 4 GiB RSS, proto není součástí runtime.

Práce je autorizovaná pouze lokálně, pro desktop i samostatný mobilní runtime. Push a nasazení čekají na uživatelův vlastní test. Postup testu je v [ROZPOZNAVANI-LOKALNI-TEST.md](../ROZPOZNAVANI-LOKALNI-TEST.md).

## Runtime

- `tool-neural.js` a `tool-neural-worker.js`: jedna lokální FastSAM-s inference v samostatném jednorázovém workeru, kompaktní source ROI masky a sdílené prototypy. Zrušení, chyba i dokončení worker ukončují. Fotografie se před transferem kopíruje.
- `tool-neural-core.js`: čistý bilineární top-left letterbox 1024 px; každý směr má vlastní inverzní měřítko po zaokrouhlení. Logity se interpolují před clippingem skutečným boxem. Souřadnice výsledku zůstávají v pixelech původní fotografie.
- `recognition-foreground.js` a `tool-recognition.js`: instance/source hierarchy, veto pozadí a skupin, jednotlivé RGB/edge návrhy, konzervativní source identity a bounded měření obvodu. Zdrojový detail nesmí potlačit celý doložený nástroj. Důkazy pro uvolnění source identity používají neměnný snapshot původních source regionů.
- `recognition-topology.js`: malá source-pixel cesta opraví nanejvýš dropout jedné nativní prototype buňky, pouze se společným původním NN návrhem. Doložená source mezera má při této opravě veto. Omezení ztráty materiálu platí pro každý původní díl. Následná weak fáze musí splnit původní mapu vlastníků, takže oprava spojky sama neodemkne další slabý návrh.
- `auto-trace.js`: volitelný `collectProposals` zpřístupňuje všechny tři čistě RGB/edge návrhy v source souřadnicích. Výchozí kontrakt a výsledné měření původního volání se nemění.

Kalibrace, přímá editace bodů/Bézier, výřezy pro prsty, rozložení a výrobní moduly nebyly přepisovány. Převod pixelů na mm a výchozí 2% ideal-pocket rezerva zůstávají v původní downstream cestě; mm vůle je samostatná.

## Důkazy a meze

Finální celé sady na neměnných zdrojích: desktop 1524/1524, mobil 1582/1582; bez chyb nebo přeskočených testů. Původní fotografie prošla skutečným veřejným API v obou aplikacích: 27 sestav, 122 materiálových bodů, žádná vyplněná chráněná mezera ani nezávislý bod dřeva, 27 platných binárních STL. Čtyři známé fotografie prošly skutečnou inferencí s počty 22/22/80/6. Finální místní SHA, mobilní snapshot a HTTP ověření jsou v `../artifacts/recognition-final-validation/final-result.json`.

Přísný [třicetifotkový report](../artifacts/recognition-final-corpus/physical-replay-final-v2/final-report.json) má `functionalAccuracyPassed:false`: 114/116 materiálových bodů, 13/19 celistvých nesloučených identit podle anotací a 4/14 mezer chybně vyplněné. Třináct identit neznamená třináct přesných kapes. Dokončení běhu a stav ke kontrole nejsou úspěch obecné přesnosti; na některých dalších podkladech stále vznikají fragmenty nebo přebytek pozadí. Tato verze je připravena k místnímu testu uživatele.

Reprodukční skripty a skutečné API/STL výstupy jsou v `../artifacts/recognition-final-validation/`. Kontrolují původní foto 27 sestav, 122 materiálových bodů, 22 mezer a šest nezávislých bodů přebytečného dřeva. Kalibrační audit měří analytický kontrolní profil 100 × 20 mm při 0°/37° a skutečné dutiny STL po jediné 2% rezervě a vůli 0,8 mm; není to fyzické měření výtisku.

Třicet skutečných fotografií, jednorázové nové NN výstupy, geometrické replaye, galerie a přísné vizuální kontroly jsou v `../artifacts/recognition-final-corpus/`. Jde o regresní/evaluační korpus; obecné opravy byly informované dřívějšími výsledky. Anotace a očekávané počty nejsou vstupem detektoru. Pokryté body, správný počet ani platná topologie samy neprokazují přesný celý výrobní obvod. Na některých členitých pozadích zůstávají fragmenty, stíny nebo přebytek pozadí; stav ke kontrole je nepovažuje za hotové ověřené kapsy.

Nativní Chrome kontrolu zastavilo Computer Use při nemožnosti spolehlivě ověřit aktuální URL na Windows. Testy Node adaptérů skutečně spouštějí distribuované browser workery a lokální WASM model, ale nejsou testem Safari/iOS, fyzického telefonu ani nového výtisku.

Model, přesná připnutá revize, SHA a původní oznámení jsou v `dist/models/FASTSAM-*`. Rozpor mezi označením Apache-2.0 na kartě a upstream AGPL-3.0 textem není tímto lokálním testem vyřešen a aplikace není automaticky přelicencovaná.

Mobilní zdroje se upravují pouze v `../mobil/dist`; `dist/mobil` je oficiální kopie vytvořená `npm run sync:mobile`. Cache, service-worker scope a úložiště zůstávají oddělené. Model a WASM se ukládají při prvním použití příslušné aplikace.
