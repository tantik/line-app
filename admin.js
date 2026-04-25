const sb = window.supabaseClient;

let currentSalonId = null;
let currentUser = null;

let allBookings = [];
let allStaff = [];
let allServices = [];

let editingStaffId = null;
let editingServiceId = null;

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

  document.getElementById("authLoggedOut")?.classList.toggle("hidden", !!currentUser);
  document.getElementById("authLoggedIn")?.classList.toggle("hidden", !currentUser);

  if (!currentUser) {
    hideLoading();
    return;
  }

  setText("whoAmI", currentUser.email || currentUser.id);

  try {
    await resolveSalon();
    await loadAll();
  } catch (error) {
    console.error("applySession error:", error);
    showToast("管理者データの読み込みに失敗しました");
  } finally {
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

  const salon = Array.isArray(data.salons) ? data.salons[0] : data.salons;
  setText("tenantLabel", `${salon?.name || "Salon"} / ${data.role || "admin"}`);
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
  const { data, error } = await sb
    .from("admin_booking_view")
    .select("*")
    .eq("salon_id", currentSalonId)
    .order("booking_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    console.error("loadBookings error:", error);
    showToast("予約取得エラー");
    return;
  }

  allBookings = data || [];
  renderBookings();
}

async function loadServices() {
  const { data, error } = await sb
    .from("services")
    .select("*")
    .eq("salon_id", currentSalonId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.error("loadServices error:", error);
    showToast("サービス取得エラー");
    return;
  }

  allServices = data || [];
  renderServices();
}

async function loadStaff() {
  const { data: staffRows, error: staffError } = await sb
    .from("staff")
    .select("*")
    .eq("salon_id", currentSalonId)
    .order("created_at", { ascending: true });

  if (staffError) {
    console.error("loadStaff error:", staffError);
    showToast("スタッフ取得エラー");
    return;
  }

  const staffList = staffRows || [];
  const staffIds = staffList.map((s) => s.id);

  let mapRows = [];

  if (staffIds.length > 0) {
    const { data, error } = await sb
      .from("staff_service_map")
      .select("staff_id, service_id")
      .eq("salon_id", currentSalonId)
      .in("staff_id", staffIds);

    if (error) {
      console.error("staff_service_map error:", error);
      showToast("スタッフとサービスの紐付け取得エラー");
    } else {
      mapRows = data || [];
    }
  }

  allStaff = staffList.map((staff) => ({
    ...staff,
    serviceIds: mapRows
      .filter((m) => String(m.staff_id) === String(staff.id))
      .map((m) => String(m.service_id)),
  }));

  renderStaff();
  renderStaffFilter();
}

/* =========================
   BOOKINGS
========================= */

function renderBookings() {
  const mount = document.getElementById("bookingsMount");
  const empty = document.getElementById("emptyState");

  if (!mount) return;

  mount.innerHTML = "";

  updateMetrics(allBookings);

  if (empty) empty.classList.toggle("hidden", allBookings.length > 0);

  if (!allBookings.length) {
    mount.innerHTML = `<div class="empty-state">予約はまだありません</div>`;
    return;
  }

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
   STAFF
========================= */

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

    const photoUrl = getSafePhotoUrl(s.photo_url);
    const firstLetter = (s.name || "?").slice(0, 1).toUpperCase();

    const serviceNames = (s.serviceIds || [])
      .map((id) => allServices.find((service) => String(service.id) === String(id))?.name)
      .filter(Boolean);

    const serviceTags = serviceNames.length
      ? serviceNames.map((name) => `<span class="service-tag">${safe(name)}</span>`).join("")
      : `<span class="service-tag is-muted">サービス未設定</span>`;

    div.innerHTML = `
      <div class="staff-left">
        ${
          photoUrl
            ? `<img class="staff-photo" src="${safeAttr(photoUrl)}" alt="${safeAttr(s.name || "staff")}" loading="lazy">`
            : `<div class="staff-photo-placeholder">${safe(firstLetter)}</div>`
        }

        <div>
          <div class="staff-name">${safe(s.name || "-")}</div>
          <div class="staff-status">
            ${s.is_active === false ? "⚪ Inactive" : "🟢 Active"}
            / ${safe(formatTime(s.start_time))} - ${safe(formatTime(s.end_time))}
            / ${safe(s.slot_minutes || 30)}分
          </div>
          <div class="staff-service-tags">${serviceTags}</div>
        </div>
      </div>

      <div class="staff-actions">
        <button type="button" data-edit-staff="${safeAttr(s.id)}">編集</button>
        <button type="button" data-delete-staff="${safeAttr(s.id)}">削除</button>
      </div>
    `;

    div.querySelector("[data-edit-staff]")?.addEventListener("click", () => openStaffModal(s));
    div.querySelector("[data-delete-staff]")?.addEventListener("click", () => deleteStaff(s.id));

    el.appendChild(div);
  });
}

