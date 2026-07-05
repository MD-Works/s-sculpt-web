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
  initCustomersPanel();
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
    // Check if booking used a voucher (b.voucherId comes from normalizeBookingRow)
    const voucherLine = b.voucherId
      ? `<p class="admin-card-desc" style="color:var(--clr-accent)">&#127873; Voucher used${b.voucherDiscount ? ` · R${Number(b.voucherDiscount).toLocaleString("en-ZA")} off` : ""}</p>`
      : "";
    card.innerHTML = `
      <div class="admin-card-body">
        <p class="admin-card-name">${escapeHtml(b.treatmentName || "Treatment")}${pills}</p>
        <p class="admin-card-meta">${dateLabel}<span class="sep">&middot;</span>${b.time}<span class="sep">&middot;</span>R${Number(b.total || 0).toLocaleString("en-ZA")}</p>
        <p class="admin-card-desc">${escapeHtml(b.name || "")} &middot; ${escapeHtml(b.phone || "")}</p>
        ${voucherLine}
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
            : (v.balance_remaining !== null && v.balance_remaining !== undefined && Number(v.balance_remaining) < Number(v.amount))
              ? '<span class="admin-pill" style="background:#8B6000;color:#fff">Partial</span>'
              : '<span class="admin-pill is-on">Active</span>'}
        </p>
        <p class="admin-card-meta">
          ${(v.balance_remaining !== null && v.balance_remaining !== undefined && !v.is_redeemed)
            ? `R${Number(v.balance_remaining).toLocaleString("en-ZA")} remaining of R${Number(v.amount).toLocaleString("en-ZA")}`
            : `R${Number(v.amount).toLocaleString("en-ZA")}`
          }
          ${v.recipient_name ? `<span class="sep">&middot;</span> For ${escapeHtml(v.recipient_name)}` : ""}
          ${v.sender_name ? `<span class="sep">&middot;</span> From ${escapeHtml(v.sender_name)}` : ""}
        </p>
        <p class="admin-card-desc">Created ${created}${v.amount_used ? ` &middot; R${Number(v.amount_used).toLocaleString("en-ZA")} last used` : ""}</p>
      </div>
      <div class="admin-card-actions">
        <button class="btn btn-ghost btn-sm" data-action="copy-voucher-code"
          data-code="${escapeHtml(v.code)}"
          data-amount="${(v.balance_remaining !== null && v.balance_remaining !== undefined) ? v.balance_remaining : v.amount || 0}"
          data-recipient="${escapeHtml(v.recipient_name || '')}"
          data-sender="${escapeHtml(v.sender_name || '')}">Share / copy</button>
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


// ---- Voucher image generator ----
function generateVoucherImage({ code, amount, recipientName, senderName, message }) {
  const W = 900, H = 500;
  const canvas = document.getElementById("voucherCanvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const BROWN     = "#3D2B1F";
  const GOLD      = "#C9A24B";
  const GOLD_LIGHT = "#E8C97A";
  const CREAM     = "#FAF6F0";
  const MID       = "#7A5C3E";

  // Background
  ctx.fillStyle = BROWN;
  ctx.fillRect(0, 0, W, H);

  // Subtle diagonal texture lines
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1;
  for (let i = -H; i < W + H; i += 28) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + H, H);
    ctx.stroke();
  }
  ctx.restore();

  // Gold border frame
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(22, 22, W - 44, H - 44);

  // Inner hairline
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 0.8;
  ctx.globalAlpha = 0.45;
  ctx.strokeRect(30, 30, W - 60, H - 60);
  ctx.globalAlpha = 1;

  // Gold accent bar — left side
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, GOLD_LIGHT);
  grd.addColorStop(0.5, GOLD);
  grd.addColorStop(1, "#8B6820");
  ctx.fillStyle = grd;
  ctx.fillRect(22, 22, 6, H - 44);

  // Brand name — top left
  ctx.fillStyle = GOLD;
  ctx.font = "600 22px 'Fraunces', Georgia, serif";
  ctx.letterSpacing = "0.08em";
  ctx.fillText("S SCULPT", 54, 72);
  ctx.letterSpacing = "0em";

  // Eyebrow label — top right
  ctx.fillStyle = MID;
  ctx.font = "500 13px 'Space Mono', monospace";
  ctx.textAlign = "right";
  ctx.fillText("GIFT VOUCHER", W - 50, 72);
  ctx.textAlign = "left";

  // Divider line
  ctx.strokeStyle = GOLD;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(54, 88);
  ctx.lineTo(W - 50, 88);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // To: label
  ctx.fillStyle = MID;
  ctx.font = "500 13px 'Space Mono', monospace";
  ctx.fillText("FOR", 54, 128);

  // Recipient name
  const recipientDisplay = recipientName || "You";
  ctx.fillStyle = CREAM;
  ctx.font = "600 52px 'Fraunces', Georgia, serif";
  // Scale down if long
  let fontSize = 52;
  while (ctx.measureText(recipientDisplay).width > 480 && fontSize > 28) {
    fontSize -= 2;
    ctx.font = `600 ${fontSize}px 'Fraunces', Georgia, serif`;
  }
  ctx.fillText(recipientDisplay, 54, 186);

  // Optional message
  if (message) {
    ctx.fillStyle = "#C9BBA8";
    ctx.font = "italic 17px 'Fraunces', Georgia, serif";
    // Wrap message at ~54 chars
    const words = message.split(" ");
    let line = "", lines = [], maxW = 480;
    for (const word of words) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = word;
        if (lines.length >= 2) break;
      } else {
        line = test;
      }
    }
    lines.push(line);
    lines.slice(0, 2).forEach((l, i) => ctx.fillText(l + (i === 1 && lines.length > 2 ? "…" : ""), 54, 228 + i * 26));
  }

  // Amount — large, right aligned
  ctx.textAlign = "right";
  ctx.font = "600 82px 'Fraunces', Georgia, serif";
  ctx.fillStyle = GOLD_LIGHT;
  ctx.fillText(`R${Number(amount).toLocaleString("en-ZA")}`, W - 50, 200);
  ctx.textAlign = "left";

  // Horizontal divider
  ctx.strokeStyle = GOLD;
  ctx.globalAlpha = 0.2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(54, H - 148);
  ctx.lineTo(W - 50, H - 148);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Code label
  ctx.fillStyle = MID;
  ctx.font = "500 11px 'Space Mono', monospace";
  ctx.letterSpacing = "0.12em";
  ctx.fillText("VOUCHER CODE", 54, H - 116);
  ctx.letterSpacing = "0em";

  // Code value — monospaced, gold pill background
  const codeFontSize = 22;
  ctx.font = `700 ${codeFontSize}px 'Space Mono', monospace`;
  const codeW = ctx.measureText(code).width;
  const pillPad = 18, pillH = 40, pillY = H - 104;
  // Pill background
  ctx.fillStyle = "rgba(201,162,75,0.13)";
  roundRect(ctx, 50, pillY, codeW + pillPad * 2, pillH, 6);
  ctx.fill();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.4;
  roundRect(ctx, 50, pillY, codeW + pillPad * 2, pillH, 6);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = GOLD_LIGHT;
  ctx.fillText(code, 50 + pillPad, pillY + 27);

  // From / footer
  const fromText = senderName ? `With love from ${senderName}  ·  ssculpt71@gmail.com` : "ssculpt71@gmail.com  ·  067 898 9347";
  ctx.fillStyle = MID;
  ctx.font = "13px 'Space Mono', monospace";
  ctx.textAlign = "right";
  ctx.fillText(fromText, W - 50, H - 42);
  ctx.textAlign = "left";
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function openVoucherModal(voucherData) {
  const modal = document.getElementById("voucherImageModal");
  modal.style.display = "flex";

  // Load Google Fonts and wait until they are actually ready before drawing
  if (!document.getElementById("gf-voucher")) {
    const link = document.createElement("link");
    link.id = "gf-voucher";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;1,9..144,400&family=Space+Mono:wght@400;700&display=swap";
    document.head.appendChild(link);
  }
  // document.fonts.ready resolves once all loaded fonts are available to canvas
  document.fonts.ready.then(() => generateVoucherImage(voucherData));

  document.getElementById("voucherModalClose").onclick = () => {
    modal.style.display = "none";
  };

  const redrawBtn = document.getElementById("voucherRedrawBtn");
  if (redrawBtn) redrawBtn.onclick = () => document.fonts.ready.then(() => generateVoucherImage(voucherData));
  modal.onclick = (e) => {
    if (e.target === modal) modal.style.display = "none";
  };

  document.getElementById("voucherDownloadBtn").onclick = () => {
    const canvas = document.getElementById("voucherCanvas");
    const a = document.createElement("a");
    a.download = `SSculpt-Voucher-${voucherData.code}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  };

  document.getElementById("voucherShareBtn").onclick = async () => {
    const canvas = document.getElementById("voucherCanvas");
    canvas.toBlob(async (blob) => {
      const file = new File([blob], `SSculpt-Voucher-${voucherData.code}.png`, { type: "image/png" });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: "S Sculpt Gift Voucher",
            text: `Your S Sculpt gift voucher code: ${voucherData.code}`,
            files: [file],
          });
        } catch (e) {
          if (e.name !== "AbortError") alert("Sharing failed — please use the Download button and attach the image manually.");
        }
      } else {
        // Fallback: open WhatsApp with the code in the text
        const msg = encodeURIComponent(`Hi! Here is your S Sculpt gift voucher 🎁\n\nCode: ${voucherData.code}\nValue: R${voucherData.amount}\n\nUse this code when booking at s-sculpt-web.pages.dev`);
        window.open(`https://wa.me/?text=${msg}`, "_blank");
      }
    }, "image/png");
  };
}


