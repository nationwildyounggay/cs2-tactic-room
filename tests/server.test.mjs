import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import http from 'node:http';
import { createServer } from '../server.mjs';

const quietLogger = { error() {} };

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'cs2-server-test-'));
  const publicDir = path.join(root, 'public');
  const dataDir = path.join(root, 'data');
  await fs.mkdir(publicDir);
  await fs.writeFile(path.join(publicDir, 'index.html'), '<!doctype html><h1>Tactical board</h1>');
  await fs.writeFile(path.join(publicDir, 'app.js'), 'export const ready = true;');
  await fs.writeFile(path.join(publicDir, 'style.css'), 'body { color: white; }');
  await fs.writeFile(path.join(publicDir, 'map.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await fs.writeFile(path.join(root, 'secret.txt'), 'NOT PUBLIC');
  const servers = [];
  async function start(overrides = {}) {
    const server = await createServer({
      dataDir, publicDir, creationLimit: 100, logger: quietLogger, ...options, ...overrides,
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return { server, base: `http://127.0.0.1:${server.address().port}` };
  }
  t.after(async () => {
    for (const server of servers) {
      if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    const absoluteRoot = path.resolve(root);
    assert.equal(path.dirname(absoluteRoot), path.resolve(tmpdir()));
    assert.ok(path.basename(absoluteRoot).startsWith('cs2-server-test-'));
    await fs.rm(absoluteRoot, { recursive: true, force: true });
  });
  return { root, publicDir, dataDir, start, ...await start() };
}

async function request(base, method, endpoint, value, token) {
  const headers = {};
  if (value !== undefined) headers['Content-Type'] = 'application/json';
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${base}${endpoint}`, {
    method, headers, body: value === undefined ? undefined : JSON.stringify(value),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

async function createRoom(base, state = { map: 'mirage', objects: [], nested: { zoom: 1 } }) {
  const response = await request(base, 'POST', '/api/rooms', { state });
  assert.equal(response.status, 201);
  return response.body;
}

async function events(t, url) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const pending = [];
  const received = [];
  let buffer = '';
  let failure;
  const pump = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const lines = frame.split('\n');
          const name = lines.find((line) => line.startsWith('event: '))?.slice(7) ?? 'comment';
          const rawData = lines.filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n');
          const value = { name, data: rawData ? JSON.parse(rawData) : frame };
          const index = pending.findIndex((waiter) => waiter.name === name && waiter.accept(value.data));
          if (index === -1) received.push(value);
          else {
            const [waiter] = pending.splice(index, 1);
            clearTimeout(waiter.timer);
            waiter.resolve(value.data);
          }
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) failure = error;
    } finally {
      for (const waiter of pending.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(failure ?? new Error('SSE stream closed.'));
      }
    }
  })();
  function next(name, accept = () => true) {
    const index = received.findIndex((value) => value.name === name && accept(value.data));
    if (index !== -1) return Promise.resolve(received.splice(index, 1)[0].data);
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const waiter = { name, accept, resolve, reject, timer: undefined };
      waiter.timer = setTimeout(() => {
        pending.splice(pending.indexOf(waiter), 1);
        reject(new Error(`Timed out waiting for SSE ${name}.`));
      }, 3000);
      pending.push(waiter);
    });
  }
  async function close() {
    controller.abort();
    await pump;
  }
  t.after(close);
  return { next, close };
}

test('health, creation, safe IDs, flexible state, and public read contract', async (t) => {
  const { base } = await fixture(t);
  assert.deepEqual((await request(base, 'GET', '/api/health')).body, { ok: true });
  const state = { map: 'ancient', players: [{ x: 0.4, y: 0.5 }], arbitrary: [null, true, 'text'], label: '战术' };
  const created = await createRoom(base, state);
  assert.match(created.roomId, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.match(created.ownerToken, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(Object.keys(created).sort(), ['ownerToken', 'revision', 'roomId', 'state']);
  assert.equal(created.revision, 1);
  assert.deepEqual(created.state, state);
  const read = await request(base, 'GET', `/api/rooms/${created.roomId.toLowerCase()}`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, { roomId: created.roomId, state, revision: 1, viewers: 0 });
  const other = await createRoom(base, {});
  assert.notEqual(other.roomId, created.roomId);
  assert.notEqual(other.ownerToken, created.ownerToken);
  assert.equal((await request(base, 'GET', '/api/rooms/AAAAAA')).status, 404);
  assert.equal((await request(base, 'GET', '/api/unknown')).status, 404);
});

test('writes require owner bearer token and optimistic revisions', async (t) => {
  const { base } = await fixture(t);
  const room = await createRoom(base);
  const endpoint = `/api/rooms/${room.roomId}`;
  const update = { state: { map: 'nuke', annotations: [] }, revision: 1 };
  for (const token of [undefined, 'wrong-token', 'x'.repeat(43)]) {
    const denied = await request(base, 'PUT', endpoint, update, token);
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('www-authenticate'), 'Bearer');
  }
  const success = await request(base, 'PUT', endpoint, update, room.ownerToken);
  assert.equal(success.status, 200);
  assert.deepEqual(success.body, { roomId: room.roomId, ...update, revision: 2, viewers: 0 });
  assert.equal('ownerToken' in success.body, false);
  const stale = await request(base, 'PUT', endpoint, { state: { stale: true }, revision: 1 }, room.ownerToken);
  assert.equal(stale.status, 409);
  assert.equal(typeof stale.body.error, 'string');
  assert.deepEqual(stale.body.state, update.state);
  assert.equal(stale.body.revision, 2);
  for (const revision of [undefined, 0, -1, 1.2, '2', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await request(base, 'PUT', endpoint, { state: {}, revision }, room.ownerToken)).status, 400);
  }
});

test('concurrent writes cannot both commit the same revision; concurrent creates persist together', async (t) => {
  const fixtureValue = await fixture(t);
  const { base, start, server } = fixtureValue;
  const [a, b, c] = await Promise.all([createRoom(base), createRoom(base), createRoom(base)]);
  const results = await Promise.all([
    request(base, 'PUT', `/api/rooms/${a.roomId}`, { state: { winner: 'a' }, revision: 1 }, a.ownerToken),
    request(base, 'PUT', `/api/rooms/${a.roomId}`, { state: { winner: 'b' }, revision: 1 }, a.ownerToken),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const winner = results.find((result) => result.status === 200).body;
  assert.deepEqual(results.find((result) => result.status === 409).body.state, winner.state);
  await new Promise((resolve) => server.close(resolve));
  const restarted = await start();
  for (const room of [a, b, c]) {
    const read = await request(restarted.base, 'GET', `/api/rooms/${room.roomId}`);
    assert.equal(read.status, 200);
    if (room === a) assert.deepEqual(read.body, winner);
  }
});

test('SSE initial snapshot, shared updates, viewer presence, heartbeat, and disconnect cleanup', async (t) => {
  const { base } = await fixture(t, { heartbeatMs: 30 });
  const room = await createRoom(base);
  const endpoint = `/api/rooms/${room.roomId}`;
  const first = await events(t, `${base}${endpoint}/events`);
  assert.deepEqual(await first.next('snapshot'), {
    roomId: room.roomId, state: room.state, revision: 1, viewers: 1,
  });
  assert.deepEqual(await first.next('presence'), { viewers: 1 });
  const second = await events(t, `${base}${endpoint}/events`);
  assert.equal((await second.next('snapshot')).viewers, 2);
  assert.deepEqual(await first.next('presence', (value) => value.viewers === 2), { viewers: 2 });
  assert.equal((await request(base, 'GET', endpoint)).body.viewers, 2);
  const state = { map: 'inferno', strokes: [{ points: [1, 2, 3] }] };
  const update = await request(base, 'PUT', endpoint, { state, revision: 1 }, room.ownerToken);
  assert.equal(update.status, 200);
  assert.equal(update.body.viewers, 2);
  for (const stream of [first, second]) {
    assert.deepEqual(await stream.next('snapshot', (value) => value.revision === 2), update.body);
  }
  assert.match(await first.next('comment'), /heartbeat/);
  await second.close();
  assert.deepEqual(await first.next('presence', (value) => value.viewers === 1), { viewers: 1 });
  assert.equal((await request(base, 'GET', endpoint)).body.viewers, 1);
});

test('persistence preserves state, revisions, and owner authority across restart', async (t) => {
  const { base, server, start, dataDir } = await fixture(t);
  const room = await createRoom(base, { map: 'dust2' });
  const state = { map: 'overpass', persisted: true };
  assert.equal((await request(base, 'PUT', `/api/rooms/${room.roomId}`, { state, revision: 1 }, room.ownerToken)).status, 200);
  const disk = JSON.parse(await fs.readFile(path.join(dataDir, 'rooms.json'), 'utf8'));
  assert.equal(disk.version, 1);
  assert.equal(disk.rooms.length, 1);
  assert.equal(disk.rooms[0].ownerToken, room.ownerToken);
  assert.deepEqual((await fs.readdir(dataDir)).sort(), ['rooms.json']);
  await new Promise((resolve) => server.close(resolve));
  const restarted = await start();
  assert.deepEqual((await request(restarted.base, 'GET', `/api/rooms/${room.roomId}`)).body, {
    roomId: room.roomId, state, revision: 2, viewers: 0,
  });
  assert.equal((await request(restarted.base, 'PUT', `/api/rooms/${room.roomId}`, {
    state: { again: true }, revision: 2,
  }, room.ownerToken)).body.revision, 3);
});

test('validation rejects invalid JSON, non-object states, dangerous keys, nesting, and oversize payloads', async (t) => {
  const { base } = await fixture(t);
  for (const state of [null, [], 'text', 1, true]) {
    assert.equal((await request(base, 'POST', '/api/rooms', { state })).status, 400);
  }
  assert.equal((await request(base, 'POST', '/api/rooms', {})).status, 400);
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const state = JSON.parse(`{"nested":{"${key}":{"polluted":true}}}`);
    assert.equal((await request(base, 'POST', '/api/rooms', { state })).status, 400);
  }
  assert.equal({}.polluted, undefined);
  for (const body of ['{', 'null', '[]', 'false']) {
    const result = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(result.status, 400);
    await result.arrayBuffer();
  }
  const missingType = await fetch(`${base}/api/rooms`, { method: 'POST', body: '{}' });
  assert.equal(missingType.status, 415);
  await missingType.arrayBuffer();
  let deep = {};
  for (let i = 0; i < 102; i++) deep = { child: deep };
  assert.equal((await request(base, 'POST', '/api/rooms', { state: deep })).status, 400);
  const limit = 6 * 1024 * 1024;
  const fits = { text: 'x'.repeat(limit - Buffer.byteLength(JSON.stringify({ text: '' }))) };
  assert.equal((await request(base, 'POST', '/api/rooms', { state: fits })).status, 201);
  assert.equal((await request(base, 'POST', '/api/rooms', { state: { text: `${fits.text}x` } })).status, 413);
  assert.equal((await request(base, 'POST', '/api/rooms', { state: { text: 'x'.repeat(limit + 128 * 1024) } })).status, 413);
});

test('room capacity and creation rate limiting are enforced', async (t) => {
  const capped = await fixture(t, { maxRooms: 1 });
  await createRoom(capped.base);
  assert.equal((await request(capped.base, 'POST', '/api/rooms', { state: {} })).status, 503);
  const limited = await fixture(t, { creationLimit: 1, creationWindowMs: 60_000 });
  await createRoom(limited.base);
  const denied = await request(limited.base, 'POST', '/api/rooms', { state: {} });
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers.get('retry-after')) > 0);
});

function rawGet(base, endpoint) {
  return new Promise((resolve, reject) => {
    const url = new URL(base);
    const req = http.get({ hostname: url.hostname, port: url.port, path: endpoint }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
  });
}

test('static files use safe roots, MIME types, HEAD, and restrictive security headers', async (t) => {
  const { base, publicDir, root } = await fixture(t);
  for (const [endpoint, type] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/style.css', 'text/css'], ['/map.svg', 'image/svg+xml']]) {
    const response = await fetch(`${base}${endpoint}`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(type));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const csp = response.headers.get('content-security-policy');
    assert.match(csp, /connect-src 'self'/);
    assert.match(csp, /img-src 'self' data: blob:/);
    assert.match(csp, /script-src 'self';/);
    assert.match(csp, /style-src 'self' 'unsafe-inline'/);
    await response.arrayBuffer();
  }
  const head = await fetch(`${base}/app.js`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.ok(Number(head.headers.get('content-length')) > 0);
  assert.equal((await fetch(`${base}/does-not-exist`)).status, 404);
  assert.equal((await fetch(`${base}/app.js`, { method: 'POST' })).status, 405);
  for (const endpoint of ['/../secret.txt', '/%2e%2e/secret.txt', '/%2e%2e%2fsecret.txt', '/..%5csecret.txt', '/.env', '/%00', '/%ZZ']) {
    const response = await rawGet(base, endpoint);
    assert.ok([400, 403, 404].includes(response.status), `${endpoint}: ${response.status}`);
    assert.ok(!response.body.includes('NOT PUBLIC'));
  }
  await fs.symlink(path.join(root, 'secret.txt'), path.join(publicDir, 'escape.txt'));
  assert.equal((await fetch(`${base}/escape.txt`)).status, 403);
});

test('corrupt persistence is not silently discarded or overwritten', async (t) => {
  const { dataDir, publicDir, server } = await fixture(t);
  await new Promise((resolve) => server.close(resolve));
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'rooms.json'), '{broken');
  await assert.rejects(createServer({ dataDir, publicDir, logger: quietLogger }), /Cannot load room data/);
  assert.equal(await fs.readFile(path.join(dataDir, 'rooms.json'), 'utf8'), '{broken');
});
