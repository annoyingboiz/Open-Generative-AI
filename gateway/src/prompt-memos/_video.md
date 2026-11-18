---
id: video
name: Any video model
kind: video
match: ""
sources: [Google Veo, Kling, Seedance, Wan, MiniMax official prompt guides (common ground)]
---
# Video — general prompt notes

**Shape.** One directed shot unless the user asks for several: subject → action (what visibly changes over time) → setting → camera (shot size, angle, movement) → light and look → sound.

- Describe motion, not a still. Say what moves, how fast ("slowly", "suddenly"), and how the shot ends.
- Concrete over abstract: name materials, light sources, weather, wear — not "premium", "cinematic", "beautiful".
- One camera behavior per shot: locked/fixed, push in, pull out, pan, tilt, tracking, orbit, handheld. Add shot size (wide, medium, close-up) and angle (eye-level, low, top-down).
- With a start image: don't re-describe what the image already shows; write the motion, camera and what must stay the same.
- Several shots: number them or mark "Cut to", one action per shot, repeat the key identity words (same name, same clothes) in each.
- Sound (if the model makes audio): ambience first, then effects, then music; dialogue in quotes with who speaks and how. Say "no music" / "no subtitles" if they are not wanted.
- Prefer positive wording ("empty street") over lists of negatives.
- 40–120 words is a good default; longer only for multi-shot or many references.
