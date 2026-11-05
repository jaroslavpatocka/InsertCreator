# Google Play Data Safety – pracovní podklad

**Návrh pro kontrolu, dosud ne finální odpovědi k odeslání.** Vydavatel: Jaroslav Patočka, kontakt admin@insertcreator.com. Rozsah: Android aplikace otevírající mobilní web pomocí TWA přímo na `https://insertcreator.com/mobil/`.

Audit vychází ze zdrojového snímku `dist/mobil/`, jehož manifest `mobile-release.json` uvádí zdrojový commit `b820c376b5d1024b12fa72e344706fc73b6b2bc1`. Budoucí změny webu i finálního Android balíčku musí být znovu posouzeny.

## Co je doložené zdroji

| Data nebo přístup | Současné chování mobilního webu | Podklad pro formulář |
| --- | --- | --- |
| Vybraná fotografie | Dekódování a rozpoznávání v zařízení; není odeslána rozpoznávací službě. Do nástroje se uloží geometrie a metadata, nikoli původní snímek. | Samotné lokální zpracování není deklarováno jako sběr mimo zařízení. |
| Projekty, názvy, kontury, rozměry a knihovna | Lokální úložiště `insertcreator-mobile:*`; bez automatické synchronizace na server. | Pro tuto implementaci není doložen vzdálený sběr obsahu projektů. |
| Nastavení jazyka a jednotek | Místní úložiště prohlížeče. | Stejný lokální rozsah. |
| JSON import a výrobní exporty | Uživatel vybere soubor nebo uloží vytvořený Blob do zařízení. | Nebyl nalezen upload na server vydavatele. |
| Sdílení exportu jiné aplikaci | Až po výslovném klepnutí; systémový výběr příjemce. | Posoudit jako očekávaný přenos vyvolaný uživatelem, který může spadat do výjimky z deklarovaného sdílení. |
| Účet a přihlášení | Současný web účet nevytváří a nevyžaduje přihlášení. | Žádný serverový účet ke smazání není v této implementaci doložen. |
| Analytika a reklama | Reklama není. Google Analytics `G-6CMM882CWH` běží i v mobilní verzi, ale až po výslovném souhlasu v liště (`dist/mobil/consent.js`). Reklamní funkce a Google signály jsou vypnuté. | **Deklarovat:** sběr a sdílení s Googlem pro účel Analytika, volitelné pro uživatele. Konkrétní datové typy ověřit podle dokumentace Googlu. |
| Poloha, kontakty, mikrofon, SMS | V auditovaném mobilním kódu nebyl nalezen přístup k těmto rozhraním. | Zkontrolovat také oprávnění v podepsaném Android balíčku. |

Google vymezuje sběr podle přenosu mimo zařízení, místní zpracování z této definice vyjímá a uvádí výjimku pro očekávané sdílení na konkrétní pokyn uživatele. Rozhodnutí musí zahrnout celý výsledný produkt i jeho dodavatele. [Oficiální definice a formulář Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)

Zdrojová evidence: `dist/mobil/capture.js` načítá uživatelem vybraný snímek; `capture-tools.js:92` sestavuje nástroj z geometrie a metadat; `neural-worker.js:9–14` načítá vlastní lokální runtime a model; `model.js:72–74`, `i18n.js` a `units.js` používají mobilní namespace; `ui.js:108` volá systémové sdílení v obsluze klepnutí. Service worker obsluhuje GET pouze ve vlastním originu a scope.

## Co zbývá potvrdit před odesláním

1. **Hostingové a případné CDN/proxy logy:** zda a kdo ukládá IP adresy, hlavičky prohlížeče, URL požadavků, čas nebo cookies; za jakým účelem, komu jsou dostupné a jak dlouho jsou uchovávány. Tyto údaje se nedají určit z klientského JavaScriptu. Nedomýšlet jejich neexistenci ani retenční dobu.
2. **Finální Android balíček:** skutečná oprávnění, knihovny/SDK, síťové chování a přímá startovací cesta `/mobil/`. Audit webu není audit AAB.
3. **Živé mobilní odpovědi:** absence přidané serverové analytiky, měření návštěvnosti a jiných injektovaných skriptů. Síťové požadavky ověřit na Android zařízení nebo emulátoru.
4. **Prohlížeč a jeho úložiště:** TWA používá poskytovatele prohlížeče; ověřit předání oprávnění a datové chování obalu. Nezaměňovat vlastní nastavení/telemetrii prohlížeče za doložené zpracování vydavatelem.
5. **Zásady ochrany soukromí:** doplnit skutečné údaje o hostingu a uchovávání a následně zajistit shodu s formulářem. Google požaduje zásady a Data Safety také u aplikací bez deklarovaného sběru. [Zásady User Data](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en)

Do vyřízení těchto bodů **neodesílat globální prohlášení „žádná data se nesbírají“**. U bezpečnostních odpovědí ověřit HTTPS a chování finálního balíčku; nepřisuzovat aplikaci nezávislý bezpečnostní audit, který neproběhl.

## Analytika po souhlasu

Kořenový i mobilní web načítají Google Analytics `G-6CMM882CWH` výhradně po souhlasu přes `consent.js`. Před volbou ani po odmítnutí se ke Googlu nic neposílá. Souhlas lze odvolat odkazem Nastavení cookies v patičce. Odpověď „žádná data se nesbírají“ proto není pravdivá.
