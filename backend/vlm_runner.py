"""Qwen2.5-VL-7B-4bit wrapper (MLX via mlx-vlm). One model, three jobs:
survey (text-only), headline (text-only), and image critique (vision)."""
import json
import logging
import re
import time

log = logging.getLogger("butterfly.vlm")

REPO = "mlx-community/Qwen2.5-VL-7B-Instruct-4bit"


class VLMRunner:
    def __init__(self) -> None:
        self._model = None
        self._processor = None
        self._generate = None
        self._apply_template = None

    def load(self) -> None:
        t0 = time.time()
        from mlx_vlm import generate, load
        from mlx_vlm.prompt_utils import apply_chat_template
        self._model, self._processor = load(REPO)
        self._generate = generate
        self._apply_template = apply_chat_template
        log.info("VLM loaded in %.1fs", time.time() - t0)

    def unload(self) -> None:
        self._model = None
        self._processor = None

    # -- core chat ----------------------------------------------------------
    def _chat(self, system: str, user: str, image: str | None = None, max_tokens: int = 512) -> str:
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        n_images = 1 if image else 0
        prompt = self._apply_template(self._processor, self._model.config, messages, num_images=n_images)
        kwargs = {"max_tokens": max_tokens, "verbose": False, "temperature": 0.4}
        if image:
            kwargs["image"] = [image]
        result = self._generate(self._model, self._processor, prompt, **kwargs)
        return result.text if hasattr(result, "text") else str(result)

    # -- JSON helper --------------------------------------------------------
    @staticmethod
    def _parse_json(raw: str) -> dict:
        raw = raw.strip()
        raw = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.MULTILINE).strip()
        start, end = raw.find("{"), raw.rfind("}")
        if start != -1 and end != -1:
            raw = raw[start:end + 1]
        return json.loads(raw)

    # -- jobs ---------------------------------------------------------------
    def next_creative(self, system: str, user: str) -> dict:
        raw = self._chat(system, user, max_tokens=350)
        try:
            return self._parse_json(raw)
        except Exception:
            return {}

    def synth_prompt(self, system: str, user: str) -> str:
        raw = self._chat(system, user, max_tokens=320)
        return raw.strip().strip('"').strip()

    def adcopy(self, system: str, user: str) -> dict:
        raw = self._chat(system, user, max_tokens=160)
        try:
            d = self._parse_json(raw)
        except Exception:
            d = {}
        def clean(v, limit):
            v = str(v or "").strip().strip('"').strip()
            return "" if v.lower() in ("none", "n/a", "null") else v[:limit]
        return {
            "kicker": clean(d.get("kicker"), 24) or "NEW",
            "headline": clean(d.get("headline"), 60) or "Discover More",
            "cta": clean(d.get("cta"), 20) or "Shop Now",
            "brand": clean(d.get("brand"), 40),
            "contact": clean(d.get("contact"), 60),
            "social": clean(d.get("social"), 60),
        }

    def critique(self, system: str, user: str, image: str) -> dict:
        raw = self._chat(system, user, image=image, max_tokens=400)
        return self._parse_json(raw)