function openStaffModal(staff = null) {
  editingStaffId = staff?.id || null;

  setText("staffModalTitle", editingStaffId ? "スタッフ編集" : "スタッフ追加");

  setInputValue("staffNameInput", staff?.name || "");
  setInputValue("staffPhotoInput", getSafePhotoUrl(staff?.photo_url) || "");
  setInputValue("staffStartTimeInput", formatTime(staff?.start_time || "10:00"));
  setInputValue("staffEndTimeInput", formatTime(staff?.end_time || "19:00"));
  setInputValue("staffSlotMinutesInput", String(staff?.slot_minutes || 30));

  const activeInput = document.getElementById("staffActiveInput");
  if (activeInput) activeInput.checked = staff?.is_active !== false;

  renderServiceCheckboxes(staff?.serviceIds || []);

  document.getElementById("deleteStaffBtn")?.classList.toggle("hidden", !editingStaffId);
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

  const name = document.getElementById("staffNameInput")?.value.trim();
  const photoUrl = getSafePhotoUrl(document.getElementById("staffPhotoInput")?.value.trim());
  const startTime = normalizeTime(document.getElementById("staffStartTimeInput")?.value || "10:00");
  const endTime = normalizeTime(document.getElementById("staffEndTimeInput")?.value || "19:00");
  const slotMinutes = Number(document.getElementById("staffSlotMinutesInput")?.value || 30);
  const isActive = document.getElementById("staffActiveInput")?.checked ?? true;

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

  showLoading();

  try {
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

  showLoading();

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

  allStaff.forEach((s) => {
    const option = document.createElement("option");
    option.value = s.id;
    option.textContent = s.name || "-";
    select.appendChild(option);
  });

  select.value = current;
}

/* =========================
   SERVICES
========================= */

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
          ${s.category ? ` / ${safe(s.category)}` : ""}
        </div>
        <div class="service-tags">
          <span class="service-tag">code: ${safe(s.code || "-")}</span>
          <span class="service-tag">sort: ${safe(s.sort_order ?? 100)}</span>
        </div>
        ${s.description ? `<div class="service-description">${safe(s.description)}</div>` : ""}
      </div>

      <div class="service-actions">
        <button type="button" data-edit-service="${safeAttr(s.id)}">編集</button>
        <button type="button" data-delete-service="${safeAttr(s.id)}">削除</button>
      </div>
    `;

    div.querySelector("[data-edit-service]")?.addEventListener("click", () => openServiceModal(s));
    div.querySelector("[data-delete-service]")?.addEventListener("click", () => deleteService(s.id));

    el.appendChild(div);
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

  showLoading();

  try {
    const payload = {
      salon_id: currentSalonId,
      name,
      code,
      category,
      duration_minutes: durationMinutes,
      price_jpy: priceJpy,
      sort_order: sortOrder,
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

  showLoading();

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
   UI
========================= */

function bindUI() {
  document.getElementById("refreshBtn")?.addEventListener("click", loadAll);

  document.getElementById("signOutBtn")?.addEventListener("click", async () => {
    await sb.auth.signOut();
    window.location.reload();
  });

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

  document.getElementById("staffModal")?.addEventListener("click", (e) => {
    if (e.target.id === "staffModal") closeStaffModal();
  });

  document.getElementById("serviceModal")?.addEventListener("click", (e) => {
    if (e.target.id === "serviceModal") closeServiceModal();
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.tab === tab);
  });

  document.getElementById("bookingsSection")?.classList.toggle("hidden", tab !== "bookings");
  document.getElementById("staffSection")?.classList.toggle("hidden", tab !== "staff");
  document.getElementById("servicesSection")?.classList.toggle("hidden", tab !== "services");

  setText("pageTitle", tab === "staff" ? "Staff" : tab === "services" ? "Services" : "Bookings");
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

function showLoading() {
  document.getElementById("loadingOverlay")?.classList.add("active");
}

function hideLoading() {
  document.getElementById("loadingOverlay")?.classList.remove("active");
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
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

function normalizeTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const h = Number(match[1]);
  const m = Number(match[2]);

  if (h < 0 || h > 23 || m < 0 || m > 59) return null;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToMinutes(value) {
  const normalized = normalizeTime(value);
  if (!normalized) return 0;

  const [h, m] = normalized.split(":").map(Number);
  return h * 60 + m;
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

function getSafePhotoUrl(value) {
  const url = String(value || "").trim();

  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;

  return null;
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