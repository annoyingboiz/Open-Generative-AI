// Doc 42, answer 2: the provider hint (never automatic) and the failed-tile text.
import test from 'node:test';
import assert from 'node:assert/strict';

const v = (media) => ({ model: { required: [], inputs: {} }, media });
const frame = { url: '/media/u2/start.jpg' };
const refs = [{ url: '/media/u2/woman.jpg' }, { url: '/media/u2/shop.jpg' }];
// APIMart Kling: an image-to-video endpoint and a reference endpoint, never both.
const apimart = { key: 'apimart:kling-4', family: 'kling-4', familyName: 'Kling 4.0', provider: 'apimart', providerName: 'APIMart',
  variants: [v({ first: { max: 1 } }), v({ reference: { max: 4 } })], slots: [{ role: 'first' }, { role: 'reference' }] };
// Atlas Kling: one endpoint takes both.
const atlas = { key: 'atlas:kling-4', family: 'kling-4', familyName: 'Kling 4.0', provider: 'atlas', providerName: 'Atlas',
  variants: [v({ first: { max: 1 }, reference: { max: 4 } })], slots: [{ role: 'first' }, { role: 'reference' }] };
const other = { ...atlas, key: 'atlas:seedance', family: 'seedance-2.5', familyName: 'Seedance 2.5' };

test('a provider that takes a start frame and references together is suggested', async () => {
  const { bothAtOther } = await import('../../packages/studio/src/dzCreate.js');
  const h = bothAtOther(apimart, [apimart, atlas, other], { first: [frame], reference: refs }, { touched: ['first'] });
  assert.deepEqual(h.others.map((e) => e.key), ['atlas:kling-4'], 'same model only');
  assert.equal(h.words, 'a start frame and references');
  // Nothing dimmed, or no provider that takes both: no hint.
  assert.equal(bothAtOther(apimart, [apimart, atlas], { reference: refs }), null);
  assert.equal(bothAtOther(atlas, [apimart, atlas], { first: [frame], reference: refs }), null);
  assert.equal(bothAtOther(apimart, [apimart, other], { first: [frame], reference: refs }), null);
});

test('a failed task with an automatic refund does not read as an empty account', async () => {
  const { plainError } = await import('../../packages/studio/src/components/studio/actions.js');
  const failed = 'The task failed. Please try again later. If it keeps failing, contact support with the task ID. Any deducted quota has been refunded automatically.';
  assert.doesNotMatch(plainError(failed), /out of credit/);
  assert.match(plainError(failed), /failed on its side/);
  assert.match(plainError('HTTP 402: Insufficient account balance.'), /out of credit/);
  assert.match(plainError('Your quota exceeded for this month'), /out of credit/);
  assert.match(plainError('Credit balance exhausted.'), /out of credit/);
  assert.match(plainError('The task failed because the account has insufficient balance.'), /out of credit/);
});
