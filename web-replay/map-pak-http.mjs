import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createBrotliCompress, createGzip, constants } from "node:zlib";

/** Standard-library-only map delivery: content identity, bounded hashing and HTTP compression. */
export function createMapPakHandler(root) {
  root = path.resolve(root);
  let cached = null;
  let building = null;
  async function inventory(directory = root, prefix = "") {
    const files = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const relative = prefix + entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await inventory(absolute, relative + "/"));
      else if (entry.isFile()) {
        const stat = await fs.stat(absolute);
        files.push({ path: relative, absolute, bytes: stat.size, mtime: stat.mtimeMs });
      }
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }
  async function manifest() {
    if (building) return building;
    building = (async () => {
      const items = await inventory();
      const stamp = JSON.stringify(items.map(file => [file.path, file.bytes, file.mtime]));
      if (cached?.stamp === stamp) return cached;
      const previous = new Map(cached?.items.map(file => [file.path, file]) ?? []);
      let next = 0;
      async function hashFiles() {
        while (next < items.length) {
          const file = items[next++];
          const old = previous.get(file.path);
          if (old?.bytes === file.bytes && old.mtime === file.mtime) file.sha256 = old.sha256;
          else {
            const hash = createHash("sha256");
            for await (const chunk of createReadStream(file.absolute)) hash.update(chunk);
            file.sha256 = hash.digest("hex");
          }
        }
      }
      await Promise.all([hashFiles(), hashFiles()]);
      const files = items.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
      const version = createHash("sha256").update(JSON.stringify(files)).digest("hex");
      cached = { stamp, items, byPath: new Map(items.map(file => [file.path, file])), body: JSON.stringify({ schema: 1, version, files }) };
      return cached;
    })();
    try { return await building; } finally { building = null; }
  }
  return async function serve(req, res, relative, url) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return;
    }
    if (!relative || relative.split("/").some(part => !part || part === "." || part === "..") || relative.includes("\\")) {
      res.writeHead(403); res.end(); return;
    }
    if (relative === "cache-manifest.json") {
      const data = await manifest();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : data.body); return;
    }
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const version = url.searchParams.get("v");
    if (version) {
      const file = (cached ?? await manifest()).byPath.get(relative);
      const current = file && await fs.stat(file.absolute);
      if (!file || file.sha256 !== version || current.size !== file.bytes || current.mtimeMs !== file.mtime) {
        res.writeHead(409, { "Cache-Control": "no-store" }); res.end("Map changed; reload the page."); return;
      }
    }
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) { res.writeHead(404); res.end(); return; }
    const encodings = new Map((req.headers["accept-encoding"] ?? "").split(",").map(item => {
      const [name, ...parameters] = item.trim().split(";");
      const q = parameters.find(value => value.trim().startsWith("q="));
      return [name, q ? Number(q.trim().slice(2)) : 1];
    }));
    const accepted = name => encodings.get(name) ?? encodings.get("*") ?? 0;
    const encoding = stat.size >= 1024 ? (accepted("br") > 0 && accepted("br") >= accepted("gzip") ? "br" : accepted("gzip") > 0 ? "gzip" : null) : null;
    const headers = { "Content-Type": relative.endsWith(".json") ? "application/json; charset=utf-8" : "application/octet-stream",
      "Cache-Control": version ? "public, max-age=31536000, immutable" : "no-cache", "Vary": "Accept-Encoding" };
    if (encoding) headers["Content-Encoding"] = encoding;
    else headers["Content-Length"] = stat.size;
    res.writeHead(200, headers);
    if (req.method === "HEAD") { res.end(); return; }
    const source = createReadStream(absolute);
    if (encoding === "br") await pipeline(source, createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }), res);
    else if (encoding === "gzip") await pipeline(source, createGzip({ level: 6 }), res);
    else await pipeline(source, res);
  };
}
