# Nasazení na web

InsertCreator je statická aplikace. Nepotřebuje backend ani databázi; projekt se
nasazuje z adresáře `dist`. Produkční adresa je **https://insertcreator.com**,
webroot na vlastním hostingu je `public_html`.

## Automatické aktualizace z GitHubu

Workflow [deploy.yml](.github/workflows/deploy.yml) kontroluje změny pomocí
`npm ci`, `npm run check`, celé sady `npm test` a testů nasazovacích skriptů.
Po úspěšné kontrole aktuálního commitu na `main` může nahrát celý obsah `dist`
na hosting. Ve výchozím stavu je nasazení **vypnuté**: dokud není nastavena
proměnná `DEPLOY_ENABLED=true`, nic na hosting nezapisuje.

### Jednorázové nastavení

1. Použijte účet, který hosting povoluje pro SFTP. Administrace této služby
   uvádí hlavní FTP účet; samostatný účet omezený na `public_html` použijte,
   pokud jej hosting pro SFTP podporuje. Heslo nevkládejte do chatu,
   zdrojových souborů ani Git historie. Klíč SSH serveru ověřte podle údaje
   z administrace, podpory hostingu nebo již ověřeného SFTP klienta.
2. Otevřete [GitHub → Settings → Environments → ftp](https://github.com/jaroslavpatocka/InsertCreator/settings/environments).
   Uživatel má přístupové údaje uložené v prostředí **`ftp`**; oba připojovací
   workflow toto prostředí používají. Přes **Add environment secret** přidejte:

   | Název | Hodnota |
   | --- | --- |
   | `FTP_USERNAME` | Přihlašovací jméno účtu povoleného pro SFTP |
   | `FTP_PASSWORD` | Heslo tohoto účtu |
   | `FTP_KNOWN_HOSTS` | Ověřený veřejný klíč serveru ve formátu OpenSSH `known_hosts`, pro `[ftp.insertcreator.com]:222` |

   Klíč serveru není heslo ani soukromý klíč. Celý řádek má například tvar
   `[ftp.insertcreator.com]:222 ssh-ed25519 <base64-veřejného-klíče>`;
   místo ukázky vložte skutečný ověřený veřejný klíč. Samotný otisk
   `SHA256:...` nestačí. `ssh-keyscan` dokáže klíč načíst, ale sám neověřuje
   jeho původ. Při změně klíče se nasazování zastaví; nový klíč je potřeba
   ověřit u hostingu, nikoli automaticky přijmout.

3. Na kartě **Variables** nastavte `DEPLOY_REMOTE_DIR` podle kořene účtu:
   - běžný účet, který po přihlášení vidí složku `public_html`:
     `DEPLOY_REMOTE_DIR=public_html`;
   - účet prokazatelně omezený přímo na `public_html`: `DEPLOY_REMOTE_DIR=.`
     a navíc `DEPLOY_ALLOW_SCOPED_ROOT=true`. Toto povolení nepoužívejte pro
     neomezený účet, jehož kořenem je celý hosting.
4. V **Actions → Check SFTP connection → Run workflow** spusťte test z `main`.
   Ověří klíč serveru, přihlášení a existující `index.html` a `sw.js` ve webrootu.
   Nevytváří adresáře ani nenahrává, nepřejmenovává nebo nemaže soubory.
   Lze jej spustit i při vypnutém produkčním nasazování. Požadované schválení,
   čekací doba nebo omezení větví prostředí `ftp` platí i pro tento test.
5. Po úspěšném testu a ověření cílové složky přidejte do **repository Variables**
   `DEPLOY_ENABLED=true`. Tato přepínací proměnná se vyhodnocuje před vstupem
   do prostředí `ftp`. Poté v
   **Actions → Check and deploy InsertCreator → Run workflow** spusťte první
   nasazení z `main`. Další integrované změny na `main` se nasadí automaticky.
   Samotné doplnění Secrets nebo Variables workflow nespouští.

Podle údajů z administrace hostingu předaných dne **4. 11. 2026** je připojení
**SFTP → `ftp.insertcreator.com` → port `222`**, případně IP `195.181.249.104`.
Workflow používá uvedený název serveru. Přenos přes SSH zajišťuje Paramiko;
celý veřejný klíč serveru se porovná s `FTP_KNOWN_HOSTS` ještě před odesláním
hesla. Bez známého klíče nebo při jeho neshodě se přenos zastaví. Nenabízí
přechod na nešifrované FTP ani automatické přijetí neznámého klíče.
Závislosti nasazovacího nástroje jsou oddělené v `requirements-deploy.txt`,
s přesnými verzemi a SHA-256; nepatří do webové aplikace v `dist`.

### Průběh, souběžná práce a obnova

Přihlašovací údaje dostane pouze krok nahrávání, nikoli instalace závislostí
nebo testy. Zápisy do produkce probíhají po jednom a běžící nahrávání další
commit automaticky nepřeruší. Před přenosem se kontroluje aktuální `main`;
již nahrazená revize se přeskočí. Agenti mají pracovat na pracovních větvích
a hlavní agent má do `main` posílat až společně ověřenou verzi.

Uploader připraví všechny soubory pod dočasnými názvy, zkontroluje přenesené
velikosti a pak je přejmenuje: nejprve assety, následně `index.html`, `sw.js`
a poslední `deployment.json` s revizí a kontrolními součty. Neodstraňuje
neznámé soubory ani `.htaccess`. Při neúspěchu mohou zůstat dočasné soubory;
další úplné nasazení obnoví konzistentní vydání. Jednotlivé přejmenování
souborů neznamená atomickou výměnu celého webu. Kvůli pevným názvům modulů
může již otevřená stránka během krátkého přepínání načíst části různých vydání.

Závěrečná kontrola stáhne přes HTTPS revizi a všechny soubory a porovná jejich
velikosti a SHA-256 s otestovaným `dist`. Pouhé dokončení SFTP není potvrzením
funkčního webu. Ani tato automatická kontrola nenahrazuje zkoušku ovládání,
kamery a exportu v prohlížeči.

Při chybě nejprve vypněte další automatická nasazení změnou
`DEPLOY_ENABLED=false` a zkontrolujte log workflow. U nesprávné cesty či
přihlášení opravte nastavení a spusťte aktuální `main` znovu. Je-li chyba
v aplikaci, vraťte chybnou změnu pomocí `git revert`, ověřte ji a po opětovném
zapnutí nasazování zveřejněte novou revizi. Nespouštějte zastaralý workflow
s očekáváním, že přepíše novější `main`; kontrola takový běh přeskočí.
Hostingové zálohy lze použít pro havarijní obnovu. Lokálně uložené projekty
uživatelů nahrávání souborů na server nepřepisuje.

### Lokální kontrola bez připojení

```sh
python -m unittest discover -s tests -p '*_test.py'
python scripts/deploy_static.py --source dist --revision <40znakovy-commit-SHA> --dry-run
# S nastavenými údaji v prostředí, bez zápisu na hosting:
python scripts/deploy_static.py --source dist --revision <40znakovy-commit-SHA> --check-connection
```

Podklady: [GitHub Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets),
[souběžná nasazení](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency),
[Paramiko](https://docs.paramiko.org/en/stable/),
[Webglobe – FTP účty](https://www.webglobe.cz/poradna/pristupy-k-ftp-uctu).

## Před nasazením

Vyžaduje Node.js 20 nebo novější. V kořeni projektu spusťte:

```sh
npm ci
npm test
npm run check
```

`npm ci` je potřeba jen pro testy. Do produkce se nenasazují `node_modules`,
testy ani kořen projektu; webroot je výhradně `dist`. Projekt nemá samostatný
build příkaz — nasazuje se připravený obsah `dist` beze změny. Skripty
`update-ui.mjs` a `update-preview.mjs` jsou jednorázové úpravy existujícího
výstupu, ne opakovatelný build.

## Nastavení hostingu

- Publikujte celý obsah `dist` a zachovejte jeho adresářovou strukturu včetně
  `models/` a `vendor/`.
- Web musí být dostupný přes HTTPS. Kamera a service worker v prohlížeči
  vyžadují zabezpečený kontext.
- Host musí servírovat `.js` a `.mjs` jako JavaScript, `.wasm` jako
  `application/wasm`, `.webmanifest` jako manifest a `.onnx` jako binární
  soubor. Model U2-Net má přibližně 4,6 MB a WASM runtime přibližně 11,2 MB.
- Nepřepisujte chybějící statické soubory na `index.html`; model a WASM soubory
  musí vracet skutečný obsah se stavem HTTP 200.
- Aplikace používá relativní cesty, proto ji lze hostovat v kořeni domény nebo
  v podadresáři, pokud se celý obsah `dist` publikuje na dané cestě.
- Nevynucujte dlouhé neměnné (`immutable`) cachování pro `index.html`, `sw.js`
  ani další soubory s pevnými názvy. Změny vydání musí být možné načíst.

## Ověření po nasazení

Otevřete veřejnou HTTPS adresu a zkontrolujte, že:

1. Hlavní stránka a její JavaScript se načtou bez chyb.
2. Soubory `models/u2netp.onnx` a `vendor/ort/ort-wasm-simd-threaded.wasm`
   vracejí stav 200 a správný typ obsahu.
3. Prohlížeč může po udělení oprávnění použít kameru a aplikace zpracuje
   fotografii. Při prvním použití se z hostingu stáhne model a potřebný
   runtime (dohromady přibližně 16 MB).
4. Service worker se registruje. Offline rozpoznávání vyžaduje, aby se model a
   runtime předtím úspěšně načetly online.

Fotografie zůstávají v prohlížeči uživatele; aplikace je neposílá na server.
