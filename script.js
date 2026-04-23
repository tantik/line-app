const CONFIG = {
  LIFF_ID: "2009586903-hyNXZaW7",
  WEBHOOK_URL:
    "https://script.google.com/macros/s/AKfycbwJ6JgQWqmhp9Y7gWPKvr5l5IixbWuNRAsbJ0km6AQIGuUBlniZeDfOpqtkGds-pxzB/exec",
  DATE_RANGE_DAYS: 60,
  INITIAL_VISIBLE_DAYS: 14,
  LOAD_MORE_DAYS_STEP: 14,
  TIME_STEP_MINUTES: 30,
  SAME_DAY_BLOCK_MINUTES: 20,
  CACHE_TTL_MS: 3 * 60 * 1000,
};

const SERVICES_URL = `${CONFIG.WEBHOOK_URL}?action=services`;
const STAFF_URL = `${CONFIG.WEBHOOK_URL}?action=staff`;
const BOOKINGS_URL = `${CONFIG.WEBHOOK_URL}?action=bookings`;

const cacheStore = {
  services: { data: null, ts: 0 },
  staff: { data: null, ts: 0 },
  bookings: { data: null, ts: 0 },
};

let userId = "";
let displayName = "";

let services = [];
let staff = [];
let bookings = [];

let selectedService = null;
let selectedStaff = null;
let selectedDate = "";
let selectedTime = "";

let visibleDaysCount = CONFIG.INITIAL_VISIBLE_DAYS;
let initDone = false;

document.addEventListener("DOMContentLoaded", () => {
  bindStaticEvents();
  init();
});

/* -------------------- init -------------------- */

async function init() {
  if (initDone) return;
  initDone = true;

  setLoading(true, "読み込み中...", "予約情報を準備しています");

  try {
    const isLocalhost =
      location.hostname === "127.0.0.1" ||
      location.hostname === "localhost";

    if (isLocalhost) {
      console.log("DEV MODE: localhost detected, LINE login bypass enabled");
      userId = "dev-user";
      displayName = "Dev User";

      fillInitialProfileFields();
      bindPhoneInput();

      await Promise.all([loadServices(true), loadStaff(true)]);
      renderAllBookingState();
      showScreen("screenWelcome");
      startBookingsPrefetch();
      return;
    }

    await liff.init({ liffId: CONFIG.LIFF_ID });

    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }

    const profile = await liff.getProfile();
    userId = profile?.userId || "";
    displayName = profile?.displayName || "";

    fillInitialProfileFields();
    bindPhoneInput();

    await Promise.all([loadServices(true), loadStaff(true)]);
    renderAllBookingState();
    showScreen("screenWelcome");
    startBookingsPrefetch();
  } catch (error) {
    console.log("LIFF init error:", error);
    alert("初期化エラーが発生しました");
  } finally {
    setLoading(false);
  }
}

function fillInitialProfileFields() {
  const nameInput = document.getElementById("name");
  if (nameInput) nameInput.value = displayName || "";

  const leadOwnerName = document.getElementById("leadOwnerName");
  if (leadOwnerName) leadOwnerName.value = displayName || "";
}

/* -------------------- bindings -------------------- */

function bindStaticEvents() {
  document.getElementById("btnStartDemo")?.addEventListener("click", startDemoFlow);
  document.getElementById("btnOpenInfo")?.addEventListener("click", () => showScreen("screenInfo"));
  document.getElementById("btnOpenLead")?.addEventListener("click", openLeadScreen);
  document.getElementById("btnOpenAdmin")?.addEventListener("click", openAdminDemo);

  document.getElementById("btnInfoStartDemo")?.addEventListener("click", startDemoFlow);
  document.getElementById("btnSubmitLead")?.addEventListener("click", submitLeadForm);

  document.getElementById("btnClearStaffInline")?.addEventListener("click", () => {
    selectedStaff = null;
    selectedTime = "";
    reconcileSelectionState();
    renderAllBookingState();
  });

  document.getElementById("btnGoDateTime")?.addEventListener("click", goDateTimeStep);
  document.getElementById("btnGoConfirm")?.addEventListener("click", goConfirmStep);
  document.getElementById("btnSubmitBooking")?.addEventListener("click", submitBooking);

  document.getElementById("btnSuccessLead")?.addEventListener("click", openLeadScreen);
  document.getElementById("btnSuccessRestart")?.addEventListener("click", resetAndGoWelcome);

  document.getElementById("loadMoreDatesBtn")?.addEventListener("click", loadMoreDates);

  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-back");
      if (target) showScreen(target);
    });
  });
}

