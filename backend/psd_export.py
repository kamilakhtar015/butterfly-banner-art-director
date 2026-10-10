"""Assemble a layered PSD: Background + detected foreground objects + the uploaded
product (when present) + one layer per text block (brand/kicker/headline/CTA/contact).
Text is rendered with the real fonts as separate raster layers (movable/editable as
layers; retype for new wording). Opens in Photoshop / Affinity / Photopea / GIMP."""
import logging
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pytoshop import enums
from pytoshop.user import nested_layers

import segment

log = logging.getLogger("butterfly.psd")
FONT_DIR = Path(__file__).parent / "fonts_ttf"


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_DIR / name), max(8, int(size)))


def _layer(name: str, rgba: np.ndarray):
    """Crop the layer to its opaque bounding box (proper PSD layer bounds) so transparent
    regions don't bleed. Returns None if the layer is fully transparent."""
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > 0)
    if len(xs) == 0:
        return None
    top, left, bottom, right = int(ys.min()), int(xs.min()), int(ys.max()) + 1, int(xs.max()) + 1
    c = rgba[top:bottom, left:right]
    ch = {-1: c[:, :, 3], 0: c[:, :, 0], 1: c[:, :, 1], 2: c[:, :, 2]}
    return nested_layers.Image(name=name, visible=True, opacity=255, channels=ch,
                               top=top, left=left, bottom=bottom, right=right,
                               color_mode=enums.ColorMode.rgb)


def _blank(W: int, H: int) -> Image.Image:
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def _hex(s: str, default=(255, 122, 89)):
    try:
        s = s.lstrip("#")
        return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))
    except Exception:
        return default


