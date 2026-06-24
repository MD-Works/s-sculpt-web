// ============================================
// ADMIN CONSOLE LOGIC
// ============================================

// ---------- Auth (placeholder only — NOT real security) ----------
// This just keeps casual visitors from stumbling into the console.
// Real protection arrives with Supabase Auth (see HANDOFF.md step 3).
const ADMIN_PASSCODE = "ssculpt2026";
const SESSION_KEY = "ssculpt_admin_session";

function isLoggedIn() {
  return sessionStorage.getItem(SESSION_KEY) === "yes";
}

function doLogin(passcode) {
  if (passcode === ADMIN_PASSCODE) {
    sessionStorage.setItem(SESSION_KEY, "yes");
    return true;
  }
  return false;
}

function doLogout() {
  sessionStorage.removeItem(SESSION_KEY);
  showLogin();
}

function showLogin() {
  document.getElementById("loginScreen").style.display = "flex";
  document.getElementById("adminShell").style.display = "none";
}

function showShell() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("adminShell").style.display = "grid";
  renderTreatments("sculpt");
  renderSpecials();
  renderStats();
  renderHours();
  renderBlockedDates();
  renderBookings();
}

// ---------- Toast ----------
let toastTimer = null;
function toast(message) {
  const el = document.getElementById("adminToast");
  el.textContent = message;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2200);
}

// ---------- Nav switching ----------
function switchPanel(panelKey) {
  document.querySelectorAll(".admin-panel").forEach((p) => {
    p.classList.toggle("is-active", p.dataset.panel === panelKey);
  });
  document.querySelectorAll(".admin-nav button").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.panel === panelKey);
  });
  if (panelKey === "export") renderExport();
}

// ---------- Treatments ----------
let activeTreatmentTab = "sculpt";

function renderTreatments(category) {
  activeTreatmentTab = category;
  document.querySelectorAll(".admin-tablist button").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.cat === category);
  });

  const list = document.getElementById("treatmentList");
  const items = DataStore.getTreatments(category);
  list.innerHTML = "";

  if (items.length === 0) {
    list.innerHTML = `<div class="admin-empty">No treatments in this category yet. Add one below.</div>`;
    return;
  }

  items.forEach((t) => {
    const card = document.createElement("div");
    card.className = `admin-card${t.active === false ? " is-inactive" : ""}`;
    card.innerHTML = `
      <div class="admin-card-body">
        <p class="admin-card-name">${escapeHtml(t.name)}${
          t.active === false ? '<span class="admin-pill">Hidden</span>' : '<span class="admin-pill is-on">Live</span>'
        }</p>
        <p class="admin-card-meta">R${Number(t.price).toLocaleString("en-ZA")}<span class="sep">&middot;</span>${escapeHtml(t.duration)}</p>
        <p class="admin-card-desc">${escapeHtml(t.desc || "")}</p>
      </div>
      <div class="admin-card-actions">
        <button class="btn btn-ghost btn-sm" data-action="edit-treatment" data-id="${t.id}">Edit</button>
        <button class="btn btn-ghost btn-sm" data-action="toggle-treatment" data-id="${t.id}">${t.active === false ? "Show" : "Hide"}</button>
        <button class="btn btn-ghost btn-sm" data-action="delete-treatment" data-id="${t.id}">Delete</button>
      </div>
    `;
    list.appendChild(card);
  });
}

