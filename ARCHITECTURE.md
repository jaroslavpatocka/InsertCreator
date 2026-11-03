# Architektura Šuplík Studia

Mapa projektu z analýzy 3. 11. 2026. Pracovní strom současně rozvíjí další vlákno; nové výrobní funkce a jejich propojení proto mohou přibývat. Tento dokument popisuje hlavní hranice systému a samostatně označuje rozpracované části.

## Základ aplikace

Šuplík Studio je český editor modulárních organizérů. Běží na zařízení uživatele jako statická webová aplikace v čistém JavaScriptu s ES moduly. Nemá aplikační backend, databázový server, framework ani build krok. Adresář `dist/` obsahuje přímo editované zdrojové soubory i soubory určené k nasazení.

Aktivní projekt je v tomto adresáři. ZIP se zdroji a dva deployment archivy v nadřazeném adresáři jsou samostatné balíčky; nejsou vstupem pro běh nebo testování pracovního stromu.

| Oblast | Soubory | Odpovědnost |
| --- | --- | --- |
| Vstup a vzhled | `dist/index.html`, `dist/style.css`, `dist/fonts/`, `dist/icon.svg` | HTML shell, CSS, lokální fonty a responzivní rozložení |
| Editor | `dist/app.js` | Stav aplikace, SVG pracovní plocha, izometrický náhled, události, historie a koordinace ostatních částí |
| UI pomůcky | `dist/ui.js` | Modal, focus trap, ikony, escapování, oznámení a stahování souborů |
| Datový model | `dist/model.js` | Výchozí projekt, validace/normalizace JSON, ID, kopírování a přístup k localStorage |
| Úchop nástroje | `dist/finger-grip.js` | Automatické boční výřezy, validace jejich parametrů a sjednocená výrobní kontura kapsy |
| Fotografování | `dist/capture.js` | Soubory/kamera, kalibrace, průběh rozpoznávání, kontrola kvality a přidání nástrojů |
| Obrazové algoritmy | `dist/trace.js`, `dist/auto-trace.js` | Papír, perspektiva, komponenty obrazu, kontury a automatický výběr segmentace |
| Rozpoznávání | `dist/recognize.js`, `dist/recognize-worker.js` | Souběh klasické a neuronové analýzy, klasický worker a fallback |
| Neuronová inference | `dist/neural.js`, `dist/neural-worker.js`, `dist/neural-core.js` | Sdílený worker, fronta inference, ONNX session, preprocessing a masky |
| Geometrie a výroba | `dist/geometry.js` | Transformace, rozvržení, validace sestavy, SVG/DXF/ZIP a rozhraní STL |
| Konstrukce pro tisk — souběžný vývoj | `dist/print-geometry.js` | Konstrukce sítě, konfigurace tisku, kontrola tiskové plochy, objem a binární STL |
| Náhled sítě | `dist/preview3d.js` | Ortografická 3D kamera, projekce skutečné STL sítě, viditelnost stěn a cache geometrie |
| Ovládání kamery | `dist/view-controls.js` | Levé tažení pro orbit, pravé pro posun a kolečko pro zoom kolem kurzoru |
| Šablona 1:1 — souběžný vývoj | `dist/fit-sheet.js` | Vektorové PDF A4 s měřítkem a dlaždicovým rozdělením velkého modulu |
| Offline režim | `dist/sw.js`, `dist/manifest.webmanifest` | Service worker, cache a instalovatelná aplikace |
| Spuštění a kontrola | `serve.mjs`, `check.mjs`, `package.json`, `.openai/hosting.json` | Lokální HTTP server, statické kontroly, příkazy a cílový adresář hostingu |

```mermaid
flowchart TD
    HTML[index.html] --> APP[app.js / editor]
    APP --> UI[ui.js]
    APP --> MODEL[model.js / localStorage]
    APP --> GRIP[finger-grip.js / výřezy pro prsty]
    MODEL --> GRIP
    APP --> GEO[geometry.js / rozvržení a exporty]
    APP --> PREVIEW[preview3d.js / náhled sítě]
    APP --> CONTROLS[view-controls.js / ovládání kamery]
    PREVIEW --> GEO
    APP --> PDF[fit-sheet.js / PDF 1:1]
    PDF --> GEO
    APP --> CAP[capture.js]
    CAP --> TRACE[trace.js / kalibrace]
    CAP --> REC[recognize.js]
    REC --> CLASS[recognize-worker.js]
    CLASS --> AUTO[auto-trace.js]
    AUTO --> TRACE
    REC --> NEURAL[neural.js]
    NEURAL --> NW[neural-worker.js]
    NW --> CORE[neural-core.js]
    NW --> ONNX[Lokální ONNX Runtime + U2Netp]
    GEO --> PRINT[print-geometry.js / konstrukce STL]
    GEO --> GRIP
    GEO --> VENDOR[Clipper + Earcut]
    PRINT --> VENDOR
    GRIP --> VENDOR
```

