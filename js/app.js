import { rankTrails, nextSaturday, formatDay } from "./recommend.js";
// Family features load separately, so the map still works if sign-in can't load.
let FAM = null;
const NO_FAMILY = { user: null, family: null, trips: {}, ready: true };
const getFamilyState = () => (FAM ? FAM.getFamilyState() : NO_FAMILY);
const signIn = () => (FAM ? FAM.signIn() : Promise.reject(new Error("family module unavailable")));
const signOutUser = () => FAM && FAM.signOutUser();
const createFamily = (...a) => FAM.createFamily(...a);
const addMember = (...a) => FAM.addMember(...a);
const removeMember = (...a) => FAM.removeMember(...a);
const setOrigin = (...a) => FAM.setOrigin(...a);
const saveTrip = (...a) => FAM.saveTrip(...a);

/* ---------------- helpers ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = {
  star: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 9.2l7.1-.6z"/></svg>',
  x: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chevron: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
};

const LABEL = {
  stroller: { yes: "כן", partial: "חלקית", no: "לא", unknown: "לא ידוע" },
  route: { loop: "מעגלי", linear: "קווי", out_back: "הלוך-חזור" },
  lodgingType: { rtg: 'חניון רט"ג', khan: "חאן", field_school: "בית ספר שדה" },
};

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function haversineKm(a, b) {
  const R = 6371, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* ---------------- state ---------------- */
const S = {
  catalog: null,
  filters: new Set(),
  query: "",
  layers: new Set(["trails"]),
  selected: null,          // { kind, id }
  recIndex: 0,
  recCollapsed: false,
  view: "map",
  origin: null,            // { name, lat, lng, custom }
};

function family() { return getFamilyState(); }
function trips() { const f = family(); return f.family ? f.trips : null; }

function driveOf(place) {
  if (!S.origin || !S.origin.custom) return place.drive_min ?? null;
  if (place.lat == null) return null;
  const km = haversineKm(S.origin, place) * 1.3;
  return Math.max(5, Math.round((km / 65) * 60 / 5) * 5);
}
function driveText(place) {
  const d = driveOf(place);
  if (d == null) return place.drive_text || "";
  return `${S.origin && S.origin.custom ? "~" : ""}${d} דק'`;
}

/* ---------------- filters ---------------- */
function matches(t) {
  const f = S.filters;
  const month = new Date().getMonth() + 1;
  if (f.has("near")) { const d = driveOf(t); if (d == null || d > 45) return false; }
  if (f.has("short") && !(t.km != null && t.km <= 3)) return false;
  if (f.has("stroller") && t.stroller !== "yes") return false;
  if (f.has("water") && !["view", "wading", "sea"].includes(t.water)) return false;
  if (f.has("shuttle") && !t.shuttle) return false;
  if (f.has("season") && !t.months.includes(month)) return false;
  if (f.has("notdone")) { const tr = trips(); if (tr && tr[t.id] && tr[t.id].done) return false; }
  if (S.query) {
    const hay = `${t.name} ${t.region} ${t.poi || ""}`.toLowerCase();
    if (!hay.includes(S.query)) return false;
  }
  return true;
}
function matchesText(p) {
  if (!S.query) return true;
  return `${p.name} ${p.region || ""} ${p.place || ""}`.toLowerCase().includes(S.query);
}

/* ---------------- map ---------------- */
let map, markerLayer;
const markers = new Map();

function initMap() {
  map = L.map("map", { zoomControl: false, attributionControl: true }).setView([32.25, 34.95], 9);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  L.control.zoom({ position: "topleft" }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  map.on("click", () => { if (S.selected) { S.selected = null; renderDock(); renderMarkers(); } });

  const ctl = L.control({ position: "topleft" });
  ctl.onAdd = () => {
    const el = L.DomUtil.create("div", "layers");
    el.innerHTML = `
      <button type="button" class="layer" data-layer="lodging" aria-pressed="false">לינה</button>
      <button type="button" class="layer" data-layer="activities" aria-pressed="false">פעילויות</button>`;
    L.DomEvent.disableClickPropagation(el);
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-layer]");
      if (!b) return;
      const k = b.dataset.layer;
      S.layers.has(k) ? S.layers.delete(k) : S.layers.add(k);
      b.setAttribute("aria-pressed", S.layers.has(k));
      renderMarkers();
    });
    return el;
  };
  ctl.addTo(map);
}

