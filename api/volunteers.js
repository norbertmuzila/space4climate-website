/**
 * Volunteer roster — facilitators register the hours they are usually free.
 *
 * Availability is a recurring weekly pattern held in the volunteer's own
 * timezone, as `weekday-hour` slots ("2-14" = Tuesday 14:00), where weekday
 * follows JavaScript's getDay() numbering with 0 = Sunday.
 *
 * GET  /api/volunteers              → service status and roster size
 * GET  /api/volunteers?roster=1     → anonymised availability, for matching
 * GET  /api/volunteers?id=&token=   → one volunteer's own record
 * POST /api/volunteers              → register, returns an edit token
 * PUT  /api/volunteers?id=&token=   → update that registration
 */

const {
  applyCors,
  kvAdd,
  kvGet,
  kvSet,
  newId,
  readBody,
  readIndex,
  send,
  storageReady,
  validateVolunteer
} = require('./_scheduling');

const KEY = 'vol:';
const INDEX = 'vol:index';

/** Everything a browser may see: availability shape, never who it belongs to. */
function anonymise(doc) {
  return { timezone: doc.timezone, slots: doc.slots, languages: doc.languages || [] };
}

/** What the owner of a record may see: their own details, minus the token. */
function ownerView(doc) {
  const { token, ...rest } = doc;
  return rest;
}

module.exports = async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const params = new URL(req.url, 'http://localhost').searchParams;
  const id = (req.query && req.query.id) || params.get('id') || '';
  const token = (req.query && req.query.token) || params.get('token') || '';
  const wantsRoster = params.get('roster') === '1';

  if (!storageReady()) {
    // Never fall back to the public store for records holding personal data.
    return send(res, 503, {
      error: 'storage_unconfigured',
      message: 'Volunteer registration needs KV_REST_API_URL and KV_REST_API_TOKEN to be set.'
    });
  }

  try {
    if (req.method === 'GET' && wantsRoster) {
      const docs = await readIndex(INDEX, KEY);
      return send(res, 200, { ok: true, roster: docs.map(anonymise) });
    }

    if (req.method === 'GET' && !id) {
      const docs = await readIndex(INDEX, KEY);
      return send(res, 200, { ok: true, service: 'volunteers', count: docs.length });
    }

    if (req.method === 'GET') {
      const doc = await kvGet(KEY + id);
      if (!doc) return send(res, 404, { error: 'not_found' });
      if (!token || token !== doc.token) return send(res, 403, { error: 'bad_token' });
      return send(res, 200, { ok: true, volunteer: ownerView(doc) });
    }

    if (req.method === 'POST') {
      const { value, error } = validateVolunteer(await readBody(req));
      if (error) return send(res, 400, { error });
      const doc = {
        id: newId('vl'),
        token: newId('tk'),
        ...value,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await kvSet(KEY + doc.id, doc);
      await kvAdd(INDEX, doc.id);
      return send(res, 201, { ok: true, id: doc.id, token: doc.token, volunteer: ownerView(doc) });
    }

    if (req.method === 'PUT') {
      if (!id) return send(res, 400, { error: 'missing_id' });
      const existing = await kvGet(KEY + id);
      if (!existing) return send(res, 404, { error: 'not_found' });
      if (!token || token !== existing.token) return send(res, 403, { error: 'bad_token' });
      const { value, error } = validateVolunteer(await readBody(req));
      if (error) return send(res, 400, { error });
      const doc = { ...existing, ...value, id: existing.id, token: existing.token, updatedAt: Date.now() };
      await kvSet(KEY + id, doc);
      return send(res, 200, { ok: true, volunteer: ownerView(doc) });
    }

    res.setHeader('Allow', 'GET,POST,PUT,OPTIONS');
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    return send(res, 500, { error: 'server_error', message: err && err.message ? err.message : 'failed' });
  }
};
