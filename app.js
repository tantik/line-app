const CONFIG = {
  LIFF_ID: "2009586903-hyNXZaW7",
  WEBHOOK_URL: "https://script.google.com/macros/s/AKfycbzBO8tGb_c9oJpS0-IfFDdnmRicmYYG1v7Dbtk8ffvryY2TPsatNdqhNKBMBj8zzvVC/exec",
  BUSINESS_LABEL: "Salon",
  DATE_RANGE_DAYS: 60,
  INITIAL_VISIBLE_DAYS: 14,
  LOAD_MORE_DAYS_STEP: 14,
  TIME_STEP_MINUTES: 30,
  SAME_DAY_BLOCK_MINUTES: 20,
  CACHE_TTL_MS: 3 * 60 * 1000
};

const SERVICES_URL = `${CONFIG.WEBHOOK_URL}?action=services`;
const STAFF_URL = `${CONFIG.WEBHOOK_URL}?action=staff`;
const BOOKINGS_URL = `${CONFIG.WEBHOOK_URL}?action=bookings`;

let userId = "";
let displayName = "";

let services = [];
let staff = [];
let bookings = [];

let selectedService = null;
let selectedStaff = null;
let selectedDate = "";
let selectedTime = "";
let previousScreen = "welcome";
let initDone = false;
let visibleDaysCount = CONFIG.INITIAL_VISIBLE_DAYS;
let bookingsPrefetchStarted = false;

const cacheStore = {
  services: { data: null, ts: 0 },
  staff: { data: null, ts: 0 },
  bookings: { data: null, ts: 0 }
};

async function init() {
  if (initDone) return;
  initDone = true;

  setLoading(true, "読み込み中...", "予約情報を準備しています");

  try {
    await liff.init({ liffId: CONFIG.LIFF_ID });

    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }

    const profile = await liff.getProfile();
    userId = profile.userId || "";
    displayName = profile.displayName || "";

    const nameInput = document.getElementById("name");
    if (nameInput && !nameInput.value) {
      nameInput.value = displayName;
    }

    await Promise.all([
      loadServices(true),
      loadStaff(true)
    ]);

    renderServices();
    renderStaffStep1();
    renderDateOptions();
    renderStep2IdleState();
    updateSummary();

    startBookingsPrefetch();
  } catch (e) {
    console.log("LIFF init error:", e);
    alert("初期化エラーが発生しました");
  } finally {
    setLoading(false);
  }
}

init();

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

function getCache(key) {
  const item = cacheStore[key];
  if (!item || !item.data) return null;
  if (Date.now() - item.ts > CONFIG.CACHE_TTL_MS) return null;
  return item.data;
}

function setCache(key, data) {
  cacheStore[key] = {
    data: Array.isArray(data) ? [...data] : data,
    ts: Date.now()
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
  }
}

async function ensureBookingsLoaded(force = false, silent = false) {
  try {
    const cached = !force ? getCache("bookings") : null;
    if (cached) {
      bookings = cached;
      return;
    }

    if (!silent) {
      setInlineTimeLoading(true, "空き状況を確認中...");
    }

    bookings = await fetchJson(BOOKINGS_URL);
    setCache("bookings", bookings);
  } catch (e) {
    console.log("Bookings load error:", e);
  } finally {
    if (!silent) {
      setInlineTimeLoading(false);
    }
  }
}

function startBookingsPrefetch() {
  if (bookingsPrefetchStarted) return;
  bookingsPrefetchStarted = true;

  setTimeout(async () => {
    try {
      await ensureBookingsLoaded(false, true);
    } catch (e) {
      console.log("Prefetch bookings error:", e);
    }
  }, 400);
}

/* ---------- SERVICES ---------- */

function renderServices() {
  const el = document.getElementById("servicesList");
  if (!el) return;

  el.innerHTML = "";

  services.forEach((service) => {
    const card = document.createElement("div");
    card.className = "service-card";
    card.setAttribute("data-icon", getServiceVisual(service.name));

    if (selectedService && String(selectedService.serviceId) === String(service.serviceId)) {
      card.classList.add("active");
    }

    card.innerHTML = `
      <div class="service-card-badge">${getServiceVisual(service.name)} サービス</div>
      <div class="service-card-name">${escapeHtml(service.name || "-")}</div>
      <div class="service-card-meta">${escapeHtml(String(service.duration || 0))}分</div>
      <div class="service-card-price">¥${escapeHtml(String(service.price || 0))}</div>
    `;

    card.onclick = () => {
      selectedService = service;

      if (selectedStaff && !staffCanDoService(selectedStaff, selectedService.serviceId)) {
        selectedStaff = null;
        selectedTime = "";
      }

      renderServices();
      renderStaffStep1();

      if (isStep2Active()) {
        if (selectedDate) {
          renderTimeOptions();
          renderStaffStep2();
        } else {
          renderStep2IdleState();
        }
      }

      updateSummary();
    };

    el.appendChild(card);
  });
}

