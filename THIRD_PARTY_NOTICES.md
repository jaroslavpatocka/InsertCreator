# InsertCreator: použité součásti a licence / components and licences

Stav soupisu / inventory date: 2026-11-04.

Veřejné stránky dodávané s aplikací: [česky](dist/licenses.html), [English](dist/licenses-en.html). Na nasazeném webu jsou dostupné jako `licenses.html` a `licenses-en.html` ve stejném adresáři jako aplikace.

Public pages bundled with the application: [Czech](dist/licenses.html), [English](dist/licenses-en.html). On a deployed site, they are available as `licenses.html` and `licenses-en.html` beside the application.

## Rozsah / scope

InsertCreator kombinuje vlastní aplikační kód s knihovnami, fonty, obrazovým modelem a geometrickými podklady dalších autorů. Pro vlastní kód aplikace zatím není deklarována celková licence. Licence konkrétních součástí níže automaticky nelicencují celý program; zveřejnění zdrojového kódu samo o sobě není open-source licencí. Tento soupis žádnou novou licenci k vlastnímu kódu neuděluje.

InsertCreator combines its own application code with third-party libraries, fonts, an image model and geometry assets. No overall licence has yet been declared for the application's own code. The component licences below do not automatically license the entire program; publishing source code does not itself provide an open-source licence. This inventory grants no new licence to the application's own code.

## Knihovny / libraries

