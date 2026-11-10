# InsertCreator: použité součásti a licence / components and licences

Stav soupisu / inventory date: 2026-11-10 (aktualizace podle auditního nálezu LIC-03 / updated after audit finding LIC-03; předchozí stav / previous inventory: 2026-11-04).

Soupis je ruční a popisuje pracovní stav repozitáře, nikoli konkrétní podepsané vydání. Podrobný auditní inventář: [DEPENDENCY_LICENSES.md](../audit/legal-security/DEPENDENCY_LICENSES.md), [SBOM.cdx.json](../audit/legal-security/SBOM.cdx.json).

This is a manual inventory of the working tree, not of a specific signed release. Detailed audit inventory: [DEPENDENCY_LICENSES.md](../audit/legal-security/DEPENDENCY_LICENSES.md), [SBOM.cdx.json](../audit/legal-security/SBOM.cdx.json).

Veřejné stránky dodávané s aplikací: [česky](dist/licenses.html), [English](dist/licenses-en.html). Na nasazeném webu jsou dostupné jako `licenses.html` a `licenses-en.html` ve stejném adresáři jako aplikace.

Public pages bundled with the application: [Czech](dist/licenses.html), [English](dist/licenses-en.html). On a deployed site, they are available as `licenses.html` and `licenses-en.html` beside the application.

## Rozsah / scope

InsertCreator kombinuje vlastní aplikační kód s knihovnami, fonty, obrazovými modely a geometrickými podklady dalších autorů. Pro vlastní kód aplikace zatím není deklarována celková licence. Licence konkrétních součástí níže automaticky nelicencují celý program; zveřejnění zdrojového kódu samo o sobě není open-source licencí. Tento soupis žádnou novou licenci k vlastnímu kódu neuděluje.

InsertCreator combines its own application code with third-party libraries, fonts, image models and geometry assets. No overall licence has yet been declared for the application's own code. The component licences below do not automatically license the entire program; publishing source code does not itself provide an open-source licence. This inventory grants no new licence to the application's own code.

## Knihovny / libraries

