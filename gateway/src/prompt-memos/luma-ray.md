---
id: luma-ray
name: Luma Ray 3.x
kind: video
match: "^ray-"
sources:
  - https://lumaai-help.freshdesk.com/support/solutions/articles/151000223059-how-do-i-use-ray3-prompting-effectively-
  - https://lumalabs.ai/learning-center/articles/luma-video-models-field-guide
blocks: [Camera, Action, Environment, Physics, Light, Mood]
---
# Luma Ray 3 — prompt notes

- Write like a shot description in natural, detailed language — subject, action, setting, camera, mood — not keywords. Ray interprets every word, so avoid vague or contradictory phrases.
- Layer elements: camera movement, detailed action, environment, physical behavior (falling objects, steam, cloth, water), lighting specifics, overall mood.
- Concrete nouns and observable motion beat "make it cinematic".
- Keyframes (start/end or several): treat them as visual anchors and describe the motion between them.
- Reinforce framing in words when it matters ("epic wide shot, 21:9").
- Modify (video-to-video): describe the new look; lower strength keeps more of the source.


## Output format
One flowing shot description: camera movement → detailed action → environment → physical behavior (cloth, water, steam, falling objects) → light → mood.
JSON prompts: keys camera, action, environment, physics, lighting, mood.

**Example:** Slow overhead crane shot descending into a busy restaurant kitchen. A chef tosses vegetables in a flaming wok; peppers arc through the air and land back in the pan, steam billows past the lens. Hard tungsten light, stainless steel reflections, energetic and warm.
