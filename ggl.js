const SHEET_ID = "14mfJUTcpwRD-1LpSH6lCHQHU6jvBU3YPhDF2xen5BVY";

const SCRIPT_PROP_KEYS = {
  CHANNEL_ACCESS_TOKEN: "CHANNEL_ACCESS_TOKEN",
  OWNER_USER_ID: "OWNER_USER_ID"
};

const SHEET_NAMES = {
  SERVICES: "services",
  STAFF: "staff",
  BOOKINGS: "bookings",
  LEADS: "leads"
};

const REMINDER_WINDOW_MIN = 23 * 60; // 23 часа
const REMINDER_WINDOW_MAX = 24 * 60; // 24 часа
const SEND_REMINDERS_TIMEOUT_MS = 240000; // защитный лимит ~4 минуты

/* =========================
   ONE-TIME SETUP
========================= */

/**
 * Вставь сюда текущий тестовый токен и owner user id,
 * запусти 1 раз вручную, затем можешь вернуть PLACEHOLDER обратно.
 */
function setLineSecrets() {
  const CHANNEL_ACCESS_TOKEN = "5BgAocIICUXkX3ENSSey1RMnPK7uO/yEt/iwGzMwce4Ak9H+87v0MmK5wKTAIVcJNgZHwQUMqdNz/720X9+g5oE1fay063HmshB58K9b5wmatkYKfw1AEKZNe99PNZWdWkwDZDX91b8/wylahNbaDwdB04t89/1O/w1cDnyilFU=";
  const OWNER_USER_ID = "U2df185806fe6739ff9bdff02d3eb71ce";

  if (!CHANNEL_ACCESS_TOKEN || CHANNEL_ACCESS_TOKEN.indexOf("PASTE_") === 0) {
    throw new Error("CHANNEL_ACCESS_TOKEN is not filled in setLineSecrets()");
  }

  if (!OWNER_USER_ID || OWNER_USER_ID.indexOf("PASTE_") === 0) {
    throw new Error("OWNER_USER_ID is not filled in setLineSecrets()");
  }

  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    [SCRIPT_PROP_KEYS.CHANNEL_ACCESS_TOKEN]: CHANNEL_ACCESS_TOKEN,
    [SCRIPT_PROP_KEYS.OWNER_USER_ID]: OWNER_USER_ID
  }, true);

  Logger.log("Secrets saved to Script Properties successfully");
}

function showLineSecretsStatus() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty(SCRIPT_PROP_KEYS.CHANNEL_ACCESS_TOKEN);
  const ownerId = props.getProperty(SCRIPT_PROP_KEYS.OWNER_USER_ID);

  Logger.log(JSON.stringify({
    hasChannelAccessToken: !!token,
    hasOwnerUserId: !!ownerId,
    ownerUserIdPreview: ownerId ? maskMiddle_(ownerId, 4, 4) : ""
  }, null, 2));
}

function clearLineSecrets() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(SCRIPT_PROP_KEYS.CHANNEL_ACCESS_TOKEN);
  props.deleteProperty(SCRIPT_PROP_KEYS.OWNER_USER_ID);
  Logger.log("Secrets removed from Script Properties");
}

/* =========================
   ROUTES
========================= */

