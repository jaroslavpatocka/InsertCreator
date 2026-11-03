# Šuplík Studio

Česká aplikace pro návrh modulárních inzertů do šuplíku. Fotografie se zpracovávají lokálně v prohlížeči. Aplikace nepotřebuje účet, placené API ani server pro výpočty.

## Spuštění

Vyžaduje Node.js 20 nebo novější. V adresáři projektu spusťte:

```sh
npm run dev
```

Otevřete `http://localhost:5173`. V PowerShellu s blokovanými skripty použijte `npm.cmd run dev`. Není potřeba instalovat závislosti ani provádět build. Pro vlastní hosting stačí zveřejnit obsah `dist/` přes HTTP(S); otevření `index.html` přímo jako soubor není podporováno kvůli ES modulům. Kamera telefonu a instalace aplikace vyžadují HTTPS nebo localhost.

Podrobné kroky před nasazením a kontrolu po něm najdete v [DEPLOY.md](./DEPLOY.md).

## Od fotografie k inzertu

1. V nabídce **Moje šuplíky** založte nový šuplík, pojmenujte jej a zadejte vnitřní šířku a hloubku v milimetrech. Šuplíků můžete mít několik a přepínat mezi nimi. Tlačítko **Rozměry šuplíku** umožňuje rozměry později změnit.
2. Vyfoťte oddělené nástroje shora na matném světlém podkladu. Nechte kolem nich volné místo a omezte stíny. Pro kalibraci použijte celý viditelný papír A4 nebo pravítko s dobře viditelným známým úsekem.
3. Při použití A4 aplikace sama najde papír, určí orientaci a narovná perspektivu. Celý bílý list musí být viditelný na odlišném podkladu. U pravítka označte jen dva body a zadejte skutečnou vzdálenost; tento režim předpokládá fotografii kolmo k podkladu.
4. Obrysy se načtou automaticky. Aplikace kombinuje lokální model U²-Net s barvou podkladu a hranami v původním rozlišení. Zachovává úzké mezery mezi nástroji a dotýkající se protáhlé nástroje umí rozdělit podle viditelné hranice a oddělených částí. Kontrast, odstranění šumu, potlačení stínů i vyhlazení vybírá sama. Nepoužívají se posuvníky ani ruční úprava bodů. Připravené nástroje jen pojmenujte a přidejte. Pokud je výsledek příliš nejistý, aplikace požádá o novou fotografii a nedovolí nejistou konturu přidat.
5. Spusťte automatické rozvržení. Velikost nového modulu se přizpůsobí nástroji včetně vůle a stěn. U vybraného modulu můžete zadat vlastní šířku a hloubku nebo znovu použít automatickou velikost podle nástroje. Změna modulu neškáluje obrys nástroje. Ručně zadané rozměry zůstávají zachované při uložení i dalším rozvržení. Moduly lze přesouvat a nástroje otáčet; zamknuté polohy zůstanou při dalším rozvržení na místě.
6. Vyřešte hlášené kolize, přesahy a neplatné hloubky. Potom exportujte podklady.

Velikost vybraného odemčeného modulu můžete ve **2D** měnit také tažením úchytů na jeho okraji. Tlačítka **− / +** v nastavení a klávesy **Alt+Shift+šipky** mění šířku nebo hloubku o jeden krok rastru. Tažení hlídá prostor pro kapsy a stěny, sousední moduly, okraj šuplíku a tiskovou plochu. Celé tažení lze vrátit jedním krokem **Zpět**. Pro přesné zadání použijte **Změnit velikost**; tlačítko **Podle nástroje** obnoví automatickou velikost.

U vybraného nástroje lze upravit **Měřítko** v procentech nebo zadat jeho **Délku** (delší stranu aktuálního obrysu). Obě volby mění obrys rovnoměrně v obou osách. Hloubka kapsy a průměr výřezů pro prsty se nemění. Automatický modul se přizpůsobí; ručně nastavený modul si ponechá rozměry a případné přesahy se zobrazí jako upozornění.

