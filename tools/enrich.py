"""Post-process data/catalog.json for the public app:
- attach one photo per place (data/photos.json, Wikimedia Commons, with credit)
- set `website` to the place's own official site only (or None)
- drop research sources/reliability fields (kept in the Google Sheet only)
"""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
cat = json.loads((root / "data/catalog.json").read_text())
photos = json.loads((root / "data/photos.json").read_text())

# Official websites only. RTG campsites: the parks.org.il page is the official one.
WEBSITE = {
    "L01": "https://www.parks.org.il/camping/חניון-לילה-גן-לאומי-ממשית-החאן-הנבטי",
    "L02": "https://www.shayarot.co.il/",
    "L03": "https://www.kfarhanokdim.co.il/",
    "L04": "https://beerotayim.co.il/",
    "L05": "https://www.parks.org.il/camping/חניון-לילה-גן-לאומי-חורשת-טל/",
    "L06": "https://www.parks.org.il/camping/חניון-לילה-גן-לאומי-מעיין-חרוד",
    "L07": "https://www.parks.org.il/camping/חניון-לילה-חוות-משמר-הכרמל",
    "L08": "https://www.parks.org.il/camping/חניון-לילה-גן-לאומי-ירקון",
    "A01": "https://www.teva.org.il/", "A02": "https://www.teva.org.il/", "A03": "https://www.teva.org.il/",
    "A04": "https://www.parks.org.il/reserve-park/שמורת-טבע-נחל-תנינים/",
}
DROP = ("sources", "reliability", "checked", "estimated")

# Merge extra datasets (e.g. the south beta from tools/south_data.py), replacing by id.
extra_path = root / "data/extra.json"
if extra_path.exists():
    extra = json.loads(extra_path.read_text())
    for group in ("trails", "lodging"):
        ids = {x["id"] for x in extra.get(group, [])}
        cat[group] = [x for x in cat[group] if x["id"] not in ids] + extra.get(group, [])
SOUTH_LODGING = {"L01": "craters", "L02": "ramon", "L03": "deadsea", "L04": "north_negev"}
for group in ("trails", "lodging", "activities"):
    for p in cat[group]:
        for k in DROP:
            p.pop(k, None)
        ph = photos.get(p["id"]) or p.get("photo")
        if ph:
            p["photo"] = {"url": ph["url"], "credit": f'{ph["artist"]} · {ph["lic"]}', "page": ph["page"]}
        if "area" not in p:
            p["area"] = "south" if p["id"] in SOUTH_LODGING else "center_north"
            if p["id"] in SOUTH_LODGING:
                p["subarea"] = SOUTH_LODGING[p["id"]]
        if group != "trails":
            p["website"] = WEBSITE.get(p["id"], p.get("website"))
(root / "data/catalog.json").write_text(json.dumps(cat, ensure_ascii=False, indent=1))
print("ok", {g: len(cat[g]) for g in ("trails", "lodging", "activities")})