/* -------------------- screen nav -------------------- */

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });

  const target = document.getElementById(id);
  if (target) {
    target.classList.add("active");
    target.scrollTop = 0;
  }
}

function openAdminDemo() {
  window.location.href = "./admin.html";
}

function openLeadScreen() {
  const leadOwnerName = document.getElementById("leadOwnerName");
  if (leadOwnerName && !leadOwnerName.value) {
    leadOwnerName.value = displayName || "";
  }
  showScreen("screenLead");
}

/* -------------------- loading / toast -------------------- */

function setLoading(show, title = "読み込み中...", text = "少々お待ちください") {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;

  const titleEl = overlay.querySelector(".loading-title");
  const textEl = overlay.querySelector(".loading-text");

  if (titleEl) titleEl.textContent = title;
  if (textEl) textEl.textContent = text;

  overlay.classList.toggle("active", !!show);
}

function setInlineTimeLoading(show, text = "空き状況を確認中...") {
  const box = document.getElementById("inlineTimeLoading");
  if (!box) return;

  box.style.display = show ? "flex" : "none";
  const textNode = box.querySelector("div:last-child");
  if (textNode) textNode.textContent = text;
}

function toast(message) {
  const old = document.querySelector(".toast");
  if (old) old.remove();

  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);

  setTimeout(() => {
    el.remove();
  }, 2500);
}

/* -------------------- cache / fetch -------------------- */

function getCache(key) {
  const item = cacheStore[key];
  if (!item || !item.data) return null;
  if (Date.now() - item.ts > CONFIG.CACHE_TTL_MS) return null;
  return item.data;
}

function setCache(key, data) {
  cacheStore[key] = {
    data: Array.isArray(data) ? [...data] : data,
    ts: Date.now(),
  };
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadServices(useCache = true) {
  try {
    const cached = useCache ? getCache("services") : null;
    if (cached) {
      services = cached;
      return;
    }
    services = await fetchJson(SERVICES_URL);
    setCache("services", services);
  } catch (e) {
    console.log("Services load error:", e);
    services = [];
  }
}

async function loadStaff(useCache = true) {
  try {
    const cached = useCache ? getCache("staff") : null;
    if (cached) {
      staff = cached;
      return;
    }
    staff = await fetchJson(STAFF_URL);
    setCache("staff", staff);
  } catch (e) {
    console.log("Staff load error:", e);
    staff = [];
  }
}

async function ensureBookingsLoaded(force = false, silent = false) {
  try {
    const cached = !force ? getCache("bookings") : null;
    if (cached) {
      bookings = cached;
      return;
    }

    if (!silent) setInlineTimeLoading(true, "空き状況を確認中...");
    bookings = await fetchJson(BOOKINGS_URL);
    setCache("bookings", bookings);
  } catch (e) {
    console.log("Bookings load error:", e);
    bookings = [];
  } finally {
    if (!silent) setInlineTimeLoading(false);
  }
}

function startBookingsPrefetch() {
  setTimeout(async () => {
    try {
      await ensureBookingsLoaded(false, true);
    } catch (e) {
      console.log("Prefetch bookings error:", e);
    }
  }, 500);
}

/* -------------------- state helpers -------------------- */

function startDemoFlow() {
  clearBookingState();

  const nameInput = document.getElementById("name");
  const phoneInput = document.getElementById("phone");

  if (nameInput) nameInput.value = displayName || "";
  if (phoneInput) phoneInput.value = "";

  renderAllBookingState();
  showScreen("screenBookingStep1");
}

function resetAndGoWelcome() {
  clearBookingState();
  renderAllBookingState();
  showScreen("screenWelcome");
}

function clearBookingState() {
  selectedService = null;
  selectedStaff = null;
  selectedDate = "";
  selectedTime = "";
  visibleDaysCount = CONFIG.INITIAL_VISIBLE_DAYS;
}

function reconcileSelectionState() {
  // 1) If selected service is incompatible with selected staff, clear staff and time
  if (
    selectedService &&
    selectedStaff &&
    !staffCanDoService(selectedStaff, selectedService.serviceId)
  ) {
    selectedStaff = null;
    selectedTime = "";
  }

  // 2) If selected staff exists but selected date is not their workday, clear date/time
  if (selectedStaff && selectedDate && !isStaffWorkingOnDate(selectedStaff, selectedDate)) {
    selectedDate = "";
    selectedTime = "";
  }

  // 3) If selected date exists but no candidate staff can work that date for selected service, clear date/time
  if (selectedDate && selectedService && !isDateSelectable(selectedDate)) {
    selectedDate = "";
    selectedTime = "";
  }

  // 4) If selected time exists but selected staff cannot do that slot, clear time
  if (selectedTime && selectedDate && selectedService && selectedStaff) {
    const duration = Number(selectedService.duration || 0);
    if (!isStaffAvailable(selectedStaff, selectedDate, selectedTime, duration)) {
      selectedTime = "";
    }
  }

  // 5) If selected time exists and selected staff is empty, keep time but ensure at least one staff can do it
  if (selectedTime && selectedDate && selectedService && !selectedStaff) {
    const duration = Number(selectedService.duration || 0);
    const anyAvailable = getCandidateStaffForSelectedService().some((member) =>
      isStaffAvailable(member, selectedDate, selectedTime, duration)
    );
    if (!anyAvailable) {
      selectedTime = "";
    }
  }
}

function renderAllBookingState() {
  renderStep1();
  renderDateOptions();

  if (selectedDate) {
    renderTimeOptions();
    renderStaffStep2();
  } else {
    renderStep2IdleState();
  }

  updateSummary();
}

/* -------------------- phone helpers -------------------- */

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.includes("+")) {
    cleaned = (cleaned.startsWith("+") ? "+" : "") + cleaned.replace(/\+/g, "");
  }
  return cleaned;
}

