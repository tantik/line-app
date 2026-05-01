const sb = window.supabaseClient;
const STORAGE_BUCKET = "salon-assets";
const APP_ENV = window.__APP_ENV__ || {};

let currentSalonId = null;
let currentUser = null;
let realtimeChannel = null;
let refreshTimer = null;
let allBookings = [];
let allBookingEvents = [];
let allStaff = [];
let allServices = [];
let editingStaffId = null;
let editingServiceId = null;
let currentTab = "bookings";
let isLoadingInitialData = false;
let toastTimer = null;

const bookingState = {
  view: "today",
  selectedDate: getTodayString(),
  statusFilter: "",
  staffFilter: "",
  searchText: "",
};

document.addEventListener("DOMContentLoaded", initAdmin);

async function initAdmin() {
  bindUI();
  syncSelectedDateInput();
  syncViewButtons();
  switchTab("bookings");

  if (!sb) {
    showToast("Supabase client не загружен");
    hideLoading();
    return;
  }

  try {
    if (APP_ENV.ADMIN_DEMO_MODE) {
      console.log("[ADMIN] LOCALHOST DEMO MODE: Auth bypassed");
      await applyDemoSession();

      sb.auth.onAuthStateChange(async (_event, session) => {
        if (session?.user) {
          await applySession(session);
        }
      });

      return;
    }

    if (APP_ENV.PUBLIC_DEMO_MODE) {
      console.log("[ADMIN] PUBLIC DEMO MODE: Anyone can view");
      await applyDemoSession();

      sb.auth.onAuthStateChange(async (_event, session) => {
        if (session?.user) {
          await applySession(session);
        }
      });

      return;
    }

    console.log("[ADMIN] PRODUCTION MODE: Normal auth required");

    await new Promise((resolve) => setTimeout(resolve, 500));

    const { data, error } = await sb.auth.getSession();

    if (error) {
      console.error("getSession error:", error);
      showToast("Ошибка входа");
      hideLoading();
      return;
    }

    await applySession(data?.session || null);

    sb.auth.onAuthStateChange(async (_event, session) => {
      console.log("[ADMIN] Auth state changed:", _event, session?.user?.email);
      await applySession(session);
    });
  } catch (error) {
    console.error("initAdmin error:", error);
    showToast("管理画面の初期化に失敗しました");
    hideLoading();
  }
}

/* ========================= AUTH ========================= */

async function applyDemoSession() {
  currentUser = {
    id: "demo-admin-" + Date.now(),
    email: APP_ENV.DEMO_ADMIN_EMAIL || "demo@mirawi.local",
    user_metadata: { demo: true },
  };

  document.getElementById("authLoggedOut")?.classList.add("hidden");
  document.getElementById("authLoggedIn")?.classList.remove("hidden");

  setText("whoAmI", `${currentUser.email} [DEMO]`);

  try {
    isLoadingInitialData = true;
    showLoading("読み込み中...", "デモ管理者データを読み込んでいます");

    await applyDemoTenant();
    await loadAll();

    subscribeRealtime();
    startRefresh();
  } catch (error) {
    console.error("applyDemoSession error:", error);
    showToast("デモデータの読み込みに失敗しました");
  } finally {
    isLoadingInitialData = false;
    hideLoading();
  }
}

async function applyDemoTenant() {
  currentSalonId = APP_ENV.DEMO_SALON_ID;

  if (!currentSalonId) {
    throw new Error("DEMO_SALON_ID not configured");
  }

  try {
    const { data, error } = await sb
      .from("salons")
      .select("name, slug")
      .eq("id", currentSalonId)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error("Demo salon not found");
    }

    setText("tenantLabel", `${data.name || "Demo Salon"} / salon_admin [DEMO]`);
  } catch (error) {
    console.error("applyDemoTenant error:", error);
    setText("tenantLabel", "Demo Salon / salon_admin [DEMO]");
  }
}

async function applySession(session) {
  currentUser = session?.user || null;

  document.getElementById("authLoggedOut")?.classList.toggle("hidden", Boolean(currentUser));
  document.getElementById("authLoggedIn")?.classList.toggle("hidden", !currentUser);

  if (!currentUser) {
    resetAdminState();
    hideLoading();
    return;
  }

  setText("whoAmI", currentUser.email || currentUser.id);

  try {
    isLoadingInitialData = true;
    showLoading("読み込み中...", "管理者データを読み込んでいます");

    await resolveSalon();
    await loadAll();

    subscribeRealtime();
    startRefresh();
  } catch (error) {
    console.error("applySession error:", error);
    showToast("管理者データの読み込みに失敗しました");
  } finally {
    isLoadingInitialData = false;
    hideLoading();
  }
}

function resetAdminState() {
  currentSalonId = null;
  allBookings = [];
  allBookingEvents = [];
  allStaff = [];
  allServices = [];

  updateMetrics([]);
  renderBookings();
  renderStaff();
  renderServices();

  setText("whoAmI", "-");
  setText("tenantLabel", "-");
  setText("lastUpdated", "最終更新: --");

  unsubscribeRealtime();
  stopRefresh();
}

async function resolveSalon() {
  const { data, error } = await sb
    .from("salon_members")
    .select("salon_id, role, salons(name, slug)")
    .eq("user_id", currentUser.id)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("salon_members not found");
  }

  currentSalonId = data.salon_id;

  const salon = Array.isArray(data.salons) ? data.salons[0] : data.salons;

  setText("tenantLabel", `${salon?.name || "Salon"} / ${data.role || "admin"}`);
}