/* ---------- STAFF STEP 1 ---------- */

function renderStaffStep1() {
  const box = document.getElementById("staffListStep1");
  if (!box) return;

  box.innerHTML = "";

  const filtered = selectedService
    ? staff.filter((member) => staffCanDoService(member, selectedService.serviceId))
    : staff;

  filtered.forEach((member) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "staff-card";

    if (selectedStaff && String(member.staffId) === String(selectedStaff.staffId)) {
      card.classList.add("active");
    }

    card.innerHTML = `
      <img src="${escapeAttr(member.photoUrl || "")}" alt="${escapeAttr(member.name || "")}" class="staff-photo" />
      <div class="staff-name">${escapeHtml(member.name || "-")}</div>
      <div class="staff-time">${escapeHtml(member.startTime || "-")} - ${escapeHtml(member.endTime || "-")}</div>
    `;

    card.onclick = () => {
      selectedStaff = member;
      selectedTime = "";

      renderStaffStep1();

      if (isStep2Active()) {
        if (selectedDate) {
          renderTimeOptions();
          renderStaffStep2();
        } else {
          renderStep2IdleState();
        }
      }

      updateSummary();
    };

    box.appendChild(card);
  });

  if (!filtered.length) {
    box.innerHTML = `<div class="screen-subtitle">このサービスに対応できる担当者がいません</div>`;
  }
}

/* ---------- DATES ---------- */

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

    if (value === selectedDate) {
      item.classList.add("active");
    }

    item.innerHTML = `
      <div class="date-item-weekday">${weekdays[d.getDay()]}</div>
      <div class="date-item-date">${mm}/${dd}</div>
    `;

    item.onclick = async () => {
      selectedDate = value;
      selectedTime = "";
      renderDateOptions();

      const slotHint = document.getElementById("slotHint");
      if (slotHint) slotHint.textContent = "空き状況を確認しています";

      setInlineTimeLoading(true, "空き状況を確認中...");
      await ensureBookingsLoaded(false);
      setInlineTimeLoading(false);

      if (slotHint) slotHint.textContent = "時間を選択してください";

      renderTimeOptions();
      renderStaffStep2();
      updateSummary();
    };

    box.appendChild(item);
  }

  if (countLabel) {
    countLabel.textContent = `${count}日表示`;
  }

  if (moreBtn) {
    moreBtn.classList.toggle("hidden", count >= CONFIG.DATE_RANGE_DAYS);
  }
}

function loadMoreDates() {
  visibleDaysCount = Math.min(
    visibleDaysCount + CONFIG.LOAD_MORE_DAYS_STEP,
    CONFIG.DATE_RANGE_DAYS
  );
  renderDateOptions();
}

/* ---------- STEP 2 IDLE ---------- */

function renderStep2IdleState() {
  const timeBox = document.getElementById("timeList");
  const staffBox = document.getElementById("staffListStep2");
  const slotHint = document.getElementById("slotHint");

  if (slotHint) slotHint.textContent = "日付を選択してください";

  if (timeBox) {
    timeBox.innerHTML = `<div class="screen-subtitle">先に日付を選択してください</div>`;
  }

  if (staffBox) {
    if (!selectedService) {
      staffBox.innerHTML = `<div class="screen-subtitle">先にサービスを選択してください</div>`;
    } else {
      staffBox.innerHTML = `<div class="screen-subtitle">時間を選ぶと表示されます</div>`;
    }
  }
}

/* ---------- TIME ---------- */