function doGet(e) {
  try {
    const action = getParam_(e, "action");

    if (action === "services") return outputJson(getServices());
    if (action === "staff") return outputJson(getStaff());
    if (action === "bookings") return outputJson(getBookings());
    if (action === "calendar") return outputJson(getCalendarView());

    return outputJson({ status: "ok" });
  } catch (err) {
    logError_("doGet", err);
    return outputJson({
      status: "error",
      message: err.message
    });
  }
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    const data = JSON.parse(raw);

    // 1) webhook от LINE
    if (data && Array.isArray(data.events)) {
      handleLineWebhook_(data);
      return outputJson({ status: "ok" });
    }

    // 2) обычный POST от frontend
    const mode = String(data.mode || "booking").trim();

    if (mode === "lead") {
      return outputJson(saveLead(data));
    }

    if (mode === "update_status") {
      return outputJson(updateBookingStatus(data));
    }

    return outputJson(saveBooking(data));
  } catch (err) {
    logError_("doPost", err);
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
   LINE WEBHOOK
========================= */

function handleLineWebhook_(data) {
  const events = data.events || [];

  events.forEach(event => {
    try {
      if (event.type !== "message") return;
      if (!event.message || event.message.type !== "text") return;
      if (!event.replyToken) return;

      const userText = String(event.message.text || "").trim();
      const replyText = getMenuReplyText_(userText);

      if (replyText) {
        replyLineText_(event.replyToken, replyText);
      }
    } catch (err) {
      logError_("handleLineWebhook_ event", err);
    }
  });
}

function getMenuReplyText_(text) {
  if (text === "仕組みを見る") {
    return (
      "LINEで予約受付を自動化できます✨\n\n" +
      "このデモでできること\n" +
      "・LINEから予約受付\n" +
      "・予約確認メッセージ送信\n" +
      "・前日リマインド送信\n" +
      "・店舗側への通知\n\n" +
      "予約対応の手間を減らし、\n" +
      "よりスムーズな運営につなげられます。"
    );
  }

  if (text === "導入メリット") {
    return (
      "導入メリットはこちらです📈\n\n" +
      "・営業時間外でも予約受付が可能\n" +
      "・予約対応の手間を削減\n" +
      "・確認やリマインドを自動化\n" +
      "・スタッフ共有をスムーズに\n" +
      "・無断キャンセル対策の基盤づくり\n\n" +
      "サロン側の負担を減らし、\n" +
      "接客に集中しやすくなります。"
    );
  }

  if (text === "相談する") {
    return (
      "ご相談ありがとうございます😊\n\n" +
      "このままLINEでお気軽にご連絡ください。\n\n" +
      "例えば：\n" +
      "・料金について\n" +
      "・導入について\n" +
      "・デモ説明"
    );
  }

  return null;
}

function replyLineText_(replyToken, text) {
  const token = getChannelAccessToken_();
  const url = "https://api.line.me/v2/bot/message/reply";

  const payload = {
    replyToken: replyToken,
    messages: [
      {
        type: "text",
        text: text
      }
    ]
  };

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + token
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const body = response.getContentText();

  Logger.log("LINE reply response code: " + code);
  Logger.log("LINE reply response body: " + body);

  if (code < 200 || code >= 300) {
    throw new Error("LINE reply failed: " + code + " / " + body);
  }
}

/* =========================
   READ DATA
========================= */

function getServices() {
  const sheet = getSheetOrThrow_(SHEET_NAMES.SERVICES);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = normalizeHeaders_(values[0]);

  return values.slice(1)
    .filter(row => String(row[0] || "").trim() !== "")
    .map(row => rowToObject(headers, row))
    .filter(item => String(item.active || "").trim().toLowerCase() === "yes")
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
  const sheet = getSheetOrThrow_(SHEET_NAMES.STAFF);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = normalizeHeaders_(values[0]);

  return values.slice(1)
    .filter(row => String(row[0] || "").trim() !== "")
    .map(row => rowToObject(headers, row))
    .filter(item => String(item.active || "").trim().toLowerCase() === "yes")
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
  const sheet = getSheetOrThrow_(SHEET_NAMES.BOOKINGS);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = normalizeHeaders_(values[0]);

  return values.slice(1)
    .filter(row => String(row[0] || "").trim() !== "")
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
      status: normalizeStatus_(item.status),
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
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(20000);

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
      const existingDuration = Number(item.duration || 0);
      if (!existingDuration) return false;

      const existingStart = timeToMinutes(item.time);
      const existingEnd = existingStart + existingDuration;
      return newStart < existingEnd && newEnd > existingStart;
    });

    if (hasConflict) {
      return {
        status: "error",
        message: "slot already booked"
      };
    }

    const sheet = getSheetOrThrow_(SHEET_NAMES.BOOKINGS);

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
      "",
      "",
      ""
    ]);

    const bookingData = {
      name: customerName,
      phone,
      userId: lineUserId,
      staffId,
      staffName,
      serviceId,
      serviceName,
      date,
      time,
      duration
    };

    try {
      notifyOwner(bookingData);
    } catch (err) {
      logError_("notifyOwner", err);
    }

    try {
      notifyClient(bookingData);
    } catch (err) {
      logError_("notifyClient", err);
    }

    return {
      status: "success"
    };
  } catch (err) {
    logError_("saveBooking", err);
    return {
      status: "error",
      message: err.message
    };
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}