// ============================================================
// CUSTOMERS PANEL
// ============================================================

let currentCustomerPhone = null; // tracks which customer's drawer is open

async function renderCustomers(searchTerm = "") {
  const list = document.getElementById("customerList");
  if (!list) return;
  list.innerHTML = `<div class="admin-empty">Loading…</div>`;

  // Pull all bookings + loyalty balances to build customer profiles
  const [{ data: bookings, error: bErr }, { data: loyalty, error: lErr }] = await Promise.all([
    sb.from("bookings").select("customer_phone, customer_name, customer_email, booking_date, price_charged, status, voucher_id, voucher_discount, treatment_id, treatments(name)").order("booking_date", { ascending: false }),
    sb.from("loyalty_balances").select("customer_phone, customer_name, balance"),
  ]);

  if (bErr || lErr) {
    list.innerHTML = `<div class="admin-empty">Could not load customers.</div>`;
    return;
  }

  // Group bookings by phone to build one profile per customer
  const profileMap = {};
  for (const b of (bookings || [])) {
    const phone = b.customer_phone;
    if (!profileMap[phone]) {
      profileMap[phone] = {
        phone,
        name: b.customer_name,
        email: b.customer_email || null,
        bookings: [],
        totalSpend: 0,
        lastBooking: b.booking_date,
      };
    }
    const p = profileMap[phone];
    p.bookings.push(b);
    if (b.status !== "cancelled") p.totalSpend += Number(b.price_charged || 0);
    if (b.booking_date > p.lastBooking) {
      p.lastBooking = b.booking_date;
      p.name = b.customer_name; // use most recent name
      if (b.customer_email) p.email = b.customer_email;
    }
  }

  // Attach loyalty balance
  const loyaltyMap = {};
  for (const l of (loyalty || [])) loyaltyMap[l.customer_phone] = Number(l.balance || 0);

  let profiles = Object.values(profileMap)
    .map(p => ({ ...p, points: loyaltyMap[p.phone] || 0 }))
    .sort((a, b) => (b.lastBooking || "").localeCompare(a.lastBooking || ""));

  // Apply search filter
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    profiles = profiles.filter(p =>
      p.name.toLowerCase().includes(q) || p.phone.includes(q)
    );
  }

  list.innerHTML = "";

  if (profiles.length === 0) {
    list.innerHTML = `<div class="admin-empty">${searchTerm ? "No customers match that search." : "No customers yet."}</div>`;
    return;
  }

  profiles.forEach(p => {
    const lastDate = p.lastBooking
      ? new Date(p.lastBooking + "T00:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })
      : "—";
    const tier = p.points >= 500 ? "Gold" : p.points >= 200 ? "Silver" : "Bronze";
    const tierColour = p.points >= 500 ? "#C9A24B" : p.points >= 200 ? "#888" : "#8B6000";

    const card = document.createElement("div");
    card.className = "admin-card";
    card.style.cursor = "pointer";
    card.innerHTML = `
      <div class="admin-card-body">
        <p class="admin-card-name">${escapeHtml(p.name)}
          <span class="admin-pill" style="background:${tierColour};color:#fff;margin-left:6px">${tier}</span>
        </p>
        <p class="admin-card-meta">
          ${escapeHtml(p.phone)}
          ${p.email ? `<span class="sep">&middot;</span> ${escapeHtml(p.email)}` : ""}
        </p>
        <p class="admin-card-desc">
          ${p.bookings.length} booking${p.bookings.length === 1 ? "" : "s"}
          <span class="sep">&middot;</span> R${Number(p.totalSpend).toLocaleString("en-ZA")} total spend
          <span class="sep">&middot;</span> ${p.points} pts
          <span class="sep">&middot;</span> Last: ${lastDate}
        </p>
      </div>
      <div class="admin-card-actions">
        <button class="btn btn-ghost btn-sm" data-action="open-customer" data-phone="${escapeHtml(p.phone)}">View profile</button>
      </div>
    `;
    card.addEventListener("click", (e) => {
      if (!e.target.closest("button")) openCustomerDrawer(p.phone, profiles);
    });
    list.appendChild(card);
  });
}

