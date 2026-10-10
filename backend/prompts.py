"""
The Art Director's brain — all prompt engineering, built specifically around
MARKETING & ADVERTISING banners.

Flow:
  1. GUIDED INTERVIEW: a fixed agenda of visual + marketing dimensions (no repeats),
     with the VLM tailoring each choice question's options to the product.
  2. PROMPT SYNTHESIS: the VLM turns the VISUAL answers into ONE rich, coherent
     scene description for FLUX (this is what makes images detailed, not generic).
  3. AD COPY (kicker/headline/cta + brand/contact/social) + CRITIQUE (with layout).
"""

# ---------------------------------------------------------------------------
# 1. GUIDED INTERVIEW — a fixed agenda guarantees coverage with no repeats.
#    The backend walks the agenda; the VLM only tailors each CHOICE question's
#    options to the product. TEXT questions are asked verbatim (no VLM call).
# ---------------------------------------------------------------------------
_SALE_WORDS = ("sale", "discount", "offer", "limited", "% off", "percent off", "deal", "clearance")


def _is_sale(answers: list[dict]) -> bool:
    for a in answers:
        if a.get("id") == "campaign":
            return any(w in (a.get("answer", "")).lower() for w in _SALE_WORDS)
    return False


# The creative phase is LIVE: the VLM decides the next creative question each turn, reacting
# to the last answer (and may ask a follow-up). The universal tail is fixed; these ids are
# reserved so the creative phase can't collide with them.
TAIL_IDS = {"campaign", "offer", "format", "brand", "contact_social"}
CREATIVE_MIN = 3
CREATIVE_MAX = 4


def creative_count(answers: list[dict]) -> int:
    return sum(1 for a in answers if a.get("id") not in TAIL_IDS)


NEXT_CREATIVE_SYSTEM = """You are an elite advertising art director running a LIVE creative session for a \
marketing banner — warm, confident, opinionated. You decide the SINGLE next creative question to ask, \
REACTING to what the client just told you.

The next question may be a FOLLOW-UP that drills into their last answer (e.g. they chose "shot on a model" → \
ask about the model's look or pose; "a mountain landscape" → ask the season or time of day), OR a fresh \
creative dimension that fits what they're advertising. Cover only the VISUAL brief (how it looks). Do NOT ask \
about brand name, contact, campaign/offer, or banner shape — those are handled separately.

Rules:
- Ask exactly ONE question. In "note", react to their last answer in the first person (≤ 18 words). Only \
reference things the client ACTUALLY said — never invent details they haven't chosen.
- Each question must cover a DISTINCT subject. NEVER ask two questions about the same topic — e.g. not two \
'graffiti' questions, not two 'lighting' questions. The covered dimensions below are FINISHED; pick a genuinely \
NEW facet (a follow-up is fine only if it opens a clearly different subject), or set done.
- Across the whole session, make sure you cover three DIFFERENT things: the subject/product itself, its \
setting, and its visual style — then finish.
- ALMOST ALWAYS use type "choice": give 3-4 specific, vivid options (each with a "prompt_fragment", a visual \
phrase) and mark exactly ONE "recommend": true. The UI automatically adds an "Other" card so the user can type \
a custom answer when nothing fits — so you do NOT need a text box to capture something unusual.
- If NO photo was uploaded, your FIRST question should pin down the product's APPEARANCE — but still as a \
"choice" with 3-4 plausible looks for THIS product (e.g. for coffee: "Dark roasted beans", "Creamy iced latte", \
"Beans spilling from a burlap sack", "Latte art in a ceramic cup"). The user taps "Other" to describe their own.
- Use type "text" ONLY as a true last resort, when options genuinely cannot be offered — which in the creative \
phase is essentially never.
- Ask at least {min_q} and at most {max_q} creative questions. Set "done": true ONLY once you can picture the \
scene (the subject/product, its setting, and its visual style are all covered) — then stop, don't pad.

Return ONLY JSON — either {{"done": true}} or
{{"question": {{"id": "snake_case", "axis": "2-3 words", "type": "choice", "note": "...", "question": "...", \
"options": [{{"label": "...", "prompt_fragment": "...", "recommend": false}}]}}}}
(for a text question use "type": "text", "placeholder": "..." and omit "options")."""


def next_creative_system_prompt() -> str:
    return NEXT_CREATIVE_SYSTEM.format(min_q=CREATIVE_MIN, max_q=CREATIVE_MAX)