function updateBookingStatus(data) {
  const bookingId = String(data.bookingId || "").trim();
  const date = String(data.date || "").trim();
  const time = normalizeTime(String(data.time || "").trim());
  const customerName = String(data.customerName || "").trim();
  const staffName = String(data.staffName || "").trim();
  const serviceName = String(data.serviceName || "").trim();
  const nextStatus = normalizeStatus_(data.nextStatus);

  const allowedStatuses = ["booked", "completed", "cancelled"];
  if (!allowedStatuses.includes(nextStatus)) {
    return {
      status: "error",
      message: "invalid nextStatus"
    };
  }

  const sheet = getSheetOrThrow_(SHEET_NAMES.BOOKINGS);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return {
      status: "error",
      message: "no bookings found"
    };
  }

  const headers = normalizeHeaders_(values[0]);
  const statusCol = findColumnIndex_(headers, "status");
  const reminderSentCol = findColumnIndex_(headers, "reminder_sent");
  const reminderSentAtCol = findColumnIndex_(headers, "reminder_sent_at");

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

    const matchedById = bookingId && rowBookingId === bookingId;
    const matchedByFields =
      rowDate === date &&
      rowTime === time &&
      rowCustomerName === customerName &&
      rowStaffName === staffName &&
      rowServiceName === serviceName;

    if (matchedById || matchedByFields) {
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

  if (nextStatus === "booked") {
    if (reminderSentCol) sheet.getRange(foundRowIndex, reminderSentCol).setValue("");
    if (reminderSentAtCol) sheet.getRange(foundRowIndex, reminderSentAtCol).setValue("");
  }

  return {
    status: "success",
    row: foundRowIndex,
    nextStatus
  };
}

