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
    "L02": None,  # no official site found — call by phone
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
for group in ("trails", "lodging", "activities"):
    for p in cat[group]:
        for k in DROP:
            p.pop(k, None)
        ph = photos.get(p["id"]) or p.get("photo")
        if ph:
            p["photo"] = {"url": ph["url"], "credit": f'{ph["artist"]} · {ph["lic"]}', "page": ph["page"]}
        if group != "trails":
            p["website"] = WEBSITE.get(p["id"], p.get("website"))
(root / "data/catalog.json").write_text(json.dumps(cat, ensure_ascii=False, indent=1))
print("ok", {g: len(cat[g]) for g in ("trails", "lodging", "activities")})
