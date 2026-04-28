
window.__APP_ENV__ = {
  SUPABASE_URL: "https://bhqgfszxiuqmwojhpvne.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_bxxy9kOOubVoXKyX00OIEA_m-NOgEDe",
  SALON_SLUG: "mirawi-demo",
  DEFAULT_TIMEZONE: "Asia/Tokyo",
  ADMIN_REDIRECT_TO: window.location.origin + "/admin.html",
  // For localhost: bypass auth completely
  ADMIN_DEMO_MODE: location.hostname === "127.0.0.1" || location.hostname === "localhost",
  // For Vercel + all hosts: PUBLIC_DEMO_MODE allows anyone to see admin without auth
  // Set to FALSE when moving to production with real clients
  PUBLIC_DEMO_MODE: true,
  DEMO_SALON_ID: "e840e2b0-2d49-4899-b6d2-f2afe895ad1e",
  DEMO_ADMIN_EMAIL: "demo@mirawi.local",
  // LINE Integration (Mirawi Salon Demo)
  LINE_CHANNEL_ID: "2009643805",
  LINE_WEBHOOK_URL: "https://line-app-xi.vercel.app/api/line-webhook"
};
