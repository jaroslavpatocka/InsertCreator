# Šuplík Studio

Česká aplikace pro návrh modulárních inzertů do šuplíku. Fotografie se zpracovávají lokálně v prohlížeči. Aplikace nepotřebuje účet, placené API ani server pro výpočty.

## Spuštění

Vyžaduje Node.js 20 nebo novější. V adresáři projektu spusťte:

```sh
npm run dev
```

Otevřete `http://localhost:5173`. V PowerShellu s blokovanými skripty použijte `npm.cmd run dev`. Není potřeba instalovat závislosti ani provádět build. Pro vlastní hosting stačí zveřejnit obsah `dist/` přes HTTP(S); otevření `index.html` přímo jako soubor není podporováno kvůli ES modulům. Kamera telefonu a instalace aplikace vyžadují HTTPS nebo localhost.

## Od fotografie k inzertu

1. Zadejte vnitřní šířku a hloubku šuplíku v milimetrech.
2. Vyfoťte oddělené nástroje shora na matném světlém podkladu. Nechte kolem nich volné místo a omezte stíny. Pro kalibraci použijte celý viditelný papír A4 nebo pravítko s dobře viditelným známým úsekem.
3. Při kalibraci A4 zkontrolujte všechny čtyři rohy. Aplikace umí narovnat perspektivu roviny papíru. U pravítka označte dva body a zadejte skutečnou vzdálenost; tento režim předpokládá fotografii kolmo k podkladu.
4. Zkontrolujte kontrast a nalezené obrysy. Automatické prahování lze doladit. Vyberte kontury nástrojů, pojmenujte je a zadejte hloubku kapsy.
5. Spusťte automatické rozvržení. Moduly lze přesouvat a nástroje otáčet. Zamknuté moduly a nástroje zůstanou při dalším rozvržení na místě. Přidejte další nástroje nebo rozšiřte rozměry šuplíku a pokračujte ve stejné sestavě.
6. Vyřešte hlášené kolize, přesahy a neplatné hloubky. Potom exportujte podklady.

## Výroba a modularita

Výchozí rastr je **42 mm**. Každý modul je samostatný blok s plochým dnem; rozměry modulu jsou násobky rastru. Skutečné vnější rozměry jsou o 0,5 mm menší, aby sousední díly měly montážní mezeru. Systém nemá standardní patky, magnety ani stohovací lem Gridfinity a nepředstavuje plně kompatibilní Gridfinity model.

**STL** obsahuje uzavřenou trojúhelníkovou geometrii s opravdovými zapuštěnými kapsami a dnem; jednotky jsou milimetry. ZIP umožňuje získat samostatné díly pro tisk. **SVG a DXF** obsahují obrysy modulů a kapes v milimetrech pro další zpracování, například řezání pěny. Nevytvářejí dráhy CNC ani G-code. Nastavená vůle zvětšuje obrys kapsy; rohy se zaoblují s tolerancí přibližně 0,015 mm.

Fotografie nedává zaručenou výrobní přesnost. Stíny, lesklé plochy, výška nástroje nad papírem a perspektiva ovlivňují obrys. Překrývající se nástroje se mohou spojit. Kontrolujte měřítko podle skutečného rozměru a před tiskem celé sestavy vytiskněte jeden zkušební díl. Hloubku kapsy určujete sami; z jedné fotografie ji nelze spolehlivě změřit.

## Projekty a soukromí

Rozpracované projekty se ukládají v úložišti daného prohlížeče. Export JSON slouží jako záloha a pro přenos na jiný počítač či telefon; import vrátí upravitelný projekt. Smazání dat prohlížeče může lokální projekty odstranit. Automatická synchronizace mezi zařízeními není součástí aplikace. Fotografie se neodesílají k rozpoznávání na vzdálený server.

## Ověření a knihovny

```sh
npm ci
npm test
npm run check
```

Instalace závislostí je potřeba jen pro vývojové testy (Happy DOM a rastrové plátno), nikoli pro běh aplikace. Integrační test prochází editor, uložení, rozšíření sestavy, zachování zámků a celý tok ukázkové fotografie. Jde o simulované DOM prostředí, nikoli vizuální test ve skutečném mobilním prohlížeči.

Testy ověřují zpracování obrazu, kalibraci, rozvržení, zachování zámků, kolize, výrobní vůli, metrické exporty, integritu ZIP a uzavřenost i orientaci STL včetně objemu kapsy. Pro triangulaci se používá lokální Earcut 3.0.2 (ISC), pro robustní posun kontur lokální Clipper 6.4.2.2 (Boost Software License). Zdroje a licence jsou v `dist/vendor/`; aplikace je za běhu nestahuje z CDN.
