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

test('APIMart Seedance: start / end frames go as image_with_roles, references by the doc rule', async () => {
  const { BodyError } = await import('../src/catalog/build.js');
  const OV = (await import('../src/catalog/apimart-overrides.json', { with: { type: 'json' } })).default;
  const i2v = (id) => buildApimartVariants({ id, capability_tags: ['image-to-video'] }, OV[id], { usd: 0.2, unit: 'second' }).find((v) => v.mode === 'i2v');
  // 2.5: frames OR references (the API refuses both: checked 23.11) — two studio endpoints.
  const all25 = buildApimartVariants({ id: 'seedance-2.5', capability_tags: ['image-to-video'] }, OV['seedance-2.5'], { usd: 0.2, unit: 'second' }).filter((v) => v.mode === 'i2v');
  const v25 = all25.find((v) => v.key.endsWith('?m=i2v'));
  const r25 = all25.find((v) => v.key.endsWith('?m=reference'));
  assert.ok(v25.model.inputs.first_frame_image && v25.model.inputs.last_frame_image && !v25.model.inputs.image_urls);
  assert.ok(r25.model.inputs.image_urls && !r25.model.inputs.first_frame_image);
  assert.deepEqual(toProviderBody(v25, { prompt: 'p', aspect_ratio: '16:9', first_frame_image: 'A', last_frame_image: 'B' }), {
    prompt: 'p', size: 'adaptive',
    image_with_roles: [{ url: 'A', role: 'first_frame' }, { url: 'B', role: 'last_frame' }],
  });
  assert.deepEqual(toProviderBody(r25, { prompt: 'p', aspect_ratio: '16:9', image_urls: ['R'] }), { prompt: 'p', size: '16:9', image_urls: ['R'] });
  assert.throws(() => toProviderBody(v25, { prompt: 'p', last_frame_image: 'B' }), BodyError);
  // 2.0: frames or references, not both.
  const v20 = i2v('seedance-2.0');
  assert.deepEqual(toProviderBody(v20, { prompt: 'p', first_frame_image: 'A' }).image_with_roles, [{ url: 'A', role: 'first_frame' }]);
  assert.ok(!v20.model.inputs.image_urls, 'frames endpoint has no references');
  // 1.5: no references at all, only frames.
  const v15 = i2v('seedance-1-5-pro');
  assert.ok(!v15.model.inputs.image_urls);
  assert.deepEqual(toProviderBody(v15, { prompt: 'p', first_frame_image: 'A' }), { prompt: 'p', image_with_roles: [{ url: 'A', role: 'first_frame' }] });
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

test('APIMart Gemini Omni: one reference is never read as a start frame', async () => {
  const OV = (await import('../src/catalog/apimart-overrides.json', { with: { type: 'json' } })).default;
  const v = buildApimartVariants({ id: 'gemini-omni-1.2-flash', capability_tags: ['image-to-video'] }, OV['gemini-omni-1.2-flash'], { usd: 0.02, unit: 'second' }).find((x) => x.mode === 'i2v');
  assert.deepEqual(toProviderBody(v, { prompt: 'p', image_urls: ['R'] }).image_with_roles, [{ url: 'R', role: 'reference_image' }]);
  const both = toProviderBody(v, { prompt: 'p', first_frame_image: 'A', image_urls: ['R', 'Q'] });
  assert.deepEqual(both.image_with_roles.map((x) => x.role), ['first_frame', 'reference_image', 'reference_image']);
  assert.equal(both.image_urls, undefined);
});

test('Typed lists: a total limit, no audio alone; Wan 3.0 at APIMart sets generation_type; Gemini edit references keep their role', async () => {
  const { BodyError } = await import('../src/catalog/build.js');
  const schema = { components: { schemas: { Input: { required: ['model', 'prompt', 'refers'], properties: {
    model: { type: 'string' }, prompt: { type: 'string' },
    refers: { type: 'array', maxItems: 3, items: { type: 'object', properties: { url: { type: 'string' }, type: { type: 'string', enum: ['image', 'video', 'audio'] } } } },
  } } } } };
  const v = buildAtlasVariant({ model: 'x/y/reference-to-video', categories: ['IMAGE-TO-VIDEO'], type: 'Video', displayName: 'Y', price: { actual: { base_price: '0.1', unit: 'second' } } }, schema);
  assert.ok(!v.model.required.includes('refers'));
  assert.throws(() => toProviderBody(v, { prompt: 'p', refers__image: ['A', 'B', 'C'], refers__audio: ['S'] }), BodyError);
  assert.throws(() => toProviderBody(v, { prompt: 'p', refers__audio: ['S'] }), BodyError);
  assert.throws(() => toProviderBody(v, { prompt: 'p' }), BodyError);
  const OV = (await import('../src/catalog/apimart-overrides.json', { with: { type: 'json' } })).default;
  const wans = buildApimartVariants({ id: 'wan3.0-video', capability_tags: ['image-to-video'] }, OV['wan3.0-video'], { usd: 0.1, unit: 'second' }).filter((x) => x.mode === 'i2v');
  const wanRefs = wans.find((x) => x.key.endsWith('?m=reference'));
  const wanFrames = wans.find((x) => x.key.endsWith('?m=i2v'));
  assert.deepEqual(toProviderBody(wanRefs, { prompt: 'p', image_urls: ['R'] }).image_with_roles, [{ url: 'R', role: 'reference_image' }]);
  assert.equal(toProviderBody(wanRefs, { prompt: 'p', image_urls: ['R'] }).generation_type, 'reference');
  assert.equal(toProviderBody(wanFrames, { prompt: 'p', first_frame_image: 'A' }).generation_type, 'frame');
  const gem = buildApimartVariants({ id: 'gemini-omni-1.2-flash', capability_tags: ['video-to-video'] }, OV['gemini-omni-1.2-flash'], { usd: 0.02, unit: 'second' }).find((x) => x.mode === 'v2v');
  assert.deepEqual(toProviderBody(gem, { prompt: 'p', video_urls: ['V'], image_urls: ['R'] }).image_with_roles, [{ url: 'R', role: 'reference_image' }]);
});

test('APIMart Seedance: pictures only never go to the edit endpoint', async () => {
  const { BodyError } = await import('../src/catalog/build.js');
  const OV = (await import('../src/catalog/apimart-overrides.json', { with: { type: 'json' } })).default;
  const v2v = buildApimartVariants({ id: 'seedance-2.5', capability_tags: ['video-to-video'] }, OV['seedance-2.5'], { usd: 0.2, unit: 'second' }).find((x) => x.mode === 'v2v');
  assert.throws(() => toProviderBody(v2v, { prompt: 'p', image_urls: ['A', 'B', 'C'] }), BodyError);
  assert.equal(toProviderBody(v2v, { prompt: 'p', video_urls: ['V'], image_urls: ['A'] }).omni_reference_task_type, 'edit');
});

test('APIMart frames / references endpoints refuse the other side', async () => {
  const { BodyError } = await import('../src/catalog/build.js');
  const OV = (await import('../src/catalog/apimart-overrides.json', { with: { type: 'json' } })).default;
  const all = buildApimartVariants({ id: 'seedance-2.5', capability_tags: ['image-to-video'] }, OV['seedance-2.5'], { usd: 0.2, unit: 'second' }).filter((v) => v.mode === 'i2v');
  const [frames, refs] = [all.find((v) => v.key.endsWith('?m=i2v')), all.find((v) => v.key.endsWith('?m=reference'))];
  assert.throws(() => toProviderBody(frames, { prompt: 'p', first_frame_image: 'A', image_urls: ['R'] }), BodyError);
  assert.throws(() => toProviderBody(refs, { prompt: 'p', first_frame_image: 'A', image_urls: ['R'] }), BodyError);
  assert.equal(frames.model.imageField, 'first_frame_image');
  assert.equal(refs.model.imageField, 'image_urls');
  assert.equal(refs.model.lastImageField, undefined);
});
