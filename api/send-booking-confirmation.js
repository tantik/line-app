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

async function getRowById(table, id, select = "*") {
  if (!id) return null;

  const rows = await supabaseRequest(
    `/rest/v1/${table}?select=${encodeURIComponent(select)}&id=eq.${encodeEq(id)}&limit=1`,
    { method: "GET" }
  );

  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function getBooking(bookingId) {
  return getRowById("bookings", bookingId, "*");
}

async function getServiceName(serviceId) {
  const service = await getRowById("services", serviceId, "name");
  return service?.name || "ご予約サービス";
}

async function getStaffName(staffId) {
  const staff = await getRowById("staff", staffId, "name");
  return staff?.name || "担当スタッフ";
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

function getCustomerName(booking) {
  return (
    booking.customer_name ||
    booking.name ||
    booking.client_name ||
    booking.guest_name ||
    "お客様"
  );
}

function getLineUserId(booking) {
  return booking.line_user_id || booking.lineUserId || booking.line_id || "";
}

async function insertBookingEvent({ booking, eventType, payload }) {
  try {
    await supabaseRequest("/rest/v1/booking_events", {
      method: "POST",
      body: JSON.stringify({
        booking_id: booking?.id || null,
        salon_id: booking?.salon_id || null,
        event_type: eventType,
        actor_type: "system",
        actor_user_id: null,
        actor_label: "LINE confirmation API",
        payload: payload || {},
      }),
    });
  } catch (error) {
    console.warn("booking_events insert skipped:", error.message);
  }
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

function buildInfoRow(label, value) {
  return {
    type: "box",
    layout: "baseline",
    contents: [
      {
        type: "text",
        text: label,
        size: "sm",
        color: "#667085",
        flex: 2,
      },
      {
        type: "text",
        text: String(value || "-"),
        size: "sm",
        color: "#111827",
        flex: 4,
        wrap: true,
      },
    ],
  };
}

function buildBookingFlexMessage({ booking, serviceName, staffName }) {
  const bookingDate = normalizeDate(getBookingDate(booking));
  const bookingTime = normalizeTime(getBookingTime(booking));
  const customerName = getCustomerName(booking);

  return {
    type: "flex",
    altText: "予約内容の確認",
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "ご予約ありがとうございます",
            weight: "bold",
            size: "lg",
            color: "#12383f",
          },
          {
            type: "text",
            text: `${customerName} 様、以下の内容で予約を受け付けました。`,
            wrap: true,
            size: "sm",
            color: "#4b5563",
          },
          {
            type: "text",
            text: "内容をご確認のうえ、問題なければ「予約を確認する」を押してください。",
            wrap: true,
            size: "sm",
            color: "#667085",
          },
          {
            type: "separator",
            margin: "md",
          },
          {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            margin: "md",
            contents: [
              buildInfoRow("サービス", serviceName),
              buildInfoRow("担当", staffName),
              buildInfoRow("日付", bookingDate),
              buildInfoRow("時間", bookingTime),
            ],
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#06C755",
            action: {
              type: "postback",
              label: "予約を確認する",
              data: `action=confirm&booking_id=${booking.id}`,
              displayText: "予約を確認します",
            },
          },
          {
            type: "button",
            style: "secondary",
            action: {
              type: "postback",
              label: "キャンセルする",
              data: `action=cancel&booking_id=${booking.id}`,
              displayText: "予約をキャンセルします",
            },
          },
        ],
      },
    },
  };
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      message: "send booking confirmation endpoint",
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
    requireEnv("LINE_CHANNEL_ACCESS_TOKEN");
    requireEnv("SUPABASE_URL");
    requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    const body = parseBody(req);
    const bookingId = body.booking_id || body.bookingId || body.id;

    if (!bookingId) {
      return sendJson(res, 400, {
        ok: false,
        error: "booking_id is required",
      });
    }

    const booking = await getBooking(bookingId);

    if (!booking) {
      return sendJson(res, 404, {
        ok: false,
        error: "Booking not found",
        booking_id: bookingId,
      });
    }

    const lineUserId = getLineUserId(booking);

    if (!lineUserId) {
      await insertBookingEvent({
        booking,
        eventType: "line_confirmation_skipped",
        payload: {
          reason: "missing_line_user_id",
          at: new Date().toISOString(),
        },
      });

      return sendJson(res, 200, {
        ok: true,
        skipped: true,
        reason: "Booking has no line_user_id",
        booking_id: booking.id,
      });
    }

    const [serviceName, staffName] = await Promise.all([
      getServiceName(booking.service_id),
      getStaffName(booking.staff_id),
    ]);

    const message = buildBookingFlexMessage({
      booking,
      serviceName,
      staffName,
    });

    await pushLineMessage(lineUserId, message);

    await insertBookingEvent({
      booking,
      eventType: "line_confirmation_sent",
      payload: {
        channel: "line",
        line_user_id: lineUserId,
        sent_at: new Date().toISOString(),
        message_type: "booking_confirmation_flex",
      },
    });

    return sendJson(res, 200, {
      ok: true,
      sent: true,
      booking_id: booking.id,
    });
  } catch (error) {
    console.error("send-booking-confirmation error:", error);

    return sendJson(res, 500, {
      ok: false,
      error: error.message || "Internal server error",
    });
  }
}