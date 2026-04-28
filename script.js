"use strict";

/**
 * Mirawi / LINE Booking Mini App
 * Clean public booking script
 *
 * Main flow:
 * 1. LIFF / dev init
 * 2. Load salon catalog from Supabase
 * 3. Select service → staff → date → time
 * 4. Create booking through create_public_booking RPC
 * 5. Ask server to send LINE confirmation message
 */

const CONFIG = {
  LIFF_ID: "2009586903-hyNXZaW7",

  FALLBACK_SALON_ID: "e840e2b0-2d49-4899-b6d2-f2afe895ad1e",
  FALLBACK_SALON_SLUG: "mirawi-demo",

  DATE_RANGE_DAYS: 60,
  INITIAL_VISIBLE_DAYS: 14,
  LOAD_MORE_DAYS_STEP: 14,

  SAME_DAY_BLOCK_MINUTES: 20,
  CACHE_TTL_MS: 3 * 60 * 1000,

  DEBUG: true,
};

const state = {
  userId: "",
  displayName: "",

  salonId: "",

  services: [],
  staff: [],

  selectedService: null,
  selectedStaff: null,
  selectedDate: "",
  selectedTime: "",

  visibleDaysCount: CONFIG.INITIAL_VISIBLE_DAYS,

  availableSlots: {
    date: "",
    serviceId: "",
    staffId: "",
    slots: [],
  },

  catalogLoadedAt: 0,
  slotsCache: new Map(),

  initialized: false,
};

document.addEventListener("DOMContentLoaded", () => {
  bindStaticEvents();
  initApp();
});

/* =========================================================
   Init
========================================================= */

async function initApp() {
  if (state.initialized) return;
  state.initialized = true;

  setLoading(true, "読み込み中...", "予約情報を準備しています");

  try {
    await initLiffOrDevMode();
    fillInitialProfileFields();
    bindPhoneInput();

    await loadCatalog();

    renderAll();
    showScreen("screenWelcome");
  } catch (error) {
    console.error("initApp error:", error);
    alert(`初期化エラーが発生しました: ${error.message || error}`);
  } finally {
    setLoading(false);
  }
}

async function initLiffOrDevMode() {
  const isLocalhost =
    location.hostname === "localhost" || location.hostname === "127.0.0.1";

  if (isLocalhost || typeof window.liff === "undefined") {
    debugLog("DEV MODE: LIFF bypass");
    state.userId = "dev-user";
    state.displayName = "Dev User";
    return;
  }

  await window.liff.init({ liffId: CONFIG.LIFF_ID });

  if (!window.liff.isLoggedIn()) {
    window.liff.login();
    return;
  }

  const profile = await window.liff.getProfile();

  state.userId = profile?.userId || "";
  state.displayName = profile?.displayName || "";
}

/* =========================================================
   Environment / Supabase
========================================================= */

function getEnv() {
  return window.__APP_ENV__ || window.appEnv || {};
}

function getSalonSlug() {
  return getEnv().SALON_SLUG || CONFIG.FALLBACK_SALON_SLUG;
}

function getSupabaseClient() {
  if (window.supabaseClient) {
    return window.supabaseClient;
  }

  const env = getEnv();

  if (window.supabase && env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    window.supabaseClient = window.supabase.createClient(
      env.SUPABASE_URL,
      env.SUPABASE_ANON_KEY
    );

    return window.supabaseClient;
  }

  return null;
}

async function resolveSalonId() {
  if (state.salonId) return state.salonId;

  const env = getEnv();

  if (env.SALON_ID) {
    state.salonId = env.SALON_ID;
    return state.salonId;
  }

  const supabase = getSupabaseClient();

  if (!supabase) {
    state.salonId = CONFIG.FALLBACK_SALON_ID;
    return state.salonId;
  }

  const { data, error } = await supabase
    .from("salons")
    .select("id")
    .eq("slug", getSalonSlug())
    .maybeSingle();

  if (!error && data?.id) {
    state.salonId = data.id;
    return state.salonId;
  }

  state.salonId = CONFIG.FALLBACK_SALON_ID;
  return state.salonId;
}

/* =========================================================
   Data loading
========================================================= */

async function loadCatalog() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error("Supabase client is not available");
  }

  const salonId = await resolveSalonId();

  const [servicesResult, staffResult] = await Promise.all([
    supabase
      .from("services")
      .select("*")
      .eq("salon_id", salonId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),

    supabase
      .from("staff")
      .select("*")
      .eq("salon_id", salonId)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
  ]);

  if (servicesResult.error) throw servicesResult.error;
  if (staffResult.error) throw staffResult.error;

  state.services = (servicesResult.data || [])
    .map(normalizeService)
    .filter((service) => service.serviceId && service.isActive);

  state.staff = (staffResult.data || [])
    .map(normalizeStaff)
    .filter((member) => member.staffId && member.isActive);

  await hydrateStaffServiceMap();

  state.catalogLoadedAt = Date.now();

  debugLog("catalog loaded", {
    salonId,
    services: state.services,
    staff: state.staff,
  });
}

