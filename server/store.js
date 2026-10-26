/* Stribog – dátová vrstva (SQLite + fotky na disku). Používa ju server aj príkazový riadok (cli.js). */
"use strict";
// node:sqlite vypisuje pri štarte upozornenie „experimental“ – je funkčný, upozornenie skryjeme
const _emit = process.emitWarning;
process.emitWarning = function (w, ...a) { if (String(w && w.message || w).includes("SQLite")) return; return _emit.call(process, w, ...a); };
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const BLOB_DIR = path.join(DATA_DIR, "blobs");
fs.mkdirSync(BLOB_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "stribog.db"));
db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS docs(path TEXT PRIMARY KEY, parent TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS docs_parent ON docs(parent);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, color TEXT NOT NULL,
  salt TEXT NOT NULL, pin TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL, last_login INTEGER,
  fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS blobs(id TEXT PRIMARY KEY, type TEXT NOT NULL, size INTEGER NOT NULL, by TEXT, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pubpages(project_id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, html TEXT NOT NULL, updated INTEGER NOT NULL, by TEXT);
`);
const Q = {
  getDoc: db.prepare("SELECT data FROM docs WHERE path=?"),
  listDocs: db.prepare("SELECT path,data FROM docs WHERE parent=?"),
  putDoc: db.prepare("INSERT INTO docs(path,parent,data,updated) VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET data=excluded.data,updated=excluded.updated"),
  delDoc: db.prepare("DELETE FROM docs WHERE path=?"),
  allDocs: db.prepare("SELECT path,data FROM docs ORDER BY path"),
  userById: db.prepare("SELECT * FROM users WHERE id=?"),
  users: db.prepare("SELECT * FROM users ORDER BY role='admin' DESC, name COLLATE NOCASE"),
  countAdmins: db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1"),
  countUsers: db.prepare("SELECT COUNT(*) n FROM users"),
  countActive: db.prepare("SELECT COUNT(*) n FROM users WHERE active=1"),
  addUser: db.prepare("INSERT INTO users(id,name,role,color,salt,pin,active,created) VALUES(?,?,?,?,?,?,?,?)"),
  session: db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.active=1"),
  addSession: db.prepare("INSERT INTO sessions(token,user_id,created,expires) VALUES(?,?,?,?)"),
  delSession: db.prepare("DELETE FROM sessions WHERE token=?"),
  delUserSessions: db.prepare("DELETE FROM sessions WHERE user_id=?"),
  addBlob: db.prepare("INSERT OR REPLACE INTO blobs(id,type,size,by,created) VALUES(?,?,?,?,?)"),
  getBlob: db.prepare("SELECT * FROM blobs WHERE id=?"),
  allBlobs: db.prepare("SELECT * FROM blobs"),
  pubByProject: db.prepare("SELECT * FROM pubpages WHERE project_id=?"),
  pubByToken: db.prepare("SELECT * FROM pubpages WHERE token=?"),
  putPub: db.prepare("INSERT INTO pubpages(project_id,token,html,updated,by) VALUES(?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET html=excluded.html,updated=excluded.updated,by=excluded.by"),
};
db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());

const now = () => Date.now();
const rid = (n = 20) => { let s = ""; while (s.length < n) s += crypto.randomBytes(n).toString("base64url").replace(/[-_]/g, ""); return s.slice(0, n); };
const parentOf = p => p.split("/").slice(0, -1).join("/");
const COLORS = ["#2BB3B1", "#0E6E6E", "#C2410C", "#7C3AED", "#2563EB", "#B45309", "#DB2777", "#15803D", "#4B5563", "#9333EA"];
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString("hex");
const validPin = p => /^\d{4,8}$/.test(String(p || ""));
const cleanName = n => String(n || "").replace(/\s+/g, " ").trim().slice(0, 60);
const publicUser = u => ({ id: u.id, name: u.name, role: u.role, color: u.color, active: !!u.active });
const BLOB_ID = /^[A-Za-z0-9_-]{8,64}$/;
const USER_ID = /^[A-Za-z0-9_.:@-]{1,80}$/;
const IMAGE_TYPE = /^image\/(jpeg|png|webp|gif|heic|heif)$/;

function validPath(p, wantDoc) {
  if (typeof p !== "string" || !p || p.length > 400) return false;
  const s = p.split("/");
  if (s.some(x => !x || x === "." || x === ".." || x.length > 150)) return false;
  return wantDoc ? s.length % 2 === 0 : s.length % 2 === 1;
}

function addUser({ id, name, role, pin, active = true }) {
  const salt = rid(16);
  const uid = id || "u_" + rid(12);
  Q.addUser.run(uid, cleanName(name) || "Bez mena", role === "admin" ? "admin" : "worker", COLORS[Q.countUsers.get().n % COLORS.length], salt, hashPin(pin || rid(24), salt), active ? 1 : 0, now());
  return Q.userById.get(uid);
}
function setPin(id, pin) {
  const salt = rid(16);
  db.prepare("UPDATE users SET salt=?, pin=?, fails=0, locked_until=0 WHERE id=?").run(salt, hashPin(pin, salt), id);
}
function saveBlob(id, type, buf, by) {
  fs.writeFileSync(path.join(BLOB_DIR, id), buf);
  Q.addBlob.run(id, type, buf.length, by || null, now());
}

/* Import zálohy / exportu z claude.ai.
   payload = { docs: {path: data}, people?: [{id, name, role}], blobs?: {id: {type, data(base64)}} }
   Ľudia, ktorí ešte neexistujú, sa založia ako DEAKTIVOVANÍ (s rovnakým id, aby sedeli staré záznamy) –
   admin im v Prístupoch nastaví PIN a aktivuje ich. */
function importData(payload, { replace = false } = {}) {
  const docs = payload && typeof payload.docs === "object" && !Array.isArray(payload.docs) ? payload.docs : null;
  if (!docs) throw Object.assign(new Error("Súbor neobsahuje dáta aplikácie"), { status: 400 });
  const out = { docs: 0, people: 0, blobs: 0 };
  db.exec("BEGIN");
  try {
    if (replace) db.exec("DELETE FROM docs");
    for (const [k, v] of Object.entries(docs)) {
      if (validPath(k, true) && v && typeof v === "object") { Q.putDoc.run(k, parentOf(k), JSON.stringify(v), now()); out.docs++; }
    }
    for (const p of Array.isArray(payload.people) ? payload.people : []) {
      if (!p || !USER_ID.test(String(p.id || "")) || Q.userById.get(p.id)) continue;
      addUser({ id: p.id, name: p.name || "Kolega", role: p.role, active: false });
      out.people++;
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  for (const [id, b] of Object.entries(payload.blobs && typeof payload.blobs === "object" ? payload.blobs : {})) {
    if (!BLOB_ID.test(id) || !b || typeof b.data !== "string") continue;
    const type = IMAGE_TYPE.test(b.type || "") ? b.type : "image/jpeg";
    saveBlob(id, type, Buffer.from(b.data, "base64"), null);
    out.blobs++;
  }
  return out;
}
function exportData({ blobs = false } = {}) {
  const docs = {};
  for (const r of Q.allDocs.all()) docs[r.path] = JSON.parse(r.data);
  const people = Q.users.all().map(u => ({ id: u.id, name: u.name, role: u.role }));
  const out = { app: "stribog", version: 2, exportedAt: new Date().toISOString(), docs, people };
  if (blobs) {
    out.blobs = {};
    for (const b of Q.allBlobs.all()) {
      const f = path.join(BLOB_DIR, b.id);
      if (fs.existsSync(f)) out.blobs[b.id] = { type: b.type, data: fs.readFileSync(f).toString("base64") };
    }
  }
  return out;
}

module.exports = { db, Q, ROOT, DATA_DIR, BLOB_DIR, now, rid, parentOf, COLORS, hashPin, validPin, cleanName, publicUser, validPath, addUser, setPin, saveBlob, importData, exportData, BLOB_ID, IMAGE_TYPE };
