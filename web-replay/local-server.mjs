import http from "node:http";
import { exec, execFile } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const gameRoot = path.resolve(process.env.GAME_ROOT || process.argv[2] || "../GTA San Andreas");
const siteRoot = path.resolve("dist");
const dffLoaderRoot = path.resolve("../tools/DFF-Loader/src");
const recordingsRoot = path.join(gameRoot, "flight_recordings");
const port = Number(process.env.PORT || 4173);

// OpenSA's HTTP-directory loader consumes a flat file index and then performs
// byte-range reads against the original IMG archives.  Keep the index local to
// this machine: no game assets are copied or uploaded anywhere.
const installFiles = new Map();
async function indexInstall(directory = gameRoot, prefix = "") {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (/^(flight_recordings|screens|user files)$/i.test(entry.name)) continue;
      await indexInstall(absolute, relative);
    } else if (entry.isFile()) {
      const stat = await fs.stat(absolute);
      installFiles.set(relative.toLowerCase(), { path: relative.replaceAll("\\", "/"), absolute, size: stat.size });
    }
  }
}
await indexInstall();

const imgCandidates = [
  path.join(gameRoot, "models", "gta3.img"),
  path.join(gameRoot, "models", "gta_int.img"),
  path.join(gameRoot, "SAMP", "SAMP.img"),
  path.join(gameRoot, "SAMP", "custom.img")
];
const archiveEntries = new Map();
const archiveNames = [];
for (const imgPath of imgCandidates) {
  try {
    const img = await fs.open(imgPath, "r");
    const header = Buffer.alloc(8);
    await img.read(header, 0, 8, 0);
    if (header.subarray(0, 4).toString("ascii") !== "VER2") {
      await img.close();
      continue;
    }
    const count = header.readUInt32LE(4);
    const directory = Buffer.alloc(count * 32);
    await img.read(directory, 0, directory.length, 8);
    for (let i = 0; i < count; i += 1) {
      const at = i * 32;
      const name = directory.subarray(at + 8, at + 32).toString("ascii").replace(/\0.*$/, "").toLowerCase();
      // Later archives are deliberate overrides (gta_int/SAMP/custom over gta3).
      archiveEntries.set(name, {
        img,
        archive: path.basename(imgPath),
        offset: directory.readUInt32LE(at) * 2048,
        size: directory.readUInt16LE(at + 4) * 2048
      });
    }
    archiveNames.push(path.relative(gameRoot, imgPath).replaceAll("\\", "/"));
  } catch (error) {
    if (imgPath.endsWith("gta3.img")) throw error;
  }
}

const send = (res, code, body, type = "text/plain; charset=utf-8") => { res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(body); };
const safe = value => value && !value.includes("..") && !value.includes("\\") && !value.startsWith("/") ? value : null;
const contentType = file => file.endsWith(".html") ? "text/html; charset=utf-8"
  : file.endsWith(".js") ? "text/javascript; charset=utf-8"
  : file.endsWith(".css") ? "text/css; charset=utf-8"
  : file.endsWith(".json") || file.endsWith(".webmanifest") ? "application/json; charset=utf-8"
  : file.endsWith(".png") ? "image/png"
  : file.endsWith(".svg") ? "image/svg+xml"
  : file.endsWith(".woff2") ? "font/woff2"
  : "application/octet-stream";
async function mapsManifest() {
  const text = await fs.readFile(path.join(gameRoot, "data", "gta.dat"), "utf8");
  const items = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith("#")) continue;
    const match = /^(IDE|IPL)\s+(.+)$/i.exec(line); if (!match) continue;
    const relative = match[2].trim().replaceAll("\\", "/").replace(/^data\//i, "");
    if (/\.(ipl|ide)$/i.test(relative)) items.push(relative);
  }
  return [...new Set(items)];
}
const mapFiles = await mapsManifest();
// Normal world detail comes only from gta.dat's companion *_streamN IPLs.
// Standalone IPLs are script-controlled world states; for an unlocked replay
// world we intentionally enable Truth's farm and keep barriers/crack/carter off.
const mapBases = new Set(mapFiles
  .filter(name => /\.ipl$/i.test(name))
  .map(name => path.basename(name, path.extname(name)).toLowerCase()));
