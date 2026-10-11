"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { apiBase, post } from "../lib/api";

const EXAMPLES = ["artisan cold brew launch", "summer sneaker drop", "handmade ceramic mugs",
  "fall boot sale for a rugged outdoor brand", "luxury scented candle for the holidays"];
const ARRANGE = [["auto", "Auto"], ["left", "Left"], ["center", "Center"], ["right", "Right"], ["bottom", "Bottom"]];

// Stage lists for the loading screen. Elapsed time is measured; the current stage is an
// estimate, since the backend reports no granular progress.
const RENDER_STAGES = [
  ["Synthesising the brief", 0], ["Writing the copy", 3], ["Swapping the models", 8],
  ["Rendering banner 1 of 2", 12], ["Rendering banner 2 of 2", 34], ["Art-director review", 56],
];
const ASK_STAGES = [["Reading your answer", 0], ["Sharpening the brief", 1], ["Writing the next question", 3]];

function elDefs(cp) {
  const d = [];
  if (cp.brand) d.push({ key: "brand", kind: "brand", text: cp.brand, sz: 0.038, color: "#ffffff" });
  d.push({ key: "kicker", kind: "kicker", text: cp.kicker || "NEW", sz: 0.03, color: "#ffffff", bg: "#e2662a" });
  d.push({ key: "headline", kind: "headline", text: cp.headline || "Headline", sz: 0.095, color: "#ffffff", font: "Anton" });
  d.push({ key: "cta", kind: "cta", text: cp.cta || "Shop Now", sz: 0.034, color: "#141414", bg: "#ffffff" });
  const c = [cp.contact, cp.social].filter(Boolean).join("   ");
  if (c) d.push({ key: "contact", kind: "contact", text: c, sz: 0.024, color: "#ffffff" });
  return d;
}

const TAIL = ["campaign", "offer", "format", "brand", "contact_social"];

// Each interview axis owns a hue, so the progress rail accumulates into a picture of the brief.
function axisOf(axis) {
  const a = (axis || "").toLowerCase();
  if (/appear|present|fram|look|product|shot|hero|subject/.test(a)) return ["Shot", "var(--ax-shot)"];
  if (/set|back|environ|scene|place|venue|surround/.test(a)) return ["Setting", "var(--ax-set)"];
  if (/audience/.test(a)) return ["Audience", "var(--ax-aud)"];
  if (/style|mood|light|colou?r|vibe|tone|aesthet|palette/.test(a)) return ["Mood", "var(--ax-mood)"];
  if (/campaign|occasion|offer|sale/.test(a)) return ["Offer", "var(--ax-offer)"];
  if (/brand/.test(a)) return ["Brand", "var(--ax-brand)"];
  if (/contact|social/.test(a)) return ["Contact", "var(--ax-contact)"];
  return ["Detail", "var(--ax-other)"];
}

function placeOf(img, mode) {
  const L = (img && img.critique && img.critique.layout) || {};
  return (mode === "auto" ? (L.placement || "left") : mode).toLowerCase();
}
function accentOf(img) {
  const L = (img && img.critique && img.critique.layout) || {};
  return /^#[0-9a-f]{6}$/i.test(L.accent || "") ? L.accent : "#e2662a";
}
function scrimFor(place, dark) {
  const c = dark ? "255,255,255" : "0,0,0", a = dark ? 0.62 : 0.8;
  const right = place.includes("right"), center = place.includes("center");
  return center
    ? `radial-gradient(130% 120% at 50% 50%, transparent 18%, rgba(${c},${a}) 100%)`
    : `linear-gradient(${right ? "270deg" : "90deg"}, rgba(${c},${a}) 0%, rgba(${c},${a * 0.45}) 40%, transparent 72%)`;
}

