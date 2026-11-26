// DZ: Settings (handoff 21) — the sections, their addresses and the text-model groups.
// Plain JS, so the gateway tests can check it without a browser.

// ── Sections and addresses ────────────────────────────────────────────────
export const YOU = [["account", "Account"], ["text-model", "Your text model"]];
export const ADMIN = [["providers", "Providers"], ["models", "Models"], ["changes", "Provider changes"], ["text-models", "Text models"], ["people", "People"]];
const ADMIN_IDS = new Set(ADMIN.map(([id]) => id));
// Old addresses (the one-page Settings) still land in the right section.
const OLD = { sources: "text-models", test: "providers", accounts: "people", recommended: "models", llm: "text-model" };
export function dzSettingsRoute(pathname, isAdmin) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  let section = OLD[parts[1]] || parts[1] || "account";
  if (![...YOU, ...ADMIN].some(([id]) => id === section)) section = "account";
  if (ADMIN_IDS.has(section) && !isAdmin) section = "account";
  return { section, item: parts[2] ? decodeURIComponent(parts[2]) : "" };
}
export const SOURCE_NAME = { local: "This server", apimart: "APIMart", atlas: "Atlas", chatgpt: "ChatGPT plan" };

// Text models in groups: your ChatGPT plan first, then recommended, then by source. A saved
// choice that is not in the list now (its source is down) stays, marked.
export function dzLlmGroups(models, selected) {
  const list = models || [];
  const groups = [
    ["Your ChatGPT plan", list.filter((m) => m.source === "chatgpt")],
    ["Recommended", list.filter((m) => m.recommended && m.source !== "chatgpt")],
    ...["local", "apimart", "atlas"].map((src) => [SOURCE_NAME[src], list.filter((m) => m.source === src && !m.recommended)]),
  ].filter(([, items]) => items.length);
  const missing = selected && !list.some((m) => m.id === selected) ? { id: selected, label: `${selected.replace(/^[a-z]+:/, "")} — not available right now` } : null;
  return { groups, missing };
}

