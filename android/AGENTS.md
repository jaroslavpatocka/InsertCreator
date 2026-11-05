# Android / Google Play

- Toto je TWA obal stávajícího mobilního webu, nikoli další kopie jeho zdrojů. Otevírá přímo `https://insertcreator.com/mobil/`; kořen domény obsahuje desktopový analytický bootstrap.
- Webové změny dělej a ověřuj pro desktop i mobil podle nadřazeného AGENTS.md. Android změny ověř `BUILD.cmd` nebo Gradle úlohami `assembleDebug bundleRelease lintDebug validateReleaseBundle`. Generátor doménové vazby má testy `node --test scripts/assetlinks.test.mjs`.
- Release AAB je záměrně nepodepsaný. Debug klíč je místní testovací pomůcka s veřejným standardním heslem, nikoli produkční upload klíč. Do Gitu ani ZIPu nikdy nepřidávej privátní klíče, hesla nebo local.properties.
- Package `com.insertcreator.app` je návrh do prvního uploadu. Po prvním vydání se identifikátor nemění; nové nativní vydání potřebuje vyšší versionCode.
- Asset Links generuj jen ze skutečného certifikátu Play App Signing. Upload certifikát není totéž. Nepublikuj zástupné ani debug certifikáty. Soubor patří do kořene domény `/.well-known/assetlinks.json`; obvyklé publikační skripty skryté cesty odmítají.
- Build, lint a bundletool neprokazují reálný telefon. Před vydáním ověř skutečnou instalaci z Play, foto/výběr souboru, rozpoznání, dotyky, rotaci, zálohu, export a sdílení i offline chování.
- Podklady Data Safety a soukromí jsou návrhy, dokud nejsou ověřené hostovací logy a finální distribuovaná verze. Nezaměňuj místní zpracování fotografií za prokázané nulové serverové logování. Soukromí musí být veřejné a dostupné také uvnitř aplikace.
- Uživatel zatím nemá Play Console účet. Neprohlašuj aplikaci za publikovanou ani předpoklady za schválení Googlu. Aktuální stav a důkazy jsou v README.md a VERIFICATION.md, další kroky závisí také na osobním ověření a testování účtu.
