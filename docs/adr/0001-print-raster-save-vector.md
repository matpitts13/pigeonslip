# ADR 0001: Print from 300 dpi pictures, save as vector PDF

**Date:** 2026-11-19
**Status:** Accepted

## Context

Pigeonslip has to send label sheets to whatever printer the user has, at exactly 4 × 6 in per label, and also offer a saved PDF. Inputs are untrusted PDFs (often one label on a full letter page) and pictures. The app is Electron, with a sandboxed renderer and no Node in the window.

## Options considered

1. **Print the composed PDF.** Build one PDF with pdf-lib and hand it to the printer. Pros: one output path, vector barcodes. Cons: Electron can't print a PDF directly. It would mean loading it into Chromium's PDF viewer in a hidden window (unreliable to print from) or shelling out to a reader app with `PrintTo` (depends on what's installed, and needs `child_process`).
2. **Print true-size HTML sheets made of 300 dpi pictures, and save a separate vector PDF.** The preview DOM is reused under `@media print`, with `@page` set to the paper size and `webContents.print` opening the Windows print dialog. Pros: uses only Chromium's own print path, shows the standard dialog, and the preview matches the printout. Cons: two output paths to keep in step; printed barcodes are raster.
3. **Raster everything (PDF too).** Pros: one path. Cons: larger, blurrier saved files for no gain.

## Decision

Option 2. Chromium's print path is the only one that works on any Windows PC with no extra software. 300 dpi is at or above what home inkjets and 203/300 dpi thermal printers resolve, so USPS barcodes scan fine.

Related choices made with this one:
- **Trim by pixels, not PDF structure.** Each page is rendered at 100 dpi and trimmed to its non-white bounds (`shared/bounds.js`). Label PDFs often wrap the label in a full-page image, or draw a page border, so the content-stream bounds aren't trustworthy.
- **Layout picks the orientation that fits most** (`shared/layout.js`). On letter that means two labels turned sideways and stacked; on a 4 × 6 roll, one upright.
- **One placement function** (`placeInSlot`) feeds both the CSS preview/print and the pdf-lib composer, and `anchor()` converts it to pdf-lib's bottom-left rotation origin, so both outputs turn labels the same way.

## Consequences

- Positive: no external print software and no `child_process`; the preview is what prints; saved PDFs keep vector labels and fall back to the picture for PDFs pdf-lib can't read.
- Negative: two renderers of the same layout (DOM and pdf-lib) must stay consistent. `npm run smoke -- <files>` writes both (`smoke.pdf` and `smoke-print-<paper>.pdf`) so they can be compared.
- Negative: printer drivers can still scale. The status line tells the user to keep 100% / Actual size; we can't force it from `webContents.print`.
- Follow-up: a page holding a label *and* a receipt is trimmed to both. A manual crop or "largest block" heuristic could fix that later.
