"""Build data/catalog.json from the catalog spreadsheet (exported .xlsx) + app_ columns.
Usage: python tools/gen_catalog.py <xlsx> <app_values.json> <out.json>
The xlsx holds the Hebrew text columns and source links; app_values.json holds the app_* columns
as read from the live Google Sheet."""
import json, re, sys
import openpyxl

xlsx, appjson, out = sys.argv[1:4]
wb = openpyxl.load_workbook(xlsx)
app = json.load(open(appjson, encoding="utf-8"))

def url(v):
    if not v: return None
    m = re.search(r'HYPERLINK\("([^"]+)"', str(v))
    return m.group(1) if m else None

def rows(ws):
    hdr = [c.value for c in ws[1]]
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[0]: yield dict(zip(hdr, r))

def b(v):
    if v in (True, "TRUE"): return True
    if v in (False, "FALSE"): return False
    return None

def num(v):
    try: return float(v)
    except (TypeError, ValueError): return None

# generic (non-personal) "why" text overrides: the catalog is shared, so no "you did this" wording
WHY = {
 "T01": ["גנים נגישים ושבילים מעגליים", "חרבת עלק ונוף לעמק", "אפשר להאריך לעין צור כשיש כוח"],
 "T04": ["בחורף פריחה של אירוסים וכלניות", "רכס כורכר ואגם פולג", "מתאים להקפצה עם שני רכבים"],
 "T06": ["בריכות שכשוך רדודות", "מבצר אנטיפטריס", "פיקניק מוצל"],
 "T08": ["צבים רכים ענקיים מהגשר (בעיקר אחר הצהריים)", "שביל סלול ונוח", "מתאים להקפצה"],
 "T02": ["מבצר צלבני ואבירים", "נוף לים מכל פינה", "שביל נגיש לרוב אתרי הגן"],
 "T03": ["שביל ישראל על המצוק מעל הים", "קצר וגמיש – חצי יום אמיתי"],
 "T07": ["מסתורי תצפית לציפורים", "שביל רחב שמתאים לעגלה", "קל לשלב עם גשר הצבים"],
 "T11": ["מערות אמיתיות של אדם קדמון – הרפתקה לילדים", "אתר מורשת עולמית של אונסק\"ו", "שבילים מסביב ללא תשלום"],
 "A02": ["סיור משפחתי בעונת הנדידה", "אפשר לשלב עם נחל תנינים"],
}

def bullets(s):
    return [x.strip(" •") for x in str(s or "").split("\n") if x.strip(" •")]

trails = []
for r in rows(wb["מסלולים"]):
    a = app["trails"][r["מזהה"]]
    months = [int(x) for x in str(a["app_months"]).split(",") if x.strip()]
    trails.append({
        "id": r["מזהה"], "name": r["שם"], "region": r["אזור"],
        "drive_min": num(r["נסיעה מגעש (דק')"]),
        "length_text": r["אורך (ק\"מ)"], "walk_text": r["זמן הליכה"],
        "route_text": r["מעגלי / קווי"], "shuttle_text": r["מתאים להקפצה (2 רכבים)"],
        "difficulty_text": r["קושי לילדים"], "stroller_text": r["עגלה"],
        "shade_text": r["צל"], "water_text": r["מים"], "season_text": r["עונה מומלצת"],
        "fee_text": r["תשלום"], "booking_text": r["הזמנה מראש"], "toilets_text": r["שירותים"],
        "food_text": r["אוכל בסביבה"],
        "why": WHY.get(r["מזהה"], bullets(r["למה ללכת"])),
        "poi": r["נקודות עניין"], "check": None if r["לבדוק לפני היציאה"] in (None, "—") else r["לבדוק לפני היציאה"],
        "lat": num(r["קו רוחב"]), "lng": num(r["קו אורך"]),
        "sources": [u for u in (url(r["מקור 1"]), url(r["מקור 2"])) if u],
        "reliability": r["רמת אמינות"], "estimated": r["שדות שהם הערכה שלי"], "checked": r["תאריך בדיקה"],
        "months": months, "km": num(a["app_km"]), "walk_min": num(a["app_walk_min"]),
        "route": a["app_route"], "shuttle": b(a["app_shuttle"]), "stroller": a["app_stroller"],
        "shade": a["app_shade"], "water": a["app_water"], "fee": a["app_fee"],
        "booking": b(a["app_booking"]) if a["app_booking"] != "unknown" else None,
        "toilets": a["app_toilets"], "difficulty": int(num(a["app_difficulty"]) or 1),
    })

lodging = []
for r in rows(wb["לינה"]):
    a = app["lodging"][r["מזהה"]]
    lodging.append({
        "id": r["מזהה"], "name": r["שם"], "kind_text": r["סוג מקום"], "unit_text": r["סוג יחידה"],
        "region": r["אזור"], "drive_text": r["נסיעה מגעש (הערכה)"], "climate_text": r["חימום / מיזוג"],
        "bath_text": r["מקלחות ושירותים"], "food_text": r["אוכל"], "price_text": r["מחיר ללילה"],
        "booking_text": r["איך מזמינים"], "phone": None if r["טלפון"] in (None, "—") else r["טלפון"],
        "season_text": r["עונה"], "nearby_text": r["מסלולים קרובים לפעוטות"], "note": r["לבדוק / הערות"],
        "sources": [u for u in [url(r["מקור"])] if u], "reliability": r["רמת אמינות"], "checked": r["תאריך בדיקה"],
        "type": a["app_type"], "private_unit": b(a["app_private_unit"]), "heat_ac": a["app_heat_ac"],
        "meals": a["app_meals"], "lat": num(a["app_lat"]), "lng": num(a["app_lng"]),
    })

activities = []
for r in rows(wb["פעילויות"]):
    a = app["activities"][r["מזהה"]]
    activities.append({
        "id": r["מזהה"], "name": r["שם הפעילות"], "operator": r["מפעיל"], "place": r["מיקום"],
        "trail": r["מסלול קשור"], "drive_min": num(r["נסיעה מגעש (דק')"]), "when_text": r["מתי (ימים ושעות)"],
        "age_text": r["גיל מתאים"], "price_text": r["מחיר"], "member_text": r["כלול במנוי החלה\"ט?"],
        "signup_text": r["הרשמה"], "season_text": r["עונה"],
        "why": WHY.get(r["מזהה"], bullets(r["למה זה מתאים לנו"])),
        "check": None if r["לבדוק"] in (None, "—") else r["לבדוק"],
        "sources": [u for u in [url(r["מקור"])] if u], "reliability": r["רמת אמינות"], "checked": r["תאריך בדיקה"],
        "saturday": a["app_saturday"], "lat": num(a["app_lat"]), "lng": num(a["app_lng"]),
    })

json.dump({"version": "2026-11-16", "origin": {"name": "געש", "lat": 32.2290, "lng": 34.8240},
           "trails": trails, "lodging": lodging, "activities": activities},
          open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(trails), len(lodging), len(activities))
