"""ButterFly — Banner Art Director API.

Endpoints:
  POST /generate-survey  -> 3 tailored visual questions for the brief
  POST /generate-banner  -> headline + 2 banner backgrounds, each with a VLM critique
  GET  /status           -> which model is resident + MLX memory
  GET  /outputs/<file>   -> the generated PNGs
"""
import logging
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

import composite
import prompts
from flux_runner import OUT_DIR
from model_manager import manager

UPLOAD_DIR = OUT_DIR / "uploads"
FORMATS = {"1024x576": (1024, 576), "768x768": (768, 768), "576x1024": (576, 1024)}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
log = logging.getLogger("butterfly.api")

app = FastAPI(title="ButterFly — Banner Art Director")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"], allow_headers=["*"],
)

SEEDS = (42, 7)  # 2 images per batch (decided default)
_TEXT_WORDS = ("text", "word", "letter", "typograph", "headline", "caption", "logo", "font")


class Answer(BaseModel):
    id: str = ""
    axis: str = ""
    question: str = ""
    answer: str = ""
    hint: str = ""
    group: str = "visual"   # "visual" (image) | "marketing" (text) | "meta" (settings)


# ---- request models -------------------------------------------------------
class NextQReq(BaseModel):
    brief: str
    answers: list[Answer] = []
    has_image: bool = False
    plan: list[dict] = []   # the per-brief interview plan (generated once, echoed back)


class BannerReq(BaseModel):
    brief: str
    answers: list[Answer] = []
    has_image: bool = False
    product_image: str = ""           # token returned by /upload-product
    img_strength: float | None = None  # img2img strength override (tuning)
    scene: str = ""                   # refine: reuse the already-synthesized scene
    extra_fragments: list[str] = []   # refine: appended suggestion fragments


def _answers(req) -> list[dict]:
    return [a.model_dump() for a in req.answers]


def _dims_from_answers(answers: list[dict]) -> tuple[int, int]:
    for a in answers:
        if a.get("id") == "format":
            return FORMATS.get(a.get("hint", ""), FORMATS["1024x576"])
    return FORMATS["1024x576"]


def _ensure_cutout(token: str) -> str | None:
    """Background-removed product cutout for compositing, cached per upload token."""
    src = UPLOAD_DIR / f"{token}.png"
    if not src.exists():
        return None
    dest = UPLOAD_DIR / f"{token}_cut.png"
    if dest.exists():
        return str(dest)
    try:
        return composite.cutout(str(src), str(dest))
    except Exception as e:
        log.warning("cutout failed: %s", e)
        return None


# ---- endpoints ------------------------------------------------------------
@app.get("/status")
def status():
    return manager.status()


@app.post("/upload-product")
async def upload_product(file: UploadFile = File(...)):
    """Accept a product photo for img2img. Returns a token to pass to /generate-banner."""
    data = await file.read()
    if len(data) > 12 * 1024 * 1024:
        raise HTTPException(400, "image too large (max 12MB)")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex
    dest = UPLOAD_DIR / f"{token}.png"
    try:
        import io
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)   # honor phone photo rotation (EXIF)
        img = img.convert("RGB")
        img.thumbnail((1280, 1280))          # cap size; keep aspect
        img.save(dest, "PNG")
    except Exception as e:
        raise HTTPException(400, f"not a valid image: {e}")
    return {"product_image": token, "url": f"/outputs/uploads/{token}.png"}


_BAD_LABELS = ("other", "something else", "none", "none of these")


