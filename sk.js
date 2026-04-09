const SHEET_ID = "14mfJUTcpwRD-1LpSH6lCHQHU6jvBU3YPhDF2xen5BVY";

/*
  ВСТАВЬ СВОИ ТЕКУЩИЕ РЕАЛЬНЫЕ ЗНАЧЕНИЯ
*/
const CHANNEL_ACCESS_TOKEN = "PASTE_YOUR_CURRENT_CHANNEL_ACCESS_TOKEN_HERE";
const OWNER_USER_ID = "PASTE_YOUR_CURRENT_OWNER_USER_ID_HERE";

/* =========================
   ROUTES
========================= */

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action).trim() : "";

  if (action === "services") return outputJson(getServices());
  if (action === "staff") return outputJson(getStaff());
  if (action === "bookings") return outputJson(getBookings());
  if (action === "calendar") return outputJson(getCalendarView());

  return outputJson({ status: "ok" });
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    const data = JSON.parse(raw);
    const mode = String(data.mode || "booking").trim();

    if (mode === "lead") {
      return outputJson(saveLead(data));
    }

    if (mode === "update_status") {
      return outputJson(updateBookingStatus(data));
    }

    return outputJson(saveBooking(data));
  } catch (err) {
    Logger.log("doPost error: " + err.message);
    Logger.log(err.stack || "no stack");

    return outputJson({
      status: "error",
      message: err.message
    });
  }
}

function outputJson(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/* =========================
   READ DATA
========================= */

function getServices() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("services");
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0];

  return values.slice(1)
    .filter(row => String(row[0]).trim() !== "")
    .map(row => rowToObject(headers, row))
    .filter(item => String(item.active || "").toLowerCase() === "yes")
    .map(item => ({
      serviceId: String(item.service_id || "").trim(),
      category: String(item.category || "").trim(),
      name: String(item.name || "").trim(),
      duration: Number(item.duration || 0),
      price: Number(item.price || 0),
      active: String(item.active || "").trim(),
      icon: String(item.icon || "").trim()
    }));
}

function getStaff() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("staff");
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0];

  return values.slice(1)
    .filter(row => String(row[0]).trim() !== "")
    .map(row => rowToObject(headers, row))
    .filter(item => String(item.active || "").toLowerCase() === "yes")
    .map(item => ({
      staffId: String(item.staff_id || "").trim(),
      name: String(item.name || "").trim(),
      photoUrl: String(item.photo_url || "").trim(),
      workDays: String(item.work_days || "").trim(),
      startTime: formatTimeValue(item.start_time),
      endTime: formatTimeValue(item.end_time),
      slotMinutes: Number(item.slot_minutes || 30),
      active: String(item.active || "").trim(),
      services: parseServicesList(item.services)
    }));
}

function getBookings() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("bookings");
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0];

  return values.slice(1)
    .filter(row => String(row[0]).trim() !== "")
    .map(row => rowToObject(headers, row))
    .map(item => ({
      createdAt: item.created_at || "",
      customerName: String(item.customer_name || "").trim(),
      phone: String(item.phone || "").trim(),
      lineUserId: String(item.line_user_id || "").trim(),
      staffId: String(item.staff_id || "").trim(),
      staffName: String(item.staff_name || "").trim(),
      serviceId: String(item.service_id || "").trim(),
      serviceName: String(item.service_name || "").trim(),
      date: formatDateValue(item.date),
      time: formatTimeValue(item.time),
      status: String(item.status || "").trim().toLowerCase(),
      duration: Number(item.duration || 0),
      reminderSent: String(item.reminder_sent || "").trim(),
      reminderSentAt: item.reminder_sent_at || ""
    }));
}

function getCalendarView() {
  const bookings = getBookings()
    .sort((a, b) => {
      const aa = `${a.date} ${a.time}`;
      const bb = `${b.date} ${b.time}`;
      return aa.localeCompare(bb);
    });

  return bookings.map(item => ({
    title: `${item.time} ${item.serviceName} / ${item.staffName}`,
    date: item.date,
    time: item.time,
    staffName: item.staffName,
    customerName: item.customerName,
    serviceName: item.serviceName,
    phone: item.phone,
    duration: item.duration,
    status: item.status || "booked"
  }));
}

