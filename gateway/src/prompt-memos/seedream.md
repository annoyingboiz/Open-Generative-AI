---
id: seedream
name: ByteDance Seedream (4.x, 5)
kind: image
match: "^seedream"
sources:
  - https://runware.ai/docs/models/bytedance-seedream-5-0-pro/guides/prompting
  - ByteDance Seed — Seedream 5.0 Pro launch notes
blocks: [Format, Subject, Composition, Lighting, Text, Style]
---
# Seedream — prompt notes

- Layer the prompt: **format → subject → composition → lighting → in-image text → style.** Name the format first (magazine cover, poster, packshot) so space for text is reserved.
- Exact copy for titles and labels, in quotes; Seedream handles many languages, write the text in its target language.
- **References** (up to ~10): use them for identity — geometry, materials, logos; use prose for what should be reinterpreted. Describe each reference by its content as well as its @tag ("@image1, the white sneaker").
- Prefer clean packshot references over lifestyle photos of the same product.
- **Edits:** one change per run; pin what must not change by name (silhouette, camera angle, backdrop, lighting) — unmentioned things drift. Reuse the same pin clause across variants.
- Fusion: describe composition and light in the prompt; references supply the product identity.
- Keep under ~600 words; tighten unclear clauses instead of adding more.


## Output format
Layered sentences in this order: format → subject → composition → lighting → in-image text (quoted) → style. Edits: the one change, then a "Keep …" clause pinning what must not change.
JSON prompts: keys format, subject, composition, lighting, text, style (and keep for edits).

**Example:** A square packshot of a ceramic pour-over dripper on a pale oak tabletop, soft window light from the left. Keep the dripper's exact silhouette, camera angle and backdrop from @image1; change only the glaze to matte sage green.
