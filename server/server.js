/* Stribog – backend
   Node.js 22+ bez externých závislostí: HTTP server, SQLite (node:sqlite), realtime cez SSE,
   prihlásenie menom + PIN-om, fotky na disku, voliteľne čítanie súpisu z fotiek cez Anthropic API.
   Premenné prostredia: PORT, DATA_DIR, ANTHROPIC_API_KEY, ANTHROPIC_MODEL, COOKIE_SECURE */
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const store = require("./store");
const { db, Q, DATA_DIR, BLOB_DIR, now, rid, parentOf, hashPin, validPin, cleanName, publicUser, validPath, addUser, setPin, saveBlob, importData, exportData } = store;

const PORT = +process.env.PORT || 8080;
const ROOT = path.resolve(__dirname, "..");
const AI_KEY = process.env.ANTHROPIC_API_KEY || "";
const AI_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const AI_URL = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "") + "/v1/messages";
const COOKIE = "stribog_s";
const SESSION_DAYS = 180;
const MAX_JSON = 8 * 1024 * 1024;
const MAX_BLOB = 15 * 1024 * 1024;
const MAX_AI = 60 * 1024 * 1024;
const MAX_IMPORT = 400 * 1024 * 1024;

/* Pravidlá prístupu – rovnaké ako v capabilities.json (najkonkrétnejšie pravidlo vyhráva).
   "team" = každý prihlásený, "admin" = rola admin. */
const RULES = [
  { path: "", read: "team", write: "team" },
  { path: "admin", read: "admin", write: "admin" },
  { path: "meta", read: "team", write: "admin" },
  { path: "hours", read: "admin", write: "admin" },
  { path: "hours/{self}", read: "team", write: "team" },
];
function ruleFor(p, user) {
  const segs = p.split("/");
  let best = RULES[0], bestLen = 0;
  for (const r of RULES) {
    if (!r.path) continue;
    const rs = r.path.split("/");
    if (rs.length > segs.length) continue;
    const ok = rs.every((x, i) => x === "{self}" ? segs[i] === user.id : x === segs[i]);
    if (ok && rs.length > bestLen) { best = r; bestLen = rs.length; }
  }
  return best;
}
function allowed(p, user, op) {
  if (!user) return false;
  const lvl = ruleFor(p, user)[op];
  return lvl === "team" || (lvl === "admin" && user.role === "admin");
}