/* =========================
   BOOKING
========================= */

function saveBooking(data) {
  const serviceId = String(data.serviceId || "").trim();
  const serviceName = String(data.serviceName || "").trim();
  const staffId = String(data.staffId || "").trim();
  const staffName = String(data.staffName || "").trim();
  const date = String(data.date || "").trim();
  const time = normalizeTime(String(data.time || "").trim());
  const duration = Number(data.duration || 0);
  const customerName = String(data.name || "").trim();
  const phone = String(data.phone || "").trim();
  const lineUserId = String(data.userId || "").trim();

  if (!serviceId || !staffId || !date || !time || !duration) {
    return {
      status: "error",
      message: "missing booking fields"
    };
  }

  const existing = getBookings().filter(item =>
    item.staffId === staffId &&
    item.date === date &&
    item.status === "booked"
  );

  const newStart = timeToMinutes(time);
  const newEnd = newStart + duration;

  const hasConflict = existing.some(item => {
    const existingStart = timeToMinutes(item.time);
    const existingEnd = existingStart + Number(item.duration || 0);
    return newStart < existingEnd && newEnd > existingStart;
  });

  if (hasConflict) {
    return {
      status: "error",
      message: "slot already booked"
    };
  }

  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("bookings");

  sheet.appendRow([
    new Date(),
    customerName,
    phone,
    lineUserId,
    staffId,
    staffName,
    serviceId,
    serviceName,
    date,
    time,
    "booked",
    duration,
    "",
    ""
  ]);

  const bookingData = {
    name: customerName,
    phone: phone,
    userId: lineUserId,
    staffId: staffId,
    staffName: staffName,
    serviceId: serviceId,
    serviceName: serviceName,
    date: date,
    time: time,
    duration: duration
  };

  try {
    notifyOwner(bookingData);
  } catch (err) {
    Logger.log("Owner notification error: " + err.message);
  }

  try {
    notifyClient(bookingData);
  } catch (err) {
    Logger.log("Client notification error: " + err.message);
  }

  return {
    status: "success"
  };
}

function updateBookingStatus(data) {
  const bookingId = String(data.bookingId || "").trim();
  const date = String(data.date || "").trim();
  const time = normalizeTime(String(data.time || "").trim());
  const customerName = String(data.customerName || "").trim();
  const staffName = String(data.staffName || "").trim();
  const serviceName = String(data.serviceName || "").trim();
  const nextStatus = String(data.nextStatus || "").trim().toLowerCase();

  const allowedStatuses = ["booked", "completed", "cancelled"];
  if (!allowedStatuses.includes(nextStatus)) {
    return {
      status: "error",
      message: "invalid nextStatus"
    };
  }

  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("bookings");
  if (!sheet) {
    return {
      status: "error",
      message: "bookings sheet not found"
    };
  }

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return {
      status: "error",
      message: "no bookings found"
    };
  }

  const headers = values[0];
  const statusCol = headers.indexOf("status") + 1;
  const reminderSentCol = headers.indexOf("reminder_sent") + 1;
  const reminderSentAtCol = headers.indexOf("reminder_sent_at") + 1;

  if (!statusCol) {
    return {
      status: "error",
      message: "status column not found"
    };
  }

  let foundRowIndex = -1;

  for (let i = 1; i < values.length; i++) {
    const row = rowToObject(headers, values[i]);

    const rowDate = formatDateValue(row.date);
    const rowTime = formatTimeValue(row.time);
    const rowCustomerName = String(row.customer_name || "").trim();
    const rowStaffName = String(row.staff_name || "").trim();
    const rowServiceName = String(row.service_name || "").trim();

    const rowBookingId = [
      rowDate || "",
      rowTime || "",
      rowStaffName || "",
      rowCustomerName || "",
      rowServiceName || ""
    ].join("|");

    if (
      (bookingId && rowBookingId === bookingId) ||
      (
        rowDate === date &&
        rowTime === time &&
        rowCustomerName === customerName &&
        rowStaffName === staffName &&
        rowServiceName === serviceName
      )
    ) {
      foundRowIndex = i + 1;
      break;
    }
  }

  if (foundRowIndex === -1) {
    return {
      status: "error",
      message: "booking not found"
    };
  }

  sheet.getRange(foundRowIndex, statusCol).setValue(nextStatus);

  // если вернули запись обратно в booked, позволяем reminder уйти заново
  if (nextStatus === "booked") {
    if (reminderSentCol) sheet.getRange(foundRowIndex, reminderSentCol).setValue("");
    if (reminderSentAtCol) sheet.getRange(foundRowIndex, reminderSentAtCol).setValue("");
  }

  return {
    status: "success",
    row: foundRowIndex,
    nextStatus: nextStatus
  };
}

