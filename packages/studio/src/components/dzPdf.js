// Text out of a PDF for an assistant's knowledge (package 15, C4).
// Nothing installed reads PDF yet: the way to read it waits for Denis's choice (pdf.js in the
// browser, or poppler on the server). Until then a PDF is refused with a plain reason.
export async function extractPdfText(file) {
  throw new Error(`${file?.name || "This PDF"}: reading PDF files is not switched on yet. Add it as .txt or .md for now.`);
}