async function sendMagicLink() {
  const email = document.getElementById("adminEmail")?.value.trim();

  if (!email) {
    showToast("メールを入力してください");
    return;
  }

  showLoading("送信中...", "ログインリンクを送信しています");

  try {
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/admin.html`,
      },
    });

    if (error) {
      throw error;
    }

    showToast("ログインリンクを送信しました");
  } catch (error) {
    console.error("sendMagicLink error:", error);
    showToast("ログインリンク送信に失敗しました");
  } finally {
    hideLoading();
  }
}

async function signOut() {
  try {
    if (APP_ENV.ADMIN_DEMO_MODE || APP_ENV.PUBLIC_DEMO_MODE) {
      window.location.reload();
      return;
    }

    await sb.auth.signOut();
    window.location.reload();
  } catch (error) {
    console.error("signOut error:", error);
    showToast("ログアウトに失敗しました");
  }
}

/* ========================= LOAD ========================= */

async function loadAll() {
  if (!currentSalonId) {
    return;
  }

  await loadServices();
  await loadStaff();
  await loadBookings();

  setText("lastUpdated", `最終更新: ${new Date().toLocaleString("ja-JP")}`);
}

async function loadBookings() {
  if (!currentSalonId) {
    return;
  }

  try {
    const { data, error } = await sb
      .from("admin_booking_view")
      .select("*")
      .eq("salon_id", currentSalonId)
      .order("booking_date", { ascending: true })
      .order("start_time", { ascending: true });

    if (error) {
      throw error;
    }

    allBookings = data || [];
    await loadBookingEvents(allBookings);

    renderBookings();

    setText("lastUpdated", `最終更新: ${new Date().toLocaleString("ja-JP")}`);
  } catch (error) {
    console.error("loadBookings error:", error);
    showToast("予約取得エラー");
  }
}

async function loadBookingEvents(bookings = allBookings) {
  if (!currentSalonId) {
    allBookingEvents = [];
    return;
  }

  const bookingIds = [...new Set(
    (bookings || [])
      .map((booking) => booking.id)
      .filter(Boolean)
      .map(String)
  )];

  if (!bookingIds.length) {
    allBookingEvents = [];
    return;
  }

  try {
    const { data, error } = await sb
      .from("booking_events")
      .select("id, booking_id, event_type, actor_type, actor_label, payload, created_at")
      .eq("salon_id", currentSalonId)
      .in("booking_id", bookingIds)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    allBookingEvents = data || [];
  } catch (error) {
    console.error("loadBookingEvents error:", error);
    allBookingEvents = [];
  }
}

async function loadServices() {
  if (!currentSalonId) {
    return;
  }

  try {
    const { data, error } = await sb
      .from("services")
      .select("*")
      .eq("salon_id", currentSalonId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    allServices = data || [];
    renderServices();
  } catch (error) {
    console.error("loadServices error:", error);
    showToast("サービス取得エラー");
  }
}

async function loadStaff() {
  if (!currentSalonId) {
    return;
  }

  try {
    const { data: staffRows, error: staffError } = await sb
      .from("staff")
      .select("*")
      .eq("salon_id", currentSalonId)
      .order("created_at", { ascending: true });

    if (staffError) {
      throw staffError;
    }

    const staffList = staffRows || [];
    const staffIds = staffList.map((staff) => staff.id);
    let mapRows = [];

    if (staffIds.length > 0) {
      const { data, error } = await sb
        .from("staff_service_map")
        .select("staff_id, service_id")
        .eq("salon_id", currentSalonId)
        .in("staff_id", staffIds);

      if (error) {
        throw error;
      }

      mapRows = data || [];
    }

    allStaff = staffList.map((staff) => ({
      ...staff,
      serviceIds: mapRows
        .filter((row) => String(row.staff_id) === String(staff.id))
        .map((row) => String(row.service_id)),
    }));

    renderStaff();
    renderStaffFilter();
  } catch (error) {
    console.error("loadStaff error:", error);
    showToast("スタッフ取得エラー");
  }
}

/* ========================= BOOKINGS ========================= */

function renderBookings() {
  const mount = document.getElementById("bookingsMount");
  const empty = document.getElementById("emptyState");

  if (!mount) {
    return;
  }

  syncSelectedDateInput();
  syncViewButtons();
  renderRangeLabel();

  const items = getFilteredBookings();

  updateMetrics(items);

  mount.innerHTML = "";

  if (empty) {
    empty.classList.toggle("hidden", items.length > 0);
  }

  if (!items.length) {
    mount.innerHTML = `<div class="empty-inline">予約はまだありません</div>`;
    return;
  }

  if (bookingState.view === "month") {
    renderMonthView(items, mount);
    return;
  }

  if (bookingState.view === "week") {
    renderWeekView(items, mount);
    return;
  }

  renderDayView(items, mount);
}

function getFilteredBookings() {
  const { start, end } = getCurrentRange();
  const search = bookingState.searchText.trim().toLowerCase();

  return [...allBookings]
    .filter((item) => {
      const date = String(item.booking_date || item.date || "").slice(0, 10);
      return date >= start && date <= end;
    })
    .filter((item) => {
      if (!bookingState.statusFilter) {
        return true;
      }

      return String(item.status || "") === bookingState.statusFilter;
    })
    .filter((item) => {
      if (!bookingState.staffFilter) {
        return true;
      }

      return String(item.staff_id || "") === String(bookingState.staffFilter);
    })
    .filter((item) => {
      if (!search) {
        return true;
      }

      const text = [
        item.customer_name,
        item.customer_phone,
        item.customer_email,
        item.service_name,
        item.staff_name,
        item.status,
        item.confirmation_status,
      ]
        .join(" ")
        .toLowerCase();

      return text.includes(search);
    })
    .sort((a, b) => {
      const dateCompare = String(a.booking_date || "").localeCompare(String(b.booking_date || ""));

      if (dateCompare !== 0) {
        return dateCompare;
      }

      return String(a.start_time || "").localeCompare(String(b.start_time || ""));
    });
}

function renderDayView(items, mount) {
  const wrap = document.createElement("div");
  wrap.className = "day-list";

  items.forEach((booking) => {
    wrap.appendChild(buildBookingCard(booking));
  });

  mount.appendChild(wrap);
}

function renderWeekView(items, mount) {
  const groups = new Map();

  items.forEach((booking) => {
    const date = String(booking.booking_date || "").slice(0, 10);

    if (!groups.has(date)) {
      groups.set(date, []);
    }

    groups.get(date).push(booking);
  });

  const wrap = document.createElement("div");
  wrap.className = "week-list";

  for (const [date, dayItems] of groups.entries()) {
    const group = document.createElement("section");
    group.className = "week-group";

    const head = document.createElement("div");
    head.className = "week-group-head";
    head.textContent = formatDateLabel(date, true);

    const body = document.createElement("div");
    body.className = "week-group-body";

    dayItems.forEach((booking) => {
      body.appendChild(buildBookingCard(booking));
    });

    group.appendChild(head);
    group.appendChild(body);
    wrap.appendChild(group);
  }

  mount.appendChild(wrap);
}

function renderMonthView(items, mount) {
  const selected = bookingState.selectedDate || getTodayString();
  const monthStart = firstDayOfMonth(selected);
  const monthEnd = lastDayOfMonth(selected);
  const monthStartDate = parseDateLocal(monthStart);
  const firstVisibleDate = addDays(monthStart, -monthStartDate.getDay());

  const grid = document.createElement("div");
  grid.className = "month-grid";

  ["日", "月", "火", "水", "木", "金", "土"].forEach((label) => {
    const cell = document.createElement("div");
    cell.className = "month-weekday";
    cell.textContent = label;
    grid.appendChild(cell);
  });

  for (let i = 0; i < 42; i += 1) {
    const date = addDays(firstVisibleDate, i);
    const count = items.filter((item) => String(item.booking_date || "").slice(0, 10) === date).length;

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "month-cell";

    if (date < monthStart || date > monthEnd) {
      cell.classList.add("is-other");
    }

    if (date === selected) {
      cell.classList.add("is-selected");
    }

    cell.innerHTML = `
      <span class="month-day">${safe(String(parseDateLocal(date).getDate()))}</span>
      <span class="month-count">${count ? `${count}件` : "予約なし"}</span>
    `;

    cell.addEventListener("click", () => {
      bookingState.selectedDate = date;
      bookingState.view = "day";
      renderBookings();
    });

    grid.appendChild(cell);
  }

  mount.appendChild(grid);
}

function buildBookingCard(booking) {
  const card = document.createElement("article");
  card.className = "booking-card";

  const status = String(booking.status || "pending");
  const confirmationStatus = booking.confirmation_status || booking.confirmationStatus || "";
  const bookingDate = String(booking.booking_date || "").slice(0, 10);
  const timelineHtml = buildBookingTimeline(booking);

  card.innerHTML = `
    <div class="booking-time">
      <strong>${safe(formatTime(booking.start_time))}</strong>
      <span>${safe(bookingDate)}${booking.end_time ? ` / ${safe(formatTime(booking.end_time))}` : ""}</span>
    </div>

    <div class="booking-body">
      <div class="booking-topline">
        <span class="status-pill ${safe(status)}">${safe(statusLabel(status))}</span>
        ${confirmationStatus ? `<span class="mini-pill">${safe(confirmationStatus)}</span>` : ""}
      </div>

      <div class="booking-grid">
        <div>
          <span class="tiny-label">お客様</span>
          <strong>${safe(booking.customer_name || "-")}</strong>
          <p>${safe(booking.customer_phone || "-")}</p>
        </div>

        <div>
          <span class="tiny-label">予約内容</span>
          <strong>${safe(booking.service_name || "-")}</strong>
          <p>${safe(booking.staff_name || "-")}</p>
        </div>
      </div>

      ${booking.note ? `<p class="booking-note">${safe(booking.note)}</p>` : ""}

      ${timelineHtml}

      <div class="booking-actions">
        ${buildBookingActions(booking)}
      </div>
    </div>
  `;

  card.querySelectorAll("[data-booking-status]").forEach((button) => {
    button.addEventListener("click", () => updateBookingStatus(booking.id, button.dataset.bookingStatus));
  });

  return card;
}

function buildBookingTimeline(booking) {
  const bookingId = String(booking?.id || "");

  if (!bookingId) {
    return "";
  }

  const events = allBookingEvents
    .filter((event) => String(event.booking_id) === bookingId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 4);

  if (!events.length) {
    return "";
  }

  const itemsHtml = events
    .map((event) => {
      const meta = getBookingEventMeta(event);
      const time = formatEventDateTime(event.created_at);

      return `
        <div class="booking-timeline-item ${safeAttr(meta.kind)}">
          <span class="booking-timeline-dot"></span>
          <div class="booking-timeline-content">
            <strong>${safe(meta.label)}</strong>
            <span>${safe(time)}</span>
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="booking-timeline">
      <div class="booking-timeline-head">
        <span>予約履歴</span>
      </div>
      <div class="booking-timeline-list">
        ${itemsHtml}
      </div>
    </div>
  `;
}

function getBookingEventMeta(event) {
  const eventType = String(event?.event_type || "");

  const map = {
    booking_created: {
      label: "予約が作成されました",
      kind: "created",
    },
    line_confirmation_sent: {
      label: "LINE確認メッセージ送信済み",
      kind: "sent",
    },
    customer_confirmed: {
      label: "お客様が確認しました",
      kind: "confirmed",
    },
    customer_cancelled: {
      label: "お客様がキャンセルしました",
      kind: "cancelled",
    },
    reminder_sent: {
      label: "リマインダー送信済み",
      kind: "sent",
    },
    reminder_failed: {
      label: "リマインダー送信失敗",
      kind: "failed",
    },
  };

  return map[eventType] || {
    label: eventType || "イベント",
    kind: "default",
  };
}

function formatEventDateTime(value) {
  if (!value) {
    return "--";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function buildBookingActions(booking) {
  const status = String(booking.status || "pending");
  const buttons = [];

  if (!["confirmed", "completed", "cancelled"].includes(status)) {
    buttons.push(`
      <button class="btn compact primary-soft" type="button" data-booking-status="confirmed">
        確認済み
      </button>
    `);
  }

  if (status !== "cancelled") {
    buttons.push(`
      <button class="btn compact danger-soft" type="button" data-booking-status="cancelled">
        キャンセル
      </button>
    `);
  }

  if (!["completed", "cancelled"].includes(status)) {
    buttons.push(`
      <button class="btn compact ghost" type="button" data-booking-status="completed">
        完了
      </button>
    `);
  }

  return buttons.join("");
}

async function updateBookingStatus(bookingId, nextStatus) {
  if (!currentSalonId || !bookingId || !nextStatus) {
    return;
  }

  showLoading("更新中...", "予約ステータスを更新しています");

  try {
    const patch = {
      status: nextStatus,
    };

    if (nextStatus === "confirmed") {
      patch.confirmed_at = new Date().toISOString();
    }

    if (nextStatus === "cancelled") {
      patch.cancelled_by = "admin";
    }

    const { error } = await sb
      .from("bookings")
      .update(patch)
      .eq("salon_id", currentSalonId)
      .eq("id", bookingId);

    if (error) {
      throw error;
    }

    showToast("予約を更新しました");
    await loadBookings();
  } catch (error) {
    console.error("updateBookingStatus error:", error);
    showToast("予約更新に失敗しました");
  } finally {
    hideLoading();
  }
}

function updateMetrics(items) {
  setText("metricTotal", String(items.length));
  setText("metricPending", String(items.filter((item) => String(item.status || "pending") === "pending").length));
  setText("metricRisk", String(items.filter((item) => String(item.status || "") === "risk").length));
  setText("metricCancelled", String(items.filter((item) => String(item.status || "") === "cancelled").length));
}

/* ========================= STAFF ========================= */

function renderStaff() {
  const mount = document.getElementById("staffList");

  if (!mount) {
    return;
  }

  mount.innerHTML = "";

  if (!allStaff.length) {
    mount.innerHTML = `<div class="empty-inline">スタッフがいません</div>`;
    return;
  }

  allStaff.forEach((staff) => {
    const card = document.createElement("div");
    card.className = "staff-card";

    const photoUrl = getSafePhotoUrl(staff.photo_url);
    const firstLetter = String(staff.name || "?").slice(0, 1).toUpperCase();

    const serviceNames = (staff.serviceIds || [])
      .map((id) => allServices.find((service) => String(service.id) === String(id))?.name)
      .filter(Boolean);

    const serviceTags = serviceNames.length
      ? serviceNames.map((name) => `<span class="tag">${safe(name)}</span>`).join("")
      : `<span class="tag muted">サービス未設定</span>`;

    card.innerHTML = `
      <div class="staff-avatar">
        ${
          photoUrl
            ? `<img src="${safeAttr(photoUrl)}" alt="${safeAttr(staff.name || "staff")}" />`
            : `<span>${safe(firstLetter)}</span>`
        }
      </div>

      <div class="card-content">
        <div class="card-title-row">
          <h4>${safe(staff.name || "-")}</h4>
          <span class="status-pill ${staff.is_active === false ? "inactive" : "active"}">
            ${staff.is_active === false ? "Inactive" : "Active"}
          </span>
        </div>

        <p>${safe(formatTime(staff.start_time))} - ${safe(formatTime(staff.end_time))} / ${safe(staff.slot_minutes || 30)}分</p>

        <div class="tags-row">
          ${serviceTags}
        </div>

        <div class="card-actions">
          <button class="btn compact ghost" type="button" data-edit-staff>編集</button>
          <button class="btn compact danger-soft" type="button" data-delete-staff>削除</button>
        </div>
      </div>
    `;

    card.querySelector("[data-edit-staff]")?.addEventListener("click", () => openStaffModal(staff));
    card.querySelector("[data-delete-staff]")?.addEventListener("click", () => deleteStaff(staff.id));

    mount.appendChild(card);
  });
}

function openStaffModal(staff = null) {
  editingStaffId = staff?.id || null;

  setText("staffModalTitle", editingStaffId ? "スタッフ編集" : "スタッフ追加");

  setInputValue("staffNameInput", staff?.name || "");
  setInputValue("staffStartTimeInput", formatTime(staff?.start_time || "10:00"));
  setInputValue("staffEndTimeInput", formatTime(staff?.end_time || "19:00"));
  setInputValue("staffSlotMinutesInput", String(staff?.slot_minutes || 30));

  clearFileInput("staffPhotoFile");

  setText(
    "staffPhotoCurrent",
    getSafePhotoUrl(staff?.photo_url) ? "現在の写真: 登録済み" : "現在の写真: なし"
  );

  const activeInput = document.getElementById("staffActiveInput");

  if (activeInput) {
    activeInput.checked = staff?.is_active !== false;
  }

  renderServiceCheckboxes(staff?.serviceIds || []);
  renderWorkDayCheckboxes(staff?.work_days || [0, 1, 2, 3, 4, 5, 6]);

  document.getElementById("deleteStaffBtn")?.classList.toggle("hidden", !editingStaffId);
  document.getElementById("staffModal")?.classList.remove("hidden");
}

function closeStaffModal() {
  editingStaffId = null;
  clearFileInput("staffPhotoFile");
  document.getElementById("staffModal")?.classList.add("hidden");
}

function renderServiceCheckboxes(selectedIds = []) {
  const container = document.getElementById("servicesCheckboxes");

  if (!container) {
    return;
  }

  container.innerHTML = "";

  if (!allServices.length) {
    container.innerHTML = `<p class="empty-mini">サービスがまだありません</p>`;
    return;
  }

  allServices.forEach((service) => {
    const checked = selectedIds.map(String).includes(String(service.id));
    const label = document.createElement("label");

    label.className = "checkbox-item";
    label.innerHTML = `
      <input type="checkbox" value="${safeAttr(service.id)}" ${checked ? "checked" : ""} />
      ${safe(service.name || "-")}
    `;

    container.appendChild(label);
  });
}

function renderWorkDayCheckboxes(selectedDays = [0, 1, 2, 3, 4, 5, 6]) {
  for (let i = 0; i < 7; i += 1) {
    const checkbox = document.getElementById(`workDay${i}`);

    if (checkbox) {
      checkbox.checked = selectedDays.includes(i);
    }
  }
}

async function saveStaff() {
  if (!currentSalonId) {
    return;
  }

  const existingStaff = editingStaffId
    ? allStaff.find((staff) => String(staff.id) === String(editingStaffId))
    : null;

  const name = document.getElementById("staffNameInput")?.value.trim();
  let photoUrl = getSafePhotoUrl(existingStaff?.photo_url) || null;

  const startTime = normalizeTime(document.getElementById("staffStartTimeInput")?.value || "10:00");
  const endTime = normalizeTime(document.getElementById("staffEndTimeInput")?.value || "19:00");
  const slotMinutes = Number(document.getElementById("staffSlotMinutesInput")?.value || 30);
  const isActive = document.getElementById("staffActiveInput")?.checked ?? true;
  const photoFile = document.getElementById("staffPhotoFile")?.files?.[0] || null;

  const serviceIds = Array.from(
    document.querySelectorAll("#servicesCheckboxes input[type='checkbox']:checked")
  ).map((input) => input.value);

  const workDays = Array.from(document.querySelectorAll("input[id^='workDay']:checked"))
    .map((input) => Number(input.value))
    .sort();

  if (!name) {
    showToast("スタッフ名を入力してください");
    return;
  }

  if (!startTime || !endTime || timeToMinutes(startTime) >= timeToMinutes(endTime)) {
    showToast("勤務時間を確認してください");
    return;
  }

  if (!Number.isFinite(slotMinutes) || slotMinutes < 5) {
    showToast("予約間隔を確認してください");
    return;
  }

  showLoading("保存中...", "スタッフ情報を保存しています");

  try {
    if (photoFile) {
      const uploadedUrl = await uploadStaffPhoto(photoFile);

      if (!uploadedUrl) {
        throw new Error("photo_upload_failed");
      }

      photoUrl = uploadedUrl;
    }

    let staffId = editingStaffId;

    const payload = {
      name,
      photo_url: photoUrl,
      start_time: startTime,
      end_time: endTime,
      slot_minutes: slotMinutes,
      is_active: isActive,
      work_days: workDays,
    };

    if (staffId) {
      const { data, error } = await sb
        .from("staff")
        .update(payload)
        .eq("salon_id", currentSalonId)
        .eq("id", staffId)
        .select("id")
        .single();

      if (error) {
        throw error;
      }

      if (!data?.id) {
        throw new Error("staff_update_failed");
      }
    } else {
      const { data, error } = await sb
        .from("staff")
        .insert({
          salon_id: currentSalonId,
          code: makeCode(name),
          ...payload,
        })
        .select("id")
        .single();

      if (error) {
        throw error;
      }

      staffId = data.id;
    }

    await replaceStaffServices(staffId, serviceIds);

    closeStaffModal();

    await loadStaff();

    showToast("スタッフを保存しました");
  } catch (error) {
    console.error("saveStaff error:", error);
    showToast("スタッフ保存に失敗しました");
  } finally {
    hideLoading();
  }
}

async function uploadStaffPhoto(file) {
  return uploadImageToStorage(file, "staff", "uploadStaffPhoto");
}

async function replaceStaffServices(staffId, serviceIds) {
  const { error: deleteError } = await sb
    .from("staff_service_map")
    .delete()
    .eq("salon_id", currentSalonId)
    .eq("staff_id", staffId);

  if (deleteError) {
    throw deleteError;
  }

  if (!serviceIds.length) {
    return;
  }

  const rows = serviceIds.map((serviceId) => ({
    salon_id: currentSalonId,
    staff_id: staffId,
    service_id: serviceId,
  }));

  const { error: insertError } = await sb.from("staff_service_map").insert(rows);

  if (insertError) {
    throw insertError;
  }
}

async function deleteStaff(id = editingStaffId) {
  if (!id || !currentSalonId) {
    return;
  }

  if (!confirm("このスタッフを削除しますか？")) {
    return;
  }

  showLoading("削除中...", "スタッフを削除しています");

  try {
    await sb
      .from("staff_service_map")
      .delete()
      .eq("salon_id", currentSalonId)
      .eq("staff_id", id);

    const { error } = await sb
      .from("staff")
      .delete()
      .eq("salon_id", currentSalonId)
      .eq("id", id);

    if (error) {
      throw error;
    }

    closeStaffModal();

    await loadStaff();
    await loadBookings();

    showToast("スタッフを削除しました");
  } catch (error) {
    console.error("deleteStaff error:", error);
    showToast("スタッフ削除に失敗しました");
  } finally {
    hideLoading();
  }
}

function renderStaffFilter() {
  const select = document.getElementById("staffFilter");

  if (!select) {
    return;
  }

  const current = select.value;

  select.innerHTML = `<option value="">全担当者</option>`;

  allStaff.forEach((staff) => {
    const option = document.createElement("option");
    option.value = staff.id;
    option.textContent = staff.name || "-";
    select.appendChild(option);
  });

  select.value = allStaff.some((staff) => String(staff.id) === String(current)) ? current : "";
  bookingState.staffFilter = select.value;
}

/* ========================= SERVICES ========================= */

function renderServices() {
  const mount = document.getElementById("servicesList");

  if (!mount) {
    return;
  }

  mount.innerHTML = "";

  if (!allServices.length) {
    mount.innerHTML = `<div class="empty-inline">サービスがありません</div>`;
    return;
  }

  allServices.forEach((service) => {
    const card = document.createElement("div");
    card.className = "service-card";

    const iconUrl = getSafePhotoUrl(service.icon_url);
    const firstLetter = String(service.name || "S").slice(0, 1).toUpperCase();

    card.innerHTML = `
      <div class="service-icon-box">
        ${
          iconUrl
            ? `<img src="${safeAttr(iconUrl)}" alt="${safeAttr(service.name || "service")}" />`
            : `<span>${safe(firstLetter)}</span>`
        }
      </div>

      <div class="card-content">
        <div class="card-title-row">
          <h4>${safe(service.name || "-")}</h4>
          <span class="status-pill ${service.is_active === false ? "inactive" : "active"}">
            ${service.is_active === false ? "Inactive" : "Active"}
          </span>
        </div>

        <p>
          ${safe(service.duration_minutes || 0)}分 /
          ¥${Number(service.price_jpy || 0).toLocaleString("ja-JP")}
          ${service.category ? ` / ${safe(service.category)}` : ""}
        </p>

        <p class="muted-line">
          code: ${safe(service.code || "-")} / sort: ${safe(service.sort_order ?? 100)}
        </p>

        ${service.description ? `<p class="description-line">${safe(service.description)}</p>` : ""}

        <div class="card-actions">
          <button class="btn compact ghost" type="button" data-edit-service>編集</button>
          <button class="btn compact danger-soft" type="button" data-delete-service>削除</button>
        </div>
      </div>
    `;

    card.querySelector("[data-edit-service]")?.addEventListener("click", () => openServiceModal(service));
    card.querySelector("[data-delete-service]")?.addEventListener("click", () => deleteService(service.id));

    mount.appendChild(card);
  });
}

function openServiceModal(service = null) {
  editingServiceId = service?.id || null;

  setText("serviceModalTitle", editingServiceId ? "サービス編集" : "サービス追加");

  setInputValue("serviceNameInput", service?.name || "");
  setInputValue("serviceCodeInput", service?.code || "");
  setInputValue("serviceCategoryInput", service?.category || "");
  setInputValue("serviceDurationInput", String(service?.duration_minutes || 60));
  setInputValue("servicePriceInput", String(service?.price_jpy || 0));
  setInputValue("serviceSortInput", String(service?.sort_order ?? 100));
  setInputValue("serviceDescriptionInput", service?.description || "");
  setInputValue("serviceIconUrlInput", getSafePhotoUrl(service?.icon_url) || "");

  clearFileInput("serviceIconFile");

  setText(
    "serviceIconCurrent",
    getSafePhotoUrl(service?.icon_url) ? "現在のアイコン: 登録済み" : "現在のアイコン: なし"
  );

  const activeInput = document.getElementById("serviceActiveInput");

  if (activeInput) {
    activeInput.checked = service?.is_active !== false;
  }

  document.getElementById("deleteServiceBtn")?.classList.toggle("hidden", !editingServiceId);
  document.getElementById("serviceModal")?.classList.remove("hidden");
}

function closeServiceModal() {
  editingServiceId = null;
  clearFileInput("serviceIconFile");
  document.getElementById("serviceModal")?.classList.add("hidden");
}

async function saveService() {
  if (!currentSalonId) {
    return;
  }

  const existingService = editingServiceId
    ? allServices.find((service) => String(service.id) === String(editingServiceId))
    : null;

  const name = document.getElementById("serviceNameInput")?.value.trim();
  const codeInput = document.getElementById("serviceCodeInput")?.value.trim();
  const category = document.getElementById("serviceCategoryInput")?.value.trim() || null;
  const durationMinutes = Number(document.getElementById("serviceDurationInput")?.value || 60);
  const priceJpy = Number(document.getElementById("servicePriceInput")?.value || 0);
  const sortOrder = Number(document.getElementById("serviceSortInput")?.value || 100);
  const description = document.getElementById("serviceDescriptionInput")?.value.trim() || null;
  const isActive = document.getElementById("serviceActiveInput")?.checked ?? true;
  const iconFile = document.getElementById("serviceIconFile")?.files?.[0] || null;

  let iconUrl =
    document.getElementById("serviceIconUrlInput")?.value.trim() ||
    getSafePhotoUrl(existingService?.icon_url) ||
    null;

  if (!name) {
    showToast("サービス名を入力してください");
    return;
  }

  if (!Number.isFinite(durationMinutes) || durationMinutes < 5) {
    showToast("施術時間を確認してください");
    return;
  }

  if (!Number.isFinite(priceJpy) || priceJpy < 0) {
    showToast("価格を確認してください");
    return;
  }

  showLoading("保存中...", "サービス情報を保存しています");

  try {
    if (iconFile) {
      const uploadedUrl = await uploadServiceIcon(iconFile);

      if (!uploadedUrl) {
        throw new Error("service_icon_upload_failed");
      }

      iconUrl = uploadedUrl;
      setInputValue("serviceIconUrlInput", uploadedUrl);
    }

    const payload = {
      name,
      code: codeInput || makeCode(name),
      category,
      duration_minutes: durationMinutes,
      price_jpy: priceJpy,
      sort_order: Number.isFinite(sortOrder) ? sortOrder : 100,
      is_active: isActive,
      description,
      icon_url: iconUrl,
    };

    if (editingServiceId) {
      const { error } = await sb
        .from("services")
        .update(payload)
        .eq("salon_id", currentSalonId)
        .eq("id", editingServiceId);

      if (error) {
        throw error;
      }
    } else {
      const { error } = await sb
        .from("services")
        .insert({
          salon_id: currentSalonId,
          ...payload,
        });

      if (error) {
        throw error;
      }
    }

    closeServiceModal();

    await loadServices();
    await loadStaff();

    showToast("サービスを保存しました");
  } catch (error) {
    console.error("saveService error:", error);
    showToast(error.message || "サービス保存に失敗しました");
  } finally {
    hideLoading();
  }
}

async function uploadServiceIcon(file) {
  return uploadImageToStorage(file, "services", "uploadServiceIcon");
}

async function deleteService(id = editingServiceId) {
  if (!id || !currentSalonId) {
    return;
  }

  if (!confirm("このサービスを削除しますか？スタッフとの関連も解除されます。")) {
    return;
  }

  showLoading("削除中...", "サービスを削除しています");

  try {
    await sb
      .from("staff_service_map")
      .delete()
      .eq("salon_id", currentSalonId)
      .eq("service_id", id);

    const { error } = await sb
      .from("services")
      .delete()
      .eq("salon_id", currentSalonId)
      .eq("id", id);

    if (error) {
      throw error;
    }

    closeServiceModal();

    await loadServices();
    await loadStaff();
    await loadBookings();

    showToast("サービスを削除しました");
  } catch (error) {
    console.error("deleteService error:", error);
    showToast("サービス削除に失敗しました");
  } finally {
    hideLoading();
  }
}

/* ========================= STORAGE ========================= */

async function uploadImageToStorage(file, folder, logLabel = "uploadImageToStorage") {
  if (!file || !currentSalonId) {
    return null;
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

  if (!allowedTypes.includes(file.type)) {
    showToast("画像は JPG / PNG / WEBP のみ使用できます");
    return null;
  }

  if (file.size > 5 * 1024 * 1024) {
    showToast("画像は5MB以下にしてください");
    return null;
  }

  const extension = getFileExtension(file.name, file.type);
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  const cleanFolder = String(folder || "uploads").replace(/[^a-z0-9_-]/gi, "");
  const path = `${currentSalonId}/${cleanFolder}/${fileName}`;

  const { error } = await sb.storage.from(STORAGE_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type,
  });

  if (error) {
    console.error(`${logLabel} error:`, error);
    showToast(error.message || "画像アップロードに失敗しました");
    return null;
  }

  const { data } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);

  return data?.publicUrl || null;
}

/* ========================= REALTIME / REFRESH ========================= */

function subscribeRealtime() {
  if (!currentSalonId || !sb?.channel) {
    return;
  }

  unsubscribeRealtime();

  realtimeChannel = sb
    .channel(`admin-dashboard-${currentSalonId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "bookings",
        filter: `salon_id=eq.${currentSalonId}`,
      },
      () => loadBookings()
    )

    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "booking_events",
        filter: `salon_id=eq.${currentSalonId}`,
      },
      () => loadBookings()
    )

    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "staff",
        filter: `salon_id=eq.${currentSalonId}`,
      },
      () => loadStaff()
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "services",
        filter: `salon_id=eq.${currentSalonId}`,
      },
      async () => {
        await loadServices();
        await loadStaff();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "staff_service_map",
        filter: `salon_id=eq.${currentSalonId}`,
      },
      () => loadStaff()
    )
    .subscribe((status) => {
      console.log("[ADMIN] realtime status:", status);
    });
}

