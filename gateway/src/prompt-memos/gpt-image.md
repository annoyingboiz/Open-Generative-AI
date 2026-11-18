---
id: gpt-image
name: OpenAI GPT Image (2.x)
kind: image
match: "^gpt-image"
sources:
  - https://developers.openai.com/api/docs/guides/image-prompting
  - https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide
blocks: [Scene, Subject, Details, Text, Constraints]
look: end
---
# GPT Image — prompt notes

- State the result first: what it is and what it's for (poster, product photo, UI screen), composition, aspect, placement.
- Order: scene/background → subject → important details → constraints. For complex requests use labeled sections — "Scene:", "Subject:", "Details:", "Constraints:" — or JSON-like structure; prose is fine too.
- **Text:** exact wording in quotes, with position and typography; spell unusual names letter by letter; say how many times text appears; "no other text".
- **Edits:** "Change only X." then list what must stay the same — identity, geometry, layout, lighting, labels, background (and nearby objects for local edits).
- **Several references:** number each input and give its role (subject, style, clothing, background) and how they combine.
- Photoreal: say "photorealistic" / "real photograph"; describe framing, textures, materials, light, color; lens/film names are appearance cues.
- People: framing, gaze, pose, interaction with objects.
- Exclude explicitly what tends to appear: extra text, logos, watermarks, busy backdrops.
- Avoid vague mood words without visual cues, tiny dense text, concept-art language for UI mockups.


## Output format
Labeled sections, one per line:
Scene: background/environment and format (poster, product photo, UI…).
Subject: the main subject; references by number and role.
Details: materials, light, camera look, composition, style.
Text: exact strings in quotes with position and typography (omit if no text).
Constraints: what must stay the same (edits) and what must not appear.
JSON prompts: keys scene, subject, details, text, constraints.

**Example:**
Scene: rainy evening street at eye level, neon signs reflecting on wet asphalt.
Subject: a woman in a red raincoat looking over her shoulder, full body visible.
Details: photorealistic, natural film grain, visible fabric texture.
Constraints: no text or watermarks.
