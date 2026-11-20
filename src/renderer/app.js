// Labelsheet window: add files, see them laid out on sheets, print or save.
import * as PDFLib from "../vendor/pdf-lib/pdf-lib.esm.min.js";
import { composePdf } from "../shared/compose.js";
import { LABEL, PAPERS, paginate, placeInSlot, planSheet } from "../shared/layout.js";
import { loadFile } from "./loader.js";

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const el = {
  paper: /** @type {HTMLSelectElement} */ ($("paper")),
  trim: /** @type {HTMLInputElement} */ ($("trim")),
  guides: /** @type {HTMLInputElement} */ ($("guides")),
  save: /** @type {HTMLButtonElement} */ ($("save")),
  print: /** @type {HTMLButtonElement} */ ($("print")),
  browse: $("browse"),
  file: /** @type {HTMLInputElement} */ ($("file")),
  drop: $("drop"),
  list: $("list"),
  count: $("count"),
  clear: $("clear"),
  status: $("status"),
  summary: $("summary"),
  sheets: $("sheets"),
  veil: $("veil"),
  printRoot: $("print-root"),
};

const GUIDE_OUT = 3 / 72; // cut line sits 3 pt outside the label, same as the PDF

const state = {
  /** @type {import("./loader.js").Label[]} */
  labels: [],
  /** Original files by key, so "Trim white margins" can re-read them. @type {Map<string,{name:string,bytes:Uint8Array}>} */
  files: new Map(),
  /** Source PDFs by sourceId, for vector output. @type {Map<string,Uint8Array>} */
  sources: new Map(),
  /** @type {Set<string>} labels added since the last render (they animate in) */
  fresh: new Set(),
  /** @type {{name:string}[]} files still being read */
  pending: [],
  busy: false,
};
let fileSeq = 1;

// Every change to the label list (add, re-trim, remove, clear) and every
// print/save runs one at a time, in order, so none of them sees the list
// half-changed by another.
let queue = Promise.resolve();
/** @template T @param {() => Promise<T>|T} fn @returns {Promise<T>} */
function enqueue(fn) {
  const run = queue.then(async () => {
    state.busy = true;
    render();
    try {
      return await fn();
    } catch (err) {
      // Jobs report their own expected errors; this catches anything unexpected.
      setStatus(`Something went wrong: ${err instanceof Error ? err.message : err}`, true);
      return undefined;
    } finally {
      state.busy = false;
      render();
    }
  });
  queue = run;
  return run;
}

// ---------- Settings (remembered between runs) ----------

const prefs = loadPrefs();
for (const p of Object.values(PAPERS)) el.paper.add(new Option(p.name, p.id));
el.paper.value = PAPERS[prefs.paper] ? prefs.paper : "letter";
el.trim.checked = prefs.trim !== false;
el.guides.checked = prefs.guides !== false;

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem("labelsheet.prefs") ?? "{}") ?? {};
  } catch {
    return {};
  }
}
function savePrefs() {
  try {
    localStorage.setItem("labelsheet.prefs", JSON.stringify({ paper: el.paper.value, trim: el.trim.checked, guides: el.guides.checked }));
  } catch {
    // storage unavailable: settings just won't be remembered
  }
}

const paper = () => PAPERS[el.paper.value] ?? PAPERS.letter;

// ---------- Adding and removing labels ----------

/**
 * Queues files to be read, in the order given, and appended as labels.
 * @param {{name:string, bytes:Uint8Array}[]} files
 * @param {string[]} [readErrors] problems found while reading them from disk
 */
function addFiles(files, readErrors = []) {
  state.pending.push(...files.map((f) => ({ name: f.name })));
  render();
  return enqueue(() => addFilesNow(files, readErrors));
}

