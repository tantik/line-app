const LIFF_ID = "2009586903-hyNXZaW7";
const WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbyro-5QEqFFrln5PcosifzwsdLJHirOa_hlVStJL4bDcqy6O2M6sxrmOslPCma2jFoM/exec";

const SERVICES_URL = `${WEBHOOK_URL}?action=services`;
const STAFF_URL = `${WEBHOOK_URL}?action=staff`;
const BOOKINGS_URL = `${WEBHOOK_URL}?action=bookings`;

let userId = "";
let displayName = "";

let services = [];
let staff = [];
let bookings = [];

let selectedService = null;
let selectedStaff = null;
let selectedDate = "";
let selectedTime = "";

async function init() {
  try {
    await liff.init({ liffId: LIFF_ID });

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
      loadServices(),
      loadStaff(),
      loadBookings()
    ]);

    renderServices();
    renderStaffStep1();
    renderDateOptions();
    renderTimeOptions();
    renderStaffStep2();
    updateSummary();
  } catch (e) {
    console.log("LIFF init error:", e);
  }
}

init();

async function loadServices() {
  try {
    const res = await fetch(SERVICES_URL);
    services = await res.json();
  } catch (e) {
    console.log("Services load error:", e);
  }
}

async function loadStaff() {
  try {
    const res = await fetch(STAFF_URL);
    staff = await res.json();
  } catch (e) {
    console.log("Staff load error:", e);
  }
}

async function loadBookings() {
  try {
    const res = await fetch(BOOKINGS_URL);
    bookings = await res.json();
  } catch (e) {
    console.log("Bookings load error:", e);
  }
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
      renderTimeOptions();
      renderStaffStep2();
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
      renderTimeOptions();
      renderStaffStep2();
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
  if (!box) return;

  box.innerHTML = "";

  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const today = new Date();

  for (let i = 0; i < 60; i++) {
    const d = new Date();
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

    item.onclick = () => {
      selectedDate = value;
      selectedTime = "";

      renderDateOptions();
      renderTimeOptions();
      renderStaffStep2();
      updateSummary();
    };

    box.appendChild(item);
  }
}

/* ---------- TIME ---------- */

function renderTimeOptions() {
  const box = document.getElementById("timeList");
  if (!box) return;

  box.innerHTML = "";

  if (!selectedDate || !selectedService) {
    box.innerHTML = `<div class="screen-subtitle">先に選択してください</div>`;
    return;
  }

  const duration = Number(selectedService.duration || 0);

  let candidates = staff.filter((m) =>
    staffCanDoService(m, selectedService.serviceId)
  );

  if (selectedStaff) {
    candidates = candidates.filter((m) =>
      String(m.staffId) === String(selectedStaff.staffId)
    );
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
      }

      renderTimeOptions();
      renderStaffStep2();
      updateSummary();
    };

    box.appendChild(item);
    current += 30;
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

  let filtered = staff.filter((member) =>
    staffCanDoService(member, selectedService.serviceId)
  );

  if (selectedDate && selectedTime) {
    const duration = Number(selectedService.duration || 0);
    filtered = filtered.filter((member) =>
      isStaffAvailable(member, selectedDate, selectedTime, duration)
    );
  }

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
  return diffMinutes < 20;
}

/* ---------- SUMMARY ---------- */

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

/* ---------- NAVIGATION ---------- */

function goStep2() {
  if (!selectedService) {
    alert("サービスを選択してください");
    return;
  }

  renderDateOptions();
  renderTimeOptions();
  renderStaffStep2();
  updateSummary();
  showScreen("bookingStep2");
}

function goConfirm() {
  if (!selectedService || !selectedDate || !selectedTime || !selectedStaff) {
    alert("サービス・担当者・日付・時間を選択してください");
    return;
  }

  document.getElementById("confirmService").textContent =
    `${selectedService.name} ¥${selectedService.price}`;
  document.getElementById("confirmStaff").textContent =
    selectedStaff.name;
  document.getElementById("confirmDate").textContent =
    selectedDate;
  document.getElementById("confirmTime").textContent =
    selectedTime;

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
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({
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
      await loadBookings();
      renderTimeOptions();
      renderStaffStep2();
      alert("この時間はすでに予約されています");
      return;
    }

    document.getElementById("successDate").textContent = selectedDate;
    document.getElementById("successTime").textContent = selectedTime;
    document.getElementById("successService").textContent = selectedService.name;
    document.getElementById("successStaff").textContent = selectedStaff.name;

    await loadBookings();
    showScreen("success");
  } catch (err) {
    console.log("Submit error:", err);
    alert("送信エラー");
  }
}

function clearSelectedStaff() {
  selectedStaff = null;
  selectedTime = "";
  renderStaffStep1();
  renderTimeOptions();
  renderStaffStep2();
  updateSummary();
}

function goWelcomeLike() {
  clearState();
  renderServices();
  renderStaffStep1();
  renderDateOptions();
  renderTimeOptions();
  renderStaffStep2();
  updateSummary();
  showScreen("bookingStep1");
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
  renderTimeOptions();
  renderStaffStep2();
  updateSummary();
  showScreen("bookingStep1");
}

function openInstallLead() {
  const text = encodeURIComponent(
    "こんにちは。LINE予約システムの導入について相談したいです。"
  );

  if (liff.isInClient()) {
    liff.openWindow({
      url: `https://line.me/R/oaMessage/@780rkqga/?${text}`,
      external: false
    });
  } else {
    window.open(`https://line.me/R/oaMessage/@780rkqga/?${text}`, "_blank");
  }
}

function clearState() {
  selectedService = null;
  selectedStaff = null;
  selectedDate = "";
  selectedTime = "";
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.remove("active");
  });

  const target = document.getElementById(id);
  if (target) target.classList.add("active");
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