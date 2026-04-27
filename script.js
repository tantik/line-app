const CONFIG = {
  LIFF_ID: "2009586903-hyNXZaW7",
  BUSINESS_LABEL: "Salon",
  DATE_RANGE_DAYS: 60,
  INITIAL_VISIBLE_DAYS: 14,
  LOAD_MORE_DAYS_STEP: 14,
  SAME_DAY_BLOCK_MINUTES: 20,
  CACHE_TTL_MS: 3 * 60 * 1000,
  FALLBACK_SALON_ID: "e840e2b0-2d49-4899-b6d2-f2afe895ad1e",
};

const cacheStore = {
  catalog: { data: null, ts: 0 },
  slots: new Map(),
};

let userId = "";
let displayName = "";
let salonId = "";
let services = [];
let staff = [];
let selectedService = null;
let selectedStaff = null;
let selectedDate = "";
let selectedTime = "";
let visibleDaysCount = CONFIG.INITIAL_VISIBLE_DAYS;
let initDone = false;

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

async function init() {
  if (initDone) return;
  initDone = true;

  setLoading(true, "読み込み中...", "予約情報を準備しています");

  try {
    const isLocalhost = location.hostname === "127.0.0.1" || location.hostname === "localhost";

    if (isLocalhost || typeof liff === "undefined") {
      console.log("DEV MODE: LIFF login bypass enabled");
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
    console.error("init error:", error);
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

function bindStaticEvents() {
  document.getElementById("btnStartDemo")?.addEventListener("click", startDemoFlow);
  document.getElementById("btnOpenInfo")?.addEventListener("click", () => showScreen("screenInfo"));
  document.getElementById("btnOpenLead")?.addEventListener("click", openLeadScreen);
  document.getElementById("btnOpenAdmin")?.addEventListener("click", openAdminDemo);
  document.getElementById("btnInfoStartDemo")?.addEventListener("click", startDemoFlow);
  document.getElementById("btnSubmitLead")?.addEventListener("click", submitLeadForm);
  document.getElementById("btnGoDateTime")?.addEventListener("click", goDateTimeStep);
  document.getElementById("btnGoConfirm")?.addEventListener("click", goConfirmStep);
  document.getElementById("btnSubmitBooking")?.addEventListener("click", submitBooking);
  document.getElementById("btnSuccessLead")?.addEventListener("click", openLeadScreen);
  document.getElementById("btnSuccessRestart")?.addEventListener("click", resetAndGoWelcome);
  document.getElementById("loadMoreDatesBtn")?.addEventListener("click", loadMoreDates);

  document.getElementById("btnClearStaffInline")?.addEventListener("click", async () => {
    selectedStaff = null;
    selectedTime = "";
    invalidateSlotsSelection();
    await reloadSlotsIfReady(false);
    reconcileSelectionState();
    renderAllBookingState();
  });

  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-back");
      if (target) showScreen(target);
    });
  });
}

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

