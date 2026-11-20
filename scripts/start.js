// Starts the app. VS Code's terminal sets ELECTRON_RUN_AS_NODE, which makes
// Electron run as plain Node with no window, so clear it first.
//   npm start
//   npm run smoke                     (empty window: checks for errors, saves smoke-empty.png)
//   npm run smoke -- a.pdf b.png      (also loads those files, saves smoke.png + smoke.pdf)
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const smoke = process.argv.indexOf("--smoke");
if (smoke >= 0) {
  env.LABELSHEET_SMOKE = path.join(root, ".smoke", "smoke.png");
  env.LABELSHEET_USER_DATA = path.join(root, ".smoke", "profile");
  env.LABELSHEET_SMOKE_FILES = process.argv.slice(smoke + 1).map((f) => path.resolve(f)).join("|");
  const fs = await import("node:fs");
  fs.mkdirSync(path.join(root, ".smoke"), { recursive: true });
}
const child = spawn(electron, ["."], { stdio: "inherit", env, cwd: root });
child.on("exit", (code) => process.exit(code ?? 0));
