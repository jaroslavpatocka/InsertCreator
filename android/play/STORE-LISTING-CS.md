# Google Play – český text nabídky

Vydavatel: Jaroslav Patočka

Podpora: admin@insertcreator.com

Web aplikace: https://insertcreator.com/mobil/

Následující tři bloky jsou určeny do polí nabídky. Technické poznámky pod nimi do popisu nekopírovat. Limity polí jsou 30 / 80 / 4 000 znaků podle [Google Play: vytvoření a nastavení aplikace](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en).

## Název

```text
InsertCreator
```

## Krátký popis

```text
Navrhujte organizéry do šuplíku z fotografie. Rozpoznání běží ve vašem zařízení.
```

## Úplný popis

```text
Připravte každému nástroji místo v šuplíku. InsertCreator převede fotografii nářadí na obrysy, ze kterých vytvoříte modulární organizér pro 3D tisk nebo výřez.

OD FOTOGRAFIE K NÁVRHU
Vyfoťte oddělené nástroje shora nebo vyberte fotografii ze zařízení. Měřítko nastavíte pomocí papíru A4 nebo známé vzdálenosti na pravítku. Aplikace zpracuje snímek lokálně, oddělí nástroje od pozadí a připraví jejich obrysy. Výsledek před přidáním zkontrolujete, nástroje pojmenujete a nastavíte hloubku kapes.

ROZLOŽENÍ PODLE VAŠÍ DÍLNY
Zadejte vnitřní rozměry šuplíku, přidávejte jednotlivé nástroje i sady a upravujte jejich moduly. Automatické rozložení pomůže využít volné místo. Polohy hotových modulů lze zamknout a později kolem nich doplnit další nářadí.

KONTROLA VE 2D I 3D
Přibližujte návrh, vybírejte nástroje klepnutím a upravujte jejich rozměry, natočení, vůli i hloubku. K dispozici jsou výřezy pro prsty a nastavení magnetů. Pro kompatibilní sestavu můžete zvolit základnu Gridfinity s roztečí 42 mm.

PODKLADY PRO VÝROBU
Exportujte STL, 3MF nebo balík ZIP pro 3D tisk, SVG a DXF pro další zpracování nebo PDF v měřítku 1:1 pro kontrolu rozměrů. Před výrobou celé sestavy si ověřte rozměry a vůli pomocí papírové předlohy nebo zkušebního výtisku. Rozpoznání z fotografie nenahrazuje fyzické přeměření nástroje.

PROJEKTY VE VAŠEM ZAŘÍZENÍ
Fotografie se k rozpoznávání neodesílají na vzdálený server. Šuplíky a knihovna nástrojů se ukládají v místním úložišti prohlížeče. Účet není potřeba. Zálohu a přenos návrhu mezi zařízeními zajistí export a import JSON.

Při prvním použití je potřeba připojení pro načtení aplikace a rozpoznávacího modelu. Uložená data mohou zmizet při vymazání dat webu nebo prohlížeče, proto důležité projekty pravidelně zálohujte do JSON.

Aplikace je dostupná česky a anglicky a podporuje zadávání rozměrů v milimetrech i palcích. Výrobní soubory používají milimetry.

Podpora: admin@insertcreator.com
```

## Podklady, které ještě chybí

- **Feature graphic:** 1 024 × 500 px, JPEG nebo PNG bez průhlednosti. V auditovaném stromu není připravený podklad pro Google Play.
- **Nejméně dva skutečné snímky finální aplikace:** JPEG nebo PNG bez průhlednosti; strany 320–3 840 px, delší strana nejvýše dvojnásobkem kratší. Snímky musí zachycovat skutečný vzhled a funkce. Současné geometrické QA obrázky tyto podklady nenahrazují. [Požadavky Google Play na grafiku a snímky](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en)
- **Zásady ochrany soukromí:** veřejná HTML stránka a odkaz uvnitř aplikace; návrh v [PRIVACY-DRAFT.md](PRIVACY-DRAFT.md) obsahuje dosud nepotvrzené údaje o hostingu.

Existující logo `../../dist/mobil/icon-512.png` má 512 × 512 px, RGBA a 4 846 bajtů. Obrázek má plné neprůhledné pozadí bez vnějšího zaoblení nebo stínu. Před nahráním ještě ověřit barevný prostor sRGB. [Specifikace ikony pro Google Play](https://developer.android.com/distribute/google-play/resources/icon-design-specifications)

Popis netvrdí ověření konkrétního fyzického telefonu, funkci nativního fotoaparátu či systémového sdílení na všech zařízeních ani neomezený provoz offline. Konkrétní chování musí potvrdit test podepsané Android aplikace.
