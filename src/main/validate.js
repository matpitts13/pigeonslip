// Checks on everything the window sends to the main process. No Electron
// imports here, so the tests can load it directly.

export const MAX_PDF_BYTES = 500 * 1024 * 1024;

/** Page sizes for webContents.print, in microns. */
export const PRINT_SIZES = {
  letter: { width: 215900, height: 279400 },
  a4: { width: 210000, height: 297000 },
  label4x6: { width: 101600, height: 152400 },
};

/**
 * Keeps a suggested file name to safe, ordinary characters.
 * @param {unknown} name
 */
export function safeFileName(name) {
  const base = typeof name === "string" ? name : "";
  const cleaned = base
    .replace(/\.pdf$/i, "")
    .replace(/[^\p{L}\p{N} ._()-]+/gu, "-")
    .replace(/^[ .-]+|[ .-]+$/g, "")
    .slice(0, 80);
  return `${cleaned || "labels"}.pdf`;
}

/**
 * Validates the save payload.
 * @param {unknown} p
 * @returns {{name:string, bytes:Uint8Array}}
 */
export function checkSavePayload(p) {
  if (!p || typeof p !== "object") throw new Error("Nothing to save.");
  const { name, bytes } = /** @type {any} */ (p);
  if (!(bytes instanceof Uint8Array) || bytes.length < 5 || bytes.length > MAX_PDF_BYTES) throw new Error("The PDF data is missing or too large.");
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") throw new Error("That isn't a PDF.");
  return { name: safeFileName(name), bytes };
}

/** @param {unknown} p */
export function checkPrintPayload(p) {
  const paper = /** @type {any} */ (p)?.paper;
  if (!Object.hasOwn(PRINT_SIZES, paper)) throw new Error("Unknown paper size.");
  return { paper: /** @type {keyof typeof PRINT_SIZES} */ (paper) };
}
