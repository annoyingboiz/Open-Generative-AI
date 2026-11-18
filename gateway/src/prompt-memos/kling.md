---
id: kling
name: Kling (4.0, O3, 3.x)
kind: video
match: "^kling"
sources:
  - https://kling.ai/blog/kling-4-ai-video-model
  - https://www.krea.ai/models/kling-4/prompt-guide (summary of Kling's 14 Oct 2026 guide)
---
# Kling — prompt notes

**Order (Kling 4 guide):** reference roles → scene → timed beats → camera.

- **References:** give every attached asset a role in the first lines: "@image1 is the character", "@image2 defines the jacket — keep its color and stitching", "@video1 gives the camera move". Unlabeled references make the model guess.
- With a start image: don't describe the image again (identity/text may drift) — describe only what moves and what the camera does.
- Concrete visuals, no abstract adjectives ("premium", "vintage"): name light, material, wear.
- Name characters/objects once and reuse the same words.
- **Timed beats** for longer clips: `0–4s: …`, `4–10s: …`, `10s–end: …` — one action and one camera behavior per range. Repeat the character description when the shot changes.
- **Camera:** shot size + behavior: locked, push in, orbit, tracking, long take with no cuts.
- **Sound:** ambient bed first, then each effect as its own sentence. Dialogue: label each line with character, tone, language/accent; write the line in its own language.
- Only two negatives are worth adding: "No subtitles." and "No background music." when not wanted (the model may add both).
- Keyframes: describe the motion between frames; keep big changes (day → night) for separate clips.

**Example:** @image1 defines the jacket; preserve its color and stitching. Slow orbit around a model in a grey studio, soft key light from the left. 0–5s: she turns toward the camera and adjusts the collar. 5s–end: she steps forward into a close-up, fabric catching the light. Low room tone, footsteps on concrete. No subtitles. No background music.