/** @param {{name:string, bytes:Uint8Array}[]} files @param {string[]} readErrors */
async function addFilesNow(files, readErrors) {
  const errors = [...readErrors];
  let skipped = 0;
  const trim = el.trim.checked; // one setting for the whole batch
  for (const f of files) {
    const key = `f${fileSeq++}`;
    try {
      const r = await loadFile(f, { trim });
      state.files.set(key, f);
      if (r.source) state.sources.set(r.source.id, r.source.bytes);
      for (const l of r.labels) {
        l.fileKey = key;
        state.fresh.add(l.id);
      }
      state.labels.push(...r.labels);
      skipped += r.skipped;
      if (!r.labels.length && !r.skipped) errors.push(`${f.name} has no pages.`);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
      state.pending.shift(); // batches run in queue order, so the oldest pending entry is this file
    render();
  }
  const notes = [...errors];
  if (skipped) notes.push(`Skipped ${skipped} blank ${skipped === 1 ? "page" : "pages"}.`);
  setStatus(notes.join(" "), errors.length > 0);
}

/** Re-reads every file (after "Trim white margins" changes), keeping order and removals. */
async function reloadAll() {
  if (!state.labels.length) return;
  const keep = state.labels.map((l) => `${l.fileKey}#${l.pageNo}`);
  const byKey = new Map();
  const trim = el.trim.checked;
  setStatus("Updating labels…");
  try {
    for (const key of new Set(state.labels.map((l) => l.fileKey))) {
      const file = state.files.get(key);
      if (!file) continue;
      const r = await loadFile(file, { trim });
      if (r.source) state.sources.set(r.source.id, r.source.bytes);
      for (const l of r.labels) {
        l.fileKey = key;
        byKey.set(`${key}#${l.pageNo}`, l);
      }
    }
    forget(state.labels);
    state.labels = keep.map((k) => byKey.get(k)).filter(Boolean);
    forget([...byKey.values()].filter((l) => !state.labels.includes(l)));
    setStatus("");
  } catch (err) {
    forget([...byKey.values()]); // keep the old labels; drop the half-made new ones
    setStatus(err instanceof Error ? err.message : String(err), true);
  } finally {
    pruneSources();
  }
}

/** Frees the pictures of labels that are going away. */
function forget(labels) {
  for (const l of labels) URL.revokeObjectURL(l.url);
}

/** Drops source PDFs and files no label uses any more. */
function pruneSources() {
  const usedSources = new Set(state.labels.map((l) => l.sourceId));
  for (const id of state.sources.keys()) if (!usedSources.has(id)) state.sources.delete(id);
  const usedFiles = new Set(state.labels.map((l) => l.fileKey));
  for (const k of state.files.keys()) if (!usedFiles.has(k)) state.files.delete(k);
}

function removeLabel(id) {
  const i = state.labels.findIndex((l) => l.id === id);
  if (i < 0) return;
  forget(state.labels.splice(i, 1));
  pruneSources();
  setStatus("");
  return i;
}

/** Keeps keyboard focus in the list after a row disappears (call once the list is redrawn). */
function focusRow(i) {
  if (i == null) return;
  const rows = el.list.querySelectorAll(".item-remove");
  if (rows.length) /** @type {HTMLElement} */ (rows[Math.min(i, rows.length - 1)]).focus();
  else el.browse.focus();
}

function clearAll() {
  forget(state.labels);
  state.labels = [];
  pruneSources();
  setStatus("");
}

/** @param {FileList|File[]} list */
async function readPicked(list) {
  const files = [];
  const errors = [];
  for (const f of list) {
    try {
      files.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    } catch {
      errors.push(`${f.name} couldn't be read (folders can't be added; drop the files inside).`);
    }
  }
  if (files.length) await addFiles(files, errors);
  else if (errors.length) setStatus(errors.join(" "), true);
}

// ---------- Rendering ----------

function render() {
  const p = paper();
  const plan = planSheet(p);
  const n = state.labels.length;
  const busy = state.busy || state.pending.length > 0;

  el.count.textContent = n ? `${n} ${n === 1 ? "label" : "labels"}` : "No labels yet";
  el.clear.hidden = n === 0;
  el.save.disabled = el.print.disabled = n === 0 || busy;

  el.list.replaceChildren(
    ...state.labels.map((l) => {
      const li = document.createElement("li");
      li.className = "item";
      const img = document.createElement("img");
      img.className = "item-thumb";
      img.src = l.url;
      img.alt = "";
      const text = document.createElement("div");
      text.className = "item-text";
      const name = document.createElement("p");
      name.className = "item-name";
      name.textContent = l.name;
      name.title = l.name;
      const meta = document.createElement("p");
      meta.className = "item-meta";
      meta.textContent = l.pageCount > 1 ? `Page ${l.pageNo} of ${l.pageCount}` : "1 page";
      text.append(name, meta);
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "item-remove";
      rm.setAttribute("aria-label", `Remove ${l.name}${l.pageCount > 1 ? `, page ${l.pageNo}` : ""}`);
      rm.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-x"/></svg>';
      rm.addEventListener("click", () => enqueue(() => removeLabel(l.id)).then(focusRow));
      li.append(img, text, rm);
      return li;
    }),
    ...state.pending.map((f) => {
      const li = document.createElement("li");
      li.className = "item is-loading";
      li.textContent = `Reading ${f.name}…`;
      return li;
    }),
  );

  if (plan.perSheet < 1) {
    el.summary.textContent = "A 4 × 6 in label doesn't fit on this paper.";
    el.sheets.replaceChildren();
    return;
  }
  const pages = paginate(state.labels, plan.perSheet);
  const per = `${plan.perSheet} per sheet`;
  el.summary.textContent = n
    ? `${n} ${n === 1 ? "label" : "labels"} on ${pages.length} ${pages.length === 1 ? "sheet" : "sheets"} · ${per} · each label prints at 4 × 6 in`
    : `Up to ${plan.perSheet} ${plan.perSheet === 1 ? "label fits" : "labels fit"} on each sheet. Add labels to see them here.`;
  el.sheets.style.setProperty("--paper-ratio", `${p.w} / ${p.h}`);
  el.sheets.style.setProperty("--sheet-w", p.w < 5 ? "260px" : "380px");
  const shown = pages.length ? pages : [[]];
  el.sheets.replaceChildren(...shown.map((labels, i) => buildSheet(labels, plan, p, { preview: true, number: i + 1, total: shown.length })));
  state.fresh.clear();
}

/**
 * One sheet of paper with its labels, positioned in % of the sheet so the same
 * markup works for the on-screen preview and the true-size print.
 */
function buildSheet(labels, plan, p, { preview, number, total }) {
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  const pct = (v, of) => `${(v / of) * 100}%`;
  const place = (node, x, y, w, h) => {
    node.style.setProperty("--x", pct(x, p.w));
    node.style.setProperty("--y", pct(y, p.h));
    node.style.setProperty("--w", pct(w, p.w));
    node.style.setProperty("--h", pct(h, p.h));
  };
  plan.slots.forEach((slot, i) => {
    const l = labels[i];
    if (!l) {
      if (preview) {
        const empty = document.createElement("div");
        empty.className = "slot is-empty";
        empty.textContent = labels.length ? "" : `${LABEL.w} × ${LABEL.h} in`;
        place(empty, slot.x, slot.y, slot.w, slot.h);
        sheet.append(empty);
      }
      return;
    }
    if (el.guides.checked) {
      const g = document.createElement("div");
      g.className = "guide";
      const gx = Math.max(0, slot.x - GUIDE_OUT);
      const gy = Math.max(0, slot.y - GUIDE_OUT);
      place(g, gx, gy, Math.min(p.w, slot.x + slot.w + GUIDE_OUT) - gx, Math.min(p.h, slot.y + slot.h + GUIDE_OUT) - gy);
      sheet.append(g);
    }
    const spot = placeInSlot(l.raster.w, l.raster.h, slot);
    const img = document.createElement("img");
    img.className = "art";
    if (preview && state.fresh.has(l.id)) img.classList.add("is-new");
    img.src = l.url;
    img.alt = preview ? `${l.name}${l.pageCount > 1 ? `, page ${l.pageNo}` : ""}` : "";
    // The picture is upright; turned labels rotate about their centre into the footprint.
    const cx = spot.x + spot.w / 2;
    const cy = spot.y + spot.h / 2;
    place(img, cx - spot.drawW / 2, cy - spot.drawH / 2, spot.drawW, spot.drawH);
    img.style.setProperty("--turn", `${spot.turns * 90}deg`);
    sheet.append(img);
  });
  if (preview && total > 1) {
    const no = document.createElement("span");
    no.className = "sheet-no";
    no.textContent = `Sheet ${number} of ${total}`;
    sheet.append(no);
  }
  return sheet;
}

function setStatus(text, isError = false) {
  el.status.textContent = text;
  el.status.classList.toggle("is-error", isError);
}

// ---------- Print and save ----------

const pageRule = new CSSStyleSheet();
document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageRule];