async function hydrateStaffServiceMap() {
  const supabase = getSupabaseClient();
  const salonId = await resolveSalonId();

  const staffIds = state.staff.map((member) => member.staffId).filter(Boolean);

  if (!supabase || staffIds.length === 0) return;

  const { data, error } = await supabase
    .from("staff_service_map")
    .select("staff_id, service_id")
    .eq("salon_id", salonId)
    .in("staff_id", staffIds);

  if (error) {
    console.warn("staff_service_map load warning:", error);
    return;
  }

  const map = new Map();

  (data || []).forEach((row) => {
    const staffId = String(row.staff_id);
    const serviceId = String(row.service_id);

    if (!map.has(staffId)) {
      map.set(staffId, []);
    }

    map.get(staffId).push(serviceId);
  });

  state.staff = state.staff.map((member) => ({
    ...member,
    services: map.get(String(member.staffId)) || member.services || [],
  }));

  debugLog("staff_service_map hydrated", state.staff);
}

/* =========================================================
   Normalizers
========================================================= */

function normalizeService(row) {
  return {
    serviceId: row.id ?? row.service_id ?? row.serviceId ?? "",
    name: row.name ?? row.service_name ?? "サービス",
    description: row.description ?? "",
    duration:
      Number(
        row.duration_minutes ??
          row.durationMinutes ??
          row.duration ??
          row.minutes ??
          30
      ) || 30,
    price:
      Number(row.price_jpy ?? row.priceJpy ?? row.price ?? row.amount ?? 0) ||
      0,
    category: row.category ?? "",
    image: row.image_url ?? row.imageUrl ?? row.image ?? row.photo_url ?? "",
    icon: row.icon_url ?? row.iconUrl ?? "",
    isActive: row.is_active !== false,
  };
}

function normalizeStaff(row) {
  return {
    staffId: row.id ?? row.staff_id ?? row.staffId ?? "",
    name: row.name ?? row.staff_name ?? "Staff",
    image: row.photo_url ?? row.photoUrl ?? row.image_url ?? row.image ?? "",
    startTime: normalizeTime(row.start_time ?? row.startTime ?? "10:00"),
    endTime: normalizeTime(row.end_time ?? row.endTime ?? "19:00"),
    slotMinutes: Number(row.slot_minutes ?? row.slotMinutes ?? 30) || 30,
    services: normalizeStaffServices(row),
    isActive: row.is_active !== false,
  };
}

function normalizeStaffServices(row) {
  if (Array.isArray(row.serviceIds)) return row.serviceIds.map(String);
  if (Array.isArray(row.service_ids)) return row.service_ids.map(String);
  if (Array.isArray(row.services)) return row.services.map(String);

  if (typeof row.services === "string") {
    return row.services
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

/* =========================================================
   Events
========================================================= */

function bindStaticEvents() {
  byId("btnStartDemo")?.addEventListener("click", startDemoFlow);
  byId("btnOpenInfo")?.addEventListener("click", () => showScreen("screenInfo"));
  byId("btnOpenLead")?.addEventListener("click", openLeadScreen);
  byId("btnOpenAdmin")?.addEventListener("click", openAdminDemo);

  byId("btnInfoStartDemo")?.addEventListener("click", startDemoFlow);

  byId("btnSubmitLead")?.addEventListener("click", submitLeadForm);

  byId("btnGoDateTime")?.addEventListener("click", goDateTimeStep);
  byId("btnGoConfirm")?.addEventListener("click", goConfirmStep);
  byId("btnSubmitBooking")?.addEventListener("click", submitBooking);

  byId("btnSuccessLead")?.addEventListener("click", openLeadScreen);
  byId("btnSuccessRestart")?.addEventListener("click", resetAndGoWelcome);

  byId("loadMoreDatesBtn")?.addEventListener("click", loadMoreDates);

  byId("btnClearStaffInline")?.addEventListener("click", async () => {
    state.selectedStaff = null;
    state.selectedTime = "";
    invalidateSlots();
    clearSlotsCache();

    await reloadSlotsIfReady(true);
    reconcileSelectionState();
    renderAll();
  });

  document.querySelectorAll("[data-back]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-back");
      if (target) showScreen(target);
    });
  });
}

/* =========================================================
   Navigation
========================================================= */

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });

  const target = byId(id);

  if (target) {
    target.classList.add("active");
    target.scrollTop = 0;
  }
}

