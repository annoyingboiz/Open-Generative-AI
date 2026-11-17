// Tools that run on fal.ai (https://fal.ai): Topaz image upscaling for now.
// One spec drives both sides: the studio draws its controls from it (sent in
// /dz/catalog.js), and the gateway uses it to keep only valid fields, clamp
// values and price a request.
//
// Sources (fetched 2026-11-17):
//   https://fal.ai/models/topaz/upscale/image/precision/llms.txt
//   https://fal.ai/models/topaz/upscale/image/generative/llms.txt
//   https://fal.ai/models/topaz/upscale/image/creative/llms.txt

const range = (key, label, { min = 0, max = 1, step = 0.01, def = null, hint } = {}) => ({ key, type: 'range', label, min, max, step, default: def, hint });
const int = (key, label, min, max, { def = null, hint } = {}) => ({ key, type: 'range', label, min, max, step: 1, default: def, hint });
const bool = (key, label, def, hint) => ({ key, type: 'bool', label, default: def, hint });
const select = (key, label, options, def, hint) => ({ key, type: 'select', label, options, default: def, hint });
const text = (key, label, max, hint) => ({ key, type: 'text', label, max, default: '', hint });

const FACE = [
  bool('face_enhancement', 'Face enhancement', true, 'Restores faces separately from the rest of the image.'),
  range('face_enhancement_strength', 'Face strength', { def: 0.8, hint: 'How strongly faces are restored.' }),
  range('face_enhancement_creativity', 'Face creativity', { def: 0, hint: 'Higher values may invent facial detail.' }),
];
const SUBJECT = select('subject_detection', 'Subject', ['All', 'Foreground', 'Background'], 'All', 'Which part of the image to enhance.');
// No default: the model picks its own value when the field is left on "Auto".
const SHARPEN = range('sharpen', 'Sharpen');
const DENOISE = range('denoise', 'Denoise');
const FIX_COMPRESSION = range('fix_compression', 'Fix compression', { hint: 'Removes JPEG artifacts.' });
const ENHANCEMENT = select('enhancement_strength', 'Enhancement', ['low', 'medium', 'high'], null, 'Leave on Auto to let the model decide.');

// price: $usd per started `mp` megapixels of output.
const PRECISION_PRICE = { usd: 0.08, mp: 24 };
const GEN_FAST_PRICE = { usd: 0.08, mp: 8 };
const GEN_PRICE = { usd: 0.08, mp: 4 };

