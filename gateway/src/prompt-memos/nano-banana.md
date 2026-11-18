---
id: nano-banana
name: Google Nano Banana (Gemini image: 2, Pro)
kind: image
match: "^nano-banana"
sources:
  - https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana
  - https://blog.google/products/gemini/prompting-tips-nano-banana-pro/
---
# Nano Banana — prompt notes

**Frameworks (Google):**
- Text-to-image: Subject + Action + Location/context + Composition + Style.
- With references: Reference images + relationship instruction + new scenario.
- Editing: what changes + what stays the same.

- Describe the scene in sentences; don't list keywords.
- Start edit prompts with a strong verb: Remove, Replace, Combine, Transform, Restyle.
- Positive framing: "an empty street", not "no cars".
- Refer to each reference by its role: "use @image1 as the structure and @image2 as the fabric texture"; up to 14 references help keep a character or product consistent.
- Text: exact words in quotes + font or style ("bold white sans-serif") + placement; one language per text block.
- Camera/look vocabulary works: "low-angle, shallow depth of field (f/1.8)", "macro lens", "aerial view", "GoPro", "disposable-camera flash", "1980s color film, slightly grainy".
- Lighting: "three-point softbox", "chiaroscuro, hard contrast", "golden-hour backlight".
- Name materials precisely ("navy tweed", "matte ceramic mug").
- Aspect ratio and resolution are settings, not prompt words.
- JSON prompts work well for complex scenes — keep the user's JSON structure.

**Example:** A fashion model in a tailored brown dress holding a structured handbag, posing confidently against a seamless cherry-red backdrop. Medium-full shot, center-framed. Fashion editorial, medium-format analog film, pronounced grain, soft cinematic key light.
