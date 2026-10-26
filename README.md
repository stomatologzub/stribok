# Stribog – interná aplikácia

Webová aplikácia pre tím Stribog (vzduchotechnika · rekuperácia · klíma): súpisy prác a kalkulácie projektov, úlohy pre technikov s fotodôkazom, dochádzka, evidencia (objekty, zákazníci, technici, postupy) a tímový chat.

Celá aplikácia je **jeden súbor `index.html`** (HTML + CSS + čistý JavaScript, bez frameworku a bez build kroku).

## Ako beží

Aplikácia je dnes zverejnená ako **artifact v claude.ai**. Backend nepíšeme sami – poskytuje ho runtime claude.ai cez `window.claude.use(...)`:

| Schopnosť | Na čo sa používa |
|---|---|
| `db` | zdieľaná databáza (projekty, súpisy, úlohy, dochádzka, chat, evidencia) s prístupovými pravidlami |
| `user` | prihlásenie a identita (admin = kto môže artifact upravovať) |
| `assets` | fotky k úlohám a do chatu |
| `sample` | čítanie súpisu z fotiek cez Clauda |
| `downloads` | sťahovanie súborov (kalkulácia pre klienta, dochádzka .xlsx, vzor CSV) |
| `comments` | komentáre priamo v aplikácii |

Deklarácia schopností a prístupových pravidiel je v [`capabilities.json`](capabilities.json).

> **Dôležité:** mimo claude.ai (napr. na GitHub Pages) aplikácia sama nefunguje – chýba jej `window.claude`. Na samostatný beh treba vymeniť dátovú vrstvu za vlastný backend (napr. Supabase/Firebase) – pozri [docs/ARCHITEKTURA.md](docs/ARCHITEKTURA.md#prechod-na-vlastný-backend).

## Lokálny náhľad (vývoj)

V priečinku `dev/` je simulátor runtime-u (`mock.js`) a vymyslené demo dáta (`demo-data.js`). Dáta sa držia len v pamäti prehliadača.

```bash
python3 -m http.server 8000      # v koreňovom priečinku repozitára
# otvor http://localhost:8000/dev/preview.html            → admin
#       http://localhost:8000/dev/preview.html?role=worker → technik
```

## Nasadenie novej verzie

Upravený `index.html` sa zverejní ako nová verzia toho istého artifactu v claude.ai (dáta v databáze ostávajú). Schopnosti z `capabilities.json` sa pri zverejnení prenášajú automaticky.

## Štruktúra

```
index.html            celá aplikácia
capabilities.json     schopnosti a prístupové pravidlá databázy
dev/mock.js           lokálny simulátor window.claude
dev/demo-data.js      vymyslené demo dáta
dev/preview.html      lokálny náhľad
docs/ARCHITEKTURA.md  dátový model, moduly, poznámky
```

## Poznámka k súkromiu

`index.html` obsahuje predvolený cenník a odkaz na stránku kalkulácie pre klienta. Repozitár odporúčame nechať **súkromný**.
