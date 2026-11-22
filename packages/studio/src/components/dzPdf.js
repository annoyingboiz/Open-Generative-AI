// Text out of a PDF for an assistant's knowledge (package 15, C4): the server reads it with
// pdf.js and sends the text back; it then goes in like a .txt file.
export async function extractPdfText(file) {
  const form = new FormData();
  form.append("file", file, file.name || "file.pdf");
  const res = await fetch("/dz/api/pdf-text", { method: "POST", credentials: "same-origin", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.text !== "string") throw new Error(`${file?.name || "PDF"}: ${data.detail || `HTTP ${res.status}`}`);
  return data.text;
}