# The three creative dimensions we guarantee coverage of, each matched by keywords so we can
# tell the VLM exactly which one to ask next (prevents it fixating on one, e.g. 3x "appearance").
_CANON = {
    "the PRODUCT itself (its appearance / how it's framed)":
        ("appear", "present", "fram", "look", "product", "shot", "close", "hero", "angle", "subject"),
    "the SETTING (where it sits / the backdrop)":
        ("setting", "background", "backdrop", "environment", "scene", "place", "location", "surround", "venue"),
    "the STYLE (mood + lighting + color)":
        ("style", "mood", "light", "color", "colour", "vibe", "tone", "aesthetic", "palette", "atmosphere"),
}


def _remaining_dims(has_image: bool, answers: list[dict]) -> list[str]:
    covered = set()
    if has_image:  # the uploaded photo already covers the product's appearance
        covered.add(list(_CANON)[0])
    for a in answers:
        if a.get("id") in TAIL_IDS:
            continue
        text = (str(a.get("axis", "")) + " " + str(a.get("question", ""))).lower()
        for dim, kws in _CANON.items():
            if any(k in text for k in kws):
                covered.add(dim)
    return [d for d in _CANON if d not in covered]


def next_creative_user_prompt(brief: str, has_image: bool, answers: list[dict],
                              force: bool = False, redirect_from: str = "") -> str:
    photo = "A product photo WAS uploaded." if has_image else "NO product photo was uploaded."
    covered = "; ".join(a.get("axis") or a.get("question", "?") for a in answers
                        if a.get("id") not in TAIL_IDS) or "(none yet)"
    remaining = _remaining_dims(has_image, answers)
    if remaining:
        tail = (f"\n\nStill to cover: {remaining[0]}. Ask ONE 'choice' question about THAT next — do not re-ask "
                "a dimension already covered above.")
    else:
        tail = (f"\n\nThe product, setting, and style are all covered ({creative_count(answers)} questions). "
                "Either ask one optional deepening follow-up on a NEW detail, or set done=true now.")
    if force:
        tail = ("\n\nThe brief is still too thin — you MUST ask another creative 'choice' question now "
                "(return a question, not done).")
    if redirect_from:
        nxt = remaining[0] if remaining else "a genuinely new detail"
        tail = (f"\n\nYou just proposed another '{redirect_from}' question, but that is ALREADY covered. "
                f"Ask instead about {nxt}, as a 'choice' question.")
    return _format_answers(brief, answers) + f"\n\n{photo}\nDimensions already covered: {covered}." + tail


# Universal steps after the creative phase (every banner needs these).
def _tail() -> list[dict]:
    return [
        {"id": "campaign", "group": "marketing", "type": "choice", "axis": "Campaign", "no_other": False,
         "note": "Now the strategy — what's the moment we're selling here?",
         "question": "What's the occasion for this banner?",
         "options": [{"label": "New launch", "prompt_fragment": ""}, {"label": "Sale / discount", "prompt_fragment": ""},
                     {"label": "Limited-time offer", "prompt_fragment": ""}, {"label": "Brand awareness", "prompt_fragment": ""}]},
        {"id": "offer", "group": "marketing", "type": "text", "axis": "Offer Detail", "when_sale": True,
         "note": "A deal — let's make it the hero. What's the offer?",
         "question": "What's the offer? (discount and any dates)", "placeholder": "e.g. 30% off, ends Sunday", "optional": False},
        {"id": "format", "group": "meta", "type": "choice", "axis": "Format", "no_other": True,
         "note": "Where's this going to live? That sets the canvas.",
         "question": "What shape is your banner?",
         "options": [{"label": "Web banner (16:9)", "prompt_fragment": "1024x576"},
                     {"label": "Square (social)", "prompt_fragment": "768x768"},
                     {"label": "Story (9:16)", "prompt_fragment": "576x1024"}]},
        {"id": "brand", "group": "marketing", "type": "text", "axis": "Brand Name",
         "note": "Almost there — whose name goes on this?",
         "question": "What's your brand or shop name?", "placeholder": "e.g. Sole Street Co.", "optional": True},
        {"id": "contact_social", "group": "marketing", "type": "text", "axis": "Contact & Social",
         "note": "Last thing — anything you want people to reach you by?",
         "question": "Any contact or social to show on the banner?",
         "placeholder": "phone, website, or @handle — or skip", "optional": True},
    ]


