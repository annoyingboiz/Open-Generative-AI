import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAtlasVariant, buildApimartVariants, buildStudioLists, toProviderBody, estimateCost, priceLabel } from '../src/catalog/build.js';
import { familyFor } from '../src/catalog/families.js';

const atlasEntry = {
  model: 'kwaivgi/kling-v4.0/image-to-video', type: 'Video', categories: ['IMAGE-TO-VIDEO'],
  displayName: 'Kling Video 4.0 Image-to-Video', price: { actual: { base_price: '0.11', unit: 'second' } },
};
const atlasSchema = { components: { schemas: { Input: {
  required: ['model', 'image'],
  properties: {
    model: { type: 'string', enum: ['kwaivgi/kling-v4.0/image-to-video'] },
    prompt: { type: 'string', default: 'A very long sample prompt that should never be prefilled in the UI field' },
    image: { type: 'string', 'x-format': 'image', 'x-ui-component': 'uploader' },
    last_image: { type: 'string', 'x-format': 'image' },
    duration: { type: 'integer', minimum: 3, maximum: 30, default: 5 },
    ratio: { type: 'string', enum: ['16:9', '9:16'], default: '16:9' },
    enable_sync_mode: { type: 'boolean' },
  },
} } } };

test('family keys merge provider names', () => {
  assert.equal(familyFor('atlas', 'kwaivgi/kling-v4.0/text-to-video'), 'kling-4');
  assert.equal(familyFor('apimart', 'kling-v4'), 'kling-4');
  assert.equal(familyFor('apimart', 'seedance-2-5-flash'), familyFor('atlas', 'bytedance/seedance-2.5-flash/text-to-video'));
  assert.equal(familyFor('apimart', 'gemini-3-pro-image-preview'), familyFor('atlas', 'google/nano-banana-pro/edit'));
  assert.notEqual(familyFor('atlas', 'google/nano-banana-pro/edit-ultra'), familyFor('atlas', 'google/nano-banana-pro/edit'));
});

test('Atlas schema becomes a studio model', () => {
  const v = buildAtlasVariant(atlasEntry, atlasSchema);
  assert.equal(v.mode, 'i2v');
  assert.equal(v.kind, 'video');
  assert.equal(v.model.imageField, 'image');
  assert.equal(v.model.lastImageField, 'last_image');
  assert.equal(v.model.endpoint, 'p/atlas/kwaivgi/kling-v4.0/image-to-video');
  assert.deepEqual(v.model.inputs.duration, { name: 'duration', title: 'Duration', type: 'int', minValue: 3, maxValue: 30, step: 1, default: 5 });
  assert.deepEqual(v.model.inputs.aspect_ratio.enum, ['16:9', '9:16']);
  assert.equal(v.model.inputs.prompt.default, undefined, 'sample prompt is not prefilled');
  assert.ok(!v.model.inputs.enable_sync_mode);
  assert.match(v.model.name, /Atlas · \$0\.11\/s/);
  // Studio request → provider request: renamed, unknown fields dropped.
  const body = toProviderBody(v, { prompt: 'go', image: '/media/u/up_1.png', aspect_ratio: '9:16', duration: 6, images_list: ['x'], foo: 1 });
  assert.deepEqual(body, { prompt: 'go', image: '/media/u/up_1.png', ratio: '9:16', duration: 6 });
  assert.equal(estimateCost(v, { duration: 10 }), 1.1);
});

test('APIMart model with curated fields; image aspect ratio is called size', () => {
  const model = { id: 'gemini-3-pro-image-preview', category: 'image', capability_tags: ['Text to Image'] };
  const override = {
    rename: { aspect_ratio: 'size' },
    common: { inputs: { aspect_ratio: { name: 'aspect_ratio', type: 'string', enum: ['1:1', '16:9'], default: '1:1' } } },
    modes: { t2i: { inputs: {} }, i2i: { inputs: {}, media: { image: { field: 'image_urls', max: 14 } } } },
  };
  const price = { usd: 0.02, unit: 'image', byResolution: { '1k': 0.02, '4k': 0.03 } };
  const vs = buildApimartVariants(model, override, price);
  assert.deepEqual(vs.map((v) => v.mode), ['t2i', 'i2i'], 'docs add image editing even though tags say text-to-image');
  const i2i = vs[1];
  assert.equal(i2i.model.endpoint, 'p/apimart/gemini-3-pro-image-preview?m=i2i');
  assert.equal(i2i.model.imageField, 'image_urls');
  assert.equal(i2i.model.maxImages, 14);
  assert.equal(priceLabel(price), '$0.02–0.03');
  assert.deepEqual(toProviderBody(i2i, { prompt: 'p', aspect_ratio: '16:9', image_urls: ['a'], image_url: 'a' }), { prompt: 'p', size: '16:9', image_urls: ['a'] });
  assert.equal(estimateCost(i2i, { resolution: '4K' }), 0.03);
});

