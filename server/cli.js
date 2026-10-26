#!/usr/bin/env node
/* Stribog – správa z príkazového riadku (na serveri, kde beží appka).
   Použitie: node server/cli.js <príkaz> …  (alebo: npm run cli -- <príkaz> …) */
"use strict";
const fs = require("node:fs");
const store = require("./store");
const { db, Q, setPin, validPin, addUser, importData, exportData, DATA_DIR } = store;

const [cmd, ...args] = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith("--")));
const pos = args.filter(a => !a.startsWith("--"));

function findUser(q) {
  if (!q) die("Chýba meno alebo id človeka.");
  const all = Q.users.all();
  const exact = all.find(u => u.id === q) || all.find(u => u.name.toLowerCase() === q.toLowerCase());
  if (exact) return exact;
  const part = all.filter(u => u.name.toLowerCase().includes(q.toLowerCase()));
  if (part.length === 1) return part[0];
  if (part.length > 1) die(`„${q}“ sedí na viac ľudí: ${part.map(u => u.name).join(", ")} – napíš celé meno.`);
  die(`Človek „${q}“ sa nenašiel. Zoznam: node server/cli.js ludia`);
}
function die(m) { console.error("✗ " + m); process.exit(1); }
const ok = m => console.log("✓ " + m);

switch (cmd) {
  case "ludia": case "users": {
    const all = Q.users.all();
    if (!all.length) { console.log("Zatiaľ nikto – otvor appku a vytvor admin účet."); break; }
    for (const u of all) console.log(`${u.active ? "●" : "○"} ${u.name.padEnd(28)} ${(u.role === "admin" ? "admin" : "technik").padEnd(8)} ${u.active ? "aktívny" : "deaktivovaný"}   id: ${u.id}`);
    break;
  }
  case "pin": {
    const u = findUser(pos[0]); const pin = pos[1];
    if (!validPin(pin)) die("PIN musí mať 4–8 číslic. Príklad: node server/cli.js pin \"Jano\" 4821");
    setPin(u.id, pin);
    db.prepare("UPDATE users SET active=1 WHERE id=?").run(u.id);
    Q.delUserSessions.run(u.id);
    ok(`${u.name}: nový PIN nastavený, účet je aktívny.`);
    break;
  }
  case "admin": {
    const u = findUser(pos[0]);
    db.prepare("UPDATE users SET role='admin', active=1 WHERE id=?").run(u.id);
    ok(`${u.name} je teraz admin.`);
    break;
  }
  case "technik": {
    const u = findUser(pos[0]);
    if (u.role === "admin" && Q.countAdmins.get().n <= 1) die("Musí ostať aspoň jeden admin.");
    db.prepare("UPDATE users SET role='worker' WHERE id=?").run(u.id);
    Q.delUserSessions.run(u.id);
    ok(`${u.name} je teraz technik.`);
    break;
  }
  case "pridaj": case "add": {
    const [name, pin] = pos;
    if (!name || !validPin(pin)) die("Použitie: node server/cli.js pridaj \"Meno Priezvisko\" 1234 [--admin]");
    const u = addUser({ name, pin, role: flags.has("--admin") ? "admin" : "worker" });
    ok(`${u.name} pridaný (${u.role === "admin" ? "admin" : "technik"}).`);
    break;
  }
  case "export": {
    const file = pos[0] || `stribog-zaloha-${new Date().toISOString().slice(0, 10)}.json`;
    const data = exportData({ blobs: flags.has("--fotky") });
    fs.writeFileSync(file, JSON.stringify(data));
    ok(`Záloha uložená do ${file} (${Object.keys(data.docs).length} záznamov${data.blobs ? `, ${Object.keys(data.blobs).length} fotiek` : ""}).`);
    break;
  }
  case "import": {
    const file = pos[0];
    if (!file || !fs.existsSync(file)) die("Použitie: node server/cli.js import subor.json [--nahradit]");
    const r = importData(JSON.parse(fs.readFileSync(file, "utf8")), { replace: flags.has("--nahradit") });
    ok(`Obnovené: ${r.docs} záznamov, ${r.blobs} fotiek, ${r.people} nových ľudí (deaktivovaní – nastav im PIN: node server/cli.js pin "Meno" 1234).`);
    console.log("  Ak appka práve beží, ľudia uvidia zmeny po obnovení stránky.");
    break;
  }
  default:
    console.log(`Stribog – správa z príkazového riadku   (dáta: ${DATA_DIR})

  ludia                          zoznam ľudí a ich rolí
  pin "Meno" 1234                nastaví nový PIN (aj keď ho niekto zabudol) a aktivuje účet
  admin "Meno"                   urobí z človeka admina
  technik "Meno"                 zmení admina na technika
  pridaj "Meno" 1234 [--admin]   pridá človeka
  export [subor.json] [--fotky]  záloha všetkých dát (s --fotky aj fotiek)
  import subor.json [--nahradit] obnova zo zálohy alebo z exportu z claude.ai
`);
}