export const FAL_UPSCALE = Object.freeze({
  id: 'upscale',
  name: 'Upscale',
  factor: { min: 1, max: 4, default: 2 },
  common: [select('output_format', 'Format', ['jpeg', 'png'], 'jpeg', 'PNG keeps every detail but files are much larger.')],
  groups: [
    {
      id: 'precision',
      name: 'Precision',
      hint: 'Faithful: sharpens and cleans up without inventing details.',
      endpoint: 'topaz/upscale/image/precision',
      models: [
        { id: 'Standard V2', hint: 'Balanced, works for most images.', price: PRECISION_PRICE, fields: [...FACE, SUBJECT, SHARPEN, DENOISE, FIX_COMPRESSION] },
        { id: 'High Fidelity V3', hint: 'Keeps fine detail of good photos.', price: PRECISION_PRICE, fields: [...FACE, SUBJECT, SHARPEN, DENOISE, FIX_COMPRESSION] },
        { id: 'High Fidelity V2', hint: 'Previous high-fidelity model.', price: PRECISION_PRICE, fields: [...FACE, SUBJECT, SHARPEN, DENOISE, FIX_COMPRESSION] },
        { id: 'Low Resolution V2', hint: 'For small or web-sized images.', price: PRECISION_PRICE, fields: [...FACE, SUBJECT, SHARPEN, DENOISE, FIX_COMPRESSION] },
        { id: 'CGI', hint: 'For renders, 3D and digital art.', price: PRECISION_PRICE, fields: [...FACE, SUBJECT, SHARPEN, DENOISE] },
        { id: 'Text Refine', hint: 'Keeps text and lines crisp.', price: PRECISION_PRICE, fields: [...FACE, SUBJECT, SHARPEN, DENOISE, FIX_COMPRESSION, range('strength', 'Strength', { min: 0.01 })] },
        { id: 'Faces', hint: 'Face Recovery 3: portraits and close-ups.', price: PRECISION_PRICE, fields: [...FACE, SUBJECT] },
      ],
    },
    {
      id: 'generative',
      name: 'Generative',
      hint: 'Rebuilds detail with AI: best for soft, small or AI-generated images.',
      endpoint: 'topaz/upscale/image/generative',
      models: [
        // Price of Wonder 4 is not published; assumed like the other generative models.
        { id: 'Wonder 4', hint: 'Newest. Handles faces itself, no settings.', price: { ...GEN_PRICE, assumed: true }, fields: [] },
        { id: 'Wonder 3.5', hint: 'Natural detail, cheaper per megapixel.', price: GEN_FAST_PRICE, fields: [...FACE, ENHANCEMENT] },
        { id: 'Wonder 3', hint: 'Natural detail, cheaper per megapixel.', price: GEN_FAST_PRICE, fields: [...FACE, SUBJECT, ENHANCEMENT] },
        { id: 'Wonder 2', price: GEN_PRICE, fields: [...FACE] },
        { id: 'Wonder', price: GEN_PRICE, fields: [...FACE] },
        { id: 'Recover 3', hint: 'Repairs very damaged or tiny images.', price: GEN_PRICE, fields: [...FACE] },
        { id: 'Standard MAX', price: GEN_PRICE, fields: [...FACE] },
        {
          id: 'Redefine',
          hint: 'Creative: can change textures and invent detail; use a prompt.',
          price: GEN_PRICE,
          fields: [
            ...FACE,
            int('creativity', 'Creativity', 1, 6, { def: 2 }),
            int('texture', 'Texture', 1, 5, { def: 1 }),
            text('prompt', 'Prompt', 1024, 'What the image shows. Leave empty with Auto prompt on.'),
            bool('autoprompt', 'Auto prompt', true),
            SHARPEN,
            DENOISE,
          ],
        },
        { id: 'Recovery V2', hint: 'Old or heavily compressed photos.', price: GEN_PRICE, fields: [...FACE, SUBJECT, range('detail', 'Detail')] },
        { id: 'Recovery', price: GEN_PRICE, fields: [...FACE, SUBJECT] },
      ],
    },
    {
      id: 'creative',
      name: 'Creative',
      hint: 'Bloom: reimagines the image at higher resolution. Most expensive.',
      endpoint: 'topaz/upscale/image/creative',
      models: [
        { id: 'Bloom 2', price: { usd: 0.08, mp: 2 }, fields: [int('creativity', 'Creativity', 1, 9, { def: 3 }), bool('autoprompt', 'Auto prompt', true), bool('color_preservation', 'Keep colors', true)] },
        { id: 'Bloom', price: { usd: 0.08, mp: 2 }, fields: [] },
        { id: 'Bloom Realism', price: { usd: 0.08, mp: 2 }, fields: [] },
      ],
    },
  ],
});

export const FAL_TOOL_ENDPOINTS = FAL_UPSCALE.groups.map((g) => g.endpoint);

export function falTool(endpoint) {
  const group = FAL_UPSCALE.groups.find((g) => g.endpoint === endpoint);
  return group ? { tool: FAL_UPSCALE, group, kind: 'image' } : null;
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// Keeps only the fields the chosen model understands, with values in range.
export function falBody(endpoint, body = {}) {
  const found = falTool(endpoint);
  if (!found) throw new Error(`Unknown fal tool: ${endpoint}`);
  const { group, tool } = found;
  const model = group.models.find((m) => m.id === body.model) || group.models[0];
  const out = { image_url: body.image_url, model: model.id };
  const factor = Number(body.upscale_factor);
  out.upscale_factor = Number.isFinite(factor) ? clamp(factor, tool.factor.min, tool.factor.max) : tool.factor.default;
  for (const field of [...tool.common, ...model.fields]) {
    const v = body[field.key];
    if (v === undefined || v === null || v === '') continue;
    if (field.type === 'range') {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      out[field.key] = field.step === 1 ? Math.round(clamp(n, field.min, field.max)) : clamp(n, field.min, field.max);
    } else if (field.type === 'bool') {
      out[field.key] = v === true || v === 'true';
    } else if (field.type === 'select') {
      if (field.options.includes(v)) out[field.key] = v;
    } else if (field.type === 'text') {
      out[field.key] = String(v).slice(0, field.max);
    }
  }
  return out;
}

// Price from the published per-megapixel rates: → { usd, exact, outputMp }.
export function falPrice(endpoint, body, input) {
  const found = falTool(endpoint);
  if (!found || !input?.width || !input?.height) return null;
  const model = found.group.models.find((m) => m.id === body.model) || found.group.models[0];
  const factor = Number(body.upscale_factor) || found.tool.factor.default;
  const outputMp = (input.width * factor * input.height * factor) / 1e6;
  const usd = Math.max(1, Math.ceil(outputMp / model.price.mp - 1e-9)) * model.price.usd;
  return { usd: Math.round(usd * 100) / 100, exact: !model.price.assumed, outputMp };
}
