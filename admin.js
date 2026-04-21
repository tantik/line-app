const CONFIG = {
  WEBHOOK_URL: "https://script.google.com/macros/s/AKfycbwJ6JgQWqmhp9Y7gWPKvr5l5IixbWuNRAsbJ0km6AQIGuUBlniZeDfOpqtkGds-pxzB/exec",
  CACHE_TTL_MS: 3 * 60 * 1000,
  AUTO_REFRESH_MS: 15000,
  NEW_BADGE_MS: 120000,
  SOUND_ENABLED: false
};

const CALENDAR_URL = `${CONFIG.WEBHOOK_URL}?action=calendar`;
const STAFF_URL = `${CONFIG.WEBHOOK_URL}?action=staff`;
const SERVICES_URL = `${CONFIG.WEBHOOK_URL}?action=services`;

let calendarItems = [];
let staff = [];
let services = [];
let currentMode = "day";

let lastCalendarHash = "";
let knownBookingIds = new Set();
let firstAutoLoadDone = false;
let isUpdatingStatus = false;

const cacheStore = {
  calendar: { data: null, ts: 0 },
  staff: { data: null, ts: 0 },
  services: { data: null, ts: 0 }
};

const audio = CONFIG.SOUND_ENABLED
  ? new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg")
  : null;

async function init() {
  const dateInput = document.getElementById("selectedDate");
  dateInput.value = getToday();

  document.getElementById("modeDayBtn").addEventListener("click", () => switchMode("day"));
  document.getElementById("modeWeekBtn").addEventListener("click", () => switchMode("week"));

  dateInput.addEventListener("change", renderCalendar);
  document.getElementById("staffFilter").addEventListener("change", renderCalendar);
  document.getElementById("serviceFilter").addEventListener("change", renderCalendar);

  document.getElementById("todayBtn").addEventListener("click", () => {
    dateInput.value = getToday();
    currentMode = "day";
    syncModeButtons();
    renderCalendar();
  });

  document.getElementById("tomorrowBtn").addEventListener("click", () => {
    dateInput.value = getRelativeDate(1);
    currentMode = "day";
    syncModeButtons();
    renderCalendar();
  });

  document.getElementById("thisWeekBtn").addEventListener("click", () => {
    dateInput.value = getToday();
    currentMode = "week";
    syncModeButtons();
    renderCalendar();
  });

  document.getElementById("refreshBtn").addEventListener("click", async () => {
    await refreshAllData(true);
  });

  setLoading(true, "読み込み中...", "予約データを準備しています");

  try {
    await Promise.all([
      loadCalendar(true),
      loadStaff(true),
      loadServices(true)
    ]);

    fillFilters();
    initializeKnownBookings(calendarItems);
    lastCalendarHash = generateHash(calendarItems);

    renderCalendar();
    updateLastUpdated();
    syncModeButtons();
    firstAutoLoadDone = true;

    startAutoRefresh();
  } catch (err) {
    console.log("init error:", err);
    renderErrorState("データの読み込みに失敗しました");
  } finally {
    setLoading(false);
  }
}

function setLoading(show, title = "読み込み中...", text = "少々お待ちください") {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;

  const titleEl = overlay.querySelector(".loading-title");
  const textEl = overlay.querySelector(".loading-text");

  if (titleEl) titleEl.textContent = title;
  if (textEl) textEl.textContent = text;

  overlay.classList.toggle("active", !!show);
}

function getCache(key) {
  const item = cacheStore[key];
  if (!item || !item.data) return null;
  if (Date.now() - item.ts > CONFIG.CACHE_TTL_MS) return null;
  return item.data;
}

function setCache(key, data) {
  cacheStore[key] = {
    data: Array.isArray(data) ? deepClone(data) : data,
    ts: Date.now()
  };
}