/* =========================
   LEAD
   Поддержка двух форматов:
   1) Mini App: salonName / ownerName / contact ...
   2) Landing: name / business / line / email ...
========================= */

function saveLead(data) {
  const isMiniAppLead =
    String(data.salonName || "").trim() ||
    String(data.ownerName || "").trim() ||
    String(data.contact || "").trim();

  const isLandingLead =
    String(data.name || "").trim() ||
    String(data.business || "").trim() ||
    String(data.line || "").trim();

  if (isMiniAppLead) {
    return saveMiniAppLead(data);
  }

  if (isLandingLead) {
    return saveLandingLead(data);
  }

  return {
    status: "error",
    message: "missing lead fields"
  };
}

function saveMiniAppLead(data) {
  const salonName = String(data.salonName || "").trim();
  const ownerName = String(data.ownerName || "").trim();
  const contact = String(data.contact || "").trim();
  const businessType = String(data.businessType || "").trim();
  const needs = String(data.needs || "").trim();
  const lineUserId = String(data.userId || "").trim();
  const lineDisplayName = String(data.displayName || "").trim();
  const source = String(data.source || "").trim();

  if (!salonName || !ownerName || !contact) {
    return {
      status: "error",
      message: "missing lead fields"
    };
  }

  const sheet = ensureLeadsSheet();

  sheet.appendRow([
    new Date(),
    "mini_app",
    salonName,
    ownerName,
    contact,
    businessType,
    needs,
    lineUserId,
    lineDisplayName,
    source,
    "",
    "",
    "",
    "new"
  ]);

  const leadData = {
    salonName,
    ownerName,
    contact,
    businessType,
    needs,
    lineUserId,
    lineDisplayName,
    source
  };

  try {
    notifyOwnerLeadMiniApp(leadData);
  } catch (err) {
    Logger.log("Lead owner notification error: " + err.message);
  }

  try {
    notifyMiniAppLeadClient(leadData);
  } catch (err) {
    Logger.log("Lead client auto reply error: " + err.message);
  }

  return {
    status: "success"
  };
}

function saveLandingLead(data) {
  const name = String(data.name || "").trim();
  const business = String(data.business || "").trim();
  const line = String(data.line || "").trim();
  const email = String(data.email || "").trim();
  const message = String(data.message || "").trim();
  const source = String(data.source || "").trim();
  const page = String(data.page || "").trim();
  const userAgent = String(data.userAgent || "").trim();

  if (!name || !business || !line) {
    return {
      status: "error",
      message: "missing lead fields"
    };
  }

  const sheet = ensureLeadsSheet();

  sheet.appendRow([
    new Date(),
    "landing",
    business,
    name,
    line,
    "",
    message,
    "",
    "",
    source,
    email,
    page,
    userAgent,
    "new"
  ]);

  const leadData = {
    name,
    business,
    line,
    email,
    message,
    source
  };

  try {
    notifyOwnerLeadLanding(leadData);
  } catch (err) {
    Logger.log("Lead owner notification error: " + err.message);
  }

  return {
    status: "success"
  };
}

function ensureLeadsSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName("leads");

  if (!sheet) {
    sheet = ss.insertSheet("leads");
    sheet.appendRow([
      "created_at",
      "lead_type",
      "salon_name",
      "owner_name",
      "contact",
      "business_type",
      "needs",
      "line_user_id",
      "line_display_name",
      "source",
      "email",
      "page",
      "user_agent",
      "status"
    ]);
  }

  return sheet;
}

