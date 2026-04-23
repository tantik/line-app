const CONFIG = {
  LIFF_ID: "2009586903-hyNXZaW7",
  BUSINESS_LABEL: "Salon",
  DATE_RANGE_DAYS: 60,
  INITIAL_VISIBLE_DAYS: 14,
  LOAD_MORE_DAYS_STEP: 14,
  SAME_DAY_BLOCK_MINUTES: 20,
  CACHE_TTL_MS: 3 * 60 * 1000,
};

const cacheStore = {
  catalog: { data: null, ts: 0 },
  slots: new Map(),
};

let userId = "";
let displayName = "";

let services = [];
let staff = [];

let selectedService = null;
let selectedStaff = null;
let selectedDate = "";
let selectedTime = "";

let visibleDaysCount = CONFIG.INITIAL_VISIBLE_DAYS;
let initDone = false;

/**
 * availableSlotsState:
 * {
 *   date: "2026-04-23",
 *   serviceId: "...",
 *   preferredStaffId: "...|null",
 *   slots: [
 *     {
 *       time: "10:00",
 *       staffIds: ["..."],
 *       staffMap: Map<string, staffObj>
 *     }
 *   ]
 * }
 */
let availableSlotsState = {
  date: "",
  serviceId: "",
  preferredStaffId: "",
  slots: [],
};

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
      location.hostname === "127.0.0.1" || location.hostname === "localhost";

    if (isLocalhost) {
      console.log("DEV MODE: localhost detected, LINE login bypass enabled");
      userId = "dev-user";
      displayName = "Dev User";

      fillInitialProfileFields();
      bindPhoneInput();

      await loadCatalog(true);
      renderAllBookingState();
      showScreen("screenWelcome");
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

    await loadCatalog(true);
    renderAllBookingState();
    showScreen("screenWelcome");
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
    invalidateSlotsSelection();
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

/* -------------------- cache -------------------- */

function getCache(key) {
  if (key === "catalog") {
    const item = cacheStore.catalog;
    if (!item?.data) return null;
    if (Date.now() - item.ts > CONFIG.CACHE_TTL_MS) return null;
    return item.data;
  }

  return null;
}

function setCache(key, data) {
  if (key === "catalog") {
    cacheStore.catalog = {
      data,
      ts: Date.now(),
    };
  }
}

function getSlotsCacheKey({ date, serviceId, staffId }) {
  return JSON.stringify({
    date: String(date || ""),
    serviceId: String(serviceId || ""),
    staffId: String(staffId || ""),
  });
}

function getSlotsCache(params) {
  const key = getSlotsCacheKey(params);
  const item = cacheStore.slots.get(key);
  if (!item?.data) return null;
  if (Date.now() - item.ts > CONFIG.CACHE_TTL_MS) {
    cacheStore.slots.delete(key);
    return null;
  }
  return item.data;
}

function setSlotsCache(params, data) {
  const key = getSlotsCacheKey(params);
  cacheStore.slots.set(key, {
    data,
    ts: Date.now(),
  });
}

function clearSlotsCache() {
  cacheStore.slots.clear();
}

/* -------------------- env / supabase -------------------- */

function getSupabase() {
  return window.supabaseClient || null;
}

function getEnv() {
  return window.__APP_ENV__ || window.appEnv || null;
}

function getSalonSlug() {
  return getEnv()?.SALON_SLUG || "mirawi-demo";
}

/* -------------------- mappers -------------------- */

function normalizeServiceRow(row) {
  return {
    serviceId:
      row.id ??
      row.service_id ??
      row.serviceId ??
      null,
    name:
      row.name ??
      row.service_name ??
      "サービス",
    description:
      row.description ??
      row.note ??
      "",
    duration:
      Number(
        row.durationMinutes ??
          row.duration_minutes ??
          row.duration ??
          row.minutes ??
          30
      ) || 30,
    price:
      Number(
        row.priceJpy ??
          row.price_jpy ??
          row.price ??
          row.base_price ??
          row.amount ??
          0
      ) || 0,
    category:
      row.category ?? null,
    image:
      row.imageUrl ??
      row.image_url ??
      row.image ??
      row.photo ??
      null,
  };
}

function normalizeStaffRow(row) {
  return {
    staffId:
      row.id ??
      row.staff_id ??
      row.staffId ??
      null,
    name:
      row.name ??
      row.staff_name ??
      "Staff",
    startTime: normalizeTime(
      row.startTime ??
        row.start_time ??
        row.work_start ??
        "10:00"
    ),
    endTime: normalizeTime(
      row.endTime ??
        row.end_time ??
        row.work_end ??
        "19:00"
    ),
    workDays:
      row.workDays ??
      row.work_days ??
      row.working_days ??
      "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
    services: normalizeStaffServiceIds(row),
    image:
      row.photoUrl ??
      row.photo_url ??
      row.image ??
      row.image_url ??
      row.photo ??
      null,
    slotMinutes:
      Number(row.slotMinutes ?? row.slot_minutes ?? 30) || 30,
  };
}

function normalizeStaffServiceIds(row) {
  if (Array.isArray(row.serviceIds)) return row.serviceIds;
  if (Array.isArray(row.service_ids)) return row.service_ids;
  if (Array.isArray(row.services)) return row.services;

  if (typeof row.services === "string") {
    return row.services
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeSlotRow(row) {
  const time =
    normalizeTime(
      row.time ??
        row.start_time ??
        row.startTime ??
        row.slot_time ??
        ""
    ) || "";

  const staffIdsRaw =
    row.staff_ids ??
    row.staffIds ??
    row.available_staff_ids ??
    row.matching_staff_ids ??
    row.staff_id ??
    row.staffId ??
    [];

  let staffIds = [];

  if (Array.isArray(staffIdsRaw)) {
    staffIds = staffIdsRaw.map(String);
  } else if (staffIdsRaw) {
    staffIds = [String(staffIdsRaw)];
  }

  return {
    time,
    staffIds,
  };
}

/* -------------------- catalog loading -------------------- */

async function loadCatalog(useCache = true) {
  const cached = useCache ? getCache("catalog") : null;
  if (cached) {
    services = cached.services || [];
    staff = cached.staff || [];
    return;
  }

  const sb = getSupabase();
  if (!sb) {
    throw new Error("Supabase client is not available");
  }

  const { data, error } = await sb.rpc("public_catalog", {
    p_salon_slug: getSalonSlug(),
  });

  if (error) {
    throw error;
  }

  const serviceList = Array.isArray(data?.services)
    ? data.services
    : Array.isArray(data)
    ? data
    : [];

  const staffList = Array.isArray(data?.staff)
    ? data.staff
    : Array.isArray(data?.staff_members)
    ? data.staff_members
    : [];

  services = serviceList.map(normalizeServiceRow);
  staff = staffList.map(normalizeStaffRow);

  setCache("catalog", {
    services,
    staff,
  });
}

/* -------------------- available slots -------------------- */

async function ensureAvailableSlotsLoaded(force = false, silent = false) {
  if (!selectedService || !selectedDate) {
    availableSlotsState = {
      date: "",
      serviceId: "",
      preferredStaffId: "",
      slots: [],
    };
    return;
  }

  const params = {
    date: selectedDate,
    serviceId: selectedService.serviceId,
    staffId: selectedStaff?.staffId || null,
  };

  const cached = !force ? getSlotsCache(params) : null;
  if (cached) {
    availableSlotsState = cached;
    return;
  }

  const sb = getSupabase();
  if (!sb) {
    throw new Error("Supabase client is not available");
  }

  if (!silent) {
    setInlineTimeLoading(true, "空き状況を確認中...");
  }

  try {
    const rpcPayloadCandidates = [
      {
        p_salon_slug: getSalonSlug(),
        p_service_id: selectedService.serviceId,
        p_date: selectedDate,
        p_staff_id: selectedStaff?.staffId || null,
      },
      {
        p_salon_slug: getSalonSlug(),
        p_service_id: selectedService.serviceId,
        p_booking_date: selectedDate,
        p_staff_id: selectedStaff?.staffId || null,
      },
    ];

    let lastError = null;
    let data = null;

    for (const payload of rpcPayloadCandidates) {
      const res = await sb.rpc("available_slots", payload);
      if (!res.error) {
        data = res.data;
        lastError = null;
        break;
      }
      lastError = res.error;
    }

    if (lastError) {
      throw lastError;
    }

    const rawSlots = Array.isArray(data?.slots)
      ? data.slots
      : Array.isArray(data)
      ? data
      : [];

    const normalizedSlots = rawSlots
      .map(normalizeSlotRow)
      .filter((slot) => !!slot.time);

    const staffMapById = new Map(staff.map((member) => [String(member.staffId), member]));

    const enrichedSlots = normalizedSlots.map((slot) => {
      const resolvedStaffIds =
        slot.staffIds.length > 0
          ? slot.staffIds
          : inferStaffIdsForTimeFallback(slot.time);

      const uniqueStaffIds = [...new Set(resolvedStaffIds.map(String))];
      const slotStaffMap = new Map();

      uniqueStaffIds.forEach((id) => {
        const member = staffMapById.get(String(id));
        if (member) {
          slotStaffMap.set(String(id), member);
        }
      });

      return {
        time: slot.time,
        staffIds: uniqueStaffIds,
        staffMap: slotStaffMap,
      };
    });

    availableSlotsState = {
      date: selectedDate,
      serviceId: String(selectedService.serviceId),
      preferredStaffId: selectedStaff?.staffId ? String(selectedStaff.staffId) : "",
      slots: enrichedSlots,
    };

    setSlotsCache(params, availableSlotsState);
  } finally {
    if (!silent) {
      setInlineTimeLoading(false);
    }
  }
}

function inferStaffIdsForTimeFallback(time) {
  if (!selectedService || !selectedDate || !time) return [];

  return getCandidateStaffForSelectedService()
    .filter((member) => {
      if (selectedStaff && String(member.staffId) !== String(selectedStaff.staffId)) {
        return false;
      }

      if (!isStaffWorkingOnDate(member, selectedDate)) {
        return false;
      }

      const duration = Number(selectedService.duration || 0);
      const start = timeToMinutes(time);
      const end = start + duration;
      const memberStart = timeToMinutes(member.startTime);
      const memberEnd = timeToMinutes(member.endTime);

      return start >= memberStart && end <= memberEnd;
    })
    .map((member) => String(member.staffId));
}

function invalidateSlotsSelection() {
  availableSlotsState = {
    date: "",
    serviceId: "",
    preferredStaffId: "",
    slots: [],
  };
}

function getAvailableTimes() {
  return Array.isArray(availableSlotsState.slots)
    ? availableSlotsState.slots.map((slot) => slot.time)
    : [];
}

function getSlotByTime(time) {
  return availableSlotsState.slots.find((slot) => slot.time === time) || null;
}

function isTimeAvailable(time) {
  return !!getSlotByTime(time);
}

function getAvailableStaffForSelectedTime() {
  if (!selectedTime) return [];

  const slot = getSlotByTime(selectedTime);
  if (!slot) return [];

  const result = [];
  slot.staffIds.forEach((id) => {
    const member = slot.staffMap.get(String(id));
    if (member) result.push(member);
  });

  return result;
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
  invalidateSlotsSelection();
}

function reconcileSelectionState() {
  if (
    selectedService &&
    selectedStaff &&
    !staffCanDoService(selectedStaff, selectedService.serviceId)
  ) {
    selectedStaff = null;
    selectedTime = "";
    invalidateSlotsSelection();
  }

  if (
    selectedStaff &&
    selectedDate &&
    !isStaffWorkingOnDate(selectedStaff, selectedDate)
  ) {
    selectedDate = "";
    selectedTime = "";
    invalidateSlotsSelection();
  }

  if (selectedTime && !isTimeAvailable(selectedTime)) {
    selectedTime = "";
  }

  if (
    selectedTime &&
    selectedStaff &&
    !getAvailableStaffForSelectedTime()
      .map((member) => String(member.staffId))
      .includes(String(selectedStaff.staffId))
  ) {
    selectedStaff = null;
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

  try {
    await ensureAvailableSlotsLoaded(true, false);
  } catch (error) {
    console.log("available_slots reload error:", error);
    alert("空き状況の確認に失敗しました");
    return;
  }

  const availableStaffIds = getAvailableStaffForSelectedTime().map((member) =>
    String(member.staffId)
  );

  if (!availableStaffIds.includes(String(selectedStaff.staffId))) {
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

    const imageUrl = service.image || "";
    const visual = imageUrl
      ? `<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(service.name || "")}">`
      : `${escapeHtml(getServiceVisual(service.name))}`;

    card.innerHTML = `
      <div class="service-visual">${visual}</div>
      <div class="service-meta">✂ サービス</div>
      <h3>${escapeHtml(service.name || "-")}</h3>
      <div class="service-sub">${escapeHtml(String(service.duration || 0))}分</div>
      <div class="service-price">¥${escapeHtml(String(service.price || 0))}</div>
    `;

    card.addEventListener("click", () => {
      const isSame =
        selectedService &&
        String(selectedService.serviceId) === String(service.serviceId);

      selectedService = isSame ? null : service;

      if (
        selectedStaff &&
        selectedService &&
        !staffCanDoService(selectedStaff, selectedService.serviceId)
      ) {
        selectedStaff = null;
      }

      selectedTime = "";
      invalidateSlotsSelection();
      reconcileSelectionState();
      renderAllBookingState();
    });

    el.appendChild(card);
  });

  if (!filtered.length) {
    el.innerHTML = `
      <div class="empty-state">この担当者が対応できるサービスがありません</div>
    `;
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

    const imageUrl = member.image || "";
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
      invalidateSlotsSelection();
      reconcileSelectionState();
      renderAllBookingState();
    });

    box.appendChild(card);
  });

  if (!filtered.length) {
    box.innerHTML = `<div class="empty-state">このサービスに対応できる担当者がいません</div>`;
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

    const selectable = isDateSelectable(value);
    if (!selectable) item.classList.add("disabled");

    item.innerHTML = `
      <div class="date-week">${weekdays[d.getDay()]}</div>
      <div class="date-main">${mm}/${dd}</div>
    `;

    item.addEventListener("click", async () => {
      if (!selectable) return;

      const isSame = selectedDate === value;
      selectedDate = isSame ? "" : value;
      selectedTime = "";

      invalidateSlotsSelection();

      if (!selectedDate) {
        reconcileSelectionState();
        renderAllBookingState();
        return;
      }

      const slotHint = document.getElementById("slotHint");
      if (slotHint) slotHint.textContent = "空き状況を確認しています";

      try {
        await ensureAvailableSlotsLoaded(false, false);
      } catch (error) {
        console.log("available_slots error:", error);
        alert("空き状況の取得に失敗しました");
        invalidateSlotsSelection();
      }

      if (slotHint) slotHint.textContent = "時間を選択してください";

      reconcileSelectionState();
      renderAllBookingState();
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

  const times = getAvailableTimes().filter((time) => !isTimeBlockedByNow(selectedDate, time));

  if (!times.length) {
    box.innerHTML = `この日に利用できる時間がありません`;
    box.classList.add("empty-state");
    return;
  }

  times.forEach((time) => {
    const item = document.createElement("div");
    item.className = "time-item";

    const available = isTimeAvailable(time);
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

      if (
        selectedStaff &&
        selectedTime &&
        !getAvailableStaffForSelectedTime()
          .map((member) => String(member.staffId))
          .includes(String(selectedStaff.staffId))
      ) {
        selectedStaff = null;
      }

      reconcileSelectionState();
      renderTimeOptions();
      renderStaffStep2();
      updateSummary();
    });

    box.appendChild(item);
  });
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

  const filtered = getAvailableStaffForSelectedTime();

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

    const imageUrl = member.image || "";
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

/* -------------------- submit booking: Supabase -------------------- */

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

  const sb = getSupabase();
  if (!sb) {
    alert("Supabase client が見つかりません");
    return;
  }

  try {
    setLoading(true, "送信中...", "予約内容を確定しています");

    const { data, error } = await sb.rpc("create_public_booking", {
      p_salon_slug: getSalonSlug(),
      p_service_id: selectedService.serviceId,
      p_staff_id: selectedStaff.staffId,
      p_booking_date: selectedDate,
      p_start_time: selectedTime,
      p_customer_name: name,
      p_customer_phone: phone,
      p_line_user_id: userId || null,
      p_source: "mini_app",
    });

    console.log("create_public_booking result:", data, error);

    if (error) {
      const message = String(error.message || "");

      if (
        message.includes("slot_unavailable") ||
        message.includes("duplicate_booking") ||
        message.includes("overlapping")
      ) {
        await ensureAvailableSlotsLoaded(true, true);
        selectedTime = "";
        reconcileSelectionState();
        renderAllBookingState();
        alert("この時間は予約できません。別の時間を選んでください。");
        return;
      }

      alert(`予約エラー: ${error.message}`);
      return;
    }

    document.getElementById("successDate").textContent = selectedDate;
    document.getElementById("successTime").textContent = selectedTime;
    document.getElementById("successService").textContent = selectedService.name;
    document.getElementById("successStaff").textContent = selectedStaff.name;

    await ensureAvailableSlotsLoaded(true, true);
    showScreen("screenSuccess");
  } catch (err) {
    console.log("Submit error:", err);
    alert("送信エラー");
  } finally {
    setLoading(false);
  }
}

/* -------------------- submit lead: Supabase -------------------- */

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

  const sb = getSupabase();
  if (!sb) {
    alert("Supabase client が見つかりません");
    return;
  }

  try {
    setLoading(true, "送信中...", "ご相談内容を送信しています");

    const { error } = await sb.rpc("create_public_lead", {
      p_salon_slug: getSalonSlug(),
      p_contact_name: ownerName,
      p_salon_name: salonName,
      p_contact_channel: contact,
      p_business_type: businessType || null,
      p_message: needs || null,
      p_source: "mini_app",
      p_line_user_id: userId || null,
    });

    if (error) {
      console.log("create_public_lead error:", error);
      alert(`送信に失敗しました: ${error.message}`);
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

function normalizeTime(value) {
  const str = String(value || "").trim();
  if (!str) return "";
  if (/^\d:\d{2}$/.test(str)) return `0${str}`;
  return str.slice(0, 5);
}

function timeToMinutes(value) {
  const normalized = normalizeTime(value);
  if (!normalized) return 0;

  const [h, m] = normalized.split(":").map(Number);
  return h * 60 + m;
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