test('cheaper provider is listed last (the studio picks it by default)', () => {
  const atlasT2V = buildAtlasVariant({ ...atlasEntry, model: 'kwaivgi/kling-v4.0/text-to-video', categories: ['TEXT-TO-VIDEO'] },
    { components: { schemas: { Input: { required: ['prompt'], properties: { prompt: { type: 'string' } } } } } });
  const [apimartT2V] = buildApimartVariants({ id: 'kling-v4', category: 'video', capability_tags: ['Text to Video'] }, null, { usd: 0.14, unit: 'second' });
  const lists = buildStudioLists([atlasT2V, apimartT2V]);
  assert.deepEqual(lists.t2v.map((m) => m.dzProvider), ['apimart', 'atlas']);
  assert.ok(lists.t2v.every((m) => m.dzFamily === 'dz-kling-4' && m.dzFamilyName === 'Kling Video 4.0'));
  assert.match(lists.t2v[0].name, /^Kling Video 4\.0 · APIMart · \$0\.14\/s · basic$/);
});

test('recommended families come first, in admin order, provider order kept', () => {
  const atlasT2V = buildAtlasVariant({ ...atlasEntry, model: 'kwaivgi/kling-v4.0/text-to-video', categories: ['TEXT-TO-VIDEO'] },
    { components: { schemas: { Input: { required: ['prompt'], properties: { prompt: { type: 'string' } } } } } });
  const [apimartT2V] = buildApimartVariants({ id: 'kling-v4', category: 'video', capability_tags: ['Text to Video'] }, null, { usd: 0.14, unit: 'second' });
  const [veo] = buildApimartVariants({ id: 'veo3.1', category: 'video', capability_tags: ['Text to Video'] }, null, { usd: 0.2, unit: 'second' });
  const plain = buildStudioLists([veo, atlasT2V, apimartT2V].map((v) => structuredClone(v)));
  assert.equal(plain.t2v[0].dzFamily, veo.model.dzFamily);
  assert.ok(plain.t2v.every((m) => m.dzRecommended === undefined));
  const lists = buildStudioLists([veo, atlasT2V, apimartT2V], { recommended: ['dz-kling-4'] });
  assert.deepEqual(lists.t2v.map((m) => [m.dzFamily, m.dzProvider, m.dzRecommended]),
    [['dz-kling-4', 'apimart', 1], ['dz-kling-4', 'atlas', 1], [veo.model.dzFamily, 'apimart', undefined]]);
});

test('an Atlas tool segment (layer-decomposition) is its own family, ids stay unique', () => {
  assert.equal(familyFor('atlas', 'bytedance/seedream-v5.0-pro/layer-decomposition'), 'seedream-5-pro-layer-decomposition');
  assert.equal(familyFor('atlas', 'bytedance/seedream-v5.0-pro/text-to-image'), 'seedream-5-pro');
  const schema = { components: { schemas: { Input: { required: ['prompt'], properties: { prompt: { type: 'string' }, image: { type: 'string' } } } } } };
  const a = buildAtlasVariant({ ...atlasEntry, model: 'bytedance/seedream-v5.0-pro/edit', categories: ['IMAGE-TO-IMAGE'] }, schema);
  const b = buildAtlasVariant({ ...atlasEntry, model: 'bytedance/seedream-v5.0-pro/layer-decomposition', categories: ['IMAGE-TO-IMAGE'] }, schema);
  const lists = buildStudioLists([a, b]);
  const ids = lists.i2i.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.notEqual(a.model.dzFamily, b.model.dzFamily);
});