function renderTimeOptions() {
  const box = document.getElementById("timeList");
  const slotHint = document.getElementById("slotHint");
  if (!box) return;

  box.innerHTML = "";

  if (!selectedDate || !selectedService) {
    renderStep2IdleState();
    return;
  }

  if (slotHint) slotHint.textContent = "時間を選択してください";

  const duration = Number(selectedService.duration || 0);

  let candidates = staff.filter((m) => staffCanDoService(m, selectedService.serviceId));

  if (selectedStaff) {
    candidates = candidates.filter((m) => String(m.staffId) === String(selectedStaff.staffId));
  }

  const start = getEarliestStart(candidates);
  const end = getLatestEnd(candidates);

  if (start === null || end === null) {
    box.innerHTML = `<div class="screen-subtitle">対応可能な担当者がいません</div>`;
    return;
  }

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

    if (time === selectedTime) {
      item.classList.add("active");
    }

    item.innerHTML = `
      <div class="time-label">${time}</div>
      <div class="time-status">${status}</div>
    `;

    item.onclick = () => {
      if (!available || blocked) return;

      selectedTime = time;

      if (selectedStaff && !isStaffAvailable(selectedStaff, selectedDate, selectedTime, duration)) {
        selectedStaff = null;
        renderStaffStep1();
      }

      renderTimeOptions();
      renderStaffStep2();
      updateSummary();
    };

    box.appendChild(item);
    current += CONFIG.TIME_STEP_MINUTES;
  }
}

/* ---------- STAFF STEP 2 ---------- */

function renderStaffStep2() {
  const box = document.getElementById("staffListStep2");
  if (!box) return;

  box.innerHTML = "";

  if (!selectedService) {
    box.innerHTML = `<div class="screen-subtitle">先にサービスを選択してください</div>`;
    return;
  }

  if (!selectedDate || !selectedTime) {
    box.innerHTML = `<div class="screen-subtitle">時間を選ぶと表示されます</div>`;
    return;
  }

  let filtered = staff.filter((member) =>
    staffCanDoService(member, selectedService.serviceId)
  );

  const duration = Number(selectedService.duration || 0);
  filtered = filtered.filter((member) =>
    isStaffAvailable(member, selectedDate, selectedTime, duration)
  );

  filtered.forEach((member) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "staff-card";

    if (selectedStaff && String(member.staffId) === String(selectedStaff.staffId)) {
      card.classList.add("active");
    }

    card.innerHTML = `
      <img src="${escapeAttr(member.photoUrl || "")}" alt="${escapeAttr(member.name || "")}" class="staff-photo" />
      <div class="staff-name">${escapeHtml(member.name || "-")}</div>
      <div class="staff-time">${escapeHtml(member.startTime || "-")} - ${escapeHtml(member.endTime || "-")}</div>
    `;

    card.onclick = () => {
      selectedStaff = member;
      renderStaffStep1();
      renderStaffStep2();
      updateSummary();
    };

    box.appendChild(card);
  });

  if (!filtered.length) {
    box.innerHTML = `<div class="screen-subtitle">この条件で対応できる担当者がいません</div>`;
  }
}