@app.post("/next-question")
def next_question(req: NextQReq):
    """Live interview. PHASE 1 (creative): the VLM decides the next creative question each turn,
    reacting to the last answer (and may ask a follow-up), bounded CREATIVE_MIN..MAX with no
    repeats. PHASE 2 (tail): the fixed universal steps (campaign, offer?, format, brand, contact)."""
    if not req.brief.strip():
        raise HTTPException(400, "brief is empty")
    answers = _answers(req)
    cc = prompts.creative_count(answers)
    tail_n = prompts.tail_total(answers)
    asked = len(answers)
    total = prompts.CREATIVE_MAX + tail_n   # upper-bound estimate for the progress dots
    # Once any tail question is answered, the creative phase is over — never re-enter it.
    in_tail = any(a.get("id") in prompts.TAIL_IDS for a in answers)

    covered = {a.get("axis", "").strip().lower() for a in answers if a.get("id") not in prompts.TAIL_IDS}

    def _dup(ax: str) -> bool:
        a = ax.strip().lower()
        return any(c and (a == c or a in c or c in a) for c in covered)

    # ---- PHASE 1: creative (VLM-driven, live) -------------------------------
    if not in_tail and cc < prompts.CREATIVE_MAX:
        sys_p = prompts.next_creative_system_prompt()
        try:
            # Keep asking while core dimensions (product/setting/style) are still uncovered.
            remaining = prompts._remaining_dims(req.has_image, answers)
            with manager.with_vlm() as vlm:
                res = vlm.next_creative(sys_p, prompts.next_creative_user_prompt(req.brief, req.has_image, answers))
                if res.get("done") and remaining:
                    res = vlm.next_creative(sys_p, prompts.next_creative_user_prompt(
                        req.brief, req.has_image, answers, force=True))
                q = res.get("question") if isinstance(res.get("question"), dict) else None
                # If the proposed topic duplicates a covered one, redirect to the next uncovered dimension.
                if q and not res.get("done") and _dup(q.get("axis") or ""):
                    res = vlm.next_creative(sys_p, prompts.next_creative_user_prompt(
                        req.brief, req.has_image, answers, redirect_from=q.get("axis") or ""))
        except Exception as e:
            log.exception("creative step failed")
            raise HTTPException(500, f"interview step failed: {e}")

        q = res.get("question") if isinstance(res.get("question"), dict) else None
        axis = (q or {}).get("axis") or "Creative"
        is_dup = _dup(axis)
        # Show the question unless it's a duplicate AND the core dimensions are already covered
        # (then finish instead of re-asking a covered topic).
        if not res.get("done") and q and not (is_dup and not remaining):
            qid = str(q.get("id", "")).strip().lower().replace(" ", "_") or f"creative_{cc + 1}"
            if qid in prompts.TAIL_IDS:
                qid = f"c_{qid}"
            note = (q.get("note") or "").strip() or _fallback_note(axis, answers)
            base = {"done": False, "asked": asked, "total": total}
            common = {"id": qid, "axis": axis, "group": "visual", "note": note}
            if q.get("type") == "text":
                return {**base, "question": {**common, "type": "text",
                                             "question": q.get("question") or f"Tell me about the {axis.lower()}",
                                             "placeholder": q.get("placeholder", ""), "optional": False}}
            opts = [o for o in (q.get("options") or [])
                    if o.get("label", "").strip().lower().rstrip(".…") not in _BAD_LABELS][:4]
            if opts and not any(o.get("recommend") for o in opts):
                opts[0]["recommend"] = True
            return {**base, "question": {**common, "type": "choice",
                                         "question": q.get("question") or f"Choose the {axis.lower()}",
                                         "options": opts}}
        # creative phase complete -> fall through to the tail

    # ---- PHASE 2: universal tail (fixed) ------------------------------------
    dim = prompts.tail_next(answers)
    total = cc + tail_n   # creative count is final now
    if dim is None:
        return {"done": True, "asked": asked, "total": total}
    base = {"done": False, "asked": asked, "total": total}
    common = {"id": dim["id"], "axis": dim["axis"], "group": dim["group"],
              "note": dim.get("note") or _fallback_note(dim["axis"], answers)}
    if dim["type"] == "text":
        return {**base, "question": {**common, "type": "text", "question": dim["question"],
                                     "placeholder": dim.get("placeholder", ""), "optional": dim.get("optional", False)}}
    return {**base, "question": {**common, "type": "choice", "question": dim["question"],
                                 "options": dim["options"], "no_other": dim.get("no_other", False)}}


def _fallback_note(axis: str, answers: list[dict]) -> str:
    a = axis.lower()
    if answers:
        return f"Good call — now let's lock in the {a}."
    return f"Let's start with the {a} — this sets the whole direction."


class ExportReq(BaseModel):
    model_config = {"populate_by_name": True}
    image: str = ""                 # banner filename, e.g. "banner_42.png"
    copytext: dict = Field(default_factory=dict, alias="copy")
    size: dict = {"w": 1024, "h": 576}
    layout: dict = {}
    product_image: str = ""