function unsubscribeRealtime() {
  if (realtimeChannel && sb?.removeChannel) {
    sb.removeChannel(realtimeChannel);
  }

  realtimeChannel = null;
}

function startRefresh() {
  stopRefresh();

  refreshTimer = window.setInterval(() => {
    if (!currentSalonId || isLoadingInitialData) {
      return;
    }

    loadAll();
  }, 60000);
}

function stopRefresh() {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
  }

  refreshTimer = null;
}

/* ========================= UI BINDINGS ========================= */

function bindUI() {
  document.getElementById("sendMagicLinkBtn")?.addEventListener("click", sendMagicLink);
  document.getElementById("logoutBtn")?.addEventListener("click", signOut);
  document.getElementById("refreshBtn")?.addEventListener("click", () => loadAll());

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      bookingState.view = button.dataset.view;

      if (bookingState.view === "today") {
        bookingState.selectedDate = getTodayString();
      }

      renderBookings();
    });
  });

  document.getElementById("selectedDateInput")?.addEventListener("change", (event) => {
    bookingState.selectedDate = event.target.value || getTodayString();

    if (bookingState.view === "today") {
      bookingState.view = "day";
    }

    renderBookings();
  });

  document.getElementById("statusFilter")?.addEventListener("change", (event) => {
    bookingState.statusFilter = event.target.value || "";
    renderBookings();
  });

  document.getElementById("staffFilter")?.addEventListener("change", (event) => {
    bookingState.staffFilter = event.target.value || "";
    renderBookings();
  });

  document.getElementById("searchInput")?.addEventListener("input", (event) => {
    bookingState.searchText = event.target.value || "";
    renderBookings();
  });

  document.getElementById("todayBtn")?.addEventListener("click", () => {
    bookingState.selectedDate = getTodayString();
    bookingState.view = "today";
    renderBookings();
  });

  document.getElementById("prevRangeBtn")?.addEventListener("click", () => moveRange(-1));
  document.getElementById("nextRangeBtn")?.addEventListener("click", () => moveRange(1));

  document.getElementById("addStaffBtn")?.addEventListener("click", () => openStaffModal());
  document.getElementById("closeStaffModalBtn")?.addEventListener("click", closeStaffModal);
  document.getElementById("cancelStaffBtn")?.addEventListener("click", closeStaffModal);
  document.getElementById("saveStaffBtn")?.addEventListener("click", saveStaff);
  document.getElementById("deleteStaffBtn")?.addEventListener("click", () => deleteStaff());

  document.getElementById("addServiceBtn")?.addEventListener("click", () => openServiceModal());
  document.getElementById("closeServiceModalBtn")?.addEventListener("click", closeServiceModal);
  document.getElementById("cancelServiceBtn")?.addEventListener("click", closeServiceModal);
  document.getElementById("saveServiceBtn")?.addEventListener("click", saveService);
  document.getElementById("deleteServiceBtn")?.addEventListener("click", () => deleteService());

  document.getElementById("staffPhotoFile")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];

    setText("staffPhotoCurrent", file ? `選択中: ${file.name}` : "現在の写真: なし");
  });

  document.getElementById("serviceIconFile")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];

    setText("serviceIconCurrent", file ? `選択中: ${file.name}` : "現在のアイコン: なし");
  });

  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (event) => {
      if (event.target !== backdrop) {
        return;
      }

      if (backdrop.id === "staffModal") {
        closeStaffModal();
      }

      if (backdrop.id === "serviceModal") {
        closeServiceModal();
      }
    });
  });
}

