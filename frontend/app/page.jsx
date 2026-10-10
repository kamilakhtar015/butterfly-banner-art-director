"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { apiBase, post } from "../lib/api";

const EXAMPLES = ["fall boot sale for a rugged outdoor brand", "artisan cold brew coffee launch",
  "luxury scented candle for the holidays", "summer sneaker drop, streetwear", "handmade ceramic mugs, cozy"];
const INTERVIEW_MSGS = ["Thinking of the next question…", "Reading your answer…", "Sharpening the brief…"];
const RENDER_MSGS = ["Composing the shot…", "Mixing the palette…", "Adjusting the lighting…",
  "Leaving space for your headline…", "Rendering pixels…", "Reviewing the proofs…"];
const ARRANGE = [["auto", "Auto ✨"], ["left", "Left"], ["center", "Center"], ["right", "Right"], ["bottom", "Bottom"]];

function elDefs(cp) {
  const d = [];
  if (cp.brand) d.push({ key: "brand", kind: "brand", text: cp.brand, sz: 0.038, color: "#ffffff" });
  d.push({ key: "kicker", kind: "kicker", text: cp.kicker || "NEW", sz: 0.03, color: "#ffffff", bg: "#ff7a59" });
  d.push({ key: "headline", kind: "headline", text: cp.headline || "Headline", sz: 0.095, color: "#ffffff", font: "Anton" });
  d.push({ key: "cta", kind: "cta", text: cp.cta || "Shop Now", sz: 0.034, color: "#141414", bg: "#ffffff" });
  const c = [cp.contact, cp.social].filter(Boolean).join("   ");
  if (c) d.push({ key: "contact", kind: "contact", text: c, sz: 0.024, color: "#ffffff" });
  return d;
}