function isValidPhone(value) {
  const normalized = normalizePhone(value);
  const digitsOnly = normalized.replace(/\D/g, "");
  return digitsOnly.length >= 10 && digitsOnly.length <= 15;
}

function bindPhoneInput() {
  const phoneInput = document.getElementById("phone");
  if (!phoneInput) return;

  phoneInput.addEventListener("input", () => {
    phoneInput.value = normalizePhone(phoneInput.value);
  });
}

/* -------------------- step routing -------------------- */

function goDateTimeStep() {
  if (!selectedService) {
    alert("サービスを選択してください");
    return;
  }

  reconcileSelectionState();
  renderAllBookingState();
  showScreen("screenBookingStep2");
}

async function goConfirmStep() {
  if (!selectedService || !selectedDate || !selectedTime || !selectedStaff) {
    alert("サービス・担当者・日付・時間を選択してください");
    return;
  }

  await ensureBookingsLoaded(false);

  const duration = Number(selectedService.duration || 0);
  if (!isStaffAvailable(selectedStaff, selectedDate, selectedTime, duration)) {
    selectedTime = "";
    reconcileSelectionState();
    renderAllBookingState();
    alert("選択した時間が埋まっていました。もう一度お選びください。");
    return;
  }

  document.getElementById("confirmService").textContent =
    `${selectedService.name} ¥${selectedService.price}`;
  document.getElementById("confirmStaff").textContent = selectedStaff.name || "-";
  document.getElementById("confirmDate").textContent = selectedDate || "-";
  document.getElementById("confirmTime").textContent = selectedTime || "-";

  showScreen("screenBookingStep3");
}

/* -------------------- derived data -------------------- */

function getCandidateServicesForSelectedStaff() {
  if (!selectedStaff) return [...services];
  return services.filter((service) =>
    staffCanDoService(selectedStaff, service.serviceId)
  );
}

function getCandidateStaffForSelectedService() {
  if (!selectedService) return [...staff];
  return staff.filter((member) =>
    staffCanDoService(member, selectedService.serviceId)
  );
}

/* -------------------- step 1 render -------------------- */

function renderStep1() {
  renderServices();
  renderStaffStep1();
}

