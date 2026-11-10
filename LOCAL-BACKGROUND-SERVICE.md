# Volitelná lokální služba pro odstranění pozadí

`scripts/background-server.mjs` (`npm run dev:background`) je volitelný lokální server. Servíruje `dist/` a na stejném původu nabízí `/api/background/status` a `/api/background/remove`, kde model BiRefNet (ověřený SHA-256) odstraní pozadí fotky na tomto počítači. Veřejný statický web tuto službu neobsahuje. Bez ní aplikace zpracovává fotky jen v prohlížeči.

## Jaká data služba dostane

Prohlížeč posílá na stejný původ jen dekódované RGBA pixely vybrané fotky, šířku, výšku a identifikátor úlohy. Soubor fotky, EXIF ani projekt se neposílají. Služba data drží jen v paměti po dobu úlohy a nic neukládá na disk. Stav úlohy (identifikátor, průběh, rozměry) se vrací s `Cache-Control: no-store` a service worker ho neukládá (SEC-03).

## Síťová hranice (audit SEC-02)

- Výchozí adresa je `127.0.0.1`, tedy jen tento počítač. Doporučený a bezpečný režim.
- `--host 0.0.0.0` zpřístupní službu ostatním zařízením v síti, například telefonu. **Služba nemá přihlášení ani šifrování (běží přes HTTP).** Ochrana Origin/Host/Fetch Metadata brání cizím webovým stránkám, ne jinému zařízení v síti. Při spuštění v tomto režimu se vypíše upozornění.
  - Používejte jen v síti, kterou ovládáte (domácí Wi-Fi), a omezte port firewallem na lokální síť.
  - Nikdy port nepřesměrovávejte do internetu (port forwarding, UPnP, tunely) a nespouštějte službu ve sdílené nebo veřejné Wi-Fi.
  - Fotky posílané z telefonu přes HTTP nejsou během přenosu šifrované.
- Omezení zdrojů: najednou běží jedna úloha, obrázek má nejvýše 64 milionů pixelů a úloha nejvýše 30 minut.

## Před případným provozem ve sdílené síti

Před podporou sdílených nebo nedůvěryhodných sítí je nutné doplnit:

- párování nebo přihlášení klienta,
- šifrovaný přenos (HTTPS nebo autentizovaný TLS reverse proxy),
- limity požadavků a úloh na klienta,
- omezení přístupu ke stavu úloh.

Do té doby je tento režim nepodporovaný.