function send(res, code, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf ? body : typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": isBuf ? "application/octet-stream" : typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(data);
}
const fail = (res, code, errCode, message) => send(res, code, { error: { code: errCode, message: message || errCode } });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", c => { size += c.length; if (size > limit) { reject(Object.assign(new Error("too_large"), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function readJson(req, limit = MAX_JSON) {
  const b = await readBody(req, limit);
  if (!b.length) return {};
  try { return JSON.parse(b.toString("utf8")); } catch { throw Object.assign(new Error("bad_json"), { status: 400 }); }
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(c => { const i = c.indexOf("="); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return out;
}
function currentUser(req) {
  const t = cookies(req)[COOKIE];
  if (!t) return null;
  return Q.session.get(t, now()) || null;
}
function sessionCookie(req, token, maxAge) {
  const secure = process.env.COOKIE_SECURE === "1" || req.headers["x-forwarded-proto"] === "https";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

/* ---------------- realtime (SSE) ---------------- */
const clients = new Set();
function broadcast(p) {
  const msg = `data: ${JSON.stringify({ path: p })}\n\n`;
  for (const c of clients) {
    // posielame len cestu – klient si dáta načíta znova cez API, kde sa overia práva
    if (allowed(p, c.user, "read") || allowed(parentOf(p) || p, c.user, "read")) c.res.write(msg);
  }
}
function kickUser(userId) {
  for (const c of clients) if (c.user.id === userId) { try { c.res.end(); } catch {} clients.delete(c); }
}
setInterval(() => { for (const c of clients) c.res.write(": ping\n\n"); }, 25000).unref();

/* ---------------- documents ---------------- */
function getDoc(p) { const r = Q.getDoc.get(p); return r ? JSON.parse(r.data) : null; }
function writeDoc(p, data) { Q.putDoc.run(p, parentOf(p), JSON.stringify(data), now()); broadcast(p); }
function deleteDoc(p) { Q.delDoc.run(p); broadcast(p); }
function getField(o, f) { return f.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o); }
function cmp(a, b) { if (a === b) return 0; if (a === undefined || a === null) return -1; if (b === undefined || b === null) return 1; return a < b ? -1 : 1; }
function listCollection(col, q) {
  let rows = Q.listDocs.all(col).map(r => ({ id: r.path.split("/").pop(), data: JSON.parse(r.data) }));
  for (const w of q.where || []) {
    const [f, op, v] = w;
    rows = rows.filter(r => {
      const x = getField(r.data, f);
      switch (op) {
        case "==": return x === v; case "!=": return x !== v; case "<": return x < v; case "<=": return x <= v;
        case ">": return x > v; case ">=": return x >= v; case "in": return Array.isArray(v) && v.includes(x);
        case "array-contains": return Array.isArray(x) && x.includes(v); default: return true;
      }
    });
  }
  const ob = q.orderBy || [];
  rows.sort((a, b) => {
    for (const [f, dir] of ob) { const c = cmp(getField(a.data, f), getField(b.data, f)); if (c) return dir === "desc" ? -c : c; }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  if (q.limit > 0) rows = rows.slice(0, q.limit);
  return rows;
}
function deepMerge(base, patch) {
  // update(): kľúče na najvyššej úrovni nahrádzajú hodnotu; "a.b" cesty nastavia vnorené pole
  const out = JSON.parse(JSON.stringify(base || {}));
  for (const [k, v] of Object.entries(patch || {})) {
    if (k.includes(".")) {
      const ks = k.split("."); let o = out;
      ks.slice(0, -1).forEach(x => { if (typeof o[x] !== "object" || o[x] === null) o[x] = {}; o = o[x]; });
      if (v === undefined) delete o[ks.at(-1)]; else o[ks.at(-1)] = v;
    } else if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}

/* ---------------- static ---------------- */
const MIME = { ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon" };
function serveIndex(res) {
  send(res, 200, fs.readFileSync(path.join(ROOT, "index.html")), { "Content-Type": MIME[".html"], "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
}
function serveStatic(res, rel) {
  const f = path.join(ROOT, "public", rel);
  if (!f.startsWith(path.join(ROOT, "public") + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return false;
  const ext = path.extname(f);
  const cache = /^(vendor|fonts)\//.test(rel) ? "public, max-age=604800" : "no-cache"; // knižnice a písma sa nemenia
  send(res, 200, fs.readFileSync(f), { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": cache, "X-Content-Type-Options": "nosniff" });
  return true;
}

/* ---------------- login rate limiting ---------------- */
const ipFails = new Map();
function ipBlocked(ip) { const r = ipFails.get(ip); return r && r.n >= 20 && now() - r.t < 15 * 60e3; }
function ipFail(ip) { const r = ipFails.get(ip); if (!r || now() - r.t > 15 * 60e3) ipFails.set(ip, { n: 1, t: now() }); else r.n++; }

/* ---------------- AI (čítanie súpisu z fotiek) ---------------- */
async function aiSample(body, signal) {
  const content = [];
  for (const im of (body.images || []).slice(0, 20)) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(im.type || "") || typeof im.data !== "string") throw Object.assign(new Error("image_rejected"), { status: 400 });
    content.push({ type: "image", source: { type: "base64", media_type: im.type, data: im.data } });
  }
  content.push({ type: "text", text: String(body.prompt || "") });
  const r = await fetch(AI_URL, {
    method: "POST", signal,
    headers: { "content-type": "application/json", "x-api-key": AI_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: AI_MODEL, max_tokens: 16000, messages: [{ role: "user", content }] }),
  });
  if (r.status === 429) throw Object.assign(new Error("rate_limited"), { status: 429 });
  if (!r.ok) { const t = await r.text().catch(() => ""); console.error("AI error", r.status, t.slice(0, 500)); throw Object.assign(new Error(r.status === 400 ? "image_rejected" : "ai_error"), { status: 502 }); }
  const j = await r.json();
  const text = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  try { return JSON.parse(text.slice(a, b + 1)); } catch { throw Object.assign(new Error("invalid_json"), { status: 502 }); }
}

/* ---------------- router ---------------- */
async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const m = req.method;
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress;

  if (p === "/healthz") return send(res, 200, "ok");
  if (m === "GET" && (p === "/" || p === "/index.html")) return serveIndex(res);

  /* ---- auth (bez prihlásenia) ---- */
  /* verejná stránka kalkulácie pre klienta (bez prihlásenia) */
  const mk = p.match(/^\/k\/([A-Za-z0-9]{16,64})$/);
  if (mk && m === "GET") {
    const pg = Q.pubByToken.get(mk[1]);
    if (!pg) return send(res, 404, "Stránka neexistuje alebo bola zrušená.");
    return send(res, 200, pg.html, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache", "X-Robots-Tag": "noindex",
      "Content-Security-Policy": "sandbox allow-popups allow-downloads; default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:" });
  }

  /* ---- auth (bez prihlásenia) ---- */
  const needsSetup = () => Q.countActive.get().n === 0;
  const startSession = (uid) => { const token = rid(40); Q.addSession.run(token, uid, now(), now() + SESSION_DAYS * 864e5); return { "Set-Cookie": sessionCookie(req, token, SESSION_DAYS * 86400) }; };
  if (p === "/api/auth/state" && m === "GET") {
    const user = currentUser(req);
    const setup = needsSetup();
    const all = Q.users.all();
    const people = all.filter(u => u.active).map(u => ({ id: u.id, name: u.name, color: u.color }));
    // pri prvom spustení po prenose dát: ľudia zo zálohy, z ktorých si admin vyberie sám seba
    const imported = setup ? all.map(u => ({ id: u.id, name: u.name, color: u.color, role: u.role })) : [];
    return send(res, 200, { setup, people, imported, me: user ? publicUser(user) : null, ai: !!AI_KEY });
  }
  if (p === "/api/auth/setup-import" && m === "POST") {
    if (!needsSetup()) return fail(res, 409, "already_setup", "Aplikácia už je nastavená – obnovu urob v sekcii Prístupy");
    const b = await readJson(req, MAX_IMPORT);
    const r = importData(b, { replace: true });
    return send(res, 200, { ok: true, ...r });
  }
  if (p === "/api/auth/setup" && m === "POST") {
    const b = await readJson(req);
    if (!needsSetup()) return fail(res, 409, "already_setup", "Aplikácia už je nastavená");
    if (!validPin(b.pin)) return fail(res, 400, "invalid_argument", "PIN musí mať 4–8 číslic");
    let uid;
    if (b.userId) {
      const u = Q.userById.get(String(b.userId));
      if (!u) return fail(res, 404, "not_found", "Človek sa nenašiel");
      setPin(u.id, b.pin);
      db.prepare("UPDATE users SET role='admin', active=1, last_login=? WHERE id=?").run(now(), u.id);
      uid = u.id;
    } else {
      const name = cleanName(b.name);
      if (!name) return fail(res, 400, "invalid_argument", "Zadaj meno");
      uid = addUser({ name, role: "admin", pin: b.pin }).id;
    }
    return send(res, 200, { ok: true }, startSession(uid));
  }
  if (p === "/api/auth/login" && m === "POST") {
    const b = await readJson(req);
    if (ipBlocked(ip)) return fail(res, 429, "rate_limited", "Priveľa pokusov – skús o 15 minút");
    const u = Q.userById.get(String(b.userId || ""));
    if (!u || !u.active) { ipFail(ip); return fail(res, 401, "bad_login", "Nesprávne meno alebo PIN"); }
    if (u.locked_until > now()) return fail(res, 429, "locked", `Priveľa nesprávnych pokusov – skús znova o ${Math.ceil((u.locked_until - now()) / 60e3)} min`);
    const ok = crypto.timingSafeEqual(Buffer.from(hashPin(String(b.pin || ""), u.salt), "hex"), Buffer.from(u.pin, "hex"));
    if (!ok) {
      ipFail(ip);
      const fails = u.fails + 1;
      db.prepare("UPDATE users SET fails=?, locked_until=? WHERE id=?").run(fails >= 5 ? 0 : fails, fails >= 5 ? now() + 5 * 60e3 : 0, u.id);
      return fail(res, 401, "bad_login", fails >= 5 ? "Priveľa nesprávnych pokusov – účet je na 5 minút zamknutý" : "Nesprávny PIN");
    }
    db.prepare("UPDATE users SET fails=0, locked_until=0, last_login=? WHERE id=?").run(now(), u.id);
    const token = rid(40);
    Q.addSession.run(token, u.id, now(), now() + SESSION_DAYS * 864e5);
    return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, token, SESSION_DAYS * 86400) });
  }
  if (p === "/api/auth/logout" && m === "POST") {
    const t = cookies(req)[COOKIE]; if (t) Q.delSession.run(t);
    return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
  }

  /* ---- všetko ostatné vyžaduje prihlásenie ---- */
  if (p.startsWith("/api/") || p.startsWith("/_blob/")) {
    const user = currentUser(req);
    if (!user) return fail(res, 401, "unauthenticated", "Prihlás sa");

    if (p === "/api/me" && m === "GET") return send(res, 200, publicUser(user));
    if (p === "/api/users" && m === "GET") {
      const all = Q.users.all();
      return send(res, 200, all.map(u => user.role === "admin" ? { ...publicUser(u), lastLogin: u.last_login, created: u.created } : publicUser(u)));
    }

    /* ---- správa tímu (admin) ---- */
    if (p === "/api/users" && m === "POST") {
      if (user.role !== "admin") return fail(res, 403, "permission_denied");
      const b = await readJson(req);
      const name = cleanName(b.name), role = b.role === "admin" ? "admin" : "worker";
      if (!name || !validPin(b.pin)) return fail(res, 400, "invalid_argument", "Zadaj meno a PIN (4–8 číslic)");
      return send(res, 200, publicUser(addUser({ name, role, pin: b.pin })));
    }
    let mu = p.match(/^\/api\/users\/([A-Za-z0-9_.:@-]{1,80})$/);
    if (mu && (m === "PATCH" || m === "DELETE")) {
      const target = Q.userById.get(mu[1]);
      if (!target) return fail(res, 404, "not_found");
      const b = m === "PATCH" ? await readJson(req) : {};
      const self = target.id === user.id;
      if (user.role !== "admin" && !(self && m === "PATCH" && Object.keys(b).every(k => k === "pin" || k === "oldPin"))) return fail(res, 403, "permission_denied");
      if (m === "DELETE" || b.active === false || (b.role && b.role !== "admin")) {
        if (target.role === "admin" && target.active && Q.countAdmins.get().n <= 1) return fail(res, 400, "last_admin", "Musí ostať aspoň jeden admin");
      }
      if (m === "DELETE") {
        db.prepare("UPDATE users SET active=0 WHERE id=?").run(target.id); // zachováme meno pri starých záznamoch
        Q.delUserSessions.run(target.id); kickUser(target.id);
        return send(res, 200, { ok: true });
      }
      if (self && user.role !== "admin") {
        const ok = hashPin(String(b.oldPin || ""), target.salt) === target.pin;
        if (!ok) return fail(res, 400, "bad_login", "Pôvodný PIN nesedí");
      }
      if (b.name !== undefined) { const n = cleanName(b.name); if (!n) return fail(res, 400, "invalid_argument", "Meno nesmie byť prázdne"); db.prepare("UPDATE users SET name=? WHERE id=?").run(n, target.id); }
      if (b.role !== undefined) db.prepare("UPDATE users SET role=? WHERE id=?").run(b.role === "admin" ? "admin" : "worker", target.id);
      if (b.active !== undefined) { db.prepare("UPDATE users SET active=? WHERE id=?").run(b.active ? 1 : 0, target.id); if (!b.active) { Q.delUserSessions.run(target.id); kickUser(target.id); } }
      if (b.pin !== undefined) {
        if (!validPin(b.pin)) return fail(res, 400, "invalid_argument", "PIN musí mať 4–8 číslic");
        setPin(target.id, b.pin);
        if (!self) { Q.delUserSessions.run(target.id); kickUser(target.id); }
      }
      if (b.role !== undefined && !self) { Q.delUserSessions.run(target.id); kickUser(target.id); }
      return send(res, 200, publicUser(Q.userById.get(target.id)));
    }

    /* ---- záloha / obnova (admin) ---- */
    if (p === "/api/admin/export" && m === "GET") {
      if (user.role !== "admin") return fail(res, 403, "permission_denied");
      const withBlobs = url.searchParams.get("photos") === "1";
      const day = new Date().toISOString().slice(0, 10);
      return send(res, 200, exportData({ blobs: withBlobs }), { "Content-Disposition": `attachment; filename="stribog-zaloha-${day}${withBlobs ? "-s-fotkami" : ""}.json"` });
    }
    if (p === "/api/admin/import" && m === "POST") {
      if (user.role !== "admin") return fail(res, 403, "permission_denied");
      const b = await readJson(req, MAX_IMPORT);
      const r = importData(b, { replace: !!b.replace });
      for (const c of clients) c.res.write(`data: ${JSON.stringify({ reload: true })}\n\n`);
      return send(res, 200, { ok: true, count: r.docs, ...r });
    }

    /* ---- verejný odkaz pre klienta (admin) ---- */
    if (p === "/api/public" && m === "GET") {
      if (user.role !== "admin") return fail(res, 403, "permission_denied");
      const pg = Q.pubByProject.get(String(url.searchParams.get("projectId") || ""));
      return send(res, 200, pg ? { url: "/k/" + pg.token, updated: pg.updated } : { url: null });
    }
    if (p === "/api/public" && (m === "POST" || m === "DELETE")) {
      if (user.role !== "admin") return fail(res, 403, "permission_denied");
      const b = await readJson(req);
      const pid = String(b.projectId || "");
      if (!pid || pid.length > 150) return fail(res, 400, "invalid_argument");
      if (m === "DELETE") { db.prepare("DELETE FROM pubpages WHERE project_id=?").run(pid); return send(res, 200, { ok: true }); }
      if (typeof b.html !== "string" || !b.html) return fail(res, 400, "invalid_argument");
      const cur = Q.pubByProject.get(pid);
      const token = cur ? cur.token : rid(24);
      Q.putPub.run(pid, token, b.html, now(), user.id);
      return send(res, 200, { url: "/k/" + token, updated: now() });
    }

    /* ---- realtime ---- */
    if (p === "/api/events" && m === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.write("retry: 3000\n\n");
      const c = { res, user }; clients.add(c);
      req.on("close", () => clients.delete(c));
      return;
    }

    /* ---- databáza ---- */
    if (p === "/api/doc") {
      const dp = url.searchParams.get("path");
      if (!validPath(dp, true)) return fail(res, 400, "invalid_argument", "Neplatná cesta");
      const op = m === "GET" ? "read" : "write";
      if (!allowed(dp, user, op)) return fail(res, 403, "permission_denied", "Na toto nemáš oprávnenie");
      if (m === "GET") { const d = getDoc(dp); return send(res, 200, { exists: !!d, data: d }); }
      if (m === "PUT") { const b = await readJson(req); if (!b || typeof b.data !== "object" || Array.isArray(b.data)) return fail(res, 400, "invalid_argument"); writeDoc(dp, b.merge ? deepMerge(getDoc(dp), b.data) : b.data); return send(res, 200, { ok: true }); }
      if (m === "PATCH") { const b = await readJson(req); const cur = getDoc(dp); if (!cur) return fail(res, 404, "not_found", "Dokument neexistuje"); writeDoc(dp, deepMerge(cur, b.data)); return send(res, 200, { ok: true }); }
      if (m === "DELETE") { deleteDoc(dp); return send(res, 200, { ok: true }); }
    }
    if (p === "/api/query" && m === "POST") {
      const b = await readJson(req);
      const col = String(b.path || "");
      if (!validPath(col, false)) return fail(res, 400, "invalid_argument", "Neplatná cesta");
      if (!allowed(col, user, "read")) return fail(res, 403, "permission_denied", "Na toto nemáš oprávnenie");
      // členovia tímu vidia len dokumenty, ktoré smú čítať (napr. vlastnú dochádzku)
      const rows = listCollection(col, b).filter(r => allowed(col + "/" + r.id, user, "read"));
      return send(res, 200, { docs: rows });
    }
    if (p === "/api/add" && m === "POST") {
      const b = await readJson(req);
      const col = String(b.path || "");
      if (!validPath(col, false) || typeof b.data !== "object") return fail(res, 400, "invalid_argument");
      const id = rid(20), dp = col + "/" + id;
      if (!allowed(dp, user, "write")) return fail(res, 403, "permission_denied", "Na toto nemáš oprávnenie");
      writeDoc(dp, b.data);
      return send(res, 200, { id, path: dp });
    }

    /* ---- fotky ---- */
    if (p === "/api/assets" && m === "POST") {
      const type = String(req.headers["content-type"] || "").split(";")[0].trim();
      if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(type)) return fail(res, 400, "invalid_argument", "Podporované sú len obrázky");
      const buf = await readBody(req, MAX_BLOB);
      if (!buf.length) return fail(res, 400, "invalid_argument");
      const id = crypto.randomBytes(16).toString("hex");
      saveBlob(id, type, buf, user.id);
      return send(res, 200, { id, url: "/_blob/" + id, sizeBytes: buf.length, contentType: type });
    }
    const mb = p.match(/^\/_blob\/([A-Za-z0-9_-]{8,64})$/);
    if (mb && m === "GET") {
      const meta = Q.getBlob.get(mb[1]);
      const f = path.join(BLOB_DIR, mb[1]);
      if (!meta || !fs.existsSync(f)) return fail(res, 404, "not_found");
      return send(res, 200, fs.readFileSync(f), { "Content-Type": meta.type, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
    }

    /* ---- AI ---- */
    if (p === "/api/sample" && m === "POST") {
      if (user.role !== "admin") return fail(res, 403, "permission_denied");
      if (!AI_KEY) return fail(res, 501, "images_unavailable", "Čítanie fotiek nie je zapnuté (chýba ANTHROPIC_API_KEY)");
      const b = await readJson(req, MAX_AI);
      const ctl = new AbortController(); req.on("close", () => { if (!res.writableEnded) ctl.abort(); });
      const out = await aiSample(b, ctl.signal);
      return send(res, 200, { data: out });
    }
    return fail(res, 404, "not_found");
  }

  if (m === "GET" && serveStatic(res, p.slice(1))) return;
  if (m === "GET" && !p.includes(".")) return serveIndex(res);
  return fail(res, 404, "not_found");
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    const st = err.status || 500;
    if (st >= 500) console.error(err);
    if (!res.headersSent) fail(res, st, err.message === "too_large" ? "quota_exceeded" : st === 400 ? "invalid_argument" : err.message || "error", err.message);
    else try { res.end(); } catch {}
  });
});
server.requestTimeout = 0; // SSE a dlhé AI požiadavky
server.headersTimeout = 60000;
server.listen(PORT, () => console.log(`Stribog beží na http://localhost:${PORT}  (dáta: ${DATA_DIR}${AI_KEY ? ", AI zapnuté" : ""})`));
const stop = () => { server.close(); try { db.close(); } catch {} process.exit(0); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
