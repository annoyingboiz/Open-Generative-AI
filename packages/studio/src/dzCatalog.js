// DZ: replaces the built-in model lists with models from your providers
// (APIMart, Atlas Cloud). The gateway serves them as window.__DZ_CATALOG__
// via /dz/catalog.js, loaded in <head> before the studio code runs. Lists are
// replaced in place, so every module that imported them sees the new models.
export function dzApplyProviderCatalog(targets) {
  if (typeof window === "undefined") return;
  const catalog = window.__DZ_CATALOG__;
  if (!catalog || !catalog.lists) return;
  for (const [mode, list] of Object.entries(targets)) {
    const models = catalog.lists[mode];
    // Keep the built-in list when a provider offers nothing for this mode,
    // so studios that expect at least one model still render.
    if (!Array.isArray(models) || models.length === 0) continue;
    list.length = 0;
    list.push(...models);
  }
}

// DZ: picker entries of the admin's "Recommended" families, in the admin's order.
export function dzRecommendedEntries(entries) {
  return entries
    .filter((entry) => entry.family?.dzRecommended > 0)
    .sort((a, b) => a.family.dzRecommended - b.family.dzRecommended);
}

// DZ: the default model of the first family in a list — the family's preferred
// (cheapest) provider, not simply list[0], which may be a pricier provider.
export function dzFirstModel(list, catalog, mode) {
  const family = catalog?.familyByVariantId?.get(list[0]?.id);
  return family?.variants?.[mode]?.[0]?.model || list[0];
}

// DZ: readable label for a catalog model id in history cards
// ("dz-atlas-kwaivgi-kling-v4.0-text-to-video" → "Kling Video 4.0 · Atlas").
export function dzModelLabel(id) {
  if (typeof window === "undefined" || !id) return null;
  const lists = window.__DZ_CATALOG__?.lists || {};
  for (const list of Object.values(lists)) {
    const model = Array.isArray(list) ? list.find((m) => m.id === id || m.endpoint === id) : null;
    if (model) return [model.dzFamilyName, model.dzProviderName].filter(Boolean).join(" · ");
  }
  return null;
}

// DZ: the Upscale tool (Topaz on fal.ai), present only when fal has a key.
export function dzUpscaleSpec() {
  if (typeof window === 'undefined') return null;
  return window.__DZ_CATALOG__?.tools?.upscale || null;
}

// Opens the upscale drawer for an image from anywhere in the app.
export function dzOpenUpscale(url) {
  if (typeof window === 'undefined' || !url) return;
  window.dispatchEvent(new CustomEvent('dz:upscale', { detail: { url } }));
}

// DZ: video upscaling models (fal + Atlas), present when one of them has a key.
export function dzVideoUpscaleSpec() {
  if (typeof window === 'undefined') return null;
  return window.__DZ_CATALOG__?.tools?.videoUpscale || null;
}
// Opens the Upscale tab with this video.
export function dzOpenVideoUpscale(url) {
  if (typeof window === 'undefined' || !url) return;
  window.dispatchEvent(new CustomEvent('dz:upscale-video', { detail: { url } }));
}

// Only our own files can be upscaled (the server prices them from the file).
export const dzIsOwnImage = (url) => /^(?:https?:\/\/[^/]+)?\/media\/[ug]\//.test(String(url || ''));