// ---- PNG export: redraw the banner (background + scrim + every text layer) on a canvas
// at the model's native size, so what downloads is what you see, not the bare render.
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
function wrapLines(ctx, text, maxW) {
  const out = [];
  text.split(/\n/).forEach(para => {
    let line = "";
    para.split(/\s+/).filter(Boolean).forEach(word => {
      const t = line ? line + " " + word : word;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = word; }
      else line = t;
    });
    out.push(line);
  });
  return out.filter(l => l !== "");
}
function fontFor(d, px) {
  if (d.kind === "headline") return `${px}px '${d.font || "Anton"}', Impact, system-ui, sans-serif`;
  return `${d.kind === "contact" ? 700 : 800} ${px}px 'ArchivoX', system-ui, sans-serif`;
}
function paintScrim(ctx, W, H, place, dark) {
  const c = dark ? "255,255,255" : "0,0,0", a = dark ? 0.62 : 0.8;
  const right = place.includes("right"), center = place.includes("center");
  let g;
  if (center) {
    g = ctx.createRadialGradient(W / 2, H / 2, Math.max(W, H) * 0.1, W / 2, H / 2, Math.max(W, H) * 0.68);
    g.addColorStop(0, `rgba(${c},0)`);
    g.addColorStop(0.18, `rgba(${c},0)`);
    g.addColorStop(1, `rgba(${c},${a})`);
  } else {
    g = right ? ctx.createLinearGradient(W, 0, 0, 0) : ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, `rgba(${c},${a})`);
    g.addColorStop(0.40, `rgba(${c},${a * 0.45})`);
    g.addColorStop(0.72, `rgba(${c},0)`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}
function drawLayer(ctx, d, W, H) {
  const px = d.sz * H;
  const upper = d.kind === "headline" || d.kind === "kicker";
  const text = upper ? (d.text || "").toUpperCase() : (d.text || "");
  ctx.font = fontFor(d, px);
  ctx.textBaseline = "top";
  if ("letterSpacing" in ctx) {
    ctx.letterSpacing = d.kind === "kicker" ? `${px * 0.22}px`
      : d.kind === "headline" ? `${px * 0.02}px` : "0px";
  }
  const x0 = ((d.xp || 0) / 100) * W, y0 = ((d.yp || 0) / 100) * H;
  const at = d.anchor || "left";
  const place = (w) => at === "right" ? x0 - w : at === "center" ? x0 - w / 2 : x0;

  if (d.kind === "headline") {
    const lines = wrapLines(ctx, text, W * 0.56), lh = px * 0.95;
    lines.forEach((ln, i) => {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = px * 0.22; ctx.shadowOffsetY = px * 0.04;
      ctx.fillStyle = d.color || "#ffffff";
      ctx.fillText(ln, place(ctx.measureText(ln).width), y0 + i * lh);
      ctx.restore();
    });
    return;
  }
  const tw = ctx.measureText(text).width;
  if (d.bg && (d.kind === "kicker" || d.kind === "cta")) {
    const padX = px * (d.kind === "cta" ? 1.0 : 0.7), padY = px * (d.kind === "cta" ? 0.5 : 0.35);
    const bw = tw + padX * 2, bh = px * 1.2 + padY * 2, bx = place(bw);
    roundRect(ctx, bx, y0, bw, bh, d.kind === "cta" ? bh / 2 : px * 0.25);
    ctx.fillStyle = d.bg; ctx.fill();
    ctx.fillStyle = d.color || "#ffffff";
    ctx.fillText(text, bx + padX, y0 + padY + px * 0.1);
    return;
  }
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = px * 0.3;
  ctx.fillStyle = d.color || "#ffffff";
  ctx.fillText(text, place(tw), y0);
  ctx.restore();
}

function Logo({ size = 23 }) {
  return (
    <svg className="glyph" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <ellipse cx="9.8" cy="11.4" rx="7.1" ry="8.7" transform="rotate(-20 9.8 11.4)" fill="#e8942e" />
      <ellipse cx="22.2" cy="11.4" rx="7.1" ry="8.7" transform="rotate(20 22.2 11.4)" fill="#e2662a" />
      <ellipse cx="11.7" cy="22.3" rx="5.3" ry="6.3" transform="rotate(14 11.7 22.3)" fill="#dc5b45" />
      <ellipse cx="20.3" cy="22.3" rx="5.3" ry="6.3" transform="rotate(-14 20.3 22.3)" fill="#b8413a" />
      <rect x="14.4" y="2.4" width="3.2" height="27.2" rx="1.6" fill="#fff" />
      <rect x="15.35" y="4.4" width="1.3" height="23.2" rx=".65" fill="#141417" />
      <path d="M16 6.1c-.7-2.1-2-3.2-3.8-3.5M16 6.1c.7-2.1 2-3.2 3.8-3.5" stroke="#141417"
        strokeWidth="1.15" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export default function Page() {
  const [screen, setScreen] = useState("s1");
  const [brief, setBrief] = useState("");
  const [answers, setAnswers] = useState([]);
  const [question, setQuestion] = useState(null);
  const [progress, setProgress] = useState({ asked: 0, total: 7 });
  const [hasImage, setHasImage] = useState(false);
  const [productImage, setProductImage] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploadName, setUploadName] = useState("");
  const [size, setSize] = useState({ w: 1024, h: 576 });
  const [copy, setCopy] = useState({});
  const [images, setImages] = useState([]);
  const [scene, setScene] = useState("");
  const [baseline, setBaseline] = useState(null);     // "before" image: the brief rendered as typed
  const [finalPrompt, setFinalPrompt] = useState("");
  const [arranges, setArranges] = useState({});       // per banner, so each arranges independently
  const [selBanner, setSelBanner] = useState(null);
  const [regenIdx, setRegenIdx] = useState(null);
  const [err, setErr] = useState("");
  const [otherText, setOtherText] = useState("");
  const [showOther, setShowOther] = useState(false);
  const [checked, setChecked] = useState({});
  const [els, setEls] = useState({});
  const [sel, setSel] = useState(null);
  const [arrangeTick, setArrangeTick] = useState(0);
  const [genKind, setGenKind] = useState("ask");
  const [elapsed, setElapsed] = useState(0);

  const bannerRefs = useRef({});
  const elRefs = useRef({});
  const tick = useRef(null);
  const initialJob = useRef("");   // background render of the "before" image (/start-initial)

  // elapsed clock for the loading screen
  useEffect(() => {
    if (screen !== "s3") { clearInterval(tick.current); return; }
    setElapsed(0);
    tick.current = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(tick.current);
  }, [screen, genKind]);

  // ---- interview ----
  async function askNext(ans) {
    setGenKind("ask"); setScreen("s3"); setErr("");
    try {
      const res = await post("/next-question", { brief, answers: ans, has_image: hasImage });
      setProgress({ asked: res.asked || ans.length, total: res.total || 7 });
      if (res.done || !res.question) { generate([], ans); return; }
      setQuestion(res.question); setShowOther(false); setOtherText(""); setScreen("s2");
      // Question 1 is on screen: render the "before" image while the user reads and answers.
      if (!ans.length) post("/start-initial", { brief }).then(r => { initialJob.current = r.job; }).catch(() => {});
    } catch (e) {
      setErr("Couldn't reach the art director. " + e.message);
      setScreen(ans.length ? "s2" : "s1");
    }
  }
  function start() {
    const b = brief.trim(); if (!b) return;
    setAnswers([]); setScene(""); setArranges({}); initialJob.current = "";
    setBaseline(null); setFinalPrompt(""); setBrief(b); askNext([]);
  }
  function answer(q, ans, hint) {
    const item = { id: q.id || "", axis: q.axis || "", question: q.question, answer: ans, hint, group: q.group || "visual" };
    const next = [...answers, item]; setAnswers(next); askNext(next);
  }
  function back() {
    if (!answers.length) { setScreen("s1"); return; }
    askNext(answers.slice(0, -1));
    setAnswers(answers.slice(0, -1));
  }
  function dropAnswer(i) {
    const next = answers.filter((_, n) => n !== i);
    setAnswers(next); askNext(next);
  }

  // ---- generate ----
  async function generate(extra, ansArg) {
    const ans = ansArg || answers;
    setGenKind("render"); setScreen("s3"); setErr("");
    const body = { brief, answers: ans, extra_fragments: extra, has_image: hasImage, product_image: productImage };
    if (extra.length && scene) body.scene = scene;
    else if (initialJob.current) body.initial_job = initialJob.current;
    try {
      const res = await post("/generate-banner", body);
      if (res.scene) setScene(res.scene);
      if (res.prompt) setFinalPrompt(res.prompt);
      if (res.initial) setBaseline(res.initial);
      if (res.copy && res.copy.headline) setCopy(res.copy);
      if (res.size) setSize(res.size);
      setImages(res.images || []);
      // init editor elements per banner
      const base = res.copy && res.copy.headline ? res.copy : copy;
      const e = {}, a = {};
      (res.images || []).forEach((_, i) => { e[i] = elDefs(base || {}); a[i] = "auto"; });
      setEls(e); setArranges(a); setSel(null); setRegenIdx(null);
      setScreen("s4");
      setTimeout(() => setArrangeTick(t => t + 1), 60);
    } catch (e) {
      setScreen("s4"); setRegenIdx(null);
      setErr("Render failed: " + e.message + " The models may be mid-swap — try again in a moment.");
    }
  }

  // Suggestions are tracked per banner, so each banner refines on its own notes.
  const fragsFor = (idx) => Object.entries(checked)
    .filter(([k, v]) => v && k.startsWith(idx + ":")).map(([, v]) => v);

  function regenerate(idx) {
    const frags = fragsFor(idx);
    if (!frags.length) return;
    setRegenIdx(idx);
    setChecked(c => {
      const out = { ...c };
      Object.keys(out).forEach(k => { if (k.startsWith(idx + ":")) delete out[k]; });
      return out;
    });
    generate(frags, answers);
  }

  // ---- upload ----
  async function onUpload(ev) {
    const f = ev.target.files[0]; if (!f) return;
    setUploadName("Uploading…");
    try {
      const fd = new FormData(); fd.append("file", f);
      const r = await fetch(apiBase() + "/upload-product", { method: "POST", body: fd });
      if (!r.ok) throw new Error("upload " + r.status);
      const d = await r.json();
      setProductImage(d.product_image); setHasImage(true);
      setPreviewUrl(apiBase() + d.url); setUploadName(f.name);
    } catch { setUploadName(""); setErr("That photo didn't upload. Try a different file."); }
  }
  function clearUpload() {
    setHasImage(false); setProductImage(""); setPreviewUrl(""); setUploadName("");
  }

  // ---- editor: arrange one banner at a time ----
  const arrangeOne = useCallback((idx, mode) => {
    setArranges(prev => ({ ...prev, [idx]: mode }));
    setEls(prev => {
      const list = (prev[idx] || []).map(e => ({ ...e }));
      const place = placeOf(images[idx], mode);
      const right = place.includes("right"), center = place.includes("center");
      const dark = mode === "auto" && ((images[idx] && images[idx].critique && images[idx].critique.layout && images[idx].critique.layout.theme) || "light").toLowerCase() === "dark";
      const accent = accentOf(images[idx]);
      const x = right ? 0.93 : center ? 0.5 : 0.07;
      list.forEach(e => {
        e.xp = x * 100; e.anchor = right ? "right" : center ? "center" : "left";
        if (mode === "auto") {
          e.color = (dark && e.kind !== "kicker" && e.kind !== "cta") ? "#161616" : (e.kind === "cta" ? "#141414" : "#ffffff");
          if (e.kind === "kicker") e.bg = accent;
        }
      });
      return { ...prev, [idx]: list };
    });
    setArrangeTick(t => t + 1);
  }, [images]);

  // A fresh set of banners arrives unpositioned: run Auto once so every layer gets its
  // x, anchor and colour before the stacking pass computes y.
  useEffect(() => {
    if (!images.length) return;
    images.forEach((_, i) => arrangeOne(i, "auto"));
  }, [images]); // eslint-disable-line

  // Keyboard shortcuts during the interview: 1-4 pick an option.
  useEffect(() => {
    if (screen !== "s2" || !question || question.type !== "choice") return;
    const h = (e) => {
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      const n = parseInt(e.key, 10);
      const opts = question.options || [];
      if (n >= 1 && n <= opts.length) { const o = opts[n - 1]; answer(question, o.label, o.prompt_fragment || o.label); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [screen, question]); // eslint-disable-line

  // Measure rendered heights and stack vertically with no overlap.
  useLayoutEffect(() => {
    if (screen !== "s4") return;
    setEls(prev => {
      const out = {};
      Object.keys(prev).forEach(k => {
        const idx = +k; const banner = bannerRefs.current[idx];
        const list = prev[idx].map(e => ({ ...e }));
        if (!banner) { out[idx] = list; return; }
        const bh = banner.clientHeight || 1;
        const place = placeOf(images[idx], arranges[idx] || "auto");
        const gap = 0.024;
        const vis = list.filter(e => !e.hidden);
        const hs = vis.map(e => { const n = elRefs.current[idx + ":" + e.key]; return (n ? n.offsetHeight : bh * e.sz) / bh; });
        const tot = hs.reduce((a, h) => a + h + gap, 0) - gap;
        let y = place.includes("bottom") ? (0.92 - tot) : (0.5 - tot / 2);
        y = Math.max(0.05, y);
        vis.forEach((e, i) => { e.yp = y * 100; y += hs[i] + gap; });
        out[idx] = list;
      });
      return out;
    });
  }, [arrangeTick]); // eslint-disable-line

  // ---- editor: drag + edit ----
  function onElPointerDown(ev, idx, def) {
    const node = ev.currentTarget;
    if (node.classList.contains("editing")) return;
    ev.preventDefault();
    setSel({ idx, key: def.key }); setSelBanner(idx);
    const banner = bannerRefs.current[idx]; const r = banner.getBoundingClientRect();
    const sx = ev.clientX, sy = ev.clientY, ox = def.xp, oy = def.yp;
    node.setPointerCapture(ev.pointerId); node.classList.add("drag");
    let nx = ox, ny = oy;
    const move = (e) => {
      nx = Math.max(0, Math.min(100, ox + (e.clientX - sx) / r.width * 100));
      ny = Math.max(0, Math.min(100, oy + (e.clientY - sy) / r.height * 100));
      node.style.left = nx + "%"; node.style.top = ny + "%";
    };
    const up = () => {
      node.classList.remove("drag");
      node.removeEventListener("pointermove", move); node.removeEventListener("pointerup", up);
      setEls(prev => { const l = prev[idx].map(e => e.key === def.key ? { ...e, xp: nx, yp: ny } : e); return { ...prev, [idx]: l }; });
    };
    node.addEventListener("pointermove", move); node.addEventListener("pointerup", up);
  }
  function onElDblClick(ev) {
    const node = ev.currentTarget; ev.stopPropagation();
    node.classList.add("editing"); node.contentEditable = "true"; node.focus();
    const rg = document.createRange(); rg.selectNodeContents(node);
    const s = getSelection(); s.removeAllRanges(); s.addRange(rg);
  }
  function onElBlur(ev, idx, key) {
    const node = ev.currentTarget; node.classList.remove("editing"); node.contentEditable = "false";
    const text = node.textContent;
    setEls(prev => ({ ...prev, [idx]: prev[idx].map(e => e.key === key ? { ...e, text } : e) }));
  }
  function updateSel(patch) {
    if (!sel) return;
    setEls(prev => ({ ...prev, [sel.idx]: prev[sel.idx].map(e => e.key === sel.key ? { ...e, ...patch } : e) }));
  }
  function hideSel() { updateSel({ hidden: true }); setSel(null); setTimeout(() => setArrangeTick(t => t + 1), 0); }

  const selDef = sel && (els[sel.idx] || []).find(e => e.key === sel.key);

  async function downloadPng(idx, im) {
    try {
      const W = size.w, H = size.h;
      const cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      const ctx = cv.getContext("2d");

      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error("the browser could not read the banner image."));
        img.src = apiBase() + im.url;
      });
      ctx.drawImage(img, 0, 0, W, H);

      const mode = arranges[idx] || "auto";
      const crit = im.critique || {};
      const dark = mode === "auto" && ((crit.layout && crit.layout.theme) || "light").toLowerCase() === "dark";
      paintScrim(ctx, W, H, placeOf(im, mode), dark);

      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      (els[idx] || []).filter(e => !e.hidden).forEach(d => drawLayer(ctx, d, W, H));

      const blob = await new Promise(r => cv.toBlob(r, "image/png"));
      if (!blob) throw new Error("the canvas could not be encoded.");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "banner-" + (idx + 1) + ".png";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr("PNG export failed: " + e.message + " This usually means the backend did not allow the image to be read across origins.");
    }
  }

  async function exportPsd(idx, imgUrl) {
    const layout = (images[idx] && images[idx].critique && images[idx].critique.layout) || {};
    try {
      const r = await fetch(apiBase() + "/export-psd", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imgUrl.split("/").pop(), copy, size, layout, product_image: productImage }),
      });
      if (!r.ok) throw new Error("export " + r.status);
      const blob = await r.blob(); const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "banner-" + imgUrl.split("/").pop().replace(".png", "") + ".psd";
      a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { setErr("PSD export failed: " + e.message); }
  }

  const scorePills = (scores, overall) => {
    const nice = { focal_clarity: "Focus", text_safe_space: "Copy", color_harmony: "Color", product_prominence: "Product", ad_polish: "Polish" };
    const out = Object.entries(scores || {}).map(([k, v]) => (
      <span className="sp" key={k}>
        <i className="d" style={{ background: v >= 4 ? "var(--good)" : v >= 3 ? "var(--mid)" : "var(--bad)" }} />
        {nice[k] || k} <b>{v}</b>
      </span>
    ));
    if (overall != null) out.push(<span className="sp ov" key="ov">Overall <b>{overall}/5</b></span>);
    return out;
  };

  const stages = genKind === "render" ? RENDER_STAGES : ASK_STAGES;
  const stageNow = stages.reduce((acc, s, i) => (elapsed >= s[1] ? i : acc), 0);

  const Bar = ({ right }) => (
    <div className="bar">
      <span className="mark"><Logo />ButterFly <em>Art Director</em></span>
      <span className="bar-r">{right}</span>
    </div>
  );

  const ErrBox = ({ onRetry }) => err ? (
    <div className="errbox">
      <span className="i">!</span>
      <div className="t">
        <h4>Something went wrong</h4>
        <p>{err}</p>
        <div className="acts">
          {onRetry && <button className="btn btn-sec btn-sm" onClick={onRetry}>Try again</button>}
          <button className="btn btn-sec btn-sm" onClick={() => setErr("")}>Dismiss</button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="wrap">

      {/* ---------- s1 · brief ---------- */}
      {screen === "s1" && (
        <>
          <Bar />
          <section className="screen">
            <div className="body">
              <div className="panel stagger">
              <p className="kick">New brief</p>
              <p className="h-big">What are you trying to sell?</p>
              <p className="sub">A few words is enough.</p>
              <div className="prompt">
                <textarea value={brief} rows={2} autoComplete="off"
                  placeholder="e.g. fall boot sale for a rugged outdoor brand"
                  onChange={e => setBrief(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); start(); } }} />
                <div className="prompt-foot">
                  {hasImage ? (
                    <span className="attach">
                      {previewUrl && <img className="thumb" src={previewUrl} alt="" />}
                      {uploadName || "Product photo"}
                      <button className="rm" onClick={clearUpload} aria-label="Remove photo">✕</button>
                    </span>
                  ) : (
                    <label className="attach">
                      <span className="plus">+</span>{uploadName || "Product photo"}
                      <input type="file" accept="image/*" hidden onChange={onUpload} />
                    </label>
                  )}
                  <button className="btn btn-pri" onClick={start} disabled={!brief.trim()}>
                    Start interview <span className="k">↵</span>
                  </button>
                </div>
              </div>
              <div className="tries">
                {EXAMPLES.slice(0, 3).map(e => (
                  <button className="chip" key={e} onClick={() => setBrief(e)}>{e}</button>
                ))}
              </div>
              </div>
              <ErrBox />
            </div>
          </section>
        </>
      )}

      {/* ---------- s2 · interview ---------- */}
      {screen === "s2" && question && (
        <>
          <Bar right={<span className="bar-ctx">{brief}</span>} />
          <section className="screen" key={answers.length}>
            <div className="body">
              <div className="panel">
              <div className="rail">
                {Array.from({ length: progress.total }).map((_, i) => (
                  <span key={i} className={i < answers.length ? "f" : ""}
                    style={i < answers.length ? { background: axisOf(answers[i].axis)[1] } : undefined} />
                ))}
              </div>
              <div className="step">
                <span className="n">{String(answers.length + 1).padStart(2, "0")} / {progress.total}</span>
                <button className="btn btn-sec btn-sm" onClick={back}>← Back</button>
              </div>

              {/* the question leads */}
              <h2 className="q-h">{question.question}</h2>
              {question.note && <div className="adnote"><span>🎨</span><span>{question.note}</span></div>}

              {question.type === "text" ? (
                <div>
                  <div className="field">
                    <input type="text" value={otherText} autoFocus
                      placeholder={question.placeholder || "Type your answer…"}
                      onChange={e => setOtherText(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && otherText.trim() && answer(question, otherText.trim(), otherText.trim())} />
                    <button className="btn btn-pri" onClick={() => {
                      const t = otherText.trim();
                      if (t) answer(question, t, t);
                      else if (question.optional) answer(question, "(not needed)", "");
                    }}>Continue <span className="k">↵</span></button>
                  </div>
                  {question.optional && (
                    <button className="skip" onClick={() => answer(question, "(not needed)", "")}>
                      Skip — not needed on the banner
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="cards" style={{ "--ax": axisOf(question.axis)[1] }}>
                    {(question.options || []).map((o, i) => (
                      <button className={"card" + (o.recommend ? " on" : "")} key={i}
                        style={{ animationDelay: (i * 55) + "ms" }}
                        onClick={e => {
                          e.currentTarget.classList.add("just");
                          answer(question, o.label, o.prompt_fragment || o.label);
                        }}>
                        <div className="card-top">
                          <span className="key">{i + 1}</span>
                          <span className="lbl">{o.label}</span>
                          {o.recommend && <span className="rec">★ My pick</span>}
                        </div>
                        {o.prompt_fragment && <div className="frag">{o.prompt_fragment}</div>}
                      </button>
                    ))}
                    {!question.no_other && (
                      <button className="card other" onClick={() => setShowOther(true)}
                        style={{ animationDelay: ((question.options || []).length * 55) + "ms" }}>
                        <div className="card-top">
                          <span className="key">{(question.options || []).length + 1}</span>
                          <span className="lbl">✎ Describe it yourself</span>
                        </div>
                      </button>
                    )}
                  </div>
                  {showOther && (
                    <div className="field" style={{ marginTop: 12 }}>
                      <input type="text" value={otherText} autoFocus
                        placeholder="e.g. on a wet city street at night, reflections…"
                        onChange={e => setOtherText(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && otherText.trim() && answer(question, otherText.trim(), otherText.trim())} />
                      <button className="btn btn-pri" onClick={() => {
                        const t = otherText.trim(); if (t) answer(question, t, t);
                      }}>Continue <span className="k">↵</span></button>
                    </div>
                  )}
                  <p className="hint">Click a card or press <b>1–{(question.options || []).length}</b>.</p>
                </>
              )}

              <ErrBox onRetry={() => askNext(answers)} />

              {/* direction recap — only renders answers actually given */}
              {answers.length > 0 && (
                <div className="recap">
                  <div className="recap-h">
                    <span className="t">Your direction</span>
                    <span className="c">{answers.length} of {progress.total}</span>
                  </div>
                  <div className="dirs">
                    {answers.map((a, i) => {
                      const ax = axisOf(a.axis);
                      return (
                        <span className="dchip" key={(a.id || "") + i} style={{ "--ax": ax[1] }}>
                          <span className="dot" />
                          <span className="ax">{ax[0]}</span>{a.answer}
                          <button className="rm" onClick={() => dropAnswer(i)} aria-label="Remove">✕</button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* the brief as typed, rendered in the background for the before/after */}
              {answers.length === 0 && (
                <div className="promptbox">
                  <div className="pb-head">
                    <span className="pb-title">Your starting prompt</span>
                    <span className="pb-after">exactly what you typed</span>
                  </div>
                  <div className="pb-scene">{brief}</div>
                  <div className="pb-tip">This is all an image model would get if you typed your idea
                    directly. We&apos;re rendering it in the background now — at the end, compare it with
                    the image from the detailed prompt your answers build.</div>
                </div>
              )}
              </div>
            </div>
          </section>
        </>
      )}

      {/* ---------- s3 · working ---------- */}
      {screen === "s3" && (
        <>
          <Bar right={<span className="bar-ctx">{brief}</span>} />
          <section className="screen">
            <div className="gen">
              <div className="panel">
              <p className="gen-h">{genKind === "render" ? "Art-directing two banners" : "Thinking about your answer"}</p>
              <p className="gen-s">
                {genKind === "render"
                  ? "About a minute on an M-series Mac. Nothing leaves this machine."
                  : "A few seconds."} · {elapsed}s elapsed
              </p>
              <div className="stages">
                {stages.map((s, i) => (
                  <div className={"stg" + (i < stageNow ? " done" : i === stageNow ? " now" : "")} key={s[0]}>
                    <span className="tick">{i < stageNow ? "✓" : ""}</span>
                    <span className="t">{s[0]}</span>
                  </div>
                ))}
              </div>
              {genKind === "render" && (
                <p className="swapnote">The image model and the vision model can&apos;t both fit in
                  memory, so they take turns. The swap above is that pause — expected, not a stall.</p>
              )}
              </div>
            </div>
          </section>
        </>
      )}

      {/* ---------- s4 · results + editor ---------- */}
      {screen === "s4" && (
        <>
          <Bar right={<button className="btn btn-sec btn-sm" onClick={() => setScreen("s1")}>New brief</button>} />
          <section className="screen">
            <div className="body wide">
              <div className="rhead">
                <div>
                  <p className="t">Two directions for {brief}</p>
                  <p className="s">Pick one to refine · drag any text to move it · double-click to retype</p>
                </div>
              </div>

              <div className="grid2">
                {images.map((im, idx) => {
                  const crit = im.critique || {};
                  const mode = arranges[idx] || "auto";
                  const place = placeOf(im, mode);
                  const dark = mode === "auto" && ((crit.layout && crit.layout.theme) || "light").toLowerCase() === "dark";
                  const nSel = fragsFor(idx).length;
                  return (
                    <div className={"bcard" + (selBanner === idx ? " sel" : "")} key={idx}>
                      {/* each banner arranges on its own */}
                      <div className="bhead">
                        <span className="bno">Banner {idx + 1}{selBanner === idx ? " · selected" : ""}</span>
                        <div className="arrpills">
                          {ARRANGE.map(a => (
                            <button key={a[0]} className={"ap" + (mode === a[0] ? " on" : "")}
                              onClick={() => { setSelBanner(idx); arrangeOne(idx, a[0]); }}>{a[1]}</button>
                          ))}
                        </div>
                      </div>

                      <div className="banner" ref={n => bannerRefs.current[idx] = n}
                        style={{ aspectRatio: `${size.w}/${size.h}`, backgroundImage: `url('${apiBase()}${im.url}')` }}
                        onPointerDown={e => {
                          if (e.target.classList.contains("banner") || e.target.classList.contains("scrim")) setSel(null);
                          setSelBanner(idx);
                        }}>
                        <div className="scrim" style={{ background: scrimFor(place, dark) }} />
                        {(els[idx] || []).filter(e => !e.hidden).map(def => (
                          <div key={def.key} ref={n => elRefs.current[idx + ":" + def.key] = n}
                            className={"el k-" + def.kind + (sel && sel.idx === idx && sel.key === def.key ? " sel" : "")}
                            style={{
                              left: (def.xp || 0) + "%", top: (def.yp || 0) + "%",
                              transform: def.anchor === "right" ? "translateX(-100%)" : def.anchor === "center" ? "translateX(-50%)" : "none",
                              fontSize: (def.sz * (bannerRefs.current[idx] ? bannerRefs.current[idx].clientHeight : 300)) + "px",
                              color: def.color, background: def.bg || undefined,
                              fontFamily: def.font ? `'${def.font}', Impact, system-ui, sans-serif` : undefined,
                              maxWidth: def.kind === "headline" ? Math.round((bannerRefs.current[idx] ? bannerRefs.current[idx].clientWidth : 300) * 0.56) + "px" : undefined,
                            }}
                            onPointerDown={e => onElPointerDown(e, idx, def)}
                            onDoubleClick={onElDblClick}
                            onBlur={e => onElBlur(e, idx, def.key)}
                            suppressContentEditableWarning>{def.text}</div>
                        ))}
                        {regenIdx === idx && (
                          <div className="regen"><span className="ring" />Re-rendering with your notes…</div>
                        )}
                      </div>

                      <div className="bbody">
                        <div className="scores">{scorePills(crit.scores, crit.overall)}</div>

                        <p className="verdict">{crit.verdict || "No critique available."}</p>

                        {(crit.suggestions || []).length > 0 && (
                          <section>
                            <div className="blocklab">Make it better
                              <em>{nSel ? nSel + " selected" : "pick any, then regenerate"}</em></div>
                            <ul className="sugs">
                              {(crit.suggestions || []).map((sg, i) => {
                                const key = idx + ":" + i;
                                const on = !!checked[key];
                                return (
                                  <li key={i}>
                                    <button className={"sug" + (on ? " on" : "")}
                                      onClick={() => {
                                        setSelBanner(idx);
                                        setChecked(c => ({ ...c, [key]: on ? "" : (sg.prompt_fragment || sg.text || "") }));
                                      }}>
                                      <span className="box">✓</span>
                                      <span>{sg.text || sg.prompt_fragment || ""}</span>
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          </section>
                        )}

                        <div className="nacts">
                          <button className="btn btn-pri btn-sm" disabled={!nSel || regenIdx !== null}
                            onClick={() => regenerate(idx)}>
                            ↻ Regenerate{nSel ? " with " + nSel + " note" + (nSel > 1 ? "s" : "") : ""}
                          </button>
                          <button className="btn btn-sec btn-sm" onClick={() => downloadPng(idx, im)}>⬇ PNG</button>
                          <button className="btn btn-sec btn-sm" onClick={() => exportPsd(idx, im.url)}>⬇ PSD</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <ErrBox />

              {/* how the answers changed the prompt */}
              {finalPrompt && (
                <div className="compare">
                  <div className="cmp-head">
                    <span className="pb-title">How your answers changed the prompt</span>
                    {baseline && images[0] && size.w === 1024 && size.h === 576 &&
                      <span className="pb-after">same seed and size for both images — only the prompt changed</span>}
                  </div>
                  <div className="cmp-grid">
                    {baseline && (
                      <div className="cmp-col">
                        <div className="cmp-lab">Before · from your brief alone</div>
                        <img className="cmp-img" src={`${apiBase()}${baseline.url}`} alt="Image from the initial prompt" />
                        <div className="pb-scene">{baseline.prompt}</div>
                      </div>
                    )}
                    <div className="cmp-col after">
                      <div className="cmp-lab">After · from your final prompt</div>
                      {baseline && images[0] && <img className="cmp-img" src={`${apiBase()}${images[0].url}`} alt="Image from the final prompt" />}
                      <div className="pb-scene">{finalPrompt}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* text properties: always present, with an empty state, so the controls are findable */}
          <div className="editbar">
            {selDef ? (
              <>
                <span className="eb-title">{selDef.kind.charAt(0).toUpperCase() + selDef.kind.slice(1)}</span>
                <div className="grp">Size
                  <input type="range" min="1" max="22" step="0.2" value={Math.round(selDef.sz * 100)}
                    onChange={e => updateSel({ sz: +e.target.value / 100 })} /></div>
                <div className="grp">Colour
                  <input type="color" value={selDef.color || "#ffffff"}
                    onChange={e => updateSel({ color: e.target.value })} /></div>
                {(selDef.kind === "kicker" || selDef.kind === "cta") && (
                  <div className="grp">Fill
                    <input type="color" value={selDef.bg || "#ffffff"}
                      onChange={e => updateSel({ bg: e.target.value })} /></div>
                )}
                {selDef.kind === "headline" && (
                  <div className="grp">Font
                    <select value={selDef.font || "Anton"} onChange={e => updateSel({ font: e.target.value })}>
                      <option value="Anton">Anton (display)</option>
                      <option value="ArchivoX">Archivo (bold)</option>
                      <option value="system-ui">System</option>
                    </select></div>
                )}
                <button className="btn btn-sec btn-sm" onClick={hideSel}>Hide</button>
                <button className="btn btn-pri btn-sm" onClick={() => setSel(null)}>Done</button>
              </>
            ) : (
              <span className="eb-empty">Click any text on a banner to change its size, colour and font.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
