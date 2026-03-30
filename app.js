const LIFF_ID = "2009586903-hyNXZaW7";
const WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwrCIw-hvZus6PL5jU3iL5trzWYOjtv70H9D8fF5ppr80c4aFm--wD3ncE6MaR5sUc4/exec";

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

function renderServices() {
  const box = document.getElementById("serviceCategories");
  if (!box) return;

  box.innerHTML = "";

  services.forEach((service) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "service-card";

    btn.innerHTML = `
      <span class="service-icon">${service.icon || "✦"}</span>
      <span class="service-label">${service.name}</span>
      <small>¥${service.price} / ${service.duration}分</small>
    `;

    if (selectedService && String(selectedService.serviceId) === String(service.serviceId)) {
      btn.classList.add("active-service");
    }

    btn.onclick = () => {
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

    box.appendChild(btn);
  });
}

function renderStaffStep1() {
  const box = document.getElementById("staffListStep1");
  if (!box) return;

  box.innerHTML = "";

  const filtered = selectedService
    ? staff.filter(member => staffCanDoService(member, selectedService.serviceId))
    : staff;

  filtered.forEach((member) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "staff-card";

    if (selectedStaff && String(member.staffId) === String(selectedStaff.staffId)) {
      btn.classList.add("active-service");
    }

    btn.innerHTML = `
      <img src="${member.photoUrl}" alt="${member.name}" class="staff-photo" />
      <span class="service-label">${member.name}</span>
      <small>${member.startTime} - ${member.endTime}</small>
    `;

    btn.onclick = () => {
      selectedStaff = member;
      selectedTime = "";

      renderStaffStep1();
      renderTimeOptions();
      renderStaffStep2();
      updateSummary();
    };

    box.appendChild(btn);
  });

  if (!filtered.length) {
    box.innerHTML = `<div class="screen-subtitle">このサービスに対応できる担当者がいません</div>`;
  }
}

function renderDateOptions() {
  const box = document.getElementById("dateGrid");
  if (!box) return;

  box.innerHTML = "";

  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const today = new Date();

  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(today.getDate() + i);

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const value = `${yyyy}-${mm}-${dd}`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "date-btn";

    if (value === selectedDate) {
      btn.classList.add("active-slot");
    }

    btn.innerHTML = `
      <span class="date-top">${weekdays[d.getDay()]}</span>
      <span class="date-main">${mm}/${dd}</span>
    `;

    btn.onclick = () => {
      selectedDate = value;
      selectedTime = "";

      renderDateOptions();
      renderTimeOptions();
      renderStaffStep2();
      updateSummary();
    };

    box.appendChild(btn);
  }
}

function renderTimeOptions() {
  const box = document.getElementById("timeSlots");
  if (!box) return;

  box.innerHTML = "";

  if (!selectedDate) {
    box.innerHTML = `<div class="screen-subtitle">先に日付を選択してください</div>`;
    return;
  }

  if (!selectedService) {
    box.innerHTML = `<div class="screen-subtitle">先にサービスを選択してください</div>`;
    return;
  }

  const duration = Number(selectedService.duration || 0);
  if (!duration) {
    box.innerHTML = `<div class="screen-subtitle">サービス時間が未設定です</div>`;
    return;
  }

  let availableMembers = staff.filter(member =>
    staffCanDoService(member, selectedService.serviceId)
  );

  if (selectedStaff) {
    availableMembers = availableMembers.filter(member =>
      String(member.staffId) === String(selectedStaff.staffId)
    );
  }

  const globalStart = getEarliestStart(availableMembers);
  const globalEnd = getLatestEnd(availableMembers);

  if (globalStart === null || globalEnd === null) {
    box.innerHTML = `<div class="screen-subtitle">対応可能な担当者がいません</div>`;
    return;
  }

  let current = globalStart;

  while (current + duration <= globalEnd) {
    const time = minutesToTime(current);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "time-btn";
    btn.textContent = time;

    const isAvailable = isAnyStaffAvailableAtTime(time, duration);

    if (!isAvailable) {
      btn.classList.add("disabled-slot");
      btn.disabled = true;
    } else if (time === selectedTime) {
      btn.classList.add("active-slot");
    }

    btn.onclick = () => {
      selectedTime = time;

      if (selectedStaff && !isStaffAvailable(selectedStaff, selectedDate, selectedTime, duration)) {
        selectedStaff = null;
      }

      renderTimeOptions();
      renderStaffStep1();
      renderStaffStep2();
      updateSummary();
    };

    box.appendChild(btn);
    current += 30;
  }
}

