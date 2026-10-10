"""FLUX.1-schnell-4bit wrapper (MLX via mflux). Loads from the non-gated
pre-quantized community repo. Renders banner backgrounds at 1024x576."""
import logging
import time
from pathlib import Path

log = logging.getLogger("butterfly.flux")

REPO = "mflux-community/flux-1-schnell-mflux-q4"
DEF_W, DEF_H = 1024, 576        # 16:9 banner (measured sweet spot)
TXT2IMG_STEPS = 2               # schnell is distilled; 2 steps is plenty
IMG2IMG_STEPS = 6               # img2img needs more steps to apply the style
IMG2IMG_STRENGTH = 0.4          # lower = more scene/style applied; higher keeps more of the product
OUT_DIR = Path(__file__).parent / "outputs"


class FluxRunner:
    def __init__(self) -> None:
        self._flux = None

    def load(self) -> None:
        t0 = time.time()
        from mflux.models.common.config.model_config import ModelConfig
        from mflux.models.flux.variants.txt2img.flux import Flux1
        self._flux = Flux1(model_config=ModelConfig.schnell(), model_path=REPO)
        log.info("FLUX loaded in %.1fs", time.time() - t0)

    def generate(self, prompt: str, seed: int, width: int = DEF_W, height: int = DEF_H,
                 image_path: str | None = None, image_strength: float | None = None) -> Path:
        OUT_DIR.mkdir(exist_ok=True)
        t0 = time.time()
        kwargs = dict(seed=seed, prompt=prompt, height=height, width=width)
        if image_path:
            kwargs.update(num_inference_steps=IMG2IMG_STEPS, image_path=str(image_path),
                          image_strength=image_strength if image_strength is not None else IMG2IMG_STRENGTH)
        else:
            kwargs.update(num_inference_steps=TXT2IMG_STEPS)
        img = self._flux.generate_image(**kwargs)
        out = OUT_DIR / f"banner_{seed}.png"
        # mflux's save() auto-increments instead of overwriting; remove target first.
        if out.exists():
            out.unlink()
        img.save(path=str(out))
        log.info("FLUX gen seed=%s %dx%d%s in %.1fs -> %s", seed, width, height,
                 " (img2img)" if image_path else "", time.time() - t0, out.name)
        return out

    def unload(self) -> None:
        self._flux = None
