import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { createMapPakHandler } from './map-pak-http.mjs';

test('map compression, identity, version changes and safe paths', async () => {
  const prefix = path.join(tmpdir(), 'gtasa-map-http-test-');
  const root = await fs.mkdtemp(prefix);
  const terrain = Buffer.from('synthetic terrain data '.repeat(800));
  await fs.mkdir(path.join(root, 'cells'));
  await fs.writeFile(path.join(root, 'index.json'), '{}');
  await fs.writeFile(path.join(root, 'cells/0_0.bin'), terrain);
  const handler = createMapPakHandler(root);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      await handler(req, res, decodeURIComponent(url.pathname.slice('/map-pak/'.length)), url);
    } catch { if (res.headersSent) res.destroy(); else { res.writeHead(404); res.end(); } }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (url, encoding) => new Promise((resolve, reject) => {
    const req = http.get(origin + url, { headers: encoding ? { 'Accept-Encoding': encoding } : {} }, res => {
      const parts = []; res.on('data', part => parts.push(part));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
      res.on('error', reject);
    }); req.on('error', reject);
  });
  try {
    const initial = await request('/map-pak/cache-manifest.json');
    assert.equal(initial.status, 200);
    const manifest = JSON.parse(initial.body);
    const file = manifest.files.find(file => file.path === 'cells/0_0.bin');
    assert.equal(file.sha256, createHash('sha256').update(terrain).digest('hex'));
    for (const encoding of ['gzip', 'br']) {
      const reply = await request('/map-pak/cells/0_0.bin?v=' + file.sha256, encoding);
      assert.equal(reply.headers['content-encoding'], encoding);
      assert.match(reply.headers.vary, /Accept-Encoding/);
      assert.deepEqual(encoding === 'br' ? brotliDecompressSync(reply.body) : gunzipSync(reply.body), terrain);
      assert.ok(reply.body.length < terrain.length / 2);
    }
    const rejectedBr = await request('/map-pak/cells/0_0.bin', 'br;q=0,gzip');
    assert.equal(rejectedBr.headers['content-encoding'], 'gzip');
    assert.deepEqual((await request('/map-pak/cells/0_0.bin')).body, terrain);
    assert.equal((await request('/map-pak/%2e%2e%2Foutside')).status, 403);
    await fs.writeFile(path.join(root, 'cells/0_0.bin'), 'updated');
    assert.equal((await request('/map-pak/cells/0_0.bin?v=' + file.sha256)).status, 409);
    const next = JSON.parse((await request('/map-pak/cache-manifest.json')).body);
    assert.notEqual(next.version, manifest.version);
    assert.equal((await request('/map-pak/cells/0_0.bin?v=' + next.files.find(file => file.path === 'cells/0_0.bin').sha256)).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (!path.resolve(root).startsWith(path.resolve(prefix))) throw new Error('Unexpected test directory');
    await fs.rm(root, { recursive: true, force: true });
  }
});