/** Builds the true-size sheets that only show when printing. */
async function preparePrint() {
  const p = paper();
  const plan = planSheet(p);
  pageRule.replaceSync(`@page { size: ${p.w}in ${p.h}in; margin: 0; }`);
  el.printRoot.style.setProperty("--paper-w", `${p.w}in`);
  el.printRoot.style.setProperty("--paper-h", `${p.h}in`);
  el.printRoot.replaceChildren(...paginate(state.labels, plan.perSheet).map((ls, i) => buildSheet(ls, plan, p, { preview: false, number: i + 1, total: 0 })));
  await Promise.all([...el.printRoot.querySelectorAll("img")].map((img) => img.decode().catch(() => {})));
  return p;
}

function printLabels() {
  if (!state.labels.length || state.busy || state.pending.length) return;
  return enqueue(printNow);
}

async function printNow() {
  try {
    const p = await preparePrint();
    setStatus("Opening the print dialog… Choose your printer and keep the scale at 100% (Actual size).");
    const r = await window.api.print(p.id);
    setStatus(r.printed ? "Sent to the printer." : r.reason === "cancelled" ? "" : `Didn't print: ${r.reason}`, !r.printed && r.reason !== "cancelled");
  } catch (err) {
    setStatus(`Couldn't print: ${err instanceof Error ? err.message : err}`, true);
  } finally {
    el.printRoot.replaceChildren();
  }
}