async function openCustomerDrawer(phone, profiles) {
  currentCustomerPhone = phone;
  const profile = profiles.find(p => p.phone === phone);
  if (!profile) return;

  const drawer = document.getElementById("customerDrawer");
  drawer.hidden = false;
  drawer.style.display = "flex";

  // Header
  document.getElementById("drawerName").textContent = profile.name;
  document.getElementById("drawerMeta").textContent = `${profile.phone}${profile.email ? "  ·  " + profile.email : ""}`;

  // Stats
  const tier = profile.points >= 500 ? "Gold" : profile.points >= 200 ? "Silver" : "Bronze";
  const activeBookings = profile.bookings.filter(b => b.status !== "cancelled").length;
  document.getElementById("drawerStats").innerHTML = `
    <div style="padding:1rem;text-align:center;border-right:1px solid var(--clr-border,#e5d9c8)">
      <p style="font-size:1.4rem;font-weight:700;color:var(--clr-heading,#3D2B1F);margin:0">${activeBookings}</p>
      <p style="font-size:0.75rem;color:#888;margin:0">Bookings</p>
    </div>
    <div style="padding:1rem;text-align:center;border-right:1px solid var(--clr-border,#e5d9c8)">
      <p style="font-size:1.4rem;font-weight:700;color:var(--clr-heading,#3D2B1F);margin:0">R${Number(profile.totalSpend).toLocaleString("en-ZA")}</p>
      <p style="font-size:0.75rem;color:#888;margin:0">Total spend</p>
    </div>
    <div style="padding:1rem;text-align:center">
      <p style="font-size:1.4rem;font-weight:700;color:var(--clr-accent,#C9A24B);margin:0">${profile.points} pts</p>
      <p style="font-size:0.75rem;color:#888;margin:0">${tier}</p>
    </div>
  `;

  // Switch to bookings tab by default
  switchDrawerTab("bookings");

  // Render bookings tab
  const bookingList = document.getElementById("drawerBookingList");
  bookingList.innerHTML = "";
  const sorted = [...profile.bookings].sort((a, b) => (b.booking_date || "").localeCompare(a.booking_date || ""));
  sorted.forEach(b => {
    const dateLabel = b.booking_date
      ? new Date(b.booking_date + "T00:00:00").toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
      : "—";
    const isCancelled = b.status === "cancelled";
    const treatmentName = b.treatments?.name || "Treatment";
    const div = document.createElement("div");
    div.style.cssText = "padding:0.75rem;border:1px solid var(--clr-border,#e5d9c8);border-radius:8px;opacity:" + (isCancelled ? "0.5" : "1");
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <p style="font-weight:600;margin:0;font-size:0.9rem">${escapeHtml(treatmentName)}
            ${isCancelled ? '<span class="admin-pill" style="margin-left:4px">Cancelled</span>' : ""}
            ${b.voucher_id ? '<span style="font-size:0.8rem;color:var(--clr-accent,#C9A24B);margin-left:4px">&#127873; Voucher</span>' : ""}
          </p>
          <p style="margin:0.2rem 0 0;font-size:0.8rem;color:#888">${dateLabel}</p>
        </div>
        <p style="font-weight:700;margin:0;font-size:0.95rem;color:var(--clr-heading,#3D2B1F)">R${Number(b.price_charged || 0).toLocaleString("en-ZA")}</p>
      </div>
    `;
    bookingList.appendChild(div);
  });

  if (sorted.length === 0) {
    bookingList.innerHTML = `<p style="color:#888;font-size:0.9rem">No bookings found.</p>`;
  }

  // Load loyalty tab data
  const { data: txns } = await sb
    .from("loyalty_transactions")
    .select("*")
    .eq("customer_phone", phone)
    .order("created_at", { ascending: false });

  const loyaltyList = document.getElementById("drawerLoyaltyList");
  loyaltyList.innerHTML = "";
  if (!txns || txns.length === 0) {
    loyaltyList.innerHTML = `<p style="color:#888;font-size:0.9rem">No loyalty transactions yet.</p>`;
  } else {
    txns.forEach(t => {
      const date = new Date(t.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
      const isPositive = t.points_delta > 0;
      const reasonLabels = {
        booking: "Booking", instore_payment: "Walk-in payment", referral: "Referral",
        promotion: "Promotion", correction: "Correction", manual_adjustment: "Manual adjustment",
        redemption: "Redeemed",
      };
      const reasonLabel = reasonLabels[t.reason] || t.reason;
      const div = document.createElement("div");
      div.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid var(--clr-border,#e5d9c8)";
      div.innerHTML = `
        <div>
          <p style="margin:0;font-size:0.88rem;font-weight:600">${reasonLabel}</p>
          <p style="margin:0;font-size:0.78rem;color:#888">${date}${t.notes ? "  ·  " + escapeHtml(t.notes) : ""}</p>
        </div>
        <p style="margin:0;font-weight:700;font-size:0.95rem;color:${isPositive ? "var(--success,#3A6B35)" : "#b3543f"}">
          ${isPositive ? "+" : ""}${t.points_delta} pts
        </p>
      `;
      loyaltyList.appendChild(div);
    });
  }

  // Reset adjust form
  document.getElementById("adjPoints").value = "";
  document.getElementById("adjNotes").value = "";
  document.getElementById("adjFeedback").textContent = "";
  document.getElementById("adjSubmitBtn").textContent = "Add points";
}

function switchDrawerTab(tabName) {
  document.querySelectorAll(".drawer-tab").forEach(btn => {
    const active = btn.dataset.tab === tabName;
    btn.style.color = active ? "var(--clr-accent,#C9A24B)" : "#888";
    btn.style.borderBottomColor = active ? "var(--clr-accent,#C9A24B)" : "transparent";
    btn.style.fontWeight = active ? "600" : "400";
    btn.classList.toggle("is-active", active);
  });
  document.querySelectorAll(".drawer-tab-content").forEach(div => {
    div.hidden = div.id !== "tab" + tabName.charAt(0).toUpperCase() + tabName.slice(1);
  });
}

function initCustomersPanel() {
  // Search
  const search = document.getElementById("customerSearch");
  if (search) {
    let debounce;
    search.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => renderCustomers(search.value.trim()), 280);
    });
  }

  // Drawer close
  const drawer = document.getElementById("customerDrawer");
  document.getElementById("drawerClose")?.addEventListener("click", () => {
    drawer.hidden = true;
    drawer.style.display = "none";
    currentCustomerPhone = null;
  });
  drawer?.addEventListener("click", (e) => {
    if (e.target === drawer) {
      drawer.hidden = true;
      drawer.style.display = "none";
      currentCustomerPhone = null;
    }
  });

  // Drawer tabs
  document.querySelectorAll(".drawer-tab").forEach(btn => {
    btn.addEventListener("click", () => switchDrawerTab(btn.dataset.tab));
  });

  // Manual points adjustment
  document.getElementById("adjSubmitBtn")?.addEventListener("click", async () => {
    if (!currentCustomerPhone) return;
    const pointsVal = parseInt(document.getElementById("adjPoints").value);
    const reason = document.getElementById("adjReason").value;
    const notes = document.getElementById("adjNotes").value.trim();
    const feedback = document.getElementById("adjFeedback");

    if (!pointsVal || isNaN(pointsVal) || pointsVal === 0) {
      feedback.style.color = "#b3543f";
      feedback.textContent = "Enter a points value (positive to add, negative to deduct).";
      return;
    }

    document.getElementById("adjSubmitBtn").disabled = true;
    document.getElementById("adjSubmitBtn").textContent = "Saving…";

    // Get customer name from the drawer header
    const customerName = document.getElementById("drawerName").textContent;

    const { error } = await sb.from("loyalty_transactions").insert({
      customer_phone: currentCustomerPhone,
      customer_name: customerName,
      points_delta: pointsVal,
      reason,
      notes: notes || null,
      related_booking_id: null,
    });

    document.getElementById("adjSubmitBtn").disabled = false;
    document.getElementById("adjSubmitBtn").textContent = "Add points";

    if (error) {
      feedback.style.color = "#b3543f";
      feedback.textContent = "Something went wrong — please try again.";
      return;
    }

    feedback.style.color = "var(--success,#3A6B35)";
    feedback.textContent = `✓ ${pointsVal > 0 ? "+" : ""}${pointsVal} points saved.`;
    document.getElementById("adjPoints").value = "";
    document.getElementById("adjNotes").value = "";

    // Refresh the loyalty tab and customer list
    await renderCustomers(document.getElementById("customerSearch")?.value || "");
    // Re-open the drawer with fresh data
    const search = document.getElementById("customerSearch")?.value || "";
    const { data: bookings } = await sb.from("bookings").select("customer_phone, customer_name, customer_email, booking_date, price_charged, status, voucher_id, voucher_discount, treatment_id, treatments(name)").order("booking_date", { ascending: false });
    const { data: loyalty } = await sb.from("loyalty_balances").select("customer_phone, customer_name, balance");
    const profileMap = {};
    for (const b of (bookings || [])) {
      const phone = b.customer_phone;
      if (!profileMap[phone]) profileMap[phone] = { phone, name: b.customer_name, email: b.customer_email || null, bookings: [], totalSpend: 0, lastBooking: b.booking_date };
      const p = profileMap[phone];
      p.bookings.push(b);
      if (b.status !== "cancelled") p.totalSpend += Number(b.price_charged || 0);
    }
    const loyaltyMap = {};
    for (const l of (loyalty || [])) loyaltyMap[l.customer_phone] = Number(l.balance || 0);
    const profiles = Object.values(profileMap).map(p => ({ ...p, points: loyaltyMap[p.phone] || 0 }));
    openCustomerDrawer(currentCustomerPhone, profiles);
  });

  // open-customer action from card button
  document.getElementById("customerList")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action='open-customer']");
    if (btn) {
      // Drawer opened by card click — button click also fires, prevent double open
      e.stopPropagation();
    }
  });
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
    feedback.textContent = `✓ Voucher created: ${code}`;

    // Open the image modal for sharing
    openVoucherModal({
      code,
      amount,
      recipientName: to,
      senderName: from || null,
      message: msg || null,
    });

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
      case "open-customer":
        // handled by card click listener in initCustomersPanel
        break;
      case "copy-voucher-code":
        navigator.clipboard.writeText(e.target.dataset.code || "").then(() => toast("Code copied!")).catch(() => toast("Copy failed — select the code manually."));
        // Also open the image modal so she can share it visually
        openVoucherModal({
          code: e.target.dataset.code,
          amount: e.target.dataset.amount || "",
          recipientName: e.target.dataset.recipient || "",
          senderName: e.target.dataset.sender && e.target.dataset.sender !== e.target.dataset.recipient
            ? e.target.dataset.sender : null,
          message: null,
        });
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
