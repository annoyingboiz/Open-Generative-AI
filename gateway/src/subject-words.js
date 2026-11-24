// Person or object: is the main subject of a prompt a person or an object? (docs/ux/50 §4, 51 §3)
//
// STOPGAP. These word lists only guess from the text, for prompts with no OBJECTS block and no typed
// Elements. The lasting fix is Adapt writing an OBJECTS block, whose first line decides (rule 1).
// This is the only place the lists live: the studio gets them through the catalog (look.subjectWords)
// and decides there, so the Look panel, the prompt preview and the server always agree.
//
// Rules, in order (the studio runs them; `subjectOf` below is the same code for tests and other callers):
//  1. An OBJECTS block (or an "objects" key in a JSON prompt): its first line decides. A person word
//     and no object word → person; anything else → object.
//  2. A character Element attached and no object Element → person.
//  3. An object Element attached and no character Element → object.
//  4. Neither kind attached: from the text (docs/ux/53, option b). A person named before the first object
//     word → person ("The woman sits at the counter with the bowl in front of her"). An object word with
//     the person only as a possessive or not at all, or the object word first → object ("A bartender's
//     hand pours a cocktail into the glass"). Nothing of either → not set. Both kinds attached → not set.
export const PERSON_WORDS = [
  'woman', 'women', 'man', 'men', 'girl', 'girls', 'boy', 'boys', 'person', 'people', 'lady', 'guy', 'child', 'kid',
  'she', 'her', 'he', 'him', 'his', 'face', 'portrait', 'actor', 'actress', 'model', 'bartender', 'chef', 'waiter',
  'waitress', 'dancer', 'singer', 'couple', 'mother', 'father', 'grandmother', 'grandfather', 'teenager', 'student',
  'worker', 'soldier', 'detective', 'character', 'host', 'customer',
];
export const OBJECT_WORDS = [
  'glass', 'tumbler', 'bottle', 'cup', 'mug', 'jar', 'product', 'package', 'packaging', 'box', 'perfume', 'shoe',
  'sneaker', 'handbag', 'plate', 'bowl', 'dish', 'burger', 'pizza', 'cake', 'cocktail', 'coffee', 'ramen', 'car',
  'ring', 'necklace', 'lipstick', 'cosmetics', 'cream', 'phone', 'smartphone', 'headphones', 'camera', 'lamp',
  'chair', 'vase', 'candle', 'teapot', 'kettle', 'knife', 'device', 'gadget',
];

const wordsRe = (list) => new RegExp(`\\b(${list.join('|')})\\b`, 'i');
// The studio keeps a copy of everything below in packages/studio/src/dzCreate.js (lookSubject): keep in step.
// "her glass", "his knife": a determiner, not a person (Codex x69). "follows her", "her." stay a person.
export const HER_NOT_DET = /^(?:\s*$|\s*[.,;:!?)]|\s+(?:and|as|at|in|on|with|from|to|while|into|through|across|toward|towards|for|the|a|an|again|now|closely)\b)/i;
// "The camera pushes in": a camera direction, not a camera in the picture.
export const CAMERA_DIRECTION = /^\s*(?:slowly\s+|gently\s+)?(?:moves?|push(?:es)?|pulls?|follows?|tracks?|pans?|tilts?|orbits?|dollies|dolly|zooms?|holds?|stays?|locks?|circles?|rises?|cranes?|is|never|starts?|ends?|shakes?|drifts?|glides?|remains?|stops?|frames?)\b/i;
const allRe = (list) => new RegExp(`\\b(${list.join('|')})\\b(['’]s\\b)?`, 'gi');
const PERSON_ALL = allRe(PERSON_WORDS);
const OBJECT_ALL = allRe(OBJECT_WORDS);

// A JSON prompt: its string values, not its keys ("model" is a key, not a person).
export function proseOf(prompt) {
  const s = String(prompt || '');
  if (!/^\s*[[{]/.test(s)) return s;
  try {
    const out = [];
    const walk = (v) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    walk(JSON.parse(s));
    return out.join('. ');
  } catch { return s; }
}

// Where the text first names a person (not as a possessive: "a bartender's hand", "her glass") and an object.
export function firstMentions(text) {
  const s = String(text || '');
  let person = -1;
  for (const m of s.matchAll(PERSON_ALL)) {
    if (m[2]) continue;
    const w = m[1].toLowerCase();
    if (w === 'his' || (w === 'her' && !HER_NOT_DET.test(s.slice(m.index + m[0].length)))) continue;
    person = m.index; break;
  }
  let object = -1;
  for (const m of s.matchAll(OBJECT_ALL)) {
    if (m[1].toLowerCase() === 'camera' && (m[1] === 'CAMERA' || CAMERA_DIRECTION.test(s.slice(m.index + m[0].length)))) continue;
    object = m.index; break;
  }
  return { person, object };
}
export function subjectFromText(text) {
  const { person, object } = firstMentions(text);
  if (person >= 0 && (object < 0 || person < object)) return 'person';
  if (object >= 0) return 'object';
  return 'none';
}
const PERSON_RE = wordsRe(PERSON_WORDS);
const OBJECT_RE = wordsRe(OBJECT_WORDS);

// Text between a label and the next label: OBJECTS block of a labeled prompt (labels in capitals at a line start).
export function objectsFirstLine(prompt) {
  const s = String(prompt || '');
  if (/^\s*[[{]/.test(s)) {
    try {
      const j = JSON.parse(s);
      const v = j && typeof j === 'object' ? (j.objects ?? j.OBJECTS ?? j.Objects) : null;
      const first = Array.isArray(v) ? v[0] : v;
      const text = typeof first === 'string' ? first : first && typeof first === 'object' ? JSON.stringify(first) : '';
      return text.trim() || null;
    } catch { return null; }
  }
  const m = s.match(/(?:^|\n)\s*OBJECTS\b[:\s]*([\s\S]*?)(?=\n\s*[A-Z][A-Z ]{2,}\b|$)/);
  if (!m) return null;
  const line = m[1].split('\n').map((x) => x.trim()).find(Boolean);
  return line || null;
}

export const textSays = (text) => ({ person: PERSON_RE.test(String(text || '')), object: OBJECT_RE.test(String(text || '')) });

// elementKinds: kinds of the attached Elements ('character', 'object', 'place', 'other').
export function subjectOf(prompt, elementKinds = []) {
  const first = objectsFirstLine(prompt);
  if (first) { const t = textSays(first); return t.person && !t.object ? 'person' : 'object'; }
  const kinds = new Set(elementKinds);
  const char = kinds.has('character'); const obj = kinds.has('object');
  if (char && !obj) return 'person';
  if (obj && !char) return 'object';
  if (char && obj) return 'none';
  return subjectFromText(proseOf(prompt));
}
