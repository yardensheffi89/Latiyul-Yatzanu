import { rankTrails, nextSaturday, formatDay } from "./recommend.js?v=6";
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
  mode: "spontaneous",     // "spontaneous" | "plan"
  planArea: "all",         // subarea filter in plan mode
  pkgIndex: 0,
  pkgActive: false,        // draw the current weekend package on the map
  pkgCollapsed: false,
};

/* ---------------- planning helpers ---------------- */
const AREAS = [
  ["all", "כל הדרום"], ["ramon", "רמון והר הנגב"], ["craters", "המכתשים"], ["deadsea", "ים המלח וערד"],
  ["arava", "ערבה"], ["eilat", "אילת והרי אילת"], ["north_negev", "צפון ומערב הנגב"],
];
// Rough road time between two points: straight line × 1.35, ~60 km/h average.
function minutesBetween(a, b) {
  // desert roads wind and include access tracks: ×1.5, ~55 km/h, +5 min to park
  const km = haversineKm(a, b) * 1.5;
  return Math.max(10, Math.round((km / 55 * 60 + 5) / 5) * 5);
}
function nearbyTrails(place, max = 60) {
  return S.catalog.trails
    .map((t) => ({ t, min: minutesBetween(place, t) }))
    .filter((x) => x.min <= max)
    .sort((a, b) => a.min - b.min);
}
function nearbyLodging(place, max = 60) {
  return S.catalog.lodging
    .filter((l) => l.lat != null)
    .map((l) => ({ l, min: minutesBetween(place, l) }))
    .filter((x) => x.min <= max)
    .sort((a, b) => a.min - b.min);
}
let PACKAGES = [];
function buildPackages() {
  const month = nextSaturday().getMonth() + 1;
  PACKAGES = S.catalog.lodging.filter((l) => l.area === "south" && l.lat != null).map((l) => {
    const cands = nearbyTrails(l, 75).map((x) => {
      let score = x.min;
      if (x.t.water === "wading") score -= 15;
      if (x.t.difficulty === 1) score -= 8;
      if (x.t.stroller === "yes" || x.t.stroller === "partial") score -= 4;
      if (!x.t.months.includes(month)) score += 25;
      return { ...x, score };
    }).sort((a, b) => a.score - b.score);
    const picked = [];
    for (const c of cands) {
      if (picked.length >= 3) break;
      if (c.t.difficulty === 3 && picked.some((p) => p.t.difficulty === 3)) continue;
      picked.push(c);
    }
    const km = picked.reduce((s, x) => s + (x.t.km || 0), 0);
    return { id: `P-${l.id}`, lodging: l, trails: picked, km: Math.round(km * 10) / 10, sub: l.subarea };
  }).filter((p) => p.trails.length >= 2);
}
function visiblePackages() {
  return PACKAGES.filter((p) => S.planArea === "all" || p.sub === S.planArea);
}
function currentPackage() {
  const list = visiblePackages();
  if (!list.length) return null;
  if (S.pkgIndex >= list.length) S.pkgIndex = 0;
  return list[S.pkgIndex];
}
function inPlanArea(x) {
  return x.area === "south" && (S.planArea === "all" || x.subarea === S.planArea);
}

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
  if (S.mode === "plan" && !inPlanArea(t)) return false;
  const month = new Date().getMonth() + 1;
  if (f.has("near") && S.mode !== "plan") { const d = driveOf(t); if (d == null || d > 45) return false; }
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

  const pkg = S.mode === "plan" && S.pkgActive ? currentPackage() : null;
  const pkgIds = pkg ? new Set(pkg.trails.map((x) => x.t.id)) : null;
  if (pkg) {
    for (const x of pkg.trails) {
      L.polyline([[pkg.lodging.lat, pkg.lodging.lng], [x.t.lat, x.t.lng]], { color: "#5E4A8E", weight: 3, opacity: 0.75, dashArray: "6 7", interactive: false }).addTo(markerLayer);
      L.marker([(pkg.lodging.lat + x.t.lat) / 2, (pkg.lodging.lng + x.t.lng) / 2], {
        icon: L.divIcon({ className: "", html: `<span class="line-label">~${x.min} דק'</span>`, iconSize: [0, 0] }), interactive: false, keyboard: false,
      }).addTo(markerLayer);
    }
  }
  let shown = 0;
  for (const t of cat.trails) {
    if (S.mode === "plan" && t.area !== "south") continue;
    const ok = matches(t) && (!pkgIds || pkgIds.has(t.id));
    if (ok) shown++;
    const isRec = S.mode !== "plan" && rec && rec.trail.id === t.id && !S.filters.size && !S.query;
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
  if (S.layers.has("lodging") || S.mode === "plan") {
    for (const p of cat.lodging) {
      if (!matchesText(p) || p.lat == null) continue;
      if (S.mode === "plan" && !inPlanArea(p)) continue;
      const sel = (S.selected && S.selected.kind === "lodging" && S.selected.id === p.id) || (pkg && pkg.lodging.id === p.id);
      const big = S.mode === "plan";
      const m = L.marker([p.lat, p.lng], { icon: pinIcon(`pin pin--lodging ${big ? "pin--lodging-big" : ""} ${sel ? "pin--selected" : ""} ${pkg && !sel ? "pin--muted" : ""}`, big ? "⌂" : "", big ? 30 : undefined), title: p.name, alt: p.name, zIndexOffset: sel ? 900 : 200 });
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
  $("#resultCount").textContent = S.mode === "plan" ? "" : active ? `${shown} מסלולים מתאימים` : "";
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
  let pts;
  if (S.mode === "plan") {
    const pkg = S.pkgActive && currentPackage();
    pts = pkg ? [[pkg.lodging.lat, pkg.lodging.lng], ...pkg.trails.map((x) => [x.t.lat, x.t.lng])]
      : [...S.catalog.trails, ...S.catalog.lodging].filter((x) => x.lat != null && inPlanArea(x)).map((x) => [x.lat, x.lng]);
  } else {
    pts = S.catalog.trails.filter((t) => t.area !== "south").map((t) => [t.lat, t.lng]);
    if (S.origin) pts.push([S.origin.lat, S.origin.lng]);
  }
  if (!pts.length) return;
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
  const dayTrips = S.catalog.trails.filter((t) => { const d = driveOf(t); return d == null || d <= 100; });
  ranked = rankTrails(dayTrips, { date, driveOf, trips: trips() }).filter((r) => r.trail.months.includes(date.getMonth() + 1));
  if (!ranked.length) ranked = rankTrails(dayTrips, { date, driveOf, trips: trips() });
  if (S.recIndex >= ranked.length) S.recIndex = 0;
}
function currentRec() { return ranked[S.recIndex] || null; }

/* ---------------- dock ---------------- */
function renderDock() {
  const dock = $("#dock");
  if (S.selected) { dock.innerHTML = peekHTML(); bindPeek(dock); return; }
  if (S.mode === "plan") { renderPlanDock(dock); return; }
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

function pkgTrailsHTML(pkg, compact = false) {
  if (compact) {
    return `<div class="pkg__chips">${pkg.trails.map((x) => `
      <button type="button" class="pkg__chip" data-trail="${x.t.id}">
        ${thumbHTML(x.t, "pkg__chipimg")}
        <span class="pkg__chipname">${esc(x.t.name.split(" – ")[0])}</span>
        <span class="pkg__chipmeta">~${x.min} דק' · ${x.t.km != null ? `${x.t.km} ק"מ` : ""}</span>
      </button>`).join("")}</div>`;
  }
  return pkg.trails.map((x) => `
    <button type="button" class="pkg__trail" data-trail="${x.t.id}">
      ${thumbHTML(x.t, "pkg__thumb")}
      <span class="pkg__ttext">
        <span class="pkg__tname">${esc(x.t.name)}</span>
        <span class="pkg__tmeta">~${x.min} דק' מהלינה · ${x.t.km != null ? `${x.t.km} ק"מ` : esc(x.t.length_text)} · ${esc(x.t.difficulty_text)}</span>
      </span>
    </button>`).join("");
}
function renderPlanDock(dock) {
  const list = visiblePackages();
  const pkg = currentPackage();
  if (!pkg) {
    dock.innerHTML = `<article class="peek"><strong>אין עדיין הצעות לסופ"ש באזור הזה.</strong><span class="peek__meta">נסו "כל הדרום".</span></article>`;
    return;
  }
  const l = pkg.lodging;
  dock.innerHTML = `
    <article class="pkg ${S.pkgCollapsed ? "is-collapsed" : ""}" aria-labelledby="pkgTitle">
      <div class="pkg__top">
        <div class="pkg__label">סופ"ש מוכן · ${S.pkgIndex + 1}/${list.length}</div>
        <div class="row" style="width:auto;gap:6px">
          <button type="button" class="pkg__nav" data-act="collapse" aria-label="${S.pkgCollapsed ? "הרחב" : "כווץ"}" aria-expanded="${!S.pkgCollapsed}" style="transform:rotate(${S.pkgCollapsed ? 180 : 0}deg)">${icon.chevron}</button>
          <button type="button" class="pkg__nav" data-act="prev" aria-label="הקודם">‹</button>
          <button type="button" class="pkg__nav" data-act="next" aria-label="הבא">›</button>
        </div>
      </div>
      <button type="button" class="pkg__lodging" data-act="lodging">
        ${thumbHTML(l, "pkg__lthumb")}
        <span>
          <span class="pkg__kind">${esc(LABEL.lodgingType[l.type] || l.kind_text)} · ${esc(l.region)}</span>
          <h2 class="pkg__title" id="pkgTitle">${esc(l.name)}</h2>
          <span class="pkg__meta">${esc(l.drive_text)} מהבית · ${esc(l.price_text.split("·")[0])}</span>
        </span>
      </button>
      ${pkgTrailsHTML(pkg, true)}
      <div class="rec__actions pkg__actions">
        <button type="button" class="btn btn--primary btn--grow" data-act="open">לפרטי הסופ"ש</button>
        <button type="button" class="btn btn--outline" data-act="map">${S.pkgActive ? "כל האזור" : "רק הסופ\"ש"}</button>
      </div>
    </article>`;
  const go = (d) => { S.pkgIndex = (S.pkgIndex + d + list.length) % list.length; S.pkgActive = true; renderDock(); renderMarkers(); fitAll(); };
  dock.querySelector('[data-act="collapse"]').addEventListener("click", () => { S.pkgCollapsed = !S.pkgCollapsed; renderDock(); requestAnimationFrame(fitAll); });
  dock.querySelector('[data-act="prev"]').addEventListener("click", () => go(-1));
  dock.querySelector('[data-act="next"]').addEventListener("click", () => go(1));
  dock.querySelector('[data-act="open"]').addEventListener("click", () => openPackage(pkg));
  dock.querySelector('[data-act="lodging"]').addEventListener("click", () => openLodging(l.id));
  dock.querySelector('[data-act="map"]').addEventListener("click", () => { S.pkgActive = !S.pkgActive; renderDock(); renderMarkers(); fitAll(); });
  $$("[data-trail]", dock).forEach((b) => b.addEventListener("click", () => openTrail(b.dataset.trail)));
}

function openPackage(pkg) {
  const l = pkg.lodging;
  openSheet(`
    <article aria-labelledby="sheetTitle">
      ${heroHTML(l, `<span class="tag tag--violet card__tag">סופ"ש מוכן</span>`)}
      <div class="card__body">
        <div>
          <h2 class="card__title" id="sheetTitle">סופ"ש ב${esc(l.region)}</h2>
          <div class="card__sub">לינה ב${esc(l.name)} + ${pkg.trails.length} מסלולים · ${pkg.km ? `${pkg.km} ק"מ הליכה בסך הכול` : ""}</div>
        </div>
        <section class="box">
          <h3 class="box__title">איפה ישנים</h3>
          <button type="button" class="pkg__lodging" data-lodging="${l.id}" style="background:var(--bg)">
            ${thumbHTML(l, "pkg__lthumb")}
            <span>
              <span class="pkg__kind">${esc(LABEL.lodgingType[l.type] || l.kind_text)} · ${esc(l.drive_text)} מהבית</span>
              <span class="pkg__title" style="display:block">${esc(l.name)}</span>
              <span class="pkg__meta">${esc(l.unit_text)} · ${esc(l.price_text)}</span>
            </span>
          </button>
        </section>
        <section class="box">
          <h3 class="box__title">מה עושים</h3>
          <div class="pkg__trails">${pkgTrailsHTML(pkg)}</div>
          <p class="meta-note" style="margin:6px 0 0">זמני הנסיעה מהלינה משוערים.</p>
        </section>
        ${l.note ? `<div class="callout"><strong>שימו לב: </strong>${esc(l.note)}</div>` : ""}
      </div>
      <div class="card__actions">
        <button type="button" class="btn btn--primary btn--grow" data-act="showmap">הצג במפה</button>
        ${l.website ? `<a class="btn btn--outline" href="${esc(l.website)}" target="_blank" rel="noopener">להזמנת לינה</a>` : ""}
        <button type="button" class="btn btn--outline" data-act="share">שתף</button>
      </div>
    </article>`, (panel) => {
    $$("[data-trail]", panel).forEach((b) => b.addEventListener("click", () => openTrail(b.dataset.trail)));
    panel.querySelector("[data-lodging]").addEventListener("click", () => openLodging(l.id));
    panel.querySelector('[data-act="showmap"]').addEventListener("click", () => {
      closeSheet();
      S.planArea = "all"; S.pkgIndex = Math.max(0, visiblePackages().indexOf(pkg)); S.pkgActive = true;
      setMode("plan");
    });
    panel.querySelector('[data-act="share"]').addEventListener("click", () => share(`סופ"ש ב${l.region}`,
      `סופ"ש ב${l.region}: לינה ב${l.name} + ${pkg.trails.map((x) => x.t.name).join(", ")}`, location.href.split("#")[0]));
  });
}