function switchTab(tab) {
  currentTab = tab || "bookings";

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === currentTab);
  });

  document.getElementById("bookingsTab")?.classList.toggle("hidden", currentTab !== "bookings");
  document.getElementById("staffTab")?.classList.toggle("hidden", currentTab !== "staff");
  document.getElementById("servicesTab")?.classList.toggle("hidden", currentTab !== "services");

  const titles = {
    bookings: "Bookings",
    staff: "Staff",
    services: "Services",
  };

  setText("mainTitle", titles[currentTab] || "Bookings");
}

function moveRange(direction) {
  const step = Number(direction) || 0;
  const view = bookingState.view === "today" ? "day" : bookingState.view;

  bookingState.view = view;

  if (view === "month") {
    bookingState.selectedDate = addMonths(bookingState.selectedDate, step);
  } else if (view === "week") {
    bookingState.selectedDate = addDays(bookingState.selectedDate, step * 7);
  } else {
    bookingState.selectedDate = addDays(bookingState.selectedDate, step);
  }

  renderBookings();
}

function syncSelectedDateInput() {
  const input = document.getElementById("selectedDateInput");

  if (input) {
    input.value = bookingState.selectedDate || getTodayString();
  }
}

function syncViewButtons() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === bookingState.view);
  });
}

