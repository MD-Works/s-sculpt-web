// ============================================
// ADMIN CONSOLE LOGIC
// ------------------------------------------------
// All data calls are now real, async Supabase requests
// (TreatmentStore, DataStore, ScheduleStore). Function names
// and markup are unchanged from the localStorage version —
// every render function is now `async` and awaited at its
// call site, since a real database round-trip can't be
// synchronous the way localStorage was.
// ============================================

// ---------- Auth (real Supabase Auth) ----------
// One admin user (her), created once in Supabase Dashboard ->
// Authentication -> Users -> Add user. Sign-in here gets a real
// JWT with role "authenticated", which is what every admin RLS
// policy in schema.sql checks for.
function isLoggedIn() {
  return !!currentSession;
}

let currentSession = null;

async function doLogin(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return error.message;
  currentSession = data.session;
  return null;
}

async function doLogout() {
  await sb.auth.signOut();
  currentSession = null;
  showLogin();
}

function showLogin() {
  document.getElementById("loginScreen").style.display = "flex";
  document.getElementById("adminShell").style.display = "none";
}

async function showShell() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("adminShell").style.display = "grid";
  await Promise.all([renderTreatments("sculpt"), renderSpecials(), renderHours(), renderBlockedDates(), renderBookings(), renderVouchers()]);
  initVoucherAdmin();
  await renderStats();
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
}

// ---------- Treatments ----------
let activeTreatmentTab = "sculpt";

async function renderTreatments(category) {
  activeTreatmentTab = category;
  document.querySelectorAll(".admin-tablist button").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.cat === category);
  });

  const list = document.getElementById("treatmentList");
  list.innerHTML = `<div class="admin-empty">Loading…</div>`;
  const items = await TreatmentStore.getTreatments(category);
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

async function openTreatmentModal(id) {
  const isEdit = !!id;
  const t = isEdit ? (await TreatmentStore.getTreatments()).find((x) => x.id === id) : null;

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

  modal.querySelector("#mSaveBtn").addEventListener("click", async () => {
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

    const saveBtn = modal.querySelector("#mSaveBtn");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    const result = await TreatmentStore.saveTreatment({
      id: id || undefined,
      name,
      price: Number(price),
      durationMinutes: Number(durationMinutes),
      sessionsCount: Number(sessionsCount),
      desc,
      category,
      active: t ? t.active : true,
    });

    if (!result) {
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? "Save changes" : "Add treatment";
      toast("Couldn't save — check you're logged in as admin (see Database panel).");
      return;
    }

    closeModal();
    await renderTreatments(category);
    await renderStats();
    toast(isEdit ? "Treatment updated." : "Treatment added.");
  });
}

