const sb = window.supabaseClient;

let currentSalonId = null;
let currentUser = null;
let allServices = [];
let allStaff = [];
let allBookings = [];

document.addEventListener("DOMContentLoaded", initAdmin);

async function initAdmin() {
  bindUI();

  if (!sb) {
    showToast("Supabase client не загружен");
    hideLoading();
    return;
  }

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
}

/* =========================
   AUTH
========================= */

async function applySession(session) {
  currentUser = session?.user || null;

  const loggedOut = document.getElementById("authLoggedOut");
  const loggedIn = document.getElementById("authLoggedIn");

  if (!currentUser) {
    loggedOut?.classList.remove("hidden");
    loggedIn?.classList.add("hidden");

    hideLoading();
    return;
  }

  loggedOut?.classList.add("hidden");
  loggedIn?.classList.remove("hidden");

  setText("whoAmI", currentUser.email || currentUser.id);

  try {
    await resolveSalon();
    await loadAll();

    hideLoading();
  } catch (error) {
    console.error("applySession error:", error);
    showToast("管理者データの読み込みに失敗しました");
    hideLoading();
  }
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

  const salonName = data.salons?.name || "Salon";
  const role = data.role || "admin";

  setText("tenantLabel", `${salonName} / ${role}`);
}

/* =========================
   LOAD ALL
========================= */

async function loadAll() {
  if (!currentSalonId) return;

  await loadServices();
  await loadStaff();
  await loadBookings();

  setText("lastUpdated", `最終更新: ${new Date().toLocaleString("ja-JP")}`);
}

/* =========================
   BOOKINGS
========================= */

async function loadBookings() {
  const mount = document.getElementById("bookingsMount");
  const empty = document.getElementById("emptyState");

  if (!mount) return;

  const { data, error } = await sb
    .from("admin_booking_view")
    .select("*")
    .eq("salon_id", currentSalonId)
    .order("booking_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    console.error("loadBookings error:", error);
    mount.innerHTML = `<div class="empty-state">予約の読み込みに失敗しました</div>`;
    return;
  }

  allBookings = data || [];

  renderBookings();

  if (empty) {
    empty.classList.toggle("hidden", allBookings.length > 0);
  }
}

function renderBookings() {
  const mount = document.getElementById("bookingsMount");
  if (!mount) return;

  mount.innerHTML = "";

  if (!allBookings.length) {
    mount.innerHTML = `<div class="empty-state">予約はまだありません</div>`;
    updateMetrics([]);
    return;
  }

  updateMetrics(allBookings);

  const wrap = document.createElement("div");
  wrap.className = "day-list";

  allBookings.forEach((b) => {
    const card = document.createElement("div");
    card.className = "booking-card";

    card.innerHTML = `
      <div class="booking-top">
        <div>
          <div class="booking-time-main">${safe(formatTime(b.start_time))}</div>
          <div class="booking-time-sub">${safe(b.booking_date || "")}</div>
        </div>

        <div class="badges">
          <span class="badge badge-status-${safeClass(b.status || "pending")}">
            ${statusLabel(b.status)}
          </span>
        </div>
      </div>

      <div class="booking-main">
        <div class="booking-block">
          <div class="booking-block-label">お客様</div>
          <div class="booking-name">${safe(b.customer_name || "-")}</div>
          <div class="booking-phone">${safe(b.customer_phone || "-")}</div>
        </div>

        <div class="booking-block">
          <div class="booking-block-label">予約内容</div>
          <div class="booking-meta-line">✂ ${safe(b.service_name || "-")}</div>
          <div class="booking-meta-line">👤 ${safe(b.staff_name || "-")}</div>
        </div>
      </div>
    `;

    wrap.appendChild(card);
  });

  mount.appendChild(wrap);
}

function updateMetrics(items) {
  setText("metricTotal", String(items.length));
  setText("metricPending", String(items.filter((x) => x.status === "pending").length));
  setText("metricRisk", String(items.filter((x) => x.status === "risk").length));
  setText("metricCancelled", String(items.filter((x) => x.status === "cancelled").length));
}

/* =========================
   SERVICES
========================= */

async function loadServices() {
  const { data, error } = await sb
    .from("services")
    .select("*")
    .eq("salon_id", currentSalonId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("loadServices error:", error);
    showToast("サービス取得エラー");
    return;
  }

  allServices = data || [];
  renderServices();
}

function renderServices() {
  const el = document.getElementById("servicesList");
  if (!el) return;

  el.innerHTML = "";

  if (!allServices.length) {
    el.innerHTML = `<div class="empty-state">サービスがありません</div>`;
    return;
  }

  allServices.forEach((s) => {
    const div = document.createElement("div");
    div.className = "service-card";

    div.innerHTML = `
      <div>
        <div class="service-name">${safe(s.name || "-")}</div>
        <div class="service-meta">
          ${s.is_active === false ? "⚪ Inactive" : "🟢 Active"}
          / ${safe(s.duration_minutes || 0)}分
          / ¥${Number(s.price_jpy || 0).toLocaleString("ja-JP")}
        </div>
        <div class="service-tags">
          <span class="service-tag">code: ${safe(s.code || "-")}</span>
          <span class="service-tag">sort: ${safe(s.sort_order ?? 100)}</span>
        </div>
      </div>

      <div class="service-actions">
        <button type="button" data-edit-service="${safeAttr(s.id)}">編集</button>
        <button type="button" data-delete-service="${safeAttr(s.id)}">削除</button>
      </div>
    `;

    div.querySelector("[data-delete-service]")?.addEventListener("click", () => deleteService(s.id));

    el.appendChild(div);
  });
}

