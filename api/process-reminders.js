import { createClient } from "@supabase/supabase-js";

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function pushLineMessage(lineUserId, message) {
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [message],
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`LINE push failed: ${response.status} ${text}`);
  }
}

function buildReminderMessage(booking) {
  const date = booking.booking_date || booking.date || "-";
  const time = String(booking.start_time || booking.time || "-").slice(0, 5);

  return {
    type: "text",
    text: `予約のリマインドです。\n\n日時：${date} ${time}\nご来店をお待ちしております。`,
  };
}

async function markJob(jobId, values) {
  await supabase
    .from("reminder_jobs")
    .update({
      ...values,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (CRON_SECRET) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }

  try {
    const now = new Date().toISOString();

    const { data: jobs, error: jobsError } = await supabase
      .from("reminder_jobs")
      .select("*")
      .is("sent_at", null)
      .eq("channel", "line")
      .lte("scheduled_for", now)
      .limit(20);

    if (jobsError) throw jobsError;

    let sent = 0;
    let failed = 0;

    for (const job of jobs || []) {
      try {
        const { data: booking, error: bookingError } = await supabase
          .from("bookings")
          .select("*")
          .eq("id", job.booking_id)
          .maybeSingle();

        if (bookingError) throw bookingError;

        if (!booking?.line_user_id || booking.status === "cancelled") {
          await markJob(job.id, {
            delivery_status: "skipped",
            last_error: booking?.status === "cancelled" ? "booking_cancelled" : "missing_line_user_id",
          });
          continue;
        }

        await pushLineMessage(booking.line_user_id, buildReminderMessage(booking));

        await markJob(job.id, {
          sent_at: new Date().toISOString(),
          delivery_status: "sent",
          last_error: null,
        });

        await supabase.from("booking_events").insert({
          booking_id: booking.id,
          salon_id: booking.salon_id,
          event_type: "line_reminder_sent",
          payload: {
            reminder_job_id: job.id,
            kind: job.kind,
            channel: "line",
            sent_at: new Date().toISOString(),
          },
        });

        sent += 1;
      } catch (error) {
        failed += 1;

        await markJob(job.id, {
          delivery_status: "failed",
          last_error: error.message || "unknown_error",
        });
      }
    }

    return res.status(200).json({
      ok: true,
      processed: jobs?.length || 0,
      sent,
      failed,
    });
  } catch (error) {
    console.error("process-reminders error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Internal server error",
    });
  }
}