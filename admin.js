const sb = window.supabaseClient;
const env = window.__APP_ENV__ || window.appEnv || {};

let currentSalonId = null;
let currentUser = null;
let refreshTimer = null;
let realtimeChannel = null;

let allBookings = [];
let allStaff = [];
let allServices = [];
let currentTab = "bookings";
let editingStaffId = null;

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
    console.error("window.supabaseClient is missing");
    toast("Supabase client が見つかりません");
    setLoading(false);
    return;
  }

  const { data, error } = await sb.auth.getSession();
  if (error) console.error(error);

  await applySession(data?.session || null);

  sb.auth.onAuthStateChange(async (_event, session) => {
    await applySession(session);
  });
}

function bindAdminUi() {
  document.getElementById("sendMagicLinkBtn")?.addEventListener("click", sendMagicLink);

  document.getElementById("signOutBtn")?.addEventListener("click", async () => {
    try {
      await sb.auth.signOut();
    } catch (error) {
      console.error(error);
      toast("ログアウトに失敗しました");
    }
  });

  document.getElementById("refreshBtn")?.addEventListener("click", async () => {
    await refreshAll(true);
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

  document.querySelectorAll(".view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      bookingState.view = btn.dataset.view;
      if (bookingState.view === "today") bookingState.selectedDate = getTodayString();
      syncSelectedDateInput();
      syncViewButtons();
      renderRangeLabel();
      renderBookings();
    });
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document.getElementById("addStaffBtn")?.addEventListener("click", () => openStaffModal());
  document.getElementById("closeStaffModalBtn")?.addEventListener("click", closeStaffModal);
  document.getElementById("cancelStaffModalBtn")?.addEventListener("click", closeStaffModal);
  document.getElementById("saveStaffBtn")?.addEventListener("click", saveStaff);
  document.getElementById("deleteStaffBtn")?.addEventListener("click", deleteEditingStaff);

  document.getElementById("staffModal")?.addEventListener("click", (event) => {
    if (event.target.id === "staffModal") closeStaffModal();
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) return;
    if (currentSalonId) await refreshAll(false);
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
    console.error(error);
    toast("ログインリンク送信に失敗しました");
  } finally {
    setLoading(false);
  }
}

async function applySession(session) {
  currentUser = session?.user || null;

  document.getElementById("authLoggedOut")?.classList.toggle("hidden", !!currentUser);
  document.getElementById("authLoggedIn")?.classList.toggle("hidden", !currentUser);

  if (!currentUser) {
    document.getElementById("whoAmI").textContent = "-";
    document.getElementById("tenantLabel").textContent = "-";
    currentSalonId = null;
    allBookings = [];
    allStaff = [];
    allServices = [];
    stopRefresh();
    unsubscribeRealtime();
    populateStaffFilter([]);
    renderBookings();
    renderStaff([]);
    setLoading(false);
    return;
  }

  setLoading(true, "読み込み中...", "管理者権限を確認しています");

  try {
    document.getElementById("whoAmI").textContent = currentUser.email || currentUser.id;
    await resolveSalonMembership();
    await refreshAll(false);
    subscribeRealtime();
    startRefresh();
  } catch (error) {
    console.error(error);
    toast("このアカウントにはサロン権限がありません");
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
  document.getElementById("tenantLabel").textContent =
    `${data.salons?.name || "-"} / ${data.role || "-"}`;
}

async function refreshAll(showSpinner = false) {
  if (!currentSalonId) return;

  if (showSpinner) setLoading(true, "読み込み中...", "データを更新しています");

  try {
    await loadServices();
    await loadBookings(false);
    await loadStaff();
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

  const pageTitle = document.getElementById("pageTitle");
  if (pageTitle) pageTitle.textContent = currentTab === "bookings" ? "Bookings" : "Staff";
}

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
    hydrateStaffFilterFromBookings();

    const lastUpdated = document.getElementById("lastUpdated");
    if (lastUpdated) {
      lastUpdated.textContent = `最終更新: ${new Date().toLocaleString("ja-JP")}`;
    }

    renderBookings();
  } catch (error) {
    console.error(error);
    toast("予約読み込みに失敗しました");
  } finally {
    if (showSpinner) setLoading(false);
  }
}

async function loadServices() {
  if (!currentSalonId) return;

  try {
    const { data, error } = await sb
      .from("services")
      .select("id, name")
      .eq("salon_id", currentSalonId)
      .order("name", { ascending: true });

    if (error) throw error;
    allServices = Array.isArray(data) ? data : [];
  } catch (error) {
    console.error(error);
    toast("サービス取得エラー");
    allServices = [];
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
        .from("staff_services")
        .select("staff_id, service_id")
        .in("staff_id", staffIds);

      if (linkError) throw linkError;
      links = Array.isArray(linkRows) ? linkRows : [];
    }

    allStaff = staffList.map((member) => {
      const serviceIds = links
        .filter((link) => String(link.staff_id) === String(member.id))
        .map((link) => String(link.service_id));

      return {
        ...member,
        serviceIds,
      };
    });

    renderStaff(allStaff);
  } catch (error) {
    console.error(error);
    toast("スタッフ取得エラー");
    renderStaff([]);
  }
}