function openAdminDemo() {
  window.location.href = "./admin.html";
}

function openLeadScreen() {
  const nameInput = byId("leadOwnerName");

  if (nameInput && !nameInput.value) {
    nameInput.value = state.displayName || "";
  }

  showScreen("screenLead");
}

/* =========================================================
   Booking flow
========================================================= */

function startDemoFlow() {
  clearBookingState();

  const nameInput = byId("name");
  const phoneInput = byId("phone");

  if (nameInput) nameInput.value = state.displayName || "";
  if (phoneInput) phoneInput.value = "";

  renderAll();
  showScreen("screenBookingStep1");
}

function resetAndGoWelcome() {
  clearBookingState();
  renderAll();
  showScreen("screenWelcome");
}

function clearBookingState() {
  state.selectedService = null;
  state.selectedStaff = null;
  state.selectedDate = "";
  state.selectedTime = "";
  state.visibleDaysCount = CONFIG.INITIAL_VISIBLE_DAYS;

  invalidateSlots();
}

function goDateTimeStep() {
  if (!state.selectedService) {
    alert("サービスを選択してください");
    return;
  }

  reconcileSelectionState();
  renderAll();
  showScreen("screenBookingStep2");
}

async function goConfirmStep() {
  if (
    !state.selectedService ||
    !state.selectedStaff ||
    !state.selectedDate ||
    !state.selectedTime
  ) {
    alert("サービス・担当者・日付・時間を選択してください");
    return;
  }

  try {
    await ensureAvailableSlotsLoaded(true, false);
  } catch (error) {
    console.error("goConfirmStep slots error:", error);
    alert("空き状況の確認に失敗しました");
    return;
  }

  if (!isTimeAvailableForStaff(state.selectedTime, state.selectedStaff.staffId)) {
    state.selectedTime = "";
    renderAll();
    alert("選択した時間が埋まっていました。もう一度お選びください。");
    return;
  }

  setText("confirmService", `${state.selectedService.name} ¥${state.selectedService.price}`);
  setText("confirmStaff", state.selectedStaff.name || "-");
  setText("confirmDate", state.selectedDate || "-");
  setText("confirmTime", state.selectedTime || "-");

  showScreen("screenBookingStep3");
}

async function submitBooking() {
  if (
    !state.selectedService ||
    !state.selectedStaff ||
    !state.selectedDate ||
    !state.selectedTime
  ) {
    alert("予約内容を選択してください");
    return;
  }

  const nameInput = byId("name");
  const phoneInput = byId("phone");

  const customerName = String(nameInput?.value || "").trim();
  const customerPhone = normalizePhone(phoneInput?.value || "");

  if (!customerName) {
    alert("お名前を入力してください");
    nameInput?.focus();
    return;
  }

  if (!isValidPhone(customerPhone)) {
    alert("電話番号を正しく入力してください");
    phoneInput?.focus();
    return;
  }

  const supabase = getSupabaseClient();

  if (!supabase) {
    alert("Supabase client is not available");
    return;
  }

  setLoading(true, "予約を作成中...", "空き状況を確認して予約しています");

  try {
    await ensureAvailableSlotsLoaded(true, true);

    if (!isTimeAvailableForStaff(state.selectedTime, state.selectedStaff.staffId)) {
      state.selectedTime = "";
      renderAll();
      alert("選択した時間が埋まっていました。もう一度お選びください。");
      return;
    }

    const salonId = await resolveSalonId();

    const payload = {
      p_salon_id: salonId,
      p_service_id: state.selectedService.serviceId,
      p_staff_id: state.selectedStaff.staffId,
      p_booking_date: state.selectedDate,
      p_start_time: state.selectedTime,
      p_customer_name: customerName,
      p_customer_phone: customerPhone,
      p_line_user_id: state.userId || null,
      p_source: "line_mini_app",
    };

    debugLog("create_public_booking payload", payload);

    const { data, error } = await supabase.rpc("create_public_booking", payload);

    debugLog("create_public_booking response", { data, error });

    if (error) throw error;

    const bookingId = extractBookingIdFromResponse(data);

    await sendBookingConfirmationMessage(bookingId);

    renderSuccessScreen();
    showScreen("screenSuccess");
  } catch (error) {
    console.error("submitBooking error:", error);
    alert(`予約の作成に失敗しました: ${error.message || error}`);
  } finally {
    setLoading(false);
  }
}

function extractBookingIdFromResponse(data) {
  if (!data) return "";

  if (typeof data === "string") return data;

  if (Array.isArray(data)) {
    return extractBookingIdFromResponse(data[0]);
  }

  if (typeof data === "object") {
    return (
      data.id ||
      data.booking_id ||
      data.bookingId ||
      data.booking?.id ||
      data.data?.id ||
      data.data?.booking_id ||
      ""
    );
  }

  return "";
}