function renderStaffStep2() {
  const box = document.getElementById("staffListStep2");
  if (!box) return;

  box.innerHTML = "";

  if (!selectedService) {
    box.innerHTML = `<div class="screen-subtitle">先にサービスを選択してください</div>`;
    return;
  }

  let filtered = staff.filter(member =>
    staffCanDoService(member, selectedService.serviceId)
  );

  if (selectedDate && selectedTime) {
    const duration = Number(selectedService.duration || 0);
    filtered = filtered.filter(member =>
      isStaffAvailable(member, selectedDate, selectedTime, duration)
    );
  }

  filtered.forEach((member) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "staff-row";

    if (selectedStaff && String(member.staffId) === String(selectedStaff.staffId)) {
      row.classList.add("active-service");
    }

    row.innerHTML = `
      <img src="${member.photoUrl}" alt="${member.name}" class="staff-photo" />
      <div class="staff-row-info">
        <div class="staff-row-name">${member.name}</div>
        <div class="staff-row-time">${member.startTime} - ${member.endTime}</div>
      </div>
    `;

    row.onclick = () => {
      selectedStaff = member;
      selectedTime = "";

      renderStaffStep1();
      renderTimeOptions();
      renderStaffStep2();
      updateSummary();
    };

    box.appendChild(row);
  });

  if (!filtered.length) {
    box.innerHTML = `<div class="screen-subtitle">この条件で対応できる担当者がいません</div>`;
  }
}

function staffCanDoService(member, serviceId) {
  const arr = Array.isArray(member.services) ? member.services : [];
  return arr.map(String).includes(String(serviceId));
}

function getEarliestStart(members) {
  if (!members.length) return null;
  const starts = members.map(m => timeToMinutes(m.startTime));
  return Math.min(...starts);
}

function getLatestEnd(members) {
  if (!members.length) return null;
  const ends = members.map(m => timeToMinutes(m.endTime));
  return Math.max(...ends);
}

function isAnyStaffAvailableAtTime(time, duration) {
  if (!selectedService || !selectedDate) return false;

  let candidates = staff.filter(member =>
    staffCanDoService(member, selectedService.serviceId)
  );

  if (selectedStaff) {
    candidates = candidates.filter(member =>
      String(member.staffId) === String(selectedStaff.staffId)
    );
  }

  return candidates.some(member =>
    isStaffAvailable(member, selectedDate, time, duration)
  );
}

function isStaffAvailable(member, date, time, duration) {
  if (!member || !date || !time || !duration) return false;

  if (!isStaffWorkingOnDate(member, date)) {
    return false;
  }

  const start = timeToMinutes(time);
  const end = start + Number(duration);

  const memberStart = timeToMinutes(member.startTime);
  const memberEnd = timeToMinutes(member.endTime);

  if (start < memberStart || end > memberEnd) {
    return false;
  }

  const busy = bookings.filter(b =>
    String(b.staffId) === String(member.staffId) &&
    String(b.date).trim() === String(date).trim() &&
    String(b.status).trim() === "booked"
  );

  return !busy.some(b => {
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
    .map(x => x.trim())
    .filter(Boolean);

  return workDays.includes(dayCode);
}

function updateSummary() {
  const serviceText = selectedService
    ? `${selectedService.name} ¥${selectedService.price}`
    : "-";

  const staffText = selectedStaff ? selectedStaff.name : "-";

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
  if (!selectedService || !selectedStaff || !selectedDate || !selectedTime) {
    alert("サービス・担当者・日付・時間を選択してください");
    return;
  }

  document.getElementById("confirmService").textContent =
    `${selectedService.name} ¥${selectedService.price}`;
  document.getElementById("confirmStaff").textContent = selectedStaff.name;
  document.getElementById("confirmDate").textContent = selectedDate;
  document.getElementById("confirmTime").textContent = selectedTime;

  const nameInput = document.getElementById("name");
  if (nameInput && !nameInput.value && displayName) {
    nameInput.value = displayName;
  }

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

    const successService = document.getElementById("successService");
    const successStaff = document.getElementById("successStaff");
    const successDateTime = document.getElementById("successDateTime");

    if (successService) successService.textContent = selectedService.name;
    if (successStaff) successStaff.textContent = selectedStaff.name;
    if (successDateTime) successDateTime.textContent = `${selectedDate} / ${selectedTime}`;

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