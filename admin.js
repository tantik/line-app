const sb = window.supabaseClient;
const STORAGE_BUCKET = "salon-assets";

let currentSalonId = null;
let currentUser = null;
let realtimeChannel = null;
let refreshTimer = null;

let allBookings = [];
let allStaff = [];
let allServices = [];

let editingStaffId = null;
let editingServiceId = null;
let currentTab = "bookings";
let isLoadingInitialData = false;

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
    const { data, error } = await sb.auth.getSession();

    if (error) {
      console.error("getSession error:", error);
      showToast("Ошибка входа");
      hideLoading();
      return;
    }

    await applySession(data?.session || null);

    sb.auth.onAuthStateChange(async (_event, session) => {
      await applySession(session);
    });
  } catch (error) {
    console.error("initAdmin error:", error);
    showToast("管理画面の初期化に失敗しました");
    hideLoading();
  }
}

/* =========================
   AUTH
========================= */

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

  if (error) throw error;
  if (!data) throw new Error("salon_members not found");

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

    if (error) throw error;
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
    await sb.auth.signOut();
    window.location.reload();
  } catch (error) {
    console.error("signOut error:", error);
    showToast("ログアウトに失敗しました");
  }
}

/* =========================
   LOAD
========================= */

async function loadAll() {
  if (!currentSalonId) return;

  await loadServices();
  await loadStaff();
  await loadBookings();
  setText("lastUpdated", `最終更新: ${new Date().toLocaleString("ja-JP")}`);
}