def _wrap(draw, text, font, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= max_w or not cur:
            cur = t
        else:
            lines.append(cur); cur = w
    if cur:
        lines.append(cur)
    return lines


def _text_layers(copy: dict, W: int, H: int, layout: dict) -> list[tuple[str, np.ndarray]]:
    """One transparent, full-frame RGBA layer per text element, positioned like the overlay."""
    place = (layout.get("placement") or "left").lower()
    dark = (layout.get("theme") or "light").lower() == "dark"
    accent = _hex(layout.get("accent") or "")
    ink = (20, 20, 20) if dark else (255, 255, 255)
    right = "right" in place
    x = int(W * (0.60 if right else 0.07))
    anchor_r = right
    layers = []

    def emit(name, render):
        img = _blank(W, H)
        render(ImageDraw.Draw(img), img)
        a = np.array(img)
        if a[:, :, 3].any():
            layers.append((name, a))

    # Vertical stack centred on the frame middle.
    f_brand = _font("ArchivoBlack.ttf", H * 0.035)
    f_kick = _font("ArchivoBlack.ttf", H * 0.028)
    f_head = _font("Anton.ttf", H * 0.11)
    f_cta = _font("ArchivoBlack.ttf", H * 0.032)
    f_con = _font("ArchivoBlack.ttf", H * 0.022)

    tmp = ImageDraw.Draw(_blank(W, H))
    head_lines = _wrap(tmp, (copy.get("headline") or "").upper(), f_head, int(W * 0.52))
    line_h = int(H * 0.11 * 1.0)
    block_h = int(H * 0.045) + int(H * 0.05) + len(head_lines) * line_h + int(H * 0.06)
    y = max(int(H * 0.08), (H - block_h) // 2)

    def tx(draw, s, font):
        if anchor_r:
            w = draw.textlength(s, font=font)
            return int(x + (W * 0.33) - w)
        return x

    if copy.get("brand"):
        yy = y
        emit("Brand", lambda d, i, s=copy["brand"], f=f_brand, yy=yy:
             d.text((tx(d, s, f), yy), s, font=f, fill=ink + (255,)))
        y += int(H * 0.05)

    if copy.get("kicker"):
        s = copy["kicker"].upper()
        yy = y
        def rk(d, i, s=s, f=f_kick, yy=yy):
            tw = d.textlength(s, font=f); pad = int(H * 0.012)
            bx = tx(d, s, f)
            d.rounded_rectangle([bx - pad, yy - pad, bx + tw + pad, yy + f.size + pad],
                                radius=int(H * 0.012), fill=accent + (255,))
            d.text((bx, yy), s, font=f, fill=(255, 255, 255, 255))
        emit("Kicker", rk)
        y += int(H * 0.055)

    for ln in head_lines:
        yy = y
        emit("Headline" if ln == head_lines[0] else f"Headline (cont.)",
             lambda d, i, s=ln, f=f_head, yy=yy: d.text((tx(d, s, f), yy), s, font=f, fill=ink + (255,)))
        y += line_h

    y += int(H * 0.015)
    if copy.get("cta"):
        s = copy["cta"]
        yy = y
        def rc(d, i, s=s, f=f_cta, yy=yy):
            tw = d.textlength(s, font=f); padx, pady = int(H * 0.03), int(H * 0.018)
            bx = tx(d, s, f)
            fill = (20, 20, 20, 255) if not dark else (255, 255, 255, 255)
            tcol = (255, 255, 255, 255) if not dark else (20, 20, 20, 255)
            d.rounded_rectangle([bx - padx, yy - pady, bx + tw + padx, yy + f.size + pady],
                                radius=int((f.size + 2 * pady) / 2), fill=fill)
            d.text((bx, yy), s, font=f, fill=tcol)
        emit("CTA", rc)
        y += int(H * 0.08)

    contact = "   ".join(filter(None, [copy.get("contact"), copy.get("social")]))
    if contact:
        yy = y
        emit("Contact", lambda d, i, s=contact, f=f_con, yy=yy:
             d.text((tx(d, s, f), yy), s, font=f, fill=ink + (255,)))
    return layers


def product_layer_rgba(W: int, H: int, cutout_path: str,
                        anchor: str = "right", scale: float = 0.46) -> np.ndarray | None:
    """Full-frame RGBA with the uploaded product placed exactly as composite.compose does,
    so it becomes a pixel-perfect 'Product' layer in the PSD."""
    try:
        from PIL import ImageOps
        prod = Image.open(cutout_path).convert("RGBA")
        bbox = prod.getchannel("A").getbbox()
        if bbox:
            prod = prod.crop(bbox)
        target_h = int(H * scale)
        ratio = target_h / prod.height
        if int(prod.width * ratio) > int(W * 0.48):
            ratio = int(W * 0.48) / prod.width
        tw, th = int(prod.width * ratio), int(prod.height * ratio)
        prod = prod.resize((tw, th), Image.LANCZOS)
        cx = int(W * 0.34) if anchor == "left" else (W // 2 if anchor == "center" else int(W * 0.66))
        x = max(0, min(W - tw, cx - tw // 2))
        y = max(0, min(H - th, int(H * 0.84) - th))
        canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        canvas.paste(prod, (x, y), prod)
        return np.array(canvas)
    except Exception as e:
        log.warning("product layer failed: %s", e)
        return None


def build_psd(banner_path: str, copy: dict, size: dict, layout: dict,
              product_rgba: np.ndarray | None, out_path: str, segment_objects: bool = True) -> str:
    W, H = int(size.get("w", 1024)), int(size.get("h", 576))
    bg = np.array(Image.open(banner_path).convert("RGB").resize((W, H)))
    bg_rgba = np.dstack([bg, np.full((H, W), 255, np.uint8)])

    objects = []
    if segment_objects:
        try:
            objects = segment.detect_objects(banner_path, max_objects=6)
        except Exception as e:
            log.warning("segmentation failed, skipping object layers: %s", e)

    text = _text_layers(copy, W, H, layout or {})

    # Top-to-bottom: text, product, detected objects, background.
    ordered = list(text)
    if product_rgba is not None:
        ordered.append(("Product", product_rgba))
    ordered += objects
    ordered.append(("Background", bg_rgba))

    imgs = [lyr for n, r in ordered if (lyr := _layer(n, r)) is not None]
    psd = nested_layers.nested_layers_to_psd(imgs, color_mode=enums.ColorMode.rgb,
                                             compression=enums.Compression.raw)
    with open(out_path, "wb") as f:
        psd.write(f)
    log.info("wrote PSD with %d layers -> %s", len(imgs), out_path)
    return out_path
