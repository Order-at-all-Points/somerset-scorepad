"use strict";
// Minimal static file server (no new dependency) so index.html loads over
// http:// instead of file:// -- the Firebase compat SDK scripts get blocked
// under file:// per the project's own README.
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const config = require("./config");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const rel = decoded === "/" ? "/index.html" : decoded;
  const resolved = path.normalize(path.join(root, rel));
  if (!resolved.startsWith(root)) return null; // path traversal guard
  return resolved;
}

/**
 * Copy the served static assets into a throwaway directory and return its path,
 * so a run is immune to the working tree changing under it.
 *
 * This exists because the server reads from disk on every request: checking out
 * another branch (or editing index.html) mid-run silently swaps the app being
 * tested, and the result looks exactly like a real regression. That happened --
 * a full suite ran its local phase against one branch and its sync phase against
 * another, and the output was indistinguishable from a genuine failure until the
 * reflog was checked. A run should test one snapshot, taken once, at the start.
 *
 * Only top-level files: the app is a single-file PWA plus its icons/manifest/sw,
 * and node_modules/stress-test/.git are never served.
 */
function snapshot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "somerset-under-test-"));
  for (const name of fs.readdirSync(config.repoRoot)) {
    const src = path.join(config.repoRoot, name);
    if (!fs.statSync(src).isFile()) continue;
    if (name.startsWith(".")) continue;
    fs.copyFileSync(src, path.join(dir, name));
  }
  return dir;
}

/**
 * `root` defaults to the repo itself (handy for one-off scripts). The
 * orchestrator passes a snapshot() path so a long run can't be corrupted
 * half-way through.
 */
function start(port = config.serverPort, root = config.repoRoot) {
  const server = http.createServer((req, res) => {
    const filePath = safeJoin(root, req.url || "/");
    if (!filePath) {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not found: " + req.url);
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

module.exports = { start, snapshot };