/* =========================
   REMINDERS
========================= */

function sendReminders() {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(20000);
    Logger.log("START sendReminders");

    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("bookings");
    if (!sheet) throw new Error("Sheet 'bookings' not found");

    const values = sheet.getDataRange().getValues();
    if (values.length < 2) {
      Logger.log("No bookings");
      return;
    }

    const headers = values[0];
    const reminderSentCol = headers.indexOf("reminder_sent") + 1;
    const reminderSentAtCol = headers.indexOf("reminder_sent_at") + 1;

    if (!reminderSentCol || !reminderSentAtCol) {
      throw new Error("Columns reminder_sent / reminder_sent_at not found");
    }

    const now = new Date();
    const scriptTimeZone = Session.getScriptTimeZone();
    const startMs = Date.now();

    for (let i = 1; i < values.length; i++) {
      if (Date.now() - startMs > 240000) {
        Logger.log("STOP: timeout protection");
        break;
      }

      const row = rowToObject(headers, values[i]);

      try {
        if (String(row.status || "").trim().toLowerCase() !== "booked") continue;
        if (String(row.reminder_sent || "").trim().toLowerCase() === "yes") continue;

        const dateStr = formatDateValue(row.date);
        const timeStr = formatTimeValue(row.time);
        const lineUserId = String(row.line_user_id || "").trim();

        if (!dateStr || !timeStr || !lineUserId) continue;

        const bookingDateTime = buildDateTime(dateStr, timeStr);
        if (isNaN(bookingDateTime.getTime())) {
          Logger.log(`Row ${i + 1}: invalid booking datetime`);
          continue;
        }

        const diffMinutes = (bookingDateTime.getTime() - now.getTime()) / 60000;

        if (diffMinutes <= 24 * 60 && diffMinutes > 23 * 60) {
          const message = buildReminderMessage({
            customerName: String(row.customer_name || "").trim(),
            serviceName: String(row.service_name || "").trim(),
            staffName: String(row.staff_name || "").trim(),
            date: dateStr,
            time: timeStr
          });

          sendLinePush(lineUserId, message);

          sheet.getRange(i + 1, reminderSentCol).setValue("yes");
          sheet.getRange(i + 1, reminderSentAtCol).setValue(
            Utilities.formatDate(new Date(), scriptTimeZone, "yyyy-MM-dd HH:mm:ss")
          );

          Logger.log(`Reminder sent for row ${i + 1} to ${lineUserId}`);
        }
      } catch (rowErr) {
        Logger.log(`Row ${i + 1} error: ${rowErr.message}`);
      }
    }

    Logger.log("END sendReminders");
  } catch (err) {
    Logger.log("FATAL sendReminders error: " + err.message);
    Logger.log(err.stack || "no stack");
    throw err;
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}

/* =========================
   LINE
========================= */

function sendLinePush(to, messages) {
  if (!CHANNEL_ACCESS_TOKEN || CHANNEL_ACCESS_TOKEN === "PASTE_YOUR_CURRENT_CHANNEL_ACCESS_TOKEN_HERE") {
    throw new Error("CHANNEL_ACCESS_TOKEN is not set");
  }

  if (!to) {
    throw new Error("Recipient ID is empty");
  }

  const url = "https://api.line.me/v2/bot/message/push";

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + CHANNEL_ACCESS_TOKEN
    },
    payload: JSON.stringify({ to, messages }),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const body = response.getContentText();

  Logger.log("LINE push response code: " + code);
  Logger.log("LINE push response body: " + body);

  if (code < 200 || code >= 300) {
    throw new Error("LINE push failed: " + code + " / " + body);
  }
}

function notifyOwner(data) {
  if (!OWNER_USER_ID || OWNER_USER_ID === "PASTE_YOUR_CURRENT_OWNER_USER_ID_HERE") return;

  const text =
    "🔔 新しい予約\n" +
    "顧客: " + (data.name || "-") + "\n" +
    "サービス: " + (data.serviceName || "-") + "\n" +
    "担当: " + (data.staffName || "-") + "\n" +
    "日時: " + (data.date || "-") + " " + (data.time || "-") + "\n" +
    "電話: " + (data.phone || "-");

  sendLinePush(OWNER_USER_ID, [{
    type: "text",
    text: text
  }]);
}