function openTreatmentModal(id) {
  const isEdit = !!id;
  const t = isEdit ? DataStore.getTreatments().find((x) => x.id === id) : null;

  const modal = buildModal(`
    <h3>${isEdit ? "Edit treatment" : "Add treatment"}</h3>
    <label class="field-label">Category</label>
    <select class="field-select" id="mCategory">
      <option value="sculpt" ${t?.category === "sculpt" ? "selected" : ""}>Body sculpting</option>
      <option value="face" ${t?.category === "face" ? "selected" : ""}>Face rejuvenation</option>
    </select>

    <label class="field-label">Treatment name</label>
    <input class="field-input" id="mName" value="${t ? escapeAttr(t.name) : ""}" placeholder="e.g. Radio Frequency">

    <div class="admin-modal-row">
      <div>
        <label class="field-label">Price (R)</label>
        <input class="field-input" id="mPrice" type="number" min="0" step="1" value="${t ? t.price : ""}" placeholder="450">
      </div>
      <div>
        <label class="field-label">Session length (minutes)</label>
        <input class="field-input" id="mDuration" type="number" min="5" step="5" value="${t ? t.durationMinutes || "" : ""}" placeholder="120">
      </div>
    </div>

    <label class="field-label">Number of sessions in this package</label>
    <input class="field-input" id="mSessions" type="number" min="1" step="1" value="${t ? t.sessionsCount || 1 : 1}" placeholder="1">
    <p class="field-hint" style="margin-top:0.3rem;">Leave at 1 for a single visit. For a multi-session package (like the 6x sculpting package), each booking still only takes up one session's worth of calendar time — this number is for display only ("6 x 120 min").</p>

    <label class="field-label">Description</label>
    <textarea class="field-input" id="mDesc" placeholder="Short description shown on the treatment card">${t ? escapeHtml(t.desc || "") : ""}</textarea>

    <div class="admin-modal-actions">
      <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
      <button class="btn btn-primary" id="mSaveBtn">${isEdit ? "Save changes" : "Add treatment"}</button>
    </div>
  `);

  modal.querySelector("#mSaveBtn").addEventListener("click", () => {
    const name = modal.querySelector("#mName").value.trim();
    const price = modal.querySelector("#mPrice").value;
    const durationMinutes = modal.querySelector("#mDuration").value;
    const sessionsCount = modal.querySelector("#mSessions").value || 1;
    const desc = modal.querySelector("#mDesc").value.trim();
    const category = modal.querySelector("#mCategory").value;

    if (!name || !price || !durationMinutes) {
      toast("Please fill in name, price and session length.");
      return;
    }

    DataStore.saveTreatment({
      id: id || undefined,
      name,
      price: Number(price),
      durationMinutes: Number(durationMinutes),
      sessionsCount: Number(sessionsCount),
      desc,
      category,
      active: t ? t.active : true,
    });

    closeModal();
    renderTreatments(category);
    renderStats();
    toast(isEdit ? "Treatment updated." : "Treatment added.");
  });
}

// ---------- Specials ----------
function renderSpecials() {
  const list = document.getElementById("specialList");
  const items = DataStore.getSpecials();
  list.innerHTML = "";

  if (items.length === 0) {
    list.innerHTML = `<div class="admin-empty">No specials yet. Add one below.</div>`;
    return;
  }

  items.forEach((s) => {
    const card = document.createElement("div");
    card.className = `admin-card${s.active === false ? " is-inactive" : ""}`;
    card.innerHTML = `
      <div class="admin-card-body">
        <p class="admin-card-name">${escapeHtml(s.title)}${
          s.active === false ? '<span class="admin-pill">Hidden</span>' : '<span class="admin-pill is-on">Live</span>'
        }</p>
        <p class="admin-card-desc">${escapeHtml(s.description || "")}</p>
      </div>
      <div class="admin-card-actions">
        <button class="btn btn-ghost btn-sm" data-action="edit-special" data-id="${s.id}">Edit</button>
        <button class="btn btn-ghost btn-sm" data-action="toggle-special" data-id="${s.id}">${s.active === false ? "Show" : "Hide"}</button>
        <button class="btn btn-ghost btn-sm" data-action="delete-special" data-id="${s.id}">Delete</button>
      </div>
    `;
    list.appendChild(card);
  });
}

function openSpecialModal(id) {
  const isEdit = !!id;
  const s = isEdit ? DataStore.getSpecials().find((x) => x.id === id) : null;

  const modal = buildModal(`
    <h3>${isEdit ? "Edit special" : "Add special"}</h3>
    <label class="field-label">Title</label>
    <input class="field-input" id="mTitle" value="${s ? escapeAttr(s.title) : ""}" placeholder="e.g. Slimming & Sculpting Promo">

    <label class="field-label">Description</label>
    <textarea class="field-input" id="mSDesc" placeholder="What the special offers">${s ? escapeHtml(s.description || "") : ""}</textarea>

    <div class="admin-modal-actions">
      <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
      <button class="btn btn-primary" id="mSpecialSaveBtn">${isEdit ? "Save changes" : "Add special"}</button>
    </div>
  `);

  modal.querySelector("#mSpecialSaveBtn").addEventListener("click", () => {
    const title = modal.querySelector("#mTitle").value.trim();
    const description = modal.querySelector("#mSDesc").value.trim();

    if (!title) {
      toast("Please give the special a title.");
      return;
    }

    DataStore.saveSpecial({
      id: id || undefined,
      title,
      description,
      active: s ? s.active : true,
    });

    closeModal();
    renderSpecials();
    toast(isEdit ? "Special updated." : "Special added.");
  });
}

