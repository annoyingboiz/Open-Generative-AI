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

const credits = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1000)}k` : String(Math.max(0, Math.round(n))));

// Every enabled provider with a key gets its own chip (no combined total).
// A key that can't read its balance (fal without billing access) shows "—".
export function dzFormatBalances(balances) {
  const shown = (balances || []).filter((b) => b.hasKey && b.enabled);
  if (shown.length === 0) return null;
  return shown.map((b) => ({
    id: b.id,
    name: b.name,
    // ElevenLabs: credits left on the plan ("268k credits"), not dollars.
    text: b.ok && b.amount != null ? (b.currency === 'CREDITS' ? `${credits(b.amount)} credits` : `$${Number(b.amount).toFixed(2)}`) : '—',
    hint: b.ok && b.amount == null ? (b.note || 'This key cannot read the balance.') : (!b.ok ? 'Balance unavailable right now' : b.currency === 'CREDITS' ? `Credits left${b.note ? ` · ${b.note}` : ''}` : 'Balance'),
    low: b.ok && b.amount != null && (b.currency === 'CREDITS' ? b.amount < 5000 : b.amount < 5),
  }));
}