function notifyClient(data) {
  if (!data.userId) return;

  const text =
    "ご予約ありがとうございます。\n" +
    "日時: " + (data.date || "-") + " " + (data.time || "-") + "\n" +
    "サービス: " + (data.serviceName || "-") + "\n" +
    "担当: " + (data.staffName || "-");

  sendLinePush(data.userId, [{
    type: "text",
    text: text
  }]);
}

function notifyOwnerLeadMiniApp(data) {
  if (!OWNER_USER_ID || OWNER_USER_ID === "PASTE_YOUR_CURRENT_OWNER_USER_ID_HERE") return;

  const text =
    "📩 新しい導入相談\n" +
    "店舗名: " + (data.salonName || "-") + "\n" +
    "担当者: " + (data.ownerName || "-") + "\n" +
    "連絡先: " + (data.contact || "-") + "\n" +
    "業種: " + (data.businessType || "-") + "\n" +
    "相談内容: " + (data.needs || "-") + "\n" +
    "LINE名: " + (data.lineDisplayName || "-") + "\n" +
    "source: " + (data.source || "-");

  sendLinePush(OWNER_USER_ID, [{
    type: "text",
    text: text
  }]);
}

function notifyOwnerLeadLanding(data) {
  if (!OWNER_USER_ID || OWNER_USER_ID === "PASTE_YOUR_CURRENT_OWNER_USER_ID_HERE") return;

  const text =
    "📩 新しい問い合わせ（LP）\n" +
    "名前: " + (data.name || "-") + "\n" +
    "店舗: " + (data.business || "-") + "\n" +
    "LINE: " + (data.line || "-") + "\n" +
    "Email: " + (data.email || "-") + "\n" +
    "内容: " + (data.message || "-") + "\n" +
    "source: " + (data.source || "-");

  sendLinePush(OWNER_USER_ID, [{
    type: "text",
    text: text
  }]);
}

function notifyMiniAppLeadClient(data) {
  if (!data.lineUserId) return;

  const text =
    "お問い合わせありがとうございます。\n" +
    "ご相談内容を受け付けました。\n" +
    "内容を確認後、LINEまたはご連絡先へご案内します。";

  sendLinePush(data.lineUserId, [{
    type: "text",
    text: text
  }]);
}

function buildReminderMessage(data) {
  const text =
    "📌 ご予約リマインド\n" +
    "明日のご予約です。\n" +
    "日時: " + (data.date || "-") + " " + (data.time || "-") + "\n" +
    "サービス: " + (data.serviceName || "-") + "\n" +
    "担当: " + (data.staffName || "-") + "\n" +
    "ご来店をお待ちしております。";

  return [{
    type: "text",
    text: text
  }];
}

/* =========================
   HELPERS
========================= */

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    obj[String(h || "").trim()] = row[i];
  });
  return obj;
}

function parseServicesList(value) {
  return String(value || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
}

function normalizeTime(value) {
  const str = String(value || "").trim();
  if (!str) return "";

  if (/^\d:\d{2}$/.test(str)) return "0" + str;
  if (/^\d{2}:\d{2}$/.test(str)) return str;

  const date = new Date(str);
  if (!isNaN(date.getTime())) {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), "HH:mm");
  }

  return str;
}

function formatTimeValue(value) {
  if (value === null || value === undefined || value === "") return "";

  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "HH:mm");
  }

  const str = String(value).trim();

  if (/^\d{1,2}:\d{2}$/.test(str)) {
    return normalizeTime(str);
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), "HH:mm");
  }

  return normalizeTime(str);
}

function formatDateValue(value) {
  if (value === null || value === undefined || value === "") return "";

  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }

  const str = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }

  return str;
}

function timeToMinutes(value) {
  const normalized = normalizeTime(value);
  const parts = normalized.split(":");
  const h = Number(parts[0] || 0);
  const m = Number(parts[1] || 0);
  return h * 60 + m;
}

function buildDateTime(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = normalizeTime(timeStr).split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}