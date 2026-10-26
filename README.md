# Stribog – samostatná webová aplikácia

Interná aplikácia tímu Stribog (vzduchotechnika · rekuperácia · klíma). Beží na **vlastnom serveri**, dáta a fotky ukladá u vás a prihlasuje sa **menom a PIN-om**. Žiadny účet Claude ani claude.ai nepotrebuje.

**Funkcie:**
- **Projekty, súpisy, cenníky a kalkulácie** – súpis aj z fotiek cez AI (voliteľné), import z CSV
- **Úlohy** – checklisty, firemné postupy, fotodôkazy s pečiatkou, kontrola adminom, odhad hodín
- **Dochádzka** – príchod/odchod, prehľad tímu, export do .xlsx
- **Evidencia** – zákazníci, objekty, technici a ich oprávnenia
- **Chat** – tím a projekty, fotky, v reálnom čase
- **Používatelia a roly** – Admin / Technik, PIN-y, deaktivácia
- **Zálohy a obnova**, **verejné odkazy pre klientov**, herný režim, appka na plochu mobilu

---

## Rýchly štart

### Lokálne (na vlastnom počítači)

Potrebuješ **Node.js 22.5 alebo novší** (https://nodejs.org, verzia LTS). Žiadne `npm install` netreba – projekt nemá závislosti.

```bash
cd stribog
npm start
```

Otvor **http://localhost:8080**. Pri prvom otvorení si vytvoríš administrátora (meno + PIN). Dáta sa ukladajú do priečinka `data/`.

### Docker (ľubovoľný server)

```bash
docker build -t stribog .
docker run -d --name stribog -p 8080:8080 -v stribog_data:/data --restart unless-stopped stribog
```

### VPS s doménou a HTTPS (docker compose + Caddy)

1. Na serveri s Ubuntu nainštaluj Docker: `curl -fsSL https://get.docker.com | sh`
2. Doménu nasmeruj záznamom **A** na IP servera.
3. Nahraj projekt na server (napr. `git clone` alebo rozbaľ ZIP) a v jeho priečinku spusti:

```bash
cp .env.example .env      # nastav DOMAIN=app.tvojadomena.sk
docker compose up -d --build
```

HTTPS certifikát vybaví Caddy automaticky. Aktualizácia: nahraj nové súbory a spusti `docker compose up -d --build`.

### Railway (bez správy servera, cca 5 $/mesiac)

1. railway.com → **New Project → Deploy from GitHub repo** → vyber repozitár s týmto projektom.
2. Pridaj **Volume** s cestou **`/data`**. Bez neho sa dáta pri aktualizácii zmažú.
3. **Settings → Networking → Generate Domain**.

Každý push do GitHubu sa nasadí automaticky.

---

## Prvé spustenie

Pri prvom otvorení prázdnej aplikácie máš dve možnosti:

- **Začať odznova** – zadáš meno a PIN (4–8 číslic) a staneš sa administrátorom.
- **Obnoviť dáta zo zálohy** – nahráš zálohu (`.json`), vyberieš sa v zozname ľudí a nastavíš si PIN. Takto sa prenášajú aj dáta zo starej verzie v claude.ai (tam: menu *Export dát*).

Potom v sekcii **Prístupy** pridaj ľudí: meno, rolu a PIN. Pošli im adresu appky. Každý si vyberie svoje meno, zadá PIN a zariadenie si prihlásenie pamätá 180 dní.

| Rola | Vidí a môže |
|---|---|
| **Admin** | všetko: projekty, súpisy a ceny, evidenciu, dochádzku tímu, prístupy, zálohy, odkazy pre klientov |
| **Technik** | úlohy (vrátane fotodôkazov a checklistov), svoju dochádzku a chat. Súpisy, ceny ani dochádzku iných nevidí – kontroluje to server. |

Kliknutím na svoje meno si každý zmení PIN alebo sa odhlási.

---

## Bežná správa

| Čo | Ako |
|---|---|
| Zabudnutý PIN | Prístupy → človek → Nový PIN. Admin bez prístupu: `node server/cli.js pin "Meno" 1234` |
| Odchod človeka | Prístupy → Deaktivovať. Okamžite sa odhlási, jeho záznamy ostanú. |
| Odkaz pre klienta | projekt → **Pre klienta** → **Vytvoriť odkaz** (po zmenách **Aktualizovať odkaz**). Funguje bez prihlásenia. |
| Záloha | Prístupy → **Stiahnuť zálohu** / **Záloha aj s fotkami** (odporúčame raz týždenne a uložiť mimo servera) |
| Obnova | Prístupy → **Obnoviť zo zálohy** → doplniť alebo nahradiť všetko |
| Úplná záloha | skopírovať celý priečinok s dátami (`data/`, v Dockeri volume `/data`) |

### Príkazový riadok

Spúšťa sa na serveri. Lokálne: `node server/cli.js …`, v Dockeri: `docker exec -it stribog node server/cli.js …`, v docker compose: `docker compose exec app node server/cli.js …`.

```
ludia                          zoznam ľudí a rolí
pin "Meno" 1234                nový PIN + aktivácia účtu
admin "Meno" / technik "Meno"  zmena roly
pridaj "Meno" 1234 [--admin]   nový človek
export [subor.json] [--fotky]  záloha
import subor.json [--nahradit] obnova zo zálohy
```

---

## Nastavenia (premenné prostredia)

| Premenná | Predvolene | Význam |
|---|---|---|
| `PORT` | `8080` | port servera |
| `DATA_DIR` | `./data` (Docker: `/data`) | databáza `stribog.db` a fotky `blobs/` |
| `DOMAIN` | – | len pre docker compose: doména pre HTTPS |
| `ANTHROPIC_API_KEY` | – | **voliteľné:** čítanie súpisu z fotiek cez AI. Bez kľúča je tlačidlo skryté a všetko ostatné funguje. |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | model pre čítanie súpisu |
| `COOKIE_SECURE` | – | `1` = prihlasovacia cookie len cez HTTPS (za proxy sa zistí samo) |

API kľúč získaš na console.anthropic.com (*API Keys*, kredit v *Billing*). Platí sa podľa použitia, rádovo centy za stranu súpisu.

---

## Riešenie problémov

| Problém | Riešenie |
|---|---|
| „Aplikácia sa nenačítala – chýba /api.js“ | Appku treba otvárať cez server (`npm start` / Docker), nie dvojklikom na `index.html`. |
| „Server nie je dostupný“ | Server nebeží – pozri jeho výpis (`docker logs stribog`, `docker compose logs app`). |
| „Priveľa nesprávnych pokusov“ | Po 5 chybných PIN-och sa účet na 5 minút zamkne. Počkaj alebo nastav nový PIN. |
| Dáta zmizli po aktualizácii | Chýba trvalé úložisko (`-v stribog_data:/data`, Railway Volume `/data`). Obnov zálohu. |
| `node:sqlite` nenájdený | Starý Node.js – treba 22.5+. |

---

## Bezpečnosť

- PIN-y sú uložené len ako hash (scrypt). Pri zlých pokusoch sa účet zamyká, pri opakovaných zlých pokusoch sa blokuje aj IP adresa.
- Prihlásenie je v HttpOnly cookie (SameSite=Strict). Všetky oprávnenia overuje server – pravidlá sú v `RULES` v `server/server.js`.
- Verejné odkazy pre klienta majú náhodnú adresu, nie sú indexované a bežia v izolovanom režime (CSP sandbox).
- Všetky knižnice a písma sú v projekte – appka nenačítava nič z cudzích serverov. Výnimkou je voliteľné AI.

---

## Štruktúra projektu

```
index.html               aplikácia (HTML + CSS + JavaScript, bez build kroku)
public/api.js            klientske API (window.stribog): prihlásenie, dáta, fotky, realtime
public/vendor/           SheetJS (xlsx export), heic2any (fotky z iPhonu)
public/fonts/            písma DM Sans, IBM Plex Mono, Poppins, Press Start 2P (OFL)
public/icon*, manifest   ikony a manifest pre mobil
server/server.js         HTTP server, API, oprávnenia, realtime (SSE), fotky, odkazy, AI
server/store.js          databáza SQLite, import/export
server/cli.js            správa z príkazového riadku
Dockerfile, docker-compose.yml, Caddyfile, .env.example
docs/ARCHITEKTURA.md     dátový model, API, pravidlá
```
