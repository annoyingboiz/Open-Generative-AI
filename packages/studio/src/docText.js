// Text out of the documents a person drops into the storyboard entry window (package 05, §4.2).
// Read in the browser with no libraries: plain text, Markdown, Fountain, Final Draft (.fdx)
// and Word (.docx — a zip read with the browser's own deflate). PDF and other formats are
// not read here: the window says so, and the text can be pasted instead.
const TEXT_EXT = /\.(txt|text|md|markdown|fountain|spmd|csv)$/i;
const MAX_FILE = 15 * 1024 * 1024;

export const docKind = (file) => {
  const n = String(file?.name || "");
  if (file?.type?.startsWith("image/")) return "image";
  if (file?.type?.startsWith("video/")) return "video";
  if (TEXT_EXT.test(n) || file?.type === "text/plain" || file?.type === "text/markdown") return "text";
  if (/\.docx$/i.test(n)) return "docx";
  if (/\.fdx$/i.test(n)) return "fdx";
  return "other";
};

const entities = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// One file out of a zip, by its name (stored or deflated).
async function zipEntry(buf, name) {
  const dv = new DataView(buf);
  let e = buf.byteLength - 22;
  const stop = Math.max(0, buf.byteLength - 22 - 65_535);
  while (e >= stop && dv.getUint32(e, true) !== 0x06054b50) e -= 1;
  if (e < stop) return null;
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const dec = new TextDecoder();
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > buf.byteLength || dv.getUint32(p, true) !== 0x02014b50) return null;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    if (dec.decode(new Uint8Array(buf, p + 46, nlen)) === name) {
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      const data = new Uint8Array(buf, start, size);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      return null;
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}

function docxText(xml) {
  return xml.split(/<\/w:p>/).map((para) => {
    let t = "";
    for (const m of para.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)) t += m[1] !== undefined ? entities(m[1]) : m[0] === "<w:tab/>" ? "\t" : "\n";
    return t;
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function fdxText(xml) {
  return [...xml.matchAll(/<Paragraph\b[^>]*>([\s\S]*?)<\/Paragraph>/g)]
    .map((m) => [...m[1].matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/g)].map((t) => entities(t[1].replace(/<[^>]+>/g, ""))).join(""))
    .join("\n\n").trim();
}

// → { text } or { error } (shown on the file's chip).
export async function readDoc(file) {
  const kind = docKind(file);
  if (file.size > MAX_FILE) return { error: "Too big to read" };
  try {
    if (kind === "text") return { text: (await file.text()).replace(/\r\n/g, "\n").trim() };
    if (kind === "fdx") return { text: fdxText(await file.text()) };
    if (kind === "docx") {
      if (typeof DecompressionStream === "undefined") return { error: "This browser can't read Word files" };
      const xml = await zipEntry(await file.arrayBuffer(), "word/document.xml");
      if (!xml) return { error: "Can't read this Word file" };
      return { text: docxText(new TextDecoder().decode(xml)) };
    }
    if (/\.pdf$/i.test(file.name)) return { error: "PDF isn't read yet — paste its text" };
    return { error: "This kind of file isn't read" };
  } catch {
    return { error: "Can't read this file" };
  }
}

export const wordsIn = (text) => (String(text || "").match(/\S+/g) || []).length;
