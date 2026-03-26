const LIFF_ID = "2009586903-hyNXZaW7";
const WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzJoMyVlYZAtHebdOry-bMi8U8Y1Got6CTML2Rbab3ry3bVKIkkieK1r73FzDotjm3j/exec";
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

async function init() {
  try {
    await liff.init({ liffId: LIFF_ID });

    if (liff.isLoggedIn()) {
      const profile = await liff.getProfile();
      userId = profile.userId;
      displayName = profile.displayName || "";
      console.log("User:", profile);

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
    renderStaff();
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

function renderStaff() {
  const box = document.getElementById("staffList");
  if (!box) return;

  box.innerHTML = "";

  staff.forEach((member) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "service-card staff-card";
    btn.innerHTML = `
      <img src="${member.photoUrl}" alt="${member.name}" class="staff-photo" />
      <span class="service-label">${member.name}</span>
      <small>${member.startTime} - ${member.endTime}</small>
    `;
    btn.onclick = () => selectStaff(member, btn);
    box.appendChild(btn);
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
}

function selectStaff(member, button) {
  selectedStaffId = member.staffId;
  selectedStaffName = member.name;

  document.getElementById("staffId").value = member.staffId;
  document.getElementById("staffName").value = member.name;

  document.querySelectorAll("#staffList .service-card").forEach((el) => {
    el.classList.remove("active-service");
  });

  button.classList.add("active-service");

  renderTimeOptions(member.startTime, member.endTime, member.slotMinutes);
}

function renderTimeOptions(startTime, endTime, slotMinutes) {
  const timeSelect = document.getElementById("time");
  const selectedDate = document.getElementById("date").value;

  if (!timeSelect) return;

  timeSelect.innerHTML = `<option value="">時間選択</option>`;

  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);

  let start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;

  const busySlots = bookings
    .filter((b) => String(b.staffId) === String(selectedStaffId) && b.date === selectedDate)
    .map((b) => b.time);

  while (start < end) {
    const hour = String(Math.floor(start / 60)).padStart(2, "0");
    const minute = String(start % 60).padStart(2, "0");
    const value = `${hour}:${minute}`;

    if (!busySlots.includes(value)) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      timeSelect.appendChild(option);
    }

    start += Number(slotMinutes);
  }
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

function goWelcome() {
  showScreen("welcome");
}

function goBooking() {
  showScreen("booking");
}

function goForm() {
  const nameInput = document.getElementById("name");
  if (nameInput && !nameInput.value && displayName) {
    nameInput.value = displayName;
  }
  showScreen("form");
}

function goConfirm() {
  const service = document.getElementById("service").value;
  const staffName = document.getElementById("staffName").value;
  const date = document.getElementById("date").value;
  const time = document.getElementById("time").value;

  if (!service || !staffName || !date || !time) {
    alert("サービス・スタッフ・日付・時間を選択してください");
    return;
  }

  document.getElementById("confirmService").textContent = `${service} / ${staffName}`;
  document.getElementById("confirmDate").textContent = date;
  document.getElementById("confirmTime").textContent = time;

  showScreen("confirm");
}

function finishBooking() {
  goForm();
}

function clearForm() {
  const nameInput = document.getElementById("name");
  const phoneInput = document.getElementById("phone");

  if (nameInput) {
    nameInput.value = displayName || "";
  }
  if (phoneInput) {
    phoneInput.value = "";
  }

  document.getElementById("service").value = "";
  document.getElementById("serviceId").value = "";
  document.getElementById("staffId").value = "";
  document.getElementById("staffName").value = "";
  document.getElementById("date").value = "";
  document.getElementById("time").value = "";

  selectedCategory = "";
  selectedServiceName = "";
  selectedServiceId = "";
  selectedStaffId = "";
  selectedStaffName = "";

  document.querySelectorAll(".service-card").forEach((el) => {
    el.classList.remove("active-service");
  });

  const serviceList = document.getElementById("serviceList");
  if (serviceList) serviceList.innerHTML = "";

  document.getElementById("confirmService").textContent = "-";
  document.getElementById("confirmDate").textContent = "-";
  document.getElementById("confirmTime").textContent = "-";
}

function submitForm() {
  const name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const serviceName = document.getElementById("service").value;
  const serviceId = document.getElementById("serviceId").value;
  const staffId = document.getElementById("staffId").value;
  const staffName = document.getElementById("staffName").value;
  const date = document.getElementById("date").value;
  const time = document.getElementById("time").value;

  if (!serviceName || !serviceId || !staffId || !staffName || !date || !time) {
    alert("先に予約内容を選択してください");
    goBooking();
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
      time
    })
  })
    .then(async () => {
      await loadBookings();
      clearForm();
      showScreen("success");
    })
    .catch((err) => {
      console.log("Submit error:", err);
      alert("送信エラー");
    });
}