test('Atlas video price without a unit is "from $x/s" and not used for spending estimates', () => {
  const v = buildAtlasVariant({ ...atlasEntry, type: 'Video', model: 'bytedance/seedance-2.5/text-to-video', categories: ['TEXT-TO-VIDEO'], price: { actual: { base_price: '0.134' } } },
    { components: { schemas: { Input: { required: ['prompt'], properties: { prompt: { type: 'string' } } } } } });
  assert.match(v.model.name, /· from \$0\.13\/s$/);
  assert.equal(estimateCost(v, { duration: 5 }), null);
});

test('Atlas speech model: text is the prompt box, price per characters', () => {
  const entry = { model: 'minimax/speech-2.8-hd', type: 'Audio', categories: ['TEXT-TO-SPEECH'], displayName: 'MiniMax Speech 2.8 HD', price: { actual: { base_price: '0.07', unit: '1k characters' } } };
  const schema = { components: { schemas: { Input: { required: ['model', 'text'], properties: {
    model: { type: 'string', enum: ['minimax/speech-2.8-hd'] },
    text: { type: 'string', default: 'Welcome to Atlas Cloud' },
    voice: { type: 'string', enum: ['English_expressive_narrator', 'English_radiant_girl'], default: 'English_expressive_narrator' },
    speed: { type: 'number', minimum: 0.5, maximum: 2, default: 1 },
    enable_sync_mode: { type: 'boolean' },
  } } } } };
  const v = buildAtlasVariant(entry, schema);
  assert.equal(v.mode, 't2a');
  assert.equal(v.kind, 'audio');
  assert.equal(v.model.hasPrompt, true);
  assert.equal(v.model.promptRequired, true);
  assert.equal(v.model.inputs.prompt, undefined, 'text is the prompt box, not a setting');
  assert.deepEqual(v.model.inputs.voice.enum, ['English_expressive_narrator', 'English_radiant_girl']);
  assert.match(v.model.dzPrice.label, /\/1k chars$/);
  const body = toProviderBody(v, { prompt: 'Hello there', voice: 'English_radiant_girl' });
  assert.equal(body.text, 'Hello there');
  assert.equal(body.prompt, undefined);
  assert.equal(estimateCost(v, body), 0.07, 'short text: one block of characters');
  assert.ok(Math.abs(estimateCost(v, { text: 'x'.repeat(3000) }) - 0.21) < 1e-9);
  // Transcription, lyrics-as-text and voice cloning are not studio audio.
  assert.equal(buildAtlasVariant({ ...entry, model: 'kwaivgi/kling-v4.0/custom-voice' }, schema), null);
  assert.equal(buildAtlasVariant({ ...entry, model: 'minimax/lyrics-generation', categories: ['TEXT-TO-AUDIO'] }, schema), null);
  assert.equal(buildAtlasVariant({ ...entry, model: 'bytedance/seed-asr-2.0', categories: ['SPEECH-TO-TEXT'] }, schema), null);
});

test('APIMart hand-checked spec replaces the parsed modes (Kling motion control)', async () => {
  const { createRequire } = await import('node:module');
  const manual = createRequire(import.meta.url)('../src/catalog/apimart-manual.json');
  const vs = buildApimartVariants({ id: 'kling-v2-6-motion-control', category: 'video', capability_tags: ['Text to Video', 'Video to Video'] }, manual['kling-v2-6-motion-control'], { usd: 0.07, unit: 'second' });
  assert.deepEqual(vs.map((v) => v.mode), ['i2v']);
  const m = vs[0].model;
  assert.equal(m.inputs.image_url.field, 'image');
  assert.equal(m.inputs.video_url.field, 'video');
  assert.deepEqual(m.inputs.character_orientation.enum, ['image', 'video']);
  assert.ok(m.required.includes('image_url') && m.required.includes('video_url'));
});

