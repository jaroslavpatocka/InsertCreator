# InsertCreator

Zdrojový repozitář: [InsertCreator](https://github.com/jaroslavpatocka/InsertCreator).

Česká aplikace pro návrh modulárních inzertů do šuplíku. Fotografie se zpracovávají lokálně v prohlížeči. Aplikace nepotřebuje účet, placené API ani server pro výpočty.

Použité knihovny, fonty, model a katalogové podklady popisuje [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Pro uživatele webu je stejný přehled dostupný přes odkaz **Použité součásti a licence** v patičce aplikace: [česky](dist/licenses.html), [English](dist/licenses-en.html). Jednotlivé úplné licence zůstávají přibalené u příslušných součástí; přehled neuděluje licenci vlastnímu aplikačnímu kódu.

## Spuštění

Vyžaduje Node.js 20 nebo novější. V adresáři projektu spusťte:

```sh
npm run dev
```

Otevřete `http://localhost:5173`. V PowerShellu s blokovanými skripty použijte `npm.cmd run dev`. Není potřeba instalovat závislosti ani provádět build. Pro vlastní hosting stačí zveřejnit obsah `dist/` přes HTTP(S); otevření `index.html` přímo jako soubor není podporováno kvůli ES modulům. Kamera telefonu a instalace aplikace vyžadují HTTPS nebo localhost.

Podrobné kroky před nasazením a kontrolu po něm najdete v [DEPLOY.md](./DEPLOY.md).

## Od fotografie k inzertu

1. V nabídce **Moje šuplíky** založte nový šuplík, pojmenujte jej a zadejte vnitřní šířku a hloubku v milimetrech. Šuplíků můžete mít několik a přepínat mezi nimi. Tlačítko **Rozměry šuplíku** umožňuje rozměry později změnit.
2. Vyfoťte oddělené nástroje shora na matném světlém podkladu. Nechte kolem nich volné místo a omezte stíny. Pro kalibraci použijte celý viditelný papír A4 nebo pravítko s dobře viditelným známým úsekem. Nástroje v kufru nebo na tmavé podložce se rozpoznají také: aplikace si fotku sama upraví a obrysy vytvoří po jednotlivých kusech. Před přidáním zvolíte, zda nástroje půjdou do jednoho modulu, do samostatných modulů, nebo se to rozhodne automaticky podle místa v šuplíku, a nastavíte hloubku kapsy společně pro všechny nástroje nebo pro každý zvlášť. Export STL nabízí volitelné spojky mezi moduly: výstupek ve tvaru puzzle ve dně jednoho modulu zapadne do zdířky souseda. Se zapnutými spojkami mají moduly větší okraj, aby se spojka vešla mimo nástroje.
3. Při použití A4 aplikace sama najde papír, určí orientaci a narovná perspektivu. Celý bílý list musí být viditelný na odlišném podkladu. U pravítka označte body 1 a 2 a zadejte skutečnou vzdálenost. Volitelně zapněte **Druhé kolmé pravítko**, body 3 a 4 označte druhý známý úsek a zadejte jeho délku. Úseky musí být na stejném podkladu fyzicky kolmé. Dvě reference opraví rozdílné měřítko délky a šířky i zešikmení; při výrazné perspektivě použijte A4 nebo novou fotografii shora. Bod vyberete tlačítkem nebo klávesou 1–4, umístíte klepnutím a doladíte šipkami. Prázdný střed kříže nechává značku pravítka viditelnou.
4. Obrysy se načtou automaticky. Aplikace kombinuje lokální model U²-Net s barvou podkladu a hranami v původním rozlišení. Zachovává úzké mezery mezi nástroji a dotýkající se protáhlé nástroje umí rozdělit podle viditelné hranice a oddělených částí. Kontrast, odstranění šumu, potlačení stínů i vyhlazení vybírá sama. Nepoužívají se posuvníky ani ruční úprava bodů. Připravené nástroje jen pojmenujte a přidejte. Pokud je výsledek příliš nejistý, aplikace požádá o novou fotografii a nedovolí nejistou konturu přidat.
5. Spusťte **Rozložit nástroje**. Velikost nového modulu se přizpůsobí nástroji včetně vůle a stěn. U vybraného modulu můžete zadat vlastní šířku a hloubku nebo znovu použít automatickou velikost podle nástroje. Změna modulu neškáluje obrys nástroje. Ručně zadané rozměry zůstávají zachované při uložení i dalším rozvržení. Moduly lze přesouvat a nástroje otáčet; zamknuté polohy zůstanou při dalším rozvržení na místě.
6. Vyřešte hlášené kolize, přesahy a neplatné hloubky. Potom exportujte podklady.

Velikost vybraného odemčeného modulu můžete ve **2D** měnit také tažením úchytů na jeho okraji. Tlačítka **− / +** v nastavení a klávesy **Alt+Shift+šipky** mění šířku nebo hloubku o jeden krok rastru. Tažení hlídá prostor pro kapsy a stěny, sousední moduly a okraj šuplíku. Celé tažení lze vrátit jedním krokem **Zpět**. Pro přesné zadání použijte **Změnit velikost**; tlačítko **Podle nástroje** obnoví automatickou velikost.

U každého jednotlivého nástroje, také uvnitř sady, jsou nahoře ve vlastnostech pole **Délka** a **Šířka**. Měří se podél vlastní podélné a příčné osy kontury, takže otočení nástroje v šuplíku zobrazené rozměry nemění. Délka mění pouze podélný rozměr, šířka pouze příčný. Úprava protáhne celý obrys v příslušné ose včetně geometrie konců klíče; jmenovitá velikost, například `13 mm` nebo `PH2`, zůstává samostatným údajem. Hloubka kapsy a průměr výřezů pro prsty zůstávají stejné, jejich centra sledují změnu obrysu. Automatický samostatný modul se přizpůsobí; společný nebo ruční modul drží svůj půdorys. Kolize, přesah nebo neplatné výřezy odmítnou celou změnu. V nabídce **Rozměry a měřítko** je navíc rovnoměrné **Měřítko** v procentech pro změnu obou os současně.

Pole **Otočení** nastaví absolutní úhel vybraného nástroje. Pro více označených nástrojů použijte **Úhel otočení…** a zvolte **Otočit o** nebo **Nastavit na**. Každý se otáčí kolem vlastního středu; ostatní členové společného modulu zůstávají na místě. Kolize či přesah změnu odmítne a úspěšné otočení vrátíte jedním krokem **Zpět**.

Pole **X · zleva** a **Y · shora** určují polohu vybraného nástroje uvnitř jeho modulu. Více nástrojů označíte pomocí Ctrl/Shift nebo zaškrtávacích polí. Při hromadném přesunu zvolte, zda přesouváte celé moduly, nebo pouze nástroje uvnitř nich. **Zarovnat / rozestupy** upraví vybrané nástroje v jednom modulu; stejné mezery vyžadují alespoň tři kusy. Rozměry modulu i nevybrané nástroje zůstávají zachované. Hromadně lze také připravit prostřední výřezy pro prsty nebo vybrané výřezy odstranit.

Vlastnosti modulu obsahují jeho přesnou polohu **X/Y v šuplíku**, **Otočit modul o 90°** a **Kopie modulu**. Otočení zahrne všechny jeho nástroje a ponechá levý horní roh na místě. Kopie získá nové identifikátory a první volné místo v rastru, ostatní moduly se nepřesouvají. Pokud se další kopie nevejde, projekt zůstane beze změny. Zamčený originál lze zkopírovat; nová kopie je odemčená. Všechny tyto změny lze vrátit přes **Zpět**.

## Jazyk a jednotky / Language and units

Přepínač **CS / EN** a přepínač jednotek **mm / in** jsou v horní liště aplikace. Volba se ukládá v prohlížeči. Bez uložené volby se jazyk řídí nastavením prohlížeče: čeština nebo slovenština zobrazí češtinu, jiné jazyky angličtinu. Palce se jako výchozí jednotka použijí pro `en-US`.

Jednotky lze kombinovat. Výchozí jednotka platí pro celou aplikaci a každý šuplík ji může přepsat vlastní volbou (**Podle aplikace / mm / in**). Volba šuplíku se ukládá s projektem i do JSON. Do každého pole s délkou lze napsat hodnotu i v jiné jednotce, než se právě zobrazuje: `12 in`, `3 1/2"`, `3/4 in`, `1' 2"`, `30 cm` nebo `15 mm`. Hodnota se převede a uloží v milimetrech. Výrobní soubory STL, SVG, DXF a PDF 1:1 zůstávají v milimetrech. Standard Gridfinity (42 mm) je metrický.

The **CS / EN** language switch and the **mm / in** unit switch are in the app's top bar. The app-wide unit can be overridden per drawer, and any length field accepts values with an explicit unit (`12 in`, `3 1/2"`, `30 cm`, `15 mm`). Data and manufacturing exports are always stored in millimetres.

## Rozložení nástrojů

Tlačítko **Rozložit nástroje** hledá úspornější orientaci nástrojů a kombinuje vhodné nástroje do společných modulů. Porovnává skutečné tvary kapes včetně vůle a prostoru výřezů pro prsty. Mezi kapsami ponechává alespoň větší z hodnot **stěna** a **mezera**. Zámky, ruční rozměry modulů a prázdné výplně respektuje. Ručně smazané výřezy pro prsty neobnovuje.

Jediné tlačítko **Rozložit nástroje** postupně provede dosavadní Auto rozložení a navazující Chytré rozvržení. Nejprve připraví základní rozložení s přizpůsobenými automatickými moduly, potom hledá další zlepšení podle zvoleného režimu **Sady nástrojů** nebo **Nejmenší plocha**. Pokud další hledání nepřinese lepší platný výsledek, zachová se základní rozložení. Obě fáze mají jeden průběh a lze je zrušit bez změny projektu; přijatý výsledek vrátíte jediným krokem **Zpět**. Společné moduly a jejich výřezy zůstávají upravitelné a ukládají se do JSON. Výsledek uvádí změnu součtu skutečných vnějších půdorysů modulů po montážním odsazení, nikoli změnu fyzické velikosti šuplíku. Podrobné konturní párování se používá nejvýše pro 24 nástrojů a přiměřeně složité obrysy. Větší sestavy až do 300 nástrojů používají rychlejší omezené hledání: zmenšení prázdných okrajů, přeskládání modulů a porovnání vhodných celých sad. Kapsy, stěny a zámky se kontrolují i v této cestě; úplná výrobní síť se definitivně ověřuje při exportu STL. Hledání nezaručuje matematicky nejmenší řešení a při vyčerpání rozpočtu uvede důvod pro zbývající neumístěné nástroje.

Před spuštěním vyberte **Obdélníkové moduly** nebo **Schodové moduly**. Schodový půdorys tvoří souvislá pole stejného rastru šuplíku; sousední modul může skutečně využít jeho prázdný zářez. Kapsy, stěny i popisky zůstávají uvnitř materiálu a stejný tvar se ukládá do projektu a exportuje do STL, SVG i DXF. Běžně vložené moduly zůstávají obdélníkové. Chytré rozvržení porovnává také odebrání prázdných okrajů automatických modulů při zachování skutečných rozměrů nástrojů. Pokud místo stále chybí, může zmenšit nepotřebný okraj odemčeného ručního modulu, pouze když tím umístí další nástroj; výsledek ukáže původní i nové rozměry. Zámky, prázdné výplně a výslovně sjednocené rozměry sady zůstávají chráněné.

## Sady nástrojů

V nabídce **Sady nástrojů** můžete vybrané nástroje označit jako jednu sadu, pojmenovat ji a později změnit členy nebo ji zrušit. Zrušení sady nemaže nástroje. Podobné tvary aplikace také navrhuje automaticky; návrh neznamená jisté určení typu nástroje a můžete jej upravit.

U vybrané sady nebo jejího společného modulu otevřete **Uložení a pořadí sady**. K dispozici jsou tři varianty:

- **Přehledně podle velikosti**: společný modul s řadami nástrojů ve stejném směru.
- **Úsporně proti sobě**: společný modul s konturním skládáním; protilehlé otočení se použije, pokud zmenší půdorys v rastru. Počítá se i s výřezy pro prsty a stěnami.
- **Stejné samostatné moduly**: každý nástroj dostane modul se stejnou šířkou i hloubkou.

Zvolte **Od nejmenšího po největší** nebo **Od největšího po nejmenší** a potvrďte **Použít uložení**. Řazení používá jmenovitou velikost v mm nebo in; bez ní použije délku obrysu pouze pro pořadí. Jmenovitou velikost z fotografie neodhaduje. Změna zachová nástroje, jejich obrysy, hloubky a popisky a jde celá vrátit jedním krokem **Zpět**. Před přeuložením odemkněte všechny moduly sady. Editor členství navíc nabízí rozvržení **Automaticky**, které porovnává bezpečné varianty při chytrém rozvržení.

Režim rozvržení **Sady nástrojů** dává přednost sjednocení sad. Volba **Nejmenší plocha** zachovává původní konturní párování. Sjednocení může zabrat více místa; výsledek tuto změnu ukazuje a lze jej celý vrátit přes **Zpět**. Ručně zadané sady se ukládají s projektem a do JSON.

Referenční principy ukazují [Ernst Wrench Trays](https://www.ernstmfg.com/Wrench-Trays.aspx) pro uspořádání klíčů do řad a [Toolbox Widget](https://toolboxwidget.com/products/toolbox-wrench-organizer) pro samostatné držáky a velikostní štítky.

## Hromadné úpravy

Více nástrojů vyberete zaškrtávacími políčky v seznamu nebo pomocí **Shift/Ctrl/Cmd+klepnutí** na konkrétní obrys či položku nástroje. Všechny označené obrysy, řádky a členové modulu mají stejné zvýraznění. Obyčejné klepnutí bez modifikátoru na nástroj ukončí hromadný výběr a otevře jeho vlastnosti. **Ctrl/Cmd+A** vybere všechny nástroje a **Esc** výběr zruší. **R** otočí výběr o 90°, **Delete/Backspace** jej smaže. Zkratky nezasahují do psaní v poli ani do otevřeného dialogu.

Klepnutí na pozadí modulu odznačí nástroje a vybere samotný modul, i když obsahuje jediný nástroj; Ctrl/Shift přidává do výběru pouze konkrétní nástroj. Při práci s dalším modulem se předchozí výběr nepřenáší a samotná změna výběru nemění projekt ani historii **Zpět**.

Panel výběru je nahoře v pravé nabídce a zůstává dostupný při posouvání nastavení. Hned nabízí **Otočit o 90°**, **Úhel otočení…**, **Přesunout vybrané** a **Smazat vybrané**. Nabídka **Další úpravy** obsahuje otočení o 180°, zarovnání a rozestupy, společnou hloubku kapes, výřezy pro prsty, zámky a vytvoření sady. Při hromadném výběru pravý panel ukazuje jeho skutečné členy; klepnutím na jméno přejdete k vlastnostem tohoto nástroje.

Ve 2D můžete vybrané moduly přetáhnout společně. V přesném přesunu lze zvolit celé moduly nebo samotné nástroje uvnitř nich. Zámek platí pro celý modul včetně ostatních nástrojů; hloubka a smazání se týkají vybraných nástrojů. Kolize, přesahy nebo zamčený člen zabrání neplatnému přesunu či otočení. Každou úspěšnou hromadnou úpravu i celé tažení vrátíte jedním krokem **Zpět**.

## Ovládání 2D a 3D náhledu

Na široké obrazovce zůstává náhled šuplíku viditelný a pravé nastavení má vlastní posouvání. Výška ploch vychází ze skutečného místa pod záhlavím a přizpůsobuje se velikosti okna i posunu stránky. Seznam **Nástroje v modulu** je kompaktní a posouvá se uvnitř svého rámečku. Základní vlastnosti jsou nahoře; pokročilé volby jsou seskupené do pojmenovaných rozbalovacích sekcí. Při překreslení stejného kontextu zůstane zachované otevření sekcí i místo v nastavení. Při výběru klávesnicí zůstane zaměření na stejném zaškrtávacím políčku.

Rozložení používá principy [viditelných akcí místo vybavování z paměti](https://www.nngroup.com/articles/recognition-and-recall/), [kontextových akcí pro označené položky](https://m1.material.io/patterns/selection.html) a [nezastíněného zaměření ovládacích prvků](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).

V režimu **2D** posouváte pohled tažením pravým tlačítkem myši a kolečkem přibližujete či oddalujete kolem kurzoru. Krátké pravé klepnutí otevře nabídku pro nástroj, výběr, modul nebo volnou plochu. Po tažení se nabídka neotevře. Levé tlačítko slouží k výběru, přesunu modulů a změně jejich velikosti přes úchyty. **Zobrazit vše** obnoví výchozí pohled.

V režimu **3D** otáčíte pohledem tažením levým tlačítkem myši, posouváte jej tažením pravým tlačítkem a kolečkem přibližujete či oddalujete. Funguje to nad modelem i nad prázdnou částí plochy. Tlačítka přiblížení ovládají aktuální pohled; **Zobrazit vše** vrátí výchozí kameru. Přepnutí do 2D a zpět zachová 3D pohled, otevření jiného šuplíku jej obnoví.

Navigace mění pouze kameru. Nepřesouvá moduly, neotáčí nástroje a nepřidává záznamy do historie úprav projektu.

## Katalog a sady nářadí

Inzert lze navrhnout i bez fotografování. **Knihovna nástrojů** má složky **Moje nástroje** a **Katalog**. Katalog obsahuje 247 hotových obrysů ve skupinách klíče, imbusy a torxy, nástrčné hlavice a bity, šroubováky, kleště, měření, řezání a kladiva. Obě složky mají stejné filtry: hledání česky i anglicky, volbu Vše / Sady / Jednotlivé, metrické a palcové velikosti a výběr více kategorií najednou. Výsledky jsou v rozbalovacích sekcích podle kategorií; dlouhý nefiltrovaný seznam začíná sbalený. Sady uložené z katalogu se v Mých nástrojích zobrazí jako rozbalovací skupiny, starší nástroje se zařadí podle názvu. Kategorii lze změnit přímo na kartě nástroje; u nástroje ze sady se přesune celá sada. Většina obrysů je vygenerovaná podle rozměrů norem DIN/ISO (štítek *podle normy*) nebo představuje typický tvar (*typický tvar*). 17 obrysů pochází z modelů skutečných nástrojů z otevřených knihoven Poly Haven (CC0) a FreeCAD-library (CC-BY-3.0, autor hasecilu). Originály a licence jsou v `dist/catalog/sources/`.

Kategorie **Sady nářadí** nabízí 38 sad podle složení běžně prodávaných sad, například sadu očkoplochých klíčů 6–32 mm (26 ks), imbusy 1,5–10 mm nebo sadu nástrčných hlavic 1/2" 10–32 mm. **Přidat sadu** vloží celou sadu jedním krokem, který jde vrátit přes Zpět. V obsahu sady lze odškrtnout velikosti, které nemáte. Nástroje, které se do šuplíku nevejdou, zůstanou v projektu a aplikace je ohlásí.

Před přidáním sady zvolte **Jeden modul pro celou sadu** (výchozí) nebo **Samostatný modul pro každý nástroj**. U společného modulu můžete vybrat přehledné nebo úsporné uložení; obě rozložení nabízejí vzestupné a sestupné pořadí velikostí. Každý samostatný modul se zmenší na nejmenší bezpečný počet polí rastru pro svůj nástroj, včetně vůle, výřezů a stěn. Menší klíč tak automaticky nedostane délku modulu pro největší klíč. Stejné vnější rozměry jsou samostatná výslovná volba **Stejné samostatné moduly** při přeuložení sady. Volby konkrétní sady se pamatují po dobu otevřené aplikace. Přidaná sada se objeví i v nabídce **Sady nástrojů**, kde ji lze dále upravovat. Při hromadném přidání zůstanou jednotlivé sady zachované a celé vložení vrátíte jedním krokem **Zpět**. Pokud se nevejdou do šuplíku, aplikace nabídne rozšíření nebo nový šuplík se zachováním skupin a sad.

V rozbalovací nabídce **Upravit měřítko** u katalogového nástroje nebo sady můžete zadat **20–500 %** nebo požadovanou délku. U sady se délka vztahuje k nejdelšímu vybranému nástroji a všechny vybrané obrysy se zvětší či zmenší stejným poměrem. Náhled ukazuje výslednou délku ještě před přidáním nebo uložením do knihovny.

Obrysy z katalogu jsou jmenovité. Konkrétní nástroj se může lišit, proto ho před tiskem porovnejte se zkušebním PDF 1:1.

## Výřezy pro prsty

Novým nástrojům se automaticky připraví dva boční výřezy pro snazší vyjmutí z kapsy. Hledá se úzký skutečně vyplněný průřez v prostředních 35–65 % délky; při stejné šířce má přednost střed. Široká rukojeť šroubováku tak nepřitahuje výřezy, pokud je poblíž užší dřík. Katalog i fotografované nástroje používají stejné pravidlo. Ve společném modulu vyberte konkrétní nástroj klepnutím na jeho obrys. U vybraného nástroje můžete výřezy znovu automaticky umístit, přidat další, upravit jejich polohu a průměr nebo je jednotlivě či všechny odstranit. Změny lze vrátit přes Zpět a ukládají se s projektem i do JSON. Uložené ruční výřezy zůstávají beze změny. Smazané výřezy se při automatickém rozvržení samy neobnovují; u starších nástrojů se přidají až na vaše přání.

Výřezy mají stejnou hloubku jako kapsa nástroje. Jejich prostor se započítává do automatické velikosti modulu a výrobních exportů STL, SVG, DXF i zkušebního PDF. Skutečný naměřený obrys a rozměry nástroje se nemění. U ručně zmenšeného nebo zamčeného modulu musí zbýt dost místa na stěnu; neplatné výřezy je potřeba upravit nebo modul zvětšit.

## Popisky velikostí v modelu

U vybraného nástroje upravte **Popisek velikosti**, například `13 mm`, `1/2 in` nebo `PH2`. Katalog předává jmenovité velikosti; u fotografie zadejte skutečnou velikost sami. Změna měřítka obrysu jmenovitou velikost nemění. Vlastní text má přednost a ukládá se do JSON.

Volbu **Popisky velikostí v modelu** zapnete v rozměrech šuplíku, u vybraného nástroje nebo při exportu STL. Text se skutečně vyryje do výrobní geometrie do hloubky 0,35 mm a je čitelný při pohledu na horní plochu vytištěného dílu, také u popisku otočeného o 90°. Plné provedení používá horní plochu dílu; úsporné provedení vytvoří nízký štítek spojený se dnem stejného tělesa. Umístění popisku respektuje kapsy, výřezy pro prsty a stěny. Při převodu z obrazovky do výrobních souřadnic se převede celé těleso včetně kapes, schodového obrysu, popisků a spojek, aby horní pohled na STL zachoval stejné uspořádání jako 2D návrh. Stejný výrobní souřadnicový systém používá 3D náhled.

Tiskové písmo podporuje čísla, latinku bez diakritiky a běžné značky rozměrů. Pokud chybí velikost, text obsahuje nepodporované znaky nebo u kapsy nezbývá bezpečné místo, popisek se vynechá. Nastavení šuplíku a export zobrazí počet vynechaných popisků a konkrétní důvody.

## Výroba a modularita

Výchozí rastr je **42 mm**. Automatická velikost modulu se zaokrouhluje nahoru do rastru; ručně lze zadat vlastní rozměry v milimetrech. Skutečné vnější rozměry jsou o 0,5 mm menší než jmenovité rozměry modulu, aby sousední díly měly montážní mezeru. Nabídka exportu obsahuje plné a úsporné provedení, hladké dno, patky Gridfinity, kapsy pro magnety a variantu k lepení. Patky Gridfinity vyžadují rastr a rozměry v násobcích 42 mm; systém neobsahuje stohovací lem.

Při volbě dna **Gridfinity** se pod moduly zobrazí podkladová mřížka s roztečí 42 mm. Začíná v levém horním rohu šuplíku a obsadí celé buňky; zbytek šířky a hloubky zůstane vpravo a dole. Tlačítko **Exportovat základnu Gridfinity** připraví samostatné STL díly základny podle tiskové podložky. Základna má skutečné průchozí tvarované otvory pro patky a výšku 5 mm. Schodový modul má patky jen pod obsazenými buňkami a magnety pouze v bezpečném materiálu.

3D náhled podkladu je záměrně lehčí: do 64 polí používá zjednodušený profil, do 400 polí obrysy otvorů a u větší sestavy jen vnější obrys s upozorněním. Otvory zůstávají otevřené. Výrobní STL základny zachovává celý profil; náhled samotných nástrojových modulů dál vychází z jejich výrobní sítě. Rozměrovým podkladem jsou [Gridfinity Rebuilt – základna](https://github.com/kennetek/gridfinity-rebuilt-openscad/blob/main/src/core/gridfinity-baseplate.scad) a [specifikace Gridfinity](https://github.com/gridfinity-unofficial/specification). Princip korekce dvěma kolmými pravítky odpovídá [afinní transformaci](https://docs.opencv.org/4.x/d4/d61/tutorial_warp_affine.html).

**STL** obsahuje uzavřenou trojúhelníkovou geometrii s opravdovými zapuštěnými kapsami a dnem; jednotky jsou milimetry. ZIP umožňuje získat samostatné díly pro tisk. **SVG a DXF** obsahují obrysy modulů a kapes v milimetrech pro další zpracování, například řezání pěny. Nevytvářejí dráhy CNC ani G-code. Nastavená vůle zvětšuje obrys kapsy; rohy se zaoblují s tolerancí přibližně 0,015 mm.

Rozměry tiskové podložky se řeší až při **exportu STL**. Při úpravách šuplíku, vkládání sad, změně velikosti ani rozložení nic neomezují. V exportu vyberete moduly pro jednu dávku a nastavíte tiskovou podložku. Větší hotové 3D modely se rozříznou na tisknutelné části; nástroje se nepřeskládávají a původní moduly si zachovají rozměry i polohu. Řez může procházet kapsou nástroje. ZIP obsahuje STL soubory jednotlivých částí a mapu jejich sestavení se souřadnicemi a řeznými rovinami. Samotné rozdělení ani stažení nemění projekt nebo historii Zpět/Znovu. Ruční změny výrobních nastavení se ukládají běžným způsobem; výběr modulů pro dávku zůstává jen v dialogu. SVG a DXF se podle tiskové podložky neřežou.

Volba **Spojky mezi tiskovými díly (puzzle)** přidává skutečné výstupky a odpovídající zdířky také mezi částmi rozdělenými podle podložky, včetně sousedních částí různých původních modulů. Spojované moduly exportujte společně. Spojky leží ve vrstvě dna; další díl se nasazuje shora. Plán ponechává prostor pro výstupek a ověřuje skutečné vnější rozměry hotového STL proti podložce. Kapsy, stěny, štítky a magnetové otvory chrání před zásahem spojky. Pokud na společné hraně nezbývá bezpečné místo, export ji uvede jako nespojenou v dialogu a v `assembly.json`. Magnetové dno lze kombinovat s puzzle spoji; u patek Gridfinity se spojky nepřidávají. 3D náhled zobrazuje skutečné tiskové díly včetně řezů a spojek ze stejného výrobního plánu; spoje ve vrstvě dna mohou být při pohledu shora zakryté, proto je zkontrolujte také zespodu.

Mapa sestavení `assembly.json` ve verzi 2 rozlišuje fyzické souřadnice pro sestavení STL (`assemblyTransform`, X doprava, Y nahoru) a souřadnice původního 2D návrhu (`layoutTransform`, X doprava, Y dolů). Každý díl nese obě matice i případné otočení o 90° pro tisk. Sestavení fyzických dílů používá pouze otočení a posuny; nepřevrací je zrcadlově.

Pole **Boční vůle spoje v XY na každé straně** se ukládá s projektem a JSON jako `jointClearance`. Výchozích **0,20 mm na stranu** znamená zdířku širší celkem o **0,40 mm**; výstupek se nemění. Povolený rozsah je 0–1 mm a svislou vůli toto pole nemění. Jde o naši výchozí konstrukční hodnotu pro zkoušku. [Prusa – návrh pro 3D tisk](https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135) vysvětluje závislost na tiskárně, geometrii a materiálu a uvádí pro pohyblivé díly alespoň 0,3 mm, aniž rozlišuje vůli na stranu a celkovou vůli; tento údaj proto nepřebíráme jako hodnotu našeho pole.

Před celou sestavou použijte **Zkušební tisk spojky**. ZIP obsahuje dva malé díly se stejnou výrobní geometrií výstupku a zdířky jako finální export, zadanou vůlí a tloušťkou dna. Vytiskněte je stejným materiálem a profilem; při tuhém spojení vůli zvětšete, při volném zmenšete. Rozšíření první vrstvy řešte samostatně podle [Prusa – kompenzace sloní nohy](https://help.prusa3d.com/article/elephant-foot-compensation_114487). Geometrické testy ověřují uzavřenost a rozměry STL; skutečné lícování konkrétní tiskárny a materiálu musí potvrdit zkušební výtisk.

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