async function buildPdf() {
  return composePdf(PDFLib, state.labels, paper(), { sources: state.sources, guides: el.guides.checked });
}

function savePdf() {
  if (!state.labels.length || state.busy || state.pending.length) return;
  return enqueue(saveNow);
}

async function saveNow() {
  try {
    setStatus("Building the PDF…");
    const bytes = await buildPdf();
    const today = new Date().toISOString().slice(0, 10);
    const r = await window.api.savePdf(`labels-${today}`, bytes);
    setStatus(r.saved ? `Saved to ${r.path}` : "");
  } catch (err) {
    setStatus(`Couldn't save the PDF: ${err instanceof Error ? err.message : err}`, true);
  }
}

// ---------- Events ----------

el.browse.addEventListener("click", () => el.file.click());
el.file.addEventListener("change", async () => {
  const files = [...(el.file.files ?? [])];
  el.file.value = "";
  await readPicked(files);
});
el.clear.addEventListener("click", () => enqueue(clearAll).then(() => el.browse.focus()));
el.paper.addEventListener("change", () => {
  savePrefs();
  render();
});
el.guides.addEventListener("change", () => {
  savePrefs();
  render();
});
el.trim.addEventListener("change", () => {
  savePrefs();
  enqueue(reloadAll);
});
el.print.addEventListener("click", printLabels);
el.save.addEventListener("click", savePdf);

document.addEventListener("keydown", (e) => {
  if (!e.ctrlKey || e.altKey || e.shiftKey) return;
  const k = e.key.toLowerCase();
  if (k === "p") {
    e.preventDefault();
    printLabels();
  } else if (k === "s") {
    e.preventDefault();
    savePdf();
  } else if (k === "o") {
    e.preventDefault();
    el.file.click();
  }
});

// Files can be dropped anywhere in the window.
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (dragDepth++ === 0) {
    el.veil.hidden = false;
    el.drop.classList.add("is-over");
  }
});
window.addEventListener("dragover", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
const endDrag = () => {
  dragDepth = 0;
  el.veil.hidden = true;
  el.drop.classList.remove("is-over");
};
window.addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) endDrag();
});
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  endDrag();
  await readPicked([...(e.dataTransfer?.files ?? [])]);
});

render();

// Test hook for `npm run smoke`: loads files as if dropped and returns the PDF.
// @ts-ignore
window.__smokeLoad = async (list) => {
  await addFiles(list.map((f) => ({ name: f.name, bytes: new Uint8Array(f.data) })));
  return state.labels.length ? buildPdf() : new Uint8Array(0);
};
// @ts-ignore
window.__smokePreparePrint = (paperId) =>
  enqueue(async () => {
    if (paperId) el.paper.value = paperId;
    return (await preparePrint()).id;
  });
