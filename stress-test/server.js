"use strict";
// Minimal static file server (no new dependency) so index.html loads over
// http:// instead of file:// -- the Firebase compat SDK scripts get blocked
// under file:// per the project's own README.
const http = require("http");
const fs = require("fs");
const path = require("path");
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

function start(port = config.serverPort) {
  const root = config.repoRoot;
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

module.exports = { start };
