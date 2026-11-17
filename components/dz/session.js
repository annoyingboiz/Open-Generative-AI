// DZ: glue between the upstream studio shell and our gateway.
// The browser never holds a provider key. The gateway authenticates every
// request with the session cookie; studios still receive a placeholder
// `apiKey` prop because upstream code expects a non-empty value.

export const DZ_SESSION_PLACEHOLDER = 'dz-session';

// Tabs that only work with Muapi's own servers (workflow storage, agents,
// design agent, clipping and motion-graphics pipelines, Muapi app showcase).
export const DZ_HIDDEN_TABS = new Set([
  'workflows',
  'agents',
  'design-agent',
  'apps',
  'clipping',
  'vibe-motion',
]);

export function dzFilterNavigation(tabs, categories) {
  for (let i = tabs.length - 1; i >= 0; i -= 1) {
    if (DZ_HIDDEN_TABS.has(tabs[i].id)) tabs.splice(i, 1);
  }
  for (let i = categories.length - 1; i >= 0; i -= 1) {
    categories[i].tabIds = categories[i].tabIds.filter((id) => !DZ_HIDDEN_TABS.has(id));
    if (categories[i].tabIds.length === 0) categories.splice(i, 1);
  }
}

export async function dzFetchMe() {
  const response = await fetch('/dz/api/me', { credentials: 'same-origin' });
  if (response.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    return null;
  }
  if (!response.ok) throw new Error(`Session check failed: ${response.status}`);
  return (await response.json()).user;
}

// Admin: [{ id, name, ok, amount, currency }]. Others: [].
export async function dzFetchBalances() {
  const response = await fetch('/dz/api/balances', { credentials: 'same-origin' });
  if (!response.ok) return [];
  return (await response.json()).balances || [];
}

export function dzFormatBalances(balances) {
  const shown = (balances || []).filter((b) => b.hasKey && b.enabled);
  if (shown.length === 0) return null;
  return shown
    .map((b) => `${b.name} ${b.ok ? `$${Number(b.amount).toFixed(2)}` : '—'}`)
    .join(' · ');
}
