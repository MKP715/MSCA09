# Draws the link-preview pictures (1200x630) — what chat apps and social sites show when someone
# shares a link to the site: src/assets/img/social-card.jpg for the English pages and
# src/assets/img/social-card-es.jpg (Spanish logo and words) for the Spanish pages.
#
# The deploy workflow runs it before every build, so the pictures always show the panel
# and years in data/settings.csv (no hand work after a panel rotation). To run it yourself:
#
#   pip install pillow
#   python scripts/build-social-card.py                         (writes both pictures in src/assets/img/)
#   python scripts/build-social-card.py out.jpg [out-es.jpg]    (writes somewhere else; the Spanish one
#                                                                defaults to out-es.jpg)
#
# Fonts: the site's own Outfit and Inter (node_modules/@fontsource-variable, installed by
# `npm ci`), so it looks the same on Windows, macOS and the Linux build machine.
# Words: data/text/common.csv, the site.card_* rows and header.panel ("Panel {panel} · {years}"),
# in English and Spanish (an empty Spanish cell shows the English, as on the site).
# Photo and credit: data/hero.csv (the Heisler Park row when present, else the first row).
# Logo: src/assets/img/logo/logo-en-512.png and logo-es-512.png.
import csv
import os
import sys
from urllib.parse import urlparse

from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_EN = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "src", "assets", "img", "social-card.jpg")
OUT_ES = sys.argv[2] if len(sys.argv) > 2 else "-es".join(os.path.splitext(OUT_EN))
W, H = 1200, 630
S = 2  # supersample for crisp text and edges
FONTS = {
    "outfit": os.path.join(REPO, "node_modules", "@fontsource-variable", "outfit", "files", "outfit-latin-wght-normal.woff2"),
    "inter": os.path.join(REPO, "node_modules", "@fontsource-variable", "inter", "files", "inter-latin-wght-normal.woff2"),
}


def font(family, size, weight):
    f = ImageFont.truetype(FONTS[family], size * S)
    try:
        f.set_variation_by_axes([weight])
    except Exception:  # a font build without variations: keep its default weight
        pass
    return f


def read_csv(name):
    with open(os.path.join(REPO, "data", name), encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))
    return [r for r in rows if r and not str(next(iter(r.values()), "") or "").startswith("#")]


settings = {r["key"]: (r.get("value") or "") for r in read_csv("settings.csv") if r.get("key")}
texts = {r["key"]: r for r in read_csv(os.path.join("text", "common.csv")) if r.get("key")}
heroes = read_csv("hero.csv")
hero = next((r for r in heroes if r.get("file") == "laguna-heisler-park.jpg"), heroes[0] if heroes else None)
photo_file = os.path.join(REPO, "src", "assets", "img", "hero", hero["file"] if hero else "laguna-heisler-park.jpg")
domain = urlparse(settings.get("site_url") or "https://msca09aa.org").netloc or "msca09aa.org"
# the placeholders every text can use, as on the site (src/_lib/i18n.js)
FILL = {"panel": settings.get("panel", ""), "years": settings.get("panel_years", ""), "previous_panel": settings.get("previous_panel", "")}


def text(key, lang):
    """A row of data/text/common.csv in a language (the English when the Spanish cell is empty)."""
    row = texts.get(key) or {}
    value = (row.get(lang) or "").strip() or (row.get("en") or "").strip()
    if not value:
        raise SystemExit(f"data/text/common.csv: no text for {key}")
    for k, v in FILL.items():
        value = value.replace("{" + k + "}", v)
    return value


