// Shared server-side logic. Runs ONLY on Netlify (never shipped to the browser).
const env = k => process.env[k];
const SB = () => env('SUPABASE_URL');
const KEY = () => env('SUPABASE_SERVICE_ROLE_KEY');

async function sb(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${SB()}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY(), Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const t = await res.text(); return t ? JSON.parse(t) : null;
}

async function verifyAdmin(authHeader) {
  const token = (authHeader || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const r = await fetch(`${SB()}/auth/v1/user`, { headers: { apikey: KEY(), Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  const rows = await sb(`profiles?id=eq.${u.id}&select=id,role`);
  return rows && rows[0] && rows[0].role === 'admin' ? rows[0] : null;   // role checked in the DB, not from the client
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = d => d ? new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: env('SCHOOL_TIMEZONE') || 'UTC' }) : '';

const TABLE = { announcement: 'announcements', assignment: 'assignments', event_reminder: 'event_reminders' };
const LINK = '/#/announcements';

function template(type, rec, name) {
  const site = (env('SITE_URL') || '').replace(/\/$/, '');
  let heading, intro, details = '';
  if (type === 'announcement') {
    heading = 'New school announcement'; intro = rec.message;
    details = `<p style="margin:0 0 6px"><b>Category:</b> ${esc(rec.category)}</p>${rec.event_date ? `<p style="margin:0"><b>Event / deadline:</b> ${esc(rec.event_date)}</p>` : ''}`;
  } else if (type === 'assignment') {
    heading = 'New assignment posted'; intro = (rec.instructions || '').slice(0, 300);
    details = `${rec.subject ? `<p style="margin:0 0 6px"><b>Subject:</b> ${esc(rec.subject)}</p>` : ''}<p style="margin:0"><b>Due:</b> ${esc(fmt(rec.due_at))}</p>`;
  } else {
    heading = 'Upcoming school event'; intro = rec.description || 'A school event is coming up.';
    details = `<p style="margin:0"><b>When:</b> ${esc(fmt(rec.event_at))}</p>`;
  }
  const subject = `${type === 'assignment' ? 'New assignment' : type === 'event_reminder' ? 'Event reminder' : 'Announcement'}: ${rec.title}`;
  const html = `<!doctype html><html><body style="margin:0;background:#EBD8D1;font-family:Nunito,Arial,sans-serif;color:#353233">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="560" style="max-width:100%;background:#FBEDEC;border-radius:20px;border:6px solid #F9EBE9">
<tr><td style="padding:24px 28px 8px"><div style="font-size:24px;font-weight:900;letter-spacing:.02em;color:#57535A">SCHOOLSYNC</div><div style="font-size:11px;letter-spacing:.14em;font-weight:800">YOUR SCHOOL LIFE, IN SYNC</div></td></tr>
<tr><td style="padding:12px 28px"><p style="margin:0 0 4px;font-size:13px;color:#777071">${esc(heading)}</p><h1 style="margin:0 0 12px;font-size:22px">${esc(rec.title)}</h1>
<p style="margin:0 0 16px;line-height:1.5;white-space:pre-wrap">${esc(intro)}</p>
<div style="background:#F0E7E1;border-radius:14px;padding:14px 16px;font-size:14px">${details}</div></td></tr>
<tr><td style="padding:8px 28px 28px"><a href="${esc(site + LINK)}" style="display:inline-block;background:#353233;color:#fff;text-decoration:none;font-weight:800;padding:12px 22px;border-radius:999px">Open in SchoolSync</a>
<p style="font-size:12px;color:#777071;margin:18px 0 0">Hi ${esc(name)}, you received this because you have a SchoolSync account. You can turn off email notifications in your Profile.</p></td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html, text: `${rec.title}\n\n${intro}\n\nOpen SchoolSync: ${site + LINK}` };
}

async function resend(to, mail) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('EMAIL_FROM'), to: [to], subject: mail.subject, html: mail.html, text: mail.text })
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function recipientsOf(rec) {
  const all = await sb('profiles?role=eq.student&select=id,name,email,email_pref');
  const list = rec.notify_all !== false ? all : all.filter(p => (rec.recipient_ids || []).includes(p.id));
  return list.filter(p => p.email_pref !== false);   // respect user preference
}

async function deliver(type, rec, person, existingLog) {
  const key = `${type}:${rec.id}:${person.id}`;
  if (!existingLog) {
    const dup = await sb(`email_logs?dedupe_key=eq.${encodeURIComponent(key)}&status=eq.sent&select=id&limit=1`);
    if (dup && dup.length) return 'duplicate';             // never send the same email twice
  }
  let status = 'sent', error = null;
  try { await resend(person.email, template(type, rec, person.name)); } catch (e) { status = 'failed'; error = e.message; }
  const row = { recipient_id: person.id, recipient_email: person.email, type, ref_id: rec.id, dedupe_key: key, status, error, updated_at: new Date().toISOString() };
  if (existingLog) await sb(`email_logs?id=eq.${existingLog.id}`, { method: 'PATCH', body: row });
  else await sb('email_logs', { method: 'POST', body: { ...row, created_at: row.updated_at } });
  return status;
}

async function sendForRecord(type, id) {
  const table = TABLE[type]; if (!table) throw new Error('Unknown type');
  const rows = await sb(`${table}?id=eq.${id}&select=*`); const rec = rows && rows[0];
  if (!rec) throw new Error('Record not found');
  if (type !== 'event_reminder' && !rec.published) return { skipped: 'not published' };
  const out = { sent: 0, failed: 0, duplicate: 0 };
  for (const p of await recipientsOf(rec)) { const s = await deliver(type, rec, p); out[s === 'sent' ? 'sent' : s === 'failed' ? 'failed' : 'duplicate']++; }
  return out;
}

async function retryLog(logId) {
  const logs = await sb(`email_logs?id=eq.${logId}&select=*`); const log = logs && logs[0];
  if (!log || log.status !== 'failed') return { skipped: 'nothing to retry' };
  const rows = await sb(`${TABLE[log.type]}?id=eq.${log.ref_id}&select=*`); const rec = rows && rows[0];
  const people = await sb(`profiles?id=eq.${log.recipient_id}&select=id,name,email,email_pref`);
  if (!rec || !people[0]) return { skipped: 'record gone' };
  return { status: await deliver(log.type, rec, people[0], log) };
}

module.exports = { sb, verifyAdmin, sendForRecord, retryLog, deliver, recipientsOf, env };