const binaryIpls = [...archiveEntries.keys()].filter(name => {
  const streamed = /^(.+)_stream\d+\.ipl$/i.exec(name);
  return (streamed && mapBases.has(streamed[1].toLowerCase())) || name === "truthsfarm.ipl";
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`); const pathname = decodeURIComponent(url.pathname);
  try {
    if (pathname === "/webgpu-report" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      await fs.writeFile(path.join(process.cwd(), "webgpu-report.json"), body).catch(() => {});
      console.log(`[webgpu-report] ${body}`);
      return send(res, 200, "ok");
    }
    if (pathname.startsWith("/dff-loader-fixed/")) {
      const name = pathname.slice("/dff-loader-fixed/".length);
      if (!/^(DFFLoader|Reader|TXDLoader|ChunkType)\.js$/.test(name)) return send(res, 403, "Forbidden");
      return send(res, 200, await fs.readFile(path.join(dffLoaderRoot, name)), "text/javascript; charset=utf-8");
    }
    if (pathname === "/game-src/__index") {
      const index = [...installFiles.values()].map(({ path: filePath, size }) => ({ path: filePath, size }));
      return send(res, 200, JSON.stringify(index), "application/json; charset=utf-8");
    }
    if (pathname.startsWith("/game-src/")) {
      const requested = pathname.slice("/game-src/".length).replaceAll("\\", "/");
      if (!safe(requested)) return send(res, 403, "Forbidden");
      const file = installFiles.get(requested.toLowerCase());
      if (!file) return send(res, 404, "Missing GTA file");
      const range = /^bytes=(\d+)-(\d*)$/i.exec(req.headers.range || "");
      if (range) {
        const start = Number(range[1]);
        const requestedEnd = range[2] ? Number(range[2]) : file.size - 1;
        const end = Math.min(requestedEnd, file.size - 1);
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= file.size) {
          res.writeHead(416, { "Content-Range": `bytes */${file.size}` });
          return res.end();
        }
        res.writeHead(206, {
          "Content-Type": contentType(file.path),
          "Content-Length": end - start + 1,
          "Content-Range": `bytes ${start}-${end}/${file.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store"
        });
        return createReadStream(file.absolute, { start, end }).pipe(res);
      }
      res.writeHead(200, {
        "Content-Type": contentType(file.path),
        "Content-Length": file.size,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store"
      });
      return createReadStream(file.absolute).pipe(res);
    }
    if (pathname === "/gta/map-manifest") return send(res, 200, JSON.stringify({ text: mapFiles, binary: binaryIpls, archives: archiveNames }), "application/json");
    if (pathname.startsWith("/gta/model/")) {
      const name = safe(pathname.slice("/gta/model/".length).toLowerCase()); const entry = name && archiveEntries.get(name);
      if (!entry) return send(res, 404, "Missing GTA archive entry");
      const data = Buffer.alloc(entry.size); await entry.img.read(data, 0, entry.size, entry.offset);
      return send(res, 200, data, "application/octet-stream");
    }
    if (pathname.startsWith("/gta/data/")) {
      const relative = pathname.slice("/gta/data/".length).replaceAll("\\", "/");
      const allowedDat = /^(carcols|water|water1|timecyc|timecycp|plants|procobj|object)\.dat$/i.test(relative);
      if (relative.includes("..") || !(/\.(ipl|ide)$/i.test(relative) || allowedDat)) return send(res, 403, "Forbidden");
      return createReadStream(path.join(gameRoot, "data", relative)).on("error", () => send(res, 404, "Missing GTA data file")).pipe(res);
    }
    // Local-only convenience route. It is intentionally limited to files already
    // written by this recorder; no arbitrary path can be read through the browser.
    if (pathname === "/local-recording/latest.csv") {
      const files = (await fs.readdir(recordingsRoot, { withFileTypes: true }))
        .filter(entry => entry.isFile() && /^flight_.*\.csv$/i.test(entry.name));
      if (!files.length) return send(res, 404, "No local flight recordings");
      const dated = await Promise.all(files.map(async entry => ({ name: entry.name, stat: await fs.stat(path.join(recordingsRoot, entry.name)) })));
      dated.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
      return createReadStream(path.join(recordingsRoot, dated[0].name)).on("error", () => send(res, 404, "Recording unavailable")).pipe(res);
    }
    // The replay page is the OpenSA WebGPU build; `/` forwards to it with the query intact so
    // `http://127.0.0.1:4173/?local=latest` (and `?src=`) works unchanged.
    if (pathname === "/") {
      res.writeHead(302, { Location: `/opensa/flight-replay.html${url.search}` });
      return res.end();
    }
    const requested = pathname === "/" ? "index.html" : pathname.slice(1);
    if (!safe(requested)) return send(res, 403, "Forbidden");
    const file = path.join(siteRoot, requested); const content = await fs.readFile(file);
    send(res, 200, content, contentType(file));
  } catch { send(res, 404, "Not found"); }
});
const url = `http://127.0.0.1:${port}/`;

