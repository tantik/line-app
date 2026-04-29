"use strict";

/*
  Mirawi LINE Booking Mini App
  Clean restored script.js

  Preserved features:
  - LIFF / browser dev mode
  - Supabase catalog loading
  - services / staff / staff_service_map
  - service, staff, date, time selection
  - real slots from available_slots_v2
  - phone validation
  - create_public_booking
  - create_public_lead
  - LINE confirmation request through /api/send-booking-confirmation
  - success screen
  - admin link
*/

const CONFIG = {
  LIFF_ID: "2009586903-hyNXZaW7",

  FALLBACK_SUPABASE_URL: "https://bhqgfszxiuqmwojhpvne.supabase.co",
  FALLBACK_SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInJlZiI6ImJocWdmc3p4aXVxbXdvamhwdm5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4MDQ2MTMsImV4cCI6MjA5MjM4MDYxM30.3ida9u0yHHuhuXZ73lSK88DgrKtqFxa3joFjFzQdkas",

  FALLBACK_SALON_ID: "e840e2b0-2d49-4899-b6d2-f2afe895ad1e",
  FALLBACK_SALON_SLUG: "mirawi-demo",

  DEV_LINE_USER_ID: "U2df185806fe6739ff9bdff02d3eb71ce",
  DEV_DISPLAY_NAME: "Mirawi Demo User",

  DATE_RANGE_DAYS: 60,
  INITIAL_VISIBLE_DAYS: 14,
  LOAD_MORE_DAYS_STEP: 14,
  SAME_DAY_BLOCK_MINUTES: 20,
  CACHE_TTL_MS: 3 * 60 * 1000,

  DEBUG: true,
};

const state = {
  initialized: false,
  userId: "",
  displayName: "",
  salonId: "",
  salonSlug: CONFIG.FALLBACK_SALON_SLUG,

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

  slotsCache: new Map(),
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  bindStaticEvents();
  initApp();
});

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
    showFatalError(error);
  } finally {
    setLoading(false);
  }
}

async function initLiffOrDevMode() {
  const isLocal =
    location.hostname === "localhost" || location.hostname === "127.0.0.1";

  if (typeof window.liff === "undefined") {
    debugLog("LIFF SDK is not available. Browser/dev fallback is used.");
    state.userId = CONFIG.DEV_LINE_USER_ID;
    state.displayName = CONFIG.DEV_DISPLAY_NAME;
    return;
  }

  if (isLocal) {
    debugLog("Localhost detected. LIFF login is skipped.");
    state.userId = CONFIG.DEV_LINE_USER_ID;
    state.displayName = CONFIG.DEV_DISPLAY_NAME;
    return;
  }

  await window.liff.init({ liffId: CONFIG.LIFF_ID });

  if (!window.liff.isLoggedIn()) {
    window.liff.login({ redirectUri: window.location.href });
    return;
  }

  try {
    const profile = await window.liff.getProfile();
    state.userId = profile?.userId || CONFIG.DEV_LINE_USER_ID;
    state.displayName = profile?.displayName || CONFIG.DEV_DISPLAY_NAME;
    debugLog("LIFF profile loaded", {
      userId: state.userId,
      displayName: state.displayName,
    });
  } catch (error) {
    console.warn("LIFF profile failed. Fallback userId is used.", error);
    state.userId = CONFIG.DEV_LINE_USER_ID;
    state.displayName = CONFIG.DEV_DISPLAY_NAME;
  }
}