test('APIMart audio from hand-checked specs: Suno, sound effects, speech', async () => {
  const { createRequire } = await import('node:module');
  const { apimartPrice } = await import('../src/catalog/build.js');
  const manual = createRequire(import.meta.url)('../src/catalog/apimart-manual.json');
  const sunoPrice = { action_paid_prices: { 'suno@music-v6': 0.05, 'suno@sounds-v6': 0.0096 } };
  const [music] = buildApimartVariants({ id: 'suno', category: 'audio', capability_tags: ['Text to Audio', 'Audio to Audio'] }, manual.suno, apimartPrice(sunoPrice, manual.suno));
  assert.equal(music.mode, 't2a');
  assert.equal(music.kind, 'audio');
  assert.equal(music.server.price.usd, 0.05);
  assert.equal(estimateCost(music, { prompt: 'a song' }), 0.05);
  const [sfx] = buildApimartVariants({ id: 'suno-sounds', category: 'audio', capability_tags: [] }, manual['suno-sounds'], apimartPrice(sunoPrice, manual['suno-sounds']));
  assert.equal(sfx.key, 'p/apimart/suno-sounds?m=t2a');
  assert.equal(sfx.server.price.usd, 0.0096);
  assert.deepEqual(sfx.model.inputs.type.enum, ['one-shot', 'loop']);
  const [tts] = buildApimartVariants({ id: 'gpt-4o-mini-tts', category: 'audio', capability_tags: ['Audio'] }, manual['gpt-4o-mini-tts'], apimartPrice(null, manual['gpt-4o-mini-tts']));
  const body = toProviderBody(tts, { prompt: 'Hello', voice: 'nova' });
  assert.equal(body.input, 'Hello');
  assert.equal(body.prompt, undefined);
  assert.ok(Math.abs(estimateCost(tts, { input: 'x'.repeat(2000) }) - 0.024) < 1e-9);
  const [flow] = buildApimartVariants({ id: 'flowmusic', category: 'audio', capability_tags: [] }, manual.flowmusic, apimartPrice({ action_paid_prices: { 'flowmusic@generate': 0.06 } }, manual.flowmusic));
  assert.equal(toProviderBody(flow, { prompt: 'lofi piano' }).sound_prompt, 'lofi piano');
});

test('APIMart audio sends only the fields of its spec (no Suno max_mode)', async () => {
  const { createRequire } = await import('node:module');
  const manual = createRequire(import.meta.url)('../src/catalog/apimart-manual.json');
  const [music] = buildApimartVariants({ id: 'suno', category: 'audio', capability_tags: [] }, manual.suno, { usd: 0.05, unit: 'request' });
  const body = toProviderBody(music, { prompt: 'song', custom: true, max_mode: true, custom_model_id: 'x' });
  assert.equal(body.max_mode, undefined);
  assert.equal(body.custom_model_id, undefined);
  assert.equal(body.prompt, 'song');
  const [tts] = buildApimartVariants({ id: 'gpt-4o-mini-tts', category: 'audio', capability_tags: [] }, manual['gpt-4o-mini-tts'], null);
  assert.deepEqual(toProviderBody(tts, { prompt: 'Hi', voice: 'nova', extra: 1 }), { input: 'Hi', voice: 'nova' });
});

test('Atlas: a model without categories takes its mode from tags / id; typed reference lists', async () => {
  const { buildAtlasVariant, atlasModeOf } = await import('../src/catalog/build.js');
  assert.equal(atlasModeOf({ model: 'google/gemini-omni-1.2-flash/reference-to-video', categories: null, tags: ['REFERENCE-TO-VIDEO', 'NEW'] }), 'i2v');
  assert.equal(atlasModeOf({ model: 'x/y/video-edit', categories: null, tags: [] }), 'v2v');
  // Wan 3.0 "refers": [{ url, type }] → one studio field per type, joined back for Atlas.
  const schema = { components: { schemas: { Input: { required: ['model', 'prompt'], properties: {
    model: { type: 'string' }, prompt: { type: 'string' },
    refers: { type: 'array', maxItems: 20, items: { type: 'object', properties: { url: { type: 'string' }, type: { type: 'string', enum: ['image', 'video', 'audio'] } }, required: ['url', 'type'] } },
  } } } } };
  const v = buildAtlasVariant({ model: 'alibaba/wan-3.0/reference-to-video', categories: null, tags: [], type: 'Video', displayName: 'Wan 3.0 Reference-to-Video', price: { actual: { base_price: '0.1', unit: 'second' } } }, schema);
  assert.ok(v && v.model.inputs.refers__image && v.model.inputs.refers__video && v.model.inputs.refers__audio);
  assert.deepEqual(toProviderBody(v, { prompt: 'p', refers__image: ['A', 'B'], refers__audio: ['S'] }).refers, [{ url: 'A', type: 'image' }, { url: 'B', type: 'image' }, { url: 'S', type: 'audio' }]);
});