// ---------- Hours ----------
function renderHours() {
  const grid = document.getElementById("hoursGrid");
  const hours = ScheduleStore.getHours();
  grid.innerHTML = "";

  // Order Monday-first for a more natural business view, Sunday last.
  const order = [1, 2, 3, 4, 5, 6, 0];

  order.forEach((day) => {
    const h = hours[day] || { open: false, start: "09:00", end: "17:00" };
    const row = document.createElement("div");
    row.className = "admin-card";
    row.style.marginBottom = "0.5rem";
    row.innerHTML = `
      <div class="admin-card-body" style="display:flex; align-items:center; gap:1rem; flex-wrap:wrap;">
        <label class="field-checkbox" style="margin:0; min-width:120px;">
          <input type="checkbox" data-day="${day}" class="dayOpenToggle" ${h.open ? "checked" : ""}>
          <span><strong>${ScheduleStore.WEEKDAY_LABELS[day]}</strong></span>
        </label>
        <input type="time" class="field-input dayStart" data-day="${day}" value="${h.start}" style="width:130px;" ${h.open ? "" : "disabled"}>
        <span>to</span>
        <input type="time" class="field-input dayEnd" data-day="${day}" value="${h.end}" style="width:130px;" ${h.open ? "" : "disabled"}>
        ${!h.open ? '<span class="admin-pill">Closed</span>' : ""}
      </div>
    `;
    grid.appendChild(row);
  });

  document.getElementById("slotIntervalInput").value = String(ScheduleStore.getSlotInterval());
}

function saveDayFromRow(day) {
  const openEl = document.querySelector(`.dayOpenToggle[data-day="${day}"]`);
  const startEl = document.querySelector(`.dayStart[data-day="${day}"]`);
  const endEl = document.querySelector(`.dayEnd[data-day="${day}"]`);
  if (!openEl) return;

  if (endEl.value <= startEl.value) {
    toast("Closing time must be after opening time.");
    renderHours();
    return;
  }

  ScheduleStore.setDayHours(Number(day), {
    open: openEl.checked,
    start: startEl.value,
    end: endEl.value,
  });
  renderHours();
  toast("Hours updated.");
}

// ---------- Blocked dates ----------
function renderBlockedDates() {
  const list = document.getElementById("blockedDateList");
  const dates = ScheduleStore.getBlockedDates();
  list.innerHTML = "";

  if (dates.length === 0) {
    list.innerHTML = `<div class="admin-empty">No blocked dates yet.</div>`;
    return;
  }

  dates.forEach((d) => {
    const row = document.createElement("div");
    row.className = "admin-card";
    const label = new Date(d + "T00:00:00").toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
    row.innerHTML = `
      <div class="admin-card-body"><p class="admin-card-name" style="font-size:0.95rem;">${label}</p></div>
      <div class="admin-card-actions">
        <button class="btn btn-ghost btn-sm" data-action="unblock-date" data-date="${d}">Remove</button>
      </div>
    `;
    list.appendChild(row);
  });
}

// ---------- Bookings ----------
function renderBookings() {
  const list = document.getElementById("bookingList");
  const bookings = ScheduleStore.getAllBookings();
  list.innerHTML = "";

  if (bookings.length === 0) {
    list.innerHTML = `<div class="admin-empty">No bookings yet. They'll appear here as customers book through the site.</div>`;
    return;
  }

  bookings.forEach((b) => {
    const dateLabel = new Date(b.date + "T00:00:00").toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
    const isCancelled = b.status === "cancelled";
    const card = document.createElement("div");
    card.className = `admin-card${isCancelled ? " is-inactive" : ""}`;
    card.innerHTML = `
      <div class="admin-card-body">
        <p class="admin-card-name">${escapeHtml(b.treatmentName || "Treatment")}${
          isCancelled ? '<span class="admin-pill">Cancelled</span>' : '<span class="admin-pill is-on">Confirmed</span>'
        }</p>
        <p class="admin-card-meta">${dateLabel}<span class="sep">&middot;</span>${b.time}<span class="sep">&middot;</span>R${Number(b.total || 0).toLocaleString("en-ZA")}</p>
        <p class="admin-card-desc">${escapeHtml(b.name || "")} &middot; ${escapeHtml(b.phone || "")}</p>
      </div>
      <div class="admin-card-actions">
        ${!isCancelled ? `<button class="btn btn-ghost btn-sm" data-action="cancel-booking" data-id="${b.id}">Cancel</button>` : ""}
      </div>
    `;
    list.appendChild(card);
  });
}


function renderStats() {
  const treatments = DataStore.getTreatments();
  const specials = DataStore.getSpecials();
  const bookings = typeof ScheduleStore !== "undefined" ? ScheduleStore.getAllBookings() : [];
  document.getElementById("statTreatments").textContent = treatments.filter((t) => t.active !== false).length;
  document.getElementById("statSpecials").textContent = specials.filter((s) => s.active !== false).length;
  document.getElementById("statBookings").textContent = bookings.filter((b) => b.status !== "cancelled").length;
}

// ---------- Export ----------
function renderExport() {
  document.getElementById("exportBox").textContent = DataStore.exportAsConfigJs();
}

function copyExport() {
  const text = DataStore.exportAsConfigJs();
  navigator.clipboard.writeText(text).then(
    () => toast("Copied — paste into js/config.js"),
    () => toast("Couldn't copy automatically, please select and copy manually.")
  );
}

