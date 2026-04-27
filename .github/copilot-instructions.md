# Copilot Instructions for LINE Mini App

## Purpose
This file helps GitHub Copilot understand repository-specific conventions for the LINE salon booking demo.

## Key rules
- When editing `index.html`, `script.js`, or `style.css`, provide the full file contents, not fragments.
- Preserve existing functionality: LIFF/dev mode, public booking flow, service selection, staff selection, date selection, real slot rendering, phone validation, success screens, admin link, lead form, `create_public_lead`, `create_public_booking`.
- Do not remove implemented features or simplify by deleting working UI/logic.
- Validate syntax and logic before returning code.
- Use direct edits in chat; do not provide downloadable files.

## Important files
- `index.html` — public booking frontend UI and screens
- `script.js` — frontend logic, booking flow, slot loading, Supabase RPC calls
- `style.css` — public app styling
- `admin.html` / `admin.js` — admin panel UI and Supabase Auth logic
- `src/env.js` — Supabase environment values
- `src/supabase-client.js` — Supabase client initialization
- `supabase/functions/` — backend RPC/edge function logic
- `supabase/migrations/001_saas_foundation.sql` — schema foundation

## Frontend fix guidance
- Check DOM ids and actual HTML structure before changing UI logic.
- Ensure `available_slots_v2` / `available_slots` slot rendering is connected to the right elements and state.
- Keep the public booking app compatible with browser and LIFF environments.

## When asked for a fix
- Confirm the user’s reported issue matches current repo files.
- If the fix touches JS/HTML/CSS, deliver whole updated files.
- Do not remove or replace Supabase RPC usage with a different backend approach.

## Helpful references
- `README.md` for project overview and feature expectations
- `AGENTS.md` for broader agent guidance
