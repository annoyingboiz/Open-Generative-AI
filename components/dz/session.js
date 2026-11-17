// DZ: glue between the studio shell and our gateway.
// The browser never holds a provider key. The gateway authenticates every
// request with the session cookie; studios still receive a placeholder
// `apiKey` prop because upstream code expects a non-empty value.

export const DZ_SESSION_PLACEHOLDER = 'dz-session';

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
