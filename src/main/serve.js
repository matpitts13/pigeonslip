// Which files the window may load over app://pigeonslip/. No Electron imports,
// so the tests can check it directly.
import path from "node:path";

/**
 * URL prefix → folder on disk. Only these are reachable from the window.
 * @param {string} src the app's src/ folder
 * @param {string} root the project (or packaged app) root
 * @returns {[string, string][]}
 */
export function servedFolders(src, root) {
  return [
    ["/renderer/", path.join(src, "renderer")],
    ["/shared/", path.join(src, "shared")],
    ["/vendor/pdfjs/", path.join(root, "node_modules", "pdfjs-dist")],
    ["/vendor/pdf-lib/", path.join(root, "node_modules", "pdf-lib", "dist")],
  ];
}

/**
 * Maps an app:// URL to a file inside one of the served folders, or null
 * for anything else (other hosts, "..", encoded slashes that escape a folder).
 * @param {string} href
 * @param {[string, string][]} served
 * @returns {string|null}
 */
export function resolveAppUrl(href, served) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "app:" || url.host !== "pigeonslip") return null;
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  for (const [prefix, dir] of served) {
    if (!pathname.startsWith(prefix)) continue;
    const file = path.normalize(path.join(dir, pathname.slice(prefix.length)));
    if (file.startsWith(dir + path.sep)) return file;
  }
  return null;
}