function placeOf(img, mode) {
  const L = (img && img.critique && img.critique.layout) || {};
  return (mode === "auto" ? (L.placement || "left") : mode).toLowerCase();
}
function accentOf(img) {
  const L = (img && img.critique && img.critique.layout) || {};
  return /^#[0-9a-f]{6}$/i.test(L.accent || "") ? L.accent : "#ff7a59";
}
function scrimFor(place, dark) {
  const c = dark ? "255,255,255" : "0,0,0", a = dark ? 0.62 : 0.8;
  const right = place.includes("right"), center = place.includes("center");
  return center
    ? `radial-gradient(130% 120% at 50% 50%, transparent 18%, rgba(${c},${a}) 100%)`
    : `linear-gradient(${right ? "270deg" : "90deg"}, rgba(${c},${a}) 0%, rgba(${c},${a * 0.45}) 40%, transparent 72%)`;
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
  const [uploadLabel, setUploadLabel] = useState("📷 Upload product photo");
  const [size, setSize] = useState({ w: 1024, h: 576 });
  const [copy, setCopy] = useState({});
  const [images, setImages] = useState([]);
  const [scene, setScene] = useState("");
  const [arrange, setArrange] = useState("auto");
  const [loadMsg, setLoadMsg] = useState("");
  const [loadSub, setLoadSub] = useState("");
  const [err, setErr] = useState("");
  const [otherText, setOtherText] = useState("");
  const [showOther, setShowOther] = useState(false);
  const [checked, setChecked] = useState({});
  const [els, setEls] = useState({});
  const [sel, setSel] = useState(null);
  const [arrangeTick, setArrangeTick] = useState(0);

  const bannerRefs = useRef({});
  const elRefs = useRef({});
  const loadTimer = useRef(null);

  // rotating loading messages
  useEffect(() => {
    if (screen !== "s3") { clearInterval(loadTimer.current); return; }
    const msgs = images.length === 0 && !question ? INTERVIEW_MSGS : (loadSub.includes("banner") ? RENDER_MSGS : INTERVIEW_MSGS);
    let i = 0; setLoadMsg(msgs[0]);
    loadTimer.current = setInterval(() => { i = (i + 1) % msgs.length; setLoadMsg(msgs[i]); }, 2000);
    return () => clearInterval(loadTimer.current);
  }, [screen, loadSub]); // eslint-disable-line

  // ---- interview ----
  async function askNext(ans) {
    setScreen("s3");
    setLoadSub(ans.length ? "Personalising the next question…" : "Interviewing you about the look…");
    try {
      const res = await post("/next-question", { brief, answers: ans, has_image: hasImage });
      setProgress({ asked: res.asked || ans.length, total: res.total || 7 });
      if (res.done || !res.question) { generate([], ans); return; }
      setQuestion(res.question); setShowOther(false); setOtherText(""); setScreen("s2");
    } catch (e) { setScreen("s1"); alert("Could not reach the art director.\n" + e.message); }
  }
  function start() {
    const b = brief.trim(); if (!b) return;
    setAnswers([]); setScene(""); setArrange("auto"); askNextWith(b, []);
  }
  function askNextWith(b, ans) { setBrief(b); askNext(ans); }
  function answer(q, ans, hint) {
    const item = { id: q.id || "", axis: q.axis || "", question: q.question, answer: ans, hint, group: q.group || "visual" };
    const next = [...answers, item]; setAnswers(next); askNext(next);
  }

  // ---- generate ----
  async function generate(extra, ansArg) {
    const ans = ansArg || answers;
    setScreen("s3"); setErr("");
    setLoadSub("Rendering 2 detailed banners + art-director review (~60s).");
    const body = { brief, answers: ans, extra_fragments: extra, has_image: hasImage, product_image: productImage };
    if (extra.length && scene) body.scene = scene;
    try {
      const res = await post("/generate-banner", body);
      if (res.scene) setScene(res.scene);
      if (res.copy && res.copy.headline) setCopy(res.copy);
      if (res.size) setSize(res.size);
      setImages(res.images || []);
      // init editor elements per banner
      const base = res.copy && res.copy.headline ? res.copy : copy;
      const e = {}; (res.images || []).forEach((_, i) => e[i] = elDefs(base || {}));
      setEls(e); setSel(null); setArrange("auto");
      setScreen("s4");
      setTimeout(() => setArrangeTick(t => t + 1), 60);
    } catch (e) { setScreen("s4"); setErr("Render failed: " + e.message + ". The model may be swapping — try again."); }
  }
  function applySuggestions() {
    const frags = Object.values(checked).filter(Boolean);
    if (!frags.length) { alert("Tick at least one suggestion to apply."); return; }
    setChecked({}); generate(frags, answers);
  }

  // ---- upload ----
  async function onUpload(ev) {
    const f = ev.target.files[0]; if (!f) return;
    setUploadLabel("Uploading…");
    try {
      const fd = new FormData(); fd.append("file", f);
      const r = await fetch(apiBase() + "/upload-product", { method: "POST", body: fd });
      if (!r.ok) throw new Error("upload " + r.status);
      const d = await r.json();
      setProductImage(d.product_image); setHasImage(true);
      setPreviewUrl(apiBase() + d.url); setUploadLabel("📷 Product photo added");
    } catch { setUploadLabel("📷 Upload failed — try again"); }
  }

  // ---- editor: arrange + restack ----
  const arrangeAll = useCallback((mode) => {
    setArrange(mode);
    setEls(prev => {
      const out = {};
      Object.keys(prev).forEach(k => {
        const idx = +k; const list = prev[idx].map(e => ({ ...e }));
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
        out[idx] = list;
      });
      return out;
    });
    setArrangeTick(t => t + 1);
  }, [images]);

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
        const place = placeOf(images[idx], arrange);
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
    setSel({ idx, key: def.key });
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
    } catch (e) { alert("PSD export failed: " + e.message); }
  }

  const scorePills = (scores) => {
    if (!scores) return null;
    const nice = { focal_clarity: "Focus", text_safe_space: "Copy space", color_harmony: "Color", product_prominence: "Product", ad_polish: "Polish" };
    return Object.entries(scores).map(([k, v]) => <span className="pill" key={k}>{nice[k] || k} <b>{v}/5</b></span>);
  };

  return (
    <div className="wrap">
      <header><div className="logo" /><h1>ButterFly <small>· Banner Art Director</small></h1></header>

      {screen === "s1" && (
        <section className="screen">
          <div className="hero">
            <h2>What are you trying to sell?</h2>
            <p>Describe it in a few words. Your AI art director will interview you, then design it.</p>
            <div className="inputrow">
              <input type="text" value={brief} onChange={e => setBrief(e.target.value)}
                onKeyDown={e => e.key === "Enter" && start()} placeholder="e.g. fall boot sale for a rugged outdoor brand" autoComplete="off" />
              <button className="cta" onClick={start}>Start interview →</button>
            </div>
            <div className="uploadrow">
              <label className="uploadbtn">{uploadLabel}{!hasImage && <span style={{ opacity: .6 }}> (optional)</span>}
                <input type="file" accept="image/*" hidden onChange={onUpload} />
              </label>
              {previewUrl && <img className="preview" src={previewUrl} alt="product" />}
              {hasImage && <span className="chip" onClick={() => { setHasImage(false); setProductImage(""); setPreviewUrl(""); setUploadLabel("📷 Upload product photo"); }}>✕ remove</span>}
            </div>
            <div className="examples">
              {EXAMPLES.map(e => <span className="chip" key={e} onClick={() => setBrief(e)}>{e}</span>)}
            </div>
          </div>
        </section>
      )}

      {screen === "s2" && question && (
        <section className="screen">
          <div className="brief-tag">Creative brief for <b>{brief}</b></div>
          <div className="progress">
            <div className="dots">{Array.from({ length: progress.total }).map((_, i) =>
              <div key={i} className={"dot" + (i < progress.asked ? " on" : i === progress.asked ? " cur" : "")} />)}</div>
            <span className="ptext">Question {progress.asked + 1} · gathering detail</span>
          </div>
          {question.note && <div className="adnote"><span className="who">🎨</span><span>{question.note}</span></div>}
          <div className="qtitle">{question.question}</div>
          {question.type === "text" ? (
            <div>
              <div className="otherbox">
                <input type="text" value={otherText} onChange={e => setOtherText(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && otherText.trim() && answer(question, otherText.trim(), otherText.trim())}
                  placeholder={question.placeholder || "Type your answer…"} autoFocus />
                <button className="cta" onClick={() => { const t = otherText.trim(); if (t) answer(question, t, t); else if (question.optional) answer(question, "(not needed)", ""); }}>Continue →</button>
              </div>
              {question.optional && <span className="chip" style={{ marginTop: 12, display: "inline-block" }} onClick={() => answer(question, "(not needed)", "")}>Skip — not needed on the banner</span>}
            </div>
          ) : (
            <>
              <div className="cards">
                {(question.options || []).map((o, i) =>
                  <div className={"card" + (o.recommend ? " rec" : "")} key={i} onClick={() => answer(question, o.label, o.prompt_fragment || o.label)}>
                    <div className="lbl">{o.label}</div>
                    <div className="frag">{o.prompt_fragment || ""}</div>
                    {o.recommend && <div className="recbadge">★ My pick</div>}
                  </div>)}
                {!question.no_other &&
                  <div className="card other" onClick={() => setShowOther(true)}>
                    <div className="lbl">✎ Other…</div><div className="frag">Describe it in your own words</div>
                  </div>}
              </div>
              {showOther && <div className="otherbox" style={{ display: "flex" }}>
                <input type="text" value={otherText} onChange={e => setOtherText(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && otherText.trim() && answer(question, otherText.trim(), otherText.trim())}
                  placeholder="e.g. on a wet city street at night, reflections…" autoFocus />
                <button className="cta" onClick={() => { const t = otherText.trim(); if (t) answer(question, t, t); }}>Continue →</button>
              </div>}
            </>
          )}
          <div className="finishrow"><button className="ghost" onClick={() => setScreen("s1")}>← Start over</button></div>
          <div className="hint">Pick an option or choose <b>Other</b> to say it in your words. The art director keeps asking until your brief is detailed enough.</div>
        </section>
      )}

      {screen === "s3" && (
        <section className="screen">
          <div className="loading"><div className="spin" /><div className="loadmsg">{loadMsg}</div><div className="loadsub">{loadSub}</div></div>
        </section>
      )}

      {screen === "s4" && (
        <section className="screen">
          <div className="results-head">
            <div className="brief-tag" style={{ margin: 0 }}>Your banners for <b>{brief}</b> · <span style={{ color: "var(--muted)" }}>drag any text · double-click to retype</span></div>
            <button className="ghost" onClick={() => { setScreen("s1"); }}>New brief</button>
          </div>
          <div className="arrbar"><span className="lab">Arrange:</span>
            {ARRANGE.map(([k, label]) => <span key={k} className={"spill" + (arrange === k ? " on" : "")} onClick={() => arrangeAll(k)}>{label}</span>)}
          </div>
          <div className="banners">
            {images.map((im, idx) => {
              const crit = im.critique || {};
              const place = placeOf(im, arrange);
              const dark = arrange === "auto" && ((crit.layout && crit.layout.theme) || "light").toLowerCase() === "dark";
              return (
                <div className="banner-card" key={idx}>
                  <div className="banner" ref={n => bannerRefs.current[idx] = n}
                    style={{ aspectRatio: `${size.w}/${size.h}`, backgroundImage: `url('${apiBase()}${im.url}?t=${Date.now()}')` }}
                    onPointerDown={e => { if (e.target.classList.contains("banner") || e.target.classList.contains("scrim")) setSel(null); }}>
                    <div className="scrim" style={{ background: scrimFor(place, dark) }} />
                    {(els[idx] || []).filter(e => !e.hidden).map(def =>
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
                        suppressContentEditableWarning>{def.text}</div>)}
                  </div>
                  <div className="crit">
                    <div className="scorebar">{scorePills(crit.scores)}{crit.overall != null && <span className="pill">Overall <b>{crit.overall}/5</b></span>}</div>
                    <div className="verdict">{crit.verdict || "No critique available."}</div>
                    <ul className="sugs">{(crit.suggestions || []).map((s, i) =>
                      <li className="sug" key={i}>
                        <input type="checkbox" checked={!!checked[idx + ":" + i]} onChange={e => setChecked(c => ({ ...c, [idx + ":" + i]: e.target.checked ? (s.prompt_fragment || "") : "" }))} />
                        <span>{s.text || s.prompt_fragment || ""}</span>
                      </li>)}</ul>
                    <button className="ghost" style={{ width: "100%", marginTop: 4 }} onClick={() => exportPsd(idx, im.url)}>⬇ Export layered .PSD</button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="applybar"><button className="cta" onClick={applySuggestions}>↻ Apply selected suggestions & re-roll</button></div>
          <div className="hint" style={{ textAlign: "center" }}>Drag text to move it · double-click to retype · click to select & restyle below.</div>
          {err && <div className="err">{err}</div>}
        </section>
      )}

      {selDef && (
        <div className="editbar show">
          <span className="eb-title">{selDef.kind.charAt(0).toUpperCase() + selDef.kind.slice(1)}</span>
          <div className="grp">Size <input type="range" min="1" max="22" step="0.2" value={Math.round(selDef.sz * 100)} onChange={e => updateSel({ sz: +e.target.value / 100 })} /></div>
          <div className="grp">Color <input type="color" value={selDef.color || "#ffffff"} onChange={e => updateSel({ color: e.target.value })} /></div>
          {(selDef.kind === "kicker" || selDef.kind === "cta") &&
            <div className="grp">Fill <input type="color" value={selDef.bg || "#ffffff"} onChange={e => updateSel({ bg: e.target.value })} /></div>}
          {selDef.kind === "headline" &&
            <div className="grp">Font
              <select value={selDef.font || "Anton"} onChange={e => updateSel({ font: e.target.value })}>
                <option value="Anton">Anton (display)</option><option value="ArchivoX">Archivo (bold)</option><option value="system-ui">System</option>
              </select></div>}
          <button className="eb-btn" onClick={hideSel}>Hide</button>
          <button className="eb-btn" onClick={() => setSel(null)}>Done</button>
        </div>
      )}
    </div>
  );
}