| Součást / component | Autor a použití / author and use | Licence a úplné texty / licence and complete texts |
| --- | --- | --- |
| Earcut 3.0.2 | Mapbox; triangulace / triangulation | ISC: [bundled text](dist/vendor/earcut.LICENSE); [upstream version](https://github.com/mapbox/earcut/tree/v3.0.2) |
| JavaScript Clipper 6.4.2.2 | Angus Johnson; JavaScript translation by Timo Kähkönen; polygon clipping/offsetting | Boost Software License 1.0: [bundled text](dist/vendor/clipper.LICENSE); [bundled provenance](dist/vendor/clipper.README.md); [official project](https://sourceforge.net/p/jsclipper/wiki/Home%206/) |
| JSBN subset within Clipper | Tom Wu; aritmetika velkých čísel / big integer arithmetic | Separate permissive Tom Wu licence: [complete bundled text](dist/vendor/jsbn.LICENSE); [official Clipper licensing explanation](https://sourceforge.net/p/jsclipper/wiki/Home%206/#licence) |
| ONNX Runtime Web 1.20.1 | Microsoft and contributors; místní inference WASM / local WASM inference | MIT and applicable third-party notices: [MIT](dist/vendor/ort/LICENSE), [ThirdPartyNotices.txt](dist/vendor/ort/ThirdPartyNotices.txt); [upstream version](https://github.com/microsoft/onnxruntime/tree/v1.20.1) |

Místní adaptace Clipperu na ES modul je uvedena v přibalené licenci. Licence JSBN je samostatná: samotný text Boost nestačí pro tuto přibalenou část. Při šíření knihoven zachovejte jejich příslušné copyrighty, licenční texty a oznámení podle úplných podmínek.

The bundled Clipper licence records the local ES module adaptation. JSBN has a separate licence: the Boost text alone does not cover that bundled portion. Retain the applicable copyrights, licence texts and notices when redistributing the libraries, as required by their complete terms.

## Obrazový model / image model

- **U2Netp / U-2-Net:** Xuebin Qin and the U-2-Net authors. Original project: Apache License 2.0. [Complete bundled licence](dist/models/U2NET-LICENSE), [official project](https://github.com/xuebinqin/U-2-Net).
- **ONNX conversion/distribution:** rembg, Daniel Gatis and contributors; MIT. [Complete bundled licence](dist/models/REMBG-LICENSE), [official rembg model session](https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2netp.py).
- The bundled `u2netp.onnx` comes from rembg release `v0.0.0`. [Provenance, original download link and checksum](dist/models/README.txt).

Váhy modelu jsou samostatný podklad, odlišný od aplikačního kódu. Zachovejte jejich dokumentovaný původ a příslušné licence a oznámení. Tento soupis neověřuje trénovací data a netvrdí, že celý systém je „plně open-source AI“.

Model weights are a separate asset from application source code. Retain their documented provenance and the applicable licences and notices. This inventory does not audit training data or claim the entire system is “fully open-source AI”.

## Fonty / fonts

| Font | Autoři / authors | Licence |
| --- | --- | --- |
| DM Sans 4.004 | DM Sans Project Authors; Colophon Foundry, Jonny Pinhorn in bundled metadata | SIL OFL 1.1: [complete bundled text](dist/fonts/DM-Sans-OFL.txt); [upstream](https://github.com/googlefonts/dm-fonts) |
| Manrope 4.505 | Manrope Project Authors; Mikhail Sharanda in bundled metadata | SIL OFL 1.1: [complete bundled text](dist/fonts/Manrope-OFL.txt); [upstream](https://github.com/googlefonts/manrope) |

Při šíření fontů zachovejte copyright a OFL. Fonty se nesmějí prodávat samostatně; upravené verze podléhají dalším podmínkám úplné OFL. Podmínka zachování OFL pro fonty sama o sobě nevyžaduje stejnou licenci pro dokumenty vytvořené jejich použitím.

Retain font copyright notices and the OFL when redistributing fonts. Fonts may not be sold by themselves; modified versions remain subject to the complete OFL terms. The requirement to preserve the OFL for fonts does not by itself apply the same licence to documents created using them.

## Katalogové podklady / catalogue assets

### Poly Haven — CC0 1.0

16 obrysů vzniklo z 15 modelových podkladů. Převzata byla geometrie bez textur; převod zahrnuje projekci do horního pohledu, zarovnání a zjednodušení siluety. Autoři: BKS, Mateusz Sadek, Will Evarts, John Hutcheson, PierreB3D, Dylan Detwiller, James Ray Cock, Ulan Cabanilla, Tics, Dabou Master, Kuutti Siitonen.

16 outlines were derived from 15 source models. Geometry without textures was imported; conversion includes top-view projection, alignment and silhouette simplification. The artists are listed above. CC0 permits use and redistribution, including commercial use, without mandatory attribution; credit is nevertheless retained here and in the provenance documents.

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

Při sdílení podkladu nebo jeho odvozenin uveďte autora, zdroj, odkaz na licenci a příslušné změny. Aktuální projektové a výrobní exporty nepřipojují všechny tyto údaje automaticky. Při dalším sdílení je proto doplňte například přiloženým README; tento soupis netvrdí, že exporty již atribuci automaticky zachovávají.

When sharing the asset or adaptations, provide the author, source, licence link and applicable changes. Current project and manufacturing exports do not automatically attach all these details. Add them when sharing, for example in an accompanying README; this inventory does not claim exports already preserve attribution automatically.

### Parametrické obrysy InsertCreator / InsertCreator parametric outlines

Pro 230 generovaných obrysů podle jmenovitých rozměrů je v [generátoru](dist/catalog/parametric.js) deklarováno CC0 1.0. Tato deklarace nelicencuje zbytek aplikace ani texty norem DIN/ISO. [Úplný právní text CC0](https://creativecommons.org/publicdomain/zero/1.0/legalcode).

The [generator](dist/catalog/parametric.js) declares CC0 1.0 for 230 outlines based on nominal dimensions. That declaration does not license the rest of the application or DIN/ISO standards texts. [Complete CC0 legal text](https://creativecommons.org/publicdomain/zero/1.0/legalcode).

## Reference a vývojové nástroje / references and development tools

Odkazy na Gridfinity, DIN/ISO a další návrhové nebo rozměrové reference samy o sobě neznamenají převzetí jejich programového kódu. Rozměrová kompatibilita, inspirace, převzatý model a převzatá knihovna jsou různé věci. Tento soupis nezaručuje nezávislý vznik každého řádku kódu.

References to Gridfinity, DIN/ISO and other design or dimensional sources do not by themselves mean their program code was adopted. Dimensional compatibility, inspiration, imported models and imported libraries are different things. This inventory does not establish independent authorship of every line of code.

Vývoj/testy používají také `@napi-rs/canvas` 1.1.0 (MIT), `happy-dom` 21.0.4 (MIT) a `pdfjs-dist` 4.10.38 (Apache 2.0). Nejsou součástí statické aplikace publikované z `dist/`. Úplný strom závislostí je zaznamenán v `package-lock.json`.

Development/tests also use `@napi-rs/canvas` 1.1.0 (MIT), `happy-dom` 21.0.4 (MIT) and `pdfjs-dist` 4.10.38 (Apache 2.0). They are not part of the static application published from `dist/`. The complete dependency tree is recorded in `package-lock.json`.

Tento soupis shrnuje použití součástí. Úplné podmínky stanoví odkazované licence a dokumentace původu; při další distribuci příslušné texty zachovejte.

This inventory summarises component use. The linked licences and provenance documents provide the complete terms; retain the applicable texts when redistributing.