/* ---------- BUSINESS LOGIC ---------- */

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

  let candidates = staff.filter((member) =>
    staffCanDoService(member, selectedService.serviceId)
  );

  if (selectedStaff) {
    candidates = candidates.filter((member) =>
      String(member.staffId) === String(selectedStaff.staffId)
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

  const busy = bookings.filter((b) =>
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
  const d = new Date(date + "T00:00:00");
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

/* ---------- SUMMARY ---------- */

function updateSummary() {
  const serviceText = selectedService ? `${selectedService.name} ¥${selectedService.price}` : "-";
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

/* ---------- NAVIGATION ---------- */

function isStep2Active() {
  const current = document.querySelector(".screen.active");
  return current && current.id === "bookingStep2";
}

function goDemoStart() {
  clearState();

  const nameInput = document.getElementById("name");
  const phoneInput = document.getElementById("phone");

  if (nameInput) nameInput.value = displayName || "";
  if (phoneInput) phoneInput.value = "";

  renderServices();
  renderStaffStep1();
  renderDateOptions();
  renderStep2IdleState();
  updateSummary();
  showScreen("bookingStep1");
}

function goStep2() {
  if (!selectedService) {
    alert("サービスを選択してください");
    return;
  }

  renderDateOptions();

  if (selectedDate) {
    renderTimeOptions();
    renderStaffStep2();
  } else {
    renderStep2IdleState();
  }

  updateSummary();
  showScreen("bookingStep2");
}

async function goConfirm() {
  if (!selectedService || !selectedDate || !selectedTime || !selectedStaff) {
    alert("サービス・担当者・日付・時間を選択してください");
    return;
  }

  await ensureBookingsLoaded(false);

  const duration = Number(selectedService.duration || 0);
  if (!isStaffAvailable(selectedStaff, selectedDate, selectedTime, duration)) {
    selectedTime = "";
    renderTimeOptions();
    renderStaffStep2();
    updateSummary();
    alert("選択した時間が埋まっていました。もう一度お選びください。");
    return;
  }

  document.getElementById("confirmService").textContent = `${selectedService.name} ¥${selectedService.price}`;
  document.getElementById("confirmStaff").textContent = selectedStaff.name;
  document.getElementById("confirmDate").textContent = selectedDate;
  document.getElementById("confirmTime").textContent = selectedTime;

  showScreen("confirm");
}

async function submitForm() {
  const name = (document.getElementById("name")?.value || "").trim();
  const phone = (document.getElementById("phone")?.value || "").trim();

  if (!selectedService || !selectedStaff || !selectedDate || !selectedTime) {
    alert("先に予約内容を選択してください");
    return;
  }

  if (!phone) {
    alert("電話番号を入力してください");
    return;
  }

  try {
    setLoading(true, "送信中...", "予約内容を確定しています");

    const res = await fetch(CONFIG.WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
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
        duration: Number(selectedService.duration || 0)
      })
    });

    const result = await res.json();

    if (result.status === "error") {
      await ensureBookingsLoaded(true, true);
      renderTimeOptions();
      renderStaffStep2();
      alert("この時間はすでに予約されています");
      return;
    }

    document.getElementById("successDate").textContent = selectedDate;
    document.getElementById("successTime").textContent = selectedTime;
    document.getElementById("successService").textContent = selectedService.name;
    document.getElementById("successStaff").textContent = selectedStaff.name;

    await ensureBookingsLoaded(true, true);
    showScreen("success");
  } catch (err) {
    console.log("Submit error:", err);
    alert("送信エラー");
  } finally {
    setLoading(false);
  }
}

function showLeadScreen() {
  previousScreen = getCurrentScreenId() || "welcome";

  const ownerInput = document.getElementById("leadOwnerName");
  if (ownerInput && !ownerInput.value) {
    ownerInput.value = displayName || "";
  }

  showScreen("leadFormScreen");
}

function backFromLead() {
  showScreen(previousScreen || "welcome");
}

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
      source: previousScreen || getCurrentScreenId()
    };

    const res = await fetch(CONFIG.WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload)
    });

    let result = {};
    try {
      result = await res.json();
    } catch (e) {
      result = { status: "ok" };
    }

    if (result.status === "error") {
      alert("送信に失敗しました");
      return;
    }

    clearLeadForm();
    showScreen("leadSuccess");
  } catch (err) {
    console.log("Lead submit error:", err);
    alert("送信エラー");
  } finally {
    setLoading(false);
  }
}

function clearLeadForm() {
  const ids = ["leadSalonName", "leadOwnerName", "leadContact", "leadBusinessType", "leadNeeds"];
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

function clearSelectedStaff() {
  selectedStaff = null;
  selectedTime = "";

  renderStaffStep1();

  if (isStep2Active()) {
    if (selectedDate) {
      renderTimeOptions();
      renderStaffStep2();
    } else {
      renderStep2IdleState();
    }
  }

  updateSummary();
}

function resetAndGoStart() {
  clearState();

  const nameInput = document.getElementById("name");
  const phoneInput = document.getElementById("phone");

  if (nameInput) nameInput.value = displayName || "";
  if (phoneInput) phoneInput.value = "";

  renderServices();
  renderStaffStep1();
  renderDateOptions();
  renderStep2IdleState();
  updateSummary();
  showScreen("welcome");
}

function clearState() {
  selectedService = null;
  selectedStaff = null;
  selectedDate = "";
  selectedTime = "";
  visibleDaysCount = CONFIG.INITIAL_VISIBLE_DAYS;
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.remove("active");
  });

  const target = document.getElementById(id);
  if (target) target.classList.add("active");
}

function getCurrentScreenId() {
  const current = document.querySelector(".screen.active");
  return current ? current.id : "";
}

/* ---------- UTILS ---------- */

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
  if (/^\d:\d{2}$/.test(str)) return "0" + str;
  return str;
}

function getTodayString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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