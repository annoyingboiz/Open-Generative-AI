// DZ: what each studio has open right now (its model and prompt), for the
// side chat: "the current model" in the assistant's context. Studios report,
// the chat reads. Not React state: no re-renders.
const state = {};
export function dzSetStudioState(tab, value) {
  state[tab] = value;
  // The chat shows what it sees ("Sees: Shot 5 · …", package 05 §4.6); it listens for changes.
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("dz:studio-state", { detail: { tab } }));
}
export function dzGetStudioState(tab) { return state[tab] || null; }

// "Insert into prompt" from the chat: the studio of `tab` takes the text.
export const DZ_INSERT_EVENT = "dz:insert-prompt";