function hydrateStaffFilterFromBookings() {
  const map = new Map();

  allBookings.forEach((item) => {
    const id = String(item.staff_id || item.staff_name || "");
    const name = item.staff_name || "担当者";
    if (!id) return;
    if (!map.has(id)) map.set(id, { id, name });
  });

  const filterStaff = Array.from(map.values()).sort((a, b) =>
    String(a.name).localeCompare(String(b.name), "ja")
  );

  populateStaffFilter(filterStaff);
}

function populateStaffFilter(staffList) {
  const select = document.getElementById("staffFilter");
  if (!select) return;

  const currentValue = bookingState.staffFilter;
  select.innerHTML = `<option value="">全担当者</option>`;

  staffList.forEach((member) => {
    const option = document.createElement("option");
    option.value = member.id;
    option.textContent = member.name;
    select.appendChild(option);
  });

  if (staffList.some((x) => String(x.id) === String(currentValue))) {
    select.value = currentValue;
  } else {
    select.value = "";
    bookingState.staffFilter = "";
  }
}

function subscribeRealtime() {
  unsubscribeRealtime();

  if (!currentSalonId) return;

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
      async () => {
        await loadBookings(false);
      }
    )
    .subscribe((status) => {
      console.log("Realtime status:", status);
    });
}

function unsubscribeRealtime() {
  if (realtimeChannel) {
    sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

function startRefresh() {
  stopRefresh();
  refreshTimer = setInterval(async () => {
    if (document.hidden || !currentSalonId) return;
    await refreshAll(false);
  }, 30000);
}

function stopRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

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

    const photo = item.photo_url
      ? escapeAttr(item.photo_url)
      : "https://via.placeholder.com/120x120.png?text=Staff";

    const serviceNames = (item.serviceIds || [])
      .map((id) => allServices.find((service) => String(service.id) === String(id))?.name)
      .filter(Boolean);

    const tagsHtml = serviceNames.length
      ? serviceNames.map((name) => `<span class="service-tag">${escapeHtml(name)}</span>`).join("")
      : `<span class="service-tag">サービス未設定</span>`;

    card.innerHTML = `
      <div class="staff-left">
        <img src="${photo}" alt="${escapeAttr(item.name || "staff")}" />
        <div>
          <div class="staff-name">${escapeHtml(item.name || "-")}</div>
          <div class="staff-status">${item.is_active ? "🟢 Active" : "⚪ Inactive"}</div>
          <div class="staff-service-tags">${tagsHtml}</div>
        </div>
      </div>

      <div class="staff-actions">
        <button type="button" data-action="edit">編集</button>
        <button type="button" data-action="delete">削除</button>
      </div>
    `;

    card.querySelector('[data-action="edit"]')?.addEventListener("click", () => {
      openStaffModal(item);
    });

    card.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
      await deleteStaff(item.id);
    });

    mount.appendChild(card);
  });
}

