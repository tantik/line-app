"use strict";

const ALLOWED_ORIGINS = new Set([
  "https://line-app-xi.vercel.app",
  "https://www.izumi-it-company.com",
  "https://izumi-it-company.com",
  "http://localhost:3000",
  "http://localhost:5173",
]);

function getOrigin(req) {
  return req.headers.origin || "";
}

function setCorsHeaders(req, res) {
  const origin = getOrigin(req);

  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(req, res, statusCode, payload) {
  setCorsHeaders(req, res);
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

function getResendConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const notifyEmail = process.env.LEAD_NOTIFY_EMAIL;
  const fromEmail = process.env.LEAD_FROM_EMAIL;

  if (!apiKey || !notifyEmail || !fromEmail) {
    return null;
  }

  return {
    apiKey,
    notifyEmail,
    fromEmail,
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeNullableText(value) {
  const text = normalizeText(value);
  return text || null;
}

function firstValue(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }

  return "";
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return null;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatMultilineText(value) {
  return escapeHtml(value || "-").replace(/\n/g, "<br>");
}

function buildLeadPayload(body, req) {
  const email = firstValue(body.email, body.mail);
  const lineId = firstValue(body.line_id, body.lineId, body.line);
  const phone = firstValue(body.phone, body.tel, body.telephone);

  const contact = firstValue(
    body.contact,
    body.contact_info,
    body.contactInfo,
    email,
    lineId,
    phone
  );

  const businessName = firstValue(
    body.business_name,
    body.businessName,
    body.store_name,
    body.storeName,
    body.company_name,
    body.companyName,
    body.business
  );

  const ownerName = firstValue(
    body.owner_name,
    body.ownerName,
    body.person_name,
    body.personName,
    body.customer_name,
    body.customerName,
    body.name
  );

  const message = firstValue(
    body.message,
    body.consultation,
    body.consultation_text,
    body.note,
    body.content
  );

  return {
    source: firstValue(body.source) || "unknown",

    business_name: businessName,
    owner_name: ownerName,
    contact,

    email: normalizeNullableText(email),
    line_id: normalizeNullableText(lineId),
    phone: normalizeNullableText(phone),
    industry: normalizeNullableText(body.industry),
    message: normalizeNullableText(message),

    status: "new",
    admin_note: null,

    page_url: normalizeNullableText(body.page_url || body.pageUrl || req.headers.referer),
    user_agent: normalizeNullableText(req.headers["user-agent"]),
    ip_address: getClientIp(req),

    metadata: {
      received_at: new Date().toISOString(),
      raw_source: body.source || null,
    },
  };
}

function validateLeadPayload(payload) {
  const missing = [];

  if (!payload.business_name) missing.push("business_name");
  if (!payload.owner_name) missing.push("owner_name");
  if (!payload.contact) missing.push("contact");

  return missing;
}

async function insertSalesLead(payload) {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig();

  const response = await fetch(`${supabaseUrl}/rest/v1/sales_leads`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
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
    throw new Error(`Supabase sales_leads insert failed: ${response.status} ${detail}`);
  }

  return Array.isArray(data) ? data[0] : data;
}

function getSourceLabel(source) {
  if (source === "demo_app_first_screen") return "Demo App / 導入相談";
  if (source === "line_booking_site") return "Line Booking Site / LP";
  return source || "unknown";
}

function buildLeadEmail({ lead, payload }) {
  const sourceLabel = getSourceLabel(payload.source);
  const subject = `【Mirawi】新しい導入相談: ${payload.business_name}`;

  const text = [
    "新しい導入相談が届きました。",
    "",
    `Source: ${sourceLabel}`,
    `Lead ID: ${lead?.id || "-"}`,
    `店舗名 / 会社名: ${payload.business_name || "-"}`,
    `ご担当者名: ${payload.owner_name || "-"}`,
    `連絡先: ${payload.contact || "-"}`,
    `Email: ${payload.email || "-"}`,
    `LINE ID: ${payload.line_id || "-"}`,
    `電話番号: ${payload.phone || "-"}`,
    `業種: ${payload.industry || "-"}`,
    `Page URL: ${payload.page_url || "-"}`,
    "",
    "相談内容:",
    payload.message || "-",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #172326; max-width: 680px;">
      <h2 style="margin: 0 0 16px; color: #0f3f46;">新しい導入相談が届きました</h2>
      <p style="margin: 0 0 18px;">Mirawi / LINE Booking の問い合わせフォームから新しいリードが届きました。</p>

      <table style="width: 100%; border-collapse: collapse; border: 1px solid #d8e4e7;">
        <tbody>
          <tr>
            <th style="width: 170px; text-align: left; padding: 10px; background: #f2f7f8; border-bottom: 1px solid #d8e4e7;">Source</th>
            <td style="padding: 10px; border-bottom: 1px solid #d8e4e7;">${escapeHtml(sourceLabel)}</td>
          </tr>
          <tr>
            <th style="text-align: left; padding: 10px; background: #f2f7f8; border-bottom: 1px solid #d8e4e7;">Lead ID</th>
            <td style="padding: 10px; border-bottom: 1px solid #d8e4e7;">${escapeHtml(lead?.id || "-")}</td>
          </tr>
          <tr>
            <th style="text-align: left; padding: 10px; background: #f2f7f8; border-bottom: 1px solid #d8e4e7;">店舗名 / 会社名</th>
            <td style="padding: 10px; border-bottom: 1px solid #d8e4e7;">${escapeHtml(payload.business_name || "-")}</td>
          </tr>
          <tr>
            <th style="text-align: left; padding: 10px; background: #f2f7f8; border-bottom: 1px solid #d8e4e7;">ご担当者名</th>
            <td style="padding: 10px; border-bottom: 1px solid #d8e4e7;">${escapeHtml(payload.owner_name || "-")}</td>
          </tr>
          <tr>
            <th style="text-align: left; padding: 10px; background: #f2f7f8; border-bottom: 1px solid #d8e4e7;">連絡先</th>
            <td style="padding: 10px; border-bottom: 1px solid #d8e4e7;">${escapeHtml(payload.contact || "-")}</td>
          </tr>
          <tr>
            <th style="text-align: left; padding: 10px; background: #f2f7f8; border-bottom: 1px solid #d8e4e7;">Email</th>
            <td style="padding: 10px; border-bottom: 1px solid #d8e4e7;">${escapeHtml(payload.email || "-")}</td>
          </tr>
          <tr>
            <th style="text-align: left; padding: 10px; background: #f2f7f8; border-bottom: 1px solid #d8e4e7;">LINE ID</th>
            <td style="padding: 10px; border-bottom: 1px solid #d8e4e7;">${escapeHtml(payload.line_id || "-")}</td>
          </tr>
          <tr>
            <th style="text-align: left; padding: 10px; background: #f2f7f8; border-bottom: 1px solid #d8e4e7;">電話番号</th>
            <td style="padding: 10px; border-bottom: 1px solid #d8e4e7;">${escapeHtml(payload.phone || "-")}</td>
          </tr>
          <tr>
            <th style="text-align: left; padding: 10px; background: #f2f7f8; border-bottom: 1px solid #d8e4e7;">業種</th>
            <td style="padding: 10px; border-bottom: 1px solid #d8e4e7;">${escapeHtml(payload.industry || "-")}</td>
          </tr>
          <tr>
            <th style="text-align: left; padding: 10px; background: #f2f7f8; border-bottom: 1px solid #d8e4e7;">Page URL</th>
            <td style="padding: 10px; border-bottom: 1px solid #d8e4e7;">${escapeHtml(payload.page_url || "-")}</td>
          </tr>
          <tr>
            <th style="text-align: left; padding: 10px; background: #f2f7f8; vertical-align: top;">相談内容</th>
            <td style="padding: 10px;">${formatMultilineText(payload.message)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  return {
    subject,
    text,
    html,
  };
}

async function sendLeadNotification({ lead, payload }) {
  const config = getResendConfig();

  if (!config) {
    console.warn("Lead email notification skipped: Resend env is not configured");
    return {
      sent: false,
      skipped: true,
      reason: "Resend env is not configured",
    };
  }

  const email = buildLeadEmail({ lead, payload });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.fromEmail,
      to: [config.notifyEmail],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
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
    throw new Error(`Resend email failed: ${response.status} ${detail}`);
  }

  return {
    sent: true,
    id: data?.id || null,
  };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    setCorsHeaders(req, res);
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return sendJson(req, res, 200, {
      ok: true,
      message: "create sales lead endpoint",
    });
  }

  if (req.method !== "POST") {
    return sendJson(req, res, 405, {
      ok: false,
      error: "Method not allowed",
    });
  }

  try {
    requireEnv("SUPABASE_URL");
    requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    const body = parseBody(req);
    const payload = buildLeadPayload(body, req);
    const missing = validateLeadPayload(payload);

    if (missing.length > 0) {
      return sendJson(req, res, 400, {
        ok: false,
        error: "Missing required fields",
        missing,
      });
    }

    const lead = await insertSalesLead(payload);

    let emailResult = {
      sent: false,
      skipped: false,
      error: null,
    };

    try {
      emailResult = await sendLeadNotification({ lead, payload });
    } catch (emailError) {
      console.error("Lead email notification error:", emailError);
      emailResult = {
        sent: false,
        skipped: false,
        error: emailError.message || "Email notification failed",
      };
    }

    return sendJson(req, res, 200, {
      ok: true,
      lead_id: lead?.id || null,
      email_sent: Boolean(emailResult.sent),
      email_id: emailResult.id || null,
      email_error: emailResult.error || null,
      email_skipped: Boolean(emailResult.skipped),
    });
  } catch (error) {
    console.error("create-sales-lead error:", error);

    return sendJson(req, res, 500, {
      ok: false,
      error: error.message || "Internal server error",
    });
  }
}