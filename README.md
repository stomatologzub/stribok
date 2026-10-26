# Stribog – interná aplikácia

Webová aplikácia pre tím Stribog (vzduchotechnika · rekuperácia · klíma): súpisy prác a kalkulácie projektov, úlohy pre technikov s fotodôkazom, dochádzka, evidencia (objekty, zákazníci, technici, postupy) a tímový chat.

- **Frontend:** jeden súbor `index.html` (HTML + CSS + čistý JavaScript, bez frameworku a bez build kroku).
- **Backend:** `server/` – Node.js 22, **žiadne npm balíčky**. Databáza SQLite, fotky na disku, zmeny v reálnom čase (chat, úlohy) a prihlásenie **menom + PIN-om**.

## Prvé spustenie

1. Otvor adresu aplikácie. Pri prvom otvorení si vytvoríš **admin účet** (meno + PIN).
2. V sekcii **Prístupy** pridaj ľudí z tímu. Pri každom zvolíš rolu (Technik / Admin) a PIN.
3. Pošli im odkaz. Každý si vyberie svoje meno, zadá PIN a zariadenie si prihlásenie pamätá pol roka.

| Rola | Čo vidí |
|---|---|
| **Admin** | všetko: projekty, súpisy a ceny, evidenciu, dochádzku celého tímu, prístupy, zálohu |
| **Technik** | úlohy, svoju dochádzku a chat – ceny ani súpisy nevidí |

Kliknutím na svoje meno (vľavo dole alebo hore na mobile) si každý zmení PIN alebo sa odhlási.

## Nasadenie

### A) Railway – najjednoduchšie (cca 5 $/mesiac)

1. Na [railway.com](https://railway.com) sa prihlás cez GitHub → **New Project → Deploy from GitHub repo** → vyber tento repozitár. Dockerfile sa použije automaticky.
2. V službe pridaj **Volume** s cestou **`/data`** (inak sa dáta pri reštarte stratia).
3. **Settings → Networking → Generate Domain** – dostaneš adresu `https://…up.railway.app`. Vlastnú doménu pridáš v tom istom mieste.
4. Voliteľne v **Variables** nastav `ANTHROPIC_API_KEY` (čítanie súpisu z fotiek, pozri nižšie).

Každý push do vetvy `main` sa nasadí automaticky.

### B) Vlastný server / VPS (napr. Hetzner, cca 4–5 €/mesiac)

Potrebuješ server s Dockerom a doménu nasmerovanú na jeho IP (A záznam).

```bash
git clone https://github.com/stomatologzub/stribok.git && cd stribok
cp .env.example .env      # nastav DOMAIN=stribog.tvojadomena.sk
docker compose up -d --build
```

Caddy automaticky vybaví HTTPS certifikát. Aktualizácia: `git pull && docker compose up -d --build`.

### C) Lokálne (na skúšku)

```bash
npm start                 # Node.js 22.5+ – http://localhost:8080
```

Dáta sa ukladajú do priečinka `data/` (v gite ignorovaný).

## Nastavenia (premenné prostredia)

| Premenná | Predvolene | Význam |
|---|---|---|
| `PORT` | `8080` | port servera |
| `DATA_DIR` | `./data` (v Dockeri `/data`) | databáza `stribog.db` + fotky v `blobs/` |
| `ANTHROPIC_API_KEY` | – | zapne **čítanie súpisu z fotiek**; kľúč získaš na console.anthropic.com, platí sa podľa použitia |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | model na čítanie súpisu |
| `COOKIE_SECURE` | – | `1` = prihlasovacia cookie len cez HTTPS (za proxy sa zistí automaticky) |

## Zálohy

- **V aplikácii:** Prístupy → **Stiahnuť zálohu** – všetky dáta v jednom JSON súbore. **Obnoviť zo zálohy** ich vráti (doplniť alebo nahradiť všetko).
- **Úplná záloha** vrátane fotiek = skopírovať celý priečinok s dátami (`/data`).

## Bezpečnosť

- PIN-y sú uložené len ako hash (scrypt). Po 5 nesprávnych pokusoch sa účet na 5 minút zamkne, po 20 pokusoch z jednej IP adresy sa zablokuje na 15 minút.
- Prihlásenie je v HttpOnly cookie. Pravidlá prístupu kontroluje server, nie prehliadač – technik nedostane súpisy ani ceny ani cez API.
- Deaktivovaný človek sa okamžite odhlási na všetkých zariadeniach. Jeho meno ostáva pri starých záznamoch.

## Štruktúra

```
index.html            celá aplikácia (frontend)
server/server.js      backend: API, databáza, realtime, prihlásenie, fotky, AI
server/shim.js        prepojenie appky so serverom + prihlasovacia obrazovka
public/               ikony a manifest (appka sa dá pridať na plochu mobilu)
Dockerfile            obraz pre Railway / Docker
docker-compose.yml    VPS: appka + Caddy (HTTPS)
dev/                  náhľad bez servera s demo dátami (dev/preview.html)
capabilities.json     nastavenia pre verziu v claude.ai
docs/ARCHITEKTURA.md  dátový model, API, pravidlá
```

## Verzia v claude.ai

Rovnaký `index.html` funguje aj ako artifact v claude.ai (s `capabilities.json`). Tam sa o prihlásenie a dáta stará claude.ai a sekcia Prístupy sa nezobrazí. Dáta týchto dvoch verzií sú oddelené.

Repozitár odporúčame nechať **súkromný** – `index.html` obsahuje predvolený cenník.