function renderServices() {
  const el = document.getElementById("servicesList");
  if (!el) return;

  el.innerHTML = "";

  const filtered = getCandidateServicesForSelectedStaff();

  filtered.forEach((service) => {
    const card = document.createElement("div");
    card.className = "service-card";

    if (
      selectedService &&
      String(selectedService.serviceId) === String(service.serviceId)
    ) {
      card.classList.add("active");
    }

    const imageUrl = service.image || service.imageUrl || service.photo || "";
    const visual = imageUrl
      ? `<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(service.name || "")}" style="width:100%;height:100%;object-fit:cover;">`
      : `<span>${escapeHtml(getServiceVisual(service.name))}</span>`;

    card.innerHTML = `
      <div class="service-card-media">${visual}</div>
      <div class="service-card-body">
        <div class="service-card-label">✂ サービス</div>
        <h3 class="service-card-name">${escapeHtml(service.name || "-")}</h3>
        <div class="service-card-meta">${escapeHtml(String(service.duration || 0))}分</div>
        <div class="service-card-price">¥${escapeHtml(String(service.price || 0))}</div>
      </div>
    `;

    card.addEventListener("click", () => {
      const isSame =
        selectedService &&
        String(selectedService.serviceId) === String(service.serviceId);

      selectedService = isSame ? null : service;

      // Changing service can invalidate staff/date/time
      if (
        selectedStaff &&
        selectedService &&
        !staffCanDoService(selectedStaff, selectedService.serviceId)
      ) {
        selectedStaff = null;
      }

      selectedTime = "";
      reconcileSelectionState();
      renderAllBookingState();
    });

    el.appendChild(card);
  });

  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state">この担当者が対応できるサービスがありません</div>`;
  }
}

function renderStaffStep1() {
  const box = document.getElementById("staffList");
  if (!box) return;

  box.innerHTML = "";
  box.className = "staff-gallery";

  const filtered = getCandidateStaffForSelectedService();

  filtered.forEach((member) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "staff-card";

    if (
      selectedStaff &&
      String(member.staffId) === String(selectedStaff.staffId)
    ) {
      card.classList.add("active");
    }

    const imageUrl = member.image || member.imageUrl || member.photo || "";
    const avatar = imageUrl
      ? `<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(member.name || "")}">`
      : `<div class="staff-initial">${escapeHtml((member.name || "S").slice(0, 1))}</div>`;

    card.innerHTML = `
      <div class="staff-avatar">${avatar}</div>
      <div class="staff-name">${escapeHtml(member.name || "-")}</div>
      <div class="staff-hours">${escapeHtml(member.startTime || "-")} - ${escapeHtml(member.endTime || "-")}</div>
    `;

    card.addEventListener("click", () => {
      const isSame =
        selectedStaff &&
        String(member.staffId) === String(selectedStaff.staffId);

      selectedStaff = isSame ? null : member;
      selectedTime = "";

      reconcileSelectionState();
      renderAllBookingState();
    });

    box.appendChild(card);
  });

  if (!filtered.length) {
    box.className = "empty-state";
    box.innerHTML = `このサービスに対応できる担当者がいません`;
  }
}

/* -------------------- dates -------------------- */

function renderDateOptions() {
  const box = document.getElementById("dateList");
  const countLabel = document.getElementById("dateCountLabel");
  const moreBtn = document.getElementById("loadMoreDatesBtn");
  if (!box) return;

  box.innerHTML = "";

  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const today = new Date();
  const count = Math.min(visibleDaysCount, CONFIG.DATE_RANGE_DAYS);

  for (let i = 0; i < count; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const value = `${yyyy}-${mm}-${dd}`;

    const item = document.createElement("div");
    item.className = "date-item";
    if (value === selectedDate) item.classList.add("active");

    const available = isDateSelectable(value);
    if (!available) item.classList.add("disabled");

    item.innerHTML = `
      <div class="date-item-day">${weekdays[d.getDay()]}</div>
      <div class="date-item-date">${mm}/${dd}</div>
    `;

    item.addEventListener("click", async () => {
      if (!available) return;

      const isSameDate = selectedDate === value;
      selectedDate = isSameDate ? "" : value;
      selectedTime = "";

      renderDateOptions();

      if (!selectedDate) {
        renderStep2IdleState();
        updateSummary();
        return;
      }

      const slotHint = document.getElementById("slotHint");
      if (slotHint) slotHint.textContent = "空き状況を確認しています";

      setInlineTimeLoading(true, "空き状況を確認中...");
      await ensureBookingsLoaded(false);
      setInlineTimeLoading(false);

      if (slotHint) slotHint.textContent = "時間を選択してください";

      reconcileSelectionState();
      renderTimeOptions();
      renderStaffStep2();
      updateSummary();
    });

    box.appendChild(item);
  }

  if (countLabel) countLabel.textContent = `${count}日表示`;
  if (moreBtn) {
    moreBtn.classList.toggle("hidden", count >= CONFIG.DATE_RANGE_DAYS);
  }
}

