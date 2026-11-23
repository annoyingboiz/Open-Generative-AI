// Prompt tags of files a model does not get (acceptance of handoff 17, defect 1): with a start
// frame most video models take no references, and their mentions must stay readable.
import test from 'node:test';
import assert from 'node:assert/strict';

const dz = () => import('../../packages/studio/src/dzCreate.js');
const frame = { url: '/media/u2/start.jpg' };
const refs = [{ url: '/media/u2/woman.jpg' }, { url: '/media/u2/shop.jpg' }, { url: '/media/u2/bowl.jpg' }];
const noRefs = { media: { reference: false } };

test('a start frame turns references off: definitions go, "from @imgN" goes, other mentions take the definition', async () => {
  const { promptTags, translateTags, unsentMentions } = await dz();
  const tags = promptTags({ attached: { first: [frame] }, all: { first: [frame], reference: refs }, variant: noRefs });
  const prompt = '@Image1 is the woman, @Image2 is the ramen shop, @Image3 is the bowl of ramen. The woman from @Image1 sits at the wooden counter of the ramen shop from @Image2 with the bowl from @Image3 in front of her and eats noodles with chopsticks.';
  assert.equal(translateTags(prompt, tags), 'The woman sits at the wooden counter of the ramen shop with the bowl in front of her and eats noodles with chopsticks.');
  assert.deepEqual(unsentMentions(prompt, tags), []);
  // Our own spelling, "a"/"an" → "the", a mention that opens a sentence gets a capital.
  assert.equal(translateTags('@img1 is a woman in a yellow coat and @img2 is the shop. @img1 sits in @img2.', tags), 'The woman in a yellow coat sits in the shop.');
  // The start frame itself is still named.
  assert.equal(translateTags('@start shows her; @img1 is the woman.', tags), 'The start frame shows her.');
});

test('a mention the prompt never defines is reported and still left out of the sent text', async () => {
  const { promptTags, translateTags, unsentMentions } = await dz();
  const tags = promptTags({ attached: { first: [frame] }, all: { first: [frame], reference: refs }, variant: noRefs });
  const prompt = 'She eats noodles (@img3) next to @img2 under the lanterns.';
  assert.deepEqual(unsentMentions(prompt, tags), ['img2']);
  assert.equal(translateTags(prompt, tags), 'She eats noodles next to under the lanterns.');
});

test('references the model gets are untouched; a JSON prompt keeps the old rule', async () => {
  const { promptTags, translateTags, unsentMentions } = await dz();
  const sent = promptTags({ attached: { reference: refs }, variant: { media: { reference: true } } });
  const prompt = '@img1 is the woman. The woman from @img1 sits in @img2.';
  assert.equal(translateTags(prompt, sent), 'Image 1 is the woman. The woman from image 1 sits in image 2.');
  assert.deepEqual(unsentMentions(prompt, sent), []);
  const off = promptTags({ attached: { first: [frame] }, all: { first: [frame], reference: refs }, variant: noRefs });
  assert.deepEqual(unsentMentions('{"subject": "@img1 is the woman"}', off), []);
  assert.equal(translateTags('{"subject": "the woman @img1"}', off), '{"subject": "the woman"}');
});