// ---------- Modal helpers ----------
function buildModal(innerHtml) {
  closeModal();
  const overlay = document.createElement("div");
  overlay.className = "admin-modal-overlay";
  overlay.id = "modalOverlay";
  overlay.innerHTML = `<div class="admin-modal">${innerHtml}</div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  return overlay;
}

function closeModal() {
  const existing = document.getElementById("modalOverlay");
  if (existing) existing.remove();
}

// ---------- Escaping helpers ----------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

// ---------- Wire up ----------
document.addEventListener("DOMContentLoaded", () => {
  // Login
  const loginForm = document.getElementById("loginForm");
  if (isLoggedIn()) {
    showShell();
  } else {
    showLogin();
  }

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = document.getElementById("passcodeInput").value;
    const errEl = document.getElementById("loginError");
    if (doLogin(val)) {
      errEl.textContent = "";
      showShell();
    } else {
      errEl.textContent = "Incorrect passcode. Try again.";
    }
  });

  // Sidebar nav
  document.querySelectorAll(".admin-nav button").forEach((btn) => {
    btn.addEventListener("click", () => switchPanel(btn.dataset.panel));
  });

  document.getElementById("logoutBtn").addEventListener("click", doLogout);

  // Treatment tabs
  document.querySelectorAll(".admin-tablist button").forEach((btn) => {
    btn.addEventListener("click", () => renderTreatments(btn.dataset.cat));
  });

  document.getElementById("addTreatmentBtn").addEventListener("click", () => openTreatmentModal(null));
  document.getElementById("addSpecialBtn").addEventListener("click", () => openSpecialModal(null));
  document.getElementById("copyExportBtn").addEventListener("click", copyExport);

  // Hours panel
  document.getElementById("hoursGrid").addEventListener("change", (e) => {
    const day = e.target.dataset.day;
    if (day === undefined) return;
    if (e.target.classList.contains("dayOpenToggle")) {
      // Toggle open state immediately, enable/disable time inputs, then save.
      const startEl = document.querySelector(`.dayStart[data-day="${day}"]`);
      const endEl = document.querySelector(`.dayEnd[data-day="${day}"]`);
      startEl.disabled = !e.target.checked;
      endEl.disabled = !e.target.checked;
      saveDayFromRow(day);
    } else {
      saveDayFromRow(day);
    }
  });

  document.getElementById("slotIntervalInput").addEventListener("change", (e) => {
    ScheduleStore.setSlotInterval(e.target.value);
    toast("Slot length updated.");
  });

  document.getElementById("addBlockDateBtn").addEventListener("click", () => {
    const input = document.getElementById("blockDateInput");
    if (!input.value) {
      toast("Pick a date first.");
      return;
    }
    ScheduleStore.addBlockedDate(input.value);
    input.value = "";
    renderBlockedDates();
    toast("Date blocked.");
  });

  document.getElementById("resetDataBtn").addEventListener("click", () => {
    if (confirm("This resets all treatments, specials, hours and bookings back to defaults. Continue?")) {
      DataStore.resetToDefaults();
      ScheduleStore.resetToDefaults();
      renderTreatments(activeTreatmentTab);
      renderSpecials();
      renderStats();
      renderHours();
      renderBlockedDates();
      renderBookings();
      toast("Data reset to defaults.");
    }
  });

  // Delegated clicks for card actions + modal close
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;

    switch (btn.dataset.action) {
      case "edit-treatment":
        openTreatmentModal(id);
        break;
      case "delete-treatment":
        if (confirm("Delete this treatment? This can't be undone.")) {
          DataStore.deleteTreatment(id);
          renderTreatments(activeTreatmentTab);
          renderStats();
          toast("Treatment deleted.");
        }
        break;
      case "toggle-treatment":
        DataStore.toggleTreatmentActive(id);
        renderTreatments(activeTreatmentTab);
        renderStats();
        break;
      case "edit-special":
        openSpecialModal(id);
        break;
      case "delete-special":
        if (confirm("Delete this special? This can't be undone.")) {
          DataStore.deleteSpecial(id);
          renderSpecials();
          toast("Special deleted.");
        }
        break;
      case "toggle-special":
        DataStore.toggleSpecialActive(id);
        renderSpecials();
        break;
      case "close-modal":
        closeModal();
        break;
      case "unblock-date":
        ScheduleStore.removeBlockedDate(btn.dataset.date);
        renderBlockedDates();
        toast("Date unblocked.");
        break;
      case "cancel-booking":
        if (confirm("Cancel this booking? The slot will become available again.")) {
          ScheduleStore.cancelBooking(id);
          renderBookings();
          renderStats();
          toast("Booking cancelled.");
        }
        break;
    }
  });
});