async function sendBookingConfirmationMessage(bookingId) {
  if (!bookingId) {
    console.warn("LINE confirmation skipped: missing bookingId");
    return;
  }

  try {
    const response = await fetch("/api/send-booking-confirmation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ booking_id: bookingId }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
      console.warn("LINE confirmation failed:", result);
      return;
    }

    debugLog("LINE confirmation sent", result);
  } catch (error) {
    console.warn("LINE confirmation request failed:", error);
  }
}

/* =========================================================
   Lead form
========================================================= */

async function submitLeadForm() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    alert("Supabase client is not available");
    return;
  }

  const salonId = await resolveSalonId();

  const payload = {
    p_salon_id: salonId,
    p_store_name: getInputValue("leadStoreName"),
    p_owner_name: getInputValue("leadOwnerName"),
    p_contact: getInputValue("leadContact"),
    p_industry: getInputValue("leadIndustry"),
    p_message: getInputValue("leadMessage"),
    p_line_user_id: state.userId || null,
    p_source: "public_line_booking_demo",
  };

  if (!payload.p_store_name || !payload.p_owner_name || !payload.p_contact) {
    alert("店舗名・ご担当者名・連絡先を入力してください");
    return;
  }

  setLoading(true, "送信中...", "相談内容を送信しています");

  try {
    const { error } = await supabase.rpc("create_public_lead", payload);

    if (error) {
      console.warn("create_public_lead RPC failed, fallback insert:", error);

      const fallback = await supabase.from("leads").insert({
        salon_id: salonId,
        store_name: payload.p_store_name,
        owner_name: payload.p_owner_name,
        contact: payload.p_contact,
        industry: payload.p_industry,
        message: payload.p_message,
        line_user_id: payload.p_line_user_id,
        source: payload.p_source,
      });

      if (fallback.error) throw fallback.error;
    }

    showScreen("screenLeadSuccess");
  } catch (error) {
    console.error("submitLeadForm error:", error);
    alert(`送信に失敗しました: ${error.message || error}`);
  } finally {
    setLoading(false);
  }
}

/* =========================================================
   Available slots
========================================================= */

async function reloadSlotsIfReady(force = false) {
  if (!state.selectedService || !state.selectedDate) {
    invalidateSlots();
    return;
  }

  try {
    await ensureAvailableSlotsLoaded(force, false);
  } catch (error) {
    console.error("reloadSlotsIfReady error:", error);
    invalidateSlots();
    toast("空き状況の取得に失敗しました");
  }
}

async function ensureAvailableSlotsLoaded(force = false, silent = false) {
  if (!state.selectedService || !state.selectedDate) {
    invalidateSlots();
    return;
  }

  const cacheKey = getSlotsCacheKey({
    date: state.selectedDate,
    serviceId: state.selectedService.serviceId,
    staffId: state.selectedStaff?.staffId || "ALL",
  });

  if (!force) {
    const cached = getSlotsCache(cacheKey);

    if (cached) {
      state.availableSlots = cached;
      return;
    }
  }

  if (!silent) {
    setInlineTimeLoading(true, "空き状況を確認中...");
  }

  try {
    const candidates = state.selectedStaff
      ? [state.selectedStaff]
      : getCandidateStaffForSelectedService();

    const mergedByTime = new Map();

    for (const member of candidates) {
      const memberSlots = await fetchAvailableSlotsForStaff(member);

      memberSlots.forEach((slot) => {
        if (!mergedByTime.has(slot.time)) {
          mergedByTime.set(slot.time, new Set());
        }

        mergedByTime.get(slot.time).add(String(member.staffId));
      });
    }

    const staffById = new Map(
      state.staff.map((member) => [String(member.staffId), member])
    );

    const slots = Array.from(mergedByTime.entries())
      .sort((a, b) => timeToMinutes(a[0]) - timeToMinutes(b[0]))
      .map(([time, staffSet]) => {
        const staffIds = Array.from(staffSet);

        return {
          time,
          staffIds,
          staffMap: new Map(
            staffIds
              .map((staffId) => [staffId, staffById.get(String(staffId))])
              .filter(([, member]) => Boolean(member))
          ),
        };
      });

    state.availableSlots = {
      date: state.selectedDate,
      serviceId: String(state.selectedService.serviceId),
      staffId: state.selectedStaff?.staffId ? String(state.selectedStaff.staffId) : "",
      slots,
    };

    setSlotsCache(cacheKey, state.availableSlots);

    debugLog("merged available slots", state.availableSlots);
  } finally {
    if (!silent) {
      setInlineTimeLoading(false);
    }
  }
}

