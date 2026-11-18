---
id: flux
name: Black Forest Labs FLUX (2, 3)
kind: image
match: "^flux"
sources:
  - https://docs.bfl.ai/guides/prompting_guide_flux2
---
# FLUX — prompt notes

- **Subject + Action + Style + Context**, most important first — word order is priority.
- Length: 10–30 words to explore, 30–80 for most work, 80+ for complex scenes.
- **No negative prompts** — describe what you want ("sharp focus throughout", not "no blur").
- JSON prompts work as well as prose for multi-subject scenes: keys like scene, subjects (description, position, action), style, color_palette, lighting, mood, background, composition, camera. Keep the user's JSON if they wrote one.
- Text: exact words in quotes + placement, font style, size, color.
- Colors: "color #C4725A" or "hex #…" tied to a specific object; gradients name both ends and where.
- Multi-reference: give each input a role (clothing from one, style from another, background from a third).
- Camera cues work as look descriptors ("shot on Sony A7IV, 85mm lens").

**Example:** Ceramic mug in color #0047AB on a white marble counter, soft morning window light, shot on Sony A7IV, 85mm lens, shallow depth of field.
