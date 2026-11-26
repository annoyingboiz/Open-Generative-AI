// Settings inside the shell (handoff 21): section addresses, and the text-model lists.
import test from 'node:test';
import assert from 'node:assert/strict';

test('settings addresses: each section has its own; old ones land right; admins only for "This server"', async () => {
  const { dzSettingsRoute } = await import('../../packages/studio/src/dzSettings.js');
  assert.deepEqual(dzSettingsRoute('/settings', true), { section: 'account', item: '' });
  assert.deepEqual(dzSettingsRoute('/settings/providers/atlas', true), { section: 'providers', item: 'atlas' });
  assert.deepEqual(dzSettingsRoute('/settings/text-models/try', true), { section: 'text-models', item: 'try' });
  assert.deepEqual(dzSettingsRoute('/settings/people/new', true), { section: 'people', item: 'new' });
  assert.deepEqual(dzSettingsRoute('/settings/sources', true), { section: 'text-models', item: '' });
  assert.deepEqual(dzSettingsRoute('/settings/test', true), { section: 'providers', item: '' });
  assert.deepEqual(dzSettingsRoute('/settings/nope', true), { section: 'account', item: '' });
  assert.equal(dzSettingsRoute('/settings/people/3', false).section, 'account');
  assert.equal(dzSettingsRoute('/settings/changes', false).section, 'account');
  assert.equal(dzSettingsRoute('/settings/text-model', false).section, 'text-model');
});

test('text-model lists: your ChatGPT plan first; a saved choice that is offline is kept', async () => {
  const { dzLlmGroups } = await import('../../packages/studio/src/dzSettings.js');
  const models = [
    { id: 'chatgpt:gpt-6.2-sol', source: 'chatgpt', name: 'GPT-6.2 Sol', recommended: true, free: true },
    { id: 'apimart:deepseek-v4-flash', source: 'apimart', name: 'DeepSeek V4 Flash', recommended: true },
    { id: 'local:qwen', source: 'local', name: 'Qwen' },
  ];
  let r = dzLlmGroups(models, 'chatgpt:gpt-6.2-sol');
  assert.deepEqual(r.groups.map(([name, items]) => [name, items.map((m) => m.id)]), [
    ['Your ChatGPT plan', ['chatgpt:gpt-6.2-sol']], ['Recommended', ['apimart:deepseek-v4-flash']], ['This server', ['local:qwen']],
  ]);
  assert.equal(r.missing, null);
  r = dzLlmGroups(models.slice(1), 'chatgpt:gpt-6.2-sol');
  assert.deepEqual(r.missing, { id: 'chatgpt:gpt-6.2-sol', label: 'gpt-6.2-sol — not available right now' });
});