function openStaffModal(staff = null) {
  editingStaffId = staff?.id || null;

  document.getElementById("staffModalTitle").textContent = editingStaffId
    ? "スタッフ編集"
    : "スタッフ追加";

  document.getElementById("staffNameInput").value = staff?.name || "";
  document.getElementById("staffPhotoInput").value = staff?.photo_url || "";
  document.getElementById("staffActiveInput").checked = staff?.is_active ?? true;

  document.getElementById("deleteStaffBtn")?.classList.toggle("hidden", !editingStaffId);

  renderServiceCheckboxes(staff?.serviceIds || []);
  document.getElementById("staffModal")?.classList.remove("hidden");
}

function closeStaffModal() {
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
  if (!currentSalonId) return;

  const name = document.getElementById("staffNameInput")?.value.trim();
  const photoUrl = document.getElementById("staffPhotoInput")?.value.trim();
  const isActive = document.getElementById("staffActiveInput")?.checked ?? true;

  const serviceIds = Array.from(
    document.querySelectorAll("#servicesCheckboxes input[type='checkbox']:checked")
  ).map((input) => input.value);

  if (!name) {
    toast("スタッフ名を入力してください");
    return;
  }

  setLoading(true, "保存中...", "スタッフ情報を保存しています");

  try {
    let staffId = editingStaffId;

    if (!staffId) {
      const { data, error } = await sb
        .from("staff")
        .insert({
          salon_id: currentSalonId,
          name,
          photo_url: photoUrl || null,
          is_active: isActive,
        })
        .select("id")
        .single();

      if (error) throw error;
      staffId = data.id;
    } else {
      const { error } = await sb
        .from("staff")
        .update({
          name,
          photo_url: photoUrl || null,
          is_active: isActive,
        })
        .eq("id", staffId)
        .eq("salon_id", currentSalonId);

      if (error) throw error;
    }

    const { error: deleteLinkError } = await sb
      .from("staff_services")
      .delete()
      .eq("staff_id", staffId);

    if (deleteLinkError) throw deleteLinkError;

    if (serviceIds.length) {
      const rows = serviceIds.map((serviceId) => ({
        staff_id: staffId,
        service_id: serviceId,
      }));

      const { error: insertLinkError } = await sb
        .from("staff_services")
        .insert(rows);

      if (insertLinkError) throw insertLinkError;
    }

    toast("保存しました");
    closeStaffModal();
    await loadStaff();
  } catch (error) {
    console.error(error);
    toast("保存に失敗しました");
  } finally {
    setLoading(false);
  }
}

async function deleteEditingStaff() {
  if (!editingStaffId) return;
  await deleteStaff(editingStaffId);
  closeStaffModal();
}

async function deleteStaff(staffId) {
  if (!staffId) return;

  const ok = confirm("このスタッフを削除しますか？");
  if (!ok) return;

  setLoading(true, "削除中...", "スタッフを削除しています");

  try {
    await sb.from("staff_services").delete().eq("staff_id", staffId);

    const { error } = await sb
      .from("staff")
      .delete()
      .eq("id", staffId)
      .eq("salon_id", currentSalonId);

    if (error) throw error;

    toast("削除しました");
    await loadStaff();
  } catch (error) {
    console.error(error);
    toast("削除に失敗しました");
  } finally {
    setLoading(false);
  }
}

