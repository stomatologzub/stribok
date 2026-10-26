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
| Prístupy (vlastný server) | ľudia, roly, PIN-y, deaktivácia, záloha a obnova dát; v claude.ai namiesto toho **Export dát** na presun |
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

„Tím“ = každý prihlásený človek, „admin“ = rola Admin (v claude.ai: kto môže artifact upravovať). Pravidlá platia rovnako na vlastnom serveri (`server/server.js`, `RULES`) aj v claude.ai (`capabilities.json`). Platí najkonkrétnejšie pravidlo.

## Backend (`server/`)

`index.html` volá `window.claude.use("db" | "user" | "assets" | "downloads" | "sample" | "team")`. Na vlastnom serveri toto rozhranie poskytuje `server/shim.js`, v claude.ai ho poskytuje claude.ai. Appka sa preto nemusí meniť podľa toho, kde beží.

Server pri doručení `index.html` doplní hlavičku dokumentu, manifest a `<script src="/shim.js">`.

### Tabuľky SQLite (`DATA_DIR/stribog.db`)

| Tabuľka | Obsah |
|---|---|
| `docs` | dokumenty appky: `path`, `parent` (kolekcia), `data` (JSON), `updated` |
| `users` | `id`, `name`, `role` (admin/worker), `color`, `salt` + `pin` (scrypt), `active`, `last_login`, počítadlo chybných pokusov |
| `sessions` | prihlásenia (token v HttpOnly cookie `stribog_s`, platnosť 180 dní) |
| `blobs` | metadáta fotiek. Samotné súbory sú v `DATA_DIR/blobs/<id>` |
| `pubpages` | verejné kalkulácie pre klientov (projekt → token, HTML) |

### API

| Metóda a cesta | Kto | Popis |
|---|---|---|
| `GET /api/auth/state` | ktokoľvek | prvé spustenie?, zoznam mien na prihlásenie, prihlásený človek |
| `POST /api/auth/setup` | len kým nie je nikto aktívny | vytvorí prvého admina `{name, pin}` alebo z prenesených ľudí vyberie admina `{userId, pin}` |
| `POST /api/auth/setup-import` | len kým nie je nikto aktívny | prenos dát zo zálohy / z exportu z claude.ai |
| `POST /api/auth/login` · `/logout` | ktokoľvek | prihlásenie `{userId, pin}` / odhlásenie |
| `GET /api/doc?path=` · `PUT` · `PATCH` · `DELETE` | podľa pravidiel | dokument: čítanie, zápis (`{data, merge}`), čiastočná zmena, zmazanie |
| `POST /api/query` | podľa pravidiel | kolekcia `{path, where, orderBy, limit}` |
| `POST /api/add` | podľa pravidiel | nový dokument s náhodným id |
| `GET /api/events` | prihlásený | SSE: cesty zmenených dokumentov. Klient si ich znova načíta, pričom server overí práva. |
| `POST /api/assets` · `GET /_blob/<id>` | prihlásený | nahratie a zobrazenie fotky (max 15 MB) |
| `POST /api/sample` | admin | čítanie súpisu z fotiek cez Claude API (`ANTHROPIC_API_KEY`) |
| `GET/POST /api/users`, `PATCH/DELETE /api/users/<id>` | admin (vlastný PIN aj technik) | správa ľudí a PIN-ov. Vždy ostane aspoň jeden admin. |
| `GET /api/admin/export[?photos=1]` · `POST /api/admin/import` | admin | záloha / obnova `{docs, people, blobs, replace}` |
| `GET/POST/DELETE /api/public` | admin | verejný odkaz na kalkuláciu projektu |
| `GET /k/<token>` | ktokoľvek | verejná kalkulácia pre klienta (izolovaná cez CSP sandbox) |
| `GET /healthz` | ktokoľvek | kontrola, či server beží |

### Formát zálohy / exportu

```json
{ "app": "stribog", "version": 2, "exportedAt": "…",
  "docs":   { "tasks/abc": { … }, "meta/projects": { … } },
  "people": [ { "id": "…", "name": "…", "role": "admin|worker" } ],
  "blobs":  { "<id fotky>": { "type": "image/jpeg", "data": "<base64>" } } }
```

Ľudia, ktorí na serveri ešte nie sú, sa založia ako deaktivovaní s rovnakým `id`, takže staré úlohy, dochádzka a chat k nim sedia aj naďalej.
