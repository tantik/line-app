"use strict";

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

function sendJson(res, statusCode, payload) {
  return res.status(statusCode).json(payload);
}

function parseBody(req) {
  if (!req.body) return {};

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return req.body;
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

async function getBookingById(bookingId) {
  if (!bookingId) {
    return null;
  }

  const rows = await supabaseRequest(
    `/rest/v1/bookings?select=*&id=eq.${encodeEq(bookingId)}&limit=1`,
    {
      method: "GET",
    }
  );

  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function insertBookingEvent({ booking, eventType, actorLabel, payload }) {
  if (!booking?.id || !booking?.salon_id) {
    return null;
  }

  try {
    return await supabaseRequest("/rest/v1/booking_events", {
      method: "POST",
      body: JSON.stringify({
        booking_id: booking.id,
        salon_id: booking.salon_id,
        event_type: eventType,
        actor_type: "system",
        actor_user_id: null,
        actor_label: actorLabel || "Admin notification API",
        payload: payload || {},
      }),
    });
  } catch (error) {
    console.warn("booking_events insert skipped:", error.message);
    return null;
  }
}

function getLineUserId(booking) {
  return booking?.line_user_id || booking?.lineUserId || booking?.line_id || "";
}

function normalizeDate(value) {
  if (value === null || value === undefined) return "-";
  return String(value).slice(0, 10) || "-";
}

function normalizeTime(value) {
  if (value === null || value === undefined) return "-";

  const text = String(value).trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);

  if (!match) return text || "-";

  return `${String(match[1]).padStart(2, "0")}:${match[2]}`;
}

function getBookingDate(booking) {
  return (
    booking.booking_date ||
    booking.date ||
    booking.reservation_date ||
    booking.start_date ||
    booking.starts_on ||
    "-"
  );
}

function getBookingTime(booking) {
  return (
    booking.start_time ||
    booking.time ||
    booking.booking_time ||
    booking.reservation_time ||
    booking.starts_at ||
    "-"
  );
}

function buildAdminCancelledMessage(booking) {
  const date = normalizeDate(getBookingDate(booking));
  const time = normalizeTime(getBookingTime(booking));

  return {
    type: "text",
    text:
      `サロンよりご予約をキャンセルしました。\n\n` +
      `日時：${date} ${time}\n\n` +
      `ご不明な点がありましたら、サロンまでお問い合わせください。`,
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
  if (req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      message: "send admin booking notification endpoint",
    });
  }

  if (req.method === "OPTIONS") {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, {
      ok: false,
      error: "Method not allowed",
    });
  }

  try {
    requireEnv("SUPABASE_URL");
    requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    requireEnv("LINE_CHANNEL_ACCESS_TOKEN");

    const body = parseBody(req);
    const bookingId = body.booking_id || body.bookingId || body.id;
    const action = body.action || "admin_cancelled";

    if (!bookingId) {
      return sendJson(res, 400, {
        ok: false,
        error: "booking_id is required",
      });
    }

    if (action !== "admin_cancelled") {
      return sendJson(res, 400, {
        ok: false,
        error: "Unsupported action",
      });
    }

    const booking = await getBookingById(bookingId);

    if (!booking) {
      return sendJson(res, 404, {
        ok: false,
        error: "Booking not found",
        booking_id: bookingId,
      });
    }

    if (String(booking.status || "") !== "cancelled") {
      return sendJson(res, 409, {
        ok: false,
        error: "Booking is not cancelled",
        booking_id: booking.id,
        status: booking.status || null,
      });
    }

    const lineUserId = getLineUserId(booking);

    if (!lineUserId) {
      await insertBookingEvent({
        booking,
        eventType: "admin_cancel_notification_skipped",
        actorLabel: "Admin notification API",
        payload: {
          reason: "missing_line_user_id",
          action,
          at: new Date().toISOString(),
        },
      });

      return sendJson(res, 200, {
        ok: true,
        skipped: true,
        reason: "missing_line_user_id",
        booking_id: booking.id,
      });
    }

    const message = buildAdminCancelledMessage(booking);

    await pushLineMessage(lineUserId, message);

    await insertBookingEvent({
      booking,
      eventType: "admin_cancel_notification_sent",
      actorLabel: "Admin notification API",
      payload: {
        channel: "line",
        action,
        line_user_id: lineUserId,
        message_type: "admin_cancelled_text",
        sent_at: new Date().toISOString(),
      },
    });

    return sendJson(res, 200, {
      ok: true,
      sent: true,
      booking_id: booking.id,
    });
  } catch (error) {
    console.error("send-admin-booking-notification error:", error);

    return sendJson(res, 500, {
      ok: false,
      error: error.message || "Internal server error",
    });
  }
}
