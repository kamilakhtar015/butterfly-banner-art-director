"""Smart object segmentation for the PSD export. FastSAM finds every region, then we
keep only the in-focus, meaningfully-sized FOREGROUND objects (blurred-background
patches have low detail and are dropped). Returns named RGBA cutout layers."""
import logging

import numpy as np
from PIL import Image

log = logging.getLogger("butterfly.segment")

MIN_AREA = 0.015   # drop tiny fragments
MAX_AREA = 0.60    # drop near-whole-frame masks
IOU_DEDUP = 0.4    # merge heavily-overlapping masks
SHARP_REL = 0.18   # keep masks at least this fraction as sharp as the sharpest one


def detect_objects(image_path: str, max_objects: int = 6) -> list[tuple[str, np.ndarray]]:
    import cv2
    from ultralytics import FastSAM

    img = Image.open(image_path).convert("RGB")
    W, H = img.size
    arr = np.array(img)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    lap = cv2.Laplacian(gray, cv2.CV_64F)   # edge energy = sharpness proxy

    res = FastSAM("FastSAM-s.pt")(image_path, device="cpu", retina_masks=True,
                                  imgsz=max(W, H), conf=0.4, iou=0.9, verbose=False)
    md = res[0].masks
    if md is None:
        return []

    def to_full(x):
        return np.array(Image.fromarray((x * 255).astype(np.uint8)).resize((W, H))) > 127

    cand = []
    for x in md.data.cpu().numpy():
        mk = to_full(x)
        a = mk.sum() / (W * H)
        if a < MIN_AREA or a > MAX_AREA:
            continue
        sharp = float(lap[mk].var()) if mk.any() else 0.0
        cand.append((mk, a, sharp))
    if not cand:
        return []

    top_sharp = max(c[2] for c in cand) or 1.0
    cand.sort(key=lambda c: c[2], reverse=True)   # sharpest (most in-focus) first

    kept = []
    for mk, a, sharp in cand:
        if sharp < SHARP_REL * top_sharp:          # too blurry -> background patch
            continue
        if any((mk & km).sum() / max((mk | km).sum(), 1) > IOU_DEDUP for km, _ in kept):
            continue
        kept.append((mk, a))
        if len(kept) >= max_objects:
            break

    rgba = np.dstack([arr, np.full((H, W), 255, np.uint8)])
    layers = []
    for i, (mk, a) in enumerate(kept):
        lay = rgba.copy()
        lay[~mk, 3] = 0
        layers.append((f"Object {i + 1}", lay))
    log.info("segmented %d foreground object layers from %s", len(layers), image_path)
    return layers
