// POST /.netlify/functions/send-email   body: { type, ref_id } | { retry_log_id }
// Authorization: Bearer <Supabase access token>. Only verified admins may call it.
const { verifyAdmin, sendForRecord, retryLog } = require('./_lib/core');
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  try {
    const admin = await verifyAdmin(event.headers.authorization || event.headers.Authorization);
    if (!admin) return json(403, { error: 'Administrator access required' });
    const body = JSON.parse(event.body || '{}');
    if (body.retry_log_id) return json(200, await retryLog(body.retry_log_id));
    if (!body.type || !body.ref_id) return json(400, { error: 'type and ref_id required' });
    return json(200, await sendForRecord(body.type, body.ref_id));
  } catch (e) { console.error(e); return json(500, { error: e.message }); }
};
