// "המלצת השבוע" – rule-based for now: season, distance, what the family already did.
// Weather (Open-Meteo) joins in version 2.

const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

export function nextSaturday(from = new Date()) {
  const d = new Date(from);
  d.setHours(12, 0, 0, 0);
  const add = (6 - d.getDay() + 7) % 7; // Saturday = 6; today if Saturday
  d.setDate(d.getDate() + add);
  return d;
}

export function formatDay(d) {
  return `שבת ${d.getDate()}.${d.getMonth() + 1}`;
}

function weekKey(d) {
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.floor((d - start) / (7 * 864e5));
}

function jitter(id, wk) {
  let h = 0;
  for (const c of `${id}:${wk}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 1000) / 1000;
}

export function rankTrails(trails, { date, driveOf, trips }) {
  const month = date.getMonth() + 1;
  const wk = weekKey(date);
  const scored = trails.map((t) => {
    const drive = driveOf(t);
    const done = !!(trips && trips[t.id] && trips[t.id].done);
    const inSeason = t.months.includes(month);
    let s = 0;
    s += inSeason ? 3 : -3;
    s += done ? -1 : 2;
    if (drive != null) s += drive <= 30 ? 1.5 : drive <= 50 ? 1 : drive <= 80 ? 0 : -1;
    if (t.difficulty === 1) s += 0.5;
    if (t.stroller === "yes") s += 0.3;
    s += jitter(t.id, wk) * 0.9;

    const reasons = [];
    if (inSeason) reasons.push(seasonReason(t, month));
    if (drive != null) reasons.push(`${drive} דק' מהבית`);
    if (trips && !done) reasons.push("עוד לא עשיתם");
    else if (t.water === "wading") reasons.push("יש מים לשכשוך");
    else if (t.stroller === "yes") reasons.push("נגיש לעגלה");
    else if (t.difficulty === 1) reasons.push("שביל קל");
    return { trail: t, score: s, reasons: reasons.slice(0, 3) };
  });
  return scored.sort((a, b) => b.score - a.score);
}

function seasonReason(t, month) {
  const text = t.season_text || "";
  if (/פריח|אירוס|כלנ/.test(text) && [12, 1, 2, 3, 4].includes(month)) return "עונת הפריחה";
  if (/נדיד/.test(text)) return "עונת הנדידה";
  if (/זרימ/.test(text) && [12, 1, 2, 3].includes(month)) return "הנחל זורם";
  return `מומלץ ב${HE_MONTHS[month - 1]}`;
}
