---
id: kling
name: Kling (4.0, O3, 3.x)
kind: video
match: "^kling"
sources:
  - https://kling.ai/blog/kling-4-ai-video-model
  - https://www.krea.ai/models/kling-4/prompt-guide (summary of Kling's 14 Oct 2026 guide)
blocks: [References, Scene, Beats, Camera, Sound]
look: labeled
look_framing: true
look_camera: Camera
look_style: Camera
---
# Kling — prompt notes

**Order (Kling 4 guide):** reference roles → scene → timed beats → camera.

- **References:** give every attached asset a role in the first lines: "@img1 is the character", "@img2 defines the jacket — keep its color and stitching", "@vid1 gives the camera move". Unlabeled references make the model guess.
- With a start image: don't describe the image again (identity/text may drift) — describe only what moves and what the camera does.
- Concrete visuals, no abstract adjectives ("premium", "vintage"): name light, material, wear.
- Name characters/objects once and reuse the same words.
- **Timed beats** for longer clips: `0–4s: …`, `4–10s: …`, `10s–end: …` — one action and one camera behavior per range. Repeat the character description when the shot changes.
- **Camera:** shot size + behavior: locked, push in, orbit, tracking, long take with no cuts.
- **Sound:** ambient bed first, then each effect as its own sentence. Dialogue: label each line with character, tone, language/accent; write the line in its own language.
- Only two negatives are worth adding: "No subtitles." and "No background music." when not wanted (the model may add both).
- Keyframes: describe the motion between frames; keep big changes (day → night) for separate clips.


## Output format
Labeled blocks, one per line, in this order:
References: "@tag is / defines …" for every attached asset (skip if none).
Scene: who and where, concrete visuals, named once.
Beats: "0–4s: …", "4–10s: …", "10s–end: …" — one action per range (a single short clip may have one range).
Camera: shot size + behavior per range (locked, push in, orbit, tracking, long take).
Sound: ambient bed first, then each effect; dialogue lines labeled with character, tone, language; "No subtitles." / "No background music." if not wanted.
JSON prompts: keys references, scene, beats, camera, sound.

**Example:**
References: @img1 defines the jacket; preserve its color and stitching.
Scene: a model in a grey studio, soft key light from the left.
Beats: 0–5s: she turns toward the camera and adjusts the collar. 5s–end: she steps forward into a close-up, fabric catching the light.
Camera: slow orbit, then a gentle push-in on the close-up.
Sound: low room tone, footsteps on concrete. No subtitles. No background music.