function getFilteredBookings() {
  let items = Array.isArray(allBookings) ? [...allBookings] : [];

  const { start, end } = getCurrentRange();
  items = items.filter((item) => {
    const date = item.booking_date;
    return date >= start && date <= end;
  });

  if (bookingState.statusFilter) {
    items = items.filter((item) => item.status === bookingState.statusFilter);
  }

  if (bookingState.staffFilter) {
    items = items.filter(
      (item) =>
        String(item.staff_id || item.staff_name || "") === String(bookingState.staffFilter)
    );
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

  items.sort((a, b) => {
    const dateCmp = String(a.booking_date).localeCompare(String(b.booking_date));
    if (dateCmp !== 0) return dateCmp;
    return String(a.start_time).localeCompare(String(b.start_time));
  });

  return items;
}

function renderDayView(items, mount) {
  const list = document.createElement("div");
  list.className = "day-list";

  items.forEach((item) => {
    list.appendChild(buildBookingCard(item));
  });

  mount.appendChild(list);
}

function renderWeekView(items, mount) {
  const groups = new Map();

  items.forEach((item) => {
    const date = item.booking_date;
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

    dayItems.forEach((item) => {
      body.appendChild(buildBookingCard(item));
    });

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

  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  weekdays.forEach((label) => {
    const cell = document.createElement("div");
    cell.className = "month-weekday";
    cell.textContent = label;
    grid.appendChild(cell);
  });

  const firstWeekday = monthStartDate.getDay();
  const firstVisibleDate = addDays(monthStart, -firstWeekday);

  for (let i = 0; i < 42; i++) {
    const date = addDays(firstVisibleDate, i);
    const count = items.filter((x) => x.booking_date === date).length;

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
      syncSelectedDateInput();
      syncViewButtons();
      renderRangeLabel();
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

  const statusBadge = `
    <span class="badge badge-status-${escapeClass(item.status || "")}">
      ${escapeHtml(formatStatusLabel(item.status))}
    </span>
  `;

  card.innerHTML = `
    <div class="booking-top">
      <div class="booking-time">
        <div class="booking-time-main">${escapeHtml(item.start_time || "--:--")}</div>
        <div class="booking-time-sub">
          ${escapeHtml(item.booking_date || "-")}
          ${item.end_time ? ` / ${escapeHtml(item.end_time)}` : ""}
        </div>
      </div>
      <div class="badges">
        ${statusBadge}
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
      ${buildActionButtons(item)}
    </div>
  `;

  card.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const nextStatus = btn.dataset.action;
      await updateBookingStatus(item.id, nextStatus);
    });
  });

  return card;
}

function buildActionButtons(item) {
  const status = String(item.status || "");
  const buttons = [];

  if (status !== "confirmed" && status !== "completed" && status !== "cancelled") {
    buttons.push(`<button class="action-btn is-success" data-action="confirmed">確認済み</button>`);
  }

  if (status !== "cancelled") {
    buttons.push(`<button class="action-btn is-danger" data-action="cancelled">キャンセル</button>`);
  }

  if (status !== "completed" && status !== "cancelled") {
    buttons.push(`<button class="action-btn is-dark" data-action="completed">完了</button>`);
  }

  return buttons.join("");
}

async function updateBookingStatus(bookingId, nextStatus) {
  if (!currentSalonId) return;

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
    console.error(error);
    toast("更新に失敗しました");
  } finally {
    setLoading(false);
  }
}

function updateMetrics(items) {
  setText("metricCount", String(items.length));
  setText("metricPending", String(items.filter((x) => x.status === "pending").length));
  setText("metricRisk", String(items.filter((x) => x.status === "risk").length));
  setText("metricCancelled", String(items.filter((x) => x.status === "cancelled").length));
}

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

  if (bookingState.view === "day") {
    return { start: selected, end: selected };
  }

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
  if (![1, -1].includes(direction)) return;

  const selected = bookingState.selectedDate || getTodayString();

  if (bookingState.view === "today") {
    bookingState.selectedDate = addDays(getTodayString(), direction);
    bookingState.view = "day";
  } else if (bookingState.view === "day") {
    bookingState.selectedDate = addDays(selected, direction);
  } else if (bookingState.view === "week") {
    bookingState.selectedDate = addDays(selected, direction * 7);
  } else if (bookingState.view === "month") {
    bookingState.selectedDate = addMonths(selected, direction);
  }

  syncSelectedDateInput();
  renderRangeLabel();
  renderBookings();
}

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

  setTimeout(() => el.remove(), 2600);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
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

function getTodayString() {
  const d = new Date();
  return toDateString(d);
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
  const day = d.getDay();
  d.setDate(d.getDate() - day);
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