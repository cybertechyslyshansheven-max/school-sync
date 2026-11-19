/* SchoolSync data layer: offline-first IndexedDB + sync queue + optional Supabase backend. */
window.Store = (function () {
  const cfg = window.SCHOOLSYNC_CONFIG || {};
  const TABLES = ['profiles', 'classes', 'tasks', 'announcements', 'assignments', 'event_reminders', 'notifications', 'email_logs'];
  const OWNER = { classes: 'owner_id', tasks: 'owner_id', notifications: 'user_id' };
  const hasBackend = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  let db, sb = null, user = null, flushing = false, status = navigator.onLine ? 'online' : 'offline';
  const subs = new Set();
  const emit = (t, d) => subs.forEach(f => { try { f(t, d); } catch (e) { console.error(e); } });
  const on = f => { subs.add(f); return () => subs.delete(f); };
  const nowISO = () => new Date().toISOString();
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

  /* ---------- IndexedDB helpers ---------- */
  function open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('schoolsync', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        TABLES.forEach(t => d.createObjectStore(t, { keyPath: 'id' }));
        d.createObjectStore('queue', { keyPath: 'qid', autoIncrement: true });
        d.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function req(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => res(r && r.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  const getAll = s => req(s, 'readonly', o => o.getAll());
  const get = (s, k) => req(s, 'readonly', o => o.get(k));
  const put = (s, v) => req(s, 'readwrite', o => o.put(v));
  const del = (s, k) => req(s, 'readwrite', o => o.delete(k));
  const clear = s => req(s, 'readwrite', o => o.clear());
  const metaGet = async k => { const r = await get('meta', k); return r ? r.value : undefined; };
  const metaSet = (k, v) => put('meta', { key: k, value: v });

  /* ---------- status ---------- */
  function setStatus(s) { status = s; emit('status', s); }
  async function pending() { return db ? (await getAll('queue')).length : 0; }

  /* ---------- init / session ---------- */
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('script load failed')); document.head.appendChild(s); });
  }
  async function init() {
    db = await open();
    window.addEventListener('online', () => { setStatus('online'); flush(); });
    window.addEventListener('offline', () => setStatus('offline'));
    if (hasBackend) {
      try {
        await loadScript(cfg.SUPABASE_JS_URL);
        sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
        const { data } = await sb.auth.getSession();
        if (data && data.session) await adopt(data.session.user);
        sb.auth.onAuthStateChange((ev, session) => { if (ev === 'SIGNED_IN' && session && (!user || user.id !== session.user.id)) adopt(session.user).then(() => emit('auth')); });
      } catch (e) {
        // Offline on a trusted device: fall back to the cached session/profile
        console.warn('Backend unavailable, using cached session', e);
        const id = await metaGet('session');
        if (id) user = (await get('profiles', id)) || null;
      }
    } else {
      const id = await metaGet('session');
      if (id) user = (await get('profiles', id)) || null;
    }
    if (user) flush();
    return user;
  }
  async function adopt(authUser) {
    let prof = null;
    if (navigator.onLine) {
      const { data } = await sb.from('profiles').select('*').eq('id', authUser.id).maybeSingle();
      prof = data;
    }
    if (!prof) prof = await get('profiles', authUser.id);
    if (!prof) prof = { id: authUser.id, name: (authUser.user_metadata && (authUser.user_metadata.full_name || authUser.user_metadata.name)) || authUser.email.split('@')[0], email: authUser.email, batch: cfg.BATCH, role: 'student', email_pref: true };
    const last = await metaGet('lastUser');
    if (last && last !== prof.id) { for (const t of TABLES) await clear(t); await clear('queue'); } // never mix accounts on a shared device
    await metaSet('lastUser', prof.id);
    await put('profiles', prof);
    await metaSet('session', prof.id);
    user = prof;
    flush();
  }

  /* ---------- auth ---------- */
  async function hash(pw, salt) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + pw));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  async function signUp({ name, email, password }) {
    email = email.trim().toLowerCase();
    if (sb) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: location.origin } });
      if (error) throw error;
      if (!data.session) throw new Error('Account created. Check your email to confirm it, then log in.');
      await adopt(data.user);
      return user;
    }
    if (await metaGet('acct:' + email)) throw new Error('An account with this email already exists.');
    const salt = uuid();
    const role = (cfg.ADMIN_EMAILS || []).map(e => e.toLowerCase()).includes(email) ? 'admin' : 'student';
    const prof = { id: uuid(), name, email, batch: cfg.BATCH, role, email_pref: true, created_at: nowISO(), updated_at: nowISO() };
    await put('profiles', prof);
    await metaSet('acct:' + email, { id: prof.id, salt, hash: await hash(password, salt) });
    await metaSet('session', prof.id); user = prof;
    return user;
  }
  async function signIn({ email, password }) {
    email = email.trim().toLowerCase();
    if (sb) {
      if (!navigator.onLine) throw new Error('Logging in needs an internet connection.');
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await adopt(data.user);
      return user;
    }
    const a = await metaGet('acct:' + email);
    if (!a || a.hash !== await hash(password, a.salt)) throw new Error('Incorrect email or password.');
    user = await get('profiles', a.id); await metaSet('session', a.id);
    return user;
  }
  async function signInGoogle() {
    if (!sb) throw new Error('Google sign-in needs the Supabase backend configured (see README). Use email login in demo mode.');
    if (!navigator.onLine) throw new Error('Google sign-in needs an internet connection.');
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
    if (error) throw error;
  }
  async function signOut() {
    try { if (sb) await sb.auth.signOut(); } catch (e) { /* offline: local sign out still proceeds */ }
    await metaSet('session', null); user = null;
  }
  const currentUser = () => user;

  /* ---------- data ---------- */
  async function all(table) { return getAll(table); }
  async function mine(table) {
    const rows = await getAll(table);
    const f = OWNER[table];
    return f && user ? rows.filter(r => r[f] === user.id) : rows;
  }
  async function enqueue(job) { await put('queue', job); emit('queue'); }
  async function save(table, rec) {
    const isNew = !rec.id;
    rec = { ...rec, updated_at: nowISO() };
    if (isNew) { rec.id = uuid(); rec.created_at = rec.updated_at; }
    if (OWNER[table] && !rec[OWNER[table]] && table !== 'notifications') rec[OWNER[table]] = user.id;
    await put(table, rec);
    await enqueue({ table, op: table === 'profiles' ? 'update' : 'upsert', id: rec.id, record: rec, at: nowISO() });
    if (user && table === 'profiles' && user.id === rec.id) user = rec;
    emit('change', table);
    if (!navigator.onLine) emit('saved-offline');
    flush();
    return rec;
  }
  async function remove(table, id) {
    await del(table, id);
    await enqueue({ table, op: 'delete', id, at: nowISO() });
    emit('change', table);
    if (!navigator.onLine) emit('saved-offline');
    flush();
  }

  /* ---------- email ---------- */
  async function sendEmail(type, refId, recipients) {
    if (!hasBackend) {
      for (const r of recipients) {
        const key = `${type}:${refId}:${r.id}`;
        const existing = (await getAll('email_logs')).find(l => l.dedupe_key === key);
        if (existing) continue;
        await put('email_logs', { id: uuid(), recipient_id: r.id, recipient_email: r.email, type, ref_id: refId, dedupe_key: key, status: 'not_sent', error: 'Email provider not configured (local demo mode)', created_at: nowISO(), updated_at: nowISO() });
      }
      emit('change', 'email_logs');
      return;
    }
    await enqueue({ op: 'email', body: { type, ref_id: refId }, at: nowISO() });
    flush();
  }
  async function retryEmail(logId) {
    if (!hasBackend) throw new Error('Email delivery needs the backend configured.');
    await enqueue({ op: 'email', body: { retry_log_id: logId }, at: nowISO() });
    flush();
  }

  /* ---------- sync ---------- */
  async function callEmailFn(body) {
    const { data } = await sb.auth.getSession();
    const res = await fetch(cfg.EMAIL_FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (data.session ? data.session.access_token : '') }, body: JSON.stringify(body) });
    if (res.status === 401 || res.status === 403) return 'rejected';
    if (!res.ok) throw new Error('email function ' + res.status);
  }
  async function runJob(job) {
    if (job.op === 'email') return callEmailFn(job.body);
    let q;
    if (job.op === 'delete') q = sb.from(job.table).delete().eq('id', job.id);
    else if (job.op === 'update') { const { id, role, email, created_at, ...rest } = job.record; q = sb.from(job.table).update(rest).eq('id', id); }
    else q = sb.from(job.table).upsert(job.record);
    const { error } = await q;
    if (error) {
      if (error.code === '42501' || error.code === 'PGRST301' || /permission|policy|row-level/i.test(error.message)) return 'rejected';
      throw error;
    }
  }
  async function pull() {
    const queue = await getAll('queue');
    const pendingIds = new Set(queue.filter(j => j.id).map(j => j.id));
    for (const t of TABLES) {
      const { data, error } = await sb.from(t).select('*');
      if (error) continue;
      const serverIds = new Set(data.map(r => r.id));
      for (const r of data) {
        if (pendingIds.has(r.id)) continue;           // local unsynced edit wins until pushed
        const local = await get(t, r.id);
        if (!local || !local.updated_at || new Date(r.updated_at) >= new Date(local.updated_at)) await put(t, r); // last-write-wins
      }
      for (const l of await getAll(t)) if (!serverIds.has(l.id) && !pendingIds.has(l.id)) await del(t, l.id);
    }
    if (user) { const p = await get('profiles', user.id); if (p) user = p; }
  }
  async function flush() {
    if (flushing || !db || !navigator.onLine) return;
    const q = await getAll('queue');
    if (!sb) { if (q.length) { await clear('queue'); emit('queue'); } return; }   // demo mode: device is the database
    if (!user) return;
    flushing = true; setStatus('syncing');
    let ok = true, rejected = 0;
    for (const job of q) {
      try {
        const r = await runJob(job);
        if (r === 'rejected') rejected++;
        await del('queue', job.qid);
      } catch (e) { console.warn('sync failed, will retry', e); ok = false; break; }
    }
    if (ok) { try { await pull(); } catch (e) { ok = false; } }
    flushing = false; setStatus(navigator.onLine ? 'online' : 'offline');
    if (rejected) emit('rejected', rejected);
    if (ok && q.length) emit('synced');
    emit('queue'); emit('change', '*');
    if (!ok) setTimeout(flush, 15000);   // retry safely
  }
  async function refresh() { if (sb && navigator.onLine) { await flush(); try { await pull(); emit('change', '*'); } catch (e) { /* keep cache */ } } }
  const getStatus = () => status;

  return { init, on, hasBackend, currentUser, signUp, signIn, signInGoogle, signOut, all, mine, save, remove, sendEmail, retryEmail, flush, refresh, pending, getStatus, uuid };
})();