@app.post("/export-psd")
def export_psd(req: ExportReq):
    """Build a layered PSD (background + objects/product + per-text-block layers)."""
    import psd_export
    name = Path(req.image).name
    banner = OUT_DIR / name
    if not banner.exists():
        raise HTTPException(404, "banner image not found")
    W, H = int(req.size.get("w", 1024)), int(req.size.get("h", 576))

    product_rgba, segment = None, True
    if req.product_image:
        cut = _ensure_cutout(req.product_image)
        if cut:
            product_rgba = psd_export.product_layer_rgba(W, H, cut)
            segment = product_rgba is None   # exact product layer replaces segmentation
    out = OUT_DIR / f"{banner.stem}.psd"
    try:
        psd_export.build_psd(str(banner), req.copytext or {}, {"w": W, "h": H}, req.layout or {},
                             product_rgba, str(out), segment_objects=segment)
    except Exception as e:
        log.exception("psd export failed")
        raise HTTPException(500, f"export failed: {e}")
    return FileResponse(str(out), media_type="image/vnd.adobe.photoshop", filename=f"banner-{banner.stem}.psd")


@app.post("/generate-banner")
def generate_banner(req: BannerReq):
    answers = _answers(req)
    refine = bool(req.scene.strip())

    # Visual answers shape the image; marketing answers become the banner text; meta (format) is dropped.
    visual = [a for a in answers if a.get("group") == "visual"]
    marketing = [a for a in answers if a.get("group") == "marketing"]
    width, height = _dims_from_answers(answers)
    composite_mode = bool(req.product_image)

    # Composite mode: cut the real product out FIRST (rembg's ~1GB model runs before any
    # MLX model loads, then releases), so it never sits on the FLUX memory budget.
    cutout_path = _ensure_cutout(req.product_image) if composite_mode else None
    if composite_mode and not cutout_path:
        composite_mode = False   # cutout failed; fall back to a plain generated scene

    # 1. Synthesize the scene + ad copy. In composite mode FLUX paints only the empty
    #    backdrop (product pasted on later). On refine, reuse the scene.
    copy = {}
    with manager.with_vlm() as vlm:
        if refine:
            scene = req.scene.strip()
        elif composite_mode:
            scene = vlm.synth_prompt(prompts.SYNTH_BG_SYSTEM, prompts.synth_bg_user_prompt(req.brief, visual))
            copy = vlm.adcopy(prompts.ADCOPY_SYSTEM, prompts.adcopy_user_prompt(req.brief, marketing))
        else:
            scene = vlm.synth_prompt(prompts.SYNTH_SYSTEM, prompts.synth_user_prompt(req.brief, visual))
            copy = vlm.adcopy(prompts.ADCOPY_SYSTEM, prompts.adcopy_user_prompt(req.brief, marketing))

    # Fold in any suggestion fragments from a re-roll (never text-related ones).
    extras = [f for f in req.extra_fragments if f and not any(w in f.lower() for w in _TEXT_WORDS)]
    scene_full = scene + (", " + ", ".join(extras) if extras else "")
    flux_prompt = prompts.build_flux_prompt(scene_full)

    # 2. Banners (FLUX) — manager releases the VLM first. In composite mode FLUX renders
    #    the empty backdrop, then we paste the real product onto it (PIL, in-process).
    with manager.with_flux() as flux:
        paths = []
        for s in SEEDS:
            p = flux.generate(flux_prompt, seed=s, width=width, height=height)
            if composite_mode:
                composite.compose(str(p), cutout_path, str(p), anchor="right")
            paths.append(p)

    # 3. Critique each (swap back to VLM).
    images = []
    with manager.with_vlm() as vlm:
        for p in paths:
            try:
                crit = vlm.critique(prompts.CRITIQUE_SYSTEM, prompts.CRITIQUE_USER, str(p))
            except Exception as e:
                log.warning("critique failed for %s: %s", p.name, e)
                crit = None
            images.append({"url": f"/outputs/{p.name}", "seed": _seed_of(p), "critique": crit})

    return {"copy": copy, "prompt": flux_prompt, "scene": scene,
            "size": {"w": width, "h": height}, "images": images}


def _seed_of(path):
    try:
        return int(path.stem.split("_")[-1])
    except Exception:
        return None


# Serve generated PNGs and the static UI (mounted last so API routes take precedence).
from pathlib import Path as _Path

OUT_DIR.mkdir(exist_ok=True)
app.mount("/outputs", StaticFiles(directory=str(OUT_DIR)), name="outputs")
# Serve the Next.js static export (built to frontend/out); fall back to the legacy static dir.
_UI_DIR = _Path(__file__).parent.parent / "frontend" / "out"
if not _UI_DIR.exists():
    _UI_DIR = _Path(__file__).parent / "static"
app.mount("/", StaticFiles(directory=str(_UI_DIR), html=True), name="ui")
