# Lokální rozpoznávání fyzických nástrojů

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