function renderRangeLabel() {
  const label = document.getElementById("rangeLabel");

  if (!label) {
    return;
  }

  const { start, end } = getCurrentRange();

  if (start === end) {
    label.textContent = formatDateLabel(start, true);
  } else {
    label.textContent = `${formatDateLabel(start, false)} - ${formatDateLabel(end, false)}`;
  }
}

/* ========================= DATE HELPERS ========================= */

function getCurrentRange() {
  const selected = bookingState.selectedDate || getTodayString();

  if (bookingState.view === "today") {
    const today = getTodayString();

    return {
      start: today,
      end: today,
    };
  }

  if (bookingState.view === "month") {
    return {
      start: firstDayOfMonth(selected),
      end: lastDayOfMonth(selected),
    };
  }

  if (bookingState.view === "week") {
    const date = parseDateLocal(selected);
    const start = addDays(formatDateInput(date), -date.getDay());

    return {
      start,
      end: addDays(start, 6),
    };
  }

  return {
    start: selected,
    end: selected,
  };
}

function getTodayString() {
  return formatDateInput(new Date());
}

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseDateLocal(value) {
  const [year, month, day] = String(value || getTodayString())
    .split("-")
    .map(Number);

  return new Date(year, (month || 1) - 1, day || 1);
}

function addDays(value, amount) {
  const date = parseDateLocal(value);

  date.setDate(date.getDate() + Number(amount || 0));

  return formatDateInput(date);
}

