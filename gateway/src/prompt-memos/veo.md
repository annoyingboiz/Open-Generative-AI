---
id: veo
name: Google Veo 3.1
kind: video
match: "^veo"
sources:
  - https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1
  - https://ai.google.dev/gemini-api/docs/video (Veo prompt guide)
blocks: [Cinematography, Subject, Action, Context, Style, Audio]
look: start
look_camera: Cinematography
look_style: Style
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


## Output format
Google's five parts plus audio, one labeled block per line:
Cinematography: shot size, angle, lens feel, camera movement.
Subject: who/what with identifying details (references by @tag and role).
Action: what happens over the clip.
Context: place, time, weather, background.
Style & ambiance: light, color, film look, mood.
Audio: Dialogue: speaker + "quoted line" with delivery · SFX: … · Ambient: … (or "No dialogue." / music choice).
JSON prompts: keys cinematography, subject, action, context, style, audio.

**Example:**
Cinematography: medium tracking shot at waist height, slow dolly back, shallow depth of field.
Subject: a bartender in a black linen apron.
Action: he slides a frosted coupe across a walnut bar toward camera; condensation beads on the glass.
Context: a late-night cocktail bar, amber practical lights, bottles blurred behind.
Style & ambiance: moody, warm, filmic contrast.
Audio: Ambient: low chatter and a jazz trio in the next room. SFX: glass gliding on wood. No subtitles.
