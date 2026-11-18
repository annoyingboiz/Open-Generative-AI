---
id: image
name: Any image model
kind: image
match: ""
sources: [Google Nano Banana, OpenAI GPT Image, BFL FLUX.2, ByteDance Seedream official prompt guides (common ground)]
---
# Image — general prompt notes

**Shape.** Format/use (poster, product shot, editorial photo…) → subject → action/pose → setting → composition and camera (shot size, angle, lens look) → light → style/medium → exact text → constraints.

- Write a scene description in sentences, not a keyword pile.
- Concrete details: materials, textures, colors (hex codes are fine for brand colors, tied to a named object), light source and direction.
- Text in the image: exact words in quotes, plus where it goes and its type style. Keep it short.
- References: say what each reference image gives (identity, outfit, style, background, composition) and what to ignore.
- Editing: say "change only …" and list what must stay the same (identity, pose, framing, light, background, labels).
- Photoreal: say "photograph"/"photorealistic" and give a camera look (lens, depth of field, film/grain) as appearance cues.
- Positive wording; exclusions only for things the model tends to add (extra text, watermarks, logos).
- 30–100 words usually; longer only for dense layouts.
