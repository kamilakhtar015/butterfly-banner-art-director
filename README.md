# 🦋 ButterFly — Banner Art Director

A **fully-local** AI "art director" that turns a few words (and optionally a product photo) into professional **marketing / advertising banners** — no cloud, no API keys.

It interviews you like a real art director (adaptive questions, reacts to your answers, has opinions), writes the ad copy, generates the image on-device, lets you **drag-edit** the result, and exports a **layered Photoshop `.psd`**.

## How it works

1. **Interview** — a vision LLM (Qwen2.5-VL) asks tailored creative + marketing questions, one at a time, adapting to your answers.
2. **Image** — the answers are synthesized into a rich prompt and rendered **on-device with FLUX.1-schnell**. Upload a product photo and it's cut out (rembg) and composited into a generated scene so your *actual* product appears.
3. **Text** — the headline/kicker/CTA/brand/contact are overlaid as crisp editable HTML/CSS (never drawn by the image model), auto-placed per image.
4. **Edit** — drag/resize/recolor any text element on the banner.
5. **Export** — download a layered `.psd` (background + detected objects + product + per-text-block layers).

The two models never fit in memory together, so they're **swapped sequentially** — see `.claude` notes / `backend/model_manager.py`.

## Requirements

- **Apple Silicon Mac** (M-series), **16 GB RAM minimum** (this is tight — FLUX peaks ~14 GB).
- **~15 GB free disk** for models (downloaded automatically on first run).
- **Python 3.12** and **Node 18+** (setup below installs both locally if you don't have them).

> ⚠️ Models (~14 GB total) download on first use: FLUX.1-schnell q4 (~9 GB), Qwen2.5-VL-7B 4-bit (~4.5 GB), rembg (~1 GB), FastSAM (~23 MB). First run is slow; they're cached afterwards.

## Setup

### 1. Backend (Python + MLX)

Uses [`uv`](https://docs.astral.sh/uv/) to manage Python. Install it if needed:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Create the environment and install dependencies:

```bash
cd backend
uv venv --python 3.12 ../.venv
uv pip install --python ../.venv/bin/python -r requirements.txt
```

### 2. Frontend (Next.js → static build)

Needs Node 18+. If you don't have it, grab the official build (no admin needed):

```bash
# optional, if `node` is missing:
curl -sL https://nodejs.org/dist/v22.11.0/node-v22.11.0-darwin-arm64.tar.xz | tar -xJ -C "$HOME/.local/node" --strip-components=1
export PATH="$HOME/.local/node/bin:$PATH"
```

Build the UI to static files (served by the backend, zero extra memory):

```bash
cd frontend
npm install
npm run build        # outputs to frontend/out/
```

### 3. Run

```bash
cd backend
../.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000** — the FastAPI server serves the built UI and the API.

## Development

Run the frontend with hot reload (talks to the backend on :8000):

```bash
cd frontend && npm run dev     # http://localhost:3000
```

After any frontend change, `npm run build` to regenerate what the backend serves at :8000.

## Project layout

```
backend/
  main.py            FastAPI app + endpoints (interview, generate, export, upload)
  model_manager.py   sequential FLUX <-> VLM swap manager (the 16 GB constraint)
  flux_runner.py     FLUX.1-schnell image generation (mflux)
  vlm_runner.py      Qwen2.5-VL interview / copy / critique
  prompts.py         the "art director" brain (adaptive interview, synthesis, copy)
  composite.py       product cutout + scene compositing (rembg + PIL)
  segment.py         object segmentation for PSD layers (FastSAM)
  psd_export.py      layered .psd builder (pytoshop)
  fonts_ttf/         fonts used for rasterizing PSD text
  static/            legacy vanilla UI (fallback; the Next build is primary)
frontend/
  app/page.jsx       the whole React app (interview + canvas editor + export)
  app/globals.css    styles
  public/fonts/      web fonts for the overlay
```

## Notes

- **100% local** — nothing leaves your machine; no API keys.
- Default banner formats: 16:9 `1024×576`, square `768×768`, story `576×1024`.
- The image model (FLUX) and vision model (Qwen-VL) are loaded one at a time; a request may pause ~1–2 s while they swap.
