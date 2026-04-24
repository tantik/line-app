const sb = window.supabaseClient;
const env = window.__APP_ENV__ || window.appEnv || {};

let currentSalonId = null;
let currentSalonSlug = null;
let currentUser = null;
let realtimeChannel = null;
let refreshTimer = null;

let allBookings = [];
let allStaff = [];
let allServices = [];

let currentTab = "bookings";
let editingStaffId = null;
let editingServiceId = null;
let isSavingStaff = false;
let isSavingService = false;

const bookingState = {
  view: "today",
  selectedDate: getTodayString(),
  statusFilter: "",
  staffFilter: "",
  searchText: "",
};

document.addEventListener("DOMContentLoaded", initAdmin);

async function initAdmin() {
  bindAdminUi();
  setInitialDate();
  switchTab("bookings");

  if (!sb) {
    toast("Supabase client が見つかりません");
    setLoading(false);
    return;
  }

  const { data, error } = await sb.auth.getSession();
  if (error) console.error("getSession error:", error);

  await applySession(data?.session || null);

  sb.auth.onAuthStateChange(async (_event, session) => {
    await applySession(session);
  });
}

function bindAdminUi() {
  document.getElementById("sendMagicLinkBtn")?.addEventListener("click", sendMagicLink);
  document.getElementById("signOutBtn")?.addEventListener("click", signOut);
  document.getElementById("refreshBtn")?.addEventListener("click", () => refreshAll(true));

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document.querySelectorAll(".view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      bookingState.view = btn.dataset.view || "today";
      if (bookingState.view === "today") bookingState.selectedDate = getTodayString();
      syncSelectedDateInput();
      syncViewButtons();
      renderRangeLabel();
      renderBookings();
    });
  });

  document.getElementById("selectedDate")?.addEventListener("change", (e) => {
    bookingState.selectedDate = e.target.value || getTodayString();
    renderRangeLabel();
    renderBookings();
  });

  document.getElementById("statusFilter")?.addEventListener("change", (e) => {
    bookingState.statusFilter = e.target.value || "";
    renderBookings();
  });

  document.getElementById("staffFilter")?.addEventListener("change", (e) => {
    bookingState.staffFilter = e.target.value || "";
    renderBookings();
  });

  document.getElementById("searchText")?.addEventListener("input", (e) => {
    bookingState.searchText = (e.target.value || "").trim().toLowerCase();
    renderBookings();
  });

  document.getElementById("prevRangeBtn")?.addEventListener("click", () => shiftRange(-1));
  document.getElementById("nextRangeBtn")?.addEventListener("click", () => shiftRange(1));

  document.getElementById("jumpTodayBtn")?.addEventListener("click", () => {
    bookingState.selectedDate = getTodayString();
    bookingState.view = "today";
    syncSelectedDateInput();
    syncViewButtons();
    renderRangeLabel();
    renderBookings();
  });

  document.getElementById("addStaffBtn")?.addEventListener("click", () => openStaffModal());
  document.getElementById("saveStaffBtn")?.addEventListener("click", saveStaff);
  document.getElementById("deleteStaffBtn")?.addEventListener("click", deleteEditingStaff);
  document.getElementById("closeStaffModalBtn")?.addEventListener("click", closeStaffModal);
  document.getElementById("cancelStaffModalBtn")?.addEventListener("click", closeStaffModal);

  document.getElementById("addServiceBtn")?.addEventListener("click", () => openServiceModal());
  document.getElementById("saveServiceBtn")?.addEventListener("click", saveService);
  document.getElementById("deleteServiceBtn")?.addEventListener("click", deleteEditingService);
  document.getElementById("closeServiceModalBtn")?.addEventListener("click", closeServiceModal);
  document.getElementById("cancelServiceModalBtn")?.addEventListener("click", closeServiceModal);

  document.getElementById("staffModal")?.addEventListener("click", (event) => {
    if (event.target.id === "staffModal") closeStaffModal();
  });

  document.getElementById("serviceModal")?.addEventListener("click", (event) => {
    if (event.target.id === "serviceModal") closeServiceModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeStaffModal();
      closeServiceModal();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !currentSalonId) return;
    loadBookings(false);
  });
}

async function sendMagicLink() {
  const email = document.getElementById("adminEmail")?.value.trim();

  if (!email) {
    toast("メールを入力してください");
    return;
  }

  setLoading(true, "送信中...", "ログインリンクを送信しています");

  try {
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: env.ADMIN_REDIRECT_TO || `${window.location.origin}/admin.html`,
      },
    });

    if (error) throw error;
    toast("ログインリンクを送信しました");
  } catch (error) {
    console.error("sendMagicLink error:", error);
    toast(error.message || "ログインリンク送信に失敗しました");
  } finally {
    setLoading(false);
  }
}

