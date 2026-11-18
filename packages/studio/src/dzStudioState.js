// DZ: what each studio has open right now (its model and prompt), for the
// side chat: "the current model" in the assistant's context. Studios report,
// the chat reads. Not React state: no re-renders.
const state = {};
export function dzSetStudioState(tab, value) { state[tab] = value; }
export function dzGetStudioState(tab) { return state[tab] || null; }

// "Insert into prompt" from the chat: the studio of `tab` takes the text.
export const DZ_INSERT_EVENT = "dz:insert-prompt";
