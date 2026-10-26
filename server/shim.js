/* Stribog – klient pre vlastný server.
   Poskytuje rovnaké rozhranie ako runtime claude.ai (window.claude.use: db, user, assets, downloads, sample)
   a navyše "team" (správa ľudí a PIN-ov). Pred spustením aplikácie zobrazí prihlásenie menom + PIN-om. */
(() => {
  "use strict";
  const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const parentOf = p => p.split("/").slice(0, -1).join("/");
  const err = (code, message) => Object.assign(new Error(message || code), { code });

  async function api(method, url, body, raw) {
    let r;
    try {
      r = await fetch(url, {
        method, credentials: "same-origin",
        headers: raw ? { "Content-Type": raw } : body !== undefined ? { "Content-Type": "application/json" } : {},
        body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw err("unavailable", "Server nie je dostupný – skontroluj pripojenie"); }
    let j = null; try { j = await r.json(); } catch {}
    if (r.status === 401 && !url.startsWith("/api/auth/")) { showLogin(true); throw err("unauthenticated"); }
    if (!r.ok) throw err((j && j.error && j.error.code) || "error", j && j.error && j.error.message);
    return j;
  }

  /* ---------------- avatars ---------------- */
  const initials = n => (String(n || "?").trim().split(/\s+/).map(x => x[0]).slice(0, 2).join("") || "?").toUpperCase();
  const avatar = (name, color) => "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="${color || "#2BB3B1"}"/><text x="20" y="25.5" font-family="system-ui,sans-serif" font-size="15" font-weight="600" fill="#fff" text-anchor="middle">${initials(name).replace(/[<&>"]/g, "")}</text></svg>`);

  /* ---------------- realtime ---------------- */
  const listeners = new Set();
  let es = null;
  function startEvents() {
    if (es) return;
    es = new EventSource("/api/events");
    let first = true;
    es.onopen = () => { if (!first) listeners.forEach(l => l.refresh()); first = false; };
    es.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.reload) { listeners.forEach(l => l.refresh()); return; }
      listeners.forEach(l => { if (l.kind === "doc" ? l.path === m.path : parentOf(m.path) === l.path) l.refresh(); });
    };
  }
  function listen(kind, path, fetcher, next, error) {
    let busy = false, again = false, stopped = false;
    const l = {
      kind, path,
      refresh: async () => {
        if (stopped) return;
        if (busy) { again = true; return; }
        busy = true;
        try { const s = await fetcher(); if (!stopped) next(s); }
        catch (e) { if (!stopped && error && e.code !== "unauthenticated") error(e); }
        busy = false;
        if (again) { again = false; l.refresh(); }
      },
    };
    listeners.add(l); startEvents(); l.refresh();
    return () => { stopped = true; listeners.delete(l); };
  }

  /* ---------------- db ---------------- */
  const meta = { fromCache: false, hasPendingWrites: false };
  function docSnap(path, res) {
    const d = res.exists ? res.data : null;
    return { id: path.split("/").pop(), ref: docRef(path), exists: !!res.exists, data: () => clone(d) || undefined, get: f => (d ? d[f] : undefined), metadata: meta };
  }
  function docRef(path) {
    const q = "/api/doc?path=" + encodeURIComponent(path);
    const ref = {
      id: path.split("/").pop(), path,
      get: async () => docSnap(path, await api("GET", q)),
      set: async (data, opts) => { await api("PUT", q, { data: clone(data), merge: !!(opts && opts.merge) }); },
      update: async data => { await api("PATCH", q, { data: clone(data) }); },
      delete: async () => { await api("DELETE", q); },
      onSnapshot: (next, error) => listen("doc", path, ref.get, typeof next === "function" ? next : next.next, typeof next === "function" ? error : next.error),
      collection: c => colRef(path + "/" + c),
    };
    return ref;
  }
  function colRef(path, spec = { where: [], orderBy: [], limit: 0 }) {
    const get = async () => {
      const r = await api("POST", "/api/query", { path, ...spec });
      const docs = r.docs.map(d => docSnap(path + "/" + d.id, { exists: true, data: d.data }));
      return { docs, size: docs.length, empty: !docs.length, forEach: f => docs.forEach(f), docChanges: () => [], metadata: meta };
    };
    const q = {
      id: path.split("/").pop(), path,
      where: (f, op, v) => colRef(path, { ...spec, where: spec.where.concat([[f, op, v]]) }),
      orderBy: (f, dir = "asc") => colRef(path, { ...spec, orderBy: spec.orderBy.concat([[f, dir]]) }),
      limit: n => colRef(path, { ...spec, limit: n }),
      get,
      onSnapshot: (next, error) => listen("col", path, get, typeof next === "function" ? next : next.next, typeof next === "function" ? error : next.error),
      doc: id => docRef(path + "/" + (id || Math.random().toString(36).slice(2, 12) + Date.now().toString(36))),
      add: async data => { const r = await api("POST", "/api/add", { path, data: clone(data) }); return docRef(r.path); },
    };
    return q;
  }
  const dbCap = { doc: docRef, collection: p => colRef(p) };

  /* ---------------- user ---------------- */
  let me = null, people = {};
  async function loadPeople() {
    const list = await api("GET", "/api/users");
    people = {}; list.forEach(u => (people[u.id] = u));
    return list;
  }
  const profile = u => ({ id: u.id, name: u.name + (u.active === false ? " (neaktívny)" : ""), avatarUrl: avatar(u.name, u.color), color: u.color, email: null, isMe: !!me && u.id === me.id, guest: false });
  const userCap = {
    me: async () => ({ id: me.id, name: me.name, avatarUrl: avatar(me.name, me.color), color: me.color, email: null, isOwner: me.role === "admin", canEdit: me.role === "admin", guest: false }),
    id: async () => me.id,
    canEdit: async () => me.role === "admin",
    isOwner: async () => me.role === "admin",
    can: async () => true,
    profiles: async ids => {
      ids = [].concat(ids || []);
      if (ids.some(i => !people[i])) { try { await loadPeople(); } catch {} }
      const o = {}; ids.forEach(i => (o[i] = people[i] ? profile(people[i]) : { id: i, name: "", avatarUrl: avatar("?", "#999"), color: "#999", email: null, isMe: false, guest: false })); return o;
    },
    search: async q => {
      const list = await loadPeople();
      q = String(q || "").toLowerCase();
      return list.filter(u => u.active && (!q || u.name.toLowerCase().includes(q))).map(profile);
    },
  };

  /* ---------------- assets / downloads / sample ---------------- */
  const assetsCap = {
    upload: async (blob, opts) => {
      if (blob && blob.size > 15 * 1024 * 1024) throw err("quota_exceeded", "Súbor je príliš veľký");
      return api("POST", "/api/assets", blob, (opts && opts.type) || blob.type || "image/jpeg");
    },
  };
  const MIME = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv;charset=utf-8", html: "text/html;charset=utf-8", json: "application/json", pdf: "application/pdf", txt: "text/plain;charset=utf-8" };
  const downloadsCap = {
    save: async ({ filename, data, mimeType }) => {
      const ext = String(filename || "").split(".").pop().toLowerCase();
      const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType || MIME[ext] || "application/octet-stream" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = filename || "subor";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      return { saved: true };
    },
  };
  const b64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
  let aiOn = false;
  const sampleCap = {
    limits: async () => ({ images: aiOn ? { maxCount: 20 } : null }),
    json: async (prompt, opts = {}) => {
      const images = [];
      for (const f of opts.images || []) images.push({ type: f.type || "image/jpeg", data: await b64(f) });
      try {
        const r = await fetch("/api/sample", { method: "POST", credentials: "same-origin", signal: opts.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, images }) });
        let j = null; try { j = await r.json(); } catch {}
        if (!r.ok) throw err((j && j.error && j.error.code) || "error");
        return j.data;
      } catch (e) { if (e && e.name === "AbortError") throw err("cancelled"); throw e; }
    },
  };

  /* ---------------- team (vlastná schopnosť tohto servera) ---------------- */
  const teamCap = {
    list: () => api("GET", "/api/users"),
    add: u => api("POST", "/api/users", u),
    update: (id, patch) => api("PATCH", "/api/users/" + encodeURIComponent(id), patch),
    remove: id => api("DELETE", "/api/users/" + encodeURIComponent(id)),
    exportUrl: "/api/admin/export",
    publicLink: pid => api("GET", "/api/public?projectId=" + encodeURIComponent(pid)),
    publish: (pid, html) => api("POST", "/api/public", { projectId: pid, html }),
    importData: (data, replace) => api("POST", "/api/admin/import", { docs: data.docs || data, replace: !!replace }),
    logout: async () => { await api("POST", "/api/auth/logout").catch(() => {}); try { localStorage.removeItem("stribog-area"); } catch {} location.reload(); },
    me: () => clone(me),
    origin: location.origin,
  };

  /* ---------------- login overlay ---------------- */
  let readyResolve;
  const ready = new Promise(r => (readyResolve = r));
  const caps = { db: dbCap, user: userCap, assets: assetsCap, downloads: downloadsCap, team: teamCap };
  window.claude = {
    use: async name => {
      await ready;
      if (name === "sample") return me && me.role === "admin" && aiOn ? sampleCap : null;
      if (name in caps) return caps[name];
      return null;
    },
  };

  const CSS = `
  .sl-bg,.sl-bg *{box-sizing:border-box}
  .sl-bg{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:20px;background:var(--bg,#F4F7F6);
    background-image:radial-gradient(900px 500px at 15% -10%,rgba(43,179,177,.22),transparent 60%),radial-gradient(700px 500px at 110% 110%,rgba(14,110,110,.18),transparent 60%);
    font-family:var(--f-ui,"DM Sans",system-ui,sans-serif);color:var(--ink,#13201F);overflow:auto}
  .sl-card{width:min(420px,100%);border-radius:24px;padding:28px 24px 24px;background:var(--glass-strong,rgba(255,255,255,.82));border:1px solid var(--glass-brd,rgba(255,255,255,.7));
    box-shadow:0 20px 60px rgba(14,60,60,.18);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px)}
  .sl-brand{display:flex;align-items:center;gap:10px;margin-bottom:18px}
  .sl-brand svg{width:34px;height:34px;color:var(--accent,#0E6E6E)}
  .sl-brand b{font-family:var(--f-disp,Poppins,system-ui);font-size:22px;letter-spacing:.02em}
  .sl-brand small{display:block;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted,#5b6b69)}
  .sl-card h2{margin:0 0 4px;font-family:var(--f-disp,Poppins,system-ui);font-size:20px}
  .sl-card p{margin:0 0 16px;color:var(--muted,#5b6b69);font-size:14px;line-height:1.45}
  .sl-people{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;max-height:52vh;overflow:auto}
  .sl-p{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;border:1px solid var(--line,#dfe7e5);background:var(--card,#fff);cursor:pointer;font:inherit;color:inherit;text-align:left}
  .sl-p:hover,.sl-p:focus-visible{border-color:var(--gold,#2BB3B1);outline:none;box-shadow:0 0 0 3px rgba(43,179,177,.18)}
  .sl-p img{width:34px;height:34px;border-radius:50%;flex:none}
  .sl-p span{font-weight:600;font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sl-who{display:flex;align-items:center;gap:12px;margin-bottom:16px}
  .sl-who img{width:48px;height:48px;border-radius:50%}
  .sl-who b{font-size:17px}
  .sl-f{display:flex;flex-direction:column;gap:5px;margin-bottom:12px;font-size:12.5px;font-weight:600;color:var(--muted,#5b6b69)}
  .sl-f input{font:inherit;font-size:16px;font-weight:500;color:var(--ink,#13201F);padding:12px 14px;border-radius:12px;border:1px solid var(--line,#d5dfdd);background:var(--card,#fff)}
  .sl-f input.pin{font-family:var(--f-num,"IBM Plex Mono",monospace);font-size:24px;letter-spacing:.5em;text-align:center}
  .sl-f input:focus{outline:none;border-color:var(--gold,#2BB3B1);box-shadow:0 0 0 3px rgba(43,179,177,.2)}
  .sl-err{min-height:20px;color:#B42318;font-size:13.5px;font-weight:600;margin:2px 0 10px}
  .sl-a{display:flex;gap:8px}
  .sl-btn{flex:1;font:inherit;font-weight:700;font-size:15px;padding:12px 16px;border-radius:12px;border:1px solid var(--line,#d5dfdd);background:var(--card,#fff);color:inherit;cursor:pointer}
  .sl-btn.pr{background:var(--accent,#0E6E6E);border-color:var(--accent,#0E6E6E);color:#fff}
  .sl-btn:disabled{opacity:.55;cursor:default}
  @media (prefers-color-scheme:dark){.sl-bg{background-color:var(--bg,#0d1716)}}`;
  const LOGO = `<svg aria-hidden="true"><use href="#head"/></svg>`;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let overlay = null, afterLogin = null;
  function mount() {
    if (overlay) return overlay;
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    overlay = document.createElement("div"); overlay.className = "sl-bg"; overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true");
    document.body.appendChild(overlay);
    return overlay;
  }
  const card = inner => `<div class="sl-card"><div class="sl-brand">${LOGO}<div><b>stribog</b><small>vzduchotechnika · rekuperácia · klíma</small></div></div>${inner}</div>`;

  async function showLogin(reloadAfter) {
    if (reloadAfter) afterLogin = () => location.reload();
    if (!document.body) await new Promise(r => document.addEventListener("DOMContentLoaded", r, { once: true }));
    let st;
    try { st = await api("GET", "/api/auth/state"); }
    catch (e) { mount().innerHTML = card(`<h2>Server nie je dostupný</h2><p>${esc(e.message)}</p><div class="sl-a"><button class="sl-btn pr" onclick="location.reload()">Skúsiť znova</button></div>`); return; }
    if (st.setup) return renderSetup(st);
    renderPeople(st.people);
  }
  function renderSetup(st) {
    const o = mount();
    if (st && st.imported && st.imported.length) return renderClaim(st.imported);
    o.innerHTML = card(`<h2>Vitaj v Stribogu</h2><p>Aplikácia je zatiaľ prázdna. Ako chceš začať?</p>
      <div class="sl-a" style="flex-direction:column"><button class="sl-btn pr" id="sl-new">Začať odznova – vytvoriť admin účet</button>
      <label class="sl-btn" style="text-align:center">Preniesť dáta zo zálohy / z claude.ai<input type="file" accept=".json,application/json" id="sl-file" hidden></label></div>
      <div class="sl-err" id="sl-err" style="margin-top:12px"></div>`);
    o.querySelector("#sl-new").onclick = renderNewAdmin;
    o.querySelector("#sl-file").onchange = async e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const er = o.querySelector("#sl-err");
      er.style.color = "var(--muted,#5b6b69)"; er.textContent = "Nahrávam a obnovujem dáta… (pri veľa fotkách to môže trvať minútu)";
      try {
        let data; try { data = JSON.parse(await f.text()); } catch { throw new Error("Súbor nie je záloha Stribogu"); }
        if (!data || typeof data.docs !== "object") throw new Error("Súbor nie je záloha Stribogu");
        const r = await api("POST", "/api/auth/setup-import", data);
        const st2 = await api("GET", "/api/auth/state");
        if (st2.imported && st2.imported.length) renderClaim(st2.imported, r);
        else renderNewAdmin(r);
      } catch (x) { er.style.color = ""; er.textContent = x.message; }
    };
  }
  function renderClaim(list, r) {
    const o = mount();
    o.innerHTML = card(`<h2>Kto z nich si ty?</h2><p>${r ? `Prenesené: ${r.docs} záznamov a ${r.blobs} fotiek. ` : ""}Vyber sa – staneš sa adminom a nastavíš si PIN. Ostatným nastavíš PIN v sekcii <b>Prístupy</b>.</p>
      <div class="sl-people">${list.map(p => `<button class="sl-p" data-uid="${esc(p.id)}"><img alt="" src="${avatar(p.name, p.color)}"><span>${esc(p.name)}</span></button>`).join("")}</div>
      <div class="sl-a" style="margin-top:12px"><button class="sl-btn" id="sl-none">Nie som v zozname</button></div>`);
    o.querySelectorAll(".sl-p").forEach(b => (b.onclick = () => renderNewAdmin(null, list.find(p => p.id === b.dataset.uid), list)));
    o.querySelector("#sl-none").onclick = () => renderNewAdmin(null, null, list);
  }
  function renderNewAdmin(r, who, list) {
    const o = mount();
    o.innerHTML = card(`${who ? `<div class="sl-who"><img alt="" src="${avatar(who.name, who.color)}"><div><b>${esc(who.name)}</b><p style="margin:0">Nastav si PIN – budeš admin</p></div></div>` : `<h2>Admin účet</h2><p>Ostatných ľudí z tímu potom pridáš v sekcii <b>Prístupy</b>.</p>`}
      <form id="sl-form">${who ? "" : `<label class="sl-f">Meno a priezvisko<input id="sl-name" autocomplete="name" required maxlength="60"></label>`}
      <label class="sl-f">PIN (4–8 číslic)<input id="sl-pin" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="new-password" required></label>
      <label class="sl-f">PIN ešte raz<input id="sl-pin2" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="new-password" required></label>
      <div class="sl-err" id="sl-err"></div><div class="sl-a">${list ? `<button class="sl-btn" type="button" id="sl-back">Späť</button>` : ""}<button class="sl-btn pr" type="submit">Pokračovať</button></div></form>`);
    const first = o.querySelector(who ? "#sl-pin" : "#sl-name"); first.focus();
    const back = o.querySelector("#sl-back"); if (back) back.onclick = () => renderClaim(list);
    o.querySelector("#sl-form").onsubmit = async e => {
      e.preventDefault();
      const pin = o.querySelector("#sl-pin").value, pin2 = o.querySelector("#sl-pin2").value;
      const er = o.querySelector("#sl-err");
      if (!/^\d{4,8}$/.test(pin)) return (er.textContent = "PIN musí mať 4–8 číslic");
      if (pin !== pin2) return (er.textContent = "PIN-y sa nezhodujú");
      const body = who ? { userId: who.id, pin } : { name: o.querySelector("#sl-name").value.trim(), pin };
      try { await api("POST", "/api/auth/setup", body); await finish(); } catch (x) { er.textContent = x.message; }
    };
  }
  function renderPeople(list) {
    const o = mount();
    if (!list.length) { o.innerHTML = card(`<h2>Žiadne aktívne účty</h2><p>Požiadaj admina, aby ťa pridal.</p>`); return; }
    let last = null; try { last = localStorage.getItem("stribog-lastuser"); } catch {}
    const sorted = list.slice().sort((a, b) => (b.id === last) - (a.id === last) || a.name.localeCompare(b.name, "sk"));
    o.innerHTML = card(`<h2>Kto si?</h2><p>Vyber svoje meno a zadaj PIN.</p><div class="sl-people">${sorted.map(p =>
      `<button class="sl-p" data-uid="${esc(p.id)}"><img alt="" src="${avatar(p.name, p.color)}"><span>${esc(p.name)}</span></button>`).join("")}</div>`);
    o.querySelectorAll(".sl-p").forEach(b => (b.onclick = () => renderPin(list.find(p => p.id === b.dataset.uid), list)));
    if (list.length === 1) renderPin(list[0], list);
  }
  function renderPin(p, list) {
    const o = mount();
    o.innerHTML = card(`<div class="sl-who"><img alt="" src="${avatar(p.name, p.color)}"><div><b>${esc(p.name)}</b><p style="margin:0">Zadaj svoj PIN</p></div></div>
      <form id="sl-form"><label class="sl-f">PIN<input id="sl-pin" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="current-password" required></label>
      <div class="sl-err" id="sl-err"></div><div class="sl-a">${list.length > 1 ? `<button class="sl-btn" type="button" id="sl-back">Späť</button>` : ""}<button class="sl-btn pr" type="submit">Prihlásiť sa</button></div></form>`);
    const inp = o.querySelector("#sl-pin"); inp.focus();
    const back = o.querySelector("#sl-back"); if (back) back.onclick = () => renderPeople(list);
    o.querySelector("#sl-form").onsubmit = async e => {
      e.preventDefault();
      const btn = o.querySelector(".sl-btn.pr"); btn.disabled = true;
      try {
        await api("POST", "/api/auth/login", { userId: p.id, pin: inp.value });
        try { localStorage.setItem("stribog-lastuser", p.id); } catch {}
        await finish();
      } catch (x) { o.querySelector("#sl-err").textContent = x.message; inp.value = ""; inp.focus(); btn.disabled = false; }
    };
  }
  async function finish() {
    if (afterLogin) return afterLogin();
    const st = await api("GET", "/api/auth/state");
    if (!st.me) return showLogin();
    me = st.me; aiOn = !!st.ai;
    try { await loadPeople(); } catch {}
    if (overlay) { overlay.remove(); overlay = null; }
    readyResolve();
  }

  (async () => {
    let st = null;
    try { st = await api("GET", "/api/auth/state"); } catch {}
    if (st && st.me) { me = st.me; aiOn = !!st.ai; try { await loadPeople(); } catch {} readyResolve(); }
    else showLogin();
  })();
})();