function isDateSelectable(dateValue) {
  if (!selectedService) return true;

  const candidates = selectedStaff
    ? staff.filter((m) => String(m.staffId) === String(selectedStaff.staffId))
    : getCandidateStaffForSelectedService();

  if (!candidates.length) return false;

  return candidates.some((member) => isStaffWorkingOnDate(member, dateValue));
}

function loadMoreDates() {
  visibleDaysCount = Math.min(
    visibleDaysCount + CONFIG.LOAD_MORE_DAYS_STEP,
    CONFIG.DATE_RANGE_DAYS
  );
  renderDateOptions();
}

/* -------------------- step 2 idle -------------------- */

function renderStep2IdleState() {
  const timeBox = document.getElementById("timeList");
  const staffBox = document.getElementById("staffListStep2");
  const slotHint = document.getElementById("slotHint");

  if (slotHint) slotHint.textContent = "日付を選択してください";

  if (timeBox) {
    timeBox.innerHTML = `先に日付を選択してください`;
    timeBox.classList.add("empty-state");
  }

  if (staffBox) {
    if (!selectedService) {
      staffBox.innerHTML = `先にサービスを選択してください`;
    } else {
      staffBox.innerHTML = `時間を選ぶと表示されます`;
    }
    staffBox.className = "empty-state";
  }
}

/* -------------------- times -------------------- */

function renderTimeOptions() {
  const box = document.getElementById("timeList");
  const slotHint = document.getElementById("slotHint");
  if (!box) return;

  box.classList.remove("empty-state");
  box.innerHTML = "";

  if (!selectedDate || !selectedService) {
    renderStep2IdleState();
    return;
  }

  if (slotHint) slotHint.textContent = "時間を選択してください";

  const duration = Number(selectedService.duration || 0);

  let candidates = getCandidateStaffForSelectedService();

  if (selectedStaff) {
    candidates = candidates.filter(
      (m) => String(m.staffId) === String(selectedStaff.staffId)
    );
  }

  const start = getEarliestStart(candidates);
  const end = getLatestEnd(candidates);

  if (start === null || end === null) {
    box.innerHTML = `対応可能な担当者がいません`;
    box.classList.add("empty-state");
    return;
  }

  let hasAny = false;
  let current = start;

  while (current + duration <= end) {
    const time = minutesToTime(current);
    const item = document.createElement("div");
    item.className = "time-item";

    const available = isAnyStaffAvailableAtTime(time, duration);
    const blocked = isTimeBlockedByNow(selectedDate, time);

    let status = "空き";
    if (!available || blocked) {
      item.classList.add("disabled");
      status = "不可";
    }

    if (time === selectedTime) item.classList.add("active");

    item.innerHTML = `
      <div class="time-main">${time}</div>
      <div class="time-sub">${status}</div>
    `;

    item.addEventListener("click", () => {
      if (!available || blocked) return;

      const isSame = selectedTime === time;
      selectedTime = isSame ? "" : time;

      // If selected staff cannot do the newly selected time, clear staff
      if (
        selectedStaff &&
        selectedTime &&
        !isStaffAvailable(selectedStaff, selectedDate, selectedTime, duration)
      ) {
        selectedStaff = null;
      }

      reconcileSelectionState();
      renderTimeOptions();
      renderStaffStep2();
      updateSummary();
    });

    box.appendChild(item);

    if (available && !blocked) hasAny = true;
    current += CONFIG.TIME_STEP_MINUTES;
  }

  if (!hasAny) {
    box.classList.add("empty-state");
  }
}

/* -------------------- step 2 available staff -------------------- */

