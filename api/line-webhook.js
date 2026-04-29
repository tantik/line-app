import crypto from "node:crypto";

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

async function readRawBody(req) {
  if (typeof req.body === "string") return req.body;

  if (Buffer.isBuffer(req.body)) {
    return req.body.toString("utf8");
  }

  if (req.body && typeof req.body === "object") {
    return JSON.stringify(req.body);
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonBody(rawBody) {
  if (!rawBody) return {};

  try {
    return JSON.parse(rawBody);
  } catch {
    return {};
  }
}

function safeCompare(a, b) {
  const bufferA = Buffer.from(String(a || ""));
  const bufferB = Buffer.from(String(b || ""));

  if (bufferA.length !== bufferB.length) return false;

  return crypto.timingSafeEqual(bufferA, bufferB);
}

function verifyLineSignature(rawBody, signature) {
  const channelSecret = requireEnv("LINE_CHANNEL_SECRET");

  if (!signature) return false;

  const expectedSignature = crypto
    .createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest("base64");

  return safeCompare(expectedSignature, signature);
}

function getSupabaseConfig() {
  const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  return { supabaseUrl, serviceRoleKey };
}

async function supabaseRequest(path, options = {}) {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig();
  const url = `${supabaseUrl}${path}`;

  const response = await fetch(url, {
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
  const rows = await supabaseRequest(
    `/rest/v1/bookings?select=*&id=eq.${encodeEq(bookingId)}&limit=1`,
    { method: "GET" }
  );

  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function updateBookingById(bookingId, values) {
  const rows = await supabaseRequest(
    `/rest/v1/bookings?id=eq.${encodeEq(bookingId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(values),
    }
  );

  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function insertBookingEvent({ booking, eventType, payload }) {
  try {
    await supabaseRequest("/rest/v1/booking_events", {
      method: "POST",
      body: JSON.stringify({
        booking_id: booking?.id || null,
        salon_id: booking?.salon_id || null,
        event_type: eventType,
        payload,
      }),
    });
  } catch (error) {
    console.warn("booking_events insert skipped:", error.message);
  }
}

async function replyLineMessage(replyToken, messages) {
  if (!replyToken) return false;

  const lineToken = requireEnv("LINE_CHANNEL_ACCESS_TOKEN");

  const response = await fetch(LINE_REPLY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lineToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: Array.isArray(messages) ? messages : [messages],
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    console.error("LINE reply failed:", response.status, text);
    return false;
  }

  return true;
}

async function pushLineMessage(lineUserId, messages) {
  if (!lineUserId) return false;

  const lineToken = requireEnv("LINE_CHANNEL_ACCESS_TOKEN");

  const response = await fetch(LINE_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lineToken}`,
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: Array.isArray(messages) ? messages : [messages],
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    console.error("LINE push failed:", response.status, text);
    return false;
  }

  return true;
}

function getLineUserId(event) {
  return event?.source?.userId || "";
}

function getReplyToken(event) {
  return event?.replyToken || "";
}

function parsePostbackData(event) {
  const rawData = event?.postback?.data || "";
  const params = new URLSearchParams(rawData);

  return {
    rawData,
    action: params.get("action") || "",
    bookingId: params.get("booking_id") || params.get("bookingId") || "",
  };
}

function buildTextMessage(text) {
  return {
    type: "text",
    text,
  };
}

function buildConfirmReplyText(booking) {
  const date = String(booking?.booking_date || booking?.date || "").slice(0, 10);
  const time = String(booking?.start_time || booking?.time || "").slice(0, 5);

  if (date || time) {
    return `ご予約を確認しました。\n${date} ${time}\nご来店をお待ちしております。`;
  }

  return "ご予約を確認しました。ご来店をお待ちしております。";
}

function buildCancelReplyText() {
  return "ご予約をキャンセルしました。またのご利用をお待ちしております。";
}

async function updateBookingStatusFromPostback({ bookingId, lineUserId, action }) {
  const booking = await getBookingById(bookingId);

  if (!booking) {
    return {
      ok: false,
      reason: "not_found",
      booking: null,
    };
  }

  const bookingLineUserId =
    booking.line_user_id || booking.lineUserId || booking.line_id || "";

  if (bookingLineUserId && lineUserId && bookingLineUserId !== lineUserId) {
    return {
      ok: false,
      reason: "line_user_mismatch",
      booking,
    };
  }

  const now = new Date().toISOString();
  const isConfirm = action === "confirm";

  const richValues = isConfirm
    ? {
        status: "confirmed",
        confirmed_at: now,
        updated_at: now,
      }
    : {
        status: "cancelled",
        cancelled_at: now,
        cancelled_by: "customer_line",
        updated_at: now,
      };

  let updatedBooking = null;

  try {
    updatedBooking = await updateBookingById(bookingId, richValues);
  } catch (error) {
    console.warn(
      "Rich booking status update failed. Fallback status update is used:",
      error.message
    );

    updatedBooking = await updateBookingById(bookingId, {
      status: isConfirm ? "confirmed" : "cancelled",
      updated_at: now,
    });
  }

  const finalBooking = updatedBooking || {
    ...booking,
    ...richValues,
  };

  await insertBookingEvent({
    booking: finalBooking,
    eventType: isConfirm ? "customer_confirmed" : "customer_cancelled",
    payload: {
      source: "line_postback",
      action,
      line_user_id: lineUserId || null,
      at: now,
    },
  });

  return {
    ok: true,
    reason: "updated",
    booking: finalBooking,
  };
}

async function handlePostback(event) {
  const replyToken = getReplyToken(event);
  const lineUserId = getLineUserId(event);
  const { action, bookingId, rawData } = parsePostbackData(event);

  console.log("LINE postback received:", {
    action,
    bookingId,
    rawData,
    lineUserId,
  });

  if (!lineUserId) {
    await replyLineMessage(
      replyToken,
      buildTextMessage("LINEユーザー情報を確認できませんでした。")
    );
    return;
  }

  if (!bookingId || !["confirm", "cancel"].includes(action)) {
    await replyLineMessage(
      replyToken,
      buildTextMessage("処理できませんでした。予約情報をご確認ください。")
    );
    return;
  }

  const result = await updateBookingStatusFromPostback({
    bookingId,
    lineUserId,
    action,
  });

  if (!result.ok) {
    const text =
      result.reason === "line_user_mismatch"
        ? "この予約は別のLINEアカウントに紐づいています。"
        : "予約が見つかりませんでした。";

    await replyLineMessage(replyToken, buildTextMessage(text));
    return;
  }

  const replyText =
    action === "confirm"
      ? buildConfirmReplyText(result.booking)
      : buildCancelReplyText();

  await replyLineMessage(replyToken, buildTextMessage(replyText));
}

async function handleFollow(event) {
  const replyToken = getReplyToken(event);
  const lineUserId = getLineUserId(event);

  const message = buildTextMessage(
    "Mirawi Salon Demoへようこそ。\n予約後にこちらへ確認メッセージが届きます。"
  );

  if (replyToken) {
    await replyLineMessage(replyToken, message);
    return;
  }

  await pushLineMessage(lineUserId, message);
}

async function handleTextMessage(event) {
  const replyToken = getReplyToken(event);

  await replyLineMessage(
    replyToken,
    buildTextMessage("ありがとうございます。予約はMini Appからお願いします。")
  );
}

async function handleEvent(event) {
  if (!event || !event.type) return;

  if (event.type === "postback") {
    await handlePostback(event);
    return;
  }

  if (event.type === "follow") {
    await handleFollow(event);
    return;
  }

  if (event.type === "message" && event.message?.type === "text") {
    await handleTextMessage(event);
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      message: "line webhook endpoint",
    });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, {
      ok: false,
      error: "Method not allowed",
    });
  }

  try {
    requireEnv("LINE_CHANNEL_SECRET");
    requireEnv("LINE_CHANNEL_ACCESS_TOKEN");
    requireEnv("SUPABASE_URL");
    requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    const rawBody = await readRawBody(req);
    const signature =
      req.headers["x-line-signature"] || req.headers["X-Line-Signature"];

    if (!verifyLineSignature(rawBody, signature)) {
      console.warn("Invalid LINE signature");
      return sendJson(res, 401, {
        ok: false,
        error: "Invalid LINE signature",
      });
    }

    const body = parseJsonBody(rawBody);
    const events = Array.isArray(body.events) ? body.events : [];

    for (const event of events) {
      try {
        await handleEvent(event);
      } catch (error) {
        console.error("LINE event handling error:", error);
      }
    }

    return sendJson(res, 200, {
      ok: true,
      processed: events.length,
    });
  } catch (error) {
    console.error("line-webhook error:", error);

    return sendJson(res, 500, {
      ok: false,
      error: error.message || "Internal server error",
    });
  }
}