// Attachment groups of the Studio strip (redesign 01, §5.4). Built from what the
// chosen model at the chosen provider accepts (entry.slots); nothing hard-coded
// per model. Frames are one group in time order: Start, Mid…, End.

export const GROUPS = [
  // Package 03: image models that can edit get one slot for the picture to change.
  { id: "edit", label: "Image to edit", roles: ["edit"], kind: "image" },
  { id: "frames", label: "Frames", roles: ["first", "middle", "last"], kind: "image" },
  { id: "reference", label: "References", roles: ["reference"], kind: "image" },
  { id: "video", label: "Reference videos", roles: ["video"], kind: "video" },
  { id: "source", label: "Video to edit", roles: ["source"], kind: "video" },
  { id: "audio", label: "Audio", roles: ["audio"], kind: "audio" },
];
export const GROUP_OF_ROLE = Object.fromEntries(GROUPS.flatMap((g) => g.roles.map((r) => [r, g.id])));

// The groups this entry takes: [{ ...group, max, roleMax: { role: max } }].
export function groupsFor(entry) {
  const slotMax = Object.fromEntries((entry?.slots || []).map((s) => [s.role, s.max]));
  return GROUPS.map((g) => {
    const roleMax = Object.fromEntries(g.roles.filter((r) => slotMax[r]).map((r) => [r, slotMax[r]]));
    const max = Object.values(roleMax).reduce((a, b) => a + b, 0);
    return max ? { ...g, max, roleMax } : null;
  }).filter(Boolean);
}

// Items of a group, each { url, name, role, index } (index inside its role list).
// Pass the plan's `sent` view to get what the model gets: then a counter never
// passes its limit (B4); the rest is in the "not used" list.
export function groupItems(attached, group) {
  return group.roles.flatMap((role) => (attached[role] || []).map((f, index) => ({ ...f, role, index })));
}

// Frames from one ordered list → first / middle / last, by the model's limits.
export function distributeFrames(list, roleMax) {
  const out = { first: [], middle: [], last: [] };
  const items = list.slice(0, (roleMax.first || 0) + (roleMax.middle || 0) + (roleMax.last || 0));
  if (!items.length) return out;
  if (roleMax.first) out.first = [items.shift()];
  if (roleMax.last && items.length) {
    if (!roleMax.middle || items.length > 0) out.last = [items.pop()];
  }
  out.middle = items.slice(0, roleMax.middle || 0);
  return out;
}
const strip = ({ url, name }) => ({ url, name: name || "" });

// Add files to a group within its limit. Only files that are on take room
// (package 04: `isOn(item)`; a dimmed file never fills a slot). Frames: into `at`
// (first / middle / last) when given and free, else an empty slot of Start → End → Mid,
// else one held only by a dimmed file — a one-file slot then gets the new file
// instead of the dimmed one. Returns the new `attached`.
export function addToGroup(attached, group, files, at = null, isOn = null) {
  const next = { ...attached };
  const known = new Set(groupItems(attached, group).map((x) => x.url));
  const onCount = (r) => (next[r] || []).filter((f, index) => !isOn || isOn({ ...f, role: r, index })).length;
  const room = (r) => group.roleMax[r] && onCount(r) < group.roleMax[r];
  for (const f of files) {
    if (known.has(f.url)) continue;
    const order = group.id === "frames" ? ["first", "last", "middle"] : group.roles;
    const role = (at && room(at) && at)
      || order.find((r) => room(r) && (next[r] || []).length < group.roleMax[r])
      || order.find((r) => room(r));
    if (!role) break;
    next[role] = group.roleMax[role] === 1 ? [strip(f)] : [...(next[role] || []), strip(f)];
    known.add(f.url);
  }
  return next;
}

// Remove exactly one item (B1): the one with this url, in its own role. Nothing
// else moves, so the kept-but-unused items stay where they were.
export function removeFromGroup(attached, group, url, role = null) {
  const r = role || group.roles.find((x) => (attached[x] || []).some((f) => f.url === url));
  if (!r) return attached;
  const list = attached[r] || [];
  const i = list.findIndex((f) => f.url === url);
  if (i < 0) return attached;
  return { ...attached, [r]: [...list.slice(0, i), ...list.slice(i + 1)] };
}

// Move one item onto another's place inside a group (B2). Frames keep how many
// Start / Mid / End there are: the order changes, the roles' sizes do not.
export function reorderGroup(attached, group, fromUrl, toUrl) {
  const sizes = group.roles.map((r) => (attached[r] || []).length);
  const list = group.roles.flatMap((r) => (attached[r] || []).map(strip));
  const from = list.findIndex((x) => x.url === fromUrl);
  const to = list.findIndex((x) => x.url === toUrl);
  if (from < 0 || to < 0 || from === to) return attached;
  const [x] = list.splice(from, 1);
  list.splice(to, 0, x);
  const next = { ...attached };
  let at = 0;
  group.roles.forEach((r, i) => { next[r] = list.slice(at, at + sizes[i]); at += sizes[i]; });
  return next;
}

export function clearGroup(attached, group) {
  return { ...attached, ...Object.fromEntries(group.roles.map((r) => [r, []])) };
}

// Role words for a frame in order.
export const frameLabel = (item, i, n) => (item.role === "first" ? "Start" : item.role === "last" ? "End" : `Mid ${item.index + 1}`);