async function signOut() {
  try {
    await sb.auth.signOut();
  } catch (error) {
    console.error("signOut error:", error);
    toast("ログアウトに失敗しました");
  }
}

async function applySession(session) {
  currentUser = session?.user || null;

  document.getElementById("authLoggedOut")?.classList.toggle("hidden", !!currentUser);
  document.getElementById("authLoggedIn")?.classList.toggle("hidden", !currentUser);

  if (!currentUser) {
    currentSalonId = null;
    currentSalonSlug = null;
    allBookings = [];
    allStaff = [];
    allServices = [];

    setText("whoAmI", "-");
    setText("tenantLabel", "-");
    populateStaffFilter([]);
    renderBookings();
    renderStaff([]);
    renderServices([]);

    unsubscribeRealtime();
    stopRefresh();
    setLoading(false);
    return;
  }

  setLoading(true, "読み込み中...", "管理者権限を確認しています");

  try {
    setText("whoAmI", currentUser.email || currentUser.id);
    await resolveSalonMembership();
    await refreshAll(false);
    subscribeRealtime();
    startRefresh();
  } catch (error) {
    console.error("applySession error:", error);
    toast(error.message || "このアカウントにはサロン権限がありません");
  } finally {
    setLoading(false);
  }
}

async function resolveSalonMembership() {
  const { data, error } = await sb
    .from("salon_members")
    .select("salon_id, role, salons(name, slug)")
    .eq("user_id", currentUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("membership_not_found");

  currentSalonId = data.salon_id;
  currentSalonSlug = data.salons?.slug || null;

  setText("tenantLabel", `${data.salons?.name || "-"} / ${data.role || "-"}`);
}

async function refreshAll(showSpinner = false) {
  if (!currentSalonId) return;

  if (showSpinner) setLoading(true, "読み込み中...", "データを更新しています");

  try {
    await loadServices();
    await loadStaff();
    await loadBookings(false);
  } finally {
    if (showSpinner) setLoading(false);
  }
}

function switchTab(tab) {
  currentTab = tab || "bookings";

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tab === currentTab);
  });

  document.getElementById("bookingsSection")?.classList.toggle("hidden", currentTab !== "bookings");
  document.getElementById("staffSection")?.classList.toggle("hidden", currentTab !== "staff");
  document.getElementById("servicesSection")?.classList.toggle("hidden", currentTab !== "services");

  const titles = {
    bookings: "Bookings",
    staff: "Staff",
    services: "Services",
  };

  setText("pageTitle", titles[currentTab] || "Bookings");
}

/* -------------------- LOAD DATA -------------------- */

async function loadBookings(showSpinner = false) {
  if (!currentSalonId) return;

  if (showSpinner) setLoading(true, "読み込み中...", "予約一覧を更新しています");

  try {
    const { data, error } = await sb
      .from("admin_booking_view")
      .select("*")
      .eq("salon_id", currentSalonId)
      .order("booking_date", { ascending: true })
      .order("start_time", { ascending: true });

    if (error) throw error;

    allBookings = Array.isArray(data) ? data : [];
    hydrateStaffFilter();
    renderBookings();

    setText("lastUpdated", `最終更新: ${new Date().toLocaleString("ja-JP")}`);
  } catch (error) {
    console.error("loadBookings error:", error);
    toast(error.message || "予約読み込みに失敗しました");
  } finally {
    if (showSpinner) setLoading(false);
  }
}

async function loadServices() {
  if (!currentSalonId) return;

  try {
    const { data, error } = await sb
      .from("services")
      .select("*")
      .eq("salon_id", currentSalonId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) throw error;

    allServices = Array.isArray(data) ? data : [];
    renderServices(allServices);
  } catch (error) {
    console.error("loadServices error:", error);
    toast(error.message || "サービス取得エラー");
    allServices = [];
    renderServices([]);
  }
}

async function loadStaff() {
  if (!currentSalonId) return;

  try {
    const { data: staffRows, error: staffError } = await sb
      .from("staff")
      .select("*")
      .eq("salon_id", currentSalonId)
      .order("created_at", { ascending: true });

    if (staffError) throw staffError;

    const staffList = Array.isArray(staffRows) ? staffRows : [];
    const staffIds = staffList.map((item) => item.id);

    let links = [];

    if (staffIds.length) {
      const { data: linkRows, error: linkError } = await sb
        .from("staff_service_map")
        .select("staff_id, service_id")
        .eq("salon_id", currentSalonId)
        .in("staff_id", staffIds);

      if (linkError) throw linkError;
      links = Array.isArray(linkRows) ? linkRows : [];
    }

    allStaff = staffList.map((staff) => ({
      ...staff,
      serviceIds: links
        .filter((link) => String(link.staff_id) === String(staff.id))
        .map((link) => String(link.service_id)),
    }));

    renderStaff(allStaff);
    hydrateStaffFilter();
  } catch (error) {
    console.error("loadStaff error:", error);
    toast(error.message || "スタッフ取得エラー");
    allStaff = [];
    renderStaff([]);
  }
}