/**
 * Open the page in Chromium. A FRESH throwaway profile is used every launch.
 *
 * Why not the everyday profile or a persistent dedicated one: Chrome's WebGPU adapter handoff breaks when a
 * profile's GPU caches go bad (measured here: `requestAdapter -> null` in the everyday profile while a fresh
 * profile returns the Arc D3D12 adapter), and a force-killed Chrome can poison a REUSED profile. A new profile
 * per run makes the replay immune to both. The default browser is used when no Chromium is found.
 */
const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const chromium = chromeCandidates.find((candidate) => candidate && existsSync(candidate));
const profileRoot = path.join(process.env.LOCALAPPDATA ?? tmpdir(), "GTASA-StuntTools", "chrome-profiles");
const openBrowser = (target) => {
  if (process.env.NO_OPEN) return;
  if (process.platform === "win32" && chromium) {
    let profile = path.join(profileRoot, `run-${Date.now()}`);
    try {
      mkdirSync(profile, { recursive: true });
      // Keep only the three newest run profiles so the folder does not grow without bound.
      const runs = readdirSync(profileRoot)
        .filter((name) => name.startsWith("run-"))
        .sort()
        .reverse();
      for (const stale of runs.slice(3)) {
        rmSync(path.join(profileRoot, stale), { force: true, recursive: true });
      }
    } catch {
      profile = path.join(tmpdir(), `opensa-replay-${Date.now()}`);
    }
    execFile(chromium, [`--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", target], (error) => {
      if (error) console.log(`请手动打开： ${target}`);
    });
    return;
  }
  const opener = process.platform === "darwin" ? `open "${target}"` : `xdg-open "${target}"`;
  exec(opener, (error) => {
    if (error) console.log(`请手动打开： ${target}`);
  });
};

server.on("error", async error => {
  if (error.code === "EADDRINUSE") {
    // The port is taken. It may be THIS service (then just open it), or a different one — a stale server
    // from another checkout serves another site and shows up as "Not found" on our routes, which is a
    // confusing trap. Probe our own page and say which case it is.
    let ours = false;
    try {
      const probe = await fetch(`${url}opensa/flight-replay.html`, { method: "GET" });
      ours = probe.ok;
    } catch {
      ours = false;
    }
    if (ours) {
      console.log(`本地回放服务已经在运行： ${url}`);
    } else {
      console.log(`端口 ${port} 已被另一个进程占用（不是本项目的回放服务）。`);
      console.log(`请先结束占用 ${port} 的进程（可能是旧项目的 local-server），再重新运行本脚本。`);
      console.log(`否则浏览器打开的会是那个旧服务，访问本项目的页面会显示 Not found。`);
    }
    openBrowser(url);
    process.exitCode = 0;
    return;
  }
  throw error;
});
server.listen(port, "127.0.0.1", () => {
  console.log(`本地回放已启动： ${url}`);
  console.log(`本地最新记录： ${url}?local=latest`);
  openBrowser(url);
});
