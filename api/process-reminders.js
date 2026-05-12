"use strict";

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

function sendJson(res, statusCode, payload) {
  return res.status(statusCode).json(payload);
}

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function getSupabaseConfig() {
  return {
    supabaseUrl: requireEnv("SUPABASE_URL").replace(/\/$/, ""),
    serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

async function supabaseRequest(path, options = {}) {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig();

  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();

  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const detail = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`Supabase request failed: ${response.status} ${detail}`);
  }

  return data;
}

function encodeEq(value) {
  return encodeURIComponent(String(value));
}

function encodeValue(value) {
  return encodeURIComponent(String(value));
}

async function getDueReminderJobs(now) {
  return supabaseRequest(
    `/rest/v1/reminder_jobs?select=*&sent_at=is.null&channel=eq.line&scheduled_for=lte.${encodeValue(
      now
    )}&limit=20`,
    {
      method: "GET",
    }
  );
}

async function getBookingById(bookingId) {
  if (!bookingId) return null;

  const rows = await supabaseRequest(
    `/rest/v1/bookings?select=*&id=eq.${encodeEq(bookingId)}&limit=1`,
    {
      method: "GET",
    }
  );

  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function markJob(jobId, values) {
  if (!jobId) return null;

  const rows = await supabaseRequest(
    `/rest/v1/reminder_jobs?id=eq.${encodeEq(jobId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ...values,
        updated_at: new Date().toISOString(),
      }),
    }
  );

  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function insertReminderEvent({
  booking,
  job,
  eventType,
  errorMessage = null,
}) {
  if (!booking?.id || !booking?.salon_id) {
    return null;
  }

  return supabaseRequest("/rest/v1/booking_events", {
    method: "POST",
    body: JSON.stringify({
      booking_id: booking.id,
      salon_id: booking.salon_id,
      event_type: eventType,
      actor_type: "system",
      actor_user_id: null,
      actor_label: "Reminder job",
      payload: {
        reminder_job_id: job?.id || null,
        kind: job?.kind || null,
        channel: "line",
        error: errorMessage,
        at: new Date().toISOString(),
      },
    }),
  });
}

function getLineUserId(booking) {
  return booking?.line_user_id || booking?.lineUserId || booking?.line_id || "";
}

function getBookingDate(booking) {
  return (
    booking?.booking_date ||
    booking?.date ||
    booking?.reservation_date ||
    booking?.start_date ||
    booking?.starts_on ||
    "-"
  );
}

function getBookingTime(booking) {
  return (
    booking?.start_time ||
    booking?.time ||
    booking?.booking_time ||
    booking?.reservation_time ||
    booking?.starts_at ||
    "-"
  );
}

function normalizeTime(value) {
  if (value === null || value === undefined) return "-";

  const text = String(value).trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);

  if (!match) return text || "-";

  return `${String(match[1]).padStart(2, "0")}:${match[2]}`;
}

function buildReminderMessage(booking) {
  const date = String(getBookingDate(booking)).slice(0, 10);
  const time = normalizeTime(getBookingTime(booking));

  return {
    type: "text",
    text: `予約のリマインドです。\n\n日時：${date} ${time}\nご来店をお待ちしております。`,
  };
}

async function pushLineMessage(lineUserId, message) {
  const lineToken = requireEnv("LINE_CHANNEL_ACCESS_TOKEN");

  const response = await fetch(LINE_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lineToken}`,
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

  return text;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return sendJson(res, 405, {
      ok: false,
      error: "Method not allowed",
    });
  }

  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const auth = req.headers.authorization || "";

    if (auth !== `Bearer ${cronSecret}`) {
      return sendJson(res, 401, {
        ok: false,
        error: "Unauthorized",
      });
    }
  }

  try {
    requireEnv("SUPABASE_URL");
    requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    const now = new Date().toISOString();
    const jobs = await getDueReminderJobs(now);

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const job of jobs || []) {
      let booking = null;

      try {
        booking = await getBookingById(job.booking_id);

        const lineUserId = getLineUserId(booking);

        if (!booking) {
          skipped += 1;

          await markJob(job.id, {
            delivery_status: "skipped",
            last_error: "booking_not_found",
          });

          continue;
        }

        if (booking.status === "cancelled") {
          skipped += 1;

          await markJob(job.id, {
            delivery_status: "skipped",
            last_error: "booking_cancelled",
          });

          continue;
        }

        if (!lineUserId) {
          skipped += 1;

          await markJob(job.id, {
            delivery_status: "skipped",
            last_error: "missing_line_user_id",
          });

          continue;
        }

        await pushLineMessage(lineUserId, buildReminderMessage(booking));

        await markJob(job.id, {
          sent_at: new Date().toISOString(),
          delivery_status: "sent",
          last_error: null,
        });

        await insertReminderEvent({
          booking,
          job,
          eventType: "reminder_sent",
        });

        sent += 1;
      } catch (error) {
        failed += 1;

        const errorMessage = error.message || "unknown_error";

        console.error("Reminder job failed:", {
          job_id: job?.id,
          booking_id: job?.booking_id,
          error: errorMessage,
        });

        try {
          await markJob(job.id, {
            delivery_status: "failed",
            last_error: errorMessage,
          });
        } catch (markError) {
          console.error("Failed to mark reminder job as failed:", markError);
        }

        if (booking) {
          try {
            await insertReminderEvent({
              booking,
              job,
              eventType: "reminder_failed",
              errorMessage,
            });
          } catch (eventError) {
            console.error("Failed to insert reminder_failed event:", eventError);
          }
        }
      }
    }

    return sendJson(res, 200, {
      ok: true,
      processed: jobs?.length || 0,
      sent,
      failed,
      skipped,
    });
  } catch (error) {
    console.error("process-reminders error:", error);

    return sendJson(res, 500, {
      ok: false,
      error: error.message || "Internal server error",
    });
  }
}