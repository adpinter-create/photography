#!/usr/bin/env python3
"""Build the site's data.json and image sizes from the caption tool's export.

  python3 tools/build.py --src ~/Website/andreipinter-site

--src is the folder caption_photos.py writes: photos.json plus 2048px web copies that already carry no metadata.
This script groups photos by US state (or country outside the US), gives each photo a short stable id, writes
three sizes (img/lg 2048, img/md 1280, img/sm 640), samples a colour per photo and an accent per place, and
writes data.json. Every image is checked for EXIF/XMP before the build finishes.
"""
import argparse, colorsys, hashlib, json, re, shutil, sys
from datetime import date
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SIZES = {"md": (1280, 82), "sm": (640, 78)}


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def region_of(place):
    if not place:
        return None, None
    parts = [p.strip() for p in place.split(",")]
    if parts[-1] == "D.C.":
        return "Washington, D.C.", None
    region = parts[-1]
    city = ", ".join(parts[:-1]) or None
    return region, city


def clean_save(im, dest, size, quality):
    im = im.copy()
    im.thumbnail((size, size), Image.LANCZOS)
    icc = im.info.get("icc_profile")
    kw = {"quality": quality, "optimize": True, "progressive": True}
    if icc:
        kw["icc_profile"] = icc
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "JPEG", **kw)


def assert_clean(path):
    data = path.read_bytes()
    if b"Exif\x00\x00" in data or b"<x:xmpmeta" in data or b"http://ns.adobe.com/xap" in data:
        sys.exit(f"metadata found in {path}")


def hexcolor(rgb):
    return "#%02x%02x%02x" % tuple(int(v) for v in rgb)


