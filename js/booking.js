// ============================================
// BOOKING — multi-step form
// ------------------------------------------------
// Slot availability and treatment lookups are now async
// (real Supabase calls via schedule-store.js / services.js's
// findTreatment cache). Voucher codes are checked against the
// real `vouchers` table; a valid unredeemed voucher is applied
// as a discount and gets marked redeemed once the booking saves.
// ============================================
(function () {
  const form = document.getElementById("bookingForm");
  const steps = document.querySelectorAll(".bstep");
  const panels = document.querySelectorAll(".form-step");
  const treatmentSelect = document.getElementById("treatmentSelect");
  const treatmentHint = document.getElementById("treatmentHint");
  const dateInput = document.getElementById("dateInput");
  const timeSelect = document.getElementById("timeSelect");
  const nameInput = document.getElementById("nameInput");
  const phoneInput = document.getElementById("phoneInput");
  const emailInput = document.getElementById("emailInput");
  const whatsappOptIn = document.getElementById("whatsappOptIn");
  const bookingSummary = document.getElementById("bookingSummary");
  const voucherInput = document.getElementById("voucherInput");
  const applyVoucherBtn = document.getElementById("applyVoucherBtn");
  const voucherFeedback = document.getElementById("voucherFeedback");
  const bookingSuccess = document.getElementById("bookingSuccess");
  const bookingSuccessDetail = document.getElementById("bookingSuccessDetail");
  const successWhatsappBtn = document.getElementById("successWhatsappBtn");
  const newBookingBtn = document.getElementById("newBookingBtn");
  const confirmBookingBtn = document.getElementById("confirmBookingBtn");

  function resetBookingForm() {
    bookingSuccess.hidden = true;
    form.querySelector(".booking-steps").style.display = "";
    form.reset();
    appliedVoucher = null;
    if (voucherFeedback) voucherFeedback.textContent = "";
    window.history.replaceState({}, "", window.location.pathname);
    goToStep(1);
  }

  newBookingBtn.addEventListener("click", resetBookingForm);


  // Decides which payment method radios to show for the currently
  // selected treatment + price, based on the admin's global settings
  // and that treatment's own override (see schedule-store.js's
  // isInstoreAllowed for the combining rules).

  // Minimum bookable date = today (slots already in the past are filtered out)
  const today = new Date();
  dateInput.min = today.toISOString().split("T")[0];

  let currentStep = 1;
  let appliedDiscountAmount = 0; // rand amount, from a real applied voucher
  let appliedVoucherLabel = "";
  let appliedVoucher = null; // full voucher row once validated, so we can redeem it on submit

  function durationToMinutes(treatment) {
    if (treatment && treatment.durationMinutes) return Number(treatment.durationMinutes);
    const match = String(treatment && treatment.duration).match(/(\d+)\s*min/);
    return match ? Number(match[1]) : 60;
  }

  async function populateTimeSlots() {
    timeSelect.innerHTML = `<option value="" disabled selected>Loading times…</option>`;
    const t = window.findTreatment(treatmentSelect.value);
    if (!dateInput.value || !t) {
      timeSelect.innerHTML = `<option value="" disabled selected>Choose a date first</option>`;
      return;
    }

    const duration = durationToMinutes(t);
    const slots = await ScheduleStore.getOpenSlots(dateInput.value, duration, t ? t.id : null, t ? (t.stations || 1) : 1);

    timeSelect.innerHTML = `<option value="" disabled selected>Choose a time</option>`;
    if (slots.length === 0) {
      const opt = document.createElement("option");
      opt.disabled = true;
      opt.textContent = "No open slots this day — try another date";
      timeSelect.appendChild(opt);
      return;
    }

    slots.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      timeSelect.appendChild(opt);
    });
  }

  dateInput.addEventListener("change", populateTimeSlots);

  function goToStep(step) {
    currentStep = step;
    panels.forEach((p) => p.classList.toggle("is-active", Number(p.dataset.stepPanel) === step));
    steps.forEach((s) => {
      const n = Number(s.dataset.step);
      s.classList.toggle("is-active", n === step);
      s.classList.toggle("is-done", n < step);
    });
    if (step === 4) {
      renderSummary();
    }
  }

  document.querySelectorAll("[data-next]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!validateStep(currentStep)) return;
      goToStep(currentStep + 1);
    });
  });
  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => goToStep(currentStep - 1));
  });

  function validateStep(step) {
    if (step === 1 && !treatmentSelect.value) {
      treatmentSelect.reportValidity();
      return false;
    }
    if (step === 2 && (!dateInput.value || !timeSelect.value)) {
      (!dateInput.value ? dateInput : timeSelect).reportValidity();
      return false;
    }
    if (step === 3 && (!nameInput.value.trim() || !phoneInput.value.trim())) {
      (!nameInput.value.trim() ? nameInput : phoneInput).reportValidity();
      return false;
    }
    return true;
  }

  treatmentSelect.addEventListener("change", () => {
    const t = window.findTreatment(treatmentSelect.value);
    if (t) {
      treatmentHint.textContent = `${t.duration} · ${formatCurrency(t.price)} · ${t.desc}`;
    }
    populateTimeSlots();
  });

  function getPriceBreakdown() {
    const t = window.findTreatment(treatmentSelect.value);
    const base = t ? t.price : 0;
    // Cap the discount at the treatment price — a R600 voucher on a R450
    // treatment should show -R450 discount and R0 total, not -R600.
    const discountAmount = Math.min(appliedDiscountAmount, base);
    const total = Math.max(0, base - discountAmount);
    return { base, discountAmount, total, treatment: t };
  }

  function renderSummary() {
    const { base, discountAmount, total, treatment } = getPriceBreakdown();
    const dateLabel = dateInput.value
      ? new Date(dateInput.value).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" })
      : "—";

    bookingSummary.innerHTML = `
      <dl>
        <dt>Treatment</dt><dd>${treatment ? treatment.name : "—"}</dd>
        <dt>Date</dt><dd>${dateLabel}</dd>
        <dt>Time</dt><dd>${timeSelect.value || "—"}</dd>
        <dt>Name</dt><dd>${nameInput.value || "—"}</dd>
        <dt>Price</dt><dd>${formatCurrency(base)}</dd>
        ${discountAmount > 0 ? `<dt>${appliedVoucherLabel}</dt><dd>-${formatCurrency(discountAmount)}</dd>` : ""}
        <dt>Total</dt><dd>${formatCurrency(total)}</dd>
      </dl>
    `;
  }

  // ---- Voucher code (real lookup against the vouchers table) ----
  applyVoucherBtn.addEventListener("click", async () => {
    const code = voucherInput.value.trim().toUpperCase();
    if (!code) {
      voucherFeedback.textContent = "Enter a code first.";
      return;
    }

    applyVoucherBtn.disabled = true;
    voucherFeedback.textContent = "Checking code…";

    const { data, error } = await sb.from("vouchers").select("*").eq("code", code).maybeSingle();
    applyVoucherBtn.disabled = false;

    if (error || !data) {
      appliedDiscountAmount = 0;
      appliedVoucher = null;
      voucherFeedback.textContent = "Code not recognised. Check with the salon on WhatsApp.";
      voucherFeedback.style.color = "#b3543f";
      renderSummary();
      return;
    }

    if (data.is_redeemed) {
      appliedDiscountAmount = 0;
      appliedVoucher = null;
      voucherFeedback.textContent = "This voucher has already been used.";
      voucherFeedback.style.color = "#b3543f";
      renderSummary();
      return;
    }

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      appliedDiscountAmount = 0;
      appliedVoucher = null;
      voucherFeedback.textContent = "This voucher has expired.";
      voucherFeedback.style.color = "#b3543f";
      renderSummary();
      return;
    }

    appliedVoucher = data;
    // Use remaining balance if partially used, otherwise full amount
    const available = (data.balance_remaining !== null && data.balance_remaining !== undefined)
      ? Number(data.balance_remaining)
      : Number(data.amount);
    data._available = available;
    appliedDiscountAmount = available;
    appliedVoucherLabel = `Voucher (${code})`;
    voucherFeedback.textContent = `Voucher applied — ${formatCurrency(available)} available on this voucher.`;
    voucherFeedback.style.color = "var(--success)";
    renderSummary();
  });

  // ---- Submit ----
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateStep(3)) return;

    const { total, treatment } = getPriceBreakdown();

    confirmBookingBtn.disabled = true;
    confirmBookingBtn.textContent = "Booking…";

    const saved = await ScheduleStore.saveBooking({
      date: dateInput.value,
      time: timeSelect.value,
      treatmentId: treatment.id,
      treatmentName: treatment.name,
      name: nameInput.value.trim(),
      phone: phoneInput.value.trim(),
      email: emailInput.value.trim(),
      total,
      voucherId: appliedVoucher ? appliedVoucher.id : null,
      voucherDiscount: appliedVoucher ? getPriceBreakdown().discountAmount : null,
      paymentMethod: "instore",
      whatsappOptIn: whatsappOptIn.checked,
    });

    if (!saved) {
      confirmBookingBtn.disabled = false;
      confirmBookingBtn.textContent = "Confirm booking";
      voucherFeedback.textContent = "Something went wrong saving your booking — please try again or contact the salon on WhatsApp.";
      voucherFeedback.style.color = "#b3543f";
      return;
    }

    // Redeem the voucher — handle partial redemptions (e.g. R600 voucher on a R450 treatment).
    // IMPORTANT: use discountAmount (what was deducted from the price) not total (what
    // the customer actually pays — which could be R0, breaking the calculation entirely).
    if (appliedVoucher) {
      const { discountAmount } = getPriceBreakdown();
      const voucherAvailable = (appliedVoucher._available !== undefined)
        ? appliedVoucher._available
        : Number(appliedVoucher.amount);
      const amountUsed = discountAmount; // already capped at treatment price in getPriceBreakdown
      const balanceAfter = Math.max(0, voucherAvailable - amountUsed);
      const fullyUsed = balanceAfter <= 0;

      await sb
        .from("vouchers")
        .update({
          is_redeemed: fullyUsed,
          redeemed_booking_id: saved.id,
          redeemed_at: new Date().toISOString(),
          amount_used: amountUsed,
          balance_remaining: fullyUsed ? 0 : balanceAfter,
        })
        .eq("id", appliedVoucher.id);
    }

    // ---- Confirm immediately (instore only): same as before, confirm immediately ----
    const dateLabel = dateInput.value
      ? new Date(dateInput.value).toLocaleDateString("en-ZA", { day: "numeric", month: "long" })
      : "";

    confirmBookingBtn.disabled = false;
    confirmBookingBtn.textContent = "Confirm booking";

    // Earn loyalty points on the treatment's full base price, not the discounted
    // total — a R600 voucher on a R450 treatment should still earn 45 points.
    // Penalising customers for using a voucher would discourage them.
    const { base } = getPriceBreakdown();
    if (window.SSculptLoyalty && base > 0) {
      await window.SSculptLoyalty.addSpend(phoneInput.value.trim(), nameInput.value.trim(), base, saved.id);
    }

    // Push to her real Google Calendar. Best-effort: if this fails (e.g.
    // calendar not shared with the service account yet), the booking is
    // still saved in Supabase — we don't block the customer's confirmation
    // on a calendar sync issue she can fix later.
    sb.functions.invoke("calendar-sync", { body: { booking_id: saved.id } }).catch((err) => {
      console.error("Calendar sync failed (booking still saved):", err);
    });

    // Clear the URL params immediately so a page refresh doesn't re-show this screen
    window.history.replaceState({}, "", window.location.pathname);

    form.querySelector(".booking-steps").style.display = "none";
    panels.forEach((p) => p.classList.remove("is-active"));
    bookingSuccess.hidden = false;

    bookingSuccessDetail.textContent = `${treatment.name} on ${dateLabel} at ${timeSelect.value}, for ${formatCurrency(total)}. We'll confirm your slot shortly.`;

    if (whatsappOptIn.checked) {
      const msg = `Hi! I'd like to confirm my booking:\n${treatment.name}\n${dateLabel} at ${timeSelect.value}\nName: ${nameInput.value}\nTotal: ${formatCurrency(total)}`;
      successWhatsappBtn.href = waLink(msg);
      successWhatsappBtn.hidden = false;
    } else {
      successWhatsappBtn.hidden = true;
    }
  });

  goToStep(1);
})();