async function fetchAvailableSlotsForStaff(member) {
  if (!state.selectedService || !state.selectedDate || !member?.staffId) {
    return [];
  }

  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error("Supabase client is not available");
  }

  const salonId = await resolveSalonId();

  const params = {
    p_salon_id: salonId,
    p_staff_id: member.staffId,
    p_service_id: state.selectedService.serviceId,
    p_date: state.selectedDate,
  };

  debugLog("calling available_slots_v2", params);

  const { data, error } = await supabase.rpc("available_slots_v2", params);

  debugLog("available_slots_v2 response", {
    staff: member.name,
    rawData: data,
    error,
  });

  if (error) throw error;

  const rawSlots = normalizeRpcSlots(data);

  const slots = rawSlots
    .map((item) => normalizeTime(extractSlotTime(item)))
    .filter(Boolean)
    .filter((time) => !isTimeBlockedByNow(state.selectedDate, time))
    .map((time) => ({
      time,
      staffIds: [String(member.staffId)],
    }));

  debugLog("normalized slots for staff", {
    staff: member.name,
    slots,
  });

  return slots;
}

function normalizeRpcSlots(data) {
  if (!data) return [];

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data.slots)) {
    return data.slots;
  }

  if (Array.isArray(data.data)) {
    return data.data;
  }

  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      return normalizeRpcSlots(parsed);
    } catch {
      return [data];
    }
  }

  if (typeof data === "object") {
    return [data];
  }

  return [];
}

function extractSlotTime(item) {
  if (typeof item === "string") return item;

  if (!item || typeof item !== "object") return "";

  return (
    item.time ||
    item.start_time ||
    item.slot_time ||
    item.available_slots_v2 ||
    item.available_slot ||
    item.slot ||
    Object.values(item).find(
      (value) => typeof value === "string" && /^\d{1,2}:\d{2}/.test(value)
    ) ||
    ""
  );
}

function invalidateSlots() {
  state.availableSlots = {
    date: "",
    serviceId: "",
    staffId: "",
    slots: [],
  };
}

function getAvailableTimes() {
  if (!Array.isArray(state.availableSlots.slots)) {
    return [];
  }

  if (!state.selectedStaff) {
    return state.availableSlots.slots.map((slot) => slot.time);
  }

  return state.availableSlots.slots
    .filter((slot) =>
      slot.staffIds.map(String).includes(String(state.selectedStaff.staffId))
    )
    .map((slot) => slot.time);
}

function getSlotByTime(time) {
  return state.availableSlots.slots.find((slot) => slot.time === time) || null;
}

function isTimeAvailable(time) {
  return Boolean(getSlotByTime(time));
}

function isTimeAvailableForStaff(time, staffId) {
  const slot = getSlotByTime(time);

  if (!slot) return false;

  return slot.staffIds.map(String).includes(String(staffId));
}

function getAvailableStaffForSelectedTime() {
  if (!state.selectedTime) return [];

  const slot = getSlotByTime(state.selectedTime);

  if (!slot) return [];

  return slot.staffIds
    .map((staffId) => {
      if (slot.staffMap?.get) {
        return slot.staffMap.get(String(staffId));
      }

      return state.staff.find(
        (member) => String(member.staffId) === String(staffId)
      );
    })
    .filter(Boolean);
}

/* =========================================================
   Render
========================================================= */

function renderAll() {
  renderServices();
  renderStaffStep1();
  renderDates();

  if (state.selectedDate) {
    renderTimeOptions();
    renderStaffStep2();
  } else {
    renderStep2IdleState();
  }

  updateSummary();
}

function renderServices() {
  const container = byId("servicesList");
  if (!container) return;

  const services = getCandidateServicesForSelectedStaff();

  container.innerHTML = "";

  if (services.length === 0) {
    container.innerHTML = `<div class="empty-state">この担当者が対応できるサービスがありません</div>`;
    return;
  }

  services.forEach((service) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "service-card";

    if (
      state.selectedService &&
      String(state.selectedService.serviceId) === String(service.serviceId)
    ) {
      card.classList.add("active");
    }

    card.innerHTML = `
      <div class="service-visual">${renderServiceVisual(service)}</div>
      <div class="service-body">
        <div class="service-kicker">✂ サービス</div>
        <h3>${escapeHtml(service.name)}</h3>
        <p>${escapeHtml(service.description || "")}</p>
        <div class="service-meta">
          <span>${escapeHtml(String(service.duration))}分</span>
          <strong>¥${escapeHtml(String(service.price))}</strong>
        </div>
      </div>
    `;

    card.addEventListener("click", async () => {
      const isSame =
        state.selectedService &&
        String(state.selectedService.serviceId) === String(service.serviceId);

      state.selectedService = isSame ? null : service;

      if (
        state.selectedStaff &&
        state.selectedService &&
        !staffCanDoService(state.selectedStaff, state.selectedService.serviceId)
      ) {
        state.selectedStaff = null;
      }

      state.selectedTime = "";
      invalidateSlots();
      clearSlotsCache();

      if (state.selectedService && state.selectedDate) {
        await reloadSlotsIfReady(true);
      }

      reconcileSelectionState();
      renderAll();
    });

    container.appendChild(card);
  });
}

function renderStaffStep1() {
  const container = byId("staffList");
  if (!container) return;

  renderStaffCards(container, getCandidateStaffForSelectedService(), {
    allowSelectWithoutTime: true,
  });
}

function renderStaffStep2() {
  const container = byId("staffListStep2");
  if (!container) return;

  if (!state.selectedTime) {
    container.innerHTML = `<div class="empty-state">時間を選ぶと表示されます</div>`;
    return;
  }

  const availableStaff = getAvailableStaffForSelectedTime();

  renderStaffCards(container, availableStaff, {
    allowSelectWithoutTime: false,
  });
}

function renderStaffCards(container, list, options = {}) {
  container.innerHTML = "";
  container.classList.add("staff-gallery");

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state">対応可能な担当者がいません</div>`;
    return;
  }

  list.forEach((member) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "staff-card";

    if (
      state.selectedStaff &&
      String(state.selectedStaff.staffId) === String(member.staffId)
    ) {
      card.classList.add("active");
    }

    card.innerHTML = `
      <div class="staff-avatar">
        ${renderStaffAvatar(member)}
      </div>
      <div class="staff-info">
        <strong>${escapeHtml(member.name)}</strong>
        <span>${escapeHtml(member.startTime)}-${escapeHtml(member.endTime)}</span>
      </div>
    `;

    card.addEventListener("click", async () => {
      const isSame =
        state.selectedStaff &&
        String(state.selectedStaff.staffId) === String(member.staffId);

      state.selectedStaff = isSame ? null : member;

      if (
        state.selectedService &&
        state.selectedStaff &&
        !staffCanDoService(state.selectedStaff, state.selectedService.serviceId)
      ) {
        state.selectedService = null;
      }

      if (state.selectedTime && state.selectedStaff) {
        const ok = isTimeAvailableForStaff(
          state.selectedTime,
          state.selectedStaff.staffId
        );

        if (!ok) {
          state.selectedTime = "";
        }
      }

      invalidateSlots();
      clearSlotsCache();

      if (state.selectedService && state.selectedDate) {
        await reloadSlotsIfReady(true);
      }

      reconcileSelectionState();
      renderAll();
    });

    container.appendChild(card);
  });
}

function renderDates() {
  const container = byId("dateList");
  if (!container) return;

  container.innerHTML = "";

  const dates = buildDateOptions(state.visibleDaysCount);

  dates.forEach((dateItem) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "date-card";

    if (state.selectedDate === dateItem.value) {
      button.classList.add("active");
    }

    button.innerHTML = `
      <span>${escapeHtml(dateItem.weekday)}</span>
      <strong>${escapeHtml(dateItem.day)}</strong>
      <small>${escapeHtml(dateItem.month)}</small>
    `;

    button.addEventListener("click", async () => {
      state.selectedDate = dateItem.value;
      state.selectedTime = "";
      invalidateSlots();
      clearSlotsCache();

      await reloadSlotsIfReady(true);

      reconcileSelectionState();
      renderAll();
    });

    container.appendChild(button);
  });

  const counter = byId("dateRangeCounter");
  if (counter) {
    counter.textContent = `${Math.min(
      state.visibleDaysCount,
      CONFIG.DATE_RANGE_DAYS
    )}日表示`;
  }

  const loadMoreButton = byId("loadMoreDatesBtn");
  if (loadMoreButton) {
    loadMoreButton.style.display =
      state.visibleDaysCount < CONFIG.DATE_RANGE_DAYS ? "" : "none";
  }
}

