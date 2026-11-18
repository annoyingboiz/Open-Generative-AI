// Attachment groups of the Studio strip (redesign 01, §5.4). Built from what the
// chosen model at the chosen provider accepts (entry.slots); nothing hard-coded
// per model. Frames are one group in time order: Start, Mid…, End.

export const GROUPS = [
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

// Add files to a group within its limit. Frames: into `at` (first / middle / last)
// when given and free, else the first free of Start → End → Mid. Returns the new `attached`.
export function addToGroup(attached, group, files, at = null) {
  const next = { ...attached };
  const known = new Set(groupItems(attached, group).map((x) => x.url));
  for (const f of files) {
    if (known.has(f.url)) continue;
    const order = group.id === "frames" ? [at, "first", "last", "middle"].filter((r, i, a) => r && a.indexOf(r) === i) : group.roles;
    const role = order.find((r) => group.roleMax[r] && (next[r] || []).length < group.roleMax[r]);
    if (!role) break;
    next[role] = [...(next[role] || []), strip(f)];
    known.add(f.url);
  }
  return next;
}

export function removeFromGroup(attached, group, url) {
  if (group.id === "frames") return { ...attached, ...distributeFrames(groupItems(attached, group).filter((x) => x.url !== url).map(strip), group.roleMax) };
  const role = group.roles[0];
  return { ...attached, [role]: (attached[role] || []).filter((f) => f.url !== url) };
}

export function reorderGroup(attached, group, fromUrl, toUrl) {
  const list = groupItems(attached, group).map(strip);
  const from = list.findIndex((x) => x.url === fromUrl);
  const to = list.findIndex((x) => x.url === toUrl);
  if (from < 0 || to < 0 || from === to) return attached;
  const [x] = list.splice(from, 1);
  list.splice(to, 0, x);
  if (group.id === "frames") return { ...attached, ...distributeFrames(list, group.roleMax) };
  return { ...attached, [group.roles[0]]: list };
}

export function clearGroup(attached, group) {
  return { ...attached, ...Object.fromEntries(group.roles.map((r) => [r, []])) };
}

// Role words for a frame in order.
export const frameLabel = (item, i, n) => (item.role === "first" ? "Start" : item.role === "last" ? "End" : `Mid ${item.index + 1}`);

// Attachments this model does not take (kept, not sent).
export function unusedItems(attached, groups) {
  const taken = new Set(groups.flatMap((g) => Object.keys(g.roleMax)));
  return Object.entries(attached || {}).filter(([role]) => !taken.has(role)).flatMap(([role, files]) => (files || []).map((f, index) => ({ ...f, role, index })));
}