async function fetchJson(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();

  if (method === "GET") {
    const sep = url.includes("?") ? "&" : "?";
    url = `${url}${sep}_ts=${Date.now()}`;
  }

  const res = await fetch(url, {
    cache: "no-store",
    ...options
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadCalendar(useCache = true) {
  const cached = useCache ? getCache("calendar") : null;
  if (cached) {
    calendarItems = deepClone(cached);
    return;
  }

  calendarItems = await fetchJson(CALENDAR_URL);
  setCache("calendar", calendarItems);
}

async function loadStaff(useCache = true) {
  const cached = useCache ? getCache("staff") : null;
  if (cached) {
    staff = deepClone(cached);
    return;
  }

  staff = await fetchJson(STAFF_URL);
  setCache("staff", staff);
}

async function loadServices(useCache = true) {
  const cached = useCache ? getCache("services") : null;
  if (cached) {
    services = deepClone(cached);
    return;
  }

  services = await fetchJson(SERVICES_URL);
  setCache("services", services);
}

async function refreshAllData(showOverlay = false) {
  if (showOverlay) {
    setLoading(true, "更新中...", "最新の予約データを取得しています");
  }

  try {
    const oldItems = deepClone(calendarItems);

    await Promise.all([
      loadCalendar(false),
      loadStaff(false),
      loadServices(false)
    ]);

    fillFilters(true);
    detectNewBookings(oldItems, calendarItems);
    renderCalendar();
    updateLastUpdated();

    lastCalendarHash = generateHash(calendarItems);
  } catch (err) {
    console.log("refresh error:", err);
    if (showOverlay) alert("更新に失敗しました");
  } finally {
    if (showOverlay) setLoading(false);
  }
}

function startAutoRefresh() {
  setInterval(async () => {
    if (isUpdatingStatus) return;
    if (document.hidden) return;

    try {
      const oldItems = deepClone(calendarItems);
      await loadCalendar(false);

      const newHash = generateHash(calendarItems);
      if (newHash === lastCalendarHash) return;

      const newCount = detectNewBookings(oldItems, calendarItems);

      renderCalendar();
      updateLastUpdated(true);

      if (newCount > 0 && firstAutoLoadDone) {
        showToast(`新しい予約が ${newCount} 件追加されました`);
        playNotificationSound();
      }

      lastCalendarHash = newHash;
    } catch (e) {
      console.log("auto refresh error", e);
    }
  }, CONFIG.AUTO_REFRESH_MS);
}

function switchMode(mode) {
  currentMode = mode;
  syncModeButtons();
  renderCalendar();
}

function syncModeButtons() {
  document.getElementById("modeDayBtn").classList.toggle("active", currentMode === "day");
  document.getElementById("modeWeekBtn").classList.toggle("active", currentMode === "week");
  document.getElementById("modeLabel").textContent = currentMode === "day" ? "日表示" : "週表示";
}

function fillFilters(keepValues = false) {
  const staffFilter = document.getElementById("staffFilter");
  const serviceFilter = document.getElementById("serviceFilter");

  const prevStaff = keepValues ? staffFilter.value : "";
  const prevService = keepValues ? serviceFilter.value : "";

  staffFilter.innerHTML = `<option value="">全スタッフ</option>`;
  serviceFilter.innerHTML = `<option value="">全サービス</option>`;

  [...staff]
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    .forEach(member => {
      const option = document.createElement("option");
      option.value = member.name;
      option.textContent = member.name;
      staffFilter.appendChild(option);
    });

  [...services]
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    .forEach(service => {
      const option = document.createElement("option");
      option.value = service.name;
      option.textContent = service.name;
      serviceFilter.appendChild(option);
    });

  if (keepValues) {
    staffFilter.value = prevStaff;
    serviceFilter.value = prevService;
  }
}

function renderCalendar() {
  const container = document.getElementById("calendarContainer");
  container.innerHTML = "";
  container.classList.remove("grid-layout");

  const selectedDate = document.getElementById("selectedDate").value;
  const staffFilter = document.getElementById("staffFilter").value;
  const serviceFilter = document.getElementById("serviceFilter").value;

  let filtered = [...calendarItems];

  if (currentMode === "day") {
    filtered = filtered.filter(item => item.date === selectedDate);
    document.getElementById("rangeLabel").textContent = `表示範囲: ${formatDayTitle(selectedDate)}`;
  } else {
    const weekDates = getWeekDates(selectedDate);
    filtered = filtered.filter(item => weekDates.includes(item.date));
    document.getElementById("rangeLabel").textContent =
      `表示範囲: ${formatDayTitle(weekDates[0])} - ${formatDayTitle(weekDates[6])}`;
  }

  if (staffFilter) {
    filtered = filtered.filter(item => item.staffName === staffFilter);
  }

  if (serviceFilter) {
    filtered = filtered.filter(item => item.serviceName === serviceFilter);
  }

  filtered.sort((a, b) => {
    const aa = `${a.date} ${a.time}`;
    const bb = `${b.date} ${b.time}`;
    return aa.localeCompare(bb);
  });

  updateSummary(filtered);

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-box">
        条件に一致する予約はありません
      </div>
    `;
    return;
  }

  if (window.innerWidth >= 1024 && currentMode === "day") {
    container.classList.add("grid-layout");
  }

  if (currentMode === "day") {
    renderDayView(container, filtered);
  } else {
    renderWeekView(container, filtered, selectedDate);
  }
}

function renderDayView(container, items) {
  const grouped = groupByStaff(items);
  const sortedStaff = [...staff].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  sortedStaff.forEach(member => {
    const bookings = grouped[member.name] || [];
    if (!bookings.length) return;
    container.appendChild(createMasterSection(member, bookings, false));
  });
}

function renderWeekView(container, items, selectedDate) {
  const weekDates = getWeekDates(selectedDate);

  weekDates.forEach(date => {
    const itemsForDay = items.filter(item => item.date === date);
    if (!itemsForDay.length) return;

    const dayBlock = document.createElement("section");
    dayBlock.className = "section-day";

    dayBlock.innerHTML = `<div class="day-title">${formatDayTitle(date)}</div>`;

    const grouped = groupByStaff(itemsForDay);
    const sortedStaff = [...staff].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

    sortedStaff.forEach(member => {
      const bookings = grouped[member.name] || [];
      if (!bookings.length) return;
      dayBlock.appendChild(createMasterSection(member, bookings, true));
    });

    container.appendChild(dayBlock);
  });
}

function createMasterSection(member, bookings, showDateChip) {
  const section = document.createElement("section");
  section.className = "master-section";

  section.innerHTML = `
    <div class="master-head">
      <img src="${escapeAttr(member.photoUrl || "")}" alt="${escapeAttr(member.name || "")}" class="master-photo" />
      <div>
        <h2 class="master-name">${escapeHtml(member.name || "-")}</h2>
        <p class="master-sub">${escapeHtml(member.startTime || "-")} - ${escapeHtml(member.endTime || "-")}</p>
      </div>
      <div class="master-count">${bookings.length}件</div>
    </div>
    <div class="booking-list">
      ${bookings.map(item => renderBookingCard(item, showDateChip)).join("")}
    </div>
  `;

  bindActionButtons(section, bookings);
  return section;
}

function renderBookingCard(item, showDateChip) {
  const isNew = isNewBooking(item);
  const status = normalizeStatus(item.status);
  const confirmationStatus = normalizeConfirmationStatus(item.confirmationStatus);
  const statusClass = status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "booked";

  const cardClass = status === "completed"
    ? "status-completed"
    : status === "cancelled"
      ? "status-cancelled"
      : "";

  const bookingId = getBookingId(item);

  return `
    <div class="booking-card ${isNew ? "new" : ""} ${cardClass}">
      <div class="booking-top">
        <div>
          <div class="booking-time">
            ${escapeHtml(item.time || "-")}
            ${isNew ? `<span class="booking-badge-new">NEW</span>` : ""}
          </div>
          <div class="booking-duration">${escapeHtml(String(item.duration || "-"))}分</div>
        </div>
        <div class="booking-service">${escapeHtml(item.serviceName || "-")}</div>
      </div>

      <div class="booking-row"><span>顧客:</span> ${escapeHtml(item.customerName || "-")}</div>
      <div class="booking-row"><span>電話:</span> ${escapeHtml(item.phone || "-")}</div>

      <div class="booking-footer">
        <div class="booking-status-group">
          <div class="booking-status ${statusClass}">${getStatusLabel(status)}</div>
          <div class="confirmation-chip ${confirmationStatus}">${getConfirmationLabel(confirmationStatus)}</div>
        </div>
        ${showDateChip ? `<div class="booking-date-chip">${escapeHtml(formatDayTitle(item.date))}</div>` : ``}
      </div>

      <div class="booking-actions">
        ${status !== "completed" ? `
          <button class="action-btn complete"
            type="button"
            data-action="completed"
            data-booking-id="${escapeAttr(bookingId)}">
            完了
          </button>
        ` : ""}

        ${status !== "cancelled" ? `
          <button class="action-btn cancel"
            type="button"
            data-action="cancelled"
            data-booking-id="${escapeAttr(bookingId)}">
            キャンセル
          </button>
        ` : ""}

        ${status !== "booked" ? `
          <button class="action-btn restore"
            type="button"
            data-action="booked"
            data-booking-id="${escapeAttr(bookingId)}">
            予約済みに戻す
          </button>
        ` : ""}
      </div>
    </div>
  `;
}

function bindActionButtons(section, bookings) {
  const buttons = section.querySelectorAll(".action-btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", async () => {
      const bookingId = btn.dataset.bookingId;
      const nextStatus = btn.dataset.action;

      const targetBooking = bookings.find(item => getBookingId(item) === bookingId);
      if (!targetBooking) return;

      const confirmText = nextStatus === "completed"
        ? "この予約を完了にしますか？"
        : nextStatus === "cancelled"
          ? "この予約をキャンセルにしますか？"
          : "この予約を予約済みに戻しますか？";

      if (!confirm(confirmText)) return;

      await updateBookingStatus(targetBooking, nextStatus);
    });
  });
}

async function updateBookingStatus(booking, nextStatus) {
  if (isUpdatingStatus) return;

  try {
    isUpdatingStatus = true;
    disableActionButtons(true);

    setLoading(true, "更新中...", "予約ステータスを更新しています");

    const payload = {
      mode: "update_status",
      bookingId: getBookingId(booking),
      date: booking.date || "",
      time: booking.time || "",
      customerName: booking.customerName || "",
      staffName: booking.staffName || "",
      serviceName: booking.serviceName || "",
      nextStatus: nextStatus
    };

    const result = await fetchJson(CONFIG.WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload)
    });

    if (result.status !== "success") {
      throw new Error(result.message || "status update failed");
    }

    await refreshAllData(false);
    showToast(getStatusToastText(nextStatus));
  } catch (err) {
    console.log("updateBookingStatus error", err);
    alert("ステータス更新に失敗しました");
  } finally {
    disableActionButtons(false);
    setLoading(false);
    isUpdatingStatus = false;
  }
}

function disableActionButtons(disabled) {
  document.querySelectorAll(".action-btn").forEach(btn => {
    btn.disabled = disabled;
  });
}

function updateSummary(items) {
  const bookingCount = items.length;
  const uniqueStaff = new Set(items.map(item => item.staffName).filter(Boolean)).size;
  const avg = bookingCount
    ? Math.round(items.reduce((sum, item) => sum + Number(item.duration || 0), 0) / bookingCount)
    : 0;

  document.getElementById("bookingCount").textContent = bookingCount;
  document.getElementById("staffCount").textContent = uniqueStaff;
  document.getElementById("avgDuration").textContent = `${avg}分`;
}

function groupByStaff(items) {
  return items.reduce((acc, item) => {
    const key = item.staffName || "Unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

function updateLastUpdated(isAuto = false) {
  const now = new Date();
  const el = document.getElementById("lastUpdated");
  el.textContent = `最終更新: ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  if (isAuto) {
    el.style.color = "#ffffff";
    el.style.opacity = "1";
    setTimeout(() => {
      el.style.opacity = "0.75";
    }, 1800);
  }
}

function renderErrorState(text) {
  document.getElementById("calendarContainer").innerHTML = `
    <div class="empty-box">${escapeHtml(text)}</div>
  `;
}

function getToday() {
  return formatDate(new Date());
}

function getRelativeDate(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return formatDate(d);
}

function getWeekDates(dateStr) {
  const date = new Date(dateStr + "T00:00:00");
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diff);

  const result = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    result.push(formatDate(d));
  }
  return result;
}

function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

function formatDayTitle(dateStr) {
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const d = new Date(dateStr + "T00:00:00");
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  return `${mm}/${dd}（${weekdays[d.getDay()]}）`;
}

function pad(num) {
  return String(num).padStart(2, "0");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function deepClone(data) {
  return JSON.parse(JSON.stringify(data));
}

function generateHash(data) {
  return JSON.stringify(
    [...data].sort((a, b) => getBookingId(a).localeCompare(getBookingId(b)))
  );
}

function getBookingId(item) {
  return [
    item.date || "",
    item.time || "",
    item.staffName || "",
    item.customerName || "",
    item.serviceName || ""
  ].join("|");
}

function initializeKnownBookings(items) {
  knownBookingIds = new Set(items.map(getBookingId));
}

function detectNewBookings(oldItems, newItems) {
  const oldMap = new Map(oldItems.map(item => [getBookingId(item), item]));
  const nextKnown = new Set();
  let newCount = 0;

  newItems.forEach(item => {
    const id = getBookingId(item);
    const oldItem = oldMap.get(id);
    nextKnown.add(id);

    if (!knownBookingIds.has(id)) {
      item.__newUntil = Date.now() + CONFIG.NEW_BADGE_MS;
      newCount++;
    } else if (oldItem && oldItem.__newUntil && !item.__newUntil) {
      item.__newUntil = oldItem.__newUntil;
    }
  });

  knownBookingIds = nextKnown;
  return newCount;
}

function isNewBooking(item) {
  return !!item.__newUntil && Date.now() < item.__newUntil;
}

function normalizeStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "completed") return "completed";
  if (s === "cancelled") return "cancelled";
  return "booked";
}

function normalizeConfirmationStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "confirmed") return "confirmed";
  if (s === "risk") return "risk";
  if (s === "pending") return "pending";
  return "none";
}

function getStatusLabel(status) {
  if (status === "completed") return "完了";
  if (status === "cancelled") return "キャンセル";
  return "予約済み";
}

function getConfirmationLabel(status) {
  if (status === "confirmed") return "確認済み";
  if (status === "risk") return "要確認";
  if (status === "pending") return "未確認";
  return "確認なし";
}

function getStatusToastText(status) {
  if (status === "completed") return "予約を完了にしました";
  if (status === "cancelled") return "予約をキャンセルにしました";
  return "予約を予約済みに戻しました";
}

function showToast(message) {
  const toast = document.getElementById("toast");
  const text = document.getElementById("toastText");
  const title = toast.querySelector(".toast-title");

  title.textContent = "通知";
  text.textContent = message;
  toast.classList.add("show");

  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3200);
}

function playNotificationSound() {
  if (!audio) return;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

init();