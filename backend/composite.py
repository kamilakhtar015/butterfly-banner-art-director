"""Product compositing: cut the real product out of the uploaded photo, then paste
it onto a FLUX-generated scene with a soft shadow. This keeps the user's ACTUAL
product (logo, label) pixel-exact, unlike img2img."""
import gc
import logging

from PIL import Image, ImageFilter

log = logging.getLogger("butterfly.composite")


def cutout(src_path: str, out_path: str) -> str:
    """Remove the background from the product photo -> RGBA PNG. The rembg session
    (a ~1GB model) is created and released per call so it never sits on the FLUX budget."""
    from rembg import new_session, remove
    session = new_session()
    try:
        img = Image.open(src_path).convert("RGBA")
        result = remove(img, session=session, post_process_mask=True)
        result.save(out_path, "PNG")
    finally:
        del session
        gc.collect()
    return out_path


def _bbox_trim(im: Image.Image) -> Image.Image:
    bbox = im.getchannel("A").getbbox()
    return im.crop(bbox) if bbox else im


def compose(bg_path: str, cutout_path: str, out_path: str,
            anchor: str = "right", scale: float = 0.46) -> str:
    """Paste the trimmed product cutout onto the background, sized to sit IN the scene
    and grounded near the lower third, with a soft drop shadow.
    anchor: 'right' | 'left' | 'center' — which side the product sits (text takes the other)."""
    bg = Image.open(bg_path).convert("RGBA")
    W, H = bg.size
    prod = _bbox_trim(Image.open(cutout_path).convert("RGBA"))

    # Size to a target height, but never wider than ~48% of the banner (keeps it in-scene).
    target_h = int(H * scale)
    ratio = target_h / prod.height
    max_w = int(W * 0.48)
    if int(prod.width * ratio) > max_w:
        ratio = max_w / prod.width
    target_w, target_h = int(prod.width * ratio), int(prod.height * ratio)
    prod = prod.resize((target_w, target_h), Image.LANCZOS)

    # Horizontal anchor (product on one side, copy space on the other).
    cx = int(W * 0.34) if anchor == "left" else (W // 2 if anchor == "center" else int(W * 0.66))
    x = max(0, min(W - target_w, cx - target_w // 2))
    # Ground it: the product's base sits on a surface line in the lower part of the frame.
    base_y = int(H * 0.84)
    y = max(0, min(H - target_h, base_y - target_h))

    # Soft drop shadow from the alpha silhouette.
    alpha = prod.getchannel("A")
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sil = Image.new("RGBA", prod.size, (0, 0, 0, 150))
    sil.putalpha(alpha.point(lambda a: int(a * 0.55)))
    off = max(4, int(H * 0.012))
    shadow.paste(sil, (x + off, y + off), sil)
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(6, int(H * 0.02))))

    out = Image.alpha_composite(bg, shadow)
    out.paste(prod, (x, y), prod)
    out.convert("RGB").save(out_path, "PNG")
    log.info("composited product (%dx%d, anchor=%s) -> %s", target_w, target_h, anchor, out_path)
    return out_path
