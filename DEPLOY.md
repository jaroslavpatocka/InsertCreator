# Nasazení na web

Šuplík Studio je statická aplikace. Nepotřebuje backend ani databázi; projekt se
nasazuje z adresáře `dist`. Konfigurace `.openai/hosting.json` už tento adresář
nastavuje jako statický webroot.

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
