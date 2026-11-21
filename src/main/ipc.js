// The only things the window can ask the main process to do: save the
// finished PDF, print the sheets, and open a feedback email. Every payload is
// checked here before use.
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkFeedbackPayload, feedbackMailto } from "./feedback.js";
import { PRINT_SIZES, checkPrintPayload, checkSavePayload } from "./validate.js";

export const CHANNELS = {
  savePdf: "labels:save-pdf",
  print: "labels:print",
  feedback: "labels:feedback",
};

/**
 * Wraps a handler so the window always gets { ok, value } or { ok:false, error }.
 * @param {(e: Electron.IpcMainInvokeEvent, p: unknown) => Promise<unknown>} fn
 */
function handle(channel, fn) {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (e, p) => {
    try {
      // Only Pigeonslip's own page may ask.
      if (!e.senderFrame?.url.startsWith("app://pigeonslip/")) throw new Error("Not allowed.");
      return { ok: true, value: await fn(e, p) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

export function registerIpc() {
  handle(CHANNELS.savePdf, async (e, p) => {
    const { name, bytes } = checkSavePayload(p);
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      title: "Save labels as PDF",
      defaultPath: path.join(app.getPath("documents"), name),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return { saved: false };
    await fs.writeFile(r.filePath, bytes);
    return { saved: true, path: r.filePath };
  });

  handle(CHANNELS.feedback, async (_e, p) => {
    const { kind } = checkFeedbackPayload(p);
    const info = { appName: "Pigeonslip", version: app.getVersion(), os: `Windows ${os.release()} (${process.arch}), Electron ${process.versions.electron}` };
    await shell.openExternal(feedbackMailto(kind, info));
    return { opened: true };
  });

  handle(CHANNELS.print, async (e, p) => {
    const { paper } = checkPrintPayload(p);
    // Opens Windows' own print dialog; the user picks the printer there.
    return new Promise((resolve) => {
      e.sender.print(
        {
          silent: false,
          printBackground: true,
          margins: { marginType: "none" },
          pageSize: PRINT_SIZES[paper],
          landscape: false,
        },
        (success, reason) => resolve({ printed: success, reason: success ? "" : reason }),
      );
    });
  });
}