/* -------------------- BOOKINGS -------------------- */

function renderBookings() {
  syncViewButtons();
  syncSelectedDateInput();
  renderRangeLabel();

  const mount = document.getElementById("bookingsMount");
  const empty = document.getElementById("emptyState");
  if (!mount || !empty) return;

  const items = getFilteredBookings();
  updateMetrics(items);

  mount.innerHTML = "";
  empty.classList.toggle("hidden", items.length > 0);

  if (!items.length) return;

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
  let items = Array.isArray(allBookings) ? [...allBookings] : [];
  const { start, end } = getCurrentRange();

  items = items.filter((item) => {
    const date = String(item.booking_date || "").slice(0, 10);
    return date >= start && date <= end;
  });

  if (bookingState.statusFilter) {
    items = items.filter((item) => item.status === bookingState.statusFilter);
  }

  if (bookingState.staffFilter) {
    items = items.filter((item) => String(item.staff_id || "") === String(bookingState.staffFilter));
  }

  if (bookingState.searchText) {
    items = items.filter((item) => {
      const haystack = [
        item.customer_name,
        item.customer_phone,
        item.service_name,
        item.staff_name,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(bookingState.searchText);
    });
  }

  return items.sort((a, b) => {
    const dateCmp = String(a.booking_date).localeCompare(String(b.booking_date));
    if (dateCmp !== 0) return dateCmp;
    return String(a.start_time).localeCompare(String(b.start_time));
  });
}

function renderDayView(items, mount) {
  const wrap = document.createElement("div");
  wrap.className = "day-list";

  items.forEach((item) => {
    wrap.appendChild(buildBookingCard(item));
  });

  mount.appendChild(wrap);
}

function renderWeekView(items, mount) {
  const groups = new Map();

  items.forEach((item) => {
    const date = String(item.booking_date || "").slice(0, 10);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(item);
  });

  const wrap = document.createElement("div");
  wrap.className = "week-list";

  Array.from(groups.entries()).forEach(([date, dayItems]) => {
    const group = document.createElement("section");
    group.className = "week-group";

    const head = document.createElement("div");
    head.className = "week-group-head";
    head.textContent = formatDateLabel(date, true);

    const body = document.createElement("div");
    body.className = "week-group-body";

    dayItems.forEach((item) => body.appendChild(buildBookingCard(item)));

    group.appendChild(head);
    group.appendChild(body);
    wrap.appendChild(group);
  });

  mount.appendChild(wrap);
}

function renderMonthView(items, mount) {
  const selected = bookingState.selectedDate || getTodayString();
  const monthStart = firstDayOfMonth(selected);
  const monthEnd = lastDayOfMonth(selected);
  const monthStartDate = parseDateLocal(monthStart);

  const grid = document.createElement("div");
  grid.className = "month-grid";

  ["日", "月", "火", "水", "木", "金", "土"].forEach((label) => {
    const cell = document.createElement("div");
    cell.className = "month-weekday";
    cell.textContent = label;
    grid.appendChild(cell);
  });

  const firstVisibleDate = addDays(monthStart, -monthStartDate.getDay());

  for (let i = 0; i < 42; i++) {
    const date = addDays(firstVisibleDate, i);
    const count = items.filter((item) => String(item.booking_date || "").slice(0, 10) === date).length;

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "month-cell";

    if (date < monthStart || date > monthEnd) cell.classList.add("is-other");
    if (date === bookingState.selectedDate) cell.classList.add("is-selected");

    cell.innerHTML = `
      <div class="month-day">${escapeHtml(String(parseDateLocal(date).getDate()))}</div>
      <div class="month-count">${count ? `${count}件` : "予約なし"}</div>
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

function buildBookingCard(item) {
  const card = document.createElement("article");
  card.className = `booking-card is-${escapeClass(item.status || "")}`;

  const riskScore = Number(item.risk_score ?? 0);
  const riskLabel =
    item.status === "risk" || riskScore >= 70
      ? `<span class="badge badge-risk">Risk ${escapeHtml(String(riskScore))}</span>`
      : "";

  card.innerHTML = `
    <div class="booking-top">
      <div class="booking-time">
        <div class="booking-time-main">${escapeHtml(formatTime(item.start_time || "--:--"))}</div>
        <div class="booking-time-sub">
          ${escapeHtml(String(item.booking_date || "-").slice(0, 10))}
          ${item.end_time ? ` / ${escapeHtml(formatTime(item.end_time))}` : ""}
        </div>
      </div>
      <div class="badges">
        <span class="badge badge-status-${escapeClass(item.status || "")}">
          ${escapeHtml(formatStatusLabel(item.status))}
        </span>
        ${riskLabel}
      </div>
    </div>

    <div class="booking-main">
      <div class="booking-block">
        <div class="booking-block-label">お客様</div>
        <div class="booking-name">${escapeHtml(item.customer_name || "-")}</div>
        <div class="booking-phone">📞 ${escapeHtml(item.customer_phone || "-")}</div>
      </div>

      <div class="booking-block">
        <div class="booking-block-label">予約内容</div>
        <div class="booking-meta-line">✂ ${escapeHtml(item.service_name || "-")}</div>
        <div class="booking-meta-line">👤 ${escapeHtml(item.staff_name || "-")}</div>
      </div>
    </div>

    <div class="booking-actions">
      ${buildBookingActionButtons(item)}
    </div>
  `;

  card.querySelectorAll("[data-booking-status]").forEach((btn) => {
    btn.addEventListener("click", () => updateBookingStatus(item.id, btn.dataset.bookingStatus));
  });

  return card;
}

function buildBookingActionButtons(item) {
  const status = String(item.status || "");
  const buttons = [];

  if (!["confirmed", "completed", "cancelled"].includes(status)) {
    buttons.push(`<button class="action-btn is-success" data-booking-status="confirmed">確認済み</button>`);
  }

  if (status !== "cancelled") {
    buttons.push(`<button class="action-btn is-danger" data-booking-status="cancelled">キャンセル</button>`);
  }

  if (!["completed", "cancelled"].includes(status)) {
    buttons.push(`<button class="action-btn is-dark" data-booking-status="completed">完了</button>`);
  }

  return buttons.join("");
}

async function updateBookingStatus(bookingId, nextStatus) {
  if (!currentSalonId || !bookingId || !nextStatus) return;

  setLoading(true, "更新中...", "予約ステータスを更新しています");

  try {
    const patch = { status: nextStatus };

    if (nextStatus === "cancelled") patch.cancelled_by = "admin";
    if (nextStatus === "confirmed") patch.confirmed_at = new Date().toISOString();

    const { error } = await sb
      .from("bookings")
      .update(patch)
      .eq("id", bookingId)
      .eq("salon_id", currentSalonId);

    if (error) throw error;

    toast("更新しました");
    await loadBookings(false);
  } catch (error) {
    console.error("updateBookingStatus error:", error);
    toast(error.message || "更新に失敗しました");
  } finally {
    setLoading(false);
  }
}

/* -------------------- STAFF -------------------- */

function renderStaff(list) {
  const mount = document.getElementById("staffList");
  if (!mount) return;

  mount.innerHTML = "";

  if (!list.length) {
    mount.innerHTML = `<div class="empty-state">スタッフがいません</div>`;
    return;
  }

  list.forEach((item) => {
    const card = document.createElement("div");
    card.className = "staff-card";

    const photo = getSafeStaffPhoto(item.photo_url);

    const serviceNames = (item.serviceIds || [])
      .map((id) => allServices.find((service) => String(service.id) === String(id))?.name)
      .filter(Boolean);

    const tagsHtml = serviceNames.length
      ? serviceNames.map((name) => `<span class="service-tag">${escapeHtml(name)}</span>`).join("")
      : `<span class="service-tag is-muted">サービス未設定</span>`;

    const scheduleText =
      item.start_time && item.end_time
        ? `${formatTime(item.start_time)} - ${formatTime(item.end_time)} / ${item.slot_minutes || 30}分`
        : "勤務時間未設定";

    card.innerHTML = `
      <div class="staff-left">
        <img src="${escapeAttr(photo)}" alt="${escapeAttr(item.name || "staff")}" />
        <div>
          <div class="staff-name">${escapeHtml(item.name || "-")}</div>
          <div class="staff-status">${item.is_active === false ? "⚪ Inactive" : "🟢 Active"} / ${escapeHtml(scheduleText)}</div>
          <div class="staff-service-tags">${tagsHtml}</div>
        </div>
      </div>

      <div class="staff-actions">
        <button type="button" data-action="edit">編集</button>
        <button type="button" data-action="delete">削除</button>
      </div>
    `;

    card.querySelector('[data-action="edit"]')?.addEventListener("click", () => openStaffModal(item));
    card.querySelector('[data-action="delete"]')?.addEventListener("click", () => deleteStaff(item.id));

    mount.appendChild(card);
  });
}

function openStaffModal(staff = null) {
  editingStaffId = staff?.id || null;

  setText("staffModalTitle", editingStaffId ? "スタッフ編集" : "スタッフ追加");
  setInputValue("staffNameInput", staff?.name || "");
  setInputValue("staffPhotoInput", getEditablePhotoValue(staff?.photo_url || ""));
  setInputValue("staffStartTimeInput", formatTime(staff?.start_time || "10:00"));
  setInputValue("staffEndTimeInput", formatTime(staff?.end_time || "19:00"));
  setInputValue("staffSlotMinutesInput", String(staff?.slot_minutes || 30));

  const activeInput = document.getElementById("staffActiveInput");
  if (activeInput) activeInput.checked = staff?.is_active !== false;

  document.getElementById("deleteStaffBtn")?.classList.toggle("hidden", !editingStaffId);

  renderServiceCheckboxes(staff?.serviceIds || []);
  document.getElementById("staffModal")?.classList.remove("hidden");
}

function closeStaffModal() {
  if (isSavingStaff) return;
  editingStaffId = null;
  document.getElementById("staffModal")?.classList.add("hidden");
}

function renderServiceCheckboxes(selectedIds = []) {
  const container = document.getElementById("servicesCheckboxes");
  if (!container) return;

  container.innerHTML = "";

  if (!allServices.length) {
    container.innerHTML = `<div class="muted">サービスがまだありません</div>`;
    return;
  }

  allServices.forEach((service) => {
    const label = document.createElement("label");
    label.className = "checkbox-item";

    const checked = selectedIds.map(String).includes(String(service.id));

    label.innerHTML = `
      <input type="checkbox" value="${escapeAttr(service.id)}" ${checked ? "checked" : ""} />
      <span>${escapeHtml(service.name || "-")}</span>
    `;

    container.appendChild(label);
  });
}

async function saveStaff() {
  if (isSavingStaff || !currentSalonId) return;

  const name = document.getElementById("staffNameInput")?.value.trim();
  const photoUrl = normalizePhotoUrl(document.getElementById("staffPhotoInput")?.value.trim());
  const startTime = normalizeTimeInput(document.getElementById("staffStartTimeInput")?.value || "10:00");
  const endTime = normalizeTimeInput(document.getElementById("staffEndTimeInput")?.value || "19:00");
  const slotMinutes = Number(document.getElementById("staffSlotMinutesInput")?.value || 30);
  const isActive = document.getElementById("staffActiveInput")?.checked ?? true;

  const serviceIds = Array.from(
    document.querySelectorAll("#servicesCheckboxes input[type='checkbox']:checked")
  ).map((input) => input.value);

  if (!name) {
    toast("スタッフ名を入力してください");
    return;
  }

  if (!startTime || !endTime || timeToMinutes(startTime) >= timeToMinutes(endTime)) {
    toast("勤務時間を確認してください");
    return;
  }

  if (!Number.isFinite(slotMinutes) || slotMinutes < 5) {
    toast("予約間隔を確認してください");
    return;
  }

  isSavingStaff = true;
  setButtonLoading("saveStaffBtn", true, "保存中...");
  setLoading(true, "保存中...", "スタッフ情報を保存しています");

  try {
    let staffId = editingStaffId;

    const payload = {
      name,
      photo_url: photoUrl,
      is_active: isActive,
      slot_minutes: slotMinutes,
      start_time: startTime,
      end_time: endTime,
    };

    if (!staffId) {
      const { data, error } = await sb
        .from("staff")
        .insert({
          salon_id: currentSalonId,
          code: makeCode(name, "staff"),
          ...payload,
        })
        .select("id")
        .single();

      if (error) throw error;
      staffId = data.id;
    } else {
      const { error } = await sb
        .from("staff")
        .update(payload)
        .eq("id", staffId)
        .eq("salon_id", currentSalonId);

      if (error) throw error;
    }

    await replaceStaffServiceLinks(staffId, serviceIds);

    toast("保存しました");
    closeStaffModal();
    await loadStaff();
  } catch (error) {
    console.error("saveStaff error:", error);
    toast(error.message || "保存に失敗しました");
  } finally {
    isSavingStaff = false;
    setButtonLoading("saveStaffBtn", false, "保存");
    setLoading(false);
  }
}

async function replaceStaffServiceLinks(staffId, serviceIds) {
  const { error: deleteError } = await sb
    .from("staff_service_map")
    .delete()
    .eq("salon_id", currentSalonId)
    .eq("staff_id", staffId);

  if (deleteError) throw deleteError;

  if (!serviceIds.length) return;

  const rows = serviceIds.map((serviceId) => ({
    salon_id: currentSalonId,
    staff_id: staffId,
    service_id: serviceId,
  }));

  const { error: insertError } = await sb.from("staff_service_map").insert(rows);
  if (insertError) throw insertError;
}

async function deleteEditingStaff() {
  if (!editingStaffId) return;
  await deleteStaff(editingStaffId);
  closeStaffModal();
}

async function deleteStaff(staffId) {
  if (!staffId || !currentSalonId) return;
  if (!confirm("このスタッフを削除しますか？")) return;

  setLoading(true, "削除中...", "スタッフを削除しています");

  try {
    await sb.from("staff_service_map").delete().eq("salon_id", currentSalonId).eq("staff_id", staffId);

    const { error } = await sb.from("staff").delete().eq("id", staffId).eq("salon_id", currentSalonId);
    if (error) throw error;

    toast("削除しました");
    await loadStaff();
  } catch (error) {
    console.error("deleteStaff error:", error);
    toast(error.message || "削除に失敗しました");
  } finally {
    setLoading(false);
  }
}

/* -------------------- SERVICES -------------------- */

function renderServices(list) {
  const mount = document.getElementById("servicesList");
  if (!mount) return;

  mount.innerHTML = "";

  if (!list.length) {
    mount.innerHTML = `<div class="empty-state">サービスがありません</div>`;
    return;
  }

  list.forEach((service) => {
    const card = document.createElement("div");
    card.className = "service-card";

    card.innerHTML = `
      <div>
        <div class="service-name">${escapeHtml(service.name || "-")}</div>
        <div class="service-meta">
          ${service.is_active === false ? "⚪ Inactive" : "🟢 Active"}
          / ${escapeHtml(String(service.duration_minutes || 0))}分
          / ¥${formatNumber(service.price_jpy || 0)}
          ${service.category ? ` / ${escapeHtml(service.category)}` : ""}
        </div>
        ${service.description ? `<div class="service-description">${escapeHtml(service.description)}</div>` : ""}
      </div>

      <div class="staff-actions">
        <button type="button" data-action="edit">編集</button>
        <button type="button" data-action="delete">削除</button>
      </div>
    `;

    card.querySelector('[data-action="edit"]')?.addEventListener("click", () => openServiceModal(service));
    card.querySelector('[data-action="delete"]')?.addEventListener("click", () => deleteService(service.id));

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
  setInputValue("serviceSortInput", String(service?.sort_order || getNextServiceSortOrder()));
  setInputValue("serviceDescriptionInput", service?.description || "");

  const activeInput = document.getElementById("serviceActiveInput");
  if (activeInput) activeInput.checked = service?.is_active !== false;

  document.getElementById("deleteServiceBtn")?.classList.toggle("hidden", !editingServiceId);
  document.getElementById("serviceModal")?.classList.remove("hidden");
}

function closeServiceModal() {
  if (isSavingService) return;
  editingServiceId = null;
  document.getElementById("serviceModal")?.classList.add("hidden");
}

async function saveService() {
  if (isSavingService || !currentSalonId) return;

  const name = document.getElementById("serviceNameInput")?.value.trim();
  const codeRaw = document.getElementById("serviceCodeInput")?.value.trim();
  const category = document.getElementById("serviceCategoryInput")?.value.trim();
  const durationMinutes = Number(document.getElementById("serviceDurationInput")?.value || 60);
  const priceJpy = Number(document.getElementById("servicePriceInput")?.value || 0);
  const sortOrder = Number(document.getElementById("serviceSortInput")?.value || getNextServiceSortOrder());
  const description = document.getElementById("serviceDescriptionInput")?.value.trim();
  const isActive = document.getElementById("serviceActiveInput")?.checked ?? true;

  if (!name) {
    toast("サービス名を入力してください");
    return;
  }

  if (!Number.isFinite(durationMinutes) || durationMinutes < 5) {
    toast("施術時間を確認してください");
    return;
  }

  if (!Number.isFinite(priceJpy) || priceJpy < 0) {
    toast("価格を確認してください");
    return;
  }

  isSavingService = true;
  setButtonLoading("saveServiceBtn", true, "保存中...");
  setLoading(true, "保存中...", "サービス情報を保存しています");

  try {
    const payload = {
      name,
      code: codeRaw || makeCode(name, "service"),
      category: category || null,
      duration_minutes: durationMinutes,
      price_jpy: priceJpy,
      sort_order: Number.isFinite(sortOrder) ? sortOrder : getNextServiceSortOrder(),
      description: description || null,
      is_active: isActive,
    };

    if (!editingServiceId) {
      const { error } = await sb.from("services").insert({
        salon_id: currentSalonId,
        ...payload,
      });

      if (error) throw error;
    } else {
      const { error } = await sb
        .from("services")
        .update(payload)
        .eq("id", editingServiceId)
        .eq("salon_id", currentSalonId);

      if (error) throw error;
    }

    toast("保存しました");
    closeServiceModal();
    await loadServices();
    await loadStaff();
  } catch (error) {
    console.error("saveService error:", error);
    toast(error.message || "保存に失敗しました");
  } finally {
    isSavingService = false;
    setButtonLoading("saveServiceBtn", false, "保存");
    setLoading(false);
  }
}

async function deleteEditingService() {
  if (!editingServiceId) return;
  await deleteService(editingServiceId);
  closeServiceModal();
}

async function deleteService(serviceId) {
  if (!serviceId || !currentSalonId) return;
  if (!confirm("このサービスを削除しますか？スタッフとの紐付けも削除されます。")) return;

  setLoading(true, "削除中...", "サービスを削除しています");

  try {
    await sb.from("staff_service_map").delete().eq("salon_id", currentSalonId).eq("service_id", serviceId);

    const { error } = await sb.from("services").delete().eq("id", serviceId).eq("salon_id", currentSalonId);
    if (error) throw error;

    toast("削除しました");
    await loadServices();
    await loadStaff();
  } catch (error) {
    console.error("deleteService error:", error);
    toast(error.message || "削除に失敗しました");
  } finally {
    setLoading(false);
  }
}

/* -------------------- REALTIME / REFRESH -------------------- */

function subscribeRealtime() {
  if (!currentSalonId || realtimeChannel) return;

  realtimeChannel = sb
    .channel(`admin-bookings-${currentSalonId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "bookings", filter: `salon_id=eq.${currentSalonId}` },
      () => loadBookings(false)
    )
    .subscribe();
}

function unsubscribeRealtime() {
  if (!realtimeChannel) return;
  sb.removeChannel(realtimeChannel);
  realtimeChannel = null;
}

function startRefresh() {
  stopRefresh();
  refreshTimer = window.setInterval(() => {
    if (document.hidden || !currentSalonId) return;
    loadBookings(false);
  }, 60000);
}

function stopRefresh() {
  if (refreshTimer) window.clearInterval(refreshTimer);
  refreshTimer = null;
}

/* -------------------- FILTERS / METRICS -------------------- */

function hydrateStaffFilter() {
  const select = document.getElementById("staffFilter");
  if (!select) return;

  const currentValue = bookingState.staffFilter;
  select.innerHTML = `<option value="">全担当者</option>`;

  allStaff
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "ja"))
    .forEach((staff) => {
      const option = document.createElement("option");
      option.value = staff.id;
      option.textContent = staff.name || "担当者";
      select.appendChild(option);
    });

  if (allStaff.some((staff) => String(staff.id) === String(currentValue))) {
    select.value = currentValue;
  } else {
    bookingState.staffFilter = "";
    select.value = "";
  }
}

