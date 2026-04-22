const supabase = window.supabaseClient;
const env = window.appEnv;
let currentSalonId = null;
let currentUser = null;
let refreshTimer = null;

document.addEventListener("DOMContentLoaded", initAdmin);

async function initAdmin() {
  bindAdminUi();

  const { data } = await supabase.auth.getSession();
  await applySession(data.session);

  supabase.auth.onAuthStateChange(async (_event, session) => {
    await applySession(session);
  });
}

function bindAdminUi() {
  document.getElementById("sendMagicLinkBtn").addEventListener("click", sendMagicLink);
  document.getElementById("signOutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
  });
  document.getElementById("refreshBtn").addEventListener("click", loadBookings);
  document.getElementById("statusFilter").addEventListener("change", renderBookings);
  document.getElementById("selectedDate").addEventListener("change", renderBookings);
  document.getElementById("searchText").addEventListener("input", renderBookings);
}

async function sendMagicLink() {
  const email = document.getElementById("adminEmail").value.trim();
  if (!email) return toast("メールを入力してください");

  setLoading(true);
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: env.ADMIN_REDIRECT_TO }
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
  document.getElementById("authLoggedOut").classList.toggle("hidden", !!currentUser);
  document.getElementById("authLoggedIn").classList.toggle("hidden", !currentUser);

  if (!currentUser) {
    document.getElementById("whoAmI").textContent = "-";
    document.getElementById("tenantLabel").textContent = "-";
    currentSalonId = null;
    stopRefresh();
    renderRows([]);
    setLoading(false);
    return;
  }

  setLoading(true);
  try {
    document.getElementById("whoAmI").textContent = currentUser.email || currentUser.id;
    await resolveSalonMembership();
    await loadBookings();
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
  document.getElementById("tenantLabel").textContent = `${data.salons.name} / ${data.role}`;
}

let allBookings = [];

async function loadBookings() {
  if (!currentSalonId) return;

  setLoading(true);
  try {
    const { data, error } = await supabase
      .from("admin_booking_view")
      .select("*")
      .eq("salon_id", currentSalonId)
      .order("booking_date", { ascending: true })
      .order("start_time", { ascending: true });

    if (error) throw error;
    allBookings = data || [];
    document.getElementById("lastUpdated").textContent = `最終更新: ${new Date().toLocaleString("ja-JP")}`;
    renderBookings();
  } catch (error) {
    console.error(error);
    toast("予約読み込みに失敗しました");
  } finally {
    setLoading(false);
  }
}

function renderBookings() {
  const selectedDate = document.getElementById("selectedDate").value;
  const statusFilter = document.getElementById("statusFilter").value;
  const searchText = document.getElementById("searchText").value.trim().toLowerCase();

  let items = [...allBookings];

  if (selectedDate) items = items.filter((item) => item.booking_date === selectedDate);
  if (statusFilter) items = items.filter((item) => item.status === statusFilter);
  if (searchText) {
    items = items.filter((item) =>
      [item.customer_name, item.customer_phone, item.service_name, item.staff_name]
        .join(" ")
        .toLowerCase()
        .includes(searchText)
    );
  }

  updateMetrics(items);
  renderRows(items);
}

function renderRows(items) {
  const table = document.getElementById("bookingTable");
  const empty = document.getElementById("emptyState");
  table.innerHTML = "";
  empty.classList.toggle("hidden", items.length > 0);

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "booking-row";
    row.innerHTML = `
      <div>
        <div class="cell-title">${escapeHtml(item.customer_name)}</div>
        <div class="cell-sub">${escapeHtml(item.customer_phone || "-")}</div>
      </div>
      <div>
        <div class="cell-title">${escapeHtml(item.service_name)}</div>
        <div class="cell-sub">${escapeHtml(item.staff_name)}</div>
      </div>
      <div>
        <div class="cell-title">${escapeHtml(item.booking_date)}</div>
        <div class="cell-sub">${escapeHtml(item.start_time)} - ${escapeHtml(item.end_time)}</div>
      </div>
      <div>
        <span class="badge ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
      </div>
      <div>
        <div class="cell-title">Risk</div>
        <div class="cell-sub">${escapeHtml(item.risk_score ?? 0)}</div>
      </div>
      <div class="row-actions">
        <button class="small-btn" data-action="confirm">確認済み</button>
        <button class="small-btn" data-action="risk">risk</button>
        <button class="small-btn" data-action="cancelled">キャンセル</button>
        <button class="small-btn" data-action="completed">完了</button>
      </div>
    `;
    row.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => updateBookingStatus(item.id, btn.dataset.action));
    });
    table.appendChild(row);
  });
}

async function updateBookingStatus(bookingId, nextStatus) {
  setLoading(true);
  try {
    const patch = { status: nextStatus };
    if (nextStatus === "cancelled") patch.cancelled_by = "admin";
    if (nextStatus === "confirmed") patch.confirmed_at = new Date().toISOString();

    const { error } = await supabase.from("bookings").update(patch).eq("id", bookingId).eq("salon_id", currentSalonId);
    if (error) throw error;
    toast("更新しました");
    await loadBookings();
  } catch (error) {
    console.error(error);
    toast("更新に失敗しました");
  } finally {
    setLoading(false);
  }
}

function updateMetrics(items) {
  document.getElementById("metricCount").textContent = String(items.length);
  document.getElementById("metricPending").textContent = String(items.filter((x) => x.status === "pending").length);
  document.getElementById("metricRisk").textContent = String(items.filter((x) => x.status === "risk").length);
  document.getElementById("metricCancelled").textContent = String(items.filter((x) => x.status === "cancelled").length);
}

function startRefresh() {
  stopRefresh();
  refreshTimer = setInterval(() => {
    if (!document.hidden) loadBookings();
  }, 15000);
}

function stopRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

function setLoading(on) {
  document.getElementById("loadingOverlay").classList.toggle("active", !!on);
}

function toast(text) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