Klasická analýza má také přímou cestu bez workeru pro prostředí, která `Worker` nepodporují.

## Stav, data a ukládání

`app.js` drží aktuální projekt, seznam projektů, knihovnu nástrojů, výběr, pohled a historii v proměnných modulu. Typická editace prochází cestou `commit → remember → persist → render`. UI se převážně překresluje sestavením HTML řetězců; plocha i 3D náhled jsou SVG. Události jsou z velké části delegované. Neexistuje samostatný store ani router.

3D kamera používá samostatný dočasný stav `{yaw, pitch, zoom, panX, panY}`. Nezapisuje do projektu ani jeho historie. Při přepnutí 2D/3D se zachová; při změně šuplíku nebo obnovení výchozího pohledu se resetuje. Cache náhledu drží celé STL trojúhelníky a BSP strom pro správné zakrývání stěn. BSP rozděluje pouze vykreslované polygony, nikoli výrobní geometrii; viditelnost a pořadí vykreslení se odvozují od aktuální kamery. Stabilní prostorový rám a poměr stran plochy oddělují otáčení od zoomu. Ovládání dávkuje překreslení přes `requestAnimationFrame` a zachovává projekční bod pod kurzorem při zoomu; obsluha myši se připojuje pouze k 3D ploše.

Projekt obsahuje rozměry šuplíku, rastr, vůli, stěnu, dno, výšku a pole `modules` a `tools`. Všechny výrobní délky jsou v milimetrech:

- Modul má ID, absolutní `x/y`, rozměry, zámek polohy a režim velikosti `sizeMode` (`auto` nebo `manual`).
- Nástroj má vlastní ID, lokální polygon `points`, polohu, rotaci ve stupních, hloubku a vazbu `moduleId`.
- Volitelné `tool.fingerGrips` obsahuje nejvýše 12 výřezů `{id, x, y, radius}` v lokálních milimetrech nástroje. Nepřítomné pole označuje původní nástroj bez automatické změny kapsy; explicitní `[]` uchovává smazání. Normalizace souřadnic posouvá centra výřezů stejně jako body nástroje.
- `transformedPoints()` otočí lokální polygon, posune jeho obálku k počátku a poté přičte `x/y`. Pozice tak označuje počátek obálky po otočení.
- `validateProject()` kontroluje strukturu a rozsahy, doplní výchozí hodnoty a normalizuje body. Výrobní platnost kontroluje zvlášť `validateLayout()`.
- Limity importu jsou 300 nástrojů, 400 modulů a 3–6000 bodů na konturu. Normalizovaný rozměr kontury smí být nejvýše 3000 mm v každé ose.

Klíče localStorage jsou `suplik-studio-projects-v1`, `suplik-studio-current`, `suplik-studio-library-v1` a nastavení úvodního tipu. JSON export obsahuje obálku `schemaVersion: 1`, identifikaci aplikace a projekt. Import přijímá obálku i přímý projekt. Fotografie se do projektu neukládají. Není zde vzdálená synchronizace ani uživatelský účet.

Jeden projekt v datovém modelu odpovídá jednomu fyzickému šuplíku. UI jej představuje jako pojmenovaný šuplík: vytvoření vyžaduje název a vnitřní rozměry, nabídka **Moje šuplíky** přepíná několik nezávislých sestav a **Rozměry šuplíku** zpřístupňuje editaci i po výběru nástroje. Existující projekty používají stejné identifikátory a klíče úložiště.

Undo/redo ukládá hluboké kopie projektu pouze do paměti. Běžné změny omezují undo na 40 snímků; větev dokončení tažení tento limit zatím nesdílí. Obnova ze storage neplatné projekty vyřazuje, proto je stabilní opakovaná validace dat důležitá.

## Tok fotografie do kontury

