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

test('review x57: no tidy without a rewrite, other languages, a comma without a space, empty labels, quotes', async () => {
  const { promptTags, translateTags, unsentMentions } = await dz();
  const tags = promptTags({ attached: { first: [frame] }, all: { first: [frame], reference: refs }, variant: noRefs });
  // Nothing about the unsent files: the text is left exactly as typed.
  assert.equal(translateTags('...and then she leaves.\n\n  Two  spaces stay.', tags), '...and then she leaves.\n\n  Two  spaces stay.');
  // A definition without an English article after a dash.
  assert.equal(translateTags('@img1 — жінка. @img1 сидить за стійкою.', tags), 'Жінка сидить за стійкою.');
  assert.deepEqual(unsentMentions('@img1 — жінка. @img1 сидить.', tags), []);
  // No space after the comma: the second definition is still found.
  assert.equal(translateTags('@img1 is the woman,@img2 is the shop. @img2 glows.', tags), 'The shop glows.');
  // A label whose only content was a definition goes with it.
  assert.equal(translateTags('Characters: @img1 is the woman. Action: @img1 waves.', tags), 'Action: the woman waves.');
  // A label with real content is kept, even one that starts with punctuation.
  assert.equal(translateTags('@img1 is the woman. Camera: .5x zoom. Camera: static.', tags), 'Camera: .5x zoom. Camera: static.');
  // An opening quote does not hide the sentence start.
  assert.equal(translateTags('@img1 is the woman. "@img1 walks."', tags), '"The woman walks."');
  // "is" with no article is not a definition (a verb follows): reported, not guessed.
  assert.deepEqual(unsentMentions('@img1 is sitting at the counter.', tags), ['img1']);
});
