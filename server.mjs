import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_STATE_BYTES = 6 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_STATE_BYTES + 64 * 1024;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json',
};

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)
      || Object.getPrototypeOf(state) !== Object.prototype) {
    throw new HttpError(400, 'State must be a plain JSON object.');
  }
  const pending = [[state, 0]];
  while (pending.length) {
    const [value, depth] = pending.pop();
    if (depth > 100) throw new HttpError(400, 'State nesting exceeds 100 levels.');
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) throw new HttpError(400, 'State contains an unsafe object key.');
      const item = value[key];
      if (item !== null && typeof item === 'object') pending.push([item, depth + 1]);
    }
  }
  if (Buffer.byteLength(JSON.stringify(state)) > MAX_STATE_BYTES) {
    throw new HttpError(413, 'State exceeds the 6 MB limit.');
  }
}

function json(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function readJson(req) {
  const contentType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    req.resume();
    throw new HttpError(415, 'Content-Type must be application/json.');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        chunks.length = 0;
        reject(new HttpError(413, 'Request body is too large.'));
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('Expected object');
        }
        resolve(value);
      } catch {
        reject(new HttpError(400, 'Request body must be a valid JSON object.'));
      }
    });
    req.on('aborted', () => reject(new HttpError(400, 'Request was interrupted.')));
    req.on('error', reject);
  });
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
}