test('APIMart Seedance: pictures only never go to the edit endpoint', async () => {
  const { BodyError } = await import('../src/catalog/build.js');
  const OV = (await import('../src/catalog/apimart-overrides.json', { with: { type: 'json' } })).default;
  const v2v = buildApimartVariants({ id: 'seedance-2.5', capability_tags: ['video-to-video'] }, OV['seedance-2.5'], { usd: 0.2, unit: 'second' }).find((x) => x.mode === 'v2v');
  assert.throws(() => toProviderBody(v2v, { prompt: 'p', image_urls: ['A', 'B', 'C'] }), BodyError);
  assert.equal(toProviderBody(v2v, { prompt: 'p', video_urls: ['V'], image_urls: ['A'] }).omni_reference_task_type, 'edit');
});


// APIMart video models, read from the docs (apimart-docs.js videoReader / videoModes).
const apimartOf = async (id) => {
  const OV = (await import('../src/catalog/apimart-overrides.json', { with: { type: 'json' } })).default;
  const all = buildApimartVariants({ id, capability_tags: [] }, OV[id], { usd: 0.1, unit: 'second' });
  return (suffix) => all.find((v) => v.key.endsWith(`?m=${suffix}`));
};

test('APIMart Seedance 2.5: frames (image_with_roles, adaptive) or references (30) — never both', async () => {
  const { BodyError } = await import('../src/catalog/build.js');
  const at = await apimartOf('seedance-2.5');
  assert.deepEqual(toProviderBody(at('i2v'), { prompt: 'p', aspect_ratio: '16:9', first_frame_image: 'A', last_frame_image: 'B' }), {
    prompt: 'p', size: 'adaptive', image_with_roles: [{ url: 'A', role: 'first_frame' }, { url: 'B', role: 'last_frame' }],
  });
  assert.ok(!at('i2v').model.inputs.image_urls);
  assert.equal(at('reference').model.inputs.image_urls.maxItems, 30);
  assert.equal(at('reference').model.inputs.reference_videos.maxItems, 10);
  const refs = toProviderBody(at('reference'), { prompt: 'p', aspect_ratio: '16:9', image_urls: ['R'], reference_videos: ['V'] });
  assert.deepEqual(refs, { prompt: 'p', size: '16:9', image_urls: ['R'], video_urls: ['V'], omni_reference_task_type: 'reference' });
  assert.throws(() => toProviderBody(at('i2v'), { prompt: 'p', last_frame_image: 'B' }), BodyError);
  // Pictures only never reach the edit endpoint's "edit".
  assert.throws(() => toProviderBody(at('v2v'), { prompt: 'p', image_urls: ['A'] }), BodyError);
});

test('APIMart Kling 4.0: references with a role and task type "reference"; Gemini Omni 1.2: frames and references together', async () => {
  const k = await apimartOf('kling-v4');
  assert.deepEqual(toProviderBody(k('reference'), { prompt: 'p', image_urls: ['R'] }), { prompt: 'p', image_with_roles: [{ url: 'R', role: 'reference_image' }], omni_reference_task_type: 'reference' });
  assert.deepEqual(toProviderBody(k('i2v'), { prompt: 'p', first_frame_image: 'A' }), { prompt: 'p', first_frame_image: 'A' });
  const g = await apimartOf('gemini-omni-1.2-flash');
  assert.deepEqual(toProviderBody(g('i2v'), { prompt: 'p', image_urls: ['R'] }).image_with_roles, [{ url: 'R', role: 'reference' }]);
  assert.deepEqual(toProviderBody(g('i2v'), { prompt: 'p', first_frame_image: 'A', image_urls: ['R'] }).image_with_roles.map((x) => x.role), ['first_frame', 'reference']);
});