function pinIcon(cls, html = "", size = 20) {
  return L.divIcon({ className: "", html: `<div class="${cls}">${html}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

function renderMarkers() {
  if (!map) return;
  markerLayer.clearLayers();
  markers.clear();
  const cat = S.catalog;
  const rec = currentRec();

  if (S.origin) {
    L.marker([S.origin.lat, S.origin.lng], { icon: pinIcon("pin pin--home", "", 16), keyboard: false, interactive: false })
      .bindTooltip(S.origin.name, { permanent: false, direction: "top" }).addTo(markerLayer);
  }

  let shown = 0;
  for (const t of cat.trails) {
    const ok = matches(t);
    if (ok) shown++;
    const isRec = rec && rec.trail.id === t.id && !S.filters.size && !S.query;
    const sel = S.selected && S.selected.kind === "trail" && S.selected.id === t.id;
    const cls = `pin ${isRec ? "pin--rec" : ""} ${ok ? "" : "pin--muted"} ${sel ? "pin--selected" : ""}`;
    const m = L.marker([t.lat, t.lng], {
      icon: isRec ? pinIcon(cls, icon.star, 38) : pinIcon(cls),
      title: t.name, alt: t.name, riseOnHover: true, zIndexOffset: isRec ? 1000 : ok ? 100 : 0,
    });
    m.bindTooltip(esc(t.name), { direction: "top", offset: [0, isRec ? -18 : -10] });
    m.on("click", (e) => { L.DomEvent.stopPropagation(e); select("trail", t.id); });
    m.addTo(markerLayer);
    markers.set(`trail:${t.id}`, m);
  }
  if (S.layers.has("lodging")) {
    for (const p of cat.lodging) {
      if (!matchesText(p) || p.lat == null) continue;
      const sel = S.selected && S.selected.kind === "lodging" && S.selected.id === p.id;
      const m = L.marker([p.lat, p.lng], { icon: pinIcon(`pin pin--lodging ${sel ? "pin--selected" : ""}`), title: p.name, alt: p.name });
      m.bindTooltip(esc(p.name), { direction: "top", offset: [0, -10] });
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); select("lodging", p.id); });
      m.addTo(markerLayer);
    }
  }
  if (S.layers.has("activities")) {
    for (const a of cat.activities) {
      if (!matchesText(a) || a.lat == null) continue;
      const m = L.marker([a.lat, a.lng], { icon: pinIcon("pin pin--activity", "", 16), title: a.name, alt: a.name });
      m.bindTooltip(esc(a.name), { direction: "top", offset: [0, -10] });
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); select("activity", a.id); });
      m.addTo(markerLayer);
    }
  }
  const active = S.filters.size || S.query;
  $("#resultCount").textContent = active ? `${shown} מסלולים מתאימים` : "";
}

function select(kind, id) {
  S.selected = { kind, id };
  renderDock();
  renderMarkers();
}

function dockPadding() {
  const dock = $("#dock");
  const desktop = window.matchMedia("(min-width: 900px)").matches;
  const h = dock && dock.firstElementChild ? dock.firstElementChild.getBoundingClientRect().height + 24 : 24;
  return desktop
    ? { paddingTopLeft: [40, 40], paddingBottomRight: [440, 40] }
    : { paddingTopLeft: [60, 60], paddingBottomRight: [30, h] };
}
function fitAll() {
  if (!map) return;
  const pts = S.catalog.trails.map((t) => [t.lat, t.lng]);
  if (S.origin) pts.push([S.origin.lat, S.origin.lng]);
  map.fitBounds(L.latLngBounds(pts), { ...dockPadding(), maxZoom: 11 });
}
function focusOn(place) {
  if (!map || place.lat == null) return;
  const zoom = Math.max(map.getZoom(), 12);
  const pad = dockPadding();
  const target = map.project([place.lat, place.lng], zoom);
  // shift so the pin sits in the middle of the area the dock leaves visible
  const dx = (pad.paddingBottomRight[0] - pad.paddingTopLeft[0]) / 2;
  const dy = (pad.paddingBottomRight[1] - pad.paddingTopLeft[1]) / 2;
  map.flyTo(map.unproject(target.add([dx, dy]), zoom), zoom, { duration: 0.6 });
}

/* ---------------- recommendation ---------------- */
let ranked = [];
function computeRec() {
  const date = nextSaturday();
  ranked = rankTrails(S.catalog.trails, { date, driveOf, trips: trips() }).filter((r) => r.trail.months.includes(date.getMonth() + 1));
  if (!ranked.length) ranked = rankTrails(S.catalog.trails, { date, driveOf, trips: trips() });
  if (S.recIndex >= ranked.length) S.recIndex = 0;
}
function currentRec() { return ranked[S.recIndex] || null; }

/* ---------------- dock ---------------- */
function renderDock() {
  const dock = $("#dock");
  if (S.selected) { dock.innerHTML = peekHTML(); bindPeek(dock); return; }
  const r = currentRec();
  if (!r) { dock.innerHTML = ""; return; }
  const t = r.trail;
  const date = nextSaturday();
  dock.innerHTML = `
    <article class="rec ${S.recCollapsed ? "is-collapsed" : ""}" aria-labelledby="recTitle">
      <div class="rec__top">
        <div class="rec__label">${icon.star} המלצת השבוע</div>
        <div class="row" style="width:auto;align-items:center;gap:8px">
          <span class="rec__date">${formatDay(date)}</span>
          <button type="button" class="rec__collapse" data-act="collapse" aria-label="${S.recCollapsed ? "הרחב" : "כווץ"}" aria-expanded="${!S.recCollapsed}"
            style="transform:rotate(${S.recCollapsed ? 180 : 0}deg)">${icon.chevron}</button>
        </div>
      </div>
      <div class="rec__head">${thumbHTML(t, "rec__thumb")}<h2 class="rec__title" id="recTitle">${esc(t.name)}</h2></div>
      <div class="rec__body" style="display:${S.recCollapsed ? "none" : "flex"};flex-direction:column;gap:10px">
        <div>
          <div class="rec__why-label">למה דווקא עכשיו</div>
          <div class="rec__reasons" style="margin-top:6px">${r.reasons.map((x) => `<span class="rec__reason">${esc(x)}</span>`).join("")}</div>
        </div>
        <div class="rec__facts">
          ${t.km != null ? `<span>${t.km} ק"מ</span>` : ""}
          <span>${esc(t.walk_text)}</span>
          <span>${esc(LABEL.route[t.route] || "")}</span>
          ${t.stroller === "yes" ? "<span>נגיש לעגלה</span>" : ""}
        </div>
        <div class="rec__actions">
          <button type="button" class="btn btn--dark btn--grow" data-act="open">לכרטיס המלא</button>
          <button type="button" class="btn btn--ghost" data-act="next">הצעה אחרת</button>
        </div>
      </div>
    </article>`;
  dock.querySelector('[data-act="open"]')?.addEventListener("click", () => openTrail(t.id));
  dock.querySelector('[data-act="next"]')?.addEventListener("click", () => {
    S.recIndex = (S.recIndex + 1) % ranked.length;
    renderDock(); renderMarkers(); focusOn(currentRec().trail);
  });
  dock.querySelector('[data-act="collapse"]').addEventListener("click", () => { S.recCollapsed = !S.recCollapsed; renderDock(); });
}

function peekHTML() {
  const { kind, id } = S.selected;
  const cat = S.catalog;
  if (kind === "trail") {
    const t = cat.trails.find((x) => x.id === id);
    const done = trips() && trips()[t.id] && trips()[t.id].done;
    return `
      <article class="peek" aria-labelledby="peekTitle">
        <div class="peek__head">
          ${thumbHTML(t, "peek__thumb")}
          <div class="peek__text">
            <div class="peek__kind">מסלול · ${esc(t.region)}</div>
            <h2 class="peek__title" id="peekTitle">${esc(t.name)}</h2>
            <div class="peek__meta">${esc(driveText(t))} נסיעה · ${t.km != null ? `${t.km} ק"מ · ` : ""}${esc(LABEL.route[t.route] || "")}</div>
          </div>
          <button type="button" class="peek__close" data-act="close" aria-label="סגור">${icon.x}</button>
        </div>
        <div class="tags">
          ${t.stroller === "yes" ? '<span class="tag">נגיש לעגלה</span>' : ""}
          ${t.shuttle ? '<span class="tag">מתאים להקפצה</span>' : ""}
          ${t.water === "wading" ? '<span class="tag">שכשוך</span>' : ""}
          ${done ? '<span class="tag tag--done">עשינו ✓</span>' : ""}
        </div>
        <button type="button" class="btn btn--primary" data-act="open">פתח כרטיס</button>
      </article>`;
  }
  if (kind === "lodging") {
    const p = cat.lodging.find((x) => x.id === id);
    return `
      <article class="peek" aria-labelledby="peekTitle">
        <div class="peek__head">
          ${thumbHTML(p, "peek__thumb")}
          <div class="peek__text">
            <div class="peek__kind">${esc(LABEL.lodgingType[p.type] || p.kind_text)} · ${esc(p.region)}</div>
            <h2 class="peek__title" id="peekTitle">${esc(p.name)}</h2>
            <div class="peek__meta">${esc(p.drive_text)} · ${esc(p.price_text)}</div>
          </div>
          <button type="button" class="peek__close" data-act="close" aria-label="סגור">${icon.x}</button>
        </div>
        <button type="button" class="btn btn--primary" data-act="open">פרטים</button>
      </article>`;
  }
  const a = cat.activities.find((x) => x.id === id);
  return `
    <article class="peek" aria-labelledby="peekTitle">
      <div class="peek__head">
        ${thumbHTML(a, "peek__thumb")}
        <div class="peek__text">
          <div class="peek__kind">פעילות · ${esc(a.operator)}</div>
          <h2 class="peek__title" id="peekTitle">${esc(a.name)}</h2>
          <div class="peek__meta">${esc(a.when_text)}</div>
        </div>
        <button type="button" class="peek__close" data-act="close" aria-label="סגור">${icon.x}</button>
      </div>
      <button type="button" class="btn btn--primary" data-act="open">פרטים</button>
    </article>`;
}
function bindPeek(dock) {
  dock.querySelector('[data-act="close"]').addEventListener("click", () => { S.selected = null; renderDock(); renderMarkers(); });
  dock.querySelector('[data-act="open"]').addEventListener("click", () => {
    const { kind, id } = S.selected;
    if (kind === "trail") openTrail(id);
    else if (kind === "lodging") openLodging(id);
    else openActivity(id);
  });
}

/* ---------------- sheet ---------------- */
let lastFocus = null;
function openSheet(html, onBind) {
  lastFocus = document.activeElement;
  const sheet = $("#sheet");
  $("#sheetPanel").innerHTML = html;
  sheet.hidden = false;
  onBind && onBind($("#sheetPanel"));
  $("#sheetPanel").scrollTop = 0;
  const first = $("#sheetPanel [data-close], #sheetPanel button");
  first && first.focus();
}
function closeSheet() {
  $("#sheet").hidden = true;
  $("#sheetPanel").innerHTML = "";
  lastFocus && lastFocus.focus && lastFocus.focus();
}

function attr(label, value) {
  const unknown = !value || /לא ידוע|לבדוק/.test(value);
  return `<dt>${esc(label)}</dt><dd class="${unknown && !value ? "unknown" : ""}">${esc(value || "לא ידוע")}</dd>`;
}
function wazeUrl(p) { return `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`; }
function heroHTML(p, tag = "") {
  const ph = p.photo;
  return `<div class="card__hero${ph ? " has-photo" : ""}">
        ${ph ? `<img class="card__img" src="${esc(ph.url)}" alt="" loading="eager" decoding="async" onerror="this.remove()">` : ""}
        <button type="button" class="card__x" data-close aria-label="סגור">${icon.x}</button>
        ${tag}
        ${ph ? `<a class="card__credit" href="${esc(ph.page)}" target="_blank" rel="noopener">צילום: ${esc(ph.credit)}</a>` : ""}
      </div>`;
}
function thumbHTML(p, cls = "thumb") {
  return p && p.photo ? `<img class="${cls}" src="${esc(p.photo.url)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : "";
}

function openTrail(id) {
  const t = S.catalog.trails.find((x) => x.id === id);
  const fam = family();
  const trip = (fam.family && fam.trips[id]) || {};
  const familyBlock = fam.family ? `
    <section class="box family" aria-labelledby="famTitle">
      <h3 class="box__title" id="famTitle">שלנו</h3>
      <div class="row" style="align-items:center">
        <button type="button" class="btn btn--amber" data-act="done" aria-pressed="${!!trip.done}">${trip.done ? "עשינו ✓" : "סמנו: עשינו!"}</button>
        <div class="stars" role="group" aria-label="דירוג">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star" data-star="${n}" aria-label="${n} כוכבים" aria-pressed="${(trip.rating || 0) >= n}">${icon.star.replace('width="16" height="16"', 'width="26" height="26"')}</button>`).join("")}
        </div>
      </div>
      <label class="visually-hidden" for="tripNote">הערות שלנו</label>
      <textarea class="note" id="tripNote" placeholder="הערות שלנו: שווה לחזור? איפה אכלנו?">${esc(trip.note || "")}</textarea>
    </section>` : `
    <section class="box"><p class="meta-note" style="margin:0;font-size:14px">כדי לסמן "עשינו", לדרג ולשמור הערות, <button type="button" class="btn btn--outline" data-act="signin" style="min-height:36px;padding:6px 12px">התחברו עם Google</button></p></section>`;

  openSheet(`
    <article aria-labelledby="sheetTitle">
      ${heroHTML(t)}
      <div class="card__body">
        <div>
          <h2 class="card__title" id="sheetTitle">${esc(t.name)}</h2>
          <div class="card__sub">${esc(t.region)} · ${esc(t.difficulty_text)}</div>
        </div>
        <div class="facts">
          <div class="fact"><div class="fact__v">${t.km != null ? t.km : "—"}</div><div class="fact__k">ק"מ</div></div>
          <div class="fact"><div class="fact__v">${t.walk_min ? (t.walk_min >= 60 ? `${+(t.walk_min / 60).toFixed(1)} ש'` : `${t.walk_min} דק'`) : "—"}</div><div class="fact__k">הליכה</div></div>
          <div class="fact"><div class="fact__v">${esc(driveText(t))}</div><div class="fact__k">נסיעה</div></div>
          <div class="fact"><div class="fact__v">${esc(LABEL.route[t.route] || "—")}</div><div class="fact__k">סוג</div></div>
        </div>
        <section class="box" aria-labelledby="attrsTitle">
          <h3 class="box__title" id="attrsTitle">מאפייני המסלול</h3>
          <dl class="attrs">
            ${attr("אורך", t.length_text)}
            ${attr("זמן הליכה", t.walk_text)}
            ${attr("נגיש לעגלה", t.stroller_text)}
            ${attr("צל", t.shade_text)}
            ${attr("מים", t.water_text)}
            ${attr("להקפצה", t.shuttle_text)}
            ${attr("כניסה", t.fee_text)}
            ${attr("הזמנה מראש", t.booking_text)}
            ${attr("שירותים", t.toilets_text)}
            ${attr("עונה", t.season_text)}
            ${attr("אוכל בסביבה", t.food_text === "—" ? "" : t.food_text)}
          </dl>
        </section>
        <section aria-labelledby="whyTitle">
          <h3 class="box__title" id="whyTitle">למה ללכת</h3>
          <ul class="why">${t.why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
        </section>
        ${t.poi ? `<p class="meta-note" style="font-size:14px;margin:0"><strong>נקודות עניין:</strong> ${esc(t.poi)}</p>` : ""}
        ${t.check ? `<div class="callout"><strong>לבדוק לפני: </strong>${esc(t.check)}</div>` : ""}
        ${familyBlock}
      </div>
      <div class="card__actions">
        <a class="btn btn--primary btn--grow" href="${wazeUrl(t)}" target="_blank" rel="noopener">נווט ב-Waze</a>
        <button type="button" class="btn btn--outline" data-act="share">שתף</button>
        <button type="button" class="btn btn--outline" data-act="showmap">במפה</button>
      </div>
    </article>`, (panel) => {
    panel.querySelector('[data-act="share"]').addEventListener("click", () => share(t.name, `${t.name} – ${t.region}`, wazeUrl(t)));
    panel.querySelector('[data-act="showmap"]').addEventListener("click", () => { closeSheet(); setView("map"); select("trail", t.id); focusOn(t); });
    panel.querySelector('[data-act="signin"]')?.addEventListener("click", doSignIn);
    const doneBtn = panel.querySelector('[data-act="done"]');
    if (doneBtn) {
      doneBtn.addEventListener("click", async () => {
        const now = doneBtn.getAttribute("aria-pressed") !== "true";
        doneBtn.setAttribute("aria-pressed", now);
        doneBtn.textContent = now ? "עשינו ✓" : "סמנו: עשינו!";
        await saveTrip(t.id, { done: now, doneAt: now ? new Date().toISOString().slice(0, 10) : null });
        toast(now ? "נשמר. איזה כיף!" : "הסימון בוטל");
      });
      $$(".star", panel).forEach((b) => b.addEventListener("click", async () => {
        const n = +b.dataset.star;
        $$(".star", panel).forEach((s) => s.setAttribute("aria-pressed", +s.dataset.star <= n));
        await saveTrip(t.id, { rating: n });
      }));
      const note = panel.querySelector("#tripNote");
      note.addEventListener("change", async () => { await saveTrip(t.id, { note: note.value.trim() }); toast("ההערה נשמרה"); });
    }
  });
}

function openLodging(id) {
  const p = S.catalog.lodging.find((x) => x.id === id);
  openSheet(`
    <article aria-labelledby="sheetTitle">
      ${heroHTML(p, `<span class="tag tag--violet card__tag">${esc(LABEL.lodgingType[p.type] || p.kind_text)}</span>`)}
      <div class="card__body">
        <div>
          <h2 class="card__title" id="sheetTitle">${esc(p.name)}</h2>
          <div class="card__sub">${esc(p.region)} · ${esc(p.drive_text)} נסיעה</div>
        </div>
        <section class="box">
          <dl class="attrs">
            ${attr("סוג יחידה", p.unit_text)}
            ${attr("חימום / מיזוג", p.climate_text)}
            ${attr("מקלחות", p.bath_text)}
            ${attr("אוכל", p.food_text)}
            ${attr("מחיר", p.price_text)}
            ${attr("הזמנה", p.booking_text)}
            ${p.phone ? attr("טלפון", p.phone) : ""}
            ${attr("עונה", p.season_text)}
            ${attr("טיול קרוב", p.nearby_text)}
          </dl>
        </section>
        ${p.note ? `<div class="callout"><strong>שימו לב: </strong>${esc(p.note)}</div>` : ""}
      </div>
      <div class="card__actions">
        <a class="btn btn--primary btn--grow" href="${wazeUrl(p)}" target="_blank" rel="noopener">נווט ב-Waze</a>
        ${p.phone ? `<a class="btn btn--outline" href="tel:${esc(p.phone.replace(/[^0-9+]/g, ""))}">התקשר</a>` : ""}
        ${p.website ? `<a class="btn btn--outline" href="${esc(p.website)}" target="_blank" rel="noopener">לאתר המקום</a>` : ""}
      </div>
    </article>`);
}

function openActivity(id) {
  const a = S.catalog.activities.find((x) => x.id === id);
  const sat = { yes: "כן", no: "לא", unknown: "לבדוק" }[a.saturday] || "לבדוק";
  openSheet(`
    <article aria-labelledby="sheetTitle">
      ${heroHTML(a, `<span class="tag tag--blue card__tag">פעילות</span>`)}
      <div class="card__body">
        <div>
          <h2 class="card__title" id="sheetTitle">${esc(a.name)}</h2>
          <div class="card__sub">${esc(a.operator)}</div>
        </div>
        <section class="box">
          <dl class="attrs">
            ${attr("מתי", a.when_text)}
            ${attr("יש בשבת?", sat)}
            ${attr("גיל", a.age_text)}
            ${attr("מחיר", a.price_text)}
            ${attr('במנוי החלה"ט', a.member_text)}
            ${attr("הרשמה", a.signup_text)}
            ${attr("עונה", a.season_text)}
          </dl>
        </section>
        <ul class="why">${a.why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
        ${a.check ? `<div class="callout"><strong>לבדוק: </strong>${esc(a.check)}</div>` : ""}
      </div>
      <div class="card__actions">
        <a class="btn btn--primary btn--grow" href="${wazeUrl(a)}" target="_blank" rel="noopener">נווט ב-Waze</a>
        ${a.website ? `<a class="btn btn--outline" href="${esc(a.website)}" target="_blank" rel="noopener">לפרטים והרשמה</a>` : ""}
      </div>
    </article>`);
}

async function share(title, text, url) {
  try {
    if (navigator.share) { await navigator.share({ title, text, url }); return; }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast("הקישור הועתק");
  } catch { /* user cancelled */ }
}

/* ---------------- list views ---------------- */
function renderLodging() {
  const el = $("#viewLodging");
  const kinds = [["all", "הכול"], ["khan", "חאנים"], ["field_school", "בתי ספר שדה"], ["rtg", 'חניוני רט"ג']];
  const cur = el.dataset.kind || "all";
  const items = S.catalog.lodging.filter((p) => (cur === "all" || p.type === cur) && matchesText(p));
  el.innerHTML = `
    <div>
      <div class="list-head"><h1 class="list-title">איפה ישנים?</h1></div>
      <div class="chips" role="group" aria-label="סוג לינה" style="margin:0 0 12px;padding:0">
        ${kinds.map(([k, l]) => `<button type="button" class="chip" data-kind="${k}" aria-pressed="${cur === k}">${l}</button>`).join("")}
      </div>
      ${items.length ? `<ul class="list">${items.map((p) => `
        <li><button type="button" class="item${p.photo ? " has-photo" : ""}" data-id="${p.id}">
          ${thumbHTML(p, "item__img")}
          <span class="item__top"><span class="tag ${p.type === "khan" ? "tag--amber" : p.type === "field_school" ? "tag--violet" : ""}">${esc(LABEL.lodgingType[p.type] || p.kind_text)}</span><span>${esc(p.drive_text)}</span></span>
          <span class="item__title">${esc(p.name)}</span>
          <span class="item__text">${esc(p.unit_text)} · ${esc(p.climate_text)} · ${esc(p.food_text)}</span>
          <span class="item__bottom"><strong>${esc(p.price_text)}</strong><span>${esc(p.region)}</span></span>
        </button></li>`).join("")}</ul>`
      : `<div class="empty">${cur === "field_school" ? "בתי ספר השדה של החברה להגנת הטבע ייכנסו למאגר בסבב הבא." : "אין מקומות שמתאימים לחיפוש."}</div>`}
    </div>`;
  $$("[data-kind]", el).forEach((b) => b.addEventListener("click", () => { el.dataset.kind = b.dataset.kind; renderLodging(); }));
  $$(".item", el).forEach((b) => b.addEventListener("click", () => openLodging(b.dataset.id)));
}

function renderPlan() {
  $("#viewPlan").innerHTML = `
    <div class="empty">
      <h3>תכנון מראש – בקרוב</h3>
      <p style="margin:0">כאן תוכלו לתכנן יום טיול או סופ"ש של 2–3 ימים: לבחור אזור ותאריכים, לקבל הצעה למסלולים ולינה, ולשמור ליומן.</p>
      <p style="margin:0">בינתיים: המפה בכפתור "ספונטני", ורשימת החאנים והחניונים בלשונית "לינה".</p>
      <button type="button" class="btn btn--outline" data-goto="lodging">ללשונית לינה</button>
    </div>`;
  $("#viewPlan [data-goto]").addEventListener("click", () => setView("lodging"));
}

function renderMine() {
  const el = $("#viewMine");
  const f = family();
  if (!f.ready) { el.innerHTML = '<div class="empty">טוען…</div>'; return; }
  if (!f.user) {
    el.innerHTML = `
      <div class="empty">
        <h3>הטיולים שלנו</h3>
        <p style="margin:0">התחברו עם חשבון Google כדי לסמן מסלולים שעשיתם, לדרג, לשמור הערות ולהגדיר נקודת מוצא. בני המשפחה רואים את אותו מידע מהטלפון שלהם.</p>
        <button type="button" class="btn btn--primary" data-act="signin">התחברות עם Google</button>
      </div>`;
    $('[data-act="signin"]', el).addEventListener("click", doSignIn);
    return;
  }
  if (!f.family) {
    el.innerHTML = `
      <form class="empty" id="famForm">
        <h3>פותחים משפחה</h3>
        <p style="margin:0">המידע של המשפחה (מה עשיתם, דירוגים, הערות) נשמר במקום פרטי. רק המיילים שתוסיפו יראו אותו.</p>
        <div class="field"><label for="famName">שם המשפחה</label><input id="famName" required placeholder="למשל: משפחת שפי"></div>
        <div class="field"><label for="famPartner">מייל של בן/בת הזוג (לא חובה)</label><input id="famPartner" type="email" inputmode="email" placeholder="name@gmail.com"></div>
        <button type="submit" class="btn btn--primary">צור משפחה</button>
        <p class="meta-note" style="margin:0">מחובר/ת בתור ${esc(f.user.email)} · <button type="button" class="btn btn--outline" data-act="signout" style="min-height:32px;padding:4px 10px">יציאה</button></p>
      </form>`;
    $("#famForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.submitter; btn.disabled = true;
      try { await createFamily($("#famName").value, $("#famPartner").value); toast("המשפחה נוצרה"); }
      catch (err) { console.error(err); toast("לא הצלחתי ליצור משפחה. בדקו שחוקי הגישה פורסמו."); btn.disabled = false; }
    });
    $('[data-act="signout"]', el).addEventListener("click", () => signOutUser());
    return;
  }
  const done = S.catalog.trails.filter((t) => f.trips[t.id] && f.trips[t.id].done);
  const left = S.catalog.trails.length - done.length;
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="list-head"><h1 class="list-title">${esc(f.family.name)}</h1></div>
      <div class="facts" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <div class="fact"><div class="fact__v">${done.length}</div><div class="fact__k">מסלולים שעשינו</div></div>
        <div class="fact"><div class="fact__v">${left}</div><div class="fact__k">מחכים לנו במאגר</div></div>
      </div>
      <section class="box">
        <h2 class="box__title">מה עשינו</h2>
        ${done.length ? `<ul class="list">${done.map((t) => {
          const tr = f.trips[t.id];
          return `<li><button type="button" class="item" data-trail="${t.id}" style="background:var(--bg)">
            <span class="item__title">${esc(t.name)}</span>
            <span class="item__bottom"><span>${tr.rating ? "★".repeat(tr.rating) : "בלי דירוג"}</span><span>${esc(tr.doneAt || "")}</span></span>
            ${tr.note ? `<span class="item__text">${esc(tr.note)}</span>` : ""}
          </button></li>`;
        }).join("")}</ul>` : '<p class="meta-note" style="margin:0;font-size:14px">עוד לא סימנתם. פותחים כרטיס מסלול ולוחצים "עשינו!".</p>'}
      </section>
      <section class="box">
        <h2 class="box__title">נקודת מוצא</h2>
        <p style="margin:0 0 10px;font-size:15px">${esc(S.origin.name)}${S.origin.custom ? " (זמני הנסיעה הם הערכה)" : ""}</p>
        <div class="row">
          <button type="button" class="btn btn--outline" data-act="here">המיקום שלי עכשיו</button>
          ${S.origin.custom ? '<button type="button" class="btn btn--outline" data-act="home">חזרה לגעש</button>' : ""}
        </div>
      </section>
      <section class="box">
        <h2 class="box__title">בני המשפחה</h2>
        <ul class="members">${f.family.memberEmails.map((m) => `<li class="row" style="justify-content:space-between;align-items:center"><span>${esc(m)}</span>${m !== f.user.email ? `<button type="button" class="btn btn--outline" data-remove="${esc(m)}" style="min-height:32px;padding:4px 10px">הסר</button>` : '<span class="meta-note">את/ה</span>'}</li>`).join("")}</ul>
        <form class="row" id="addForm" style="margin-top:10px">
          <label class="visually-hidden" for="addEmail">מייל להוספה</label>
          <input id="addEmail" type="email" inputmode="email" placeholder="מייל של בן משפחה" style="flex:1;min-width:0;height:46px;border:1.5px solid var(--line-2);border-radius:12px;padding:0 12px">
          <button type="submit" class="btn btn--primary">הוסף</button>
        </form>
      </section>
      <p class="meta-note">מחובר/ת בתור ${esc(f.user.email)} · <button type="button" class="btn btn--outline" data-act="signout" style="min-height:32px;padding:4px 10px">יציאה</button></p>
    </div>`;
  $$("[data-trail]", el).forEach((b) => b.addEventListener("click", () => openTrail(b.dataset.trail)));
  $('[data-act="signout"]', el).addEventListener("click", () => signOutUser());
  $('[data-act="here"]', el).addEventListener("click", useMyLocation);
  $('[data-act="home"]', el)?.addEventListener("click", async () => { await setOrigin(null); });
  $$("[data-remove]", el).forEach((b) => b.addEventListener("click", () => removeMember(b.dataset.remove)));
  $("#addForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = $("#addEmail").value;
    if (!v) return;
    await addMember(v);
    toast("נוסף. מעכשיו גם הוא/היא רואים את המידע");
  });
}

function useMyLocation() {
  if (!navigator.geolocation) { toast("הדפדפן לא תומך במיקום"); return; }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const o = { name: "המיקום שלי", lat: +pos.coords.latitude.toFixed(4), lng: +pos.coords.longitude.toFixed(4), custom: true };
    if (family().family) await setOrigin(o);
    else { S.origin = o; refreshAll(); }
    toast("זמני הנסיעה חושבו מהמיקום שלך (הערכה)");
  }, () => toast("לא קיבלתי הרשאה למיקום"), { enableHighAccuracy: false, timeout: 10000 });
}

