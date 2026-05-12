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

    return sendJson(req, res, 200, {
      ok: true,
      lead_id: lead?.id || null,
    });
  } catch (error) {
    console.error("create-sales-lead error:", error);

    return sendJson(req, res, 500, {
      ok: false,
      error: error.message || "Internal server error",
    });
  }
}