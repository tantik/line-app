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

  // 3. Send through LINE Messaging API
  // Keep outbound delivery server-side only.
  
  const lineChannelAccessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  const lineChannelSecret = Deno.env.get("LINE_CHANNEL_SECRET");
  
  if (!lineChannelAccessToken) {
    console.error("LINE_CHANNEL_ACCESS_TOKEN not configured");
    return new Response(
      JSON.stringify({ ok: false, error: "LINE_CHANNEL_ACCESS_TOKEN not configured" }),
      { status: 500 }
    );
  }

  for (const job of (jobs || [])) {
    const booking = job.bookings;
    if (!booking || !booking.line_user_id) {
      console.warn(`Skipping reminder for booking ${job.booking_id}: no LINE user ID`);
      continue;
    }

    try {
      let message = {};

      // Build message based on reminder kind
      if (job.kind === "confirmation_request") {
        message = {
          type: "text",
          text: `ご予約確認\n\nサービス: ${booking.services?.[0]?.name || "－"}\nスタッフ: ${booking.staff?.[0]?.name || "－"}\n日時: ${booking.booking_date} ${booking.start_time}\n\nこちらでご確認ください。`,
        };
      } else if (job.kind === "day_before") {
        message = {
          type: "text",
          text: `【予約リマインダー】\n24時間後のご予約をお知らせします。\n\nサービス: ${booking.services?.[0]?.name || "－"}\nスタッフ: ${booking.staff?.[0]?.name || "－"}\n日時: ${booking.booking_date} ${booking.start_time}\n\nよろしくお願いいたします。`,
        };
      } else if (job.kind === "hours_before") {
        message = {
          type: "text",
          text: `【予約リマインダー】\n3時間後のご予約です。\n\nサービス: ${booking.services?.[0]?.name || "－"}\nスタッフ: ${booking.staff?.[0]?.name || "－"}\n日時: ${booking.booking_date} ${booking.start_time}`,
        };
      } else {
        message = {
          type: "text",
          text: `ご予約に関するお知らせです。`,
        };
      }

      // Send LINE message
      const response = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${lineChannelAccessToken}`,
        },
        body: JSON.stringify({
          to: booking.line_user_id,
          messages: [message],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to send LINE message for job ${job.id}:`, errorText);
        
        // Mark as failed
        await supabase
          .from("reminder_jobs")
          .update({ delivery_status: "failed", sent_at: nowIso })
          .eq("id", job.id);
      } else {
        console.log(`Successfully sent LINE message for job ${job.id}`);
      }
    } catch (error) {
      console.error(`Error sending LINE message for job ${job.id}:`, error);
      
      // Mark as failed
      await supabase
        .from("reminder_jobs")
        .update({ delivery_status: "failed", sent_at: nowIso })
        .eq("id", job.id);
    }
  }

  const ids = (jobs || []).map((job) => job.id);
  if (ids.length) {
    // Update only successfully sent jobs
    await supabase
      .from("reminder_jobs")
      .update({ delivery_status: "sent", sent_at: nowIso })
      .eq("delivery_status", "pending")
      .in("id", ids);
  }

  return new Response(JSON.stringify({ ok: true, processed: ids.length }), {
    headers: { "content-type": "application/json" }
  });
});