async function doSignIn() {
  try { await signIn(); }
  catch (err) {
    console.error(err);
    if (err && err.code === "auth/unauthorized-domain") toast("צריך להוסיף את כתובת האתר ל-Authorized domains ב-Firebase");
    else if (err && err.code !== "auth/popup-closed-by-user") toast("ההתחברות לא הצליחה");
  }
}

/* ---------------- views & wiring ---------------- */
function setView(v) {
  S.view = v;
  $("#viewMap").hidden = v !== "map";
  $("#viewLodging").hidden = v !== "lodging";
  $("#viewMine").hidden = v !== "mine";
  $("#viewPlan").hidden = v !== "plan";
  $$(".tab").forEach((t) => (t.dataset.view === v ? t.setAttribute("aria-current", "page") : t.removeAttribute("aria-current")));
  $$(".seg__btn").forEach((b) => b.setAttribute("aria-pressed", (b.dataset.mode === "plan") === (v === "plan")));
  $("#chips").hidden = v !== "map";
  if (v === "lodging") renderLodging();
  if (v === "mine") renderMine();
  if (v === "plan") renderPlan();
  if (v === "map" && map) setTimeout(() => map.invalidateSize(), 0);
}

function refreshAll() {
  computeRec();
  renderMarkers();
  renderDock();
  if (S.view === "mine") renderMine();
  if (S.view === "lodging") renderLodging();
}

