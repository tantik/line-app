const LIFF_ID = "2009586903-hyNXZaW7";
const WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwaJf527yoEzfRWX-YokM8Thux7LASeCeigB6eMWxg8F7lipNtbvGsMrHiwTJuRc1kD/exec";
const SERVICES_URL = `${WEBHOOK_URL}?action=services`;
const STAFF_URL = `${WEBHOOK_URL}?action=staff`;
const BOOKINGS_URL = `${WEBHOOK_URL}?action=bookings`;

let userId = "";
let displayName = "";

let services = [];
let staff = [];
let bookings = [];

let selectedCategory = "";
let selectedServiceName = "";
let selectedServiceId = "";
let selectedStaffId = "";
let selectedStaffName = "";
let selectedDate = "";
let selectedTime = "";

async function init() {
  try {
    await liff.init({ liffId: LIFF_ID });

    if (liff.isLoggedIn()) {
      const profile = await liff.getProfile();
      userId = profile.userId;
      displayName = profile.displayName || "";

      const nameInput = document.getElementById("name");
      if (nameInput && !nameInput.value) {
        nameInput.value = displayName;
      }
    }

    await Promise.all([
      loadServices(),
      loadStaff(),
      loadBookings()
    ]);

    renderDateOptions();
    updateLiveSummary();
  } catch (e) {
    console.log("LIFF error:", e);
  }
}

init();

async function loadServices() {
  try {
    const res = await fetch(SERVICES_URL);
    services = await res.json();
    renderCategories();
  } catch (e) {
    console.log("Services load error:", e);
  }
}

async function loadStaff() {
  try {
    const res = await fetch(STAFF_URL);
    staff = await res.json();
    renderStaffStep1();
    renderStaffStep2();
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

function renderCategories() {
  const box = document.getElementById("serviceCategories");
  if (!box) return;

  const categories = [...new Set(services.map((item) => item.category))];
  box.innerHTML = "";

  categories.forEach((category) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "service-card";
    btn.innerHTML = `
      <span class="service-icon">${getCategoryIcon(category)}</span>
      <span class="service-label">${category}</span>
    `;
    btn.onclick = () => selectCategory(category, btn);
    box.appendChild(btn);
  });
}

function renderServices(category) {
  const box = document.getElementById("serviceList");
  if (!box) return;

  const filtered = services.filter((item) => item.category === category);
  box.innerHTML = "";

  filtered.forEach((service) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "service-card";
    btn.innerHTML = `
      <span class="service-icon">✦</span>
      <span class="service-label">${service.name}</span>
    `;
    btn.onclick = () => selectService(service, btn);
    box.appendChild(btn);
  });
}

function renderStaffStep1() {
  const box = document.getElementById("staffListStep1");
  if (!box) return;

  box.innerHTML = "";

  staff.forEach((member) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "staff-card";
    if (String(member.staffId) === String(selectedStaffId)) {
      btn.classList.add("active-service");
    }

    btn.innerHTML = `
      <img src="${member.photoUrl}" alt="${member.name}" class="staff-photo" />
      <span class="service-label">${member.name}</span>
      <small>${member.startTime} - ${member.endTime}</small>
    `;

    btn.onclick = () => selectStaff(member);
    box.appendChild(btn);
  });
}

function renderStaffStep2() {
  const box = document.getElementById("staffListStep2");
  if (!box) return;

  let filteredStaff = [...staff];

  if (selectedTime) {
    filteredStaff = filteredStaff.filter((member) => isStaffAvailable(member, selectedDate, selectedTime));
  }

  box.innerHTML = "";

  filteredStaff.forEach((member) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "staff-row";
    if (String(member.staffId) === String(selectedStaffId)) {
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
      selectedStaffId = member.staffId;
      selectedStaffName = member.name;
      document.getElementById("staffId").value = member.staffId;
      document.getElementById("staffName").value = member.name;

      renderStaffStep1();
      renderStaffStep2();
      renderTimeOptions();
      updateLiveSummary();
    };

    box.appendChild(row);
  });
}

function selectCategory(category, button) {
  selectedCategory = category;
  selectedServiceName = "";
  selectedServiceId = "";

  document.getElementById("service").value = "";
  document.getElementById("serviceId").value = "";

  document.querySelectorAll("#serviceCategories .service-card").forEach((el) => {
    el.classList.remove("active-service");
  });

  button.classList.add("active-service");
  renderServices(category);
  updateLiveSummary();
}