test('APIMart Veo 3.1 and Wan 3.0: generation_type decides frames or references; Lite takes no pictures', async () => {
  const v = await apimartOf('veo3.1-fast');
  assert.deepEqual(toProviderBody(v('i2v'), { prompt: 'p', first_frame_image: 'A', last_frame_image: 'B' }), { prompt: 'p', image_urls: ['A', 'B'], generation_type: 'frame' });
  assert.deepEqual(toProviderBody(v('reference'), { prompt: 'p', image_urls: ['R'] }), { prompt: 'p', image_urls: ['R'], generation_type: 'reference' });
  const lite = await apimartOf('veo3.1-lite');
  assert.equal(lite('i2v'), undefined);
  assert.equal(lite('reference'), undefined);
  const w = await apimartOf('wan3.0-video');
  assert.equal(toProviderBody(w('i2v'), { prompt: 'p', first_frame_image: 'A' }).generation_type, 'frame');
  assert.equal(toProviderBody(w('reference'), { prompt: 'p', image_urls: ['R'] }).generation_type, 'reference');
});

test('APIMart H3: references are bare image_urls (9), reference videos and audio; audio is never alone at Atlas', async () => {
  const h = await apimartOf('MiniMax-H3');
  assert.equal(h('reference').model.inputs.image_urls.maxItems, 9);
  assert.deepEqual(toProviderBody(h('reference'), { prompt: 'p', image_urls: ['R'], reference_audios: ['S'] }), { prompt: 'p', image_urls: ['R'], audio_urls: ['S'] });
  const { BodyError } = await import('../src/catalog/build.js');
  const schema = { components: { schemas: { Input: { required: ['model', 'prompt', 'refers'], properties: {
    model: { type: 'string' }, prompt: { type: 'string' },
    refers: { type: 'array', maxItems: 3, items: { type: 'object', properties: { url: { type: 'string' }, type: { type: 'string', enum: ['image', 'video', 'audio'] } } } },
  } } } } };
  const a = buildAtlasVariant({ model: 'x/y/reference-to-video', categories: ['IMAGE-TO-VIDEO'], type: 'Video', displayName: 'Y', price: { actual: { base_price: '0.1', unit: 'second' } } }, schema);
  assert.throws(() => toProviderBody(a, { prompt: 'p', refers__image: ['A', 'B', 'C'], refers__audio: ['S'] }), BodyError);
  assert.throws(() => toProviderBody(a, { prompt: 'p', refers__audio: ['S'] }), BodyError);
});

// MAGI-2 at APIMart (26.11.2026 docs page, test/fixtures/apimart-magi-2.md).
test('APIMart MAGI-2 from its docs: 4–30 s, 16:9 default, one audio switch, frames or references, no edit', async () => {
  const fs = await import('node:fs');
  const { buildApimartOverrides, fetchApimartDocs } = await import('../src/catalog/apimart-docs.js');
  const text = fs.readFileSync(new URL('./fixtures/apimart-magi-2.md', import.meta.url), 'utf8');
  const o = buildApimartOverrides([{ url: 'https://docs.apimart.ai/en/api-reference/videos/magi-2/generation.md', text }])['magi-2'];
  assert.deepEqual([o.common.inputs.duration.minValue, o.common.inputs.duration.maxValue, o.common.inputs.duration.default], [4, 30, 5]);
  assert.equal(o.common.inputs.generate_audio.default, true);
  assert.equal(o.common.inputs.audio, undefined); // "Alias for `generate_audio`"
  assert.deepEqual(Object.keys(o.modes).sort(), ['i2v', 'reference', 't2v']); // "`edit` and `extend` are unsupported"
  assert.equal(o.modes.t2v.inputs.aspect_ratio.default, '16:9'); // "`16:9` (default), `9:16`"
  assert.ok(!o.modes.t2v.inputs.aspect_ratio.enum.includes('auto'));
  assert.ok(o.modes.t2v.inputs.aspect_ratio.enum.includes('21:9'));
  assert.equal(o.modes.i2v.inputs.aspect_ratio.default, 'auto'); // follows the start frame
  assert.ok(!o.modes.i2v.inputs.aspect_ratio.enum.includes('21:9'));
  const all = buildApimartVariants({ id: 'magi-2', capability_tags: ['Text to Video', 'Image to Video', 'Video to Video'] }, o, { usd: 0.08, unit: 'second' });
  const at = (m) => all.find((v) => v.key.endsWith(`?m=${m}`));
  assert.equal(at('v2v'), undefined);
  assert.deepEqual(toProviderBody(at('t2v'), { prompt: 'p', duration: 10, aspect_ratio: '21:9', generate_audio: false }), { prompt: 'p', duration: 10, aspect_ratio: '21:9', generate_audio: false });
  assert.deepEqual(toProviderBody(at('i2v'), { prompt: 'p', first_frame_image: 'A', last_frame_image: 'B', aspect_ratio: 'auto' }), { prompt: 'p', first_frame_image: 'A', last_frame_image: 'B', aspect_ratio: 'auto' });
  assert.deepEqual(toProviderBody(at('reference'), { prompt: 'p', image_urls: ['R'], reference_videos: ['V'], reference_audios: ['S'] }),
    { prompt: 'p', image_urls: ['R'], video_urls: ['V'], audio_urls: ['S'], omni_reference_task_type: 'reference' });
  assert.equal(at('reference').model.inputs.image_urls.maxItems, 10);

  // Guide and button pages without a model (Midjourney's, added 17.11) don't count as unreadable.
  const mj = fs.readFileSync(new URL('./fixtures/apimart-midjourney-upscale.md', import.meta.url), 'utf8');
  const index = 'https://docs.apimart.ai/en/api-reference/videos/magi-2/generation.md\nhttps://docs.apimart.ai/en/api-reference/images/midjourney/upscale.md\nhttps://docs.apimart.ai/en/api-reference/videos/cut/generation.md';
  const pages = { 'magi-2': text, upscale: mj, cut: text.slice(0, text.indexOf('## Generation modes')) };
  const fetchFn = async (url) => ({ ok: true, text: async () => (url.endsWith('api-manual.txt') ? index : pages[/magi-2/.test(url) ? 'magi-2' : /upscale/.test(url) ? 'upscale' : 'cut']) });
  const r = await fetchApimartDocs({ fetchFn });
  assert.equal(r.total, 3);
  assert.equal(r.invalid, 1); // the page cut short keeps its model id and still counts
});