function wire() {
  $$(".tab").forEach((t) => t.addEventListener("click", () => setView(t.dataset.view)));
  $$(".seg__btn").forEach((b) => b.addEventListener("click", () => setView(b.dataset.mode === "plan" ? "plan" : "map")));
  $("#chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    const k = b.dataset.filter;
    S.filters.has(k) ? S.filters.delete(k) : S.filters.add(k);
    b.setAttribute("aria-pressed", S.filters.has(k));
    S.selected = null;
    renderMarkers(); renderDock();
  });
  let qt;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(qt);
    qt = setTimeout(() => {
      S.query = e.target.value.trim().toLowerCase();
      renderMarkers();
      if (S.view === "lodging") renderLodging();
      if (S.query && S.view === "map") {
        const hit = S.catalog.trails.find(matches);
        if (hit) { focusOn(hit); }
      }
    }, 180);
  });
  $("#sheet").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });
  $("#accountBtn").addEventListener("click", () => {
    if (family().user) setView("mine"); else doSignIn();
  });
}

async function boot() {
  const res = await fetch("data/catalog.json", { cache: "no-cache" });
  S.catalog = await res.json();
  S.origin = { ...S.catalog.origin, custom: false };
  wire();
  initMap();
  refreshAll();
  setView("map");
  requestAnimationFrame(() => fitAll());

  try { FAM = await import("./family.js"); }
  catch (err) { console.error("sign-in unavailable", err); return; }
  FAM.onFamilyChange((f) => {
    const btn = $("#accountBtn");
    btn.classList.toggle("is-signed", !!f.user);
    $("#accountInitial").textContent = f.user ? (f.user.name || f.user.email).trim().charAt(0).toUpperCase() : "";
    btn.setAttribute("aria-label", f.user ? `חשבון: ${f.user.email}` : "התחברות");
    $('[data-filter="notdone"]').hidden = !f.family;
    const o = f.family && f.family.origin;
    S.origin = o ? { ...o, custom: true } : { ...S.catalog.origin, custom: false };
    refreshAll();
  });
}

boot().catch((err) => {
  console.error(err);
  $("#dock").innerHTML = '<div class="peek"><strong>משהו השתבש בטעינה.</strong><span class="peek__meta">נסו לרענן את הדף.</span></div>';
});