function updateMetrics(items) {
  setText("metricCount", String(items.length));
  setText("metricPending", String(items.filter((x) => x.status === "pending").length));
  setText("metricRisk", String(items.filter((x) => x.status === "risk").length));
  setText("metricCancelled", String(items.filter((x) => x.status === "cancelled").length));
}

/* -------------------- DATE HELPERS -------------------- */

function setInitialDate() {
  bookingState.selectedDate = getTodayString();
  syncSelectedDateInput();
  renderRangeLabel();
}

function syncViewButtons() {
  document.querySelectorAll(".view-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === bookingState.view);
  });
}

function syncSelectedDateInput() {
  const input = document.getElementById("selectedDate");
  if (input) input.value = bookingState.selectedDate;
}

function renderRangeLabel() {
  const el = document.getElementById("rangeLabel");
  if (!el) return;

  const selected = bookingState.selectedDate || getTodayString();

  if (bookingState.view === "today") {
    el.textContent = `今日 / ${formatDateLabel(getTodayString(), true)}`;
    return;
  }

  if (bookingState.view === "day") {
    el.textContent = formatDateLabel(selected, true);
    return;
  }

  if (bookingState.view === "week") {
    const start = getWeekStart(selected);
    const end = addDays(start, 6);
    el.textContent = `${formatShortDate(start)} - ${formatShortDate(end)}`;
    return;
  }

  el.textContent = formatMonthLabel(selected);
}

