import JSZip from "jszip";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export async function extractTextFromPdfBuffer(buffer: ArrayBuffer): Promise<string> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
  });
  const pdf = await loadingTask.promise;
  const maxPages = Math.min(pdf.numPages, 40);
  const pageTexts: string[] = [];

  for (let p = 1; p <= maxPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean);
    if (strings.length > 0) {
      pageTexts.push(strings.join(" "));
    }
  }

  return pageTexts.join("\n\n").replace(/[ \t]+/g, " ").trim();
}

export async function extractTextFromDocxBuffer(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    throw new Error("DOCX file does not contain word/document.xml.");
  }
  const xmlText = await docFile.async("string");
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "application/xml");
  const paragraphs = Array.from(xml.getElementsByTagName("w:p"));
  const lines = paragraphs
    .map((p) =>
      Array.from(p.getElementsByTagName("w:t"))
        .map((t) => t.textContent || "")
        .join("")
        .trim()
    )
    .filter(Boolean);
  return lines.join("\n");
}