function renderStaffStep2() {
  const box = document.getElementById("staffListStep2");
  if (!box) return;

  box.classList.remove("empty-state");
  box.innerHTML = "";
  box.className = "compact-grid";

  if (!selectedService) {
    box.className = "empty-state";
    box.innerHTML = "先にサービスを選択してください";
    return;
  }

  if (!selectedDate || !selectedTime) {
    box.className = "empty-state";
    box.innerHTML = "時間を選ぶと表示されます";
    return;
  }

  let filtered = getCandidateStaffForSelectedService();

  const duration = Number(selectedService.duration || 0);
  filtered = filtered.filter((member) =>
    isStaffAvailable(member, selectedDate, selectedTime, duration)
  );

  filtered.forEach((member) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "staff-card";

    if (
      selectedStaff &&
      String(member.staffId) === String(selectedStaff.staffId)
    ) {
      card.classList.add("active");
    }

    const imageUrl = member.image || member.imageUrl || member.photo || "";
    const avatar = imageUrl
      ? `<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(member.name || "")}">`
      : `<div class="staff-initial">${escapeHtml((member.name || "S").slice(0, 1))}</div>`;

    card.innerHTML = `
      <div class="staff-avatar">${avatar}</div>
      <div class="staff-name">${escapeHtml(member.name || "-")}</div>
      <div class="staff-hours">${escapeHtml(member.startTime || "-")} - ${escapeHtml(member.endTime || "-")}</div>
    `;

    card.addEventListener("click", () => {
      const isSame =
        selectedStaff &&
        String(member.staffId) === String(selectedStaff.staffId);

      selectedStaff = isSame ? null : member;
      reconcileSelectionState();
      renderAllBookingState();
    });

    box.appendChild(card);
  });

  if (!filtered.length) {
    box.className = "empty-state";
    box.innerHTML = "この条件で対応できる担当者がいません";
  }
}

/* -------------------- summary -------------------- */

function updateSummary() {
  const serviceText = selectedService
    ? `${selectedService.name} ¥${selectedService.price}`
    : "-";

  const staffText = selectedStaff ? selectedStaff.name : "未選択";

  let dateTimeText = "-";
  if (selectedDate && selectedTime) {
    dateTimeText = `${selectedDate} / ${selectedTime}`;
  } else if (selectedDate) {
    dateTimeText = selectedDate;
  }

  const s1 = document.getElementById("liveSummaryService");
  const s2 = document.getElementById("liveSummaryStaff");
  const s3 = document.getElementById("liveSummaryDateTime");

  if (s1) s1.textContent = serviceText;
  if (s2) s2.textContent = staffText;
  if (s3) s3.textContent = dateTimeText;
}

/* -------------------- booking submit -------------------- */

async function submitBooking() {
  const name = (document.getElementById("name")?.value || "").trim();
  const phoneInput = document.getElementById("phone");
  const phone = normalizePhone(phoneInput?.value || "");

  if (!selectedService || !selectedStaff || !selectedDate || !selectedTime) {
    alert("先に予約内容を選択してください");
    return;
  }

  if (!name) {
    alert("お名前を入力してください");
    return;
  }

  if (!phone) {
    alert("電話番号を入力してください");
    phoneInput?.focus();
    return;
  }

  if (!isValidPhone(phone)) {
    alert("電話番号を正しく入力してください");
    phoneInput?.focus();
    return;
  }

  if (phoneInput) phoneInput.value = phone;

  try {
    setLoading(true, "送信中...", "予約内容を確定しています");

    const res = await fetch(CONFIG.WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        mode: "booking",
        name,
        phone,
        userId,
        staffId: selectedStaff.staffId,
        staffName: selectedStaff.name,
        serviceId: selectedService.serviceId,
        serviceName: selectedService.name,
        date: selectedDate,
        time: selectedTime,
        duration: Number(selectedService.duration || 0),
      }),
    });

    const result = await res.json();

    if (result.status === "error") {
      await ensureBookingsLoaded(true, true);
      selectedTime = "";
      reconcileSelectionState();
      renderAllBookingState();
      alert("この時間はすでに予約されています");
      return;
    }

    document.getElementById("successDate").textContent = selectedDate;
    document.getElementById("successTime").textContent = selectedTime;
    document.getElementById("successService").textContent = selectedService.name;
    document.getElementById("successStaff").textContent = selectedStaff.name;

    await ensureBookingsLoaded(true, true);
    showScreen("screenSuccess");
  } catch (err) {
    console.log("Submit error:", err);
    alert("送信エラー");
  } finally {
    setLoading(false);
  }
}

/* -------------------- lead submit -------------------- */

