// Scheduled (see netlify.toml): sends event reminders that are due, even when nobody has the app open.
const crypto = require('crypto');
const { sb, deliver, recipientsOf, env } = require('./_lib/core');

exports.handler = async () => {
  const hours = Number(env('REMIND_HOURS_BEFORE') || 24);
  const now = new Date(), horizon = new Date(now.getTime() + hours * 3600e3).toISOString();
  const due = await sb(`event_reminders?sent_at=is.null&event_at=gt.${now.toISOString()}&event_at=lte.${horizon}&select=*`);
  let n = 0;
  for (const rec of due || []) {
    // claim first so overlapping runs cannot double-send
    const claimed = await sb(`event_reminders?id=eq.${rec.id}&sent_at=is.null`, { method: 'PATCH', body: { sent_at: now.toISOString(), updated_at: now.toISOString() }, prefer: 'return=representation' });
    if (!claimed || !claimed.length) continue;
    const people = await recipientsOf(rec);
    const all = await sb('profiles?role=eq.student&select=id');
    const targets = rec.notify_all !== false ? all : all.filter(p => (rec.recipient_ids || []).includes(p.id));
    for (const p of targets) await sb('notifications', { method: 'POST', body: { id: crypto.randomUUID(), user_id: p.id, type: 'event_reminder', title: 'Event reminder: ' + rec.title, body: rec.description || '', link: '#/announcements', ref_id: rec.id, read: false } });
    for (const p of people) await deliver('event_reminder', rec, p);
    n++;
  }
  return { statusCode: 200, body: `Processed ${n} reminder(s)` };
};
