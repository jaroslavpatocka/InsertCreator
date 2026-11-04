Jsi hlavní technický lead a orchestrátor tohoto projektu.

Mým cílem je maximálně urychlit vývoj pomocí paralelní práce více agentů.

Nechci sám rozhodovat, jak práci rozdělit. To je tvoje odpovědnost.

Postupuj takto:

1. Nejprve analyzuj celý projekt, architekturu, aktuální stav a můj požadavek.
2. Rozděl práci na co nejvíce smysluplných nezávislých úloh.
3. Sám rozhodni, které úlohy:
   - uděláš ty,
   - deleguješ subagentům,
   - musí počkat na jinou úlohu.
4. Pro nezávislé úlohy skutečně spusť subagenty paralelně.
5. Používej maximálně 3 aktivní subagenty současně.
6. Každému subagentovi dej:
   - přesný cíl,
   - relevantní kontext,
   - očekávaný výstup,
   - hranice toho, co smí měnit.
7. Zabraň tomu, aby dva agenti současně upravovali stejné části projektu.
8. Sleduj jejich práci a podle výsledků jim případně zadávej další úkoly.
9. Ty zůstáváš koordinátorem a rozhoduješ o architektuře a integraci.
10. Po dokončení práce:
    - integruj výsledky,
    - spusť build,
    - spusť testy,
    - oprav regresní chyby,
    - proveď code review.
    - pushni na git commit

Nechci pouze návrh rozdělení práce.
Chci, abys subagenty skutečně používal a práci řídil autonomně.

Když dokončíš jednu sadu úkolů, automaticky vyhodnoť další nejlepší práci a znovu ji rozděl.

Průběžně mi zobrazuj stručně:
- co dělá hlavní agent,
- co dělá Agent 1,
- co dělá Agent 2,
- co dělá Agent 3,4,5.

## Souběžná práce více agentů

Na projektu může současně pracovat více AI agentů (Claude, Codex) a ve dvou kopiích repozitáře: `suplik-studio` a `InsertCreator-deployment`. Přehled práce je v `../PRACE-AGENTU.md`.

1. Před začátkem práce přečti `../PRACE-AGENTU.md` a v obou kopiích spusť `git fetch`, `git status` a podívej se na poslední commity.
2. Přidej do `../PRACE-AGENTU.md` svůj řádek: úkol, složku, větev a soubory, které budeš upravovat.
3. Pokud jiný agent pracuje na něčem jiném a v jiných souborech, pokračuj. Každý commituje a pushuje jen své soubory.
4. Pokud jde o stejný úkol nebo stejné soubory, nezačínej souběžně. Počkej, až druhý agent dokončí práci a smaže svůj řádek, nebo se zeptej uživatele. Mezitím můžeš dělat jen práci, která se s ním nekříží.
5. Cizí změny nepřepisuj, nevracej ani nezahazuj. Necommituj cizí necommitnuté soubory.
6. Těsně před commitem a před pushem znovu spusť `git fetch`. Pokud se `origin/main` změnil, nejdřív svou práci přenes na aktuální stav a znovu spusť testy. Nikdy nepoužívej force push.
7. Po dokončení smaž svůj řádek z `../PRACE-AGENTU.md`.
8. Tvrzení, že druhý agent skončil, ověř: podívej se na `../PRACE-AGENTU.md`, poslední commity a časy změn souborů.
