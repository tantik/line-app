import { createClient } from "@supabase/supabase-js";

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(res, status, data) {
  return res.status(status).json(data);
}

function formatDate(value) {
  if (!value) return "-";
  return String(value);
}

function formatTime(value) {
  if (!value) return "-";
  return String(value).slice(0, 5);
}

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

  return text;
}

function buildBookingFlexMessage(booking) {
  const bookingId = booking.id;
  const serviceName =
    booking.service_name ||
    booking.services?.name ||
    booking.service?.name ||
    "ご予約サービス";

  const staffName =
    booking.staff_name ||
    booking.staff?.name ||
    booking.staff_member?.name ||
    "担当スタッフ";

  const bookingDate =
    booking.booking_date ||
    booking.date ||
    booking.start_date ||
    "-";

  const startTime =
    booking.start_time ||
    booking.time ||
    booking.starts_at ||
    "-";

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
            text: "内容をご確認ください。問題なければ「予約を確認する」を押してください。",
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
              {
                type: "box",
                layout: "baseline",
                contents: [
                  { type: "text", text: "サービス", size: "sm", color: "#667085", flex: 2 },
                  { type: "text", text: serviceName, size: "sm", color: "#111827", flex: 4, wrap: true },
                ],
              },
              {
                type: "box",
                layout: "baseline",
                contents: [
                  { type: "text", text: "担当", size: "sm", color: "#667085", flex: 2 },
                  { type: "text", text: staffName, size: "sm", color: "#111827", flex: 4, wrap: true },
                ],
              },
              {
                type: "box",
                layout: "baseline",
                contents: [
                  { type: "text", text: "日付", size: "sm", color: "#667085", flex: 2 },
                  { type: "text", text: formatDate(bookingDate), size: "sm", color: "#111827", flex: 4 },
                ],
              },
              {
                type: "box",
                layout: "baseline",
                contents: [
                  { type: "text", text: "時間", size: "sm", color: "#667085", flex: 2 },
                  { type: "text", text: formatTime(startTime), size: "sm", color: "#111827", flex: 4 },
                ],
              },
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
              data: `action=confirm&booking_id=${bookingId}`,
              displayText: "予約を確認します",
            },
          },
          {
            type: "button",
            style: "secondary",
            action: {
              type: "postback",
              label: "キャンセルする",
              data: `action=cancel&booking_id=${bookingId}`,
              displayText: "予約をキャンセルします",
            },
          },
        ],
      },
    },
  };
}

async function getBooking(bookingId) {
  const { data, error } = await supabase
    .from("bookings")
    .select(`
      *,
      services:service_id(name),
      staff:staff_id(name)
    `)
    .eq("id", bookingId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  if (!LINE_CHANNEL_ACCESS_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(res, 500, {
      ok: false,
      error: "Server env is missing",
    });
  }

  try {
    const { booking_id, bookingId } = req.body || {};
    const finalBookingId = booking_id || bookingId;

    if (!finalBookingId) {
      return json(res, 400, {
        ok: false,
        error: "booking_id is required",
      });
    }

    const booking = await getBooking(finalBookingId);

    if (!booking) {
      return json(res, 404, {
        ok: false,
        error: "Booking not found",
      });
    }

    if (!booking.line_user_id) {
      return json(res, 200, {
        ok: true,
        skipped: true,
        reason: "Booking has no line_user_id",
      });
    }

    const message = buildBookingFlexMessage(booking);
    await pushLineMessage(booking.line_user_id, message);

    await supabase.from("booking_events").insert({
      booking_id: booking.id,
      salon_id: booking.salon_id,
      event_type: "line_confirmation_sent",
      payload: {
        channel: "line",
        sent_at: new Date().toISOString(),
      },
    });

    return json(res, 200, {
      ok: true,
      booking_id: booking.id,
      sent: true,
    });
  } catch (error) {
    console.error("send-booking-confirmation error:", error);
    return json(res, 500, {
      ok: false,
      error: error.message || "Internal server error",
    });
  }
}