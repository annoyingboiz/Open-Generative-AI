// Text out of a PDF (package 15, C4: PDF in an assistant's knowledge), with pdf.js (Mozilla,
// Apache-2.0), on this server. No rendering, no fonts, no scripts: text items page by page.
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
let pdfjs = null;
const FONTS = `${path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts')}/`;

export class PdfError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export async function pdfText(buffer, { maxPages = 400, maxChars = 400_000 } = {}) {
  pdfjs ||= await import('pdfjs-dist/legacy/build/pdf.mjs');
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, standardFontDataUrl: FONTS, verbosity: 0 }).promise;
  } catch (error) {
    throw new PdfError(/password/i.test(String(error?.name || error?.message)) ? 'This PDF is locked with a password.' : 'This file could not be read as a PDF.');
  }
  try {
    if (doc.numPages > maxPages) throw new PdfError(`This PDF has ${doc.numPages} pages; up to ${maxPages} can be read.`);
    const pages = [];
    let size = 0;
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((x) => `${x.str || ''}${x.hasEOL ? '\n' : ''}`).join('').replace(/[ \t]+\n/g, '\n').trim();
      page.cleanup();
      if (text) pages.push(text);
      size += text.length;
      if (size > maxChars) break;
    }
    const text = pages.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) throw new PdfError('This PDF has no text in it (a scan or pictures only).');
    return { text, pages: doc.numPages };
  } finally { await doc.destroy().catch(() => {}); }
}