## Jazyk a jednotky / Language and units

Přepínač **CS / EN** a přepínač jednotek **mm / in** jsou v horní liště aplikace. Volba se ukládá v prohlížeči. Bez uložené volby se jazyk řídí nastavením prohlížeče: čeština nebo slovenština zobrazí češtinu, jiné jazyky angličtinu. Palce se jako výchozí jednotka použijí pro `en-US`.

Jednotky lze kombinovat. Výchozí jednotka platí pro celou aplikaci a každý šuplík ji může přepsat vlastní volbou (**Podle aplikace / mm / in**). Volba šuplíku se ukládá s projektem i do JSON. Do každého pole s délkou lze napsat hodnotu i v jiné jednotce, než se právě zobrazuje: `12 in`, `3 1/2"`, `3/4 in`, `1' 2"`, `30 cm` nebo `15 mm`. Hodnota se převede a uloží v milimetrech. Výrobní soubory STL, SVG, DXF a PDF 1:1 zůstávají v milimetrech. Standard Gridfinity (42 mm) je metrický.

The **CS / EN** language switch and the **mm / in** unit switch are in the app's top bar. The app-wide unit can be overridden per drawer, and any length field accepts values with an explicit unit (`12 in`, `3 1/2"`, `30 cm`, `15 mm`). Data and manufacturing exports are always stored in millimetres.

## Chytré rozvržení

Tlačítko **Chytré rozvržení** hledá úspornější orientaci nástrojů a kombinuje vhodné nástroje do společných modulů. Porovnává skutečné tvary kapes včetně vůle a prostoru výřezů pro prsty. Mezi kapsami ponechává alespoň větší z hodnot **stěna** a **mezera**. Zámky, ruční rozměry modulů a prázdné výplně respektuje. Ručně smazané výřezy pro prsty neobnovuje.

Výpočet má průběh a lze jej zrušit. Přijaté rozvržení můžete celé vrátit jedním krokem **Zpět**; společné moduly a jejich výřezy zůstávají upravitelné a ukládají se do JSON. Běžné **Auto rozložení** společné moduly zachová. Výsledek uvádí změnu součtu vnějších půdorysů modulů (jmenovité rozměry minus montážní mezera 0,5 mm), nikoli změnu fyzické velikosti šuplíku. Jde o omezené hledání pro nejvýše 24 nástrojů a přiměřeně složité obrysy; nezaručuje matematicky nejmenší možné řešení. Příliš velkou sestavu ponechá beze změny a uvede důvod.

## Sady nástrojů

V nabídce **Sady nástrojů** můžete vybrané nástroje označit jako jednu sadu, pojmenovat ji a později změnit členy nebo ji zrušit. Zrušení sady nemaže nástroje. Podobné tvary aplikace také navrhuje automaticky; návrh neznamená jisté určení typu nástroje a můžete jej upravit.

Pro sadu zvolte **Stejné moduly**, **Společný modul** nebo **Automaticky**. Stejné moduly mají společné vnější rozměry a nástroje míří stejným směrem. Společný modul obsahuje celou sadu v přehledném uspořádání. Automatická volba porovná bezpečné varianty. Obrysy, skutečné rozměry a vlastní hloubky nástrojů se nemění. Tisková plocha a zámky mohou společný modul omezit; aplikace uvede důvod, pokud požadovanou variantu nelze použít.

Režim rozvržení **Sady nástrojů** dává přednost sjednocení sad. Volba **Nejmenší plocha** zachovává původní konturní párování. Sjednocení může zabrat více místa; výsledek tuto změnu ukazuje a lze jej celý vrátit přes **Zpět**. Ručně zadané sady se ukládají s projektem a do JSON.

## Ovládání 2D a 3D náhledu

V režimu **2D** posouváte pohled tažením pravým tlačítkem myši a kolečkem přibližujete či oddalujete kolem kurzoru. Levé tlačítko slouží k výběru, přesunu modulů a změně jejich velikosti přes úchyty. **Zobrazit vše** obnoví výchozí pohled.

