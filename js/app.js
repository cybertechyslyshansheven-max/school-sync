/* SchoolSync UI: hash router, views, modals, notifications, offline indicator. */
(function () {
  const cfg = window.SCHOOLSYNC_CONFIG, S = window.Store, I = (n, s) => Icons.svg(n, s);
  const $ = (s, e) => (e || document).querySelector(s);
  const $$ = (s, e) => [...(e || document).querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const todayName = () => DAYS[(new Date().getDay() + 6) % 7];
  const longToday = () => new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const isoToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const fmtDate = d => d ? new Date(d.length === 10 ? d + 'T00:00' : d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const fmtDT = d => d ? new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const fmtTime = t => { const [h, m] = t.split(':'); const d = new Date(); d.setHours(+h, +m); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  const toInput = iso => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const fromInput = v => v ? new Date(v).toISOString() : null;
  const firstName = u => (u.name || u.email || '').trim().split(/\s+/)[0];
  const app = () => $('#app');
  let user = null, pageToken = 0, panelOpen = false, drawerOpen = false, openAddTask = false, taskFilter = 'all', deferredInstall = null;

  /* ---------- toasts, modal, confirm ---------- */
  function toast(msg, kind) {
    const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg;
    $('#toasts').appendChild(t); setTimeout(() => t.classList.add('out'), 3200); setTimeout(() => t.remove(), 3700);
  }
  function modal({ title, body, submit = 'Save', block = false, onSubmit, extraFoot = '' }) {
    const ov = document.createElement('div'); ov.className = 'overlay';
    ov.innerHTML = `<form class="modal" novalidate role="dialog" aria-modal="true" aria-label="${esc(title)}"><button type="button" class="x" aria-label="Close">${I('x', 18)}</button><h2>${esc(title)}</h2>${body}<div class="err" role="alert"></div><div class="mfoot ${block ? 'block' : ''}">${extraFoot}${submit ? `<button class="btn dark" type="submit">${esc(submit)}</button>` : ''}</div></form>`;
    document.body.appendChild(ov);
    const f = ov.firstChild, close = () => { ov.remove(); document.removeEventListener('keydown', esc_); };
    const esc_ = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc_);
    $('.x', f).onclick = close;
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    $$('[data-close]', f).forEach(b => b.onclick = close);
    f.onsubmit = async e => {
      e.preventDefault();
      const btn = $('[type=submit]', f); if (btn) { btn.disabled = true; btn.classList.add('loading'); }
      let err = null;
      try { err = onSubmit ? await onSubmit(f) : null; } catch (x) { console.error(x); err = x.message || 'Something went wrong.'; }
      if (err) { $('.err', f).textContent = err; if (btn) { btn.disabled = false; btn.classList.remove('loading'); } } else close();
    };
    const first = $('input:not([type=hidden]),textarea,select', f); if (first && !('ontouchstart' in window)) first.focus();
    return { f, close };
  }
  function confirmBox(message, label = 'Delete') {
    return new Promise(res => {
      const m = modal({ title: 'Please confirm', body: `<p class="muted">${esc(message)}</p>`, submit: label, extraFoot: '<button type="button" class="btn ghost" data-close>Cancel</button>', onSubmit: () => { res(true); return null; } });
      $$('[data-close]', m.f).forEach(b => b.addEventListener('click', () => res(false)));
      $('.x', m.f).addEventListener('click', () => res(false));
    });
  }
  const val = (f, n) => (f.elements[n] ? f.elements[n].value.trim() : '');
  const mustBeOnline = what => { if (!navigator.onLine) { toast(`${what} needs an internet connection.`, 'warn'); return false; } return true; };

  /* ---------- shell ---------- */
  const NAV = [['home', 'Home', 'home'], ['schedules', 'Schedules', 'calendar'], ['todo', 'To Do', 'clipboard'], ['announcements', 'Announcements', 'megaphone'], ['profile', 'Profile', 'user']];
  async function unreadCount() { return (await S.mine('notifications')).filter(n => !n.read).length; }
  async function shell(active, inner) {
    const nav = NAV.slice(); if (user.role === 'admin') nav.push(['admin', 'Dashboard', 'dashboard']);
    const unread = await unreadCount();
    return `<div class="layout ${drawerOpen ? 'drawer-open' : ''}">
      <aside class="sidebar" id="sidebar">
        <a class="brand" href="#/home" aria-label="SchoolSync home"><img src="assets/logo.svg" alt=""><span>SCHOOLSYNC</span></a>
        <nav>${nav.map(([r, l, ic]) => `<a class="nav ${active === r ? 'active' : ''}" href="#/${r}">${I(ic, 20)}<span>${l}</span></a>`).join('')}</nav>
        <button class="nav logout" id="logout">${I('logout', 20)}<span>LOG OUT</span></button>
      </aside>
      <div class="scrim" id="scrim"></div>
      <main class="main">
        <div class="topbar">
          <button class="icon-btn menu-btn" id="menuBtn" aria-label="Open menu">${I('menu', 22)}</button>
          <div class="top-actions">
            <button class="icon-btn" id="bell" aria-label="Notifications">${I('bell', 22)}${unread ? '<span class="dot"></span>' : ''}</button>
            <a class="icon-btn" href="#/profile" aria-label="Profile">${I('user', 22)}</a>
          </div>
        </div>
        <div class="page">${inner}</div>
      </main></div>`;
  }
  function bindShell() {
    $('#logout').onclick = async () => { await S.signOut(); user = null; location.hash = '#/'; };
    $('#menuBtn').onclick = () => { $('.layout').classList.add('drawer-open'); drawerOpen = true; };
    $('#scrim').onclick = () => { $('.layout').classList.remove('drawer-open'); drawerOpen = false; };
    $$('.sidebar a').forEach(a => a.addEventListener('click', () => { drawerOpen = false; }));
    $('#bell').onclick = e => { e.stopPropagation(); panelOpen = !panelOpen; refreshPanel(); };
  }

  /* ---------- notification panel ---------- */
  async function refreshPanel() {
    let p = $('#notifPanel'); if (p) p.remove();
    if (!panelOpen || !user) return;
    const list = (await S.mine('notifications')).sort((a, b) => b.created_at.localeCompare(a.created_at));
    p = document.createElement('div'); p.id = 'notifPanel'; p.className = 'notif-panel';
    p.innerHTML = `<div class="np-head"><strong>Notifications</strong><button class="link" id="markAll">Mark all as read</button></div>
      <div class="np-list">${list.length ? list.slice(0, 30).map(n => `<button class="np-item ${n.read ? '' : 'unread'}" data-id="${n.id}"><span class="np-title">${esc(n.title)}</span><span class="np-body">${esc(n.body || '')}</span><span class="np-time">${fmtDT(n.created_at)}${n.read ? '' : ' • Unread'}</span></button>`).join('') : '<p class="muted np-empty">No notifications yet.</p>'}</div>`;
    document.body.appendChild(p);
    p.onclick = e => e.stopPropagation();
    $('#markAll', p).onclick = async () => { for (const n of list.filter(x => !x.read)) await S.save('notifications', { ...n, read: true }); };
    $$('.np-item', p).forEach(b => b.onclick = async () => {
      const n = list.find(x => x.id === b.dataset.id);
      if (!n.read) await S.save('notifications', { ...n, read: true });
      panelOpen = false; $('#notifPanel') && $('#notifPanel').remove();
      location.hash = n.link || '#/home';
    });
  }
  document.addEventListener('click', () => { if (panelOpen) { panelOpen = false; const p = $('#notifPanel'); if (p) p.remove(); } });
  const shown = new Set();
  async function pushLocal() {
    if (!user || !('Notification' in window) || Notification.permission !== 'granted') return;
    for (const n of (await S.mine('notifications')).filter(n => !n.read)) {
      if (shown.has(n.id)) continue; shown.add(n.id);
      if (!document.hidden && shown.size <= 1) continue;
      try { const reg = await navigator.serviceWorker.getRegistration(); reg ? reg.showNotification(n.title, { body: n.body, icon: 'assets/icon-192.png', data: { link: n.link } }) : new Notification(n.title, { body: n.body }); } catch (e) { /* ignore */ }
    }
  }

  /* ---------- helpers ---------- */
  function empty(msg) { return `<div class="empty">${esc(msg)}</div>`; }
  function heading(icon, text, extra) { return `<div class="page-head"><h1 class="title">${icon ? I(icon, 34) : ''}<span>${esc(text)}</span></h1>${extra || ''}</div>`; }
  const isMine = (rec, u) => rec.notify_all !== false || (rec.recipient_ids || []).includes(u.id);
  async function students() { return (await S.all('profiles')).filter(p => p.role === 'student'); }
  async function recipientsFor(rec) { const st = await students(); return rec.notify_all !== false ? st : st.filter(s => (rec.recipient_ids || []).includes(s.id)); }
  async function fanout(kind, rec, title, body, link) {
    const rs = await recipientsFor(rec);
    for (const s of rs) await S.save('notifications', { user_id: s.id, type: kind, title, body, link, ref_id: rec.id, read: false });
    await S.sendEmail(kind, rec.id, rs);
    return rs.length;
  }
  async function recipientFields(rec) {
    const st = await students();
    const sel = rec && rec.notify_all === false;
    return `<label>Notify</label><select name="notify"><option value="all">Everyone</option><option value="selected" ${sel ? 'selected' : ''}>Selected students</option></select>
      <div class="checklist" id="rlist" style="display:${sel ? 'block' : 'none'}">${st.length ? st.map(s => `<label class="chk"><input type="checkbox" name="rcpt" value="${s.id}" ${rec && (rec.recipient_ids || []).includes(s.id) ? 'checked' : ''}> ${esc(s.name)} <small>${esc(s.email)}</small></label>`).join('') : '<small class="muted">No student accounts yet.</small>'}</div>`;
  }
  function bindRecipients(f) { const s = f.elements.notify; s.onchange = () => { $('#rlist', f).style.display = s.value === 'selected' ? 'block' : 'none'; }; }
  function readRecipients(f) { const all = f.elements.notify.value === 'all'; return { notify_all: all, recipient_ids: all ? [] : $$('[name=rcpt]:checked', f).map(c => c.value) }; }
  const toggle = (name, label, on) => `<label class="switch"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span class="track"></span><span>${label}</span></label>`;

  /* ---------- LANDING + LOGIN ---------- */
  function landing() {
    app().innerHTML = `<div class="landing"><div class="panel"><div class="panel-in">
      <img class="hero-img" src="assets/logo.svg" alt="Books and graduation cap">
      <h1 class="wordmark">SCHOOLSYNC</h1><p class="tagline">YOUR SCHOOL LIFE, IN SYNC</p>
      <a class="role-btn" href="#/login/student">STUDENT</a><a class="role-btn" href="#/login/admin">ADMIN</a>
    </div></div></div>`;
  }
  function login(role) {
    const ROLE = role.toUpperCase(); let mode = 'google', signup = false;
    const draw = () => {
      app().innerHTML = `<div class="split"><section class="split-left"><div class="logo-card"><div class="logo-card-in"><img class="hero-img" src="assets/logo.svg" alt=""><h1 class="wordmark sm">SCHOOLSYNC</h1><p class="tagline sm">YOUR SCHOOL LIFE, IN SYNC</p></div></div></section>
      <section class="split-right"><div class="auth">
        <a class="back" href="#/">${I('back', 16)} Back</a>
        <h1 class="welcome">Welcome!</h1>
        <p class="auth-desc">Log in as <strong>${ROLE}</strong> to access your school account.</p>
        ${mode === 'google' ? `<button class="btn dark wide" id="google">Continue with Google</button>
          <p class="alt">Prefer email &amp; password? <a href="#" id="toEmail">Use email login</a></p>`
        : `<form id="emailForm" novalidate>
          ${signup ? `<label>Full name</label><input name="name" autocomplete="name">` : ''}
          <label>Email</label><input name="email" type="email" autocomplete="email" inputmode="email">
          <label>Password</label><div class="pw"><input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}"><button type="button" class="eye" aria-label="Show password">${I('eye', 18)}</button></div>
          <div class="err" role="alert"></div>
          <button class="btn dark wide" type="submit">${signup ? 'Create account' : 'Log in'}</button>
          <p class="alt">${role === 'student' ? `<a href="#" id="toggleSignup">${signup ? 'I already have an account' : 'Create a student account'}</a> · ` : ''}<a href="#" id="toGoogle">Use Google instead</a></p></form>`}
        <div class="err" id="gerr" role="alert"></div>
        ${role === 'admin' ? '<p class="notice">Admin access is limited to the authorized school administrator account.</p>' : ''}
      </div></section></div>`;
      bind();
    };
    const finish = u => {
      if (role === 'admin' && u.role !== 'admin') { S.signOut(); user = null; return 'This account is not authorized as an administrator.'; }
      user = u; location.hash = '#/home'; return null;
    };
    const bind = () => {
      const g = $('#google');
      if (g) g.onclick = async () => { g.classList.add('loading'); g.disabled = true; try { await S.signInGoogle(); } catch (e) { $('#gerr').textContent = e.message; g.classList.remove('loading'); g.disabled = false; } };
      const te = $('#toEmail'); if (te) te.onclick = e => { e.preventDefault(); mode = 'email'; draw(); };
      const tg = $('#toGoogle'); if (tg) tg.onclick = e => { e.preventDefault(); mode = 'google'; draw(); };
      const ts = $('#toggleSignup'); if (ts) ts.onclick = e => { e.preventDefault(); signup = !signup; draw(); };
      const eye = $('.eye'); if (eye) eye.onclick = () => { const i = $('[name=password]'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; eye.innerHTML = I(show ? 'eyeOff' : 'eye', 18); };
      const ef = $('#emailForm');
      if (ef) ef.onsubmit = async e => {
        e.preventDefault(); const err = $('.err', ef); err.textContent = '';
        const email = val(ef, 'email'), password = ef.elements.password.value, name = signup ? val(ef, 'name') : '';
        if (signup && !name) return err.textContent = 'Please enter your name.';
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err.textContent = 'Enter a valid email address.';
        if (password.length < 6) return err.textContent = 'Password must be at least 6 characters.';
        const b = $('[type=submit]', ef); b.disabled = true; b.classList.add('loading');
        try { const u = signup ? await S.signUp({ name, email, password }) : await S.signIn({ email, password }); const m = finish(u); if (m) err.textContent = m; }
        catch (x) { err.textContent = x.message || 'Login failed.'; }
        b.disabled = false; b.classList.remove('loading');
      };
    };
    draw();
  }

  /* ---------- HOME ---------- */
  async function pageHome() {
    const tasks = (await S.mine('tasks')).filter(t => !t.done).sort((a, b) => (a.due_at || '9').localeCompare(b.due_at || '9'));
    const classes = (await S.mine('classes')).filter(c => c.day === todayName()).sort((a, b) => a.start_time.localeCompare(b.start_time));
    const asg = (await S.all('assignments')).filter(a => a.published && isMine(a, user) && a.due_at && new Date(a.due_at) > new Date()).sort((a, b) => a.due_at.localeCompare(b.due_at));
    const bits = [];
    tasks.slice(0, 4).forEach(t => bits.push(`<li class="${t.due_at && new Date(t.due_at) < new Date() ? 'overdue' : ''}"><strong>${esc(t.title)}</strong>${t.due_at ? ` <small>due ${fmtDT(t.due_at)}${new Date(t.due_at) < new Date() ? ' • overdue' : ''}</small>` : ''}</li>`));
    asg.slice(0, 3).forEach(a => bits.push(`<li><strong>${esc(a.title)}</strong> <small>assignment${a.subject ? ' · ' + esc(a.subject) : ''} · due ${fmtDT(a.due_at)}</small></li>`));
    const now = new Date(); const nowHM = now.toTimeString().slice(0, 5); const next = classes.find(c => c.end_time > nowHM);
    if (next) bits.push(`<li><strong>Next class:</strong> ${esc(next.subject)} <small>${fmtTime(next.start_time)}–${fmtTime(next.end_time)}</small></li>`);
    const html = `${heading('', '', '')}`.replace(/<div class="page-head">.*<\/div>/, '') + `
      <h1 class="title greet"><span>Welcome back, ${esc(firstName(user))}!</span><span class="sun">${I('sun', 34)}</span></h1>
      <p class="today">Today is ${longToday()}</p>
      <div class="grid-home">
        <section class="card"><h2 class="card-h">${I('target', 22)} What should you do now?</h2>${bits.length ? `<ul class="todo-sum">${bits.join('')}</ul>` : '<p class="muted-p">You\'re all caught up. No pending tasks!</p>'}</section>
        <section class="card quick"><h2 class="card-h center">Quick Links</h2>
          <div class="ql"><span>${I('calendar', 22)}</span><a class="btn pill-o" href="#/schedules">View Schedule</a></div>
          <div class="ql"><span>${I('plusCircle', 22)}</span><a class="btn pill-o" href="#/todo" id="qAdd">Add To-Do</a></div>
          <div class="ql"><span>${I('megaphone', 22)}</span><a class="btn pill-o" href="#/announcements">View Announcement</a></div></section>
      </div>
      <section class="card wide-card"><div class="card-top"><h2 class="card-h big">${I('calendar', 24)} Today’s Schedule</h2><a class="btn pill-w" href="#/schedules">View all ${I('arrow', 14).replace('<path d="m12 19', '<path d="m12 19')}</a></div>
        ${classes.length ? `<ul class="sched-list">${classes.map(c => `<li><span class="time">${fmtTime(c.start_time)} – ${fmtTime(c.end_time)}</span><strong>${esc(c.subject)}</strong>${c.room ? `<small>${esc(c.room)}</small>` : ''}</li>`).join('')}</ul>` : `<p class="muted-p">No classes scheduled for ${todayName()}.</p>`}</section>`;
    return { html, bind() { const q = $('#qAdd'); if (q) q.onclick = () => { openAddTask = true; }; } };
  }

  /* ---------- SCHEDULES ---------- */
  async function pageSchedules() {
    const cls = await S.mine('classes');
    const body = cls.length ? DAYS.filter(d => cls.some(c => c.day === d)).map(d => `<section class="day"><h3>${d}</h3>${cls.filter(c => c.day === d).sort((a, b) => a.start_time.localeCompare(b.start_time)).map(c => `<article class="item"><div class="item-main"><span class="time">${fmtTime(c.start_time)} – ${fmtTime(c.end_time)}</span><strong>${esc(c.subject)}</strong>${c.room ? `<small>${esc(c.room)}</small>` : ''}</div><div class="item-act"><button class="icon-btn sm" data-edit="${c.id}" aria-label="Edit class">${I('pencil', 17)}</button><button class="icon-btn sm" data-del="${c.id}" aria-label="Delete class">${I('trash', 17)}</button></div></article>`).join('')}</section>`).join('') : empty('No classes yet. Click "Add class" to build your timetable.');
    return {
      html: heading('calendar', 'My Schedule', `<button class="btn pill-w" id="addClass">${I('plus', 16)} Add class</button>`).replace('page-head', 'page-head stack') + body,
      bind() {
        $('#addClass').onclick = () => classForm();
        $$('[data-edit]').forEach(b => b.onclick = () => classForm(cls.find(c => c.id === b.dataset.edit)));
        $$('[data-del]').forEach(b => b.onclick = async () => { if (await confirmBox('Delete this class from your timetable?')) { await S.remove('classes', b.dataset.del); toast('Class deleted'); } });
      }
    };
  }
  function classForm(c) {
    c = c || {};
    modal({
      title: c.id ? 'Edit class' : 'Add class',
      body: `<label>Day</label><select name="day">${DAYS.map(d => `<option ${((c.day || 'Monday') === d) ? 'selected' : ''}>${d}</option>`).join('')}</select>
        <div class="two"><div><label>Start</label><input type="time" name="start" value="${c.start_time || '08:00'}"></div><div><label>End</label><input type="time" name="end" value="${c.end_time || '09:00'}"></div></div>
        <label>Subject</label><input name="subject" value="${esc(c.subject)}">
        <label>Classroom / section (optional)</label><input name="room" placeholder="11-Lavoisier" value="${esc(c.room)}">`,
      async onSubmit(f) {
        const day = val(f, 'day'), start = val(f, 'start'), end = val(f, 'end'), subject = val(f, 'subject'), room = val(f, 'room');
        if (!subject) return 'Please enter a subject.';
        if (!start || !end) return 'Please set a start and end time.';
        if (end <= start) return 'End time must be later than the start time.';
        const clash = (await S.mine('classes')).find(x => x.id !== c.id && x.day === day && x.start_time < end && start < x.end_time);
        if (clash && !(await confirmBox(`This overlaps with “${clash.subject}” (${fmtTime(clash.start_time)}–${fmtTime(clash.end_time)}). Save anyway?`, 'Save anyway'))) return 'Class not saved. Adjust the time to avoid the overlap.';
        await S.save('classes', { ...c, day, start_time: start, end_time: end, subject, room });
        toast(c.id ? 'Class updated' : 'Class added'); return null;
      }
    });
  }

  /* ---------- TO DO ---------- */
  async function pageTodo() {
    let tasks = await S.mine('tasks');
    tasks = tasks.sort((a, b) => (a.done - b.done) || (a.due_at || '9').localeCompare(b.due_at || '9'));
    const shownT = tasks.filter(t => taskFilter === 'all' || (taskFilter === 'done' ? t.done : !t.done));
    const now = Date.now();
    const card = t => { const od = !t.done && t.due_at && new Date(t.due_at) < now, soon = !t.done && t.due_at && !od && new Date(t.due_at) - now < 864e5;
      return `<article class="item task ${t.done ? 'done' : ''} ${od ? 'overdue' : ''} ${soon ? 'soon' : ''}"><label class="check"><input type="checkbox" data-done="${t.id}" ${t.done ? 'checked' : ''} aria-label="Mark ${t.done ? 'pending' : 'completed'}"><span class="box"></span></label>
        <div class="item-main"><strong>${esc(t.title)}</strong>${t.subject ? `<span class="tag">${esc(t.subject)}</span>` : ''}${t.description ? `<p>${esc(t.description)}</p>` : ''}
        <small>${t.due_at ? 'Due ' + fmtDT(t.due_at) : 'No due date'} • ${t.done ? 'Completed' : 'Pending'}${od ? ' • <b>Overdue</b>' : ''}${soon ? ' • <b>Due soon</b>' : ''}</small></div>
        <div class="item-act"><button class="icon-btn sm" data-edit="${t.id}" aria-label="Edit task">${I('pencil', 17)}</button><button class="icon-btn sm" data-del="${t.id}" aria-label="Delete task">${I('trash', 17)}</button></div></article>`; };
    const html = heading('clipboard', 'To-do List', `<button class="btn pill-w" id="addTask">+ Add Task</button>`) +
      `<div class="filters">${[['all', 'All'], ['pending', 'Pending'], ['done', 'Completed']].map(([k, l]) => `<button class="chip ${taskFilter === k ? 'active' : ''}" data-f="${k}">${l}</button>`).join('')}</div>` +
      (shownT.length ? shownT.map(card).join('') : empty(tasks.length ? 'No tasks in this view.' : 'No tasks yet. Add one to get started!'));
    return {
      html, bind() {
        $('#addTask').onclick = () => taskForm();
        $$('.chip').forEach(b => b.onclick = () => { taskFilter = b.dataset.f; render(); });
        $$('[data-done]').forEach(b => b.onchange = async () => { const t = tasks.find(x => x.id === b.dataset.done); await S.save('tasks', { ...t, done: b.checked, completed_at: b.checked ? new Date().toISOString() : null }); });
        $$('[data-edit]').forEach(b => b.onclick = () => taskForm(tasks.find(t => t.id === b.dataset.edit)));
        $$('[data-del]').forEach(b => b.onclick = async () => { if (await confirmBox('Delete this task permanently?')) { await S.remove('tasks', b.dataset.del); toast('Task deleted'); } });
        if (openAddTask) { openAddTask = false; taskForm(); }
      }
    };
  }
  function taskForm(t) {
    t = t || {};
    modal({
      title: t.id ? 'Edit task' : 'Add task',
      body: `<label>Title</label><input name="title" value="${esc(t.title)}"><label>Subject / category</label><input name="subject" placeholder="Science" value="${esc(t.subject)}">
        <label>Description</label><textarea name="description" rows="3">${esc(t.description)}</textarea><label>Due date &amp; time</label><input type="datetime-local" name="due" value="${toInput(t.due_at)}">`,
      async onSubmit(f) {
        const title = val(f, 'title'); if (!title) return 'Title is required.';
        await S.save('tasks', { done: false, ...t, title, subject: val(f, 'subject'), description: val(f, 'description'), due_at: fromInput(f.elements.due.value) });
        toast(t.id ? 'Task updated' : 'Task added'); return null;
      }
    });
  }

  /* ---------- ANNOUNCEMENTS (student view; includes published assignments) ---------- */
  async function pageAnnouncements() {
    const ann = (await S.all('announcements')).filter(a => a.published && isMine(a, user)).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created_at.localeCompare(a.created_at));
    const asg = (await S.all('assignments')).filter(a => a.published && isMine(a, user)).sort((a, b) => (a.due_at || '9').localeCompare(b.due_at || '9'));
    const aCard = a => `<article class="item ann ${a.category === 'Important' ? 'important' : ''}" tabindex="0" data-ann="${a.id}"><div class="item-main"><div class="row-tags">${a.category === 'Important' ? '<span class="tag star">★ Important</span>' : `<span class="tag">${esc(a.category)}</span>`}<small>${fmtDate(a.date)}</small></div><strong>${esc(a.title)}</strong><p class="clamp">${esc(a.message)}</p>${a.event_date ? `<small>Event / deadline: ${fmtDate(a.event_date)}</small>` : ''}</div></article>`;
    const sCard = a => `<article class="item ann" tabindex="0" data-asg="${a.id}"><div class="item-main"><div class="row-tags"><span class="tag">${esc(a.subject || 'Assignment')}</span></div><strong>${esc(a.title)}</strong><p class="clamp">${esc(a.instructions)}</p><small>Due ${fmtDT(a.due_at)}</small></div></article>`;
    const html = heading('megaphone', 'Announcements') + (ann.length ? ann.map(aCard).join('') : empty('No announcements yet.')) +
      `<h2 class="sec">ASSIGNMENTS</h2>` + (asg.length ? asg.map(sCard).join('') : empty('No assignments yet.'));
    return {
      html, bind() {
        const open = (el, fn) => { el.onclick = fn; el.onkeydown = e => { if (e.key === 'Enter') fn(); }; };
        $$('[data-ann]').forEach(el => open(el, () => { const a = ann.find(x => x.id === el.dataset.ann); viewModal(a.title, `<div class="row-tags">${a.category === 'Important' ? '<span class="tag star">★ Important</span>' : `<span class="tag">${esc(a.category)}</span>`}</div><p class="full">${esc(a.message)}</p><small class="muted">Published ${fmtDate(a.date)}${a.event_date ? ' · Event / deadline: ' + fmtDate(a.event_date) : ''}</small>`); markRead(a.id); }));
        $$('[data-asg]').forEach(el => open(el, () => { const a = asg.find(x => x.id === el.dataset.asg); viewModal(a.title, `<div class="row-tags"><span class="tag">${esc(a.subject || 'Assignment')}</span></div><h4>Instructions</h4><p class="full">${esc(a.instructions)}</p><small class="muted">Due ${fmtDT(a.due_at)} · Posted ${fmtDate(a.created_at)}</small>`); markRead(a.id); }));
      }
    };
  }
  async function markRead(refId) { for (const n of (await S.mine('notifications')).filter(n => n.ref_id === refId && !n.read)) await S.save('notifications', { ...n, read: true }); }
  function viewModal(title, body) { modal({ title, body, submit: null }); }

  /* ---------- PROFILE ---------- */
  async function pageProfile() {
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const label = { granted: 'Enabled', denied: 'Blocked', default: 'Not enabled', unsupported: 'Not supported' }[perm];
    const html = `<h1 class="title plain">PROFILE</h1>
      <section class="card outline prof"><div class="avatar">${I('user', 90).replace('fill="none"', 'fill="currentColor"')}</div><div class="prof-info">
        <h2>NAME: ${esc(user.name)} <button class="icon-btn sm" id="editProf" aria-label="Edit profile">${I('pencil', 16)}</button></h2>
        <p class="email">${esc(user.email)}</p><h2>BATCH/ACADEMIC YEAR: ${esc(user.batch || cfg.BATCH)}</h2><h2>${esc(user.role.toUpperCase())}</h2></div></section>
      <section class="card outline notif"><h3>${I('bellRing', 20)} NOTIFICATIONS ON THIS DEVICE</h3>
        <p>Turn on browser push to be alerted about announcements, assignments and school events even when SchoolSync is closed.</p>
        <div class="np-row"><span class="perm">${I('check', 16)} ${label}</span>${perm === 'granted' ? '' : '<button class="btn dark pill" id="enableN">Enable notifications</button>'}</div>
        ${perm === 'denied' ? '<p class="warn">Notifications are blocked. Open your browser’s site settings for SchoolSync and set Notifications to Allow, then reload.</p>' : ''}
        ${perm === 'unsupported' ? '<p class="warn">This browser does not support notifications. On iPhone, install SchoolSync to the Home Screen first.</p>' : ''}
        ${cfg.VAPID_PUBLIC_KEY ? '' : `<p class="warn">${I('warn', 16)} Browser push is not configured yet on the school side, so only in-app notifications are delivered.</p>`}
        <label class="chk pref"><input type="checkbox" id="emailPref" ${user.email_pref !== false ? 'checked' : ''}> Also email me about announcements, assignments and events</label></section>
      <section class="card outline notif"><h3>${I('calendar', 20)} OFFLINE ACCESS</h3>
        <p>After your first online visit and login, SchoolSync opens without internet. Your schedule, tasks, announcements, assignments and profile are saved on this device. Changes you make offline are queued and sync automatically when you reconnect. Logging in with Google, creating an account, sending email and admin publishing need an internet connection.</p>
        <div class="np-row"><span class="perm" id="qcount"></span>${deferredInstall ? '<button class="btn dark pill" id="installBtn">Install app</button>' : ''}</div></section>`;
    return {
      html, async bind() {
        $('#editProf').onclick = () => modal({ title: 'Edit profile', body: `<label>Name</label><input name="name" value="${esc(user.name)}"><label>Batch / academic year</label><input name="batch" value="${esc(user.batch || cfg.BATCH)}">`, async onSubmit(f) { if (!val(f, 'name')) return 'Name is required.'; user = await S.save('profiles', { ...user, name: val(f, 'name'), batch: val(f, 'batch') }); toast('Profile updated'); render(); return null; } });
        const e = $('#enableN'); if (e) e.onclick = async () => { if (!('Notification' in window)) return; await Notification.requestPermission(); render(); };
        $('#emailPref').onchange = async ev => { user = await S.save('profiles', { ...user, email_pref: ev.target.checked }); toast('Preference saved'); };
        const ib = $('#installBtn'); if (ib) ib.onclick = async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; render(); };
        const n = await S.pending(); $('#qcount').textContent = n ? `${n} change${n > 1 ? 's' : ''} waiting to sync` : 'Everything is saved and synced';
      }
    };
  }

  /* ---------- ADMIN ---------- */
  const adminTabs = a => `<div class="filters tabs">${[['admin', 'Announcements'], ['admin/assignments', 'Assignments'], ['admin/reminders', 'Event reminders']].map(([r, l]) => `<a class="chip ${a === r ? 'active' : ''}" href="#/${r}">${l}</a>`).join('')}</div>`;
  const adminHead = (sec, extra, desc) => `<h1 class="title big">${I('settings', 34)}<span>ADMIN DASHBOARD</span></h1><a class="backlink" href="#/home">${I('back', 14)} Back to dashboard</a><div class="sec-row"><h2 class="sec">${sec}</h2>${extra || ''}</div>${desc || ''}`;
  const pubBtns = (kind, r) => `<div class="item-act"><button class="btn pill-w sm" data-pub="${r.id}">${r.published ? 'Unpublish' : 'Publish'}</button><button class="icon-btn sm" data-edit="${r.id}" aria-label="Edit">${I('pencil', 17)}</button><button class="icon-btn sm" data-del="${r.id}" aria-label="Delete">${I('trash', 17)}</button></div>`;

  async function pageAdminAnn() {
    const list = (await S.all('announcements')).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created_at.localeCompare(a.created_at));
    const html = adminHead('POST SCHOOL ANNOUNCEMENTS', `<button class="btn pill-w" id="newBtn">${I('plus', 16)} New Announcement</button>`) + adminTabs('admin') +
      (list.length ? list.map(a => `<article class="item ann ${a.category === 'Important' ? 'important' : ''}"><div class="item-main"><div class="row-tags"><span class="tag ${a.category === 'Important' ? 'star' : ''}">${esc(a.category)}</span><span class="tag ${a.published ? 'ok' : 'muted'}">${a.published ? 'Published' : 'Draft'}</span><small>${fmtDate(a.date)}${a.event_date ? ' · Event ' + fmtDate(a.event_date) : ''}</small></div><strong>${esc(a.title)}</strong><p class="clamp">${esc(a.message)}</p><small>To: ${a.notify_all !== false ? 'Everyone' : (a.recipient_ids || []).length + ' selected student(s)'}</small></div>${pubBtns('a', a)}</article>`).join('') : empty('No announcements yet.'));
    return { html, bind() { bindAdminList(list, 'announcements', annForm); $('#newBtn').onclick = () => annForm(); } };
  }
  function bindAdminList(list, table, form) {
    $$('[data-edit]').forEach(b => b.onclick = () => form(list.find(x => x.id === b.dataset.edit)));
    $$('[data-del]').forEach(b => b.onclick = async () => { if (await confirmBox('Delete this permanently?')) { await S.remove(table, b.dataset.del); toast('Deleted'); } });
    $$('[data-pub]').forEach(b => b.onclick = async () => { const r = list.find(x => x.id === b.dataset.pub); await publishToggle(table, r); });
  }
  async function publishToggle(table, r) {
    const next = !r.published; let rec = await S.save(table, { ...r, published: next });
    if (next && !rec.notified_at) await notifyFor(table, rec);
    toast(next ? 'Published to students' : 'Unpublished');
  }
  async function notifyFor(table, rec) {
    if (table === 'announcements') await fanout('announcement', rec, (rec.category === 'Important' ? '★ ' : '') + rec.title, rec.message.slice(0, 140), '#/announcements');
    else await fanout('assignment', rec, 'New assignment: ' + rec.title, (rec.subject ? rec.subject + ' · ' : '') + 'Due ' + fmtDT(rec.due_at), '#/announcements');
    await S.save(table, { ...rec, notified_at: new Date().toISOString() });   // prevents duplicate sends on edit/republish
  }
  async function annForm(a) {
    a = a || {}; const rf = await recipientFields(a);
    const m = modal({
      title: a.id ? 'Edit Announcement' : 'New Announcement', block: true,
      body: `<label>Title</label><input name="title" value="${esc(a.title)}"><label>Message</label><textarea name="message" rows="3">${esc(a.message)}</textarea>
        <label>Category</label><select name="category">${['Important', 'General', 'Event', 'Deadline', 'Reminder'].map(c => `<option ${(a.category || 'Important') === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <label>Date</label><input type="date" name="date" value="${a.date || isoToday()}"><label>Event / deadline date (optional)</label><input type="date" name="event_date" value="${a.event_date || ''}">
        ${rf}${toggle('published', 'Published to students', a.published !== false)}`,
      async onSubmit(f) {
        const title = val(f, 'title'), message = val(f, 'message');
        if (!title) return 'Title is required.'; if (!message) return 'Message is required.';
        const r = readRecipients(f); if (!r.notify_all && !r.recipient_ids.length) return 'Select at least one student to notify.';
        const pub = f.elements.published.checked;
        const rec = await S.save('announcements', { ...a, title, message, category: val(f, 'category'), date: val(f, 'date') || isoToday(), event_date: val(f, 'event_date') || null, ...r, published: pub, author_id: a.author_id || user.id });
        if (pub && !rec.notified_at) await notifyFor('announcements', rec);
        toast(a.id ? 'Announcement updated' : (pub ? 'Announcement published' : 'Announcement saved as draft')); return null;
      }
    });
    bindRecipients(m.f);
  }

  async function pageAdminAsg() {
    const list = (await S.all('assignments')).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const html = adminHead('POST ASSIGNMENTS', `<button class="btn pill-w" id="newBtn">${I('plus', 16)} New Assignment</button>`) + adminTabs('admin/assignments') +
      (list.length ? list.map(a => `<article class="item ann"><div class="item-main"><div class="row-tags"><span class="tag">${esc(a.subject || 'Assignment')}</span><span class="tag ${a.published ? 'ok' : 'muted'}">${a.published ? 'Published' : 'Draft'}</span><small>Created ${fmtDate(a.created_at)}</small></div><strong>${esc(a.title)}</strong><p class="clamp">${esc(a.instructions)}</p><small>Due ${fmtDT(a.due_at)} · To: ${a.notify_all !== false ? 'Everyone' : (a.recipient_ids || []).length + ' selected'}</small></div>${pubBtns('s', a)}</article>`).join('') : empty('No assignments yet.'));
    return { html, bind() { bindAdminList(list, 'assignments', asgForm); $('#newBtn').onclick = () => asgForm(); } };
  }
  async function asgForm(a) {
    a = a || {}; const rf = await recipientFields(a);
    const m = modal({
      title: a.id ? 'Edit Assignment' : 'New Assignment', block: true,
      body: `<label>Title</label><input name="title" value="${esc(a.title)}"><label>Subject</label><input name="subject" value="${esc(a.subject)}"><label>Instructions</label><textarea name="instructions" rows="4">${esc(a.instructions)}</textarea>
        <label>Due date &amp; time</label><input type="datetime-local" name="due" value="${toInput(a.due_at)}">${rf}${toggle('published', 'Published to students', a.published !== false)}`,
      async onSubmit(f) {
        const title = val(f, 'title'), instructions = val(f, 'instructions'), due = f.elements.due.value;
        if (!title) return 'Title is required.'; if (!instructions) return 'Instructions are required.'; if (!due) return 'Please set a due date and time.';
        const r = readRecipients(f); if (!r.notify_all && !r.recipient_ids.length) return 'Select at least one student.';
        const pub = f.elements.published.checked;
        const rec = await S.save('assignments', { ...a, title, subject: val(f, 'subject'), instructions, due_at: fromInput(due), ...r, published: pub, author_id: a.author_id || user.id });
        if (pub && !rec.notified_at) await notifyFor('assignments', rec);
        toast(a.id ? 'Assignment updated' : (pub ? 'Assignment published' : 'Assignment saved as draft')); return null;
      }
    });
    bindRecipients(m.f);
  }

  /* --- event reminders --- */
  const remStatus = r => { if (r.sent_at) return 'delivered'; const at = new Date(r.event_at); if (at < Date.now()) return 'expired'; return at - Date.now() <= (cfg.REMIND_HOURS_BEFORE || 24) * 36e5 ? 'due' : 'scheduled'; };
  async function sendDue(manual) {
    if (!user || user.role !== 'admin') return;
    const due = (await S.all('event_reminders')).filter(r => remStatus(r) === 'due');
    for (const r of due) {
      const fresh = (await S.all('event_reminders')).find(x => x.id === r.id); if (!fresh || fresh.sent_at) continue;   // no duplicates
      const saved = await S.save('event_reminders', { ...fresh, sent_at: new Date().toISOString() });
      await fanout('event_reminder', saved, 'Event reminder: ' + saved.title, `${fmtDT(saved.event_at)}${saved.description ? ' · ' + saved.description.slice(0, 100) : ''}`, '#/announcements');
    }
    if (manual) toast(due.length ? `${due.length} reminder${due.length > 1 ? 's' : ''} sent` : 'No reminders are due right now.');
  }
  async function pageAdminRem() {
    const list = (await S.all('event_reminders')).sort((a, b) => a.event_at.localeCompare(b.event_at));
    const logs = (await S.all('email_logs')).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 25);
    const label = { scheduled: 'Scheduled', due: 'Due now', delivered: 'Delivered', expired: 'Expired' };
    const html = adminHead('SCHOOL EVENT REMINDERS', `<div class="btn-col"><button class="btn pill-w" id="sendDue">${I('bellRing', 16)} Send due reminders now</button><button class="btn pill-w" id="newBtn">${I('plus', 16)} New Event reminder</button></div>`,
      '<p class="muted-p narrow">Reminders are checked automatically while the app is in use. Use this button to send anything that is already due right now.</p>') + adminTabs('admin/reminders') +
      (list.length ? list.map(r => { const s = remStatus(r); return `<article class="item ann"><div class="item-main"><div class="row-tags"><span class="tag st-${s}">${label[s]}</span><small>${fmtDT(r.event_at)}</small></div><strong>${esc(r.title)}</strong>${r.description ? `<p class="clamp">${esc(r.description)}</p>` : ''}<small>To: ${r.notify_all !== false ? 'Everyone' : (r.recipient_ids || []).length + ' selected'}${r.sent_at ? ' · Sent ' + fmtDT(r.sent_at) : ''}</small></div><div class="item-act"><button class="btn pill-w sm" data-view="${r.id}">View</button><button class="icon-btn sm" data-edit="${r.id}" aria-label="Edit">${I('pencil', 17)}</button><button class="icon-btn sm" data-del="${r.id}" aria-label="Delete">${I('trash', 17)}</button></div></article>`; }).join('') : empty('No event reminders yet.')) +
      `<h2 class="sec">EMAIL DELIVERY LOG</h2>` + (logs.length ? `<div class="logs">${logs.map(l => `<div class="log"><span>${esc(l.recipient_email || '')}</span><span>${esc(l.type)}</span><span class="tag ${l.status === 'sent' ? 'ok' : 'muted'}">${esc(l.status)}</span><small>${fmtDT(l.created_at)}${l.error ? ' · ' + esc(l.error) : ''}</small>${l.status === 'failed' ? `<button class="btn pill-w sm" data-retry="${l.id}">Retry</button>` : ''}</div>`).join('')}</div>` : empty('No emails sent yet.'));
    return {
      html, bind() {
        $('#newBtn').onclick = () => remForm(); $('#sendDue').onclick = () => sendDue(true);
        bindAdminList(list, 'event_reminders', remForm);
        $$('[data-view]').forEach(b => b.onclick = () => { const r = list.find(x => x.id === b.dataset.view); viewModal(r.title, `<span class="tag st-${remStatus(r)}">${label[remStatus(r)]}</span><p class="full">${esc(r.description || 'No description.')}</p><small class="muted">Event: ${fmtDT(r.event_at)}${r.sent_at ? ' · Sent ' + fmtDT(r.sent_at) : ''}</small>`); });
        $$('[data-retry]').forEach(b => b.onclick = async () => { try { await S.retryEmail(b.dataset.retry); toast('Retry queued'); } catch (e) { toast(e.message, 'warn'); } });
      }
    };
  }
  async function remForm(r) {
    r = r || {}; const rf = await recipientFields(r); const d = r.event_at ? toInput(r.event_at) : '';
    const m = modal({
      title: r.id ? 'Edit event reminder' : 'New event reminder',
      body: `<label>Event title</label><input name="title" value="${esc(r.title)}"><label>Event description</label><textarea name="description" rows="3">${esc(r.description)}</textarea>
        <div class="two"><div><label>Event date</label><input type="date" name="date" value="${d.slice(0, 10)}"></div><div><label>Event time</label><input type="time" name="time" value="${d.slice(11) || '09:00'}"></div></div>${rf}`,
      extraFoot: '<button type="button" class="btn ghost" data-close>Cancel</button>',
      async onSubmit(f) {
        const title = val(f, 'title'), date = val(f, 'date'), time = val(f, 'time');
        if (!title) return 'Event title is required.'; if (!date || !time) return 'Event date and time are required.';
        const rc = readRecipients(f); if (!rc.notify_all && !rc.recipient_ids.length) return 'Select at least one student.';
        const at = fromInput(`${date}T${time}`), changed = r.event_at && r.event_at !== at;
        await S.save('event_reminders', { ...r, title, description: val(f, 'description'), event_at: at, ...rc, sent_at: changed ? null : (r.sent_at || null), author_id: r.author_id || user.id });
        toast(r.id ? 'Reminder updated' : 'Reminder saved'); sendDue(false); return null;
      }
    });
    bindRecipients(m.f);
  }

  /* ---------- router ---------- */
  const ROUTES = { home: pageHome, schedules: pageSchedules, todo: pageTodo, announcements: pageAnnouncements, profile: pageProfile, admin: pageAdminAnn, 'admin/assignments': pageAdminAsg, 'admin/reminders': pageAdminRem };
  async function render() {
    const token = ++pageToken;
    user = S.currentUser();
    const path = (location.hash || '#/').replace(/^#\/?/, '');
    if (!user) {
      if (path === 'login/student') return login('student');
      if (path === 'login/admin') return login('admin');
      if (path !== '') { location.hash = '#/'; return; }
      return landing();
    }
    if (path === '' || path.startsWith('login')) { location.hash = '#/home'; return; }
    const key = ROUTES[path] ? path : 'home';
    if (key.startsWith('admin') && user.role !== 'admin') { toast('Administrator access required.', 'warn'); location.hash = '#/home'; return; }
    const page = await ROUTES[key]();
    if (token !== pageToken) return;
    const scroll = window.scrollY;
    app().innerHTML = await shell(key.split('/')[0], page.html);
    bindShell(); await page.bind(); window.scrollTo(0, scroll);
    if (panelOpen) refreshPanel();
  }
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });

  /* ---------- connection indicator ---------- */
  let hideSync = null;
  async function drawStatus() {
    const el = $('#netstatus'), s = S.getStatus(), n = await S.pending();
    if (!S.currentUser()) { el.className = 'netstatus'; el.innerHTML = ''; return; }
    const txt = s === 'syncing' ? 'Syncing…' : s === 'offline' ? 'Offline' : 'Online';
    el.className = 'netstatus show ' + s;
    el.innerHTML = `<span class="pulse"></span><b>${txt}</b>${s === 'offline' && n ? '<small>Changes saved on this device. They will sync when you’re back online.</small>' : (n && s !== 'syncing' && S.hasBackend ? `<small>${n} change${n > 1 ? 's' : ''} waiting to sync</small>` : '')}`;
  }
  let t;
  S.on((ev, d) => {
    if (ev === 'status' || ev === 'queue') drawStatus();
    if (ev === 'saved-offline') toast('Changes saved on this device. They will sync when you’re back online.');
    if (ev === 'synced') toast('All changes synced successfully.', 'ok');
    if (ev === 'rejected') toast('Some changes were rejected by the server (not authorized) and were discarded.', 'warn');
    if (ev === 'auth') render();
    if (ev === 'change') { clearTimeout(t); t = setTimeout(() => { if (!$('.overlay')) render(); if (panelOpen) refreshPanel(); pushLocal(); }, 120); }
  });

  /* ---------- boot ---------- */
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW failed', e));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) S.refresh(); });
  S.init().then(() => { render(); drawStatus(); pushLocal(); setInterval(() => { sendDue(false); if (navigator.onLine) S.refresh(); }, 60000); setTimeout(() => sendDue(false), 2500); })
    .catch(e => { console.error(e); app().innerHTML = '<div class="boot">SchoolSync could not start. Please reload.</div>'; });
})();
