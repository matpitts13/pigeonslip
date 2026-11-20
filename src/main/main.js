// Pigeonslip: main process. Serves the window's files from app://pigeonslip/
// (ES modules under a strict Content Security Policy) and registers the two
// IPC channels in ipc.js. Nothing in the window touches the disk directly.
import { app, BrowserWindow, net, protocol } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerIpc } from "./ipc.js";
import { resolveAppUrl, servedFolders } from "./serve.js";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.join(SRC, "..");
const SERVED = servedFolders(SRC, ROOT);

if (process.env.PIGEONSLIP_USER_DATA) app.setPath("userData", process.env.PIGEONSLIP_USER_DATA);

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function serveApp() {
  protocol.handle("app", (request) => {
    const file = resolveAppUrl(request.url, SERVED);
    if (!file) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 760,
    minHeight: 540,
    title: "Pigeonslip",
    icon: path.join(ROOT, "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(SRC, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  // The window never opens popups or navigates away (a stray drop would otherwise open the file).
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadURL("app://pigeonslip/renderer/index.html");
  if (process.env.PIGEONSLIP_SMOKE) smokeTest(win, process.env.PIGEONSLIP_SMOKE, process.env.PIGEONSLIP_SMOKE_FILES);
}

/**
 * `npm run smoke`: loads the app (optionally with sample files), reports
 * console errors, saves screenshots and the composed PDF, then quits.
 * @param {BrowserWindow} win
 * @param {string} outFile screenshot path
 * @param {string|undefined} files paths separated by "|" to load as if dropped
 */
function smokeTest(win, outFile, files) {
  const problems = [];
  win.webContents.on("console-message", (e) => {
    const level = e.level ?? "info";
    if (level === "error" || level === "warning") problems.push(`${level}: ${e.message}`);
  });
  win.webContents.on("render-process-gone", (_e, d) => problems.push(`renderer gone: ${d.reason}`));
  win.webContents.once("did-finish-load", async () => {
    const fs = await import("node:fs");
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(800);
    fs.writeFileSync(outFile.replace(/\.png$/, "-empty.png"), (await win.webContents.capturePage()).toPNG());
    if (files) {
      const list = files.split("|").filter(Boolean).map((f) => ({ name: path.basename(f), data: [...fs.readFileSync(f)] }));
      const result = await win.webContents.executeJavaScript(
        `window.__smokeLoad(${JSON.stringify(list)}).then((pdf) => Array.from(pdf || []), (e) => "ERR " + e.message)`,
      );
      if (typeof result === "string") problems.push(result);
      else if (!result.length) problems.push("no labels were loaded");
      else fs.writeFileSync(outFile.replace(/\.png$/, ".pdf"), Buffer.from(result));
      const shown = await win.webContents.executeJavaScript(
        `document.querySelector(".status.is-error")?.textContent ?? ""`,
      );
      if (shown) problems.push(`app showed an error: ${shown}`);
      // The print path, minus the dialog: same sheets and options, sent to a PDF instead of a printer.
      for (const paperId of (process.env.PIGEONSLIP_SMOKE_PAPERS || "letter").split(",")) {
        await win.webContents.executeJavaScript(`window.__smokePreparePrint(${JSON.stringify(paperId)})`);
        const pdf = await win.webContents.printToPDF({ printBackground: true, margins: { marginType: "none" }, preferCSSPageSize: true });
        fs.writeFileSync(outFile.replace(/\.png$/, `-print-${paperId}.pdf`), pdf);
      }
      await wait(500);
    }
    fs.writeFileSync(outFile, (await win.webContents.capturePage()).toPNG());
    console.log(problems.length ? `SMOKE problems:\n${problems.join("\n")}` : "SMOKE ok: no console errors");
    app.exit(problems.length ? 1 : 0);
  });
}

app.setAppUserModelId("app.pigeonslip");

if (!process.env.PIGEONSLIP_SMOKE && !app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
// The app never asks for camera, microphone, location or notifications.
app.on("web-contents-created", (_e, contents) => {
  contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
});

app.whenReady().then(() => {
  serveApp();
  registerIpc();
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