/* =========================
   LEAD
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

  if (isMiniAppLead) return saveMiniAppLead(data);
  if (isLandingLead) return saveLandingLead(data);

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
    logError_("notifyOwnerLeadMiniApp", err);
  }

  try {
    notifyMiniAppLeadClient(leadData);
  } catch (err) {
    logError_("notifyMiniAppLeadClient", err);
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
    logError_("notifyOwnerLeadLanding", err);
  }

  return {
    status: "success"
  };
}

function ensureLeadsSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAMES.LEADS);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.LEADS);
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
  const startedAt = new Date();
  const startedMs = Date.now();
  const scriptTimeZone = Session.getScriptTimeZone();

  let processedRows = 0;
  let bookedRows = 0;
  let candidateRows = 0;
  let sentRows = 0;
  let skippedMissingLine = 0;
  let skippedAlreadySent = 0;
  let skippedOutsideWindow = 0;
  let skippedInvalidDateTime = 0;
  let rowErrors = 0;

  try {
    lock.waitLock(20000);
    Logger.log("START sendReminders at " + Utilities.formatDate(startedAt, scriptTimeZone, "yyyy-MM-dd HH:mm:ss"));

    // Проверяем, что токен вообще настроен
    getChannelAccessToken_();

    const sheet = getSheetOrThrow_(SHEET_NAMES.BOOKINGS);
    const values = sheet.getDataRange().getValues();

    if (values.length < 2) {
      Logger.log("No bookings rows");
      return;
    }

    const headers = normalizeHeaders_(values[0]);
    const reminderSentCol = findColumnIndex_(headers, "reminder_sent");
    const reminderSentAtCol = findColumnIndex_(headers, "reminder_sent_at");

    if (!reminderSentCol || !reminderSentAtCol) {
      throw new Error("Columns reminder_sent / reminder_sent_at not found");
    }

    const now = new Date();

    for (let i = 1; i < values.length; i++) {
      if (Date.now() - startedMs > SEND_REMINDERS_TIMEOUT_MS) {
        Logger.log("STOP sendReminders by timeout protection");
        break;
      }

      processedRows++;

      try {
        const row = rowToObject(headers, values[i]);

        const status = normalizeStatus_(row.status);
        if (status !== "booked") {
          continue;
        }
        bookedRows++;

        const alreadySent = String(row.reminder_sent || "").trim().toLowerCase() === "yes";
        if (alreadySent) {
          skippedAlreadySent++;
          continue;
        }

        const dateStr = formatDateValue(row.date);
        const timeStr = formatTimeValue(row.time);
        const lineUserId = String(row.line_user_id || "").trim();

        if (!dateStr || !timeStr) {
          skippedInvalidDateTime++;
          Logger.log(`Row ${i + 1}: skipped because date/time empty. date="${dateStr}" time="${timeStr}"`);
          continue;
        }

        if (!lineUserId) {
          skippedMissingLine++;
          Logger.log(`Row ${i + 1}: skipped because line_user_id is empty`);
          continue;
        }

        const bookingDateTime = buildDateTime(dateStr, timeStr);
        if (isNaN(bookingDateTime.getTime())) {
          skippedInvalidDateTime++;
          Logger.log(`Row ${i + 1}: invalid booking datetime. date="${dateStr}" time="${timeStr}"`);
          continue;
        }

        const diffMinutes = (bookingDateTime.getTime() - now.getTime()) / 60000;

        Logger.log(`Row ${i + 1}: bookedAt=${dateStr} ${timeStr}, diffMinutes=${diffMinutes.toFixed(2)}, lineUserId=${maskMiddle_(lineUserId, 4, 4)}`);

        if (!(diffMinutes <= REMINDER_WINDOW_MAX && diffMinutes > REMINDER_WINDOW_MIN)) {
          skippedOutsideWindow++;
          continue;
        }

        candidateRows++;

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

        sentRows++;
        Logger.log(`Reminder sent successfully for row ${i + 1}`);
      } catch (rowErr) {
        rowErrors++;
        logError_(`sendReminders row ${i + 1}`, rowErr);
      }
    }

    Logger.log(JSON.stringify({
      startedAt: Utilities.formatDate(startedAt, scriptTimeZone, "yyyy-MM-dd HH:mm:ss"),
      processedRows,
      bookedRows,
      candidateRows,
      sentRows,
      skippedMissingLine,
      skippedAlreadySent,
      skippedOutsideWindow,
      skippedInvalidDateTime,
      rowErrors
    }, null, 2));

    Logger.log("END sendReminders");
  } catch (err) {
    logError_("sendReminders", err);
    throw err;
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}

function sendRemindersDryRunDetailed() {
  const sheet = getSheetOrThrow_(SHEET_NAMES.BOOKINGS);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    Logger.log("No bookings rows");
    return;
  }

  const headers = normalizeHeaders_(values[0]);
  const now = new Date();
  const result = [];

  for (let i = 1; i < values.length; i++) {
    const row = rowToObject(headers, values[i]);
    const status = normalizeStatus_(row.status);
    const reminderSent = String(row.reminder_sent || "").trim().toLowerCase();
    const dateStr = formatDateValue(row.date);
    const timeStr = formatTimeValue(row.time);
    const lineUserId = String(row.line_user_id || "").trim();

    let reason = "not_booked";
    let diffMinutes = null;

    if (status === "booked") {
      reason = "already_sent";

      if (reminderSent !== "yes") {
        reason = "missing_line_user_id";

        if (lineUserId) {
          reason = "invalid_datetime";

          const bookingDateTime = buildDateTime(dateStr, timeStr);
          if (!isNaN(bookingDateTime.getTime())) {
            diffMinutes = Number(((bookingDateTime.getTime() - now.getTime()) / 60000).toFixed(2));
            reason = "outside_window";

            if (diffMinutes <= REMINDER_WINDOW_MAX && diffMinutes > REMINDER_WINDOW_MIN) {
              reason = "will_send";
            }
          }
        }
      }
    }

    result.push({
      row: i + 1,
      customerName: String(row.customer_name || "").trim(),
      lineUserId: lineUserId ? maskMiddle_(lineUserId, 4, 4) : "",
      date: dateStr,
      time: timeStr,
      status,
      reminderSent,
      diffMinutes,
      reason
    });
  }

  Logger.log(JSON.stringify(result, null, 2));
}

/* =========================
   LINE PUSH
========================= */

