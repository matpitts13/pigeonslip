// The bridge between the window and the main process: two named calls, nothing
// else. (CommonJS, because sandboxed preloads can't be ES modules.)
const { contextBridge, ipcRenderer } = require("electron");

async function call(channel, payload) {
  const r = await ipcRenderer.invoke(channel, payload);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

contextBridge.exposeInMainWorld("api", {
  savePdf: (name, bytes) => call("labels:save-pdf", { name, bytes }),
  print: (paper) => call("labels:print", { paper }),
});
