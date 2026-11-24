---
id: seedance
name: ByteDance Seedance (2.x)
kind: video
match: "^seedance"
sources:
  - Seedance 2.5 Prompt Guide and User Guide (ByteDance / Volcengine / BytePlus)
  - https://kylon.io/blog/seedance-2-5-prompt-guide-2026 (summary of the official guides)
blocks: [References, Subject, Action, Scene, Style, Camera, Sound]
look: labeled
look_framing: true
look_camera: Camera
look_style: Style
---
# Seedance 2.x — prompt notes

**Formula (official):** Subject + action/event + scene & environment + visual style + camera (shot size, angle, movement, cut) + sound. Skip parts you don't need; write them as separate short layers, not one dense paragraph.

- **References:** map every upload explicitly: "@img1 is the mug — use its shape and glaze, do not use its background", "@vid1 gives only the camera movement", "@aud1 is the narrator's voice". Say what each reference must NOT bring in.
- Multi-angle product shots: say all views are the same single object, only one instance appears.
- **Continuity:** name what must hold — identity, number of characters, clothing, who holds which prop, direction of travel, product shape, logo. "Keep it consistent" alone is too vague.
- **Longer stories (up to ~30 s):** consecutive stages; each has a start state, one main event, a visible end state. Later stages begin "Continue from the previous stage:" + facts that must not change. Timestamps only for critical beats (entrances, cuts).
- **Sound syntax:** (music) · <sound effect> · {dialogue}. State the dialogue language and delivery before the line.
- With a start image: spend the words on motion and camera, not on re-describing the image.
- Exact wordmarks, UI labels or legal copy are unreliable — keep on-screen text short or leave it for editing.
- Camera and timing instructions separate from the subject description.
- 60–120 words for a single shot works well.

**Framing (docs/ux/48–51; measured in REPORT-shot-size, stages 13–22).** The app adds a FRAMING block from the focal length when the prompt has none. When the shot is waist up or tighter and a picture of the place is attached, write a `FRAMING` line yourself so the shot does not come out wider:
- where in the place the subject is, by a detail you can see in the place picture ("at the left end of the counter, next to the small brass lamp");
- where the camera is (distance and height: "20 centimetres from the glass, at the height of its middle");
- the frame edges on the subject ("top edge just above the rim, bottom edge just below the base").
For an object as the main subject (a product shot), give its share of the frame height: about one third (35 mm), about half (50 mm, tested), three quarters (85 mm, tested), a detail fills the frame (135 mm), small in the scene (24 mm). 24, 35 and 135 are untested.
Describe only what is inside the frame for that shot size: drop or rewrite what would be outside it ("a hand with a mixing glass pours" → "a thin stream pours from above the top edge of the frame") and list it in left_out.

## Output format
One labeled block per line, in this order (drop a block only if it truly doesn't apply):
References: one sentence per @tag — what it defines and what NOT to take from it.
Subject: who/what, with the details that must stay the same.
Action: the main event, what visibly changes; for longer clips "Stage 1: … Stage 2: Continue from the previous stage: …".
Scene: place, time, weather, background.
Framing: only when the Framing notes above call for it — the subject's place, the camera's place, the frame edges.
Style: look, light, color, texture.
Camera: shot size, angle, movement, cuts (timestamps only for key beats).
Sound: (music) <sound effects> {dialogue} — dialogue language and delivery before the line.
JSON prompts: the same blocks as keys — references, subject, action, scene, framing (when needed), style, camera, sound.

**Example:**
References: @img1 defines the ceramic mug's shape and glaze; do not use its background.
Subject: one white ceramic mug with a sage glaze, the only mug in the scene.
Action: Stage 1: a hand lifts the mug from a walnut table to chest height. Stage 2: Continue from the previous stage, same mug and table: steam rises as the mug turns toward camera.
Scene: a quiet kitchen in the early morning, rain on the window behind.
Style: warm window light, soft shadows, shallow depth of field, natural color.
Camera: medium close-up, slow push-in, no cuts.
Sound: (gentle acoustic guitar) <soft ceramic clink> Dialogue in English, calm narrator: {Start your morning slow.}
