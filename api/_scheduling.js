/**
 * Shared store and validation for the volunteer roster and session requests.
 *
 * Unlike /api/orbit, these records hold personal data (names, email
 * addresses), so they are never written to the public JSONBlob fallback.
 * Durable storage is Vercel KV only; when KV is not configured the endpoints
 * refuse writes with `storage_unconfigured` rather than silently dropping —
 * or worse, publicly exposing — someone's details.
 *
 * Files in /api prefixed with an underscore are not routed by Vercel, so this
 * module is a library, not an endpoint.
 */

const crypto = require('crypto');

const MAX_BYTES = 128 * 1024;
const KV_URL = String(process.env.KV_REST_API_URL || '').replace(/\/$/, '');
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';

const SLOT_RE = /^[0-6]-([01]\d|2[0-3])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LANGS = ['en', 'de'];

function storageReady() {
  return Boolean(KV_URL && KV_TOKEN);
}

function newId(prefix) {
  const raw = crypto.randomBytes(9).toString('base64url').replace(/[^a-zA-Z0-9]/g, '');
  return `${prefix}_${raw.slice(0, 12)}`;
}

async function kvCommand(command) {
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!res.ok) throw new Error(`kv ${res.status}`);
  const data = await res.json();
  return data == null ? null : data.result;
}

async function kvGet(key) {
  const result = await kvCommand(['GET', key]);
  if (result == null) return null;
  try {
    return typeof result === 'string' ? JSON.parse(result) : result;
  } catch {
    return null;
  }
}

async function kvSet(key, value) {
  await kvCommand(['SET', key, JSON.stringify(value)]);
}

/** Members of a set, used to enumerate the roster without scanning all keys. */
async function kvMembers(key) {
  const result = await kvCommand(['SMEMBERS', key]);
  return Array.isArray(result) ? result.filter((m) => typeof m === 'string') : [];
}

async function kvAdd(key, member) {
  await kvCommand(['SADD', key, member]);
}

/** Read every record in an index, skipping any that have gone missing. */
async function readIndex(indexKey, prefix) {
  const ids = await kvMembers(indexKey);
  const docs = await Promise.all(
    ids.map(async (id) => {
      try {
        return await kvGet(prefix + id);
      } catch {
        return null;
      }
    })
  );
  return docs.filter(Boolean);
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanSlots(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  value.forEach((slot) => {
    if (typeof slot === 'string' && SLOT_RE.test(slot)) seen.add(slot);
  });
  // Sorted so a stored record is stable and diffable.
  return Array.from(seen).sort((a, b) => {
    const [ad, ah] = a.split('-');
    const [bd, bh] = b.split('-');
    return Number(ad) - Number(bd) || Number(ah) - Number(bh);
  });
}

/**
 * A timezone is accepted only if this runtime can actually resolve it, which
 * rejects both typos and attempts to smuggle arbitrary strings into storage.
 */
function cleanTimezone(value) {
  const tz = cleanText(value, 64);
  if (!tz) return '';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz;
  } catch {
    return '';
  }
}

function cleanLanguages(value) {
  if (!Array.isArray(value)) return [];
  return LANGS.filter((lang) => value.includes(lang));
}

/** Minutes since midnight, for comparing two times on the same date. */
function minutesOf(time) {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

/**
 * The scheduling rule the site promises: a session must end after it starts,
 * and when both ends fall on the same date that means the end *time* must be
 * later than the start time. Enforced here as well as in the browser so the
 * API cannot be handed an impossible window directly.
 */
function windowError({ startDate, startTime, endDate, endTime }) {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) return 'invalid_date';
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) return 'invalid_time';
  if (endDate < startDate) return 'end_before_start';
  if (endDate === startDate && minutesOf(endTime) <= minutesOf(startTime)) return 'end_time_not_after_start';
  return '';
}

function validateVolunteer(raw) {
  const name = cleanText(raw && raw.name, 80);
  const email = cleanText(raw && raw.email, 120).toLowerCase();
  const timezone = cleanTimezone(raw && raw.timezone);
  const slots = cleanSlots(raw && raw.slots);
  if (!name) return { error: 'missing_name' };
  if (!EMAIL_RE.test(email)) return { error: 'invalid_email' };
  if (!timezone) return { error: 'invalid_timezone' };
  if (!slots.length) return { error: 'no_availability' };
  return {
    value: {
      name,
      email,
      timezone,
      slots,
      languages: cleanLanguages(raw && raw.languages),
      organisation: cleanText(raw && raw.organisation, 120),
      notes: cleanText(raw && raw.notes, 600)
    }
  };
}

function validateSession(raw) {
  const contactName = cleanText(raw && raw.contactName, 80);
  const email = cleanText(raw && raw.email, 120).toLowerCase();
  const school = cleanText(raw && raw.school, 120);
  const timezone = cleanTimezone(raw && raw.timezone);
  const startDate = cleanText(raw && raw.startDate, 10);
  const startTime = cleanText(raw && raw.startTime, 5);
  const endDate = cleanText(raw && raw.endDate, 10);
  const endTime = cleanText(raw && raw.endTime, 5);
  if (!contactName) return { error: 'missing_name' };
  if (!EMAIL_RE.test(email)) return { error: 'invalid_email' };
  if (!school) return { error: 'missing_school' };
  if (!timezone) return { error: 'invalid_timezone' };
  const windowIssue = windowError({ startDate, startTime, endDate, endTime });
  if (windowIssue) return { error: windowIssue };
  const students = Number.parseInt(raw && raw.students, 10);
  return {
    value: {
      contactName,
      email,
      school,
      timezone,
      startDate,
      startTime,
      endDate,
      endTime,
      students: Number.isInteger(students) && students > 0 && students <= 2000 ? students : null,
      ageGroup: cleanText(raw && raw.ageGroup, 40),
      language: LANGS.includes(raw && raw.language) ? raw.language : 'en',
      notes: cleanText(raw && raw.notes, 800)
    }
  };
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' && req.body) return JSON.parse(req.body);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error('payload too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Cache-Control', 'no-store');
}

module.exports = {
  LANGS,
  applyCors,
  kvAdd,
  kvGet,
  kvSet,
  newId,
  readBody,
  readIndex,
  send,
  storageReady,
  validateSession,
  validateVolunteer,
  windowError
};
