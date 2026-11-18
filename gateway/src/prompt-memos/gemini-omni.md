---
id: gemini-omni
name: Google Gemini Omni Flash (video)
kind: video
match: "^gemini-omni"
sources:
  - https://runware.ai/docs/models/google-gemini-omni-flash-1-2/guides/prompting
  - Google AI "Mastering Gemini Omni" video prompting tips (May 2026)
blocks: [Subject, Action, Setting, Camera, Lighting, Audio, Exclusions]
look: blocks
look_camera: Camera
look_style: Lighting
---
# Gemini Omni Flash — prompt notes

**Layers:** subject, action, setting, camera, lighting, audio — then exclusions. Clauses or full sentences both work. Anything left out is the model's choice; Google notes Omni needs less prescriptive prompts than older models, so specify only what must be fixed.

- **One shot or several:** without direction it may cut. For one take write "single continuous shot" / "no scene cuts" and put the camera move in that sentence. For sequences mark each new shot with "Cut to".
- **Timing:** bracketed timecodes, one per line, back to back to the clip length: `[0-3s] …`, or plain cues ("after three seconds") inside one shot.
- **Audio (no separate parameter):** music with genre and mood, ambience behind the action; dialogue: who speaks + exact words in quotes ("says to the camera, '…'"). For voiceover name the off-screen speaker and say the on-screen person does not speak.
- **On-screen text:** quote each string exactly, say where it appears and when; keep strings short.
- **Exclusions** as sentences: "No music.", "No dialogue.", "No subtitles.", "No on-screen text." — never contradicting a layer you asked for.
- References: describe what each reference is in plain words (the woman from the first image, the red sneaker), keep the @tags the user wrote.
- Real-world knowledge works: name real places, objects, techniques.


## Output format
Sentences in this order: subject, action, setting, camera (with "Single continuous shot" or "Cut to" markers), lighting, audio, then exclusions as short sentences ("No subtitles."). Timecodes "[0-3s] …" on their own lines when timing matters.
JSON prompts: keys subject, action, setting, camera, lighting, audio, exclusions.

**Example:** A barista in a white apron steams milk at a café counter. Single continuous shot, slow push-in at waist height, morning window light. Audio: the hiss of the steam wand over soft jazz. No dialogue. No on-screen text.