function sendLinePush(to, messages) {
  const token = getChannelAccessToken_();

  if (!to) {
    throw new Error("Recipient ID is empty");
  }

  const url = "https://api.line.me/v2/bot/message/push";

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + token
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
  const ownerUserId = getOwnerUserIdOptional_();
  if (!ownerUserId) return;

  const text =
    "🔔 新しい予約\n" +
    "顧客: " + (data.name || "-") + "\n" +
    "サービス: " + (data.serviceName || "-") + "\n" +
    "担当: " + (data.staffName || "-") + "\n" +
    "日時: " + (data.date || "-") + " " + (data.time || "-") + "\n" +
    "電話: " + (data.phone || "-");

  sendLinePush(ownerUserId, [{
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
  const ownerUserId = getOwnerUserIdOptional_();
  if (!ownerUserId) return;

  const text =
    "📩 新しい導入相談\n" +
    "店舗名: " + (data.salonName || "-") + "\n" +
    "担当者: " + (data.ownerName || "-") + "\n" +
    "連絡先: " + (data.contact || "-") + "\n" +
    "業種: " + (data.businessType || "-") + "\n" +
    "相談内容: " + (data.needs || "-") + "\n" +
    "LINE名: " + (data.lineDisplayName || "-") + "\n" +
    "source: " + (data.source || "-");

  sendLinePush(ownerUserId, [{
    type: "text",
    text: text
  }]);
}

function notifyOwnerLeadLanding(data) {
  const ownerUserId = getOwnerUserIdOptional_();
  if (!ownerUserId) return;

  const text =
    "📩 新しい問い合わせ（LP）\n" +
    "名前: " + (data.name || "-") + "\n" +
    "店舗: " + (data.business || "-") + "\n" +
    "LINE: " + (data.line || "-") + "\n" +
    "Email: " + (data.email || "-") + "\n" +
    "内容: " + (data.message || "-") + "\n" +
    "source: " + (data.source || "-");

  sendLinePush(ownerUserId, [{
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
   DEBUG / TEST
========================= */

function testGetBookings() {
  const data = getBookings();
  Logger.log(JSON.stringify(data.slice(0, 3), null, 2));
}

function testSendReminderDryRun() {
  const bookings = getBookings()
    .filter(item => item.status === "booked")
    .slice(0, 5);

  Logger.log(JSON.stringify(bookings, null, 2));
}

function inspectBookingsHeaders() {
  const sheet = getSheetOrThrow_(SHEET_NAMES.BOOKINGS);
  const values = sheet.getDataRange().getValues();
  if (!values.length) {
    Logger.log("No headers");
    return;
  }
  Logger.log(JSON.stringify(normalizeHeaders_(values[0])));
}

function testLinePushToOwner() {
  const ownerUserId = getOwnerUserIdOptional_();
  if (!ownerUserId) {
    throw new Error("OWNER_USER_ID is not configured");
  }

  sendLinePush(ownerUserId, [{
    type: "text",
    text: "Test push from Apps Script"
  }]);

  Logger.log("Test push sent to owner");
}

/* =========================
   HELPERS
========================= */

function getParam_(e, key) {
  return e && e.parameter && e.parameter[key]
    ? String(e.parameter[key]).trim()
    : "";
}

function getSheetOrThrow_(sheetName) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`Sheet '${sheetName}' not found`);
  }
  return sheet;
}

function normalizeHeaders_(headers) {
  return headers.map(h => String(h || "").trim());
}

function findColumnIndex_(headers, columnName) {
  const index = headers.indexOf(String(columnName || "").trim());
  return index === -1 ? 0 : index + 1;
}

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
  const normalizedTime = normalizeTime(timeStr);
  const partsDate = String(dateStr || "").split("-").map(Number);
  const partsTime = normalizedTime.split(":").map(Number);

  const y = partsDate[0];
  const mo = partsDate[1];
  const d = partsDate[2];
  const h = partsTime[0];
  const mi = partsTime[1];

  if (!y || !mo || !d || isNaN(h) || isNaN(mi)) {
    return new Date("invalid");
  }

  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

function normalizeStatus_(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "completed") return "completed";
  if (s === "cancelled") return "cancelled";
  return "booked";
}

function logError_(scope, err) {
  const message = err && err.message ? err.message : String(err || "Unknown error");
  Logger.log("[" + scope + "] " + message);
  Logger.log(err && err.stack ? err.stack : "no stack");
}

function getScriptProp_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || "";
}

function getChannelAccessToken_() {
  const token = getScriptProp_(SCRIPT_PROP_KEYS.CHANNEL_ACCESS_TOKEN);
  if (!token) {
    throw new Error("CHANNEL_ACCESS_TOKEN is not configured in Script Properties");
  }
  return token;
}

function getOwnerUserIdOptional_() {
  return getScriptProp_(SCRIPT_PROP_KEYS.OWNER_USER_ID);
}

function maskMiddle_(value, left, right) {
  const str = String(value || "");
  if (!str) return "";
  if (str.length <= left + right) return str;
  return str.slice(0, left) + "***" + str.slice(-right);
}