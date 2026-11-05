# Ověření Android balíčku

Záznam 5. 11. 2026: finální `assembleDebug bundleRelease lintDebug validateReleaseBundle dumpReleaseManifest` prošlo za 32 s (88 úloh; 49 vykonaných, 39 aktuálních). Vznikly skutečné soubory APK/AAB. Podklady: `artifacts/android-release-validation.log`, `artifacts/android-verification.json` a `artifacts/apk-signature-final.log`.

Použité nástroje: Gradle 9.3.1, AGP 9.1.1, Android SDK 37.0, Build Tools 36.0.0, JBR 25.0.2, AndroidBrowserHelper 2.7.4. Manifest cíluje API 36. První skutečný build prokázal minimum API 24 v současné knihovně; konfigurace byla opravena z 23 na 24, bez overrideLibrary.

Testy generátoru Digital Asset Links: 3/3. Generátor vyžaduje skutečný certifikát; nic nebylo vloženo na hosting. XML a origin asset statement byly zkontrolované. Launcher vychází ze stávajícího loga.

| Kontrola | Výsledek |
|---|---|
| Testovací APK | 5 232 666 B; apksigner potvrzuje platný debug podpis |
| Nepodepsaný release AAB | 3 576 715 B; oficiální bundletool validace prošla, v archivu nejsou produkční podpisové soubory |
| Výsledný manifest z AAB | com.insertcreator.app, verze 1.0.0/code1, minimum API24, targetAPI36; přímé spuštění https://insertcreator.com/mobil/ |
| Nativní knihovny v AAB | Žádné; ONNX/WASM patří webovému runtime |
| Android lint | 0 chyb, 3 doporučení: novější cílové API, novější Gradle a monochromatická ikona. Target 36 splňuje aktuální požadavek Play; nástroje jsou připnuté na kompatibilní sestavu. Monochromatická ikona je přítomná ve variantě v33, lint přesto hlásí doporučení pro adaptivní ikony. Varování nejsou potlačená. |
| Nezávislá kontrola konfigurace | Druhý agent nezjistil blokující chybu v manifestu, podpisování nebo přípravě doménové vazby |

APK SHA-256: `1F9954D5E26F8CB68FE3A4E38AD4F7285D8A3472489AFAFC85C69D814DFFEF87`. AAB SHA-256: `68841706045E33322E119CD2A4A6A9112AA5BFB015D4992551DF88B7A9EB9F78`.

Launcher používá vektorovou/adaptivní variantu stávajícího znaku, včetně monochromatické varianty pro Android 13+. Původní PNG je zachované beze změny v `play/icon-512.png`. Testovací privátní klíč je pouze v ignorované `.local` a nevkládá se do zdrojového ani předávacího balíčku. Nativní zálohy jsou vypnuté; webová data patří prohlížeči a řídí se jeho pravidly.

Zatím neověřeno na fyzickém Androidu ani emulátoru: systémové snímky emulátoru nejsou nainstalované a zařízení není připojené. Bez Play účtu a finálního podpisu není otestované propojení domény/TWA, instalace z Play, Android fotoaparát, sdílení souborů, klávesnice ani skutečný životní cyklus aplikace. Kontrola AAB/APK sama tyto průchody nedokazuje.

Před publikací zůstávají skutečný upload podpis a Play App Signing certifikát, veřejná finální privacy policy s odkazem v aplikaci, ověřené Data Safety, store obrázky, testovací instalace a požadavky nového účtu. Připravené soubory nejsou publikace ani záruka schválení Googlu.
