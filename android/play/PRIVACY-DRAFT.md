# Zásady ochrany soukromí – InsertCreator

**PRACOVNÍ NÁVRH. Veřejné znění je v `dist/mobil/privacy.html`. Mobilní verze používá po souhlasu Google Analytics, tento návrh k tomu neslouží jako zdroj.**

Verze návrhu: 5. listopadu 2026. Datum účinnosti doplnit při schválení a zveřejnění.

## Vydavatel a kontakt

Vydavatelem aplikace InsertCreator, včetně její mobilní verze InsertCreator Mobil, je **Jaroslav Patočka**. Dotazy k aplikaci a soukromí můžete posílat na **admin@insertcreator.com**.

Tyto zásady popisují mobilní aplikaci dostupnou na `https://insertcreator.com/mobil/` a její Android obal TWA, který tuto adresu otevírá v podporovaném prohlížeči. Před zveřejněním musí být text porovnán s finálním Android balíčkem.

## Fotografie a rozpoznávání

Fotografii aplikaci zpřístupníte jejím výběrem ze zařízení nebo pořízením snímku prostřednictvím nabídky systému či prohlížeče. Webová aplikace pracuje s vybraným snímkem a neprochází celou galerii.

Dekódování fotografie, kalibrace a rozpoznávání obrysů probíhají v zařízení. Fotografie se k rozpoznávání neposílá na vzdálený server. Do návrhu nástroje se ukládají obrysové body, název, rozměry a další zvolené parametry; původní fotografie se do uloženého projektu nepřidává. Původní soubor ve vaší galerii nebo jiném úložišti aplikace nemaže.

## Uložené projekty a nastavení

Šuplíky, knihovna nástrojů, jejich názvy a parametry i nastavení jazyka a jednotek jsou uloženy lokálně v úložišti webu v používaném prohlížeči. Mobilní verze má vlastní klíče s předponou `insertcreator-mobile:`. Automatická synchronizace projektů mezi zařízeními není součástí současné aplikace.

Účet není potřeba a současná aplikace nevytváří serverový uživatelský profil. Návrhy můžete sami zálohovat a přenášet pomocí JSON souboru.

## Stažení a sdílení souborů

Výrobní podklady a zálohy aplikace vytváří v zařízení. Po zvolení stažení se soubor uloží prostřednictvím prohlížeče nebo systému. Při výslovném použití sdílení si sami vyberete cílovou aplikaci či příjemce. Takto předáte vybraný soubor včetně jeho obsahu a názvu; další nakládání závisí na zvoleném příjemci nebo službě.

Soubory, které jste uložili nebo sdíleli mimo aplikaci, spravujete v příslušném úložišti nebo u příjemce. Smazání projektu v InsertCreator tyto kopie automaticky nesmaže.

## Připojení k webu a provozní údaje

Aplikace při online použití načítá své stránky, skripty, fonty a rozpoznávací model z webu InsertCreator. K tomu dochází síťové spojení, při kterém hostovací infrastruktura přijímá údaje potřebné k doručení požadavku, například IP adresu a informace přenesené prohlížečem. Z klientského kódu nelze určit, které z těchto údajů provozovatelé infrastruktury skutečně uchovávají.

**K POTVRZENÍ PŘED ZVEŘEJNĚNÍM:** doplnit skutečného provozovatele hostingu a případné další zpracovatele, rozsah ukládaných logů a cookies, účely a odpovídající podmínky zpracování, příjemce nebo přenosy a přesnou dobu uchovávání či pravidla mazání. Retenční doba nebyla potvrzena a tento návrh ji neurčuje.

Mobilní web používá HTTPS. Způsob předání souboru jiné aplikaci určuje uživatelem vybraný systémový mechanismus a příjemce. Před vydáním se ověří také skutečné síťové chování Android obalu.

## Analytika a další služby

V auditované mobilní verzi na cestě `/mobil/` nebylo nalezeno měření Google Analytics, reklamní SDK ani odesílání fotografií nebo projektů poskytovateli rozpoznávání.

Kořenová desktopová stránka `https://insertcreator.com/` je odlišná verze a ve svém současném HTML obsahuje Google Analytics. Android obal je určen k přímému otevření mobilní cesty `/mobil/`. Pokud sami navštívíte desktopovou stránku, mohou se uplatnit její samostatné datové postupy; konkrétní údaje o desktopovém měření a cookies musí být popsány a ověřeny zvlášť. Před vydáním je třeba ověřit také vliv existujících cookies stejného webu a serverových logů.

## Uchovávání a odstranění místních dat

Místní projekty a nastavení se používají při dalších otevřeních aplikace, dokud je neodstraníte nebo je neodstraní prohlížeč či systém. Jednotlivé šuplíky a položky knihovny můžete mazat v aplikaci. Data webu lze odstranit také ve správě úložiště prohlížeče.

**Před vymazáním dat si uložte důležité projekty jako JSON.** Vymazání dat celého webu `insertcreator.com` může odstranit uložené projekty mobilní i desktopové verze v daném prohlížeči.

TWA používá webové úložiště prohlížeče. Samotné odinstalování Android obalu nemusí data webu v prohlížeči odstranit; pro jejich odstranění použijte nastavení dat webu v příslušném prohlížeči. Vyexportované soubory nebo kopie předané jiné službě odstraňujte tam, kde jsou uloženy.

Máte-li dotaz nebo požadavek týkající se soukromí, napište na admin@insertcreator.com. **K POTVRZENÍ:** pro případné údaje uchovávané hostingem doplnit ověřený postup a pravidla výmazu; nepřislibovat lhůtu nebo technickou možnost, kterou provozní podmínky nepotvrzují.

## Změny zásad

Při změně datových postupů bude text a datum účinnosti aktualizováno. Před vydáním nové verze musí zásady odpovídat aktuálnímu webu, Android obalu a údajům uvedeným v Google Play.

---

## Poznámka pro přípravu veřejné stránky

Google vyžaduje veřejnou, dostupnou HTML adresu zásad a přístup k zásadám také z aplikace. Zásady musí uvést vydavatele nebo aplikaci, kontakt, skutečné datové postupy a pravidla uchovávání a mazání. [Oficiální požadavky Google Play](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en)

Po doplnění provozních údajů odstranit redakční označení návrhu, vložit skutečné datum účinnosti a převést schválený text na veřejnou HTML stránku. Nezveřejňovat nevyplněná místa jako hotovou policy. Přesný odkaz musí následně být v aplikaci i Play Console. Výklad sběru a sdílení pro formulář je veden samostatně v [DATA-SAFETY.md](DATA-SAFETY.md).