V režimu **3D** otáčíte pohledem tažením levým tlačítkem myši, posouváte jej tažením pravým tlačítkem a kolečkem přibližujete či oddalujete. Funguje to nad modelem i nad prázdnou částí plochy. Tlačítka přiblížení ovládají aktuální pohled; **Zobrazit vše** vrátí výchozí kameru. Přepnutí do 2D a zpět zachová 3D pohled, otevření jiného šuplíku jej obnoví.

Navigace mění pouze kameru. Nepřesouvá moduly, neotáčí nástroje a nepřidává záznamy do historie úprav projektu.

## Katalog a sady nářadí

Inzert lze navrhnout i bez fotografování. **Knihovna nástrojů** má složky **Moje nástroje** a **Katalog**. Katalog obsahuje 247 hotových obrysů ve skupinách klíče, imbusy a torxy, nástrčné hlavice a bity, šroubováky, kleště, měření, řezání a kladiva. Lze v něm hledat česky i anglicky a filtrovat metrické a palcové velikosti. Většina obrysů je vygenerovaná podle rozměrů norem DIN/ISO (štítek *podle normy*) nebo představuje typický tvar (*typický tvar*). 17 obrysů pochází z modelů skutečných nástrojů z otevřených knihoven Poly Haven (CC0) a FreeCAD-library (CC-BY-3.0, autor hasecilu). Originály a licence jsou v `dist/catalog/sources/`.

Kategorie **Sady nářadí** nabízí 38 sad podle složení běžně prodávaných sad, například sadu očkoplochých klíčů 6–32 mm (26 ks), imbusy 1,5–10 mm nebo sadu nástrčných hlavic 1/2" 10–32 mm. **Přidat sadu** vloží celou sadu jedním krokem, který jde vrátit přes Zpět. V obsahu sady lze odškrtnout velikosti, které nemáte. Nástroje, které se do šuplíku nevejdou, zůstanou v projektu a aplikace je ohlásí.

Před přidáním sady zvolte **Jeden modul pro celou sadu** (výchozí) nebo **Samostatný modul pro každý nástroj**. Samostatné moduly mají stejné vnější rozměry a nástroje míří stejným směrem. Přidaná sada se objeví i v nabídce **Sady nástrojů**, kde ji lze dále upravovat. Při hromadném přidání zůstanou jednotlivé sady zachované a celé vložení vrátíte jedním krokem **Zpět**. Pokud se nevejdou, aplikace nabídne rozšíření nebo nový šuplík se zachováním skupin a sad; změnu tiskového omezení ukáže zvlášť.

V rozbalovací nabídce **Upravit měřítko** u katalogového nástroje nebo sady můžete zadat **20–500 %** nebo požadovanou délku. U sady se délka vztahuje k nejdelšímu vybranému nástroji a všechny vybrané obrysy se zvětší či zmenší stejným poměrem. Náhled ukazuje výslednou délku ještě před přidáním nebo uložením do knihovny.

Obrysy z katalogu jsou jmenovité. Konkrétní nástroj se může lišit, proto ho před tiskem porovnejte se zkušebním PDF 1:1.

## Výřezy pro prsty

Novým nástrojům se automaticky připraví dva boční výřezy pro snazší vyjmutí z kapsy. U vybraného nástroje je můžete znovu automaticky umístit, přidat další, upravit jejich polohu a průměr nebo je jednotlivě či všechny odstranit. Změny lze vrátit přes Zpět a ukládají se s projektem i do JSON. Smazané výřezy se při automatickém rozvržení samy neobnovují; u starších nástrojů se přidají až na vaše přání.

Výřezy mají stejnou hloubku jako kapsa nástroje. Jejich prostor se započítává do automatické velikosti modulu a výrobních exportů STL, SVG, DXF i zkušebního PDF. Skutečný naměřený obrys a rozměry nástroje se nemění. U ručně zmenšeného nebo zamčeného modulu musí zbýt dost místa na stěnu; neplatné výřezy je potřeba upravit nebo modul zvětšit.

