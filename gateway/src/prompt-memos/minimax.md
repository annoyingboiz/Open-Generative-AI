---
id: minimax
name: MiniMax H3 / Hailuo
kind: video
match: "^(minimax|hailuo|h-3)(?!.*image)"
sources:
  - MiniMax H3 official prompt guide (via https://morphic.com/resources/how-to/minimax-h3-guide, https://lumalabs.ai/learning-center/articles/minimax-h3-prompting-guide)
blocks: [Roles, Beats, Look, Sound, Limits]
look: blocks
look_camera: Look
look_style: Look
---
# MiniMax H3 (Hailuo 3) — prompt notes

**Five blocks:** Roles → Beats → Look → Sound → Limits. Treat it as an audiovisual production brief.

- **Roles:** give each reference one job — character, location, motion, camera, voice ("@img1 is the lead", "@vid1 gives the handheld camera move", "@aud1 is her voice"). Audio references need an image or video next to them.
- **Beats:** block the clip in time ranges (0–5s, 5–10s…) and describe actions that run through the clip, not a frozen frame.
- **Look:** style, palette, light, film texture; describe the capture style too — handheld tremor, focus lag, exposure shifts, grain.
- Name transitions when you want cuts: hard cut, whip pan, match cut.
- **Sound:** its own track — instruments, specific effects and when they land, dialogue with speaker; say what stays silent. (Lite/Highspeed tiers make no sound.)
- **Limits:** what stays locked (hair, wardrobe, product shape) and what must not appear (text, watermarks).
- Name the traits to keep in words as well as in the reference image.
- Clips 5–15 s; prompt can be long, but each instruction competes for time in a short clip.


## Output format
Five labeled blocks, one per line, in this order:
Roles: one job per reference (@tag — character / location / motion / camera / voice).
Beats: time ranges covering the whole clip, e.g. "0–4s: … 4–8s: …", actions that run, not frozen frames.
Look: style, palette, light, film texture, capture style (handheld, focus lag, grain), transitions if any.
Sound: ambience, effects and when they land, music, dialogue with speaker; what stays silent.
Limits: what stays locked (identity, wardrobe, product) and what must not appear.
JSON prompts: keys roles, beats, look, sound, limits.

**Example:**
Roles: @img1 sets the rooftop location; @img2 is the lead.
Beats: 0–4s: she walks to the railing, coat moving in the wind. 4–8s: she turns to camera and smiles.
Look: cool dusk light with warm city glow, handheld, slight focus lag, fine grain.
Sound: wind and distant traffic throughout; one soft piano note on the turn; no dialogue.
Limits: keep her coat and hairstyle unchanged; no text or watermarks.
