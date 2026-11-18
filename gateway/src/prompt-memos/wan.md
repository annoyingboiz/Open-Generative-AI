---
id: wan
name: Alibaba Wan (2.5–3)
kind: video
match: "^(wan|van)-"
sources:
  - https://www.alibabacloud.com/help/en/model-studio/text-to-video-prompt (Model Studio text/image-to-video prompt guide)
blocks: [Entity, Scene, Motion, Aesthetics, Style, Sound]
look: end
---
# Wan — prompt notes

**Formulas (Alibaba):**
- Basic: Entity + Scene + Motion.
- Advanced: Entity + Scene + Motion + Aesthetic control (light, shot size, angle, lens, camera move) + Stylization.
- Image-to-video: Motion + Camera movement — the image already sets subject, scene and style. Use "fixed camera" to keep it still.
- Reference-to-video (2.7/3): Reference + Action + Scene (+ lines, + music).

- Vocabulary: shot sizes wide / medium full / medium / medium close-up / close-up; angles low, eye-level, top-down, over-the-shoulder; lenses wide-angle, long-focus, tilt-shift; moves push in, pull out, pan, tracking, orbit, fixed camera.
- Light: source (daylight, firelight, overcast), type (soft, hard, side, rim, back, practical), time (dawn, golden hour, dusk, night), warm/cool, saturation, contrast.
- Speed words ("slowly", "quickly") set the intensity of motion.
- **Multi-shot (2.6+):** overall summary first, then "Shot 1 [0–3s] …", "Shot 2 [3–6s] …", transitions like "Hard cut". For one shot in 2.7 write "Generate single shot."
- **Sound (2.5+):** lines in quotes with emotion, tone, speed, accent; effects as source + action + ambience; music style. "No dialogue." / "No background music." to suppress. For several speakers give unique labels and tie each line to an action.
- Avoid: real people by name, rapid scene changes in one clip, exact on-screen text, long complex action chains, lip-sync to exact words.


## Output format
Prose in the formula order — entity, scene, motion, aesthetic control (light, shot size, angle, lens, camera move), stylization, then sound — one or two sentences each. Multi-shot: an overall line, then "Shot 1 [0–3s] …" lines. Image-to-video: motion and camera only.
JSON prompts: keys entity, scene, motion, aesthetics, style, sound (or shots: [...]).

**Example:** Medium close-up, low angle, soft side light, warm tones. A weathered sailor grips a wet rope on a storm-tossed deck, spray hitting his face. Camera slowly pushes in. Howling wind and creaking timber, no background music.