1. `capture.js` načte fotografii do Canvas a omezí delší stranu na 1400 px. Soubory mají limit 20 MB. Souběžný vývoj doplňuje nativní dekódování HEIC a ověření rozlišení.
2. Režim A4 najde světlý papír, odhadne orientaci a projektivně jej narovná na 210 × 297 mm, s delší stranou nejvýše 1100 px. Pravítko poskytne měřítko ze dvou bodů a známé vzdálenosti; perspektivu neopravuje.
3. `recognizeTools()` spustí klasickou analýzu a neuronovou segmentaci souběžně. Při úspěchu neuronové části se klasická analýza zopakuje s pravděpodobnostní maskou. Při nedostupné neuronové části zůstává klasická cesta.
4. Klasická analýza odhaduje barvu a osvětlení papíru, hledá hrany a porovnává několik segmentačních kandidátů. `traceMask()` trasuje hotové binární masky bez dalšího rozmazání a morfologického spojování; zachovává úzké mezery. Dotýkající se protáhlé nástroje lze oddělit podél viditelné RGB hranice, pokud výsledek podporují samostatně viditelné dříky a celistvé kontury. Kontrola fragmentů používá orientaci a skutečné vzdálenosti kontur místo překryvu jejich obdélníků. Oříznuté objekty se odmítají.
5. Model U2Netp používá vstup 320 × 320 v CHW RGB. Jeden sdílený neuronový worker drží ONNX session a serializuje inference. Skutečné hrany se zpřesňují obrazovou analýzou ve vyšším rozlišení.
6. Výsledek má kvalitu `ready`, `review` nebo `retake`. Přidání dovoluje pouze `ready`. Body se normalizují k počátku nástroje a vydělí měřítkem px/mm; editor je převezme přes callback `onAdd`.

Reset a zavření dialogu ruší úlohu a kontrola identity běhu brání použití starého výsledku. Klasický worker žije po dobu jednoho výpočtu. Zrušení neuronové úlohy ukončuje sdílený worker a jeho čekající požadavky; timeout je 60 sekund.

Fotografie se nikam neodesílají. Model, runtime i fonty jsou lokální soubory stejného hostingu. Model má přibližně 4,6 MB, WASM 11,2 MB; celá neuronová část přibližně 16 MB. Licence a původ jsou v `dist/models/` a `dist/vendor/`. U2Netp je obecný model popředí, ne záruka rozměrové přesnosti.

## Geometrie, rozvržení a exporty

Geometrická vrstva nemá závislost na DOM. Používá lokální Clipper pro posun a booleovské operace kontur a Earcut pro triangulaci ploch s otvory. Souběžný vývoj vyčleňuje konstrukci STL do `print-geometry.js`; veřejné exportní rozhraní zůstává v `geometry.js`.

`autoArrange()` klonuje projekt, řadí nástroje podle plochy obálky a hledá místa v rastru pro aktuální otočení a otočení o 90°. Zachovává zamčené moduly, moduly se zamčeným nástrojem i prázdné výplně. Neumístěné nástroje zůstávají součástí projektu. Jde o heuristiku, která nezaručuje nejúspornější rozvržení.

`resizeModule()` vrací nový projekt a při neplatné změně původní stav nemění. Ruční rozměry jsou jmenovité milimetry; automatická velikost počítá obálku otočených kontur včetně vůle, přidá stěny a výrobní mezeru a zaokrouhlí nahoru do rastru. Nástroje pouze společně vycentruje, jejich body ani rotaci neškáluje. Ručně nastavené moduly zůstávají při automatickém rozvržení skupinou s pevnými rozměry; režim velikosti sám nezamyká jejich polohu. Neumístěná ruční skupina přežije uložení a může se znovu umístit po rozšíření šuplíku.

`automaticFingerGrips()` volí dva boční kruhy u skutečně vyplněného řezu hlavní osou nástroje. Novým nástrojům je přidává `addTools()`; stávající konfiguraci včetně smazání zachovává. `pocketOutline()` sjednocuje obrys s vůlí a výřezy přes Clipper, zachovává původní kotvu otočeného nástroje a vyžaduje plošné napojení každého výřezu. Poloměr kruhu je skutečná velikost v mm bez dalšího přídavku vůle; hloubka odpovídá kapse nástroje. Obálky modulů, kolize a všechny výrobní výstupy používají tuto rozšířenou konturu. `bounds()` a `transformedPoints()` nadále popisují samotný naměřený nástroj.

`validateLayout()` kontroluje přesahy a překryvy modulů, kontury, přiřazení kapsy, stěny, hloubku, průnik i dotyk kapes. Minimální stěna mezi kapsami stejného modulu se měří mezi konturami po započtení vůle. Společná exportní validace blokuje neplatnou výrobu; samostatný platný modul lze exportovat i při chybách jinde v sestavě.

