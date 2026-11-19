/* SchoolSync configuration.
   Leave SUPABASE_* empty to run in LOCAL DEMO MODE (data lives in this browser's IndexedDB only).
   Fill them in to enable real accounts, Google sign-in, cross-device sync, and server-side admin checks.
   The anon key is safe to expose; NEVER put service-role or email API keys here. */
window.SCHOOLSYNC_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  SUPABASE_JS_URL: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js",
  EMAIL_FUNCTION_URL: "/.netlify/functions/send-email",
  VAPID_PUBLIC_KEY: "",            // set when you add a Web Push sender; empty = in-app notifications only
  BATCH: "2026–2027",
  REMIND_HOURS_BEFORE: 24,
  // LOCAL DEMO MODE ONLY: these emails become Admin when they sign up. Ignored when Supabase is configured
  // (there the admin_emails table in the database decides, and the server enforces it).
  ADMIN_EMAILS: ["admin@schoolsync.test"]
};
