/**
 * Same-origin Orbit Scheduler store.
 *
 * Browser clients talk to /api/orbit so they are not blocked by JSONBlob's
 * Cloudflare challenge / CORS. This function:
 *   1. Stores boards in memory + /tmp (warm instances)
 *   2. Tries JSONBlob as a durable public store when reachable from Vercel
 *   3. Accepts optional BLOB_READ_WRITE_TOKEN / KV_REST_API_* if configured
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 256 * 1024;
const TMP_FILE = path.join('/tmp', 's4c-orbit-boards.json');
const JSONBLOB = 'https://api.jsonblob.com';
const SLOT_KEY_RE = /^\d{4}-\d{2}-\d{2}T\d{2}$/;

const memory = globalThis.__S4C_ORBIT_STORE__ || (globalThis.__S4C_ORBIT_STORE__ = new Map());
const KV_URL = String(process.env.KV_REST_API_URL || '').replace(/\/$/, '');
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';
loadTmp();

async function kvGet(id) {
  if (!KV_URL || !KV_TOKEN) return null;
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent('orbit:' + id)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (data == null || data.result == null) return null;
  const raw = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
  return normaliseDocument(raw, id);
}

async function kvSet(id, doc) {
  if (!KV_URL || !KV_TOKEN) return;
  await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', 'orbit:' + id, JSON.stringify(doc)])
  });
}

function newId() {
  return 'ob_' + crypto.randomBytes(8).toString('base64url').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12);
}

function loadTmp() {
  try {
    if (!fs.existsSync(TMP_FILE)) return;
    const data = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'));
    Object.entries(data || {}).forEach(([id, doc]) => {
      if (!memory.has(id)) memory.set(id, doc);
    });
  } catch {}
}

function saveTmp() {
  try {
    const data = {};
    memory.forEach((doc, id) => { data[id] = doc; });
    fs.writeFileSync(TMP_FILE, JSON.stringify(data));
  } catch {}
}

function extractJsonblobId(res) {
  const header = res.headers.get('x-jsonblob-id') || res.headers.get('x-jsonblob') || '';
  if (header && header.trim()) return header.trim();
  const location = res.headers.get('location') || '';
  const match = location.match(/\/jsonblob\/([^/?#]+)/i) || location.match(/\/([^/?#]+)\/?(?:[?#]|$)/);
  return match && match[1] ? match[1] : '';
}

function normaliseBoard(raw, fallbackId) {
  if (!raw || typeof raw !== 'object') return null;
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 120) : null;
  const startDate = typeof raw.startDate === 'string' ? raw.startDate : null;
  const endDate = typeof raw.endDate === 'string' ? raw.endDate : null;
  const startHour = Number.isInteger(raw.startHour) ? raw.startHour : parseInt(raw.startHour, 10);
  const endHour = Number.isInteger(raw.endHour) ? raw.endHour : parseInt(raw.endHour, 10);
  if (!title || !startDate || !endDate || !Number.isInteger(startHour) || !Number.isInteger(endHour)) return null;
  if (startDate > endDate || startHour < 0 || endHour > 24 || startHour >= endHour) return null;
  const rawId = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
  const id = !rawId || rawId === 'pending' ? fallbackId : rawId;
  return {
    id,
    title,
    startDate,
    endDate,
    startHour,
    endHour,
    timezone: typeof raw.timezone === 'string' ? raw.timezone : '',
    createdAt: Number(raw.createdAt) || Date.now()
  };
}

function normaliseParticipant(raw, fallbackId) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : fallbackId;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '';
  if (!id || !name) return null;
  const slots = Array.isArray(raw.slots)
    ? Array.from(new Set(raw.slots.filter((slot) => typeof slot === 'string' && SLOT_KEY_RE.test(slot)))).sort()
    : [];
  return { id, name, slots, mergedAt: Number(raw.mergedAt) || undefined };
}

function normaliseDocument(raw, fallbackId) {
  const board = normaliseBoard(raw && raw.board ? raw.board : raw, fallbackId);
  if (!board) return null;
  const participants = {};
  if (raw && raw.participants && typeof raw.participants === 'object') {
    Object.entries(raw.participants).forEach(([id, value]) => {
      const participant = normaliseParticipant(value, id);
      if (participant) participants[participant.id] = participant;
    });
  }
  let booking = null;
  if (raw && raw.booking && typeof raw.booking === 'object') {
    const slot = typeof raw.booking.slot === 'string' && SLOT_KEY_RE.test(raw.booking.slot) ? raw.booking.slot : null;
    const bid = typeof raw.booking.id === 'string' && raw.booking.id.trim() ? raw.booking.id.trim().slice(0, 32) : null;
    if (slot && bid) {
      booking = {
        slot,
        id: bid,
        bookedAt: Number(raw.booking.bookedAt) || Date.now(),
        name: typeof raw.booking.name === 'string' ? raw.booking.name.trim().slice(0, 40) : ''
      };
    }
  }
  return { board, participants, booking, updatedAt: Number(raw && raw.updatedAt) || Date.now() };
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' && req.body) return JSON.parse(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error('payload too large');
  return JSON.parse(raw);
}

async function jsonblobRead(id) {
  const res = await fetch(`${JSONBLOB}/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`jsonblob read ${res.status}`);
  return res.json();
}

async function jsonblobWrite(id, doc) {
  const res = await fetch(`${JSONBLOB}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(doc)
  });
  if (!res.ok) throw new Error(`jsonblob write ${res.status}`);
}

async function jsonblobCreate(doc) {
  const res = await fetch(JSONBLOB, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(doc)
  });
  if (!res.ok) throw new Error(`jsonblob create ${res.status}`);
  const id = extractJsonblobId(res);
  if (!id) throw new Error('jsonblob missing id');
  return id;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const id = (req.query && req.query.id) || new URL(req.url, 'http://localhost').searchParams.get('id');

  try {
    if (req.method === 'GET' && !id) {
      return send(res, 200, { ok: true, service: 'orbit', boards: memory.size });
    }

    if (req.method === 'GET') {
      if (memory.has(id)) return send(res, 200, memory.get(id));
      try {
        const kv = await kvGet(id);
        if (kv) {
          memory.set(id, kv);
          saveTmp();
          return send(res, 200, kv);
        }
      } catch {}
      try {
        const remote = await jsonblobRead(id);
        if (remote) {
          const doc = normaliseDocument(remote, id);
          if (doc) {
            memory.set(id, doc);
            saveTmp();
            try { await kvSet(id, doc); } catch {}
            return send(res, 200, doc);
          }
        }
        if (remote === null) return send(res, 404, { error: 'not found' });
      } catch {}
      return send(res, 404, { error: 'not found' });
    }

    if (req.method === 'POST') {
      const incoming = await readBody(req);
      const preferredId = (incoming.board && incoming.board.id) || incoming.id || newId();
      const doc = normaliseDocument(incoming, preferredId);
      if (!doc) return send(res, 400, { error: 'invalid board' });
      let storedId = preferredId;
      try {
        storedId = await jsonblobCreate(doc);
        doc.board.id = storedId;
      } catch {
        storedId = preferredId.startsWith('ob_') ? preferredId : newId();
        doc.board.id = storedId;
      }
      memory.set(storedId, doc);
      saveTmp();
      try { await kvSet(storedId, doc); } catch {}
      return send(res, 201, { id: storedId, ...doc });
    }

    if (req.method === 'PUT') {
      if (!id) return send(res, 400, { error: 'missing id' });
      const incoming = await readBody(req);
      const doc = normaliseDocument(incoming, id);
      if (!doc) return send(res, 400, { error: 'invalid board' });
      doc.board.id = id;
      memory.set(id, doc);
      saveTmp();
      try { await kvSet(id, doc); } catch {}
      try { await jsonblobWrite(id, doc); } catch {}
      return send(res, 200, { ok: true, ...doc });
    }

    res.setHeader('Allow', 'GET,POST,PUT,OPTIONS');
    return send(res, 405, { error: 'method not allowed' });
  } catch (err) {
    return send(res, 500, { error: err && err.message ? err.message : 'server error' });
  }
};
