// supabase/functions/process-reminders/index.ts
// Current-stage worker skeleton.
// Use service role key only in server environment.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  // 1. Mark pending bookings as risk when needed
  await supabase.rpc("mark_booking_risk");

  // 2. Pull due reminder jobs
  const nowIso = new Date().toISOString();
  const { data: jobs, error } = await supabase
    .from("reminder_jobs")
    .select(`
      id,
      kind,
      channel,
      booking_id,
      salon_id,
      bookings (
        id,
        public_token,
        customer_name,
        line_user_id,
        line_display_name,
        booking_date,
        start_time,
        status,
        services ( name ),
        staff ( name )
      )
    `)
    .eq("delivery_status", "pending")
    .lte("scheduled_for", nowIso)
    .limit(100);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }

  // 3. TODO: send through LINE Messaging API here
  // Keep outbound delivery server-side only.

  const ids = (jobs || []).map((job) => job.id);
  if (ids.length) {
    await supabase
      .from("reminder_jobs")
      .update({ delivery_status: "sent", sent_at: nowIso })
      .in("id", ids);
  }

  return new Response(JSON.stringify({ ok: true, processed: ids.length }), {
    headers: { "content-type": "application/json" }
  });
});