async function loadBookings() {
  if (!currentSalonId) return;

  try {
    const { data, error } = await sb
      .from("admin_booking_view")
      .select("*")
      .eq("salon_id", currentSalonId)
      .order("booking_date", { ascending: true })
      .order("start_time", { ascending: true });

    if (error) throw error;

    allBookings = data || [];
    renderBookings();
    setText("lastUpdated", `最終更新: ${new Date().toLocaleString("ja-JP")}`);
  } catch (error) {
    console.error("loadBookings error:", error);
    showToast("予約取得エラー");
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

    allServices = data || [];
    renderServices();
  } catch (error) {
    console.error("loadServices error:", error);
    showToast("サービス取得エラー");
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

    const staffList = staffRows || [];
    const staffIds = staffList.map((staff) => staff.id);
    let mapRows = [];

    if (staffIds.length > 0) {
      const { data, error } = await sb
        .from("staff_service_map")
        .select("staff_id, service_id")
        .eq("salon_id", currentSalonId)
        .in("staff_id", staffIds);

      if (error) throw error;
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

/* =========================
   BOOKINGS
========================= */

function renderBookings() {
  const mount = document.getElementById("bookingsMount");
  const empty = document.getElementById("emptyState");

  if (!mount) return;

  syncSelectedDateInput();
  syncViewButtons();
  renderRangeLabel();

  const items = getFilteredBookings();
  updateMetrics(items);

  mount.innerHTML = "";
  if (empty) empty.classList.toggle("hidden", items.length > 0);

  if (!items.length) {
    mount.innerHTML = `<div class="empty-state">予約はまだありません</div>`;
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
      const date = String(item.booking_date || "").slice(0, 10);
      return date >= start && date <= end;
    })
    .filter((item) => {
      if (!bookingState.statusFilter) return true;
      return String(item.status || "") === bookingState.statusFilter;
    })
    .filter((item) => {
      if (!bookingState.staffFilter) return true;
      return String(item.staff_id || "") === String(bookingState.staffFilter);
    })
    .filter((item) => {
      if (!search) return true;
      const text = [item.customer_name, item.customer_phone, item.service_name, item.staff_name]
        .join(" ")
        .toLowerCase();
      return text.includes(search);
    })
    .sort((a, b) => {
      const dateCompare = String(a.booking_date || "").localeCompare(String(b.booking_date || ""));
      if (dateCompare !== 0) return dateCompare;
      return String(a.start_time || "").localeCompare(String(b.start_time || ""));
    });
}

function renderDayView(items, mount) {
  const wrap = document.createElement("div");
  wrap.className = "day-list";
  items.forEach((booking) => wrap.appendChild(buildBookingCard(booking)));
  mount.appendChild(wrap);
}

function renderWeekView(items, mount) {
  const groups = new Map();

  items.forEach((booking) => {
    const date = String(booking.booking_date || "").slice(0, 10);
    if (!groups.has(date)) groups.set(date, []);
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
    dayItems.forEach((booking) => body.appendChild(buildBookingCard(booking)));

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
    if (date < monthStart || date > monthEnd) cell.classList.add("is-other");
    if (date === selected) cell.classList.add("is-selected");

    cell.innerHTML = `
      <div class="month-day">${safe(String(parseDateLocal(date).getDate()))}</div>
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

function buildBookingCard(booking) {
  const card = document.createElement("article");
  card.className = "booking-card";

  card.innerHTML = `
    <div class="booking-top">
      <div>
        <div class="booking-time-main">${safe(formatTime(booking.start_time))}</div>
        <div class="booking-time-sub">
          ${safe(String(booking.booking_date || "").slice(0, 10))}
          ${booking.end_time ? ` / ${safe(formatTime(booking.end_time))}` : ""}
        </div>
      </div>

      <div class="badges">
        <span class="badge badge-status-${safeClass(booking.status || "pending")}">
          ${safe(statusLabel(booking.status))}
        </span>
      </div>
    </div>

    <div class="booking-main">
      <div class="booking-block">
        <div class="booking-block-label">お客様</div>
        <div class="booking-name">${safe(booking.customer_name || "-")}</div>
        <div class="booking-phone">${safe(booking.customer_phone || "-")}</div>
      </div>

      <div class="booking-block">
        <div class="booking-block-label">予約内容</div>
        <div class="booking-meta-line">✂ ${safe(booking.service_name || "-")}</div>
        <div class="booking-meta-line">👤 ${safe(booking.staff_name || "-")}</div>
      </div>
    </div>

    <div class="booking-actions">
      ${buildBookingActions(booking)}
    </div>
  `;

  card.querySelectorAll("[data-booking-status]").forEach((button) => {
    button.addEventListener("click", () => updateBookingStatus(booking.id, button.dataset.bookingStatus));
  });

  return card;
}

function buildBookingActions(booking) {
  const status = String(booking.status || "pending");
  const buttons = [];

  if (!["confirmed", "completed", "cancelled"].includes(status)) {
    buttons.push(`<button class="action-btn is-success" type="button" data-booking-status="confirmed">確認済み</button>`);
  }

  if (status !== "cancelled") {
    buttons.push(`<button class="action-btn is-danger" type="button" data-booking-status="cancelled">キャンセル</button>`);
  }

  if (!["completed", "cancelled"].includes(status)) {
    buttons.push(`<button class="action-btn is-dark" type="button" data-booking-status="completed">完了</button>`);
  }

  return buttons.join("");
}

async function updateBookingStatus(bookingId, nextStatus) {
  if (!currentSalonId || !bookingId || !nextStatus) return;

  showLoading("更新中...", "予約ステータスを更新しています");

  try {
    const patch = { status: nextStatus };
    if (nextStatus === "confirmed") patch.confirmed_at = new Date().toISOString();
    if (nextStatus === "cancelled") patch.cancelled_by = "admin";

    const { error } = await sb
      .from("bookings")
      .update(patch)
      .eq("salon_id", currentSalonId)
      .eq("id", bookingId);

    if (error) throw error;
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

/* =========================
   STAFF
========================= */

function renderStaff() {
  const mount = document.getElementById("staffList");
  if (!mount) return;

  mount.innerHTML = "";

  if (!allStaff.length) {
    mount.innerHTML = `<div class="empty-state">スタッフがいません</div>`;
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
      ? serviceNames.map((name) => `<span class="service-tag">${safe(name)}</span>`).join("")
      : `<span class="service-tag is-muted">サービス未設定</span>`;

    card.innerHTML = `
      <div class="staff-left">
        ${
          photoUrl
            ? `<img class="staff-photo" src="${safeAttr(photoUrl)}" alt="${safeAttr(staff.name || "staff")}" loading="lazy">`
            : `<div class="staff-photo-placeholder">${safe(firstLetter)}</div>`
        }

        <div>
          <div class="staff-name">${safe(staff.name || "-")}</div>
          <div class="staff-status">
            ${staff.is_active === false ? "⚪ Inactive" : "🟢 Active"}
            / ${safe(formatTime(staff.start_time))} - ${safe(formatTime(staff.end_time))}
            / ${safe(staff.slot_minutes || 30)}分
          </div>
          <div class="staff-service-tags">${serviceTags}</div>
        </div>
      </div>

      <div class="staff-actions">
        <button type="button" data-edit-staff="${safeAttr(staff.id)}">編集</button>
        <button type="button" data-delete-staff="${safeAttr(staff.id)}">削除</button>
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
  setText("staffPhotoCurrent", getSafePhotoUrl(staff?.photo_url) ? "現在の写真: 登録済み" : "現在の写真: なし");

  const activeInput = document.getElementById("staffActiveInput");
  if (activeInput) activeInput.checked = staff?.is_active !== false;

  renderServiceCheckboxes(staff?.serviceIds || []);
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
  if (!container) return;

  container.innerHTML = "";

  if (!allServices.length) {
    container.innerHTML = `<div class="muted">サービスがまだありません</div>`;
    return;
  }

  allServices.forEach((service) => {
    const checked = selectedIds.map(String).includes(String(service.id));
    const label = document.createElement("label");
    label.className = "checkbox-item";
    label.innerHTML = `
      <input type="checkbox" value="${safeAttr(service.id)}" ${checked ? "checked" : ""}>
      <span>${safe(service.name || "-")}</span>
    `;
    container.appendChild(label);
  });
}

async function saveStaff() {
  if (!currentSalonId) return;

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
      if (!uploadedUrl) throw new Error("photo_upload_failed");
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
    };

    if (staffId) {
      const { error } = await sb
        .from("staff")
        .update(payload)
        .eq("salon_id", currentSalonId)
        .eq("id", staffId);

      if (error) throw error;
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

      if (error) throw error;
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
  if (!file || !currentSalonId) return null;

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
  const path = `${currentSalonId}/staff/${fileName}`;

  const { error } = await sb.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type,
    });

  if (error) {
    console.error("uploadStaffPhoto error:", error);
    showToast(error.message || "画像アップロードに失敗しました");
    return null;
  }

  const { data } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data?.publicUrl || null;
}

async function replaceStaffServices(staffId, serviceIds) {
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

async function deleteStaff(id = editingStaffId) {
  if (!id || !currentSalonId) return;
  if (!confirm("このスタッフを削除しますか？")) return;

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

    if (error) throw error;

    closeStaffModal();
    await loadStaff();
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
  if (!select) return;

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

/* =========================
   SERVICES
========================= */

function renderServices() {
  const mount = document.getElementById("servicesList");
  if (!mount) return;

  mount.innerHTML = "";

  if (!allServices.length) {
    mount.innerHTML = `<div class="empty-state">サービスがありません</div>`;
    return;
  }

  allServices.forEach((service) => {
    const card = document.createElement("div");
    card.className = "service-card";

    card.innerHTML = `
      <div>
        <div class="service-name">${safe(service.name || "-")}</div>
        <div class="service-meta">
          ${service.is_active === false ? "⚪ Inactive" : "🟢 Active"}
          / ${safe(service.duration_minutes || 0)}分
          / ¥${Number(service.price_jpy || 0).toLocaleString("ja-JP")}
          ${service.category ? ` / ${safe(service.category)}` : ""}
        </div>
        <div class="service-tags">
          <span class="service-tag">code: ${safe(service.code || "-")}</span>
          <span class="service-tag">sort: ${safe(service.sort_order ?? 100)}</span>
        </div>
        ${service.description ? `<div class="service-description">${safe(service.description)}</div>` : ""}
      </div>

      <div class="service-actions">
        <button type="button" data-edit-service="${safeAttr(service.id)}">編集</button>
        <button type="button" data-delete-service="${safeAttr(service.id)}">削除</button>
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

  const activeInput = document.getElementById("serviceActiveInput");
  if (activeInput) activeInput.checked = service?.is_active !== false;

  document.getElementById("deleteServiceBtn")?.classList.toggle("hidden", !editingServiceId);
  document.getElementById("serviceModal")?.classList.remove("hidden");
}

function closeServiceModal() {
  editingServiceId = null;
  document.getElementById("serviceModal")?.classList.add("hidden");
}

async function saveService() {
  if (!currentSalonId) return;

  const name = document.getElementById("serviceNameInput")?.value.trim();
  const code = makeCode(document.getElementById("serviceCodeInput")?.value.trim() || name);
  const category = document.getElementById("serviceCategoryInput")?.value.trim() || null;
  const durationMinutes = Number(document.getElementById("serviceDurationInput")?.value || 60);
  const priceJpy = Number(document.getElementById("servicePriceInput")?.value || 0);
  const sortOrder = Number(document.getElementById("serviceSortInput")?.value || 100);
  const description = document.getElementById("serviceDescriptionInput")?.value.trim() || null;
  const isActive = document.getElementById("serviceActiveInput")?.checked ?? true;

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
    const payload = {
      salon_id: currentSalonId,
      name,
      code,
      category,
      duration_minutes: durationMinutes,
      price_jpy: priceJpy,
      sort_order: Number.isFinite(sortOrder) ? sortOrder : 100,
      description,
      is_active: isActive,
    };

    if (editingServiceId) {
      const { error } = await sb
        .from("services")
        .update(payload)
        .eq("salon_id", currentSalonId)
        .eq("id", editingServiceId);

      if (error) throw error;
    } else {
      const { error } = await sb.from("services").insert(payload);
      if (error) throw error;
    }

    closeServiceModal();
    await loadServices();
    await loadStaff();
    showToast("サービスを保存しました");
  } catch (error) {
    console.error("saveService error:", error);
    showToast("サービス保存に失敗しました");
  } finally {
    hideLoading();
  }
}

async function deleteService(id = editingServiceId) {
  if (!id || !currentSalonId) return;
  if (!confirm("このサービスを削除しますか？")) return;

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

    if (error) throw error;

    closeServiceModal();
    await loadServices();
    await loadStaff();
    showToast("サービスを削除しました");
  } catch (error) {
    console.error("deleteService error:", error);
    showToast("サービス削除に失敗しました");
  } finally {
    hideLoading();
  }
}

/* =========================
   REALTIME / POLLING
========================= */

function subscribeRealtime() {
  unsubscribeRealtime();

  if (!currentSalonId || !sb.channel) return;

  realtimeChannel = sb
    .channel(`admin-bookings-${currentSalonId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "bookings",
        filter: `salon_id=eq.${currentSalonId}`,
      },
      () => {
        if (!isLoadingInitialData) loadBookings();
      }
    )
    .subscribe();
}

function unsubscribeRealtime() {
  if (!realtimeChannel) return;

  try {
    sb.removeChannel(realtimeChannel);
  } catch (error) {
    console.error("unsubscribeRealtime error:", error);
  }

  realtimeChannel = null;
}

function startRefresh() {
  stopRefresh();

  refreshTimer = window.setInterval(() => {
    if (!currentSalonId || document.hidden || isLoadingInitialData) return;
    loadBookings();
  }, 60000);
}

function stopRefresh() {
  if (!refreshTimer) return;
  window.clearInterval(refreshTimer);
  refreshTimer = null;
}

/* =========================
   UI
========================= */

function bindUI() {
  document.getElementById("refreshBtn")?.addEventListener("click", async () => {
    showLoading("更新中...", "データを更新しています");
    try {
      await loadAll();
    } finally {
      hideLoading();
    }
  });

  document.getElementById("signOutBtn")?.addEventListener("click", signOut);
  document.getElementById("sendMagicLinkBtn")?.addEventListener("click", sendMagicLink);

  document.getElementById("addStaffBtn")?.addEventListener("click", () => openStaffModal());
  document.getElementById("saveStaffBtn")?.addEventListener("click", saveStaff);
  document.getElementById("deleteStaffBtn")?.addEventListener("click", () => deleteStaff(editingStaffId));
  document.getElementById("closeStaffModalBtn")?.addEventListener("click", closeStaffModal);
  document.getElementById("cancelStaffModalBtn")?.addEventListener("click", closeStaffModal);

  document.getElementById("addServiceBtn")?.addEventListener("click", () => openServiceModal());
  document.getElementById("saveServiceBtn")?.addEventListener("click", saveService);
  document.getElementById("deleteServiceBtn")?.addEventListener("click", () => deleteService(editingServiceId));
  document.getElementById("closeServiceModalBtn")?.addEventListener("click", closeServiceModal);
  document.getElementById("cancelServiceModalBtn")?.addEventListener("click", closeServiceModal);

  document.getElementById("staffModal")?.addEventListener("click", (event) => {
    if (event.target.id === "staffModal") closeStaffModal();
  });

  document.getElementById("serviceModal")?.addEventListener("click", (event) => {
    if (event.target.id === "serviceModal") closeServiceModal();
  });

  document.querySelectorAll(".tab-btn").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  document.querySelectorAll(".view-btn").forEach((button) => {
    button.addEventListener("click", () => {
      bookingState.view = button.dataset.view || "today";
      if (bookingState.view === "today") bookingState.selectedDate = getTodayString();
      renderBookings();
    });
  });

  document.getElementById("selectedDate")?.addEventListener("change", (event) => {
    bookingState.selectedDate = event.target.value || getTodayString();
    if (bookingState.view === "today" && bookingState.selectedDate !== getTodayString()) {
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

  document.getElementById("searchText")?.addEventListener("input", (event) => {
    bookingState.searchText = event.target.value || "";
    renderBookings();
  });

  document.getElementById("prevRangeBtn")?.addEventListener("click", () => shiftRange(-1));
  document.getElementById("nextRangeBtn")?.addEventListener("click", () => shiftRange(1));
  document.getElementById("jumpTodayBtn")?.addEventListener("click", () => {
    bookingState.selectedDate = getTodayString();
    bookingState.view = "today";
    renderBookings();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeStaffModal();
      closeServiceModal();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && currentSalonId) loadBookings();
  });
}

function switchTab(tab = "bookings") {
  currentTab = tab;

  document.querySelectorAll(".tab-btn").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === currentTab);
  });

  document.getElementById("bookingsSection")?.classList.toggle("hidden", currentTab !== "bookings");
  document.getElementById("staffSection")?.classList.toggle("hidden", currentTab !== "staff");
  document.getElementById("servicesSection")?.classList.toggle("hidden", currentTab !== "services");

  const titleMap = {
    bookings: "Bookings",
    staff: "Staff",
    services: "Services",
  };

  setText("pageTitle", titleMap[currentTab] || "Bookings");
}

/* =========================
   DATE HELPERS
========================= */

function getCurrentRange() {
  const selected = bookingState.selectedDate || getTodayString();

  if (bookingState.view === "today") {
    const today = getTodayString();
    return { start: today, end: today };
  }

  if (bookingState.view === "week") {
    const start = startOfWeek(selected);
    return { start, end: addDays(start, 6) };
  }

  if (bookingState.view === "month") {
    return { start: firstDayOfMonth(selected), end: lastDayOfMonth(selected) };
  }

  return { start: selected, end: selected };
}

function shiftRange(direction) {
  const selected = bookingState.selectedDate || getTodayString();

  if (bookingState.view === "month") {
    bookingState.selectedDate = addMonths(selected, direction);
  } else if (bookingState.view === "week") {
    bookingState.selectedDate = addDays(selected, direction * 7);
  } else {
    bookingState.selectedDate = addDays(selected, direction);
    if (bookingState.view === "today") bookingState.view = "day";
  }

  renderBookings();
}

function renderRangeLabel() {
  const { start, end } = getCurrentRange();
  const label = start === end
    ? formatDateLabel(start, true)
    : `${formatDateLabel(start, false)} - ${formatDateLabel(end, true)}`;
  setText("rangeLabel", label);
}

function syncSelectedDateInput() {
  const input = document.getElementById("selectedDate");
  if (input) input.value = bookingState.selectedDate || getTodayString();
}

function syncViewButtons() {
  document.querySelectorAll(".view-btn").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === bookingState.view);
  });
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

function parseDateLocal(dateString) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function addDays(dateString, days) {
  const date = parseDateLocal(dateString);
  date.setDate(date.getDate() + days);
  return toDateStringLocal(date);
}

function addMonths(dateString, months) {
  const date = parseDateLocal(dateString);
  date.setMonth(date.getMonth() + months);
  return toDateStringLocal(date);
}

function startOfWeek(dateString) {
  const date = parseDateLocal(dateString);
  date.setDate(date.getDate() - date.getDay());
  return toDateStringLocal(date);
}

function firstDayOfMonth(dateString) {
  const date = parseDateLocal(dateString);
  return toDateStringLocal(new Date(date.getFullYear(), date.getMonth(), 1));
}

function lastDayOfMonth(dateString) {
  const date = parseDateLocal(dateString);
  return toDateStringLocal(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

function formatDateLabel(dateString, withWeekday = false) {
  if (!dateString) return "-";
  const date = parseDateLocal(dateString);
  const options = withWeekday
    ? { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }
    : { year: "numeric", month: "2-digit", day: "2-digit" };
  return date.toLocaleDateString("ja-JP", options);
}

/* =========================
   HELPERS
========================= */

function showLoading(title = "読み込み中...", text = "しばらくお待ちください") {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;
  overlay.classList.add("active");
  setText("loadingTitle", title);
  setText("loadingText", text);
}

function hideLoading() {
  document.getElementById("loadingOverlay")?.classList.remove("active");
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setInputValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value;
}

function clearFileInput(id) {
  const element = document.getElementById(id);
  if (element) element.value = "";
}

function showToast(message) {
  const toast = document.getElementById("toast");

  if (!toast) {
    alert(message);
    return;
  }

  toast.textContent = message;
  toast.classList.remove("hidden");

  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.add("hidden");
  }, 3000);
}

function formatTime(value) {
  if (!value) return "--:--";
  return String(value).slice(0, 5);
}

function normalizeTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function timeToMinutes(value) {
  const normalized = normalizeTime(value);
  if (!normalized) return 0;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function statusLabel(status) {
  const map = {
    pending: "未確認",
    confirmed: "確認済み",
    risk: "要確認",
    cancelled: "キャンセル",
    completed: "完了",
  };
  return map[String(status || "pending")] || String(status || "-");
}

function makeCode(value) {
  return String(value || "item")
    .trim()
    .toLowerCase()
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || `item-${Date.now()}`;
}

function getSafePhotoUrl(value) {
  const url = String(value || "").trim();
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return null;
}

function getFileExtension(fileName, mimeType) {
  const cleanName = String(fileName || "").toLowerCase();
  const ext = cleanName.split(".").pop();
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return ext === "jpeg" ? "jpg" : ext;
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function safe(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeAttr(value) {
  return safe(value);
}

function safeClass(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}