- SVG používá rozměry v mm a obrysy modulů a kapes.
- DXF používá uzavřené polylinie, metrické jednotky a vrstvy `MODULES/POCKETS`.
- Binární STL skládá horní plochu s otvory, ploché dno, obvodové stěny a dna kapes. Vnější rozměr modulu je o 0,5 mm menší než jmenovitý rozměr v rastru.
- ZIP obsahuje samostatné soubory, CRC32 a UTF-8 názvy; nepoužívá kompresi.
- JSON uchovává editovatelný projekt a lze jej uložit i pro výrobně neplatnou sestavu.

Souběžné vlákno rozšiřuje tisková nastavení, typy dna, odhady tisku a zkušební výstupy. Jejich rozpracovaná pole `printMode`, `bottomMode`, `bedWidth/bedHeight`, `limitToBed` a parametry magnetů nelze považovat za samostatně dokončenou funkci jen podle přítomnosti v datovém modelu.

## Spuštění a offline režim

`npm run dev` spouští `serve.mjs` na portu 5173, naslouchá na `0.0.0.0` a servíruje `dist/`. Nastavuje MIME typy modulů, WASM a ONNX. V PowerShellu lze použít `npm.cmd run dev`. Produkční hosting potřebuje statické soubory přes HTTP(S); kamera a instalace vyžadují bezpečný kontext, například HTTPS nebo localhost.

Service worker přednačítá editor a při běžném provozu ukládá úspěšné GET odpovědi stejného originu. Používá strategii síť před cache. Model a runtime nejsou v původním seznamu přednačítání: offline neuronové rozpoznávání proto závisí na jejich předchozím úspěšném načtení a uložení. Verze cache se mění ručně. Při aktivaci se odstraňují ostatní cache daného originu, což je důležité při sdíleném hostingu s jinou aplikací.

## Ověřování a hranice dalšího vývoje

`npm test` používá vestavěný Node test runner. Happy DOM simuluje editor, `@napi-rs/canvas` poskytuje skutečný raster a `tests/worker-adapter.mjs` spouští původní browser workery přes Node worker threads. Testy inference načítají skutečný přiložený ONNX model i WASM runtime.

`npm run check` kontroluje syntaxi hlavních skriptů, existenci relativních importů a souborů deklarovaných pro offline cache. Neověřuje shodu jmen importovaných exportů; tu zachytí až načtení modulů v integračních testech.

Pokrytí zahrnuje editor a persistenci, JSON, kalibraci, segmentaci, zrušení úloh, zámky a rozvržení, metrické exporty, CRC/ZIP a uzavřenost, orientaci i objem STL. Nové regresní případy chrání zkratku Ctrl/Meta/Alt+R, stabilitu normalizace kontur, kontakty kapes a minimální vnitřní stěnu.

Výřezy pro prsty mají samostatné testy automatického umístění, normalizace, ukládání, editace a výrobní geometrie. Ověřují i skutečně prázdné místo v dutině, zachované dno a uzavřenost sítě v obou konstrukcích a různých typech dna. Samostatná HTTP kontrola základního serveru ověřila šest cest, MIME typy WASM/ONNX, chybějící soubor a odmítnutí cesty mimo `dist/`. Každé vydání vyžaduje nový běh odpovídajících kontrol aktuálního zdroje.

Zbývající důležité limity:

- Detektor světlého papíru neprokazuje, že jde fyzicky o A4. Správné měřítko závisí na správné předloze a kvalitě fotografie.
- Chybí skutečný mobilní E2E/visual test a reprezentativní fotografická sada. Simulovaný DOM neověřuje nativní dekodér HEIC ani chování kamery.
- Bez workerů může klasická analýza blokovat hlavní vlákno. Validace geometrie navíc porovnává páry polygonů a jejich hran, takže složité importy mohou být výpočetně náročné.
- Migrace dat není samostatná vrstva; kompatibilitu nyní zajišťují výchozí hodnoty a validátor. Nová trvalá pole musí projít validací i JSON roundtrip testem.

Pro paralelní práci se osvědčují tři hranice: editor/data (`app.js`, `ui.js`, `model.js`), fotografie/rozpoznávání (`capture`, `trace`, `auto-trace`, `recognize`, `neural`) a geometrie/exporty (`geometry.js`). Každá větev má přidělené související testy. Sdílené soubory jako `package.json`, service worker a dokumentaci má v jednu chvíli upravovat jediný koordinátor. Před závěrečným testem je nutné spojit změny a zkontrolovat aktuální pracovní strom.