/** Create a ready-to-listen native HTTP server. No listener starts on import. */
export async function createServer({
  dataDir = path.join(ROOT, 'data'),
  publicDir = path.join(ROOT, 'public'),
  maxRooms = 500,
  creationLimit = 20,
  creationWindowMs = 10 * 60 * 1000,
  heartbeatMs = 20 * 1000,
  logger = console,
} = {}) {
  for (const [key, value] of Object.entries({ maxRooms, creationLimit, creationWindowMs, heartbeatMs })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${key} must be a positive integer.`);
  }
  dataDir = path.resolve(dataDir);
  publicDir = path.resolve(publicDir);
  const storePath = path.join(dataDir, 'rooms.json');
  let rooms = new Map();
  const subscribers = new Map();
  const creationRates = new Map();
  let writes = Promise.resolve();
  let closing = false;

  try {
    const stored = JSON.parse(await fs.readFile(storePath, 'utf8'));
    if (stored.version !== 1 || !Array.isArray(stored.rooms) || stored.rooms.length > maxRooms) {
      throw new Error('Unsupported room store.');
    }
    for (const room of stored.rooms) {
      if (!room || !ROOM_PATTERN.test(room.roomId) || rooms.has(room.roomId)
          || typeof room.ownerToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(room.ownerToken)
          || !Number.isSafeInteger(room.revision) || room.revision < 1) {
        throw new Error('Invalid persisted room.');
      }
      validateState(room.state);
      rooms.set(room.roomId, {
        roomId: room.roomId, ownerToken: room.ownerToken, state: room.state, revision: room.revision,
      });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Cannot load room data; refusing to overwrite it.', { cause: error });
  }

  async function persist(nextRooms) {
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
    const tempPath = path.join(dataDir, `.rooms-${process.pid}-${randomBytes(8).toString('hex')}.tmp`);
    let handle;
    try {
      handle = await fs.open(tempPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ version: 1, rooms: [...nextRooms.values()] }));
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(tempPath, storePath);
    } catch (error) {
      await handle?.close().catch(() => {});
      // tempPath is a freshly generated direct child of the configured data directory.
      if (path.dirname(tempPath) === dataDir) await fs.unlink(tempPath).catch(() => {});
      throw error;
    }
  }

  function transaction(operation) {
    const result = writes.then(operation);
    writes = result.catch(() => {});
    return result;
  }

  function snapshot(room) {
    return {
      roomId: room.roomId, state: room.state, revision: room.revision,
      viewers: subscribers.get(room.roomId)?.size ?? 0,
    };
  }

  function event(client, name, payload) {
    if (client.res.destroyed || client.res.writableEnded) return;
    // Bound buffered output when a client stops reading large snapshots.
    if (client.res.writableLength > MAX_STATE_BYTES * 2) {
      client.res.destroy();
      return;
    }
    client.res.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  function broadcast(roomId, name, payload) {
    for (const client of subscribers.get(roomId) ?? []) event(client, name, payload);
  }

  function checkCreationRate(req) {
    const now = Date.now();
    for (const [key, entry] of creationRates) {
      if (entry.until <= now) creationRates.delete(key);
    }
    const key = req.socket.remoteAddress ?? 'unknown';
    let entry = creationRates.get(key);
    if (!entry) {
      // Keep this map bounded even with many distinct client addresses.
      if (creationRates.size >= 10000) creationRates.delete(creationRates.keys().next().value);
      entry = { count: 0, until: now + creationWindowMs };
      creationRates.set(key, entry);
    }
    if (entry.count >= creationLimit) {
      throw new HttpError(429, 'Room creation rate limit exceeded.', {
        retryAfter: Math.max(1, Math.ceil((entry.until - now) / 1000)),
      });
    }
    entry.count += 1;
  }

  function authenticate(req, room) {
    const provided = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(req.headers.authorization ?? '')?.[1];
    const expected = Buffer.from(room.ownerToken);
    const candidate = Buffer.from(provided ?? '');
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      throw new HttpError(401, 'A valid owner token is required.');
    }
  }

  async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      req.resume();
      return json(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' });
    }
    let decoded;
    try { decoded = decodeURIComponent(pathname); }
    catch { throw new HttpError(400, 'Invalid URL encoding.'); }
    if (decoded.includes('\0') || decoded.includes('\\')
        || decoded.split('/').some((part) => part.startsWith('.'))) {
      throw new HttpError(403, 'Forbidden path.');
    }
    let target = path.resolve(publicDir, `.${decoded}`);
    if (!isWithin(publicDir, target)) throw new HttpError(403, 'Forbidden path.');
    let realRoot;
    try {
      realRoot = await fs.realpath(publicDir);
      target = await fs.realpath(target);
      if (!isWithin(realRoot, target)) throw new HttpError(403, 'Forbidden path.');
      let stat = await fs.stat(target);
      if (stat.isDirectory()) {
        target = await fs.realpath(path.join(target, 'index.html'));
        if (!isWithin(realRoot, target)) throw new HttpError(403, 'Forbidden path.');
        stat = await fs.stat(target);
      }
      if (!stat.isFile()) throw new HttpError(404, 'Not found.');
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
      });
      if (req.method === 'HEAD') return res.end();
      const stream = createReadStream(target);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new HttpError(404, 'Not found.');
      if (error.code === 'EACCES' || error.code === 'EPERM') throw new HttpError(403, 'Forbidden path.');
      throw error;
    }
  }

  async function route(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    if (closing) throw new HttpError(503, 'Server is shutting down.');
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { throw new HttpError(400, 'Invalid URL.'); }
    const pathname = url.pathname;

    if (pathname === '/api/health') {
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET' });
      return json(res, 200, { ok: true });
    }

    if (pathname === '/api/rooms') {
      if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
      checkCreationRate(req);
      const body = await readJson(req);
      validateState(body.state);
      const room = await transaction(async () => {
        if (rooms.size >= maxRooms) throw new HttpError(503, 'Room capacity reached.');
        let roomId;
        do {
          roomId = [...randomBytes(6)].map((byte) => ROOM_ALPHABET[byte & 31]).join('');
        } while (rooms.has(roomId));
        const created = { roomId, ownerToken: randomBytes(32).toString('base64url'), state: body.state, revision: 1 };
        const next = new Map(rooms).set(roomId, created);
        await persist(next);
        rooms = next;
        return created;
      });
      return json(res, 201, room);
    }

    const match = /^\/api\/rooms\/([A-Za-z0-9]{6})(\/events)?$/.exec(pathname);
    if (match) {
      const roomId = match[1].toUpperCase();
      const room = rooms.get(roomId);
      if (!room) throw new HttpError(404, 'Room not found.');
      if (match[2]) {
        if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET' });
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();
        const clients = subscribers.get(roomId) ?? new Set();
        subscribers.set(roomId, clients);
        const client = { res, timer: undefined };
        clients.add(client);
        client.timer = setInterval(() => {
          if (res.writableLength > MAX_STATE_BYTES * 2) return res.destroy();
          res.write(': heartbeat\n\n');
        }, heartbeatMs);
        client.timer.unref();
        res.once('close', () => {
          clearInterval(client.timer);
          clients.delete(client);
          if (!clients.size) subscribers.delete(roomId);
          if (!closing) broadcast(roomId, 'presence', { viewers: clients.size });
        });
        event(client, 'snapshot', snapshot(room));
        broadcast(roomId, 'presence', { viewers: clients.size });
        return;
      }
      if (req.method === 'GET') return json(res, 200, snapshot(room));
      if (req.method !== 'PUT') return json(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, PUT' });
      authenticate(req, room);
      const body = await readJson(req);
      validateState(body.state);
      if (!Number.isSafeInteger(body.revision) || body.revision < 1) {
        throw new HttpError(400, 'Revision must be a positive integer.');
      }
      const updated = await transaction(async () => {
        const current = rooms.get(roomId);
        if (body.revision !== current.revision) {
          throw new HttpError(409, 'Revision conflict.', { state: current.state, revision: current.revision });
        }
        if (current.revision >= Number.MAX_SAFE_INTEGER) throw new HttpError(409, 'Revision limit reached.', { state: current.state, revision: current.revision });
        const changed = { ...current, state: body.state, revision: current.revision + 1 };
        const next = new Map(rooms).set(roomId, changed);
        await persist(next);
        rooms = next;
        const value = snapshot(changed);
        broadcast(roomId, 'snapshot', value);
        return value;
      });
      return json(res, 200, updated);
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) throw new HttpError(404, 'API route not found.');
    return serveStatic(req, res, pathname);
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      req.resume();
      if (res.headersSent) return res.destroy();
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) logger.error?.('Request failed:', error);
      const headers = {};
      if (status === 401) headers['WWW-Authenticate'] = 'Bearer';
      if (status === 429) headers['Retry-After'] = String(error.extra.retryAfter);
      const { retryAfter, ...extra } = error instanceof HttpError ? error.extra : {};
      json(res, status, { error: status === 500 ? 'Internal server error.' : error.message, ...extra }, headers);
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  const nativeClose = server.close.bind(server);
  server.close = (callback) => {
    closing = true;
    for (const clients of subscribers.values()) {
      for (const client of clients) {
        clearInterval(client.timer);
        client.res.end();
      }
    }
    return nativeClose(callback);
  };
  return server;
}

async function main() {
  const host = process.env.HOST || '0.0.0.0';
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535.');
  const server = await createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const actualPort = server.address().port;
  const urls = new Set();
  if (host === '0.0.0.0' || host === '::') {
    urls.add(`http://localhost:${actualPort}`);
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (!entry.internal && entry.family === 'IPv4') urls.add(`http://${entry.address}:${actualPort}`);
      }
    }
  } else urls.add(`http://${host.includes(':') ? `[${host}]` : host}:${actualPort}`);
  console.log('CS2 tactical board server:');
  for (const url of urls) console.log(`  ${url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      server.close((error) => {
        if (error) { console.error(error.message); process.exitCode = 1; }
      });
    });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
