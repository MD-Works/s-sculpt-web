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
  const confirmBookingBtn = document.getElementById("confirmBookingBtn");
  const payOptionsContainer = document.getElementById("payOptionsContainer");
  const payOptionsHint = document.getElementById("payOptionsHint");

  let cachedPaymentSettings = null;

  // Decides which payment method radios to show for the currently
  // selected treatment + price, based on the admin's global settings
  // and that treatment's own override (see schedule-store.js's
  // isInstoreAllowed for the combining rules).
  async function renderPaymentOptions() {
    if (!cachedPaymentSettings) {
      cachedPaymentSettings = await ScheduleStore.getPaymentSettings();
    }
    const { total, treatment } = getPriceBreakdown();
    const instoreAllowed = ScheduleStore.isInstoreAllowed(cachedPaymentSettings, treatment, total);

    payOptionsContainer.innerHTML = `
      <label class="pay-option">
        <input type="radio" name="payMethod" value="card" checked>
        <span>Pay online now (card / Instant EFT via PayFast)</span>
      </label>
      ${
        instoreAllowed
          ? `<label class="pay-option">
              <input type="radio" name="payMethod" value="instore">
              <span>Pay in salon</span>
            </label>`
          : ""
      }
    `;

    if (!instoreAllowed) {
      payOptionsHint.textContent = "Online payment is required for this booking.";
    } else {
      payOptionsHint.textContent = "Card payments are processed securely via PayFast.";
    }
  }

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
    const slots = await ScheduleStore.getOpenSlots(dateInput.value, duration);

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
      renderPaymentOptions();
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
    const total = Math.max(0, base - appliedDiscountAmount);
    return { base, discountAmount: appliedDiscountAmount, total, treatment: t };
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
    appliedDiscountAmount = Number(data.amount);
    appliedVoucherLabel = `Voucher (${code})`;
    voucherFeedback.textContent = `Voucher applied — ${formatCurrency(data.amount)} off this booking.`;
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

    const paymentMethod = form.querySelector('input[name="payMethod"]:checked')?.value || "card";

    // Voucher that covers the full price needs no payment step either way —
    // treat it like an instore booking (nothing to charge online).
    const needsOnlinePayment = paymentMethod === "card" && total > 0;

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
      paymentMethod,
      whatsappOptIn: whatsappOptIn.checked,
    });

    if (!saved) {
      confirmBookingBtn.disabled = false;
      confirmBookingBtn.textContent = "Confirm booking";
      voucherFeedback.textContent = "Something went wrong saving your booking — please try again or contact the salon on WhatsApp.";
      voucherFeedback.style.color = "#b3543f";
      return;
    }

    // Mark the voucher redeemed now that it's tied to a real booking,
    // regardless of payment path (the voucher itself was already "paid for").
    if (appliedVoucher) {
      await sb
        .from("vouchers")
        .update({ is_redeemed: true, redeemed_booking_id: saved.id, redeemed_at: new Date().toISOString() })
        .eq("id", appliedVoucher.id);
    }

    if (needsOnlinePayment) {
      // Hand off to PayFast. The booking already exists in Supabase as
      // "pending"/"unpaid", so nothing is lost if the customer abandons
      // checkout on PayFast's side — she'll see it in the admin console
      // either way and can follow up. Loyalty points and the Google
      // Calendar sync are intentionally NOT done yet for this path —
      // the payfast-itn webhook does both once payment is actually
      // confirmed, since awarding points or booking calendar time for
      // an unpaid slot would be premature.
      const { data: checkoutData, error: checkoutError } = await sb.functions.invoke("pay-checkout", {
        body: { booking_id: saved.id },
      });

      if (checkoutError || !checkoutData?.action_url) {
        confirmBookingBtn.disabled = false;
        confirmBookingBtn.textContent = "Confirm booking";
        voucherFeedback.textContent = "Your booking is saved, but we couldn't start the payment step — please try again or contact the salon on WhatsApp to arrange payment.";
        voucherFeedback.style.color = "#b3543f";
        return;
      }

      // Build and submit a real form so the browser navigates to
      // PayFast's hosted payment page (can't navigate via fetch/invoke).
      const payForm = document.createElement("form");
      payForm.method = "POST";
      payForm.action = checkoutData.action_url;
      Object.entries(checkoutData.fields).forEach(([key, value]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = value;
        payForm.appendChild(input);
      });
      document.body.appendChild(payForm);
      payForm.submit();
      return; // browser is navigating away — nothing more to do here
    }

    // ---- Instore / no-charge path: same as before, confirm immediately ----
    const dateLabel = dateInput.value
      ? new Date(dateInput.value).toLocaleDateString("en-ZA", { day: "numeric", month: "long" })
      : "";

    confirmBookingBtn.disabled = false;
    confirmBookingBtn.textContent = "Confirm booking";

    // Earn loyalty points for this spend, keyed by phone number.
    if (window.SSculptLoyalty) {
      await window.SSculptLoyalty.addSpend(phoneInput.value.trim(), nameInput.value.trim(), total, saved.id);
    }

    // Push to her real Google Calendar. Best-effort: if this fails (e.g.
    // calendar not shared with the service account yet), the booking is
    // still saved in Supabase — we don't block the customer's confirmation
    // on a calendar sync issue she can fix later.
    sb.functions.invoke("calendar-sync", { body: { booking_id: saved.id } }).catch((err) => {
      console.error("Calendar sync failed (booking still saved):", err);
    });

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

  // ---- Handle return from PayFast (return_url / cancel_url) ----
  // PayFast redirects the browser back here regardless of timing
  // relative to the ITN webhook — the booking's real payment_status
  // is only ever set by payfast-itn (server-to-server), never by this
  // redirect. This just shows the right message and looks up the
  // booking's current state to display to the customer.
  async function handlePayfastReturn() {
    const params = new URLSearchParams(window.location.search);
    const paymentResult = params.get("payment");
    const bookingId = params.get("booking_id");
    if (!paymentResult || !bookingId) return false;

    const { data: booking } = await sb
      .from("bookings")
      .select("*, treatments(name)")
      .eq("id", bookingId)
      .maybeSingle();

    form.querySelector(".booking-steps").style.display = "none";
    panels.forEach((p) => p.classList.remove("is-active"));
    bookingSuccess.hidden = false;

    if (paymentResult === "success") {
      const dateLabel = booking?.booking_date
        ? new Date(booking.booking_date).toLocaleDateString("en-ZA", { day: "numeric", month: "long" })
        : "";
      const treatmentName = booking?.treatments?.name || "your treatment";
      bookingSuccessDetail.textContent = booking
        ? `${treatmentName} on ${dateLabel}. Payment is being confirmed — you'll see it reflected shortly, and we'll be in touch if anything needs attention.`
        : "Your payment is being confirmed. We'll be in touch shortly.";
      if (booking?.whatsapp_opt_in) {
        const msg = `Hi! I just paid online for my booking:\n${treatmentName}\n${dateLabel}\nName: ${booking.customer_name}`;
        successWhatsappBtn.href = waLink(msg);
        successWhatsappBtn.hidden = false;
      }
    } else {
      bookingSuccessDetail.textContent = "Payment was cancelled — your booking slot wasn't confirmed. You can try again, or contact the salon on WhatsApp to arrange payment another way.";
      successWhatsappBtn.hidden = true;
    }

    return true;
  }

  handlePayfastReturn().then((handled) => {
    if (!handled) goToStep(1);
  });
})();