function nearListHTML(items, kind) {
  if (!items.length) return "";
  return `<ul class="near">${items.map((x) => {
    const p = x.t || x.l;
    return `<li><button type="button" class="near__item" data-${kind}="${p.id}">${thumbHTML(p, "near__thumb")}<span class="near__name">${esc(p.name)}</span><span class="near__min">~${x.min} דק'</span></button></li>`;
  }).join("")}</ul>`;
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
        ${S.mode === "plan" ? (() => { const n = nearbyLodging(t, 60); return n.length ? `<div class="peek__near"><div class="peek__kind">לינה קרובה</div>${nearListHTML(n.slice(0, 2), "lodging")}</div>` : ""; })() : ""}
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
            <div class="peek__meta">${esc(p.drive_text)} · ${esc(p.price_text.split("·")[0])}</div>
          </div>
          <button type="button" class="peek__close" data-act="close" aria-label="סגור">${icon.x}</button>
        </div>
        ${(() => { const n = nearbyTrails(p, 45); return n.length ? `<div class="peek__near"><div class="peek__kind">מסלולים עד 45 דק' מכאן (${n.length})</div>${nearListHTML(n.slice(0, 3), "trail")}</div>` : ""; })()}
        <button type="button" class="btn btn--primary" data-act="open">פרטים ומסלולים בסביבה</button>
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
  $$("[data-trail]", dock).forEach((b) => b.addEventListener("click", () => openTrail(b.dataset.trail)));
  $$("[data-lodging]", dock).forEach((b) => b.addEventListener("click", () => openLodging(b.dataset.lodging)));
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
        ${t.area === "south" ? (() => { const n = nearbyLodging(t, 60).slice(0, 4); return n.length ? `<section class="box"><h3 class="box__title">לינה בסביבה</h3>${nearListHTML(n, "lodging")}</section>` : ""; })() : ""}
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
    $$("[data-lodging]", panel).forEach((b) => b.addEventListener("click", () => openLodging(b.dataset.lodging)));
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
        ${(() => { const n = nearbyTrails(p, 60).slice(0, 6); return n.length ? `<section class="box"><h3 class="box__title">מסלולים בסביבה</h3>${nearListHTML(n, "trail")}<p class="meta-note" style="margin:6px 0 0">זמני נסיעה משוערים מהלינה.</p></section>` : ""; })()}
      </div>
      <div class="card__actions">
        <a class="btn btn--primary btn--grow" href="${wazeUrl(p)}" target="_blank" rel="noopener">נווט ב-Waze</a>
        ${p.phone ? `<a class="btn btn--outline" href="tel:${esc(p.phone.replace(/[^0-9+]/g, ""))}">התקשר</a>` : ""}
        ${p.website ? `<a class="btn btn--outline" href="${esc(p.website)}" target="_blank" rel="noopener">לאתר המקום</a>` : ""}
      </div>
    </article>`, (panel) => {
    $$("[data-trail]", panel).forEach((b) => b.addEventListener("click", () => openTrail(b.dataset.trail)));
  });
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
  const el = $("#viewPlan");
  const groups = AREAS.filter(([k]) => k !== "all").map(([k, label]) => [label, PACKAGES.filter((p) => p.sub === k)]).filter(([, l]) => l.length);
  el.innerHTML = `
    <div>
      <div class="list-head"><h1 class="list-title">סופי שבוע מוכנים</h1><span class="tag tag--amber">בטא · דרום</span></div>
      <p class="meta-note" style="margin:-4px 0 14px;font-size:14px">כל הצעה = מקום לינה + 2–3 מסלולים קרובים אליו, לפי העונה. רוצים לבנות לבד? <button type="button" class="linkbtn" data-act="planmap">לתכנון במפה</button></p>
      ${groups.map(([label, list]) => `
        <h2 class="group-title">${esc(label)}</h2>
        <ul class="list">${list.map((pkg) => `
          <li><button type="button" class="item${pkg.lodging.photo ? " has-photo" : ""}" data-pkg="${pkg.id}">
            ${thumbHTML(pkg.lodging, "item__img")}
            <span class="item__top"><span class="tag tag--violet">${esc(LABEL.lodgingType[pkg.lodging.type] || "")}</span><span>${esc(pkg.lodging.drive_text)} מהבית</span></span>
            <span class="item__title">${esc(pkg.lodging.name)}</span>
            <span class="item__text">${pkg.trails.map((x) => esc(x.t.name)).join(" · ")}</span>
            <span class="item__bottom"><strong>${pkg.trails.length} מסלולים${pkg.km ? ` · ${pkg.km} ק"מ` : ""}</strong><span>${esc(pkg.lodging.price_text.split("·")[0])}</span></span>
          </button></li>`).join("")}</ul>`).join("")}
    </div>`;
  $$("[data-pkg]", el).forEach((b) => b.addEventListener("click", () => openPackage(PACKAGES.find((p) => p.id === b.dataset.pkg))));
  el.querySelector('[data-act="planmap"]').addEventListener("click", () => setMode("plan"));
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
  $$(".seg__btn").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === S.mode));
  $("#chips").hidden = v !== "map";
  $("#planChips").hidden = v !== "map" || S.mode !== "plan";
  $('[data-filter="near"]').hidden = S.mode === "plan";
  if (v === "lodging") renderLodging();
  if (v === "mine") renderMine();
  if (v === "plan") renderPlan();
  if (v === "map" && map) setTimeout(() => map.invalidateSize(), 0);
}

function setMode(m) {
  S.mode = m;
  S.selected = null;
  S.pkgActive = m === "plan";
  document.body.dataset.mode = m;
  renderPlanChips();
  setView("map");
  renderMarkers(); renderDock();
  requestAnimationFrame(() => fitAll());
}
function renderPlanChips() {
  const el = $("#planChips");
  el.innerHTML = AREAS.map(([k, l]) => `<button type="button" class="chip chip--area" data-area="${k}" aria-pressed="${S.planArea === k}">${l}</button>`).join("");
}

function refreshAll() {
  computeRec();
  buildPackages();
  renderMarkers();
  renderDock();
  if (S.view === "mine") renderMine();
  if (S.view === "lodging") renderLodging();
  if (S.view === "plan") renderPlan();
}

function wire() {
  $$(".tab").forEach((t) => t.addEventListener("click", () => setView(t.dataset.view)));
  $$(".seg__btn").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode === "plan" ? "plan" : "spontaneous")));
  $("#planChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-area]");
    if (!b) return;
    S.planArea = b.dataset.area; S.pkgIndex = 0; S.pkgActive = true; S.selected = null;
    renderPlanChips(); renderMarkers(); renderDock(); fitAll();
  });
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
