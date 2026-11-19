# SchoolSync – Your School Life, In Sync

Plain HTML + CSS + JavaScript (no build step). Installable offline PWA. Deploys as-is to Netlify from GitHub.

## Run it right now (Local Demo Mode)
Serve the folder over http (service workers/IndexedDB need it):
```
npx serve .        # or: python3 -m http.server 8080
```
Open the site → STUDENT → *Use email login* → *Create a student account*.
To try the admin side, create an account with `admin@schoolsync.test` (set in `js/config.js → ADMIN_EMAILS`) and use the ADMIN button.
In demo mode all data lives in this browser only; Google login and real emails are disabled. **Demo-mode admin is not secure** – it is only for previewing.

## Go live (GitHub → Netlify + Supabase + Resend)
1. **GitHub:** create a repo, upload/push this folder (`.gitignore` already excludes secrets).
2. **Supabase** (free): create project → SQL Editor → run `supabase/schema.sql` (first edit the `admin_emails` insert to your admin Gmail).
   Authentication → Providers → enable **Email** and **Google** (add your Google OAuth client ID/secret). Authentication → URL Configuration → set Site URL to your Netlify URL.
3. Put the **Project URL** and **anon key** (Settings → API) in `js/config.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`). The anon key is safe to expose; Row Level Security protects data.
4. **Resend:** create an API key, verify your sending domain.
5. **Netlify:** Add new site → Import from GitHub (no build command; publish dir `.`). Then set the environment variables from `.env.example`
   (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `SITE_URL`, `SCHOOL_TIMEZONE`). Redeploy.
6. Log in as the admin Gmail → the **Dashboard** item appears. Admin rights come from the database (`profiles.role`), enforced by RLS and by the email function – changing the URL or frontend code cannot grant them.

## How the pieces map to the spec
| Feature | Where |
|---|---|
| Pages / UI / router | `index.html`, `css/styles.css`, `js/app.js` |
| IndexedDB cache, offline sync queue, conflict handling (last-write-wins, unsynced local edits protected), account separation | `js/store.js` |
| Offline shell + install | `sw.js`, `manifest.webmanifest` |
| Auth, RLS, tables | `supabase/schema.sql` |
| Email (Resend), templates, delivery log, retry, duplicate protection | `netlify/functions/send-email.js`, `_lib/core.js` |
| Reminders when site is closed | `netlify/functions/process-reminders.js` (runs every 15 min) |

## Notes
- Student-facing **Assignments** appear under the Announcements page; admin pages (Announcements / Assignments / Event reminders) are switched with small tabs on the Admin Dashboard page.
- Offline: after one online login, schedule, tasks, announcements, assignments and profile open offline; edits queue and auto-sync. Login, Google sign-in, account creation and sending emails need internet.
- Browser **push when the app is closed** needs a push sender (VAPID keys + server); until `VAPID_PUBLIC_KEY` is set the Profile page shows the “not configured” warning, and in-app notifications (plus browser notifications while the app is open) are used.
- Replace `assets/logo.svg` (and `assets/icon-192.png`, `icon-512.png`) with your own artwork from the PDF.
- Bump `VERSION` in `sw.js` on each deploy so users get updates.