function selectService(service, button) {
  selectedServiceName = service.name;
  selectedServiceId = service.serviceId;

  document.getElementById("service").value = service.name;
  document.getElementById("serviceId").value = service.serviceId;

  document.querySelectorAll("#serviceList .service-card").forEach((el) => {
    el.classList.remove("active-service");
  });

  button.classList.add("active-service");
  updateLiveSummary();
}

function selectStaff(member) {
  selectedStaffId = member.staffId;
  selectedStaffName = member.name;

  document.getElementById("staffId").value = member.staffId;
  document.getElementById("staffName").value = member.name;

  renderStaffStep1();
  renderStaffStep2();
  renderTimeOptions();
  updateLiveSummary();
}

function clearSelectedStaff() {
  selectedStaffId = "";
  selectedStaffName = "";
  document.getElementById("staffId").value = "";
  document.getElementById("staffName").value = "";

  renderStaffStep1();
  renderStaffStep2();
  renderTimeOptions();
  updateLiveSummary();
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
      renderDateOptions();
      renderTimeOptions();
      renderStaffStep2();
      updateLiveSummary();
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

  let startTime = "10:00";
  let endTime = "20:00";
  let slotMinutes = 30;

  if (selectedStaffId) {
    const member = staff.find((item) => String(item.staffId) === String(selectedStaffId));
    if (member) {
      startTime = member.startTime;
      endTime = member.endTime;
      slotMinutes = Number(member.slotMinutes) || 30;
    }
  }

  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);

  let current = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;

  while (current < end) {
    const hour = String(Math.floor(current / 60)).padStart(2, "0");
    const minute = String(current % 60).padStart(2, "0");
    const value = `${hour}:${minute}`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "time-btn";
    btn.textContent = value;

    let isAvailable = true;

    if (selectedStaffId) {
      const member = staff.find((item) => String(item.staffId) === String(selectedStaffId));
      if (member) {
        isAvailable = isStaffAvailable(member, selectedDate, value);
      }
    } else {
      isAvailable = staff.some((member) => isStaffAvailable(member, selectedDate, value));
    }

    if (!isAvailable) {
      btn.classList.add("disabled-slot");
      btn.disabled = true;
    } else if (value === selectedTime) {
      btn.classList.add("active-slot");
    }

    btn.onclick = () => {
      selectedTime = value;
      renderTimeOptions();
      renderStaffStep2();

      if (selectedStaffId) {
        const currentStaff = staff.find((item) => String(item.staffId) === String(selectedStaffId));
        if (currentStaff && !isStaffAvailable(currentStaff, selectedDate, selectedTime)) {
          selectedStaffId = "";
          selectedStaffName = "";
          document.getElementById("staffId").value = "";
          document.getElementById("staffName").value = "";
          renderStaffStep1();
          renderStaffStep2();
        }
      }

      updateLiveSummary();
    };

    box.appendChild(btn);
    current += slotMinutes;
  }
}

function isStaffAvailable(member, date, time) {
  if (!date || !time) return true;

  const normalizedTime = normalizeTimeClient(time);

  const [startHour, startMinute] = String(member.startTime).split(":").map(Number);
  const [endHour, endMinute] = String(member.endTime).split(":").map(Number);
  const [checkHour, checkMinute] = normalizedTime.split(":").map(Number);

  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  const current = checkHour * 60 + checkMinute;

  if (current < start || current >= end) {
    return false;
  }

  const busySlots = bookings
    .filter((b) =>
      String(b.staffId) === String(member.staffId) &&
      String(b.date).trim() === String(date).trim() &&
      String(b.status).trim() === "booked"
    )
    .map((b) => normalizeTimeClient(b.time));

  return !busySlots.includes(normalizedTime);
}

function normalizeTimeClient(value) {
  const str = String(value).trim();
  if (/^\d:\d{2}$/.test(str)) {
    return "0" + str;
  }
  return str;
}

function getCategoryIcon(category) {
  if (category === "カット") return "✂️";
  if (category === "カラー") return "🎨";
  if (category === "パーマ") return "✨";
  if (category === "ネイル") return "💅";
  return "•";
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.remove("active");
  });
  document.getElementById(id).classList.add("active");
}