// ---------- Specials ----------
// Schema's `specials` table has a single `message` column (the homepage
// ticker just shows "✦ message"), so this is one field, not title+description.
async function renderSpecials() {
  const list = document.getElementById("specialList");
  list.innerHTML = `<div class="admin-empty">Loading…</div>`;
  const items = await DataStore.getSpecials();
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
        <p class="admin-card-name">${escapeHtml(s.message)}${
          s.active === false ? '<span class="admin-pill">Hidden</span>' : '<span class="admin-pill is-on">Live</span>'
        }</p>
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

async function openSpecialModal(id) {
  const isEdit = !!id;
  const s = isEdit ? (await DataStore.getSpecials()).find((x) => x.id === id) : null;

  const modal = buildModal(`
    <h3>${isEdit ? "Edit special" : "Add special"}</h3>
    <label class="field-label">Ticker message</label>
    <textarea class="field-input" id="mSDesc" placeholder="e.g. R2500 for 6x 120min sessions per body area">${s ? escapeHtml(s.message || "") : ""}</textarea>
    <p class="field-hint" style="margin-top:0.3rem;">Shown on the homepage scrolling ticker as "✦ your message".</p>

    <div class="admin-modal-actions">
      <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
      <button class="btn btn-primary" id="mSpecialSaveBtn">${isEdit ? "Save changes" : "Add special"}</button>
    </div>
  `);

  modal.querySelector("#mSpecialSaveBtn").addEventListener("click", async () => {
    const message = modal.querySelector("#mSDesc").value.trim();

    if (!message) {
      toast("Please write the ticker message.");
      return;
    }

    const saveBtn = modal.querySelector("#mSpecialSaveBtn");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    const result = await DataStore.saveSpecial({ id: id || undefined, message });

    if (!result) {
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? "Save changes" : "Add special";
      toast("Couldn't save — check you're logged in as admin (see Database panel).");
      return;
    }

    closeModal();
    await renderSpecials();
    toast(isEdit ? "Special updated." : "Special added.");
  });
}

// ---------- Hours ----------
async function renderHours() {
  const grid = document.getElementById("hoursGrid");
  grid.innerHTML = `<div class="admin-empty">Loading…</div>`;
  const hours = await ScheduleStore.getHours();
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

  document.getElementById("slotIntervalInput").value = String(await ScheduleStore.getSlotInterval());
}

async function saveDayFromRow(day) {
  const openEl = document.querySelector(`.dayOpenToggle[data-day="${day}"]`);
  const startEl = document.querySelector(`.dayStart[data-day="${day}"]`);
  const endEl = document.querySelector(`.dayEnd[data-day="${day}"]`);
  if (!openEl) return;

  if (endEl.value <= startEl.value) {
    toast("Closing time must be after opening time.");
    await renderHours();
    return;
  }

  await ScheduleStore.setDayHours(Number(day), {
    open: openEl.checked,
    start: startEl.value,
    end: endEl.value,
  });
  await renderHours();
  toast("Hours updated.");
}

// ---------- Blocked dates ----------
async function renderBlockedDates() {
  const list = document.getElementById("blockedDateList");
  list.innerHTML = `<div class="admin-empty">Loading…</div>`;
  const dates = await ScheduleStore.getBlockedDates();
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
async function renderBookings() {
  const list = document.getElementById("bookingList");
  list.innerHTML = `<div class="admin-empty">Loading…</div>`;
  const bookings = await ScheduleStore.getAllBookings();
  list.innerHTML = "";

  if (bookings.length === 0) {
    list.innerHTML = `<div class="admin-empty">No bookings yet. They'll appear here as customers book through the site.</div>`;
    return;
  }

  function buildCard(b) {
    const dateLabel = new Date(b.date + "T00:00:00").toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
    const isCancelled = b.status === "cancelled";
    const isPaid = b.payment_status === "paid";
    const card = document.createElement("div");
    card.className = `admin-card${isCancelled ? " is-inactive" : ""}`;
    let pills = "";
    if (isCancelled) {
      pills = '<span class="admin-pill">Cancelled</span>';
    } else {
      pills = '<span class="admin-pill is-on">Confirmed</span>';
      if (isPaid) pills += ' <span class="admin-pill is-on" style="background:var(--clr-accent-2,#2d7a4f);margin-left:4px">Paid</span>';
    }
    card.innerHTML = `
      <div class="admin-card-body">
        <p class="admin-card-name">${escapeHtml(b.treatmentName || "Treatment")}${pills}</p>
        <p class="admin-card-meta">${dateLabel}<span class="sep">&middot;</span>${b.time}<span class="sep">&middot;</span>R${Number(b.total || 0).toLocaleString("en-ZA")}</p>
        <p class="admin-card-desc">${escapeHtml(b.name || "")} &middot; ${escapeHtml(b.phone || "")}</p>
      </div>
      <div class="admin-card-actions">
        ${!isCancelled ? `<button class="btn btn-ghost btn-sm" data-action="cancel-booking" data-id="${b.id}">Cancel</button>` : ""}
      </div>
    `;
    return card;
  }

  const active = bookings.filter((b) => b.status !== "cancelled");
  const cancelled = bookings.filter((b) => b.status === "cancelled");

  // Active bookings (most recent first — sorted by the query already)
  if (active.length === 0) {
    const empty = document.createElement("div");
    empty.className = "admin-empty";
    empty.textContent = "No upcoming bookings.";
    list.appendChild(empty);
  } else {
    active.forEach((b) => list.appendChild(buildCard(b)));
  }

  // Cancelled bookings — collapsible section, collapsed by default
  if (cancelled.length > 0) {
    const section = document.createElement("div");
    section.style.marginTop = "1.5rem";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-ghost btn-sm";
    toggle.style.cssText = "width:100%;text-align:left;color:var(--clr-text-muted,#888);font-size:0.85rem;padding:0.5rem 0;border-top:1px solid var(--clr-border,#e5d9c8)";
    toggle.textContent = `▶  ${cancelled.length} cancelled booking${cancelled.length === 1 ? "" : "s"} — click to show`;

    const inner = document.createElement("div");
    inner.hidden = true;
    cancelled.forEach((b) => inner.appendChild(buildCard(b)));

    toggle.addEventListener("click", () => {
      inner.hidden = !inner.hidden;
      toggle.textContent = inner.hidden
        ? `▶  ${cancelled.length} cancelled booking${cancelled.length === 1 ? "" : "s"} — click to show`
        : `▼  ${cancelled.length} cancelled booking${cancelled.length === 1 ? "" : "s"} — click to hide`;
    });

    section.appendChild(toggle);
    section.appendChild(inner);
    list.appendChild(section);
  }
}


async function renderVouchers() {
  const list = document.getElementById("voucherAdminList");
  if (!list) return;
  list.innerHTML = `<div class="admin-empty">Loading…</div>`;

  const { data, error } = await sb
    .from("vouchers")
    .select("*")
    .order("created_at", { ascending: false });

  if (error || !data) {
    list.innerHTML = `<div class="admin-empty">Could not load vouchers.</div>`;
    return;
  }
  if (data.length === 0) {
    list.innerHTML = `<div class="admin-empty">No vouchers yet. Generate one above after receiving payment.</div>`;
    return;
  }

  const active = data.filter((v) => !v.is_redeemed);
  const redeemed = data.filter((v) => v.is_redeemed);

  list.innerHTML = "";

  function buildVoucherCard(v) {
    const card = document.createElement("div");
    card.className = `admin-card${v.is_redeemed ? " is-inactive" : ""}`;
    const created = new Date(v.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
    card.innerHTML = `
      <div class="admin-card-body">
        <p class="admin-card-name">
          ${escapeHtml(v.code)}
          ${v.is_redeemed
            ? '<span class="admin-pill">Redeemed</span>'
            : '<span class="admin-pill is-on">Active</span>'}
        </p>
        <p class="admin-card-meta">
          R${Number(v.amount || 0).toLocaleString("en-ZA")}
          ${v.recipient_name ? `<span class="sep">&middot;</span> For ${escapeHtml(v.recipient_name)}` : ""}
          ${v.sender_name ? `<span class="sep">&middot;</span> From ${escapeHtml(v.sender_name)}` : ""}
        </p>
        <p class="admin-card-desc">Created ${created}</p>
      </div>
      <div class="admin-card-actions">
        <button class="btn btn-ghost btn-sm" data-action="copy-voucher-code" data-code="${escapeHtml(v.code)}">Copy code</button>
      </div>
    `;
    return card;
  }

  active.forEach((v) => list.appendChild(buildVoucherCard(v)));

  if (redeemed.length > 0) {
    const section = document.createElement("div");
    section.style.marginTop = "1.5rem";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-ghost btn-sm";
    toggle.style.cssText = "width:100%;text-align:left;color:var(--clr-text-muted,#888);font-size:0.85rem;padding:0.5rem 0;border-top:1px solid var(--clr-border,#e5d9c8)";
    toggle.textContent = `▶  ${redeemed.length} redeemed voucher${redeemed.length === 1 ? "" : "s"} — click to show`;
    const inner = document.createElement("div");
    inner.hidden = true;
    redeemed.forEach((v) => inner.appendChild(buildVoucherCard(v)));
    toggle.addEventListener("click", () => {
      inner.hidden = !inner.hidden;
      toggle.textContent = inner.hidden
        ? `▶  ${redeemed.length} redeemed voucher${redeemed.length === 1 ? "" : "s"} — click to show`
        : `▼  ${redeemed.length} redeemed voucher${redeemed.length === 1 ? "" : "s"} — click to hide`;
    });
    section.appendChild(toggle);
    section.appendChild(inner);
    list.appendChild(section);
  }
}

function generateVoucherCode() {
  const words = ["GLOW","SILK","ROSE","SCULPT","GOLD","BLOOM","LIFT","LUXE","SOFT","SHINE"];
  const w1 = words[Math.floor(Math.random() * words.length)];
  const w2 = words[Math.floor(Math.random() * words.length)];
  const num = String(Math.floor(Math.random() * 900) + 100);
  return `SCULPT-${w1}-${w2}-${num}`;
}

async function initVoucherAdmin() {
  const generateBtn = document.getElementById("vAdminGenerateBtn");
  const feedback = document.getElementById("vAdminFeedback");
  if (!generateBtn) return;

  generateBtn.addEventListener("click", async () => {
    const amount = Number(document.getElementById("vAdminAmount").value);
    const to = document.getElementById("vAdminTo").value.trim();
    const from = document.getElementById("vAdminFrom").value.trim();
    const msg = document.getElementById("vAdminMsg").value.trim();

    if (!amount || amount < 50) {
      feedback.style.color = "#b3543f";
      feedback.textContent = "Please enter a valid amount (minimum R50).";
      return;
    }
    if (!to) {
      feedback.style.color = "#b3543f";
      feedback.textContent = "Please enter the recipient\'s name.";
      return;
    }

    generateBtn.disabled = true;
    generateBtn.textContent = "Generating…";
    feedback.textContent = "";

    const code = generateVoucherCode();
    const { error } = await sb.from("vouchers").insert({
      code,
      amount,
      recipient_name: to,
      sender_name: from || null,
      message: msg || null,
      is_redeemed: false,
    });

    generateBtn.disabled = false;
    generateBtn.textContent = "Generate voucher code";

    if (error) {
      feedback.style.color = "#b3543f";
      feedback.textContent = "Something went wrong — please try again.";
      return;
    }

    feedback.style.color = "var(--clr-accent)";
    feedback.textContent = `✓ Voucher created: ${code}  —  copy this code and share it with ${to}.`;

    // Clear the form
    document.getElementById("vAdminAmount").value = "";
    document.getElementById("vAdminTo").value = "";
    document.getElementById("vAdminFrom").value = "";
    document.getElementById("vAdminMsg").value = "";

    await renderVouchers();
  });
}

async function renderStats() {
  const [treatments, specials, bookings] = await Promise.all([
    TreatmentStore.getTreatments(),
    DataStore.getSpecials(),
    ScheduleStore.getAllBookings(),
  ]);
  document.getElementById("statTreatments").textContent = treatments.filter((t) => t.active !== false).length;
  document.getElementById("statSpecials").textContent = specials.filter((s) => s.active !== false).length;
  document.getElementById("statBookings").textContent = bookings.filter((b) => b.status !== "cancelled").length;
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
document.addEventListener("DOMContentLoaded", async () => {
  // Login — check for an existing real Supabase session first.
  const loginForm = document.getElementById("loginForm");
  const { data } = await sb.auth.getSession();
  if (data.session) {
    currentSession = data.session;
    showShell();
  } else {
    showLogin();
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("emailInput").value.trim();
    const password = document.getElementById("passcodeInput").value;
    const errEl = document.getElementById("loginError");
    const submitBtn = loginForm.querySelector('button[type="submit"]');

    submitBtn.disabled = true;
    const errorMsg = await doLogin(email, password);
    submitBtn.disabled = false;

    if (!errorMsg) {
      errEl.textContent = "";
      showShell();
    } else {
      errEl.textContent = "Login failed — check your email and password.";
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

  document.getElementById("slotIntervalInput").addEventListener("change", async (e) => {
    await ScheduleStore.setSlotInterval(e.target.value);
    toast("Slot length updated.");
  });

  document.getElementById("addBlockDateBtn").addEventListener("click", async () => {
    const input = document.getElementById("blockDateInput");
    if (!input.value) {
      toast("Pick a date first.");
      return;
    }
    await ScheduleStore.addBlockedDate(input.value);
    input.value = "";
    await renderBlockedDates();
    toast("Date blocked.");
  });

  // Delegated clicks for card actions + modal close
  document.body.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;

    switch (btn.dataset.action) {
      case "edit-treatment":
        openTreatmentModal(id);
        break;
      case "delete-treatment":
        if (confirm("Delete this treatment? This can't be undone.")) {
          await TreatmentStore.deleteTreatment(id);
          await renderTreatments(activeTreatmentTab);
          await renderStats();
          toast("Treatment deleted.");
        }
        break;
      case "toggle-treatment":
        await TreatmentStore.toggleTreatmentActive(id);
        await renderTreatments(activeTreatmentTab);
        await renderStats();
        break;
      case "edit-special":
        openSpecialModal(id);
        break;
      case "delete-special":
        if (confirm("Delete this special? This can't be undone.")) {
          await DataStore.deleteSpecial(id);
          await renderSpecials();
          toast("Special deleted.");
        }
        break;
      case "copy-voucher-code":
        navigator.clipboard.writeText(e.target.dataset.code || "").then(() => toast("Code copied!")).catch(() => toast("Copy failed — select the code manually."));
        break;
      case "toggle-special":
        await DataStore.toggleSpecialActive(id);
        await renderSpecials();
        break;
      case "close-modal":
        closeModal();
        break;
      case "unblock-date":
        await ScheduleStore.removeBlockedDate(btn.dataset.date);
        await renderBlockedDates();
        toast("Date unblocked.");
        break;
      case "cancel-booking":
        if (confirm("Cancel this booking? The slot will become available again.")) {
          await ScheduleStore.cancelBooking(id);
          sb.functions.invoke("calendar-sync", { body: { booking_id: id, action: "cancel" } }).catch((err) => {
            console.error("Calendar event removal failed:", err);
          });
          await renderBookings();
          await renderStats();
          toast("Booking cancelled.");
        }
        break;
    }
  });
});