test('APIMart docs: a sentence about one model on a shared page refuses nothing for the others (Veo 3.1)', async () => {
  const fs = await import('node:fs');
  const { buildApimartOverrides, fetchApimartDocs } = await import('../src/catalog/apimart-docs.js');
  const text = fs.readFileSync(new URL('./fixtures/apimart-veo3.md', import.meta.url), 'utf8');
  const o = buildApimartOverrides([{ url: 'https://docs.apimart.ai/en/api-reference/videos/veo3/generation.md', text }]);
  assert.ok(o['veo3.1-fast'].modes.reference); // "`veo3.1-quality` model does not support `reference` mode"
  assert.equal(o['veo3.1-quality'].modes.reference, undefined);
  assert.deepEqual(Object.keys(o['veo3.1-lite'].modes), ['t2v']);

  // A page cut inside its parameter list (model and prompt read, the rest lost) counts as unreadable.
  const cut = text.slice(0, text.indexOf('**generation\\_type**'));
  const index = 'https://docs.apimart.ai/en/api-reference/videos/veo3/generation.md';
  const r = await fetchApimartDocs({ fetchFn: async (url) => ({ ok: true, text: async () => (url.endsWith('api-manual.txt') ? index : cut) }) });
  assert.equal(r.invalid, 1);
  assert.equal(r.docs.length, 0); // left out: the model keeps the spec it has
  const whole = await fetchApimartDocs({ fetchFn: async (url) => ({ ok: true, text: async () => (url.endsWith('api-manual.txt') ? index : text) }) });
  assert.equal(whole.invalid, 0);
});

test('APIMart docs: other per-model wording still refuses a value', async () => {
  const { buildApimartOverrides } = await import('../src/catalog/apimart-docs.js');
  const page = ['# Demo', '```json', '{ "model": "demo-video" }', '```', '## Request parameters', '',
    '**model** `string` *required*', '', '`demo-video`', '',
    '**resolution** `string`', '', 'Values: `720p`, `1080p`, `4k`. `4k` is not supported by the `demo-video` model.', '',
    '## Response', ''].join('\n');
  const o = buildApimartOverrides([{ url: 'https://docs.apimart.ai/en/api-reference/videos/demo/generation.md', text: page }])['demo-video'];
  assert.deepEqual(o.common.inputs.resolution.enum, ['720p', '1080p']);
});
