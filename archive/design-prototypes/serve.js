"use strict";
/**
 * Static server for design review — usable from a phone on the same Wi-Fi.
 *
 * Deliberately NOT stress-test/server.js with a different bind address:
 *   - that one is pinned to 127.0.0.1 (correct: the harness must never be
 *     reachable off-box), and
 *   - it resolves ANY file under the repo root, including .env.local and
 *     .vercel/. Harmless on loopback; not something to put on a network.
 *
 * This one binds 0.0.0.0 so a phone can reach it, and pays for that by
 * refusing every dot-path and anything outside an extension allowlist. It
 * reads live from the repo (no snapshot) so edits show up on refresh, which
 * is the opposite of what the harness wants but exactly what design work
 * wants.
 *
 *   node archive/design-prototypes/serve.js          # run standalone
 *   require("./serve").start(port)                   # from another script
 *
 * Generated comparison pages in ./out are served at their bare filename,
 * e.g. http://<ip>:8935/masthead.html
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(__dirname, "out");
const DEFAULT_PORT = 8935;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function resolveFile(urlPath) {
  const decoded = decodeURIComponent(String(urlPath).split("?")[0]);
  const rel = decoded === "/" ? "/index.html" : decoded;

  // Refuse any dot-segment: .env.local, .vercel/, .git/, .claude/ …
  if (rel.split("/").some((seg) => seg.startsWith("."))) return null;

  const ext = path.extname(rel).toLowerCase();
  if (!MIME[ext]) return null;

  // Generated pages live in ./out; only .html is ever served from there, since
  // it also collects screenshots and captured DOM that needn't go on a network.
  const fromOut =
    ext === ".html" && !rel.includes("/", 1) && fs.existsSync(path.join(OUT, rel));
  const base = fromOut ? OUT : ROOT;

  const resolved = path.normalize(path.join(base, rel));
  if (!resolved.startsWith(base + path.sep)) return null; // traversal guard
  return resolved;
}

function createServer() {
  return http.createServer((req, res) => {
    const filePath = resolveFile(req.url || "/");
    if (!filePath) {
      res.writeHead(403, { "content-type": "text/plain" });
      return res.end("Forbidden");
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("Not found: " + req.url);
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(filePath).toLowerCase()],
        "cache-control": "no-store", // always the latest edit on refresh
      });
      res.end(data);
    });
  });
}

function lanAddresses() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === "IPv4" && !n.internal) ips.push({ iface: name, addr: n.address });
    }
  }
  return ips;
}

/** Resolves to the listening server. Caller is responsible for close(). */
function start(port = DEFAULT_PORT) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve(server));
  });
}

module.exports = { start, lanAddresses, DEFAULT_PORT, ROOT, OUT };

if (require.main === module) {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  start(port).then(() => {
    console.log("serving " + ROOT);
    console.log("  generated pages from " + OUT);
    console.log("");
    console.log("  http://127.0.0.1:" + port + "/index.html");
    for (const { iface, addr } of lanAddresses()) {
      console.log("  http://" + addr + ":" + port + "/index.html   [" + iface + "]");
    }
    console.log("");
    console.log("Ctrl-C to stop.");
  });
}
