const supabase = window.supabaseClient;
const env = window.__APP_ENV__ || window.appEnv || {};

let currentSalonId = null;
let currentUser = null;
let refreshTimer = null;
let realtimeChannel = null;
let allBookings = [];
let allStaff = [];

const bookingState = {
  view: "today", // today | day | week | month
  selectedDate: getTodayString(),
  statusFilter: "",
  staffFilter: "",
  searchText: "",
};

document.addEventListener("DOMContentLoaded", initAdmin);

async function initAdmin() {
  bindAdminUi();
  setInitialDate();

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error(error);
  }

  await applySession(data?.session || null);

  supabase.auth.onAuthStateChange(async (_event, session) => {
    await applySession(session);
  });
}

/* -------------------- init / auth -------------------- */

function bindAdminUi() {
  document
    .getElementById("sendMagicLinkBtn")
    ?.addEventListener("click", sendMagicLink);

  document.getElementById("signOutBtn")?.addEventListener("click", async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error(error);
      toast("ログアウトに失敗しました");
    }
  });

  document.getElementById("refreshBtn")?.addEventListener("click", async () => {
    await loadBookings(true);
  });

  document.getElementById("selectedDate")?.addEventListener("change", async (e) => {
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

  document.getElementById("prevRangeBtn")?.addEventListener("click", () => {
    shiftRange(-1);
  });

  document.getElementById("nextRangeBtn")?.addEventListener("click", () => {
    shiftRange(1);
  });

  document.getElementById("jumpTodayBtn")?.addEventListener("click", () => {
    bookingState.selectedDate = getTodayString();
    if (bookingState.view === "today") bookingState.view = "today";
    syncSelectedDateInput();
    syncViewButtons();
    renderRangeLabel();
    renderBookings();
  });

  document.querySelectorAll(".view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      bookingState.view = btn.dataset.view;
      if (bookingState.view === "today") {
        bookingState.selectedDate = getTodayString();
      }
      syncSelectedDateInput();
      syncViewButtons();
      renderRangeLabel();
      renderBookings();
    });
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) return;
    if (currentSalonId) await loadBookings(true);
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
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:
          env.ADMIN_REDIRECT_TO || `${window.location.origin}/admin.html`,
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
    stopRefresh();
    unsubscribeRealtime();
    populateStaffFilter([]);
    renderBookings();
    setLoading(false);
    return;
  }

  setLoading(true, "読み込み中...", "管理者権限を確認しています");

  try {
    document.getElementById("whoAmI").textContent =
      currentUser.email || currentUser.id;

    await resolveSalonMembership();
    await loadBookings(true);
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
  const { data, error } = await supabase
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

/* -------------------- data loading -------------------- */

async function loadBookings(showSpinner = false) {
  if (!currentSalonId) return;

  if (showSpinner) {
    setLoading(true, "読み込み中...", "予約一覧を更新しています");
  }

  try {
    const { data, error } = await supabase
      .from("admin_booking_view")
      .select("*")
      .eq("salon_id", currentSalonId)
      .order("booking_date", { ascending: true })
      .order("start_time", { ascending: true });

    if (error) throw error;

    allBookings = Array.isArray(data) ? data : [];

    hydrateStaffFilterFromBookings();
    document.getElementById(
      "lastUpdated"
    ).textContent = `最終更新: ${new Date().toLocaleString("ja-JP")}`;

    renderBookings();
  } catch (error) {
    console.error(error);
    toast("予約読み込みに失敗しました");
  } finally {
    if (showSpinner) setLoading(false);
  }
}

function hydrateStaffFilterFromBookings() {
  const map = new Map();

  allBookings.forEach((item) => {
    const id = String(item.staff_id || item.staff_name || "");
    const name = item.staff_name || "担当者";
    if (!id) return;
    if (!map.has(id)) {
      map.set(id, { id, name });
    }
  });

  allStaff = Array.from(map.values()).sort((a, b) =>
    String(a.name).localeCompare(String(b.name), "ja")
  );

  populateStaffFilter(allStaff);
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

/* -------------------- realtime -------------------- */

function subscribeRealtime() {
  unsubscribeRealtime();

  if (!currentSalonId) return;

  realtimeChannel = supabase
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
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

function startRefresh() {
  stopRefresh();
  refreshTimer = setInterval(async () => {
    if (document.hidden || !currentSalonId) return;
    await loadBookings(false);
  }, 30000);
}

function stopRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

/* -------------------- render root -------------------- */

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
    const date = item.booking_date;
    return date >= start && date <= end;
  });

  if (bookingState.statusFilter) {
    items = items.filter((item) => item.status === bookingState.statusFilter);
  }

  if (bookingState.staffFilter) {
    items = items.filter(
      (item) =>
        String(item.staff_id || item.staff_name || "") ===
        String(bookingState.staffFilter)
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

/* -------------------- day / week / month views -------------------- */

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
  const monthEndDate = parseDateLocal(monthEnd);

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

    if (date < monthStart || date > monthEnd) {
      cell.classList.add("is-other");
    }

    if (date === bookingState.selectedDate) {
      cell.classList.add("is-selected");
    }

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

/* -------------------- booking card -------------------- */

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
    buttons.push(
      `<button class="action-btn is-success" data-action="confirmed">確認済み</button>`
    );
  }

  if (status !== "cancelled") {
    buttons.push(
      `<button class="action-btn is-danger" data-action="cancelled">キャンセル</button>`
    );
  }

  if (status !== "completed" && status !== "cancelled") {
    buttons.push(
      `<button class="action-btn is-dark" data-action="completed">完了</button>`
    );
  }

  return buttons.join("");
}

/* -------------------- update booking -------------------- */

async function updateBookingStatus(bookingId, nextStatus) {
  if (!currentSalonId) return;

  setLoading(true, "更新中...", "予約ステータスを更新しています");

  try {
    const patch = { status: nextStatus };

    if (nextStatus === "cancelled") {
      patch.cancelled_by = "admin";
    }

    if (nextStatus === "confirmed") {
      patch.confirmed_at = new Date().toISOString();
    }

    const { error } = await supabase
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

/* -------------------- metrics -------------------- */

function updateMetrics(items) {
  document.getElementById("metricCount").textContent = String(items.length);
  document.getElementById("metricPending").textContent = String(
    items.filter((x) => x.status === "pending").length
  );
  document.getElementById("metricRisk").textContent = String(
    items.filter((x) => x.status === "risk").length
  );
  document.getElementById("metricCancelled").textContent = String(
    items.filter((x) => x.status === "cancelled").length
  );
}

/* -------------------- range / dates -------------------- */

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

/* -------------------- utils -------------------- */

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

function formatStatusLabel(status) {
  switch (String(status || "")) {
    case "pending":
      return "未確認";
    case "confirmed":
      return "確認済み";
    case "risk":
      return "要確認";
    case "cancelled":
      return "キャンセル";
    case "completed":
      return "完了";
    default:
      return status || "-";
  }
}

function getTodayString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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
  const day = d.getDay(); // Sun 0
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

function escapeClass(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}