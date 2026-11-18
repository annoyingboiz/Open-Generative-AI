---
id: veo
name: Google Veo 3.1
kind: video
match: "^veo"
sources:
  - https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1
  - https://ai.google.dev/gemini-api/docs/video (Veo prompt guide)
---
# Veo 3.1 — prompt notes

**Formula (Google):** Cinematography + Subject + Action + Context + Style & ambiance. Write it like a director's shot description.

- Cinematography first: shot size, angle, lens feel, camera movement (dolly in, crane up, tracking, handheld, static).
- Subject with specific identifying details; one clear action that plays out in the clip length (4–8 s).
- Context: place, time of day, weather, background activity.
- Style & ambiance: light quality and color ("warm golden-hour backlight", "cool overcast"), film look.
- **Audio is generated with the picture.** Write it on separate lines:
  - dialogue in quotation marks with the speaker and delivery: A man says quietly, "We have to leave now."
  - sound effects described plainly, e.g. "SFX: thunder cracks in the distance";
  - ambience/music: "Ambient: rain on a tin roof, no music."
- Image-to-video / first+last frame: describe the motion and transition between frames, not the frames themselves.
- Reference images ("ingredients", up to 3): say which reference is the character, which the product/object, which the style, and keep them consistent.
- Exclusions as plain phrases ("no subtitles", "no text on screen"), not long negative lists.
- Keep one shot per prompt; for sequences generate shots separately and repeat the character description.

**Example:** Medium tracking shot at waist height, slow dolly back. A bartender in a black linen apron slides a frosted coupe across a walnut bar toward camera; condensation beads on the glass. Late-night cocktail bar, amber practical lights, bokeh of bottles behind. Moody, warm, shallow depth of field. Ambient: low chatter and a jazz trio in the next room. SFX: glass gliding on wood. No subtitles.