function goWelcomeLike() {
  selectedTime = "";
  selectedDate = "";
  updateLiveSummary();
  showScreen("bookingStep1");
}

function goStep2() {
  const service = document.getElementById("service").value;

  if (!service) {
    alert("サービスを選択してください");
    return;
  }

  if (selectedDate) {
    renderDateOptions();
  } else {
    renderDateOptions();
  }

  renderTimeOptions();
  renderStaffStep2();
  updateLiveSummary();
  showScreen("bookingStep2");
}

function goConfirm() {
  const service = document.getElementById("service").value;
  const staffName = document.getElementById("staffName").value;
  const date = selectedDate;
  const time = selectedTime;

  if (!service || !staffName || !date || !time) {
    alert("サービス・担当者・日付・時間を選択してください");
    return;
  }

  document.getElementById("confirmService").textContent = service;
  document.getElementById("confirmStaff").textContent = staffName;
  document.getElementById("confirmDate").textContent = date;
  document.getElementById("confirmTime").textContent = time;

  const nameInput = document.getElementById("name");
  if (nameInput && !nameInput.value && displayName) {
    nameInput.value = displayName;
  }

  showScreen("confirm");
}

function updateLiveSummary() {
  const serviceText = selectedServiceName || "-";
  const staffText = selectedStaffName || "-";
  const dateTimeText = selectedDate && selectedTime
    ? `${selectedDate} / ${selectedTime}`
    : selectedDate
      ? `${selectedDate}`
      : "-";

  const s1 = document.getElementById("liveSummaryService");
  const s2 = document.getElementById("liveSummaryStaff");
  const s3 = document.getElementById("liveSummaryDateTime");

  if (s1) s1.textContent = serviceText;
  if (s2) s2.textContent = staffText;
  if (s3) s3.textContent = dateTimeText;
}

function clearForm() {
  const nameInput = document.getElementById("name");
  const phoneInput = document.getElementById("phone");

  if (nameInput) nameInput.value = displayName || "";
  if (phoneInput) phoneInput.value = "";

  document.getElementById("service").value = "";
  document.getElementById("serviceId").value = "";
  document.getElementById("staffId").value = "";
  document.getElementById("staffName").value = "";

  selectedCategory = "";
  selectedServiceName = "";
  selectedServiceId = "";
  selectedStaffId = "";
  selectedStaffName = "";
  selectedDate = "";
  selectedTime = "";

  document.querySelectorAll(".service-card").forEach((el) => {
    el.classList.remove("active-service");
  });

  const serviceList = document.getElementById("serviceList");
  if (serviceList) serviceList.innerHTML = "";

  renderCategories();
  renderStaffStep1();
  renderDateOptions();
  renderTimeOptions();
  renderStaffStep2();
  updateLiveSummary();
}

function submitForm() {
  const name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const serviceName = document.getElementById("service").value;
  const serviceId = document.getElementById("serviceId").value;
  const staffId = document.getElementById("staffId").value;
  const staffName = document.getElementById("staffName").value;
  const date = selectedDate;
  const time = selectedTime;

  if (!serviceName || !serviceId || !staffId || !staffName || !date || !time) {
    alert("先に予約内容を選択してください");
    showScreen("bookingStep1");
    return;
  }

  if (!phone) {
    alert("電話番号を入力してください");
    return;
  }

  fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({
      name,
      phone,
      userId,
      staffId,
      staffName,
      serviceId,
      serviceName,
      date,
      time: normalizeTimeClient(time)
    })
  })
    .then(async (res) => {
      const result = await res.json();

      if (result.status === "error") {
        await loadBookings();
        renderTimeOptions();
        renderStaffStep2();
        alert("この時間はすでに予約されています");
        return;
      }

      document.getElementById("successService").textContent = serviceName;
      document.getElementById("successStaff").textContent = staffName;
      document.getElementById("successDateTime").textContent = `${date} / ${time}`;

      await loadBookings();
      clearForm();
      showScreen("success");
    })
    .catch((err) => {
      console.log("Submit error:", err);
      alert("送信エラー");
    });
}

function resetAndGoStart() {
  clearForm();
  showScreen("bookingStep1");
}