async function submitLeadForm() {
  const salonName = (document.getElementById("leadSalonName")?.value || "").trim();
  const ownerName = (document.getElementById("leadOwnerName")?.value || "").trim();
  const contact = (document.getElementById("leadContact")?.value || "").trim();
  const businessType = (document.getElementById("leadBusinessType")?.value || "").trim();
  const needs = (document.getElementById("leadNeeds")?.value || "").trim();

  if (!salonName || !ownerName || !contact) {
    alert("店舗名・ご担当者名・ご連絡先を入力してください");
    return;
  }

  try {
    setLoading(true, "送信中...", "ご相談内容を送信しています");

    const payload = {
      mode: "lead",
      userId,
      displayName,
      salonName,
      ownerName,
      contact,
      businessType,
      needs,
      source: "mini_app",
    };

    const res = await fetch(CONFIG.WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });

    let result = {};
    try {
      result = await res.json();
    } catch {
      result = { status: "ok" };
    }

    if (result.status === "error") {
      alert("送信に失敗しました");
      return;
    }

    clearLeadForm();
    showScreen("screenLeadSuccess");
  } catch (err) {
    console.log("Lead submit error:", err);
    alert("送信エラー");
  } finally {
    setLoading(false);
  }
}

function clearLeadForm() {
  const ids = [
    "leadSalonName",
    "leadOwnerName",
    "leadContact",
    "leadBusinessType",
    "leadNeeds",
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    if (id === "leadOwnerName") {
      el.value = displayName || "";
    } else {
      el.value = "";
    }
  });
}

/* -------------------- business logic -------------------- */

function staffCanDoService(member, serviceId) {
  const arr = Array.isArray(member.services) ? member.services : [];
  return arr.map(String).includes(String(serviceId));
}

function getEarliestStart(members) {
  if (!members.length) return null;
  const starts = members.map((m) => timeToMinutes(m.startTime));
  return Math.min(...starts);
}

function getLatestEnd(members) {
  if (!members.length) return null;
  const ends = members.map((m) => timeToMinutes(m.endTime));
  return Math.max(...ends);
}

function isAnyStaffAvailableAtTime(time, duration) {
  if (!selectedService || !selectedDate) return false;

  let candidates = getCandidateStaffForSelectedService();

  if (selectedStaff) {
    candidates = candidates.filter(
      (member) => String(member.staffId) === String(selectedStaff.staffId)
    );
  }

  return candidates.some((member) =>
    isStaffAvailable(member, selectedDate, time, duration)
  );
}

function isStaffAvailable(member, date, time, duration) {
  if (!member || !date || !time || !duration) return false;
  if (!isStaffWorkingOnDate(member, date)) return false;

  const start = timeToMinutes(time);
  const end = start + Number(duration);
  const memberStart = timeToMinutes(member.startTime);
  const memberEnd = timeToMinutes(member.endTime);

  if (start < memberStart || end > memberEnd) return false;

  const busy = bookings.filter(
    (b) =>
      String(b.staffId) === String(member.staffId) &&
      String(b.date).trim() === String(date).trim() &&
      String(b.status).trim() === "booked"
  );

  return !busy.some((b) => {
    const bStart = timeToMinutes(normalizeTime(b.time));
    const bEnd = bStart + Number(b.duration || 0);
    return start < bEnd && end > bStart;
  });
}

function isStaffWorkingOnDate(member, date) {
  const daysMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const d = new Date(`${date}T00:00:00`);
  const dayCode = daysMap[d.getDay()];

  const workDays = String(member.workDays || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  return workDays.includes(dayCode);
}

function isTimeBlockedByNow(dateStr, timeStr) {
  const today = getTodayString();
  if (dateStr !== today) return false;

  const now = new Date();
  const [hh, mm] = normalizeTime(timeStr).split(":").map(Number);

  const selectedDateTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hh,
    mm,
    0,
    0
  );

  const diffMinutes = (selectedDateTime.getTime() - now.getTime()) / 60000;
  return diffMinutes < CONFIG.SAME_DAY_BLOCK_MINUTES;
}

/* -------------------- utils -------------------- */

function minutesToTime(min) {
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function timeToMinutes(value) {
  const [h, m] = normalizeTime(value).split(":").map(Number);
  return h * 60 + m;
}

function normalizeTime(value) {
  const str = String(value || "").trim();
  if (/^\d:\d{2}$/.test(str)) return `0${str}`;
  return str;
}

function getTodayString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getServiceVisual(name) {
  const n = String(name || "");
  if (n.includes("カット")) return "✂️";
  if (n.includes("カラー")) return "🎨";
  if (n.includes("ネイル")) return "💅";
  if (n.includes("パーマ")) return "✨";
  if (n.includes("トリートメント")) return "🫧";
  if (n.includes("ヘッドスパ")) return "💆";
  return "✦";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}