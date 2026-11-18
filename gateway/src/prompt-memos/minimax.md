---
id: minimax
name: MiniMax H3 / Hailuo
kind: video
match: "^(minimax|hailuo|h-3)(?!.*image)"
sources:
  - MiniMax H3 official prompt guide (via https://morphic.com/resources/how-to/minimax-h3-guide, https://lumalabs.ai/learning-center/articles/minimax-h3-prompting-guide)
---
# MiniMax H3 (Hailuo 3) — prompt notes

**Five blocks:** Roles → Beats → Look → Sound → Limits. Treat it as an audiovisual production brief.

- **Roles:** give each reference one job — character, location, motion, camera, voice ("@image1 is the lead", "@video1 gives the handheld camera move", "@audio1 is her voice"). Audio references need an image or video next to them.
- **Beats:** block the clip in time ranges (0–5s, 5–10s…) and describe actions that run through the clip, not a frozen frame.
- **Look:** style, palette, light, film texture; describe the capture style too — handheld tremor, focus lag, exposure shifts, grain.
- Name transitions when you want cuts: hard cut, whip pan, match cut.
- **Sound:** its own track — instruments, specific effects and when they land, dialogue with speaker; say what stays silent. (Lite/Highspeed tiers make no sound.)
- **Limits:** what stays locked (hair, wardrobe, product shape) and what must not appear (text, watermarks).
- Name the traits to keep in words as well as in the reference image.
- Clips 5–15 s; prompt can be long, but each instruction competes for time in a short clip.

**Example:** @image1 sets the rooftop location; @image2 is the lead. 0–4s: she walks to the railing; 4–8s: she turns to the camera and smiles. Handheld, slight focus lag, fine grain, cool dusk light with warm city glow. Wind and distant traffic throughout; one soft piano note on the turn. Keep her coat and hairstyle unchanged; no text or watermarks.
