---
id: qwen-image
name: Alibaba Qwen Image (2)
kind: image
match: "^qwen-image"
sources:
  - https://help.aliyun.com/en/model-studio/qwen-image-api
  - https://fal.ai/learn/tools/how-to-use-qwen-image-2
blocks: [Layout, Subject, Background, Text, Style]
---
# Qwen Image — prompt notes

- Built on a vision-language encoder: it understands conversational, long prompts (up to ~1,000 tokens) — write full sentences.
- Strongest at text and layouts: posters, slides, infographics, signs, comics. Put every exact string in quotes and say where it goes; describe the overall layout, then each text block, then visual style.
- Chinese and English text can share one image; write each string in its language.
- Spatial relationships are understood — say what is left/right/behind/above.
- Complex scenes: main subject → background → secondary objects.
- Editing is the same model: say what to change and what to keep.
- The provider may rewrite short prompts by itself; a detailed prompt keeps more control.


## Output format
Full sentences: overall layout/format → main subject → background and secondary objects (with positions) → each text block quoted with its place → style and light.
JSON prompts: keys layout, subject, background, text_blocks, style.

**Example:** A winter street in Beijing with two traditional shops side by side. A neon sign by the left entrance reads "Fine Detailing". Between the shops a snowman holds a small blackboard; chalk on it reads "Grand Opening". Soft evening light, light snowfall, warm shop windows.