function getCurrentRange() {
  const selected = bookingState.selectedDate || getTodayString();

  if (bookingState.view === "today") {
    const today = getTodayString();
    return { start: today, end: today };
  }

  if (bookingState.view === "day") return { start: selected, end: selected };

  if (bookingState.view === "week") {
    const start = getWeekStart(selected);
    return { start, end: addDays(start, 6) };
  }

  return {
    start: firstDayOfMonth(selected),
    end: lastDayOfMonth(selected),
  };
}

function shiftRange(direction) {
  const selected = bookingState.selectedDate || getTodayString();

  if (bookingState.view === "today") {
    bookingState.view = "day";
    bookingState.selectedDate = addDays(getTodayString(), direction);
  } else if (bookingState.view === "day") {
    bookingState.selectedDate = addDays(selected, direction);
  } else if (bookingState.view === "week") {
    bookingState.selectedDate = addDays(selected, direction * 7);
  } else {
    bookingState.selectedDate = addMonths(selected, direction);
  }

  renderBookings();
}

function getTodayString() {
  return toDateString(new Date());
}

function parseDateLocal(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function toDateString(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(dateStr, amount) {
  const d = parseDateLocal(dateStr);
  d.setDate(d.getDate() + amount);
  return toDateString(d);
}

function addMonths(dateStr, amount) {
  const d = parseDateLocal(dateStr);
  d.setMonth(d.getMonth() + amount);
  return toDateString(d);
}

function getWeekStart(dateStr) {
  const d = parseDateLocal(dateStr);
  d.setDate(d.getDate() - d.getDay());
  return toDateString(d);
}

function firstDayOfMonth(dateStr) {
  const d = parseDateLocal(dateStr);
  d.setDate(1);
  return toDateString(d);
}

function lastDayOfMonth(dateStr) {
  const d = parseDateLocal(dateStr);
  d.setMonth(d.getMonth() + 1, 0);
  return toDateString(d);
}

function formatDateLabel(dateStr, withWeekday = false) {
  const d = parseDateLocal(dateStr);
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const base = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return withWeekday ? `${base}（${weekdays[d.getDay()]}）` : base;
}

function formatShortDate(dateStr) {
  const d = parseDateLocal(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatMonthLabel(dateStr) {
  const d = parseDateLocal(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

/* -------------------- COMMON HELPERS -------------------- */

function setLoading(on, title = "読み込み中...", text = "少々お待ちください") {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;

  const titleEl = overlay.querySelector(".loading-title");
  const textEl = overlay.querySelector(".loading-text");

  if (titleEl) titleEl.textContent = title;
  if (textEl) textEl.textContent = text;

  overlay.classList.toggle("active", !!on);
}

function toast(text) {
  const old = document.querySelector(".toast");
  if (old) old.remove();

  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.appendChild(el);

  window.setTimeout(() => el.remove(), 2600);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function setButtonLoading(id, isLoading, defaultText) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = isLoading;
  btn.textContent = isLoading ? "保存中..." : defaultText;
}

function formatStatusLabel(status) {
  switch (String(status || "")) {
    case "pending": return "未確認";
    case "confirmed": return "確認済み";
    case "risk": return "要確認";
    case "cancelled": return "キャンセル";
    case "completed": return "完了";
    default: return status || "-";
  }
}

function formatTime(value) {
  return String(value || "").slice(0, 5);
}

function normalizeTimeInput(value) {
  return String(value || "").trim().slice(0, 5);
}

function timeToMinutes(value) {
  const [h, m] = String(value || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function normalizePhotoUrl(value) {
  const str = String(value || "").trim();
  if (!str) return null;
  if (str.startsWith("http://") || str.startsWith("https://")) return str;
  return null;
}

function getSafeStaffPhoto(value) {
  const str = String(value || "").trim();
  if (str.startsWith("http://") || str.startsWith("https://")) return str;
  return "https://via.placeholder.com/120x120.png?text=Staff";
}

function getEditablePhotoValue(value) {
  const str = String(value || "").trim();
  if (str.startsWith("http://") || str.startsWith("https://")) return str;
  return "";
}

function makeCode(name, prefix) {
  const base = String(name || prefix)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${base || prefix}-${Date.now().toString(36)}`;
}

function getNextServiceSortOrder() {
  const max = allServices.reduce((acc, service) => {
    const n = Number(service.sort_order || 0);
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);

  return max + 1;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ja-JP").format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function escapeClass(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}