function renderTimeOptions() {
  const container = byId("timeList");
  const hint = byId("slotHint");

  if (!container) return;

  container.innerHTML = "";

  if (!state.selectedDate) {
    container.innerHTML = `<div class="empty-state">先に日付を選択してください</div>`;
    if (hint) hint.textContent = "日付を選択してください";
    return;
  }

  if (!state.selectedService) {
    container.innerHTML = `<div class="empty-state">先にサービスを選択してください</div>`;
    if (hint) hint.textContent = "サービスを選択してください";
    return;
  }

  const times = getAvailableTimes();

  if (times.length === 0) {
    container.innerHTML = `<div class="empty-state">この日に利用できる時間がありません</div>`;
    if (hint) hint.textContent = "空き時間がありません";
    return;
  }

  if (hint) {
    hint.textContent = `${times.length}件の空き時間があります`;
  }

  times.forEach((time) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "time-chip";

    if (state.selectedTime === time) {
      button.classList.add("active");
    }

    button.textContent = time;

    button.addEventListener("click", () => {
      state.selectedTime = state.selectedTime === time ? "" : time;

      if (
        state.selectedTime &&
        state.selectedStaff &&
        !isTimeAvailableForStaff(state.selectedTime, state.selectedStaff.staffId)
      ) {
        state.selectedStaff = null;
      }

      reconcileSelectionState();
      renderAll();
    });

    container.appendChild(button);
  });
}

function renderStep2IdleState() {
  const timeList = byId("timeList");
  const staffListStep2 = byId("staffListStep2");
  const slotHint = byId("slotHint");

  if (timeList) {
    timeList.innerHTML = `<div class="empty-state">先に日付を選択してください</div>`;
  }

  if (staffListStep2) {
    staffListStep2.innerHTML = `<div class="empty-state">時間を選ぶと表示されます</div>`;
  }

  if (slotHint) {
    slotHint.textContent = "日付を選択してください";
  }
}

function renderSuccessScreen() {
  setText("successDate", state.selectedDate || "-");
  setText("successTime", state.selectedTime || "-");
  setText("successService", state.selectedService?.name || "-");
  setText("successStaff", state.selectedStaff?.name || "-");
}

function updateSummary() {
  const serviceText = state.selectedService
    ? `${state.selectedService.name} ¥${state.selectedService.price}`
    : "-";

  const staffText = state.selectedStaff ? state.selectedStaff.name : "-";

  const dateTimeText =
    state.selectedDate && state.selectedTime
      ? `${state.selectedDate} ${state.selectedTime}`
      : state.selectedDate || "-";

  setText("summaryService", serviceText);
  setText("summaryStaff", staffText);
  setText("summaryDateTime", dateTimeText);
}

/* =========================================================
   Render helpers
========================================================= */

function renderServiceVisual(service) {
  const icon = getSafeImageUrl(service.icon);
  const image = getSafeImageUrl(service.image);

  if (icon) {
    return `<img src="${escapeAttr(icon)}" alt="" loading="lazy">`;
  }

  if (image) {
    return `<img src="${escapeAttr(image)}" alt="" loading="lazy">`;
  }

  return `<span>${escapeHtml(getServiceEmoji(service.name))}</span>`;
}

function renderStaffAvatar(member) {
  const image = getSafeImageUrl(member.image);

  if (image) {
    return `<img src="${escapeAttr(image)}" alt="${escapeAttr(
      member.name
    )}" loading="lazy">`;
  }

  return `<span>${escapeHtml((member.name || "S").slice(0, 1))}</span>`;
}

function getServiceEmoji(name) {
  const text = String(name || "").toLowerCase();

  if (text.includes("cut") || text.includes("カット")) return "✂️";
  if (text.includes("color") || text.includes("カラー")) return "🎨";
  if (text.includes("spa") || text.includes("スパ")) return "🫧";
  if (text.includes("nail") || text.includes("ネイル")) return "💅";

  return "✨";
}

/* =========================================================
   Selection logic
========================================================= */

function getCandidateServicesForSelectedStaff() {
  if (!state.selectedStaff) {
    return [...state.services];
  }

  return state.services.filter((service) =>
    staffCanDoService(state.selectedStaff, service.serviceId)
  );
}

function getCandidateStaffForSelectedService() {
  if (!state.selectedService) {
    return [...state.staff];
  }

  return state.staff.filter((member) =>
    staffCanDoService(member, state.selectedService.serviceId)
  );
}

function staffCanDoService(member, serviceId) {
  if (!member || !serviceId) return false;

  const services = Array.isArray(member.services) ? member.services : [];

  if (services.length === 0) {
    return true;
  }

  return services.map(String).includes(String(serviceId));
}

function reconcileSelectionState() {
  if (
    state.selectedService &&
    state.selectedStaff &&
    !staffCanDoService(state.selectedStaff, state.selectedService.serviceId)
  ) {
    state.selectedStaff = null;
    state.selectedTime = "";
  }

  if (state.selectedTime && !isTimeAvailable(state.selectedTime)) {
    state.selectedTime = "";
  }

  if (
    state.selectedTime &&
    state.selectedStaff &&
    !isTimeAvailableForStaff(state.selectedTime, state.selectedStaff.staffId)
  ) {
    state.selectedStaff = null;
  }
}

/* =========================================================
   Dates / Time
========================================================= */

