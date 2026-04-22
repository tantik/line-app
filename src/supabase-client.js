
window.appEnv = window.__APP_ENV__ || {};

if (!window.appEnv.SUPABASE_URL || !window.appEnv.SUPABASE_ANON_KEY) {
  throw new Error("Supabase env is missing. Create src/env.js first.");
}

window.supabaseClient = window.supabase.createClient(
  window.appEnv.SUPABASE_URL,
  window.appEnv.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);
