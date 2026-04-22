
# LINE Booking SaaS Foundation (Supabase)

This is the Supabase-first rewrite of the LINE salon booking MVP.

## What changed

- Google Apps Script / Google Sheets backend removed from the core product path
- Multi-tenant model added (`salons`, `salon_members`, tenant-aware booking/lead/config model)
- Public booking and lead actions moved to controlled RPC functions
- Admin data access moved to authenticated Supabase + RLS
- Booking conflict checks moved into PostgreSQL
- Confirmation / cancellation moved to public token RPC
- Reminder foundation moved into `reminder_jobs`

## Environment

Create `src/env.js`:

```js
window.__APP_ENV__ = {
  SUPABASE_URL: "https://YOUR_PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_ANON_KEY",
  SALON_SLUG: "demo-salon",
  DEFAULT_TIMEZONE: "Asia/Tokyo",
  ADMIN_REDIRECT_TO: window.location.origin + "/admin.html"
};
```

## Auth

### Public booking app
No login required. Public app only uses:
- `public_catalog`
- `available_slots`
- `create_public_booking`
- `create_public_lead`
- `public_change_booking_status`

### Admin
Admin uses Supabase Auth email OTP / magic link:
1. Open `admin.html`
2. Request sign-in link
3. Authenticated user gets tenant-scoped access via `salon_members`

## SQL setup

Run:

- `supabase/migrations/001_saas_foundation.sql`

Then seed your first tenant manually or with SQL.

## Suggested first seed

```sql
insert into public.salons (slug, name) values ('demo-salon', 'Mirawi Demo Salon') returning id;
```

Then create:
- `salon_settings`
- `services`
- `staff`
- `staff_service_map`
- `business_hours`
- `salon_members`

## Reminder execution

For current stage:
- reminders are scheduled into `reminder_jobs`
- risk marking is done by calling `mark_booking_risk()`
- real delivery should be done by Supabase Edge Function + cron

Recommended cron jobs:
- every 5 minutes: process due reminders
- every 10 minutes: call `mark_booking_risk()`

## What stays for next stage

Later, move these to Node.js backend:
- booking orchestration API
- LINE webhook ingestion
- reminder worker
- rate limiting
- fraud / abuse scoring
- outbound LINE delivery
- platform-level analytics
