# InsertCreator pro Google Play

Android projekt otevírá přes Trusted Web Activity přímo `https://insertcreator.com/mobil/`. Mobilní aplikace i její data se nadále řídí webovou verzí; běžné aktualizace webu se projeví také zde. Nejde o balíček s celým webem uvnitř APK: první načtení potřebuje internet a offline provoz závisí na dříve načtených datech a modelu v prohlížeči.

Vydavatel: Jaroslav Patočka. Kontakt: admin@insertcreator.com.

Předávací ZIP `artifacts/InsertCreator-Android.zip` obsahuje tento zdrojový projekt, podklady pro obchod a už sestavené soubory v `builds/`: testovací APK a nepodepsaný release AAB. Každá položka archivu je ověřená podle SHA-256; privátní klíče a cache v něm nejsou.

## Stav a identita

- Navržený identifikátor: `com.insertcreator.app`. Před prvním uploadem ho potvrď; po registraci aplikace v Play se nemění.
- Verze 1.0.0, kód 1; cílové API 36, minimum Android 7/API 24. Sestavení používá SDK 37.0, AGP 9.1.1, Gradle 9.3.1 a AndroidBrowserHelper 2.7.4.
- `app/build/outputs/apk/debug/app-debug.apk` je testovací APK s veřejným vývojovým klíčem. Nikdy ho nepoužívej jako produkční podpis.
- `app/build/outputs/bundle/release/app-release.aab` je připravené **nepodepsané** sestavení. Do Play ho lze nahrát až po podpisu vlastním upload klíčem. Výsledky skutečného buildu a validace jsou v `VERIFICATION.md`.
- Současný projekt neobsahuje produkční klíč ani smyšlený certifikát domény. Do Gitu nepatří keystore, hesla, local.properties ani build cache.

## Sestavení

V Android Studiu otevři tento adresář. Použij Gradle JDK 17 nebo novější kompatibilní s Gradle 9.3.1 (zde ověřován JBR 25 z Android Studia). Nastav Android SDK s platformou 37.0 a Build Tools 36.0.0. Samostatný CLI build z tohoto adresáře:

Na Windows lze použít přímo `BUILD.cmd`; najde výchozí Android Studio/SDK, vytvoří pouze místní testovací debug klíč a spustí sestavení i kontrolu balíčku. Potřebuje internet pro chybějící závislosti. Uživatelský PATH ani systémové nastavení nemění.

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat --no-daemon --max-workers=2 assembleDebug bundleRelease lintDebug
```

Debug konfigurace očekává ignorovaný `.local/debug.keystore`. Pro lokální test jej vytvoří Android keytool s běžným aliasem `androiddebugkey`, heslem `android` a testovacím certifikátem. Produkční upload klíč vytvoř až pro vlastní ověřený účet a bezpečně ho zálohuj. Podepisování skutečného vydání proveď v Android Studiu přes Generate Signed Bundle / APK; heslo nedávej do příkazové historie ani repozitáře.

## Co musí udělat vlastník před vydáním

1. [Založit Play Console účet](https://play.google.com/console/signup), zaplatit jednorázových 25 USD a dokončit ověření identity/zařízení. Google žádá soukromé doklady přímo ve svém rozhraní. U osobního účtu je potřeba uzavřený test s nejméně 12 testery přihlášenými souvisle 14 dní, potom žádost o produkční přístup. Schválení není automatické. [Registrace](https://support.google.com/googleplay/android-developer/answer/6112435?hl=cs), [testování](https://support.google.com/googleplay/android-developer/answer/14151465?hl=cs).
2. Vytvořit aplikaci InsertCreator, potvrdit vlastníka a identifikátor, zvolit Play App Signing, vytvořit a bezpečně uložit upload klíč a nahrát podepsaný AAB do interního testu.
3. Z Play Console získat SHA-256 **certifikátu podepisování aplikace**, nikoli upload certifikátu. Podle něj vygenerovat a nahrát vazbu domény (níže). Potom ověřit skutečnou instalaci z Play; jiný podpis znamená jiný certifikát.
4. Dokončit návrh soukromí v `play/PRIVACY-DRAFT.md`, ověřit skutečné hostovací logy a retenční lhůty, vystavit zásady na veřejné HTML URL a přidat odkaz také do aplikace. Zatím nejde o hotovou zveřejněnou privacy policy. `play/DATA-SAFETY.md` je podklad, ne automaticky schválené prohlášení.
5. Použít texty `play/STORE-LISTING-CS.md`, stávající ikonu 512×512; doplnit skutečné screenshoty aplikace a feature graphic 1024×500. Vyplnit přístup do aplikace (bez účtu), cílovou skupinu, obsahové hodnocení, reklamy a Data Safety podle skutečně otestovaného balíčku. Nevymýšlet hodnocení ani cílovou skupinu.
6. Otestovat fotoaparát/výběr fotografie, rozpoznání, dotyky, rotaci, JSON zálohu, STL/ZIP/3MF export a sdílení na skutečném Androidu. Ověřit offline po prvním načtení a chování při nedostupném internetu. Teprve poté zahájit potřebné uzavřené testování a publikaci.

## Propojení domény a podpisu

```powershell
$playSigningSHA256 = Read-Host 'SHA-256 z certifikatu Play App Signing'
node android/scripts/assetlinks.mjs --fingerprint $playSigningSHA256
```

Spouštěj z hlavního repozitáře. Generátor odmítne chybějící nebo zástupný certifikát a zapisuje pouze přípravu do `android/hosting/.well-known/assetlinks.json`. Nenahrává ji na web. Správné veřejné umístění je **`https://insertcreator.com/.well-known/assetlinks.json`**, HTTP 200, JSON, bez přesměrování. Neumisťuj soubor pod `/mobil/`.

Současné SFTP skripty záměrně odmítají skryté cesty. Až bude skutečný certifikát známý, buď nahraj tento jeden soubor přes správce hostingu, nebo úzce povol právě tuto cestu v uploaderu i ověřovači a doplň jejich testy. Nepovoluj plošně dotfiles. Zatím se žádný veřejný `assetlinks.json` nepřidává. Bez ověřené vazby se TWA otevře s lištou prohlížeče jako Custom Tab.

Podklady: [TWA](https://developer.chrome.com/docs/android/trusted-web-activity/quick-start), [Digital Asset Links](https://developer.android.com/training/app-links/configure-assetlinks), [požadované API](https://support.google.com/googleplay/android-developer/answer/11926878?hl=cs), [AGP](https://developer.android.com/build/releases/agp-9-1-0-release-notes), [Gradle/JDK](https://docs.gradle.org/current/userguide/compatibility.html).