function setLoading(show, title = "読み込み中...", text = "少々お待ちください") {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;

  const titleEl = overlay.querySelector(".loading-title");
  const textEl = overlay.querySelector(".loading-text");

  if (titleEl) titleEl.textContent = title;
  if (textEl) textEl.textContent = text;

  overlay.classList.toggle("active", Boolean(show));
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

function getSupabase() {
  return window.supabaseClient || null;
}

function getEnv() {
  return window.__APP_ENV__ || window.appEnv || {};
}

function getSalonSlug() {
  return getEnv().SALON_SLUG || "mirawi-demo";
}

function getCache(key) {
  if (key !== "catalog") return null;

  const item = cacheStore.catalog;
  if (!item?.data) return null;
  if (Date.now() - item.ts > CONFIG.CACHE_TTL_MS) return null;

  return item.data;
}

function setCache(key, data) {
  if (key !== "catalog") return;

  cacheStore.catalog = {
    data,
    ts: Date.now(),
  };
}

function getSlotsCacheKey(params) {
  return JSON.stringify({
    date: String(params.date || ""),
    serviceId: String(params.serviceId || ""),
    staffId: String(params.staffId || "ALL"),
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

function normalizeServiceRow(row) {
  return {
    serviceId: row.id ?? row.service_id ?? row.serviceId ?? null,
    name: row.name ?? row.service_name ?? "サービス",
    description: row.description ?? row.note ?? "",
    duration: Number(row.durationMinutes ?? row.duration_minutes ?? row.duration ?? row.minutes ?? 30) || 30,
    price: Number(row.priceJpy ?? row.price_jpy ?? row.price ?? row.base_price ?? row.amount ?? 0) || 0,
    category: row.category ?? null,
    image: row.imageUrl ?? row.image_url ?? row.image ?? row.photo ?? row.photo_url ?? null,
    isActive: row.is_active !== false,
  };
}

function normalizeStaffRow(row) {
  return {
    staffId: row.id ?? row.staff_id ?? row.staffId ?? null,
    name: row.name ?? row.staff_name ?? "Staff",
    startTime: normalizeTime(row.startTime ?? row.start_time ?? row.work_start ?? "10:00"),
    endTime: normalizeTime(row.endTime ?? row.end_time ?? row.work_end ?? "19:00"),
    workDays: row.workDays ?? row.work_days ?? row.working_days ?? "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
    services: normalizeStaffServiceIds(row),
    image: row.photoUrl ?? row.photo_url ?? row.image ?? row.image_url ?? row.photo ?? null,
    slotMinutes: Number(row.slotMinutes ?? row.slot_minutes ?? 30) || 30,
    isActive: row.is_active !== false,
  };
}

function normalizeStaffServiceIds(row) {
  if (Array.isArray(row.serviceIds)) return row.serviceIds.map(String);
  if (Array.isArray(row.service_ids)) return row.service_ids.map(String);
  if (Array.isArray(row.services)) return row.services.map(String);

  if (typeof row.services === "string") {
    return row.services
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return [];
}

async function resolveSalonIdFromDatabase() {
  if (salonId) return salonId;

  const envSalonId = getEnv().SALON_ID;
  if (envSalonId) {
    salonId = envSalonId;
    return salonId;
  }

  const sb = getSupabase();
  if (!sb) {
    salonId = CONFIG.FALLBACK_SALON_ID;
    return salonId;
  }

  try {
    const { data, error } = await sb
      .from("salons")
      .select("id")
      .eq("slug", getSalonSlug())
      .limit(1)
      .maybeSingle();

    if (!error && data?.id) {
      salonId = data.id;
      return salonId;
    }
  } catch (error) {
    console.warn("resolveSalonId fallback:", error);
  }

  salonId = CONFIG.FALLBACK_SALON_ID;
  return salonId;
}

async function loadCatalog(useCache = true) {
  const cached = useCache ? getCache("catalog") : null;

  if (cached) {
    salonId = cached.salonId || salonId;
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

  if (error) throw error;

  const rawServices = Array.isArray(data?.services) ? data.services : Array.isArray(data) ? data : [];
  const rawStaff = Array.isArray(data?.staff)
    ? data.staff
    : Array.isArray(data?.staff_members)
      ? data.staff_members
      : [];

  salonId = data?.salon?.id || data?.salon_id || data?.salonId || salonId || "";

  if (!salonId) {
    await resolveSalonIdFromDatabase();
  }

  services = rawServices.map(normalizeServiceRow).filter((service) => service.serviceId && service.isActive);
  staff = rawStaff.map(normalizeStaffRow).filter((member) => member.staffId && member.isActive);

  setCache("catalog", {
    salonId,
    services,
    staff,
  });
}

async function fetchAvailableSlotsForStaff(member) {
  if (!selectedService || !selectedDate || !member?.staffId) return [];

  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client is not available");

  const activeSalonId = await resolveSalonIdFromDatabase();

  const { data, error } = await sb.rpc("available_slots_v2", {
    p_salon_id: activeSalonId,
    p_staff_id: member.staffId,
    p_service_id: selectedService.serviceId,
    p_date: selectedDate,
  });

  if (error) throw error;

  const rawSlots = Array.isArray(data?.slots) ? data.slots : Array.isArray(data) ? data : [];

  return rawSlots
    .map((item) => normalizeTime(typeof item === "string" ? item : item?.time || item?.start_time || ""))
    .filter(Boolean)
    .map((time) => ({
      time,
      staffIds: [String(member.staffId)],
    }));
}

async function ensureAvailableSlotsLoaded(force = false, silent = false) {
  if (!selectedService || !selectedDate) {
    invalidateSlotsSelection();
    return;
  }

  const params = {
    date: selectedDate,
    serviceId: selectedService.serviceId,
    staffId: selectedStaff?.staffId || "ALL",
  };

  const cached = !force ? getSlotsCache(params) : null;
  if (cached) {
    availableSlotsState = cached;
    return;
  }

  if (!silent) {
    setInlineTimeLoading(true, "空き状況を確認中...");
  }

  try {
    const candidates = selectedStaff
      ? [selectedStaff]
      : getCandidateStaffForSelectedService().filter((member) => isStaffWorkingOnDate(member, selectedDate));

    const staffMapById = new Map(staff.map((member) => [String(member.staffId), member]));
    const mergedByTime = new Map();

    for (const member of candidates) {
      const memberSlots = await fetchAvailableSlotsForStaff(member);

      memberSlots.forEach((slot) => {
        if (!mergedByTime.has(slot.time)) {
          mergedByTime.set(slot.time, new Set());
        }

        const staffSet = mergedByTime.get(slot.time);
        slot.staffIds.forEach((id) => staffSet.add(String(id)));
        staffSet.add(String(member.staffId));
      });
    }

    const slots = Array.from(mergedByTime.entries())
      .sort((a, b) => timeToMinutes(a[0]) - timeToMinutes(b[0]))
      .map(([time, staffIdSet]) => {
        const staffIds = Array.from(staffIdSet);
        const staffMap = new Map();

        staffIds.forEach((id) => {
          const member = staffMapById.get(String(id));
          if (member) staffMap.set(String(id), member);
        });

        return {
          time,
          staffIds,
          staffMap,
        };
      });

    availableSlotsState = {
      date: selectedDate,
      serviceId: String(selectedService.serviceId),
      preferredStaffId: selectedStaff?.staffId ? String(selectedStaff.staffId) : "",
      slots,
    };

    setSlotsCache(params, availableSlotsState);
  } finally {
    if (!silent) setInlineTimeLoading(false);
  }
}

function invalidateSlotsSelection() {
  availableSlotsState = {
    date: "",
    serviceId: "",
    preferredStaffId: "",
    slots: [],
  };
}

async function reloadSlotsIfReady(force = false) {
  if (!selectedService || !selectedDate) {
    invalidateSlotsSelection();
    return;
  }

  try {
    await ensureAvailableSlotsLoaded(force, false);
  } catch (error) {
    console.error("available_slots_v2 error:", error);
    invalidateSlotsSelection();
    toast("空き状況の取得に失敗しました");
  }
}

function getAvailableTimes() {
  if (!Array.isArray(availableSlotsState.slots)) return [];

  if (!selectedStaff) {
    return availableSlotsState.slots.map((slot) => slot.time);
  }

  return availableSlotsState.slots
    .filter((slot) => slot.staffIds.map(String).includes(String(selectedStaff.staffId)))
    .map((slot) => slot.time);
}

function getSlotByTime(time) {
  return availableSlotsState.slots.find((slot) => slot.time === time) || null;
}

function isTimeAvailable(time) {
  return Boolean(getSlotByTime(time));
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
  if (selectedService && selectedStaff && !staffCanDoService(selectedStaff, selectedService.serviceId)) {
    selectedStaff = null;
    selectedTime = "";
    invalidateSlotsSelection();
  }

  if (selectedStaff && selectedDate && !isStaffWorkingOnDate(selectedStaff, selectedDate)) {
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
    console.error("available_slots reload error:", error);
    alert("空き状況の確認に失敗しました");
    return;
  }

  const availableStaffIds = getAvailableStaffForSelectedTime().map((member) => String(member.staffId));

  if (!availableStaffIds.includes(String(selectedStaff.staffId))) {
    selectedTime = "";
    reconcileSelectionState();
    renderAllBookingState();
    alert("選択した時間が埋まっていました。もう一度お選びください。");
    return;
  }

  setTextContent("confirmService", `${selectedService.name} ¥${selectedService.price}`);
  setTextContent("confirmStaff", selectedStaff.name || "-");
  setTextContent("confirmDate", selectedDate || "-");
  setTextContent("confirmTime", selectedTime || "-");

  showScreen("screenBookingStep3");
}

function getCandidateServicesForSelectedStaff() {
  if (!selectedStaff) return [...services];
  return services.filter((service) => staffCanDoService(selectedStaff, service.serviceId));
}

function getCandidateStaffForSelectedService() {
  if (!selectedService) return [...staff];
  return staff.filter((member) => staffCanDoService(member, selectedService.serviceId));
}

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

    if (selectedService && String(selectedService.serviceId) === String(service.serviceId)) {
      card.classList.add("active");
    }

    const imageUrl = getSafeImageUrl(service.image);
    const visual = imageUrl
      ? `<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(service.name || "service")}" loading="lazy">`
      : `<span>${escapeHtml(getServiceVisual(service.name))}</span>`;

    card.innerHTML = `
      <div class="service-visual">${visual}</div>
      <div class="card-kicker">✂ サービス</div>
      <h3>${escapeHtml(service.name || "-")}</h3>
      <div class="card-meta">
        <span>${escapeHtml(String(service.duration || 0))}分</span>
        <span>¥${escapeHtml(String(service.price || 0))}</span>
      </div>
    `;

    card.addEventListener("click", async () => {
      const isSame = selectedService && String(selectedService.serviceId) === String(service.serviceId);
      selectedService = isSame ? null : service;

      if (selectedStaff && selectedService && !staffCanDoService(selectedStaff, selectedService.serviceId)) {
        selectedStaff = null;
      }

      selectedTime = "";
      invalidateSlotsSelection();

      if (selectedDate && selectedService) {
        await reloadSlotsIfReady(true);
      }

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

    if (selectedStaff && String(member.staffId) === String(selectedStaff.staffId)) {
      card.classList.add("active");
    }

    const imageUrl = getSafeImageUrl(member.image);
    const avatar = imageUrl
      ? `<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(member.name || "staff")}" loading="lazy">`
      : `<div class="staff-avatar-placeholder">${escapeHtml((member.name || "S").slice(0, 1))}</div>`;

    card.innerHTML = `
      <div class="staff-avatar">${avatar}</div>
      <strong>${escapeHtml(member.name || "-")}</strong>
      <small>${escapeHtml(member.startTime || "-")} - ${escapeHtml(member.endTime || "-")}</small>
    `;

    card.addEventListener("click", async () => {
      const isSame = selectedStaff && String(member.staffId) === String(selectedStaff.staffId);
      selectedStaff = isSame ? null : member;
      selectedTime = "";
      invalidateSlotsSelection();

      if (selectedDate && selectedService) {
        await reloadSlotsIfReady(true);
      }

      reconcileSelectionState();
      renderAllBookingState();
    });

    box.appendChild(card);
  });

  if (!filtered.length) {
    box.className = "empty-state";
    box.innerHTML = "このサービスに対応できる担当者がいません";
  }
}

function renderDateOptions() {
  const box = document.getElementById("dateList");
  const countLabel = document.getElementById("dateCountLabel");
  const moreBtn = document.getElementById("loadMoreDatesBtn");

  if (!box) return;

  box.innerHTML = "";

  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const today = new Date();
  const count = Math.min(visibleDaysCount, CONFIG.DATE_RANGE_DAYS);

  for (let i = 0; i < count; i += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);

    const value = toDateStringLocal(date);
    const item = document.createElement("div");
    item.className = "date-item";

    if (value === selectedDate) item.classList.add("active");

    const selectable = isDateSelectable(value);
    if (!selectable) item.classList.add("disabled");

    item.innerHTML = `
      <strong>${weekdays[date.getDay()]}</strong>
      <span>${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}</span>
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

      await reloadSlotsIfReady(false);

      if (slotHint) {
        slotHint.textContent = selectedStaff
          ? "時間を選択してください"
          : "時間を選択してください（あとで担当者も選べます）";
      }

      reconcileSelectionState();
      renderAllBookingState();
    });

    box.appendChild(item);
  }

  if (countLabel) countLabel.textContent = `${count}日表示`;
  if (moreBtn) moreBtn.classList.toggle("hidden", count >= CONFIG.DATE_RANGE_DAYS);
}

function isDateSelectable(dateValue) {
  if (!selectedService) return true;

  const candidates = selectedStaff
    ? staff.filter((member) => String(member.staffId) === String(selectedStaff.staffId))
    : getCandidateStaffForSelectedService();

  if (!candidates.length) return false;

  return candidates.some((member) => isStaffWorkingOnDate(member, dateValue));
}

function loadMoreDates() {
  visibleDaysCount = Math.min(visibleDaysCount + CONFIG.LOAD_MORE_DAYS_STEP, CONFIG.DATE_RANGE_DAYS);
  renderDateOptions();
}

function renderStep2IdleState() {
  const timeBox = document.getElementById("timeList");
  const staffBox = document.getElementById("staffListStep2");
  const slotHint = document.getElementById("slotHint");

  if (slotHint) slotHint.textContent = "日付を選択してください";

  if (timeBox) {
    timeBox.innerHTML = "先に日付を選択してください";
    timeBox.classList.add("empty-state");
  }

  if (staffBox) {
    staffBox.innerHTML = selectedService ? "時間を選ぶと表示されます" : "先にサービスを選択してください";
    staffBox.className = "empty-state";
  }
}

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

  if (slotHint) {
    slotHint.textContent = selectedStaff
      ? "時間を選択してください"
      : "時間を選択してください（あとで担当者も選べます）";
  }

  const times = getAvailableTimes().filter((time) => !isTimeBlockedByNow(selectedDate, time));

  if (!times.length) {
    box.innerHTML = "この日に利用できる時間がありません";
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
      <strong>${escapeHtml(time)}</strong>
      <span>${status}</span>
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

    if (selectedStaff && String(member.staffId) === String(selectedStaff.staffId)) {
      card.classList.add("active");
    }

    const imageUrl = getSafeImageUrl(member.image);
    const avatar = imageUrl
      ? `<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(member.name || "staff")}" loading="lazy">`
      : `<div class="staff-avatar-placeholder">${escapeHtml((member.name || "S").slice(0, 1))}</div>`;

    card.innerHTML = `
      <div class="staff-avatar">${avatar}</div>
      <strong>${escapeHtml(member.name || "-")}</strong>
      <small>${escapeHtml(member.startTime || "-")} - ${escapeHtml(member.endTime || "-")}</small>
    `;

    card.addEventListener("click", () => {
      const isSame = selectedStaff && String(member.staffId) === String(selectedStaff.staffId);
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

function updateSummary() {
  const serviceText = selectedService ? `${selectedService.name} ¥${selectedService.price}` : "-";
  const staffText = selectedStaff ? selectedStaff.name : "未選択";
  let dateTimeText = "-";

  if (selectedDate && selectedTime) {
    dateTimeText = `${selectedDate} / ${selectedTime}`;
  } else if (selectedDate) {
    dateTimeText = selectedDate;
  }

  setTextContent("liveSummaryService", serviceText);
  setTextContent("liveSummaryStaff", staffText);
  setTextContent("liveSummaryDateTime", dateTimeText);
}

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
    await ensureAvailableSlotsLoaded(true, true);

    const availableStaffIds = getAvailableStaffForSelectedTime().map((member) => String(member.staffId));
    if (!availableStaffIds.includes(String(selectedStaff.staffId))) {
      selectedTime = "";
      reconcileSelectionState();
      renderAllBookingState();
      alert("この時間は予約できません。別の時間を選んでください。");
      return;
    }

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

      if (message.includes("slot_unavailable") || message.includes("duplicate_booking")) {
        clearSlotsCache();
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

    setTextContent("successDate", selectedDate);
    setTextContent("successTime", selectedTime);
    setTextContent("successService", selectedService.name);
    setTextContent("successStaff", selectedStaff.name);

    clearSlotsCache();
    showScreen("screenSuccess");
  } catch (error) {
    console.error("submitBooking error:", error);
    alert("送信エラー");
  } finally {
    setLoading(false);
  }
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
      console.error("create_public_lead error:", error);
      alert(`送信に失敗しました: ${error.message}`);
      return;
    }

    clearLeadForm();
    showScreen("screenLeadSuccess");
  } catch (error) {
    console.error("submitLeadForm error:", error);
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
    el.value = id === "leadOwnerName" ? displayName || "" : "";
  });
}

function staffCanDoService(member, serviceId) {
  const arr = Array.isArray(member.services) ? member.services : [];
  if (!arr.length) return true;
  return arr.map(String).includes(String(serviceId));
}

function isStaffWorkingOnDate(member, date) {
  const daysMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dateObj = new Date(`${date}T00:00:00`);
  const dayCode = daysMap[dateObj.getDay()];
  const workDays = String(member.workDays || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!workDays.length) return true;
  return workDays.includes(dayCode);
}

function isTimeBlockedByNow(dateStr, timeStr) {
  const today = getTodayString();
  if (dateStr !== today) return false;

  const now = new Date();
  const [hours, minutes] = normalizeTime(timeStr).split(":").map(Number);
  const selectedDateTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hours,
    minutes,
    0,
    0
  );

  const diffMinutes = (selectedDateTime.getTime() - now.getTime()) / 60000;
  return diffMinutes < CONFIG.SAME_DAY_BLOCK_MINUTES;
}

function minutesToTime(minutesValue) {
  const hours = String(Math.floor(minutesValue / 60)).padStart(2, "0");
  const minutes = String(minutesValue % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function timeToMinutes(value) {
  const normalized = normalizeTime(value);
  if (!normalized || !normalized.includes(":")) return 0;

  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function normalizeTime(value) {
  const str = String(value || "").trim();
  if (!str) return "";

  const match = str.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";

  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
}

function getTodayString() {
  return toDateStringLocal(new Date());
}

function toDateStringLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getServiceVisual(name) {
  const value = String(name || "");

  if (value.includes("カット")) return "✂️";
  if (value.includes("カラー")) return "🎨";
  if (value.includes("ネイル")) return "💅";
  if (value.includes("パーマ")) return "✨";
  if (value.includes("トリートメント")) return "🫧";
  if (value.includes("ヘッドスパ")) return "🌿";

  return "✦";
}

function getSafeImageUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return "";
}

function setTextContent(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}