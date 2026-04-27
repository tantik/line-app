# AI Agent Guide for LINE Mini App

## Purpose
This repository is a LINE Mini App demo for salon booking using Supabase and a static frontend. The main goal is to keep the app working as a real demo, preserve existing features, and fix bugs without removing implemented functionality.

## Key files
- `index.html` — public booking frontend UI and screens
- `script.js` — booking app logic, slot loading, LIFF flow, public booking/lead calls
- `style.css` — frontend styling for the public app
- `admin.html` / `admin.js` — admin panel UI and authenticated Supabase logic
- `src/env.js` — environment values for Supabase and salon slug
- `src/supabase-client.js` — Supabase client initialization
- `supabase/functions/` — edge / RPC function logic
- `supabase/migrations/001_saas_foundation.sql` — database schema foundation

## Important conventions
- When changing JS/HTML/CSS, provide the full file contents, not partial fragments.
- Do not remove already implemented features.
- Preserve public booking flow, service selection, staff selection, date selection, real slots, phone validation, success screens, admin link, LIFF/dev mode, and existing lead/booking RPC logic.
- Validate syntax and logic before sending code.
- This repo does not use a build step for frontend; edits are applied directly to `.html`, `.js`, and `.css` files.

## Project behavior
- Public booking app must work in LINE Mini App / browser and support `LIFF` when available.
- Public booking uses Supabase RPC functions like `public_catalog`, `available_slots`, `create_public_booking`, `create_public_lead`, and `public_change_booking_status`.
- Admin side uses Supabase Auth email OTP / magic link and tenant-scoped access via `salon_members`.

## Notes for fixes
- Always check the current GitHub repository state before applying changes.
- If the user asks for a frontend fix, verify DOM IDs and script expectations against `index.html` and `script.js`.
- Keep the README content and project-specific rules in mind.

## Useful reference
- `README.md` — project overview, environment, and feature expectations
