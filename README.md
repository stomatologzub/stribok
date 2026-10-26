# Stribog – interná aplikácia

Webová aplikácia pre tím Stribog (vzduchotechnika · rekuperácia · klíma):

- **Projekty a súpisy** – rozpis bytov, stúpačiek a striech, cenník, rekapitulácia, nezrovnalosti, kalkulácia pre klienta
- **Úlohy** – technik, termín, postup s checklistom, fotodôkaz s pečiatkou dátumu a mena, kontrola adminom, odhad hodín
- **Dochádzka** – príchod/odchod, týždenné súčty, prehľad tímu, export do Excelu
- **Evidencia** – objekty, zákazníci, technici a ich oprávnenia, firemné postupy
- **Chat** – kanál tímu a kanály projektov, fotky, úloha zo správy
- **Prístupy** – ľudia, roly, PIN-y, zálohy

Aplikácia beží na **vlastnom serveri** a na nič od Clauda ani claude.ai nepotrebuje. Jediná výnimka je voliteľné čítanie súpisu z fotiek (pozri [Čítanie súpisu z fotiek](#čítanie-súpisu-z-fotiek-voliteľné)).

---

## Obsah

1. [Ako to celé funguje](#1-ako-to-celé-funguje)
2. [Spustenie na internete – Railway (odporúčané)](#2-spustenie-na-internete--railway-odporúčané)
3. [Spustenie na vlastnom serveri (VPS)](#3-spustenie-na-vlastnom-serveri-vps)
4. [Spustenie na vlastnom počítači (na skúšku)](#4-spustenie-na-vlastnom-počítači-na-skúšku)
5. [Prvé spustenie a prenos dát z claude.ai](#5-prvé-spustenie-a-prenos-dát-z-claudeai)
6. [Každodenná správa](#6-každodenná-správa)
7. [Zálohy a obnova](#7-zálohy-a-obnova)
8. [Úpravy aplikácie a aktualizácie](#8-úpravy-aplikácie-a-aktualizácie)
9. [Príkazový riadok (správa na serveri)](#9-príkazový-riadok-správa-na-serveri)
10. [Nastavenia](#10-nastavenia)
11. [Riešenie problémov](#11-riešenie-problémov)
12. [Bezpečnosť](#12-bezpečnosť)
13. [Štruktúra projektu](#13-štruktúra-projektu)

---

## 1. Ako to celé funguje

| Časť | Čo to je |
|---|---|
| `index.html` | celá aplikácia, ktorú ľudia vidia v prehliadači |
| `server/` | backend v Node.js: ukladá dáta, prihlasuje ľudí, posiela zmeny v reálnom čase, ukladá fotky |
| databáza | jeden súbor `stribog.db` (SQLite) + priečinok `blobs/` s fotkami – oboje v priečinku s dátami |

- **Prihlásenie:** každý si vyberie svoje meno a zadá PIN (4–8 číslic). Zariadenie si prihlásenie pamätá pol roka.
- **Role:** **Admin** vidí a spravuje všetko. **Technik** vidí len úlohy, svoju dochádzku a chat. Súpisy ani ceny nevidí, a to ani cez API.
- **Mobil:** aplikácia sa dá pridať na plochu (Safari → Zdieľať → Pridať na plochu, Chrome → ⋮ → Pridať na plochu) a otvára sa ako samostatná appka.
- Server nepotrebuje žiadne npm balíčky, stačí **Node.js 22** alebo Docker.

---

## 2. Spustenie na internete – Railway (odporúčané)

Railway je služba, ktorá appku spustí priamo z tohto GitHub repozitára. Cena je cca **5 $ mesačne** (Hobby plán). Nemusíš sa starať o server ani o HTTPS.

1. Choď na **https://railway.com** → **Login** → **Login with GitHub**.
2. **New Project → Deploy from GitHub repo** → vyber **stribok**. Ak ho nevidíš, klikni **Configure GitHub App** a povoľ Railway prístup k repozitáru.
3. Railway nájde `Dockerfile` a appku zostaví sama (1–3 minúty).
4. **Dôležité – miesto na dáta:** v projekte klikni pravým na plochu (alebo **+ Create**) → **Volume** → pripoj ho k službe **stribok** a ako *Mount path* zadaj **`/data`**. Bez tohto kroku sa dáta pri každej aktualizácii zmažú.
5. V službe otvor **Settings → Networking → Generate Domain**. Dostaneš adresu typu `https://stribok-production.up.railway.app`.
6. Otvor adresu a pokračuj krokom [5. Prvé spustenie](#5-prvé-spustenie-a-prenos-dát-z-claudeai).

**Vlastná doména** (napr. `app.stribog.sk`): v **Settings → Networking → Custom Domain** zadaj doménu a u registrátora domény pridaj záznam **CNAME**, ktorý ti Railway ukáže. HTTPS sa nastaví samo.

**Aktualizácie:** každá zmena v GitHube (vetva `main`) sa na Railway nasadí automaticky do pár minút. Dáta na Volume ostávajú.

**Záloha na Railway:** ak to tvoj plán ponúka, zapni si vo Volume automatické zálohy (*Backups*). V každom prípade zálohuj aj podľa [kapitoly 7](#7-zálohy-a-obnova).

---

## 3. Spustenie na vlastnom serveri (VPS)

Vhodné, ak chceš mať všetko u seba. Najmenší server napríklad na Hetzner Cloud stojí cca 4–6 € mesačne.

### 3.1 Server a doména

1. Vytvor server s **Ubuntu 24.04** (Hetzner: *Add Server → Ubuntu → najmenší typ*). Zapíš si jeho **IP adresu**.
2. U registrátora domény (napr. Websupport) pridaj záznam **A**: `app.tvojadomena.sk` → IP servera.

### 3.2 Inštalácia (raz)

Prihlás sa na server (`ssh root@IP`) a spusti:

```bash
curl -fsSL https://get.docker.com | sh          # nainštaluje Docker
git clone https://github.com/stomatologzub/stribok.git
cd stribok
cp .env.example .env
nano .env                                        # nastav DOMAIN=app.tvojadomena.sk, ulož Ctrl+O, Enter, Ctrl+X
docker compose up -d --build
```

Ak je repozitár súkromný, `git clone` sa spýta na meno a heslo. Ako heslo zadaj **Personal access token** (GitHub → Settings → Developer settings → Personal access tokens → Fine-grained → prístup *Contents: Read* k repozitáru stribok).

Po minúte otvor `https://app.tvojadomena.sk`. HTTPS certifikát vybaví Caddy automaticky.

### 3.3 Aktualizácia

```bash
cd stribok && git pull && docker compose up -d --build
```

### 3.4 Užitočné príkazy

```bash
docker compose logs -f app        # čo sa deje (Ctrl+C ukončí)
docker compose restart app        # reštart
docker compose exec app node server/cli.js ludia   # správa – pozri kapitolu 9
```

Dáta sú v Docker volume `stribok_stribog_data`.

---

## 4. Spustenie na vlastnom počítači (na skúšku)

1. Nainštaluj **Node.js 22** alebo novší z https://nodejs.org (verzia LTS).
2. Stiahni repozitár (GitHub → **Code → Download ZIP**, rozbaľ) alebo `git clone`.
3. V priečinku spusti:

```bash
npm start
```

4. Otvor **http://localhost:8080**. Dáta sa ukladajú do priečinka `data/`.

Ostatní na tej istej Wi-Fi sa pripoja cez `http://IP-tvojho-počítača:8080`. Na reálne používanie ale odporúčame Railway alebo VPS.

**Náhľad bez servera:** `dev/preview.html` ukáže appku s vymyslenými dátami bez ukladania. Spusti `python3 -m http.server` a otvor `http://localhost:8000/dev/preview.html` (`?role=worker` = pohľad technika).

---

## 5. Prvé spustenie a prenos dát z claude.ai

Pri prvom otvorení prázdnej aplikácie máš dve možnosti.

### A) Začať odznova

**Začať odznova** → zadaj svoje meno a PIN → si admin. Ďalší postup je v [kapitole 6](#6-každodenná-správa).

### B) Preniesť dáta z verzie v claude.ai

Prenesú sa projekty, súpisy, úlohy, dochádzka, chat, evidencia, fotky aj ľudia. Pri ľuďoch ostanú zachované staré priradenia úloh a dochádzky.

1. **V claude.ai** otvor appku ako admin → v menu **Export dát** → **Stiahnuť všetky dáta**. Potvrď stiahnutie a dostaneš súbor `stribog-export-RRRR-MM-DD.json`.
2. **Na novom serveri** otvor appku → **Preniesť dáta zo zálohy / z claude.ai** → vyber stiahnutý súbor.
3. Zobrazí sa zoznam ľudí. **Vyber sám seba** a nastav si PIN – staneš sa adminom.
4. Ostatní ľudia sú zatiaľ **deaktivovaní**. V **Prístupoch** zaškrtni „Zobraziť aj deaktivovaných“ → klikni na človeka → zadaj mu PIN (prípadne oprav meno a rolu) → **Znova aktivovať**.
5. Pošli ľuďom adresu aplikácie a ich PIN.

Ak si medzičasom v claude.ai ešte niečo zmenil, export zopakuj a nahraj ho v **Prístupy → Obnoviť zo zálohy → Nahradiť všetko**.

---

## 6. Každodenná správa

### Pridanie človeka
**Prístupy → Pridať človeka** → meno, rola, PIN (navrhne sa náhodný). PIN mu povedz osobne. V appke sa už znova nezobrazí.

Ak má technik dostávať úlohy aj cez **Evidenciu → Technici**, v jeho karte vyber v poli *Účet v aplikácii* jeho meno.

### Zabudnutý PIN
**Prístupy** → klikni na človeka → zadaj **Nový PIN** → Uložiť. Človek sa musí prihlásiť znova.
Ak PIN zabudne jediný admin, nastav ho z príkazového riadku: `node server/cli.js pin "Meno" 1234` (kapitola 9).

### Zmena vlastného PIN-u, odhlásenie
Klikni na svoje meno (desktop: vľavo dole, mobil: hore) → **Zmeniť PIN** alebo **Odhlásiť sa**.

### Odchod človeka z firmy
**Prístupy** → človek → **Deaktivovať**. Okamžite sa odhlási na všetkých zariadeniach. Jeho meno ostane pri starých úlohách a dochádzke. Neskôr ho môžeš znova aktivovať.

### Admin alebo technik
V karte človeka zmeň **Rolu**. Vždy musí ostať aspoň jeden aktívny admin.

### Kalkulácia pre klienta
V projekte **Pre klienta** máš dve možnosti:
- **Stiahnuť pre klienta (.html)** – súbor pošleš ako prílohu.
- **Vytvoriť odkaz pre klienta** – verejná stránka bez prihlásenia, odkaz sa skopíruje. Po zmene súpisu klikni **Aktualizovať odkaz**. Klient vždy vidí stav z posledného zverejnenia a adresa ostáva rovnaká.

### Čítanie súpisu z fotiek (voliteľné)
Tlačidlo **Nahrať z telefónu** prečíta odfotený súpis pomocou umelej inteligencie. Je to jediná funkcia, ktorá používa externú službu (Claude API od Anthropicu):

1. Na **https://console.anthropic.com** si vytvor účet, v *Billing* dobi kredit (napr. 10 $) a v *API Keys* vytvor kľúč.
2. Kľúč nastav na serveri ako premennú `ANTHROPIC_API_KEY`:
   - na Railway v **Variables**,
   - na VPS v súbore `.env` a potom spusti `docker compose up -d`.
3. Platí sa podľa použitia, rádovo centy za stranu.

Bez kľúča je tlačidlo skryté a všetko ostatné funguje normálne. Projekty sa dajú zakladať aj ručne alebo importom úloh z CSV súboru.

---

## 7. Zálohy a obnova

| Spôsob | Čo zálohuje | Ako |
|---|---|---|
| **V aplikácii** | všetky dáta, voliteľne aj fotky | Prístupy → **Stiahnuť zálohu** / **Záloha aj s fotkami** |
| **Príkazový riadok** | všetky dáta, voliteľne aj fotky | `node server/cli.js export zaloha.json --fotky` |
| **Celý priečinok s dátami** | úplne všetko | skopíruj priečinok `/data` (Railway: zálohy Volume) |

**Odporúčanie:** raz týždenne stiahni **zálohu aj s fotkami** a ulož ju mimo servera, napríklad na Google Drive.

**Obnova:** Prístupy → **Obnoviť zo zálohy** → vyber súbor:
- **Doplniť** prepíše len záznamy zo zálohy, ostatné nechá.
- **Nahradiť všetko** zmaže súčasné dáta a dá tam zálohu.

Účty a PIN-y ostávajú bez zmeny. Ľudia zo zálohy, ktorí na serveri nie sú, sa pridajú ako deaktivovaní.

**Presun na iný server:** na novom serveri pri prvom spustení zvoľ **Preniesť dáta zo zálohy** a nahraj **zálohu aj s fotkami**. Ďalej sa postupuje ako v kapitole 5B.

---

## 8. Úpravy aplikácie a aktualizácie

Celá aplikácia je v jednom súbore **`index.html`** (HTML, CSS a JavaScript), takže ju vie upraviť každý webový vývojár.

**Malá zmena priamo na GitHube** (napr. text alebo predvolený cenník):
1. Na GitHube otvor `index.html` → ikona ceruzky (**Edit**).
2. Uprav a klikni **Commit changes**.
3. Railway zmenu nasadí sám. Na VPS spusti `git pull && docker compose up -d --build`.

**Väčšie úpravy:** stiahni repozitár, spusti `npm run dev` (server sa reštartuje pri každej zmene), uprav `index.html` alebo `server/`, otestuj na `http://localhost:8080` a nahraj späť na GitHub (`git commit` + `git push`, alebo GitHub Desktop).

Kde čo nájdeš:
- **Predvolený cenník** – `DEFAULT_PRICES` v `index.html`. Ceny konkrétneho projektu sa menia priamo v appke (projekt → Cenník).
- **Firemné postupy** – šablóny `PROC_TEMPLATES` v `index.html`. Vlastné postupy pridáš v appke (Evidencia → Postupy).
- **Farby a vzhľad** – premenné na začiatku `<style id="appcss">` (`--accent`, `--gold`…).
- **Pravidlá prístupu** – `RULES` v `server/server.js`.
- **Dátový model a API** – [`docs/ARCHITEKTURA.md`](docs/ARCHITEKTURA.md).

---

## 9. Príkazový riadok (správa na serveri)

Spúšťa sa tam, kde beží server:

| Kde | Ako spustiť |
|---|---|
| lokálne | `node server/cli.js …` |
| VPS | `docker compose exec app node server/cli.js …` |
| Railway | nainštaluj [Railway CLI](https://docs.railway.com/guides/cli), spusti `railway login`, `railway link` a `railway ssh`, potom `node server/cli.js …` |

| Príkaz | Čo robí |
|---|---|
| `ludia` | zoznam ľudí, rolí a id |
| `pin "Meno" 1234` | nastaví nový PIN (aj zabudnutý) a aktivuje účet |
| `admin "Meno"` | urobí z človeka admina |
| `technik "Meno"` | zmení admina na technika |
| `pridaj "Meno" 1234 [--admin]` | pridá človeka |
| `export [subor.json] [--fotky]` | záloha (s `--fotky` aj fotky) |
| `import subor.json [--nahradit]` | obnova zo zálohy alebo z exportu z claude.ai |

Stačí aj časť mena, ak je jednoznačná (`pin jano 4821`).

---

## 10. Nastavenia

Premenné prostredia (Railway: **Variables**, VPS: súbor `.env`):

| Premenná | Predvolene | Význam |
|---|---|---|
| `PORT` | `8080` | port servera (Railway nastaví sám) |
| `DATA_DIR` | `./data`, v Dockeri `/data` | kde je databáza a fotky |
| `DOMAIN` | – | len VPS (docker compose): doména pre HTTPS |
| `ANTHROPIC_API_KEY` | – | zapne čítanie súpisu z fotiek |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | model na čítanie súpisu |
| `COOKIE_SECURE` | – | `1` = prihlásenie len cez HTTPS (za proxy sa zistí automaticky) |

---

## 11. Riešenie problémov

| Problém | Riešenie |
|---|---|
| Po aktualizácii sú dáta preč (Railway) | Chýba Volume na `/data` – kapitola 2, krok 4. Potom obnov poslednú zálohu. |
| „Priveľa nesprávnych pokusov“ | Účet sa po 5 chybných PIN-och na 5 minút zamkne. Počkaj alebo nastav nový PIN. |
| Niekto sa nevie prihlásiť | Skontroluj v Prístupoch, či je aktívny. Nastav mu nový PIN. |
| Admin zabudol PIN | `node server/cli.js pin "Meno" 1234` (kapitola 9). |
| „Server nie je dostupný“ | Railway: pozri **Deployments → Logs**. VPS: `docker compose logs app`. |
| Zmeny od kolegov sa nezobrazujú hneď | Obnov stránku. Za vlastnou proxy (nginx) vypni buffering pre `/api/events`. Caddy z docker-compose to má nastavené. |
| Chýba tlačidlo „Nahrať z telefónu“ | Nie je nastavený `ANTHROPIC_API_KEY` (kapitola 6). |
| Biela obrazovka | Obnov stránku (Ctrl+Shift+R). Ak to nepomôže, pozri konzolu prehliadača (F12) a logy servera. |

---

## 12. Bezpečnosť

- PIN-y sú uložené len ako hash (scrypt), nikdy v čitateľnej podobe.
- Po 5 chybných pokusoch sa účet zamkne na 5 minút. Po 20 chybných pokusoch z jednej IP adresy sa zablokuje na 15 minút.
- Prihlásenie je v HttpOnly cookie, ktorú nevie prečítať žiadny skript.
- Pravidlá prístupu kontroluje server (`RULES` v `server/server.js`):

| Dáta | Číta | Zapisuje |
|---|---|---|
| súpisy, ceny, súhrny, technici (`admin/…`) | admin | admin |
| projekty, evidencia, nastavenia chatu (`meta/…`) | všetci | admin |
| dochádzka (`hours/<človek>`) | ten človek + admin | ten človek + admin |
| úlohy, chat | všetci | všetci |

- Verejné odkazy pre klienta (`/k/…`) obsahujú len kalkuláciu. Bez náhodného odkazu ich nikto nenájde a vyhľadávače ich neindexujú.
- Repozitár drž **súkromný** (GitHub → Settings → General → Danger Zone → Change visibility), lebo `index.html` obsahuje predvolený cenník.

---

## 13. Štruktúra projektu

```
index.html             celá aplikácia (frontend)
server/server.js       HTTP server: API, realtime, prihlásenie, fotky, verejné odkazy, AI
server/store.js        databáza (SQLite), import a export
server/shim.js         prepojenie appky so serverom + prihlasovacia obrazovka
server/cli.js          správa z príkazového riadku
public/                ikony a manifest pre mobil
Dockerfile             obraz pre Railway / Docker
docker-compose.yml     VPS: appka + Caddy (HTTPS)
Caddyfile              nastavenie HTTPS proxy
.env.example           vzor nastavení pre VPS
dev/                   náhľad bez servera s demo dátami
capabilities.json      nastavenia pre pôvodnú verziu v claude.ai (už netreba)
docs/ARCHITEKTURA.md   dátový model, API, pravidlá
```

Ten istý `index.html` funguje aj ako artifact v claude.ai, kde sa namiesto Prístupov zobrazí **Export dát**. Na vlastnom serveri ho už netreba.