def draw(lang, out_file):
    # --- photo, cropped to 1200x630 around the point (56%, 45%)
    photo = Image.open(photo_file).convert("RGB")
    pw, ph = photo.size
    scale = max(W * S / pw, H * S / ph) * 1.04
    photo = photo.resize((int(pw * scale), int(ph * scale)), Image.LANCZOS)
    pw, ph = photo.size
    fx, fy = 0.56, 0.45
    left = int(min(max(0, fx * pw - W * S / 2), pw - W * S))
    top = int(min(max(0, fy * ph - H * S / 2), ph - H * S))
    img = photo.crop((left, top, left + W * S, top + H * S)).convert("RGBA")

    # --- navy scrim: strong on the left (text), lighter on the right
    scrim = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(scrim)
    for x in range(img.size[0]):
        t = x / img.size[0]
        a = 0.86 if t < 0.45 else 0.86 - (t - 0.45) / 0.55 * 0.6
        sd.line([(x, 0), (x, img.size[1])], fill=(8, 20, 45, int(255 * a)))
    img = Image.alpha_composite(img, scrim)
    # soft violet / ocean glows (the logo ring colours)
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-260 * S, 330 * S, 520 * S, 900 * S], fill=(107, 91, 168, 120))
    gd.ellipse([760 * S, -320 * S, 1500 * S, 260 * S], fill=(46, 163, 221, 70))
    glow = glow.filter(ImageFilter.GaussianBlur(90 * S))
    img = Image.alpha_composite(img, glow)

    # --- logo (in the card's language) with a soft white halo
    logo = Image.open(os.path.join(REPO, "src", "assets", "img", "logo", f"logo-{lang}-512.png")).convert("RGBA")
    LS = 330 * S
    logo = logo.resize((LS, LS), Image.LANCZOS)
    lx, ly = 64 * S, (H * S - LS) // 2
    halo = Image.new("RGBA", img.size, (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    pad = 26 * S
    hd.ellipse([lx - pad, ly - pad, lx + LS + pad, ly + LS + pad], fill=(255, 255, 255, 70))
    halo = halo.filter(ImageFilter.GaussianBlur(22 * S))
    img = Image.alpha_composite(img, halo)
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    shd = ImageDraw.Draw(shadow)
    shd.ellipse([lx + 10 * S, ly + 22 * S, lx + LS + 10 * S, ly + LS + 22 * S], fill=(0, 0, 0, 120))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18 * S))
    img = Image.alpha_composite(img, shadow)
    img.alpha_composite(logo, (lx, ly))

    # --- words
    d = ImageDraw.Draw(img)
    tx = 444 * S
    max_w = W * S - tx - 36 * S  # room right of the logo

    def fitted(family, size, weight, words):
        # the line's font, a little smaller when a longer wording would run off the picture
        f = font(family, size, weight)
        while size > 12 and d.textlength(words, font=f) > max_w:
            size -= 1
            f = font(family, size, weight)
        return f

    pill_font = font("inter", 22, 600)
    pill_text = text("header.panel", lang).strip(" ·")
    pb = d.textbbox((0, 0), pill_text, font=pill_font)
    pw_, ph_ = pb[2] - pb[0], pb[3] - pb[1]
    py = 150 * S
    pill = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(pill).rounded_rectangle([tx, py, tx + pw_ + 44 * S, py + ph_ + 26 * S], radius=40 * S, fill=(255, 255, 255, 40), outline=(255, 255, 255, 100), width=2 * S)
    img.alpha_composite(pill)
    d = ImageDraw.Draw(img)
    d.ellipse([tx + 16 * S, py + (ph_ + 26 * S) // 2 - 5 * S, tx + 26 * S, py + (ph_ + 26 * S) // 2 + 5 * S], fill=(252, 211, 77, 255))
    d.text((tx + 34 * S, py + 13 * S - pb[1]), pill_text, font=pill_font, fill=(255, 255, 255, 255))

    def shadowed(xy, words, f, fill):
        sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).text((xy[0], xy[1] + 3 * S), words, font=f, fill=(0, 0, 0, 150))
        sh = sh.filter(ImageFilter.GaussianBlur(6 * S))
        img.alpha_composite(sh)
        ImageDraw.Draw(img).text(xy, words, font=f, fill=fill)

    line1 = text("site.card_line1", lang)
    shadowed((tx, 208 * S), line1, fitted("outfit", 60, 800, line1), (255, 255, 255, 255))
    # "Area 09" with a sunset gradient
    area = text("site.card_area", lang)
    area_font = fitted("outfit", 80, 900, area)
    ab = ImageDraw.Draw(img).textbbox((0, 0), area, font=area_font)
    aw, ah = ab[2] + 10 * S, ab[3] + 10 * S
    mask = Image.new("L", (aw, ah), 0)
    ImageDraw.Draw(mask).text((0, 0), area, font=area_font, fill=255)
    grad = Image.new("RGBA", (aw, ah))
    stops = [(252, 211, 77), (251, 146, 120), (244, 143, 177), (125, 211, 252)]
    for x in range(aw):
        t = x / max(1, aw - 1) * (len(stops) - 1)
        i = min(int(t), len(stops) - 2)
        f = t - i
        c = tuple(int(stops[i][k] * (1 - f) + stops[i + 1][k] * f) for k in range(3))
        ImageDraw.Draw(grad).line([(x, 0), (x, ah)], fill=c + (255,))
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sh.paste(Image.new("RGBA", (aw, ah), (0, 0, 0, 150)), (tx, 280 * S + 3 * S), mask)
    sh = sh.filter(ImageFilter.GaussianBlur(6 * S))
    img.alpha_composite(sh)
    img.paste(grad, (tx, 280 * S), mask)

    org = text("site.card_org", lang)
    shadowed((tx, 392 * S), org, fitted("outfit", 36, 600, org), (255, 255, 255, 240))
    places = text("site.card_places", lang)
    shadowed((tx, 450 * S), places, fitted("inter", 21, 500, places), (226, 232, 240, 255))
    langs = f"{text('site.card_langs', lang)}   ·   {domain}"
    shadowed((tx, 482 * S), langs, fitted("inter", 21, 500, langs), (226, 232, 240, 255))

    # --- colour strip along the bottom (logo ring + triangle + people colours)
    strip_h = 10 * S
    cols = [(46, 163, 221), (107, 91, 168), (237, 28, 36), (245, 179, 66), (120, 170, 110), (232, 121, 160), (46, 163, 221)]
    for x in range(W * S):
        t = x / (W * S - 1) * (len(cols) - 1)
        i = min(int(t), len(cols) - 2)
        f = t - i
        c = tuple(int(cols[i][k] * (1 - f) + cols[i + 1][k] * f) for k in range(3))
        ImageDraw.Draw(img).line([(x, H * S - strip_h), (x, H * S)], fill=c + (255,))

    credit_text = (hero or {}).get(f"credit_{lang}") or (hero or {}).get("credit_en") or ""
    if credit_text:
        credit = font("inter", 13, 400)
        cb = ImageDraw.Draw(img).textbbox((0, 0), credit_text, font=credit)
        ImageDraw.Draw(img).text((W * S - cb[2] - 18 * S, H * S - strip_h - cb[3] - 10 * S), credit_text, font=credit, fill=(255, 255, 255, 170))

    out = img.convert("RGB").resize((W, H), Image.LANCZOS)
    out.save(out_file, quality=86, optimize=True, progressive=True)
    print("saved", out_file, out.size, "·", pill_text)


draw("en", OUT_EN)
draw("es", OUT_ES)