| Součást / component | Autor a použití / author and use | Licence a úplné texty / licence and complete texts |
| --- | --- | --- |
| Earcut 3.0.2 | Mapbox; triangulace / triangulation | ISC: [bundled text](dist/vendor/earcut.LICENSE); [upstream version](https://github.com/mapbox/earcut/tree/v3.0.2) |
| JavaScript Clipper 6.4.2.2 | Angus Johnson; JavaScript translation by Timo Kähkönen; polygon clipping/offsetting | Boost Software License 1.0: [bundled text](dist/vendor/clipper.LICENSE); [bundled provenance](dist/vendor/clipper.README.md); [official project](https://sourceforge.net/p/jsclipper/wiki/Home%206/) |
| JSBN subset within Clipper | Tom Wu; aritmetika velkých čísel / big integer arithmetic | Separate permissive Tom Wu licence: [complete bundled text](dist/vendor/jsbn.LICENSE); [official Clipper licensing explanation](https://sourceforge.net/p/jsclipper/wiki/Home%206/#licence) |
| ONNX Runtime Web 1.20.1 | Microsoft and contributors; místní inference WASM pro U2Netp a FastSAM-s / local WASM inference for U2Netp and FastSAM-s | MIT and applicable third-party notices: [MIT](dist/vendor/ort/LICENSE), [ThirdPartyNotices.txt](dist/vendor/ort/ThirdPartyNotices.txt); [upstream version](https://github.com/microsoft/onnxruntime/tree/v1.20.1) |

Místní adaptace Clipperu na ES modul je uvedena v přibalené licenci. Licence JSBN je samostatná: samotný text Boost nestačí pro tuto přibalenou část. Při šíření knihoven zachovejte jejich příslušné copyrighty, licenční texty a oznámení podle úplných podmínek.

The bundled Clipper licence records the local ES module adaptation. JSBN has a separate licence: the Boost text alone does not cover that bundled portion. Retain the applicable copyrights, licence texts and notices when redistributing the libraries, as required by their complete terms.

## Obrazové modely v prohlížeči / in-browser image models

### U2Netp

- **U2Netp / U-2-Net:** Xuebin Qin and the U-2-Net authors. Original project: Apache License 2.0. [Complete bundled licence](dist/models/U2NET-LICENSE), [official project](https://github.com/xuebinqin/U-2-Net).
- **ONNX conversion/distribution:** rembg, Daniel Gatis and contributors; MIT. [Complete bundled licence](dist/models/REMBG-LICENSE), [official rembg model session](https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2netp.py).
- The bundled `u2netp.onnx` comes from rembg release `v0.0.0`. [Provenance, original download link and checksum](dist/models/README.txt).

### FastSAM-s — nevyřešený licenční rozpor / unresolved licence conflict

- **Soubor / file:** `dist/models/fastsam_s.onnx` (47 637 745 B, SHA-256 `8663b25472f06d36fc90f9b6262318292b760403c69c240360da5d1a3509f1ea`), převzatý beze změn od exportéru / bundled unchanged from exporter [anakhiu/fastsam-onnx](https://huggingface.co/anakhiu/fastsam-onnx/blob/8bb24a5b8339d6494012e5a51b18bb34fbfef07d/README.md), revize / revision `8bb24a5b8339d6494012e5a51b18bb34fbfef07d`; upstream [CASIA-LMC-Lab/FastSAM](https://github.com/CASIA-LMC-Lab/FastSAM/blob/b4ed20c2fed75eadc5aa7d8b09fedd137b873b52/LICENSE), revize / revision `b4ed20c2fed75eadc5aa7d8b09fedd137b873b52`. Načítá jej / loaded by `dist/tool-neural-worker.js` pro lokální návrhy částí nástrojů / for local tool-part proposals.
- **Stav licence:** karta exportéru a upstream README uvádějí Apache-2.0, připnutý upstream `LICENSE` obsahuje AGPL-3.0. Audit navíc zaznamenal metadata `license=AGPL-3.0` přímo v binárním souboru a upstream opravu licence na AGPL ze 7. 11. 2023. Rozpor **není vyřešen**. Tento soupis jej neřeší, nepřeklasifikovává a neurčuje jím licenci aplikace; řešení je vedeno jako auditní nález LIC-01 ([RISK_REGISTER.md](../audit/legal-security/RISK_REGISTER.md), [external-licensing-findings.md](../audit/legal-security/evidence/external-licensing-findings.md)).
- **Licence status:** the exporter model card and upstream README state Apache-2.0; the pinned upstream `LICENSE` contains AGPL-3.0. The audit also recorded `license=AGPL-3.0` metadata inside the binary and an upstream AGPL correction dated 7 November 2023. The conflict is **unresolved**. This inventory does not resolve or relabel it and does not determine the application's licence by it; it is tracked as audit finding LIC-01.
- Přibalené dokumenty / bundled documents: [FASTSAM-PROVENANCE.json](dist/models/FASTSAM-PROVENANCE.json), [FASTSAM-README.txt](dist/models/FASTSAM-README.txt), [FASTSAM-UPSTREAM-LICENSE.txt](dist/models/FASTSAM-UPSTREAM-LICENSE.txt), [FASTSAM-MODEL-CARD.md](dist/models/FASTSAM-MODEL-CARD.md), [FASTSAM-UPSTREAM-README.md](dist/models/FASTSAM-UPSTREAM-README.md).

Váhy modelů jsou samostatné podklady, odlišné od aplikačního kódu. Zachovejte jejich dokumentovaný původ a příslušné licence a oznámení. Tento soupis neověřuje trénovací data a netvrdí, že celý systém je „plně open-source AI“.

Model weights are separate assets from application source code. Retain their documented provenance and the applicable licences and notices. This inventory does not audit training data or claim the entire system is “fully open-source AI”.

## Volitelná místní nativní služba / optional local native service

`scripts/background-server.mjs` může na počítači uživatele spustit volitelné odstranění pozadí modelem **BiRefNet Lite** (`birefnet-lite-1024`). Váhy ani Python závislosti nejsou součástí `dist/` a web je nedistribuuje. Skript přijme jen model o velikosti 224 005 088 B se SHA-256 `5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333`.

`scripts/background-server.mjs` can run optional background removal with **BiRefNet Lite** on the user's own computer. Neither the weights nor the Python dependencies are part of `dist/`, and the website does not distribute them. The script accepts only a 224,005,088-byte model with the SHA-256 above.

- **BiRefNet Lite:** Peng Zheng and coauthors, copyright 2024 ZhengPeng; MIT ([original licence](https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE)). ONNX conversion: [ONNX Community BiRefNet Lite](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/blob/de15b22ba131738a16dff04aab8bdf8dc32e3ac1/README.md), revision `de15b22ba131738a16dff04aab8bdf8dc32e3ac1`. Trénovací data a celý řetězec práv k modelu nebyly auditovány / training data and the full model rights chain were not audited.
- **Ověřované verze / versions checked by the script:** onnxruntime 1.20.1 (MIT), numpy 1.26.4 (BSD-3-Clause s dalšími přibalenými licencemi včetně GCC runtime exception / with further bundled licences including the GCC runtime exception), Pillow 10.4.0 (HPND).
- **Další distribuce v auditovaném prostředí / further distributions in the audited environment:** coloredlogs 15.0.1 (MIT), flatbuffers 24.3.25 (Apache 2.0), humanfriendly 10.0 (MIT), mpmath 1.3.0 (BSD), packaging 24.2 (Apache-2.0 OR BSD-2-Clause), protobuf 5.29.3 (BSD-3-Clause), sympy 1.13.3 (BSD).

Před případným šířením balíčku nativní služby přiložte úplné licenční texty a oznámení skutečných wheel balíčků (včetně NumPy/OpenBLAS/LAPACK/GCC runtime a nativních oznámení ONNX Runtime); souhrny výše je nenahrazují. Pouhé místní spuštění nemodifikovaných nástrojů není jejich šířením.

Before any redistribution of a native-service bundle, include the complete licence texts and notices of the actual wheels (including NumPy/OpenBLAS/LAPACK/GCC runtime and ONNX Runtime native notices); the summaries above do not replace them. Merely running unmodified tools locally is not redistribution of them.

## Fonty / fonts

| Font | Autoři / authors | Licence |
| --- | --- | --- |
| DM Sans 4.004 | DM Sans Project Authors; Colophon Foundry, Jonny Pinhorn in bundled metadata | SIL OFL 1.1: [complete bundled text](dist/fonts/DM-Sans-OFL.txt); [upstream](https://github.com/googlefonts/dm-fonts) |
| Manrope 4.505 | Manrope Project Authors; Mikhail Sharanda in bundled metadata | SIL OFL 1.1: [complete bundled text](dist/fonts/Manrope-OFL.txt); [upstream](https://github.com/googlefonts/manrope) |

Při šíření fontů zachovejte copyright a OFL. Fonty se nesmějí prodávat samostatně; upravené verze podléhají dalším podmínkám úplné OFL. Podmínka zachování OFL pro fonty sama o sobě nevyžaduje stejnou licenci pro dokumenty vytvořené jejich použitím.

Retain font copyright notices and the OFL when redistributing fonts. Fonts may not be sold by themselves; modified versions remain subject to the complete OFL terms. The requirement to preserve the OFL for fonts does not by itself apply the same licence to documents created using them.

## Katalogové podklady / catalogue assets

Každá katalogová položka z cizího zdroje má v `dist/catalog/imported.js` strukturovaný záznam `source` (název, autor, URL, revize, licence, odkaz na licenci, popis změn). Nástroj vložený z Katalogu si z něj nese objekt `attribution` v projektu i v knihovně a výrobní exporty jej připojují: ZIP s tiskovými díly obsahuje `ATTRIBUTION.txt` a údaje v `assembly.json`, soubory 3MF metadata `LicenseTerms`, SVG prvek `metadata`, PDF v měřítku 1:1 viditelný řádek a údaj `/Subject`. Samostatné soubory STL a DXF atribuci nést nemohou; aplikace ji při jejich exportu zobrazí v upozornění. Obrysy CC0 jsou v atribuci označené jako volné dílo. Parametrické obrysy InsertCreatoru a obrysy bez známého zdroje žádnou atribuci nepřidávají.

Each third-party catalogue item has a structured `source` record in `dist/catalog/imported.js` (title, author, URL, revision, licence, licence link, change notes). A tool inserted from the Catalogue carries it as an `attribution` object in the project and library, and manufacturing exports attach it: the print-part ZIP contains `ATTRIBUTION.txt` and the details in `assembly.json`, 3MF files `LicenseTerms` metadata, SVG a `metadata` element, the 1:1 PDF a visible line and a `/Subject` entry. Standalone STL and DXF files cannot carry it; the application shows it in a notice when they are exported. CC0 outlines are marked as public domain in the attribution. InsertCreator parametric outlines and outlines without a known source add no attribution.

### Poly Haven — CC0 1.0

16 obrysů vzniklo z 15 modelových podkladů. Převzata byla geometrie bez textur; převod zahrnuje projekci do horního pohledu, zarovnání a zjednodušení siluety. Autoři: BKS, Mateusz Sadek, Will Evarts, John Hutcheson, PierreB3D, Dylan Detwiller, James Ray Cock, Ulan Cabanilla, Tics, Dabou Master, Kuutti Siitonen.

16 outlines were derived from 15 source models. Geometry without textures was imported; conversion includes top-view projection, alignment and silhouette simplification. The artists are listed above. CC0 permits use and redistribution, including commercial use, without mandatory attribution; credit is nevertheless retained here, in the provenance documents and in export attribution.

- [Bundled licence notice](dist/catalog/sources/polyhaven/LICENSE.txt).
- [Asset list, artists, transformations and checksums](dist/catalog/sources/polyhaven/README.md).
- [Official Poly Haven licence statement](https://polyhaven.com/license), [complete CC0 legal text](https://creativecommons.org/publicdomain/zero/1.0/legalcode).

### FreeCAD-library Digital_caliper — CC BY 3.0

**Attribution:** Digital caliper by hasecilu, FreeCAD-library, CC BY 3.0.

- [Complete bundled asset licence](dist/catalog/sources/freecad-library/LICENSE-Assets.txt).
- [Recorded source revision and complete modification notes](dist/catalog/sources/freecad-library/README.md).
- [Original asset at the recorded revision](https://github.com/FreeCAD/FreeCAD-library/tree/f5ca01cdcaa2f69b9295a6382719c2d90628780c/Industrial%20Design/Hand%20tools/Measuring%20tools/Digital_caliper).
- [CC BY 3.0 terms](https://creativecommons.org/licenses/by/3.0/).

**Úpravy pro InsertCreator:** model byl rozdělen na souvislé části. Všechny části kromě nosníku byly posunuty o 69,0 mm podél nosníku, aby se vnější čelisti zavřely. Následovala projekce do horního pohledu, sjednocení promítnutých trojúhelníků, zarovnání nosníku s osou X a zjednodušení obrysu metodou Douglas–Peucker s tolerancí 0,1 mm. Katalogový obrys je označen jako typický tvar.

**Modifications for InsertCreator:** the mesh was split into connected components. Every component except the beam was moved 69.0 mm along the beam to close the outside jaws. The result was projected into a top view, the projected triangles were unioned, the beam aligned with X, and the outline simplified using Douglas–Peucker with a 0.1 mm tolerance. The catalogue outline is labelled as a typical shape.

Při sdílení podkladu nebo jeho odvozenin uveďte autora, zdroj, odkaz na licenci a příslušné změny. Projekt (JSON) a výrobní exporty tyto údaje připojují podle popisu výše; u samostatných souborů STL a DXF je při sdílení doplňte z upozornění při exportu. Zda je konkrétní funkční obrys nebo kapsa chráněným dílem, tento soupis neposuzuje.

When sharing the asset or adaptations, provide the author, source, licence link and applicable changes. The project (JSON) and manufacturing exports attach these details as described above; for standalone STL and DXF files, add them from the export notice when sharing. This inventory does not assess whether a particular functional outline or pocket is a protected work.

### Parametrické obrysy InsertCreator / InsertCreator parametric outlines

Pro 230 generovaných obrysů podle jmenovitých rozměrů je v [generátoru](dist/catalog/parametric.js) deklarováno CC0 1.0. Tato deklarace nelicencuje zbytek aplikace ani texty norem DIN/ISO. [Úplný právní text CC0](https://creativecommons.org/publicdomain/zero/1.0/legalcode).

The [generator](dist/catalog/parametric.js) declares CC0 1.0 for 230 outlines based on nominal dimensions. That declaration does not license the rest of the application or DIN/ISO standards texts. [Complete CC0 legal text](https://creativecommons.org/publicdomain/zero/1.0/legalcode).

## Android TWA obal / Android TWA wrapper

Samostatně distribuovaný Android obal v `android/` deklaruje v [android/app/build.gradle](android/app/build.gradle) závislost `com.google.androidbrowserhelper:androidbrowserhelper:2.7.4` (Apache-2.0). Sestavení používá Android Gradle Plugin 9.1.1 a Gradle 9.3.1 (build nástroje, nejsou součástí aplikace). Tranzitivní nativní závislosti z dřívějšího sestavení jsou v [DEPENDENCY_LICENSES.md](../audit/legal-security/DEPENDENCY_LICENSES.md) a `audit/legal-security/evidence/license-android-inventory.json`; jde o doklad staršího buildu, ne o nově vyřešený strom. Před vydáním APK/AAB je nutné vygenerovat strom závislostí konkrétního vydání a ověřit, že požadovaná oznámení a licenční texty zůstávají v nativní aplikaci dostupné (auditní nález LIC-05). Mobilní web v `dist/mobil/` tyto Android knihovny neobsahuje.

The separately distributed Android wrapper in `android/` declares `com.google.androidbrowserhelper:androidbrowserhelper:2.7.4` (Apache-2.0) in [android/app/build.gradle](android/app/build.gradle). The build uses Android Gradle Plugin 9.1.1 and Gradle 9.3.1 (build tools, not part of the application). Transitive native dependencies of an earlier build are listed in the audit inventory; that is evidence of a previous build, not a newly resolved tree. Before releasing an APK/AAB, regenerate the release dependency tree and verify that the required notices and licence texts remain accessible in the native app (audit finding LIC-05). The mobile website in `dist/mobil/` does not contain these Android libraries.

## Reference a vývojové nástroje / references and development tools

Odkazy na Gridfinity, DIN/ISO a další návrhové nebo rozměrové reference samy o sobě neznamenají převzetí jejich programového kódu. Rozměrová kompatibilita, inspirace, převzatý model a převzatá knihovna jsou různé věci. Tento soupis nezaručuje nezávislý vznik každého řádku kódu.

References to Gridfinity, DIN/ISO and other design or dimensional sources do not by themselves mean their program code was adopted. Dimensional compatibility, inspiration, imported models and imported libraries are different things. This inventory does not establish independent authorship of every line of code.

Vývoj/testy používají také `@napi-rs/canvas` 1.1.0 (MIT), `happy-dom` 21.0.4 (MIT) a `pdfjs-dist` 4.10.38 (Apache 2.0). Nejsou součástí statické aplikace publikované z `dist/`. Úplný strom závislostí je zaznamenán v `package-lock.json`.

Development/tests also use `@napi-rs/canvas` 1.1.0 (MIT), `happy-dom` 21.0.4 (MIT) and `pdfjs-dist` 4.10.38 (Apache 2.0). They are not part of the static application published from `dist/`. The complete dependency tree is recorded in `package-lock.json`.

Automatické nasazování přes SFTP používá [Paramiko 5.1.0](https://pypi.org/project/paramiko/5.1.0/) (LGPL-2.1) a jeho závislosti. Přesné verze a kontrolní součty jsou v [requirements-deploy.txt](requirements-deploy.txt). Tyto balíčky se instalují pouze do prostředí nasazovací úlohy na GitHubu a nepublikují se v `dist/`. Knihovnu Paramiko neupravujeme; její vlastní licence a licence závislostí zůstávají přibalené v distribučních Python balíčcích.

Automatic SFTP deployment uses [Paramiko 5.1.0](https://pypi.org/project/paramiko/5.1.0/) (LGPL-2.1) and its dependencies. Exact versions and hashes are in [requirements-deploy.txt](requirements-deploy.txt). These packages are installed only in the GitHub deployment job and are not published in `dist/`. Paramiko is used without modification; the Python distributions retain their own licence notices.

Tento soupis shrnuje použití součástí. Úplné podmínky stanoví odkazované licence a dokumentace původu; při další distribuci příslušné texty zachovejte.

This inventory summarises component use. The linked licences and provenance documents provide the complete terms; retain the applicable texts when redistributing.