function cacheDom() {
  [
    "loadingOverlay",
    "btnStartDemo",
    "btnOpenInfo",
    "btnOpenLead",
    "btnOpenAdmin",
    "btnInfoStartDemo",
    "btnSubmitLead",
    "btnGoDateTime",
    "btnGoConfirm",
    "btnSubmitBooking",
    "btnSuccessLead",
    "btnSuccessRestart",
    "loadMoreDatesBtn",
    "btnClearStaffInline",
    "servicesList",
    "staffList",
    "staffListStep2",
    "dateList",
    "timeList",
    "inlineTimeLoading",
    "slotHint",
    "dateRangeCounter",
    "summaryService",
    "summaryStaff",
    "summaryDateTime",
    "confirmService",
    "confirmStaff",
    "confirmDate",
    "confirmTime",
    "name",
    "phone",
    "successDate",
    "successTime",
    "successService",
    "successStaff",
    "leadStoreName",
    "leadOwnerName",
    "leadContact",
    "leadIndustry",
    "leadMessage",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindStaticEvents() {
  els.btnStartDemo?.addEventListener("click", startDemoFlow);
  els.btnOpenInfo?.addEventListener("click", () => showScreen("screenInfo"));
  els.btnOpenLead?.addEventListener("click", openLeadScreen);
  els.btnOpenAdmin?.addEventListener("click", openAdminDemo);
  els.btnInfoStartDemo?.addEventListener("click", startDemoFlow);
  els.btnSubmitLead?.addEventListener("click", submitLeadForm);
  els.btnGoDateTime?.addEventListener("click", goDateTimeStep);
  els.btnGoConfirm?.addEventListener("click", goConfirmStep);
  els.btnSubmitBooking?.addEventListener("click", submitBooking);
  els.btnSuccessLead?.addEventListener("click", openLeadScreen);
  els.btnSuccessRestart?.addEventListener("click", resetAndGoWelcome);
  els.loadMoreDatesBtn?.addEventListener("click", loadMoreDates);

  els.btnClearStaffInline?.addEventListener("click", async () => {
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

function getEnv() {
  return window.__APP_ENV__ || window.appEnv || window.ENV || {};
}

function getSupabaseUrl() {
  const env = getEnv();
  return (
    env.SUPABASE_URL ||
    env.supabaseUrl ||
    window.SUPABASE_URL ||
    CONFIG.FALLBACK_SUPABASE_URL
  );
}

function getSupabaseAnonKey() {
  const env = getEnv();
  return (
    env.SUPABASE_ANON_KEY ||
    env.SUPABASE_PUBLIC_ANON_KEY ||
    env.supabaseAnonKey ||
    window.SUPABASE_ANON_KEY ||
    CONFIG.FALLBACK_SUPABASE_ANON_KEY
  );
}

function getSalonSlug() {
  const env = getEnv();
  return env.SALON_SLUG || env.salonSlug || CONFIG.FALLBACK_SALON_SLUG;
}

function getSupabaseClient() {
  if (window.supabaseClient) return window.supabaseClient;
  if (window.mirawiSupabaseClient) return window.mirawiSupabaseClient;

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    return null;
  }

  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  if (!url || !anonKey) return null;

  window.supabaseClient = window.supabase.createClient(url, anonKey);
  return window.supabaseClient;
}

async function resolveSalonId() {
  if (state.salonId) return state.salonId;

  const env = getEnv();

  if (env.SALON_ID || env.salonId) {
    state.salonId = env.SALON_ID || env.salonId;
    return state.salonId;
  }

  const supabase = getSupabaseClient();

  if (!supabase) {
    state.salonId = CONFIG.FALLBACK_SALON_ID;
    return state.salonId;
  }

  const slug = getSalonSlug();
  state.salonSlug = slug;

  const { data, error } = await supabase
    .from("salons")
    .select("id, slug")
    .eq("slug", slug)
    .maybeSingle();

  if (!error && data?.id) {
    state.salonId = data.id;
    state.salonSlug = data.slug || slug;
    return state.salonId;
  }

  if (error) console.warn("Salon lookup failed. Fallback salon_id is used.", error);

  state.salonId = CONFIG.FALLBACK_SALON_ID;
  return state.salonId;
}

async function loadCatalog() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error("Supabase client is not available. Check Supabase script and env.");
  }

  const salonId = await resolveSalonId();

  const servicesQuery = supabase
    .from("services")
    .select("*")
    .eq("salon_id", salonId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const staffQuery = supabase
    .from("staff")
    .select("*")
    .eq("salon_id", salonId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  const [servicesResult, staffResult] = await Promise.all([servicesQuery, staffQuery]);

  if (servicesResult.error) throw servicesResult.error;
  if (staffResult.error) throw staffResult.error;

  state.services = (servicesResult.data || [])
    .map(normalizeService)
    .filter((service) => service.serviceId && service.isActive);

  state.staff = (staffResult.data || [])
    .map(normalizeStaff)
    .filter((member) => member.staffId && member.isActive);

  await hydrateStaffServiceMap();

  debugLog("catalog loaded", {
    salonId,
    services: state.services,
    staff: state.staff,
  });
}

async function hydrateStaffServiceMap() {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const salonId = await resolveSalonId();
  const staffIds = state.staff.map((member) => member.staffId).filter(Boolean);

  if (staffIds.length === 0) return;

  const { data, error } = await supabase
    .from("staff_service_map")
    .select("staff_id, service_id")
    .eq("salon_id", salonId)
    .in("staff_id", staffIds);

  if (error) {
    console.warn("staff_service_map load failed. Staff cards will use fallback.", error);
    return;
  }

  const serviceMap = new Map();

  (data || []).forEach((row) => {
    const staffId = String(row.staff_id || "");
    const serviceId = String(row.service_id || "");

    if (!staffId || !serviceId) return;

    if (!serviceMap.has(staffId)) serviceMap.set(staffId, []);
    serviceMap.get(staffId).push(serviceId);
  });

  state.staff = state.staff.map((member) => ({
    ...member,
    services: serviceMap.get(String(member.staffId)) || member.services || [],
  }));

  debugLog("staff_service_map hydrated", state.staff);
}

function normalizeService(row) {
  return {
    raw: row,
    serviceId: String(row.id ?? row.service_id ?? row.serviceId ?? ""),
    code: row.code ?? "",
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
    price: Number(row.price_jpy ?? row.priceJpy ?? row.price ?? row.amount ?? 0) || 0,
    category: row.category ?? "",
    image: row.image_url ?? row.imageUrl ?? row.image ?? row.photo_url ?? "",
    icon: row.icon_url ?? row.iconUrl ?? "",
    sortOrder: Number(row.sort_order ?? 0) || 0,
    isActive: row.is_active !== false,
  };
}

function normalizeStaff(row) {
  return {
    raw: row,
    staffId: String(row.id ?? row.staff_id ?? row.staffId ?? ""),
    name: row.name ?? row.staff_name ?? "Staff",
    bio: row.bio ?? row.description ?? "",
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

function startDemoFlow() {
  clearBookingState();
  fillInitialProfileFields();
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
  clearSlotsCache();
}

function openLeadScreen() {
  fillInitialProfileFields();
  showScreen("screenLead");
}

function openAdminDemo() {
  window.location.href = "./admin.html";
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });

  const target = document.getElementById(id);

  if (target) {
    target.classList.add("active");
    target.scrollTop = 0;
  } else {
    console.warn("Screen not found:", id);
  }
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
  if (!state.selectedService || !state.selectedStaff || !state.selectedDate || !state.selectedTime) {
    alert("サービス・担当者・日付・時間を選択してください");
    return;
  }

  setLoading(true, "空き状況を確認中...", "選択した時間を確認しています");

  try {
    await ensureAvailableSlotsLoaded(true, true);

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

    fillInitialProfileFields();
    showScreen("screenBookingStep3");
  } catch (error) {
    console.error("goConfirmStep error:", error);
    alert(`空き状況の確認に失敗しました: ${error.message || error}`);
  } finally {
    setLoading(false);
  }
}

async function submitBooking() {
  if (!state.selectedService || !state.selectedStaff || !state.selectedDate || !state.selectedTime) {
    alert("予約内容を選択してください");
    return;
  }

  const customerName = String(els.name?.value || "").trim();
  const customerPhone = normalizePhone(els.phone?.value || "");

  if (!customerName) {
    alert("お名前を入力してください");
    els.name?.focus();
    return;
  }

  if (!isValidPhone(customerPhone)) {
    alert("電話番号を正しく入力してください");
    els.phone?.focus();
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
    const bookingPayload = {
      p_salon_id: salonId,
      p_service_id: state.selectedService.serviceId,
      p_staff_id: state.selectedStaff.staffId,
      p_booking_date: state.selectedDate,
      p_start_time: state.selectedTime,
      p_customer_name: customerName,
      p_customer_phone: customerPhone,
      p_line_user_id: state.userId || CONFIG.DEV_LINE_USER_ID || null,
      p_source: "line_mini_app",
    };

    debugLog("create_public_booking payload", bookingPayload);

    const { data, error } = await supabase.rpc("create_public_booking", bookingPayload);

    debugLog("create_public_booking response", { data, error });

    if (error) throw error;

    let bookingId = extractBookingIdFromResponse(data);

    if (!bookingId) {
      bookingId = await findCreatedBookingId({
        salonId,
        serviceId: state.selectedService.serviceId,
        staffId: state.selectedStaff.staffId,
        bookingDate: state.selectedDate,
        startTime: state.selectedTime,
        customerPhone,
      });
    }

    debugLog("created booking id", bookingId);

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
    for (const item of data) {
      const id = extractBookingIdFromResponse(item);
      if (id) return id;
    }
    return "";
  }

  if (typeof data === "object") {
    return String(
      data.id ||
        data.booking_id ||
        data.bookingId ||
        data.booking?.id ||
        data.data?.id ||
        data.data?.booking_id ||
        data.result?.id ||
        data.result?.booking_id ||
        ""
    );
  }

  return "";
}

async function findCreatedBookingId(params) {
  const supabase = getSupabaseClient();
  if (!supabase) return "";

  try {
    const { data, error } = await supabase
      .from("bookings")
      .select("id")
      .eq("salon_id", params.salonId)
      .eq("service_id", params.serviceId)
      .eq("staff_id", params.staffId)
      .eq("booking_date", params.bookingDate)
      .eq("start_time", params.startTime)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("findCreatedBookingId failed", error);
      return "";
    }

    return data?.id ? String(data.id) : "";
  } catch (error) {
    console.warn("findCreatedBookingId exception", error);
    return "";
  }
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
      console.warn("LINE confirmation failed", {
        status: response.status,
        result,
      });
      return;
    }

    debugLog("LINE confirmation sent", result);
  } catch (error) {
    console.warn("LINE confirmation request failed", error);
  }
}

async function submitLeadForm() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    alert("Supabase client is not available");
    return;
  }

  const payload = {
    p_salon_id: await resolveSalonId(),
    p_store_name: getInputValue("leadStoreName"),
    p_owner_name: getInputValue("leadOwnerName"),
    p_contact: getInputValue("leadContact"),
    p_industry: getInputValue("leadIndustry"),
    p_message: getInputValue("leadMessage"),
    p_line_user_id: state.userId || CONFIG.DEV_LINE_USER_ID || null,
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
      console.warn("create_public_lead RPC failed. Fallback insert is used.", error);

      const fallback = await supabase.from("leads").insert({
        salon_id: payload.p_salon_id,
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

  if (!silent) setInlineTimeLoading(true, "空き状況を確認中...");

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

    const staffById = new Map(state.staff.map((member) => [String(member.staffId), member]));

    const slots = Array.from(mergedByTime.entries())
      .sort((a, b) => timeToMinutes(a[0]) - timeToMinutes(b[0]))
      .map(([time, staffSet]) => {
        const staffIds = Array.from(staffSet);
        const staffMap = new Map();

        staffIds.forEach((staffId) => {
          const member = staffById.get(String(staffId));
          if (member) staffMap.set(String(staffId), member);
        });

        return {
          time,
          staffIds,
          staffMap,
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
    if (!silent) setInlineTimeLoading(false);
  }
}

async function fetchAvailableSlotsForStaff(member) {
  if (!state.selectedService || !state.selectedDate || !member?.staffId) return [];

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase client is not available");

  const params = {
    p_salon_id: await resolveSalonId(),
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

  return normalizeRpcSlots(data)
    .map((item) => normalizeTime(extractSlotTime(item)))
    .filter(Boolean)
    .filter((time) => !isTimeBlockedByNow(state.selectedDate, time))
    .map((time) => ({
      time,
      staffIds: [String(member.staffId)],
    }));
}

function normalizeRpcSlots(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;

  if (typeof data === "string") {
    try {
      return normalizeRpcSlots(JSON.parse(data));
    } catch {
      return [data];
    }
  }

  if (typeof data === "object") {
    if (Array.isArray(data.slots)) return data.slots;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.available_slots_v2)) return data.available_slots_v2;
    if (Array.isArray(data.available_slots)) return data.available_slots;
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
    item.available_slots ||
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
  if (!Array.isArray(state.availableSlots.slots)) return [];

  if (!state.selectedStaff) {
    return state.availableSlots.slots.map((slot) => slot.time);
  }

  return state.availableSlots.slots
    .filter((slot) => slot.staffIds.map(String).includes(String(state.selectedStaff.staffId)))
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
      if (slot.staffMap?.get) return slot.staffMap.get(String(staffId));
      return state.staff.find((member) => String(member.staffId) === String(staffId));
    })
    .filter(Boolean);
}

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
  const container = els.servicesList;
  if (!container) return;

  const services = getCandidateServicesForSelectedStaff();
  container.innerHTML = "";

  if (services.length === 0) {
    container.appendChild(createEmptyState("この担当者が対応できるサービスがありません"));
    return;
  }

  services.forEach((service) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "service-card";

    if (state.selectedService && String(state.selectedService.serviceId) === String(service.serviceId)) {
      card.classList.add("active");
    }

    const visual = document.createElement("div");
    visual.className = "service-visual";
    visual.appendChild(createServiceVisual(service));

    const body = document.createElement("div");
    body.className = "service-body";

    const kicker = document.createElement("div");
    kicker.className = "service-kicker";
    kicker.textContent = "✂ サービス";

    const title = document.createElement("h3");
    title.textContent = service.name;

    const description = document.createElement("p");
    description.textContent = service.description || "";

    const meta = document.createElement("div");
    meta.className = "service-meta";

    const duration = document.createElement("span");
    duration.textContent = `${service.duration}分`;

    const price = document.createElement("strong");
    price.textContent = `¥${service.price}`;

    meta.append(duration, price);
    body.append(kicker, title, description, meta);
    card.append(visual, body);

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
  if (!els.staffList) return;
  renderStaffCards(els.staffList, getCandidateStaffForSelectedService(), {
    mode: "step1",
  });
}

function renderStaffStep2() {
  if (!els.staffListStep2) return;

  if (!state.selectedTime) {
    els.staffListStep2.innerHTML = "";
    els.staffListStep2.appendChild(createEmptyState("時間を選ぶと表示されます"));
    return;
  }

  renderStaffCards(els.staffListStep2, getAvailableStaffForSelectedTime(), {
    mode: "step2",
  });
}

function renderStaffCards(container, list) {
  container.innerHTML = "";
  container.classList.add("staff-gallery");

  if (list.length === 0) {
    container.appendChild(createEmptyState("対応可能な担当者がいません"));
    return;
  }

  list.forEach((member) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "staff-card";

    if (state.selectedStaff && String(state.selectedStaff.staffId) === String(member.staffId)) {
      card.classList.add("active");
    }

    const avatar = document.createElement("div");
    avatar.className = "staff-avatar";
    avatar.appendChild(createStaffAvatar(member));

    const info = document.createElement("div");
    info.className = "staff-info";

    const name = document.createElement("strong");
    name.textContent = member.name;

    const time = document.createElement("span");
    time.textContent = `${member.startTime}-${member.endTime}`;

    info.append(name, time);
    card.append(avatar, info);

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

      if (
        state.selectedTime &&
        state.selectedStaff &&
        !isTimeAvailableForStaff(state.selectedTime, state.selectedStaff.staffId)
      ) {
        state.selectedTime = "";
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
  const container = els.dateList;
  if (!container) return;

  container.innerHTML = "";

  buildDateOptions(state.visibleDaysCount).forEach((dateItem) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "date-card";

    if (state.selectedDate === dateItem.value) button.classList.add("active");

    const weekday = document.createElement("span");
    weekday.textContent = dateItem.weekday;

    const day = document.createElement("strong");
    day.textContent = dateItem.day;

    const month = document.createElement("small");
    month.textContent = dateItem.month;

    button.append(weekday, day, month);

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

  if (els.dateRangeCounter) {
    els.dateRangeCounter.textContent = `${Math.min(
      state.visibleDaysCount,
      CONFIG.DATE_RANGE_DAYS
    )}日表示`;
  }

  if (els.loadMoreDatesBtn) {
    els.loadMoreDatesBtn.style.display =
      state.visibleDaysCount < CONFIG.DATE_RANGE_DAYS ? "" : "none";
  }
}

function renderTimeOptions() {
  const container = els.timeList;
  if (!container) return;

  container.innerHTML = "";

  if (!state.selectedDate) {
    container.appendChild(createEmptyState("先に日付を選択してください"));
    setText("slotHint", "日付を選択してください");
    return;
  }

  if (!state.selectedService) {
    container.appendChild(createEmptyState("先にサービスを選択してください"));
    setText("slotHint", "サービスを選択してください");
    return;
  }

  const times = getAvailableTimes();

  if (times.length === 0) {
    container.appendChild(createEmptyState("この日に利用できる時間がありません"));
    setText("slotHint", "空き時間がありません");
    return;
  }

  setText("slotHint", `${times.length}件の空き時間があります`);

  times.forEach((time) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "time-chip";
    button.textContent = time;

    if (state.selectedTime === time) button.classList.add("active");

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
  if (els.timeList) {
    els.timeList.innerHTML = "";
    els.timeList.appendChild(createEmptyState("先に日付を選択してください"));
  }

  if (els.staffListStep2) {
    els.staffListStep2.innerHTML = "";
    els.staffListStep2.appendChild(createEmptyState("時間を選ぶと表示されます"));
  }

  setText("slotHint", "日付を選択してください");
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

function renderSuccessScreen() {
  setText("successDate", state.selectedDate || "-");
  setText("successTime", state.selectedTime || "-");
  setText("successService", state.selectedService?.name || "-");
  setText("successStaff", state.selectedStaff?.name || "-");
}

function createServiceVisual(service) {
  const imageUrl = getSafeImageUrl(service.icon || service.image);

  if (imageUrl) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = "";
    image.loading = "lazy";
    return image;
  }

  const span = document.createElement("span");
  span.textContent = getServiceEmoji(service.name);
  return span;
}

function createStaffAvatar(member) {
  const imageUrl = getSafeImageUrl(member.image);

  if (imageUrl) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = member.name || "staff";
    image.loading = "lazy";
    return image;
  }

  const span = document.createElement("span");
  span.textContent = String(member.name || "S").slice(0, 1);
  return span;
}

function createEmptyState(text) {
  const div = document.createElement("div");
  div.className = "empty-state";
  div.textContent = text;
  return div;
}

function getCandidateServicesForSelectedStaff() {
  if (!state.selectedStaff) return [...state.services];

  return state.services.filter((service) =>
    staffCanDoService(state.selectedStaff, service.serviceId)
  );
}

function getCandidateStaffForSelectedService() {
  if (!state.selectedService) return [...state.staff];

  return state.staff.filter((member) =>
    staffCanDoService(member, state.selectedService.serviceId)
  );
}

function staffCanDoService(member, serviceId) {
  if (!member || !serviceId) return false;

  const services = Array.isArray(member.services) ? member.services.map(String) : [];

  if (services.length === 0) return true;

  return services.includes(String(serviceId));
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

function buildDateOptions(count) {
  const result = [];
  const today = new Date();
  const weekdayFormatter = new Intl.DateTimeFormat("ja-JP", { weekday: "short" });

  for (let i = 0; i < Math.min(count, CONFIG.DATE_RANGE_DAYS); i += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);

    result.push({
      value: formatDateValue(date),
      month: `${date.getMonth() + 1}月`,
      day: `${date.getDate()}日`,
      weekday: weekdayFormatter.format(date),
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
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
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
    createdAt: Date.now(),
    data,
  });
}

function clearSlotsCache() {
  state.slotsCache.clear();
}

function setLoading(show, title = "読み込み中...", text = "少々お待ちください") {
  const overlay = els.loadingOverlay || document.getElementById("loadingOverlay");
  if (!overlay) return;

  const titleElement = overlay.querySelector(".loading-title");
  const textElement = overlay.querySelector(".loading-text");

  if (titleElement) titleElement.textContent = title;
  if (textElement) textElement.textContent = text;

  overlay.classList.toggle("active", Boolean(show));
}

function setInlineTimeLoading(show, text = "空き状況を確認中...") {
  const box = els.inlineTimeLoading || document.getElementById("inlineTimeLoading");
  if (!box) return;

  box.style.display = show ? "flex" : "none";

  const textNode = box.querySelector("div:last-child") || box;
  if (textNode) textNode.textContent = text;
}

function toast(message) {
  const oldToast = document.querySelector(".toast");
  if (oldToast) oldToast.remove();

  const element = document.createElement("div");
  element.className = "toast";
  element.textContent = message;
  document.body.appendChild(element);

  setTimeout(() => element.remove(), 2500);
}

function showFatalError(error) {
  const message = error?.message || String(error || "Unknown error");
  console.error("Fatal error:", message);
  alert(`初期化エラーが発生しました: ${message}`);
}

function fillInitialProfileFields() {
  if (els.name && !els.name.value) els.name.value = state.displayName || "";
  if (els.leadOwnerName && !els.leadOwnerName.value) {
    els.leadOwnerName.value = state.displayName || "";
  }
}

function bindPhoneInput() {
  if (!els.phone) return;

  els.phone.addEventListener("input", () => {
    els.phone.value = normalizePhone(els.phone.value);
  });
}

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let cleaned = raw.replace(/[－ー―‐]/g, "-");
  cleaned = cleaned.replace(/[^\d+]/g, "");

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
  const element = document.getElementById(id);
  return String(element?.value || "").trim();
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function getSafeImageUrl(value) {
  const url = String(value || "").trim();

  if (!url) return "";

  if (
    url.startsWith("https://") ||
    url.startsWith("http://") ||
    url.startsWith("./") ||
    url.startsWith("/") ||
    url.startsWith("data:image/")
  ) {
    return url;
  }

  return "";
}

function getServiceEmoji(name) {
  const text = String(name || "").toLowerCase();

  if (text.includes("cut") || text.includes("カット")) return "✂️";
  if (text.includes("color") || text.includes("カラー")) return "🎨";
  if (text.includes("spa") || text.includes("スパ")) return "🫧";
  if (text.includes("nail") || text.includes("ネイル")) return "💅";
  if (text.includes("head") || text.includes("ヘッド")) return "💆";

  return "✨";
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function debugLog(...args) {
  if (CONFIG.DEBUG) console.log("[Mirawi Debug]", ...args);
}

window.MirawiBookingDebug = {
  state,
  reloadCatalog: loadCatalog,
  reloadSlots: () => reloadSlotsIfReady(true),
  getSupabaseClient,
  resolveSalonId,
};