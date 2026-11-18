---
id: grok-imagine
name: xAI Grok Imagine (video)
kind: video
match: "^grok-imagine"
sources:
  - https://docs.x.ai/docs/guides/video-generation
  - xAI Grok Imagine video page (describe subject, action, camera movement, lighting, mood, sound)
blocks: [Subject, Action, Camera, Light, Sound]
look: blocks
look_camera: Camera
look_style: Light
---
# Grok Imagine Video — prompt notes

- xAI's guidance: describe the shot — subject, action, camera movement, lighting, mood — and the sound; video comes with sound by default, so say what should be heard.
- Give it something moving: one clear action that develops over the clip.
- Image-to-video: keep the prompt about motion and camera ("make the water crash down and slowly pan out"); state what must stay unchanged (face, product, text).
- Reference-to-video: references guide what appears without forcing the first frame — say what each reference contributes.
- Editing a video: one instruction about what to change ("give the woman a silver necklace"); the rest of the scene is preserved.
- Short, direct prompts work; add lighting and lens only when it matters.


## Output format
Two to four sentences: subject and its action → camera movement → lighting and mood → sound. Image-to-video: motion, camera and what stays unchanged.
JSON prompts: keys subject, action, camera, lighting, sound.

**Example:** Low-angle tracking shot of a vintage motorbike speeding along a coastal road at sunset, dust trailing behind, camera slowly rising to reveal the sea. Warm backlight, light haze. Engine roar fading into crashing waves.
