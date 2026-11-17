// DZ: replaces the built-in Muapi model lists with models from your providers
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
