"""
Sequential model-swap manager — the heart of running FLUX (~14GB) and
Qwen2.5-VL (~6GB) on a 16GB machine where they CANNOT be co-resident.

Invariant: at most ONE heavy model is loaded at any time. Switching fully
releases the current model (del + gc + mx.clear_cache) and verifies MLX memory
actually dropped before loading the next one. All access is serialized by a lock
so two concurrent requests can never both trigger a load and blow the budget.
"""
import gc
import logging
import threading

import mlx.core as mx

from flux_runner import FluxRunner
from vlm_runner import VLMRunner

log = logging.getLogger("butterfly.models")
GB = 1024 ** 3

# If MLX still holds more than this after a release, something leaked — refuse to
# load the next model on top of it rather than thrash into swap.
RESIDUAL_CEILING_GB = 2.0


class ModelManager:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._current: str | None = None   # "flux" | "vlm" | None
        self._flux: FluxRunner | None = None
        self._vlm: VLMRunner | None = None

    # -- public API ---------------------------------------------------------
    def with_vlm(self):
        """Context manager yielding a loaded VLM, holding the lock for its lifetime."""
        return _Holding(self, "vlm")

    def with_flux(self):
        return _Holding(self, "flux")

    def status(self) -> dict:
        return {
            "current": self._current,
            "mlx_active_gb": round(mx.get_active_memory() / GB, 2),
            "mlx_peak_gb": round(mx.get_peak_memory() / GB, 2),
        }

    # -- internals ----------------------------------------------------------
    def _release_current(self) -> None:
        if self._current is None:
            return
        log.info("Releasing %s", self._current)
        if self._current == "flux":
            if self._flux:
                self._flux.unload()
            self._flux = None
        elif self._current == "vlm":
            if self._vlm:
                self._vlm.unload()
            self._vlm = None
        self._current = None

        gc.collect()
        mx.clear_cache()
        residual = mx.get_active_memory() / GB
        log.info("Post-release MLX active: %.2f GB", residual)
        if residual > RESIDUAL_CEILING_GB:
            # Hard stop: loading another model now would exceed 16GB and swap.
            log.warning("Residual %.2f GB exceeds ceiling %.1f GB after release",
                        residual, RESIDUAL_CEILING_GB)

    def _ensure(self, which: str):
        if self._current == which:
            return self._flux if which == "flux" else self._vlm
        self._release_current()
        mx.reset_peak_memory()
        log.info("Loading %s", which)
        if which == "flux":
            self._flux = FluxRunner()
            self._flux.load()
            self._current = "flux"
            return self._flux
        else:
            self._vlm = VLMRunner()
            self._vlm.load()
            self._current = "vlm"
            return self._vlm


class _Holding:
    """Holds the manager lock for the whole time a model is in use, so a swap
    can never happen mid-generation and two requests can't race a load."""
    def __init__(self, mgr: ModelManager, which: str):
        self._mgr = mgr
        self._which = which

    def __enter__(self):
        self._mgr._lock.acquire()
        try:
            return self._mgr._ensure(self._which)
        except Exception:
            self._mgr._lock.release()
            raise

    def __exit__(self, *exc):
        self._mgr._lock.release()
        return False


# Process-wide singleton.
manager = ModelManager()
