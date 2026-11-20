import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAppUrl, servedFolders } from "../src/main/serve.js";
import { checkPrintPayload, checkSavePayload, safeFileName } from "../src/main/validate.js";

const SRC = path.resolve("/app/src");
const served = servedFolders(SRC, path.resolve("/app"));

describe("resolveAppUrl", () => {
  it("serves the window's own files and the two vendored libraries", () => {
    expect(resolveAppUrl("app://pigeonslip/renderer/index.html", served)).toBe(path.join(SRC, "renderer", "index.html"));
    expect(resolveAppUrl("app://pigeonslip/vendor/pdfjs/build/pdf.mjs", served)).toBe(path.resolve("/app/node_modules/pdfjs-dist/build/pdf.mjs"));
    expect(resolveAppUrl("app://pigeonslip/vendor/pdf-lib/pdf-lib.esm.min.js", served)).toBe(path.resolve("/app/node_modules/pdf-lib/dist/pdf-lib.esm.min.js"));
  });

  it.each([
    "app://pigeonslip/main/main.js",
    "app://pigeonslip/renderer/../main/ipc.js",
    "app://pigeonslip/renderer/..%2F..%2Fpackage.json",
    "app://pigeonslip/renderer/%2e%2e/main/ipc.js",
    "app://pigeonslip/vendor/pdfjs/../electron/index.js",
    "app://other/renderer/index.html",
    "app://pigeonslip/renderer/%E0%A4%A",
    "file:///etc/passwd",
    "not a url",
  ])("refuses %s", (href) => {
    expect(resolveAppUrl(href, served)).toBeNull();
  });
});

describe("save payload", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\n...");
  it("accepts PDF bytes and cleans the name", () => {
    expect(checkSavePayload({ name: "labels-2026-11-19", bytes: pdf })).toEqual({ name: "labels-2026-11-19.pdf", bytes: pdf });
  });
  it.each([
    [null],
    [{ name: "x" }],
    [{ name: "x", bytes: "%PDF-" }],
    [{ name: "x", bytes: new TextEncoder().encode("hello world") }],
    [{ name: "x", bytes: new Uint8Array(0) }],
  ])("rejects %j", (p) => {
    expect(() => checkSavePayload(p)).toThrow();
  });
});

describe("safeFileName", () => {
  it.each([
    ["labels", "labels.pdf"],
    ["labels.PDF", "labels.pdf"],
    ["..\\..\\Windows\\evil", "Windows-evil.pdf"],
    ["a/b:c*d?", "a-b-c-d.pdf"],
    ["", "labels.pdf"],
    [42, "labels.pdf"],
    ["x".repeat(300), `${"x".repeat(80)}.pdf`],
  ])("%j → %s", (input, out) => {
    expect(safeFileName(input)).toBe(out);
  });
});

describe("print payload", () => {
  it("accepts known papers only", () => {
    expect(checkPrintPayload({ paper: "letter" })).toEqual({ paper: "letter" });
    expect(() => checkPrintPayload({ paper: "toString" })).toThrow();
    expect(() => checkPrintPayload({ paper: "tabloid" })).toThrow();
    expect(() => checkPrintPayload(undefined)).toThrow();
  });
});