## Výroba a modularita

Výchozí rastr je **42 mm**. Automatická velikost modulu se zaokrouhluje nahoru do rastru; ručně lze zadat vlastní rozměry v milimetrech. Skutečné vnější rozměry jsou o 0,5 mm menší než jmenovité rozměry modulu, aby sousední díly měly montážní mezeru. Nabídka exportu obsahuje plné a úsporné provedení, hladké dno, patky Gridfinity, kapsy pro magnety a variantu k lepení. Patky Gridfinity vyžadují rastr a rozměry v násobcích 42 mm; systém neobsahuje stohovací lem.

**STL** obsahuje uzavřenou trojúhelníkovou geometrii s opravdovými zapuštěnými kapsami a dnem; jednotky jsou milimetry. ZIP umožňuje získat samostatné díly pro tisk. **SVG a DXF** obsahují obrysy modulů a kapes v milimetrech pro další zpracování, například řezání pěny. Nevytvářejí dráhy CNC ani G-code. Nastavená vůle zvětšuje obrys kapsy; rohy se zaoblují s tolerancí přibližně 0,015 mm.

Fotografie nedává zaručenou výrobní přesnost. Stíny, lesklé plochy, výška nástroje nad papírem a perspektiva ovlivňují obrys. Překrývající se nástroje se mohou spojit. Automatické hodnocení kvality je heuristické a nepředstavuje záruku rozměrové přesnosti. Nečitelnou hranu nelze z chybějící obrazové informace spolehlivě odhadnout. Kontrolujte měřítko podle skutečného rozměru a před tiskem celé sestavy vytiskněte jeden zkušební díl. Hloubku kapsy určujete sami; z jedné fotografie ji nelze spolehlivě změřit.

## Šuplíky a soukromí

Každý šuplík se ukládá jako samostatný projekt s vlastním názvem, rozměry, nástroji a moduly v úložišti daného prohlížeče. Export JSON slouží jako záloha a pro přenos na jiný počítač či telefon; import vrátí upravitelný projekt. Smazání dat prohlížeče může lokální šuplíky odstranit. Automatická synchronizace mezi zařízeními není součástí aplikace. Fotografie se neodesílají k rozpoznávání na vzdálený server.

## Ověření a knihovny

```sh
npm ci
npm test
npm run check
```

Instalace závislostí je potřeba jen pro vývojové testy (Happy DOM a rastrové plátno), nikoli pro běh již zabalené aplikace. Integrační test prochází editor, uložení, rozšíření sestavy, zachování zámků a celý automatický tok ukázkové fotografie bez nastavení prahu. Testy neuronového rozpoznávání spouštějí skutečný přiložený ONNX model a stejný WASM runtime jako prohlížeč. Jde o simulované DOM a pracovní prostředí Node, nikoli vizuální test ve skutečném mobilním prohlížeči.

Testy ověřují zpracování obrazu, kalibraci, rozvržení, zachování zámků, kolize, výrobní vůli, metrické exporty, integritu ZIP a uzavřenost i orientaci STL včetně objemu kapsy. Pro triangulaci se používá lokální Earcut 3.0.2 (ISC), pro robustní posun kontur lokální Clipper 6.4.2.2 (Boost Software License). Rozpoznávání používá U2Netp (Apache 2.0, model ONNX z vydání rembg) a ONNX Runtime Web 1.20.1 (MIT). Zdroje, původ modelu, kontrolní součet a licence jsou v `dist/models/` a `dist/vendor/`. Žádná fotografie se neodesílá k vzdálené inferenci. Rozpoznávač se při prvním použití načte ze stejného hostingu aplikace (přibližně 16 MB), následně může využívat cache prohlížeče. Na starších zařízeních nebo při nedostupném WASM se použije analýza obrazu a při nízké kvalitě se vyžádá nový snímek.