def tail_next(answers: list[dict]) -> dict | None:
    """Next unanswered universal-tail step (skipping the offer step unless it's a sale)."""
    answered = {a.get("id") for a in answers if a.get("id")}
    sale = _is_sale(answers)
    for dim in _tail():
        if dim["id"] in answered or (dim.get("when_sale") and not sale):
            continue
        return dim
    return None


def tail_total(answers: list[dict]) -> int:
    sale = _is_sale(answers)
    return sum(1 for dim in _tail() if not (dim.get("when_sale") and not sale))


def _format_answers(brief: str, answers: list[dict]) -> str:
    lines = [f'PRODUCT / BRIEF: "{brief}"', "", "ANSWERS SO FAR:"]
    if not answers:
        lines.append("  (none yet — ask your first question)")
    for i, a in enumerate(answers, 1):
        detail = f"  (look: {a['hint']})" if a.get("hint") and a["hint"] != a.get("answer") else ""
        lines.append(f"  {i}. Q: {a.get('question','')}\n     A: {a.get('answer','')}{detail}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 2. PROMPT SYNTHESIS — the whole interview -> one rich FLUX scene.
# ---------------------------------------------------------------------------
SYNTH_SYSTEM = """You are a world-class prompt engineer for FLUX, writing the image prompt for a \
premium MARKETING / ADVERTISING BANNER BACKGROUND (the headline text is added separately later).

Given the product and the full creative brief, write ONE vivid, coherent, richly detailed image prompt \
describing a SINGLE specific scene — the kind that produces a polished, agency-quality ad photo.

Include, woven into natural descriptive language:
- the product and exactly how it's presented (hero framing, styling, materials, finish)
- the setting/environment and supporting props
- lighting (direction, quality, time of day), color palette, and mood
- camera feel (lens, depth of field, angle) and commercial photo quality
- a clear, intentional area of clean negative space on one side for a headline overlay

Hard rules: photorealistic, premium, advertising-grade. Absolutely NO text, words, letters, labels, \
logos, or watermarks anywhere in the image. Return ONLY the prompt text — one dense paragraph, no preamble."""


def synth_user_prompt(brief: str, answers: list[dict]) -> str:
    return _format_answers(brief, answers) + "\n\nWrite the FLUX image prompt now."


# Composite mode: the user's real product is pasted on top later, so FLUX must
# render ONLY the background scene — no product in it — with room for it.
SYNTH_BG_SYSTEM = """You are a world-class prompt engineer for FLUX, writing the image prompt for the \
BACKGROUND SCENE of a premium marketing banner. The actual product will be composited on top afterwards, \
so the scene must contain NO product and NO people holding anything.

Given the product and the creative brief, write ONE vivid, photorealistic prompt for an empty PRODUCT-STAGING \
scene — a clean styled SURFACE in the lower foreground (a tabletop, countertop, pedestal, or seamless sweep) \
lit for product photography, with a simple complementary backdrop softly blurred behind it. Shoot at roughly \
eye level or slightly above so the surface reads as a place to set a product down. Describe the surface \
material, the backdrop, props only around the edges, lighting, color, mood, and shallow depth of field.

Keep the RIGHT-FOREGROUND surface clear (a product will be set there) and the LEFT clear for a headline. \
Hard rules: photorealistic, premium, advertising-grade, EMPTY — absolutely NO product, no cup/bottle/box, \
no people, and NO text, letters, labels, logos, or watermarks. Return ONLY the prompt text — one paragraph."""


def synth_bg_user_prompt(brief: str, answers: list[dict]) -> str:
    return _format_answers(brief, answers) + "\n\nWrite the empty BACKGROUND scene prompt now."


# Appended after the synthesized scene to lock in no-text + copy-space.
BANNER_GUARD = (
    "professional advertising photography, premium commercial quality, sharp focus, photorealistic, 8k, "
    "clean empty negative space reserved for a headline overlay, "
    "no text, no words, no letters, no typography, no labels, no logos, no watermark"
)

_TEXT_WORDS = ("logo", "watermark")  # scene is synthesized prose; keep a light final guard only


def build_flux_prompt(scene: str) -> str:
    """Wrap the VLM-synthesized scene paragraph with the no-text / copy-space guard."""
    scene = (scene or "").strip().rstrip(".")
    return f"{scene}. {BANNER_GUARD}"


# ---------------------------------------------------------------------------
# 3. AD COPY (text-only) — a full banner type block: kicker + headline + CTA.
# ---------------------------------------------------------------------------
ADCOPY_SYSTEM = """You are a senior advertising copywriter assembling the text block for a marketing banner.
Given the brief and the user's MARKETING answers, return this JSON (no markdown):
{"kicker": "...", "headline": "...", "cta": "...", "brand": "...", "contact": "...", "social": "..."}

Copy you WRITE (reflect the campaign — if the user gave a specific offer like "30% off" or dates, feature \
it prominently in the kicker or headline):
- "kicker": a tiny eyebrow, 1-3 words (e.g. "NEW LAUNCH", "LIMITED TIME", "30% OFF", "JUST DROPPED").
- "headline": the HOOK — a benefit, desire, or offer, 2-5 punchy words. Do NOT just restate the product name.
  GOOD for pizza: "FRESH FROM THE FIRE", "TONIGHT TASTES BETTER". BAD: "WOOD-FIRED PIZZA".
- "cta": a 1-3 word button action (e.g. "Order Now", "Shop the Sale", "Get Yours").

Info you COPY VERBATIM from the user's answers — NEVER invent these:
- "brand": the brand / shop name the user gave. Empty string "" if they gave none.
- "contact": phone / website / address the user wants shown. "" if none or they declined.
- "social": social handle(s) the user wants shown. "" if none or they declined.

No emoji, no hashtags, no quotes around values, no trailing period. Return ONLY the JSON."""


def adcopy_user_prompt(brief: str, marketing_answers: list[dict]) -> str:
    lines = [f'Brief: "{brief}"', "", "MARKETING ANSWERS:"]
    if not marketing_answers:
        lines.append("  (none)")
    for a in marketing_answers:
        lines.append(f"  - {a.get('question','')} -> {a.get('answer','')}")
    lines.append("\nReturn the banner text block JSON (brand/contact/social verbatim, or \"\" if not given):")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 4. CRITIQUE — art-director review of a rendered banner background.
# ---------------------------------------------------------------------------
CRITIQUE_SYSTEM = """You are a demanding advertising art director reviewing a generated banner BACKGROUND.

CRITICAL CONTEXT: The headline will be added LATER as a separate HTML/CSS text layer on top of this image. \
This image must contain NO text. Therefore:
- NEVER suggest adding, drawing, placing, or rendering any text, words, headline, copy, or logo in the image.
- "text_safe_space" measures whether there is a clean, relatively EMPTY region where a headline could later \
be dropped. MORE clean empty space = HIGHER score. Do not penalize the image for lacking text.

Score the image 1-5 on each: focal_clarity, text_safe_space, color_harmony, product_prominence, ad_polish.

Then give 2 to 3 SPECIFIC, visually-actionable suggestions to make it a stronger AD BACKGROUND. Suggestions may \
ONLY concern: lighting, color palette, composition / product placement, background cleanliness, negative space, \
mood, or realism — never text. Each carries a "prompt_fragment": a positive visual phrase to append when \
regenerating. Fragments must never mention text, words, or letters.

You also act as the layout director. Look at WHERE this specific image has clean, uncluttered space and \
how bright it is there, and recommend how to place the headline text block:
- "placement": which region has the cleanest empty space for the headline, AWAY from the product/busy areas. \
One of: "left", "right", "top-left", "top-right", "bottom-left", "bottom-right", "center".
- "theme": "light" if that region is dark (so use light text) or "dark" if that region is bright (so use dark text).
- "accent": a vivid hex color (like "#E8B04B") drawn from the image that would make a small label chip and \
button pop against it.

Return ONLY valid JSON, no markdown:
{
  "scores": {"focal_clarity": 0, "text_safe_space": 0, "color_harmony": 0, "product_prominence": 0, "ad_polish": 0},
  "overall": 0,
  "verdict": "<one-sentence take>",
  "layout": {"placement": "left", "theme": "light", "accent": "#E8B04B"},
  "suggestions": [
    {"text": "<human-readable suggestion, no text/words>", "prompt_fragment": "<positive visual phrase, no text/words>"}
  ]
}"""

CRITIQUE_USER = "Review this advertising banner background and return the JSON scorecard."
