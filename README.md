
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


НОВОЕ
# LINE Mini App Salon Booking SaaS

## Project Goal

We are building a fully working demo version of a LINE Mini App SaaS product for salon booking in Japan.

The demo must work like a real product:
- customers book through LINE / LIFF;
- salon admins manage bookings, staff, and services;
- available slots are calculated from real business rules;
- booking confirmation and cancellation happen through LINE;
- no-show reduction is supported through confirmations, reminders, and risk status.

This demo will be used to show potential clients and then quickly convert into a commercial version for each salon.

## Repository

Main repository:

https://github.com/tantik/line-app.git

Before any code change, always check the current GitHub state.

## Current Stack

- Frontend: HTML / CSS / JavaScript
- Hosting: Vercel
- LINE: LIFF / LINE Login / Messaging API webhook
- Backend: Supabase
- Database: Supabase Postgres
- Storage: Supabase Storage
- Main data flow: frontend → Supabase
- Google Apps Script is no longer used in the core product path.

## Important Rule

When changing JS / HTML / CSS:

- always provide the full file, not small fragments;
- do not remove existing working features;
- preserve Bookings, Staff, Services, modals, Supabase Auth, Supabase Storage, CRUD logic, and staff_service_map relations;
- check syntax before sending code;
- code must be sent directly in chat, not as downloadable files.

## Current Main Features

### Public Booking App

The customer can:
- open the booking app from LINE;
- select a service;
- select a staff member;
- select date and time;
- submit a booking.

Public app should use:
- public catalog data;
- available slot logic;
- public booking creation;
- public lead creation;
- public confirmation/cancellation token logic.

### Salon Admin

Admin can manage:
- bookings;
- staff;
- services.

Staff management includes:
- name;
- photo;
- working start time;
- working end time;
- slot interval;
- active/inactive status;
- linked services through staff_service_map.

Services management includes:
- name;
- code;
- category;
- duration_minutes;
- price_jpy;
- sort_order;
- description;
- active/inactive status.

### Storage

Supabase Storage bucket:

salon-assets

Expected file path format:

salon_id/staff/file-name.jpg

This is required because Storage policies use the first folder name as salon_id.

## Important Tables

- salons
- salon_members
- services
- staff
- staff_service_map
- bookings
- booking_events
- reminder_jobs
- reminder_rules
- salon_settings
- leads
- admin_booking_view
- blocked_slots
- business_hours
- profiles

Do not use old/test table:

staff_services

Correct relation table:

staff_service_map

## Current Known Roles

Demo version:
- demo admin access may be open for product testing and presentation.

Commercial version:
- super_admin: product owner, controls all salons;
- salon_admin / manager: manages one salon;
- staff: can view bookings, but should not delete or edit critical data.

## Security Direction

For demo:
- focus on a fully working product experience.

For commercial use:
- enable and enforce RLS;
- restrict data by salon_id;
- use salon_members for tenant access;
- protect write actions by role;
- move sensitive business logic away from frontend.

## LINE Integration

LINE connection exists in:

api/line-webhook.js

It is deployed as a Vercel serverless endpoint.

LINE settings are configured in:
- LINE Developers Console: webhook URL;
- Vercel env vars:
  - LINE_CHANNEL_SECRET
  - LINE_CHANNEL_ACCESS_TOKEN

The webhook should:
- verify LINE signature;
- handle user messages;
- send replies / flex messages;
- later process confirmation and cancellation actions.

## Product Roadmap

### Stage 1 — Stabilize Demo Admin

- restore and stabilize admin.js;
- keep Bookings / Staff / Services working;
- keep modals working;
- keep staff_service_map working;
- add Supabase Storage photo upload;
- ensure photos display correctly.

### Stage 2 — Real Booking Logic

Implement real available slots:

- use business_hours;
- use staff start_time / end_time;
- use staff slot_minutes;
- use service duration_minutes;
- exclude existing bookings;
- exclude blocked_slots;
- return only valid available slots.

### Stage 3 — Business Hours

Implement salon weekly schedule:

- day_of_week;
- start_time;
- end_time;
- is_open;
- salon_id.

Admin should be able to manage open/closed days.

### Stage 4 — LINE Confirmation and Cancellation

Implement improved confirmation flow:

- booking created;
- customer receives LINE message;
- customer can confirm;
- customer can cancel;
- admin sees pending / confirmed / cancelled / risk status.

### Stage 5 — No-show Reduction

Implement:
- reminder_jobs;
- reminders before booking;
- risk status;
- booking_events history;
- future waitlist logic.

### Stage 6 — Internal Owner Admin

Create internal admin panel for product owner.

It should show:
- leads from demo;
- leads from website forms;
- lead source;
- lead status;
- notes;
- contacted / demo / proposal / won / lost pipeline.

### Stage 7 — Commercial SaaS Version

For real clients:

- strict RLS;
- roles;
- onboarding flow;
- separate salon setup;
- production LINE channel per client or controlled multi-tenant LINE flow;
- later Node.js API.

## Long-term Backend Direction

At 20–30+ salons, consider dedicated Node.js API.

Node.js API should handle:
- booking orchestration;
- LINE webhook ingestion;
- reminder worker;
- rate limiting;
- fraud / abuse scoring;
- outbound LINE delivery;
- platform-level analytics;
- logs and monitoring.

## Next Immediate Task

Before moving to business_hours and available slots, stabilize current admin files in GitHub:

- admin.html
- admin.js

Then continue with:

1. Supabase Storage photo upload verification.
2. business_hours table and admin UI.
3. real available_slots logic.
4. LINE confirmation/cancellation.