async function createService() {
  if (!currentSalonId) return;

  const name = prompt("サービス名を入力してください");
  if (!name) return;

  const { error } = await sb.from("services").insert({
    salon_id: currentSalonId,
    name,
    code: makeCode(name),
    duration_minutes: 60,
    price_jpy: 0,
    sort_order: 100,
    is_active: true,
  });

  if (error) {
    console.error("createService error:", error);
    showToast("サービス追加に失敗しました");
    return;
  }

  await loadServices();
}

async function deleteService(id) {
  if (!confirm("このサービスを削除しますか？")) return;

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
    console.error("deleteService error:", error);
    showToast("サービス削除に失敗しました");
    return;
  }

  await loadServices();
}

/* =========================
   STAFF
========================= */

async function loadStaff() {
  const { data, error } = await sb
    .from("staff")
    .select("*")
    .eq("salon_id", currentSalonId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("loadStaff error:", error);
    showToast("スタッフ取得エラー");
    return;
  }

  allStaff = data || [];
  renderStaff();
  renderStaffFilter();
}

function renderStaff() {
  const el = document.getElementById("staffList");
  if (!el) return;

  el.innerHTML = "";

  if (!allStaff.length) {
    el.innerHTML = `<div class="empty-state">スタッフがいません</div>`;
    return;
  }

  allStaff.forEach((s) => {
    const div = document.createElement("div");
    div.className = "staff-card";

    div.innerHTML = `
      <div class="staff-left">
        <div class="staff-photo-placeholder">${safe((s.name || "?").slice(0, 1))}</div>
        <div>
          <div class="staff-name">${safe(s.name || "-")}</div>
          <div class="staff-status">
            ${s.is_active === false ? "⚪ Inactive" : "🟢 Active"}
            / ${safe(formatTime(s.start_time))} - ${safe(formatTime(s.end_time))}
            / ${safe(s.slot_minutes || 30)}分
          </div>
        </div>
      </div>

      <div class="staff-actions">
        <button type="button" data-delete-staff="${safeAttr(s.id)}">削除</button>
      </div>
    `;

    div.querySelector("[data-delete-staff]")?.addEventListener("click", () => deleteStaff(s.id));

    el.appendChild(div);
  });
}

function renderStaffFilter() {
  const select = document.getElementById("staffFilter");
  if (!select) return;

  select.innerHTML = `<option value="">全担当者</option>`;

  allStaff.forEach((s) => {
    const option = document.createElement("option");
    option.value = s.id;
    option.textContent = s.name || "-";
    select.appendChild(option);
  });
}

async function createStaff() {
  if (!currentSalonId) return;

  const name = prompt("スタッフ名を入力してください");
  if (!name) return;

  const { error } = await sb.from("staff").insert({
    salon_id: currentSalonId,
    name,
    code: makeCode(name),
    start_time: "10:00",
    end_time: "19:00",
    slot_minutes: 30,
    is_active: true,
  });

  if (error) {
    console.error("createStaff error:", error);
    showToast("スタッフ追加に失敗しました");
    return;
  }

  await loadStaff();
}

async function deleteStaff(id) {
  if (!confirm("このスタッフを削除しますか？")) return;

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
    console.error("deleteStaff error:", error);
    showToast("スタッフ削除に失敗しました");
    return;
  }

  await loadStaff();
}

/* =========================
   UI
========================= */

function bindUI() {
  document.getElementById("refreshBtn")?.addEventListener("click", loadAll);

  document.getElementById("signOutBtn")?.addEventListener("click", async () => {
    await sb.auth.signOut();
    window.location.reload();
  });

  document.getElementById("sendMagicLinkBtn")?.addEventListener("click", sendMagicLink);

  document.getElementById("addServiceBtn")?.addEventListener("click", createService);
  document.getElementById("addStaffBtn")?.addEventListener("click", createStaff);

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;

      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");

      document.getElementById("bookingsSection")?.classList.toggle("hidden", tab !== "bookings");
      document.getElementById("staffSection")?.classList.toggle("hidden", tab !== "staff");
      document.getElementById("servicesSection")?.classList.toggle("hidden", tab !== "services");

      setText("pageTitle", tab === "staff" ? "Staff" : tab === "services" ? "Services" : "Bookings");
    });
  });
}

async function sendMagicLink() {
  const email = document.getElementById("adminEmail")?.value.trim();

  if (!email) {
    showToast("メールを入力してください");
    return;
  }

  const { error } = await sb.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/admin.html`,
    },
  });

  if (error) {
    console.error("sendMagicLink error:", error);
    showToast("ログインリンク送信に失敗しました");
    return;
  }

  showToast("ログインリンクを送信しました");
}

/* =========================
   HELPERS
========================= */

function hideLoading() {
  document.getElementById("loadingOverlay")?.classList.remove("active");
}

function showLoading() {
  document.getElementById("loadingOverlay")?.classList.add("active");
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function showToast(message) {
  const toast = document.getElementById("toast");

  if (!toast) {
    alert(message);
    return;
  }

  toast.textContent = message;
  toast.classList.remove("hidden");

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 3000);
}

function formatTime(value) {
  if (!value) return "--:--";
  return String(value).slice(0, 5);
}

function statusLabel(status) {
  const map = {
    pending: "未確認",
    confirmed: "確認済み",
    risk: "要確認",
    cancelled: "キャンセル",
    completed: "完了",
  };

  return map[status] || status || "未確認";
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