function addMonths(value, amount) {
  const date = parseDateLocal(value);

  date.setMonth(date.getMonth() + Number(amount || 0));

  return formatDateInput(date);
}

function firstDayOfMonth(value) {
  const date = parseDateLocal(value);

  return formatDateInput(new Date(date.getFullYear(), date.getMonth(), 1));
}

function lastDayOfMonth(value) {
  const date = parseDateLocal(value);

  return formatDateInput(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

function formatDateLabel(value, withWeekday = false) {
  if (!value) {
    return "--";
  }

  const date = parseDateLocal(value);

  const options = withWeekday
    ? {
        year: "numeric",
        month: "short",
        day: "numeric",
        weekday: "short",
      }
    : {
        month: "short",
        day: "numeric",
      };

  return new Intl.DateTimeFormat("ja-JP", options).format(date);
}

/* ========================= GENERIC HELPERS ========================= */

function showLoading(title = "読み込み中...", text = "処理しています") {
  setText("loadingTitle", title);
  setText("loadingText", text);

  document.getElementById("loadingOverlay")?.classList.remove("hidden");
}

function hideLoading() {
  document.getElementById("loadingOverlay")?.classList.add("hidden");
}

function showToast(message) {
  const toast = document.getElementById("toast");

  if (!toast) {
    alert(message);
    return;
  }

  toast.textContent = message;
  toast.classList.remove("hidden");

  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }

  toastTimer = window.setTimeout(() => {
    toast.classList.add("hidden");
  }, 3600);
}

function setText(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value;
  }
}

