/**
 * Session requests — a teacher asks for a workshop in a window they choose.
 *
 * The window is a start date/time and an end date/time in a timezone the
 * teacher selects. The end must fall after the start; when both land on the
 * same date that means the end time must be later than the start time. That
 * rule is enforced in the browser for immediate feedback and again here, so
 * the API cannot be handed an impossible window directly.
 *
 * GET  /api/sessions              → service status and request count
 * GET  /api/sessions?id=&token=   → one request, for the teacher who filed it
 * POST /api/sessions              → file a request, returns a reference token
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
  validateSession
} = require('./_scheduling');

const KEY = 'ses:';
const INDEX = 'ses:index';

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

  if (!storageReady()) {
    return send(res, 503, {
      error: 'storage_unconfigured',
      message: 'Session requests need KV_REST_API_URL and KV_REST_API_TOKEN to be set.'
    });
  }

  try {
    if (req.method === 'GET' && !id) {
      const docs = await readIndex(INDEX, KEY);
      return send(res, 200, { ok: true, service: 'sessions', count: docs.length });
    }

    if (req.method === 'GET') {
      const doc = await kvGet(KEY + id);
      if (!doc) return send(res, 404, { error: 'not_found' });
      if (!token || token !== doc.token) return send(res, 403, { error: 'bad_token' });
      return send(res, 200, { ok: true, session: ownerView(doc) });
    }

    if (req.method === 'POST') {
      const { value, error } = validateSession(await readBody(req));
      if (error) return send(res, 400, { error });
      const doc = {
        id: newId('ss'),
        token: newId('tk'),
        ...value,
        status: 'requested',
        createdAt: Date.now()
      };
      await kvSet(KEY + doc.id, doc);
      await kvAdd(INDEX, doc.id);
      return send(res, 201, { ok: true, id: doc.id, token: doc.token, session: ownerView(doc) });
    }

    res.setHeader('Allow', 'GET,POST,OPTIONS');
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    return send(res, 500, { error: 'server_error', message: err && err.message ? err.message : 'failed' });
  }
};