def accent_from(im):
    """The most characterful colour in a photo, lifted so it reads on black."""
    small = im.convert("RGB").resize((160, 160 * im.height // max(1, im.width)) if im.width >= im.height else (160 * im.width // max(1, im.height), 160))
    pal = small.quantize(colors=12, method=Image.Quantize.MEDIANCUT)
    counts = sorted(pal.getcolors(), reverse=True)
    palette = pal.getpalette()
    total = sum(c for c, _ in counts)
    best, score = (200, 200, 200), -1
    for c, idx in counts:
        r, g, b = palette[idx * 3: idx * 3 + 3]
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if l < 0.12 or l > 0.92:
            continue
        sc = s * (c / total) ** 0.5 * (1 - abs(l - 0.55))
        if sc > score:
            best, score = (h, l, s), sc
    if score < 0:
        return "#d9d6cf"
    h, l, s = best
    l = max(l, 0.68)
    s = min(max(s, 0.45), 0.85)
    return hexcolor(v * 255 for v in colorsys.hls_to_rgb(h, l, s))


def impact(path, landmark, pixels):
    """A rough 'stops you scrolling' score used to open each place with its strongest frames:
    colourfulness (Hasler and Suesstrunk) and tonal contrast, a nudge for named landmarks,
    and a penalty for small, low-resolution copies."""
    a = np.asarray(Image.open(path).convert("RGB").resize((256, 170)), dtype=np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    rg, yb = r - g, 0.5 * (r + g) - b
    colour = np.sqrt(rg.std() ** 2 + yb.std() ** 2) + 0.3 * np.sqrt(rg.mean() ** 2 + yb.mean() ** 2)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    score = 0.6 * colour / 100 + 0.4 * lum.std() / 70
    if landmark:
        score += 0.15
    if pixels < 1_000_000:
        score -= 0.25
    return round(float(score), 4)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True, help="caption_photos.py output folder (photos.json + img/)")
    ap.add_argument("--out", default=str(ROOT))
    a = ap.parse_args()
    src, out = Path(a.src).expanduser(), Path(a.out)
    cfg = json.loads((ROOT / "tools" / "places.json").read_text())
    photos = json.loads((src / "photos.json").read_text())["photos"]

    items, by_region = [], {}
    for p in photos:
        region, city = region_of(p.get("place"))
        if not region:
            region = "Elsewhere"
        pid = hashlib.sha1(p["id"].encode()).hexdigest()[:8]
        lg = out / "img" / "lg" / f"{pid}.jpg"
        srcfile = src / p["src"]
        if not lg.exists() or lg.stat().st_size != srcfile.stat().st_size:
            lg.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(srcfile, lg)
        im = None
        for name, (size, q) in SIZES.items():
            dest = out / "img" / name / f"{pid}.jpg"
            if not dest.exists() or dest.stat().st_mtime < lg.stat().st_mtime:
                im = im or Image.open(lg)
                clean_save(im, dest, size, q)
        for name in ("lg", *SIZES):
            assert_clean(out / "img" / name / f"{pid}.jpg")
        sm = Image.open(out / "img" / "sm" / f"{pid}.jpg").convert("RGB")
        avg = sm.resize((1, 1), Image.BOX).getpixel((0, 0))
        item = {"id": pid, "src_id": p["id"], "region": region, "city": city,
                "landmark": p.get("landmark"), "title": p.get("title"), "date": p.get("date"), "taken": p.get("taken"),
                "camera": p.get("camera"), "lens": p.get("lens"), "exposure": p.get("exposure"),
                "w": p["w"], "h": p["h"], "c": hexcolor(avg),
                "_score": impact(out / "img" / "sm" / f"{pid}.jpg", p.get("landmark"), p["w"] * p["h"])}
        items.append(item)
        by_region.setdefault(region, []).append(item)

    places = []
    for region, group in by_region.items():
        c = cfg.get(region, {})
        cover = next((i for i in group if i["src_id"] == c.get("cover")), None)
        if not cover:
            cover = max(group, key=lambda i: i["w"] / i["h"])          # widest frame as a fallback
            print(f"note: no cover set for {region}; using {cover['src_id']}")
        years = sorted({i["taken"][:4] for i in group if i.get("taken")})
        cities = {}
        for i in group:
            if i["city"]:
                cities[i["city"]] = cities.get(i["city"], 0) + 1
        accent = accent_from(Image.open(out / "img" / "md" / f"{cover['id']}.jpg"))
        places.append({"slug": slugify(region), "name": region, "kind": c.get("kind", "place"), "count": len(group),
                       "years": [years[0], years[-1]] if years else [], "cover": cover["id"], "accent": accent,
                       "city": c.get("city"), "coords": c.get("coords"),
                       "cities": sorted(cities.items(), key=lambda x: (-x[1], x[0]))})
    places.sort(key=lambda p: (-p["count"], p["name"]))
    order = {p["name"]: k for k, p in enumerate(places)}
    for i in items:
        i["p"] = slugify(i.pop("region"))
        i.pop("src_id")
    # each place opens with its cover, then its strongest frames; "All photographs" re-sorts by date in the browser
    slug_order = {p["slug"]: k for k, p in enumerate(places)}
    covers = {p["cover"] for p in places}
    items.sort(key=lambda i: (slug_order[i["p"]], i["id"] not in covers, -i["_score"], i["id"]))
    for i in items:
        i.pop("_score")
    for i in items:
        for k in [k for k, v in i.items() if v in (None, "")]:
            del i[k]
    data = {"generated": date.today().isoformat(), "places": places, "photos": items}
    (out / "data.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # social preview uses the first place's cover
    idx = out / "index.html"
    if idx.exists():
        html = idx.read_text(encoding="utf-8")
        idx.write_text(re.sub(r'(property="og:image" content=")img/lg/[^"]+(")', rf'\g<1>img/lg/{places[0]["cover"]}.jpg\2', html), encoding="utf-8")

    # drop images no longer referenced
    keep = {i["id"] for i in items}
    removed = 0
    for name in ("lg", *SIZES):
        for f in (out / "img" / name).glob("*.jpg"):
            if f.stem not in keep:
                f.unlink(); removed += 1
    print(f"{len(items)} photos in {len(places)} places -> data.json ({removed} stale images removed)")
    for p in places:
        print(f"  {p['name']}: {p['count']}  accent {p['accent']}  {'-'.join(p['years'])}")


if __name__ == "__main__":
    main()