function setInputValue(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.value = value;
  }
}

function clearFileInput(id) {
  const input = document.getElementById(id);

  if (input) {
    input.value = "";
  }
}

function statusLabel(status) {
  const map = {
    pending: "未確認",
    confirmed: "確認済み",
    risk: "要確認",
    cancelled: "キャンセル",
    completed: "完了",
    no_show: "No-show",
  };

  return map[String(status || "pending")] || String(status || "pending");
}

function formatTime(value) {
  if (!value) {
    return "--:--";
  }

  return String(value).slice(0, 5);
}

function normalizeTime(value) {
  if (!value) {
    return null;
  }

  const match = String(value).match(/^(\d{1,2}):(\d{2})/);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
}

function timeToMinutes(value) {
  const time = normalizeTime(value);

  if (!time) {
    return NaN;
  }

  const [hours, minutes] = time.split(":").map(Number);

  return hours * 60 + minutes;
}

function makeCode(value) {
  const base = String(value || "item")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || `item-${Date.now()}`;
}

function getFileExtension(name, mimeType) {
  const fromName = String(name || "")
    .split(".")
    .pop()
    ?.toLowerCase();

  if (["jpg", "jpeg", "png", "webp"].includes(fromName)) {
    return fromName === "jpeg" ? "jpg" : fromName;
  }

  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };

  return map[mimeType] || "jpg";
}

function getSafePhotoUrl(value) {
  const url = String(value || "").trim();

  if (!url) {
    return "";
  }

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  if (/^blob:/i.test(url)) {
    return url;
  }

  return "";
}

function safe(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeAttr(value) {
  return safe(value).replace(/`/g, "&#096;");
}