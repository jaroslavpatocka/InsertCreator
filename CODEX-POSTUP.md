
## 2026-11-10 — menu celé aplikace (Codex)

Desktop i samostatný mobil mají sjednocené nativní rozbalovací skupiny. Výchozí stav je sbalený; během práce se zachovává rozbalení, fokus a scroll. Pravý panel: výběr/šuplík → nástroje a moduly → výroba → export. Vlastnosti nástroje, kapsa/vůle/stěny, úchopy, magnety, popisek a modul mají vlastní názvy. Seznam modulů vybírá i prázdné kontejnery. Příkazy pro rozměry a 3D skutečně odhalí cílové nastavení.

Seskupeny jsou také editory kontury, vlastního modulu a výřezů, průvodci, katalogové nastavení sady, nápověda, nastavení aplikace a mobilní nabídka Více. V exportu jsou sbalené výběr modulů a podložka s viditelnými souhrny; formát a stažení zůstávají dostupné. Klávesnice rozlišuje záhlaví/formuláře od geometrie, plovoucí nabídky zavírá Escape a kliknutí ven. Modalní fokus zahrnuje summary a nechodí do sbalených polí. Exportní checkboxy drží fokus i scroll po přepočtu.

Zdroje pravidel: https://www.nngroup.com/articles/progressive-disclosure/ ; https://www.w3.org/WAI/ARIA/apg/patterns/accordion/ ; https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html . Primární krok zůstává dostupný, související druhotné volby jsou označené a sbalené, skupiny používají native details/summary a 44px dotykové cíle.

Cílené testy a nezávislý review prošly. Kompletní sady právě běží nad 785 zmrazenými source/test soubory. Oba npm check a diffcheck prošly; oficiální sync má 210 mobilních souborů. 24 aktuálních HTTP assetů desktop + /mobil na localhost5173 je200 a byte-identických. Souhrn výsledků doplní artifacts/ui-menu-redesign/result.json po úplném běhu.

Browser/telefon: nativní vizuální kontrolu nástroj Computer Use zastavil, protože nedokázal důvěryhodně ověřit aktuální Windows URL. Žádný bypass, headless browser ani fyzické zařízení se netvrdí. Cizí rozpracovaná geometrie, kalibrace/NN a ostatní lokální změny zachovány; žádný push/deploy.


### Menu UI — konečný výsledek 10.11.2026

HOTOVO MÍSTNĚ. Finální UI recheck desktop 24/24, mobil 26/26, exit0/fail0/skip0/cancel0. Celé sady skončily desktop1935/1938, mobil1996/1999, v každé pouze3 stará UI očekávání (viditelná Gridfinity volba a2původní selektory funkční kapsy). Testy byly přizpůsobeny novému členění a oba celé soubory Gridfinity+funkční kapsa prošly v závěrečném rechecku spolu se všemi novými menu/editor/guide testy. Celé sady po těchto čistě testových úpravách znovu neběžely; jejich exit1 se nepřepisuje na passing. Runtime bezezměn během posledních celých sad.785aktuálních source/testSHA a210mobilních souborů podle manifestu ověřeny. Oba check+diffcheck prošly;27HTTPassetů/stránek200byte-identických nalocalhost5173 včetně /mobil/ a /en/.

Nezávislý review bez otevřeného blokujícího nálezu. Žádný push/deploy; cizí rozpracované změny zachovány. Vizuální browser QA blokována neověřitelným aktuálním WindowsURL; žádný fyzický telefon. Podrobný pravdivý protokol: artifacts/ui-menu-redesign/result.json. Vlastní zdroje uvolněné.
