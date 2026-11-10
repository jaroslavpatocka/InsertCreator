# Společný vývoj desktopu a mobilu

Desktop má zdroje a webový výstup v `suplik-studio/dist/`. Mobilní aplikace se vyvíjí samostatně v sousední složce `mobil/`, její zdroje jsou `../mobil/dist/`. Pro hlavní web se ověřená mobilní verze kopíruje do `dist/mobil/` a otevírá na cestě `/mobil/`.

`dist/mobil/` je verzovaný publikační snímek. Úpravy mobilu provádějte v `../mobil/`, potom snímek obnovte synchronizačním skriptem. Ruční změna pouze uvnitř snímku by se při další synchronizaci ztratila.

## Postup při každé změně

1. Přečtěte `AGENTS.md`, `../PRACE-AGENTU.md` a aktuální stav obou pracovních kopií. Rozdělte vlastnictví souborů; nepřepisujte ani nezahrnujte do commitu cizí rozpracované změny. Při mobilní kontrole zohledněte také `../mobil/report` a zapište vyřízení nálezů do `../mobil/CODEX-POSTUP.md`; stav ověření v reportu mění jeho vlastník.
2. Funkční změnu nebo opravu promítněte do **desktopové i mobilní verze**. Platí to pro model, geometrii, rozpoznávání, katalog, ukládání, export i související texty. Mobilní navigaci, rozložení a dotykové ovládání zachovejte jako samostatnou vrstvu. Desktopová oprava nesmí mobil vrátit k ovládání myší.
3. Ověřte změněné chování v obou verzích odpovídajícími regresními testy. Pro každý release spusťte v `suplik-studio/` i `mobil/` `npm.cmd test` a `npm.cmd run check`. U změn UI a gest doplňte kontrolu skutečného prohlížeče; DOM test neprokazuje rozměry, překrývání ani chování systémových gest. Rozlišujte emulaci Chrome od Safari a fyzického telefonu.
4. Nové runtime soubory přidejte do offline seznamu příslušné verze a při změně jejího runtime zvyšte verzi cache. Zachovejte samostatný namespace mobilního úložiště `insertcreator-mobile:` a oddělené cache i scope service workerů. Přenos projektu mezi verzemi probíhá přes kompatibilní JSON zálohu, nikoli přímým sdílením klíčů úložiště.
5. Až je mobilní strom stabilní, otestovaný a uvolněný spolupracujícími agenty, spusťte ze `suplik-studio/`:

   ```powershell
   npm.cmd run sync:mobile
   npm.cmd run check
   ```

   Přímý ekvivalent synchronizace je `node scripts/sync-mobile.mjs`. Skript obnoví pouze mobilní publikační snímek. Manifest `mobile-release.json` umožňuje při `npm.cmd run check` ověřit jeho soubory; při neshodě opravte zdroj a synchronizujte znovu. Manifest ručně neupravujte kvůli obejití kontroly.

6. Zkontrolujte diff desktopu, mobilního snímku a manifestu, spusťte `git diff --check` a proveďte finální požadované kontroly nad přesným stromem určeným ke commitu. Poté commitujte a pushujte vlastní změny podle stávajících pravidel projektu.

## CI a nasazení

CI používá mobilní snímek uložený v repozitáři. K jeho kontrole ani nasazení nepotřebuje sousední složku `../mobil/` a nemá ji během běhu vytvářet nebo synchronizovat. Lokální synchronizaci proveďte před commitem; do Git patří už hotový snímek a jeho manifest.

Nasazuje se **celý obsah `dist/` včetně `dist/mobil/`** stávajícím Git a hostingovým postupem popsaným v [DEPLOY.md](DEPLOY.md). Nevytvářejte pro mobil další Site ani jiné nezávislé nasazení. Úspěšný push sám nepotvrzuje dostupnost nové verze na hostingu; ověřte dokončení stávajícího deploymentu a obě webové cesty.

Projekty zůstávají v zařízení a fotografie se běžně zpracují v prohlížeči; jen volitelné odstranění pozadí pošle pixely fotky službě na stejném původu (např. PC v LAN, viz `LOCAL-BACKGROUND-SERVICE.md`). Instalace PWA a offline provoz na telefonu vyžadují HTTPS; běžné LAN HTTP slouží k online zkoušce. Při finálním předání uvádějte konkrétní provedené kontroly a skutečně otestované platformy.
