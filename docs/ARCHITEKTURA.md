# Architektúra

## Moduly v `index.html`

| Časť | Čo robí |
|---|---|
| Súpis (admin) | rozpis bytov / stúpačiek / striech, cenník, rekapitulácia, zaokrúhľovanie nahor na 0,50 €, nezrovnalosti + „Na doplnenie“, kalkulácia pre klienta |
| Prehľad projektu | úlohy, súpis, fotodôkazy, hodiny a chat projektu na jednom mieste |
| Projekty | zoznam (tabuľka / timeline), import z CSV, súpis z fotiek (Claude) |
| Úlohy | zoznam / karty, technik, objekt, postup (checklist), odhad hodín, fotodôkaz s pečiatkou (dátum, čas, meno), kontrola adminom |
| Úlohy zo súpisu | z bytov / stúpačiek / striech vytvorí úlohy s materiálom a termínmi |
| Dochádzka | príchod/odchod, záznamy, týždenné súčty, tímový prehľad + export .xlsx |
| Evidencia | objekty, zákazníci, technici (oprávnenia s platnosťou), firemné postupy |
| Chat | kanál tímu, kanály projektov, vlastné kanály, fotky, úloha zo správy |
| Ostatné | sidebar / mobilná navigácia, prepínač admin/pracovník, glass dizajn, Game režim |

## Dátový model (`db`)

| Cesta | Obsah | Číta | Zapisuje |
|---|---|---|---|
| `admin/<projectId>` | celý súpis projektu: `project`, `rate`, `rounding`, `prices[]`, `groups[]` (sheet `rek`/`stu`/`str`, `rows[]`), `recapHand`, `recapUse`, `issues[]` | admin | admin |
| `admin/_summary` | `projects.<id>`: `total`, `rek`, `stu`, `str`, počty, `need`, `issues`, `updatedAt` | admin | admin |
| `admin/_technicians` | `list[]`: meno, kontakt, pozícia, `certs[]` (názov, platnosť), `userId` | admin | admin |
| `meta/projects` | `list[]`: `id`, `name`, `code`, `client`, `archived` | tím | admin |
| `meta/customers`, `meta/objects`, `meta/procedures` | evidencia (`list[]`) | tím | admin |
| `meta/chat` | poradie, skryté a vlastné kanály | tím | admin |
| `tasks/<id>` | `title`, `projectId`, `groupId`, `objectId`, `procedureId`, `status` (todo/doing/done), `assignee`, `techId`, `techName`, `due`, `estH`, `checks`, `photos[]` (`kind`: "" / `proof` / `step:<k>`), `proofReq`, `proof`, `review` | tím | tím |
| `hours/<userId>` | `entries[]` (dátum, od, do, prestávka, projekt), `active` | vlastník + admin | vlastník + admin |
| `chat/<id>` | `ch` (`team`, `p:<projectId>`, `c:<id>`), `by`, `text`, `photo`, `at` | tím | tím |

„Tím“ = prihlásení členovia s prístupom Contributor a vyšším (`interact`), „admin“ = môže artifact upravovať.

## Prechod na vlastný backend

Všetky prístupy k dátam idú cez `dbApi.doc(...)` / `dbApi.collection(...)` s rozhraním podobným Firestore (`get`, `set`, `update`, `delete`, `add`, `onSnapshot`, `orderBy`, `limit`). Pri presune na Firebase/Firestore stačí:

1. nahradiť `useCap("db")` inicializáciou Firestore a pravidlá z `capabilities.json` prepísať do Firestore Security Rules,
2. `useCap("user")` nahradiť Firebase Auth (meno, fotka, admin rola),
3. `useCap("assets")` nahradiť Firebase Storage (fotky sa zobrazujú cez `/_blob/<id>` – treba vymeniť za URL zo Storage),
4. `sample` (čítanie súpisu z fotiek) nahradiť volaním Claude API zo servera (API kľúč nesmie byť v prehliadači),
5. `downloads.save` nahradiť bežným stiahnutím cez `<a download>`.