function buildDateOptions(count) {
  const result = [];
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    weekday: "short",
  });

  const today = new Date();

  for (let i = 0; i < Math.min(count, CONFIG.DATE_RANGE_DAYS); i += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);

    const value = formatDateValue(date);
    const month = `${date.getMonth() + 1}月`;
    const day = `${date.getDate()}日`;
    const weekday = formatter.format(date);

    result.push({
      value,
      month,
      day,
      weekday,
    });
  }

  return result;
}

function loadMoreDates() {
  state.visibleDaysCount = Math.min(
    CONFIG.DATE_RANGE_DAYS,
    state.visibleDaysCount + CONFIG.LOAD_MORE_DAYS_STEP
  );

  renderDates();
}

function formatDateValue(date) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());

  return `${year}-${month}-${day}`;
}

function normalizeTime(value) {
  if (value === null || value === undefined) return "";

  const text = String(value).trim();

  const match = text.match(/^(\d{1,2}):(\d{2})/);

  if (!match) return "";

  return `${pad2(match[1])}:${match[2]}`;
}

function timeToMinutes(time) {
  const normalized = normalizeTime(time);

  if (!normalized) return 0;

  const [hours, minutes] = normalized.split(":").map(Number);

  return hours * 60 + minutes;
}

function isTimeBlockedByNow(dateValue, timeValue) {
  if (!dateValue || !timeValue) return false;

  const today = formatDateValue(new Date());

  if (dateValue !== today) return false;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const slotMinutes = timeToMinutes(timeValue);

  return slotMinutes < currentMinutes + CONFIG.SAME_DAY_BLOCK_MINUTES;
}

/* =========================================================
   Cache
========================================================= */

function getSlotsCacheKey(params) {
  return JSON.stringify({
    date: String(params.date || ""),
    serviceId: String(params.serviceId || ""),
    staffId: String(params.staffId || "ALL"),
  });
}

function getSlotsCache(key) {
  const item = state.slotsCache.get(key);

  if (!item) return null;

  if (Date.now() - item.createdAt > CONFIG.CACHE_TTL_MS) {
    state.slotsCache.delete(key);
    return null;
  }

  return item.data;
}

function setSlotsCache(key, data) {
  state.slotsCache.set(key, {
    data,
    createdAt: Date.now(),
  });
}

function clearSlotsCache() {
  state.slotsCache.clear();
}

/* =========================================================
   UI helpers
========================================================= */

function setLoading(show, title = "読み込み中...", text = "少々お待ちください") {
  const overlay = byId("loadingOverlay");

  if (!overlay) return;

  const titleElement = overlay.querySelector(".loading-title");
  const textElement = overlay.querySelector(".loading-text");

  if (titleElement) titleElement.textContent = title;
  if (textElement) textElement.textContent = text;

  overlay.classList.toggle("active", Boolean(show));
}

function setInlineTimeLoading(show, text = "空き状況を確認中...") {
  const box = byId("inlineTimeLoading");

  if (!box) return;

  box.style.display = show ? "flex" : "none";

  const textNode = box.querySelector("div:last-child");

  if (textNode) {
    textNode.textContent = text;
  }
}

function toast(message) {
  const old = document.querySelector(".toast");

  if (old) old.remove();

  const element = document.createElement("div");
  element.className = "toast";
  element.textContent = message;

  document.body.appendChild(element);

  setTimeout(() => {
    element.remove();
  }, 2500);
}

function fillInitialProfileFields() {
  const nameInput = byId("name");

  if (nameInput) {
    nameInput.value = state.displayName || "";
  }

  const leadOwnerName = byId("leadOwnerName");

  if (leadOwnerName) {
    leadOwnerName.value = state.displayName || "";
  }
}

function bindPhoneInput() {
  const phoneInput = byId("phone");

  if (!phoneInput) return;

  phoneInput.addEventListener("input", () => {
    phoneInput.value = normalizePhone(phoneInput.value);
  });
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
  const digits = normalized.replace(/\D/g, "");

  return digits.length >= 10 && digits.length <= 15;
}

function getInputValue(id) {
  return String(byId(id)?.value || "").trim();
}

function setText(id, value) {
  const element = byId(id);

  if (element) {
    element.textContent = value;
  }
}

function byId(id) {
  return document.getElementById(id);
}

/* =========================================================
   Safe string helpers
========================================================= */

function getSafeImageUrl(value) {
  const url = String(value || "").trim();

  if (!url) return "";

  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("./") ||
    url.startsWith("/") ||
    url.startsWith("data:image/")
  ) {
    return url;
  }

  return "";
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

function pad2(value) {
  return String(value).padStart(2, "0");
}

function debugLog(...args) {
  if (CONFIG.DEBUG) {
    console.log("[Mirawi Debug]", ...args);
  }
}