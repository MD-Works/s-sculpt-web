// ============================================
// BOOKING — multi-step form
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

  // Minimum bookable date = tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  dateInput.min = tomorrow.toISOString().split("T")[0];

  let currentStep = 1;
  let appliedDiscount = 0; // percentage, from voucher demo codes
  let appliedVoucherLabel = "";

  function goToStep(step) {
    currentStep = step;
    panels.forEach((p) => p.classList.toggle("is-active", Number(p.dataset.stepPanel) === step));
    steps.forEach((s) => {
      const n = Number(s.dataset.step);
      s.classList.toggle("is-active", n === step);
      s.classList.toggle("is-done", n < step);
    });
    if (step === 4) renderSummary();
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
    const t = findTreatment(treatmentSelect.value);
    if (t) {
      treatmentHint.textContent = `${t.duration} · ${formatCurrency(t.price)} · ${t.desc}`;
    }
  });

  function getPriceBreakdown() {
    const t = findTreatment(treatmentSelect.value);
    const base = t ? t.price : 0;
    const discountAmount = Math.round((base * appliedDiscount) / 100);
    const total = base - discountAmount;
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

  // ---- Voucher code (demo logic) ----
  // Any code containing "GLOW" or "SCULPT" gives 10% off, for demo purposes.
  applyVoucherBtn.addEventListener("click", () => {
    const code = voucherInput.value.trim().toUpperCase();
    if (!code) {
      voucherFeedback.textContent = "Enter a code first.";
      return;
    }
    if (code.includes("GLOW") || code.includes("SCULPT")) {
      appliedDiscount = 10;
      appliedVoucherLabel = `Voucher (${code})`;
      voucherFeedback.textContent = "Voucher applied — 10% off this booking.";
      voucherFeedback.style.color = "var(--success)";
    } else {
      appliedDiscount = 0;
      voucherFeedback.textContent = "Code not recognised. Check with the salon on WhatsApp.";
      voucherFeedback.style.color = "#b3543f";
    }
    renderSummary();
  });

  // ---- Submit ----
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!validateStep(3)) return;

    const { total, treatment } = getPriceBreakdown();
    const dateLabel = dateInput.value
      ? new Date(dateInput.value).toLocaleDateString("en-ZA", { day: "numeric", month: "long" })
      : "";

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

    // Feed the loyalty demo (purely client-side, see loyalty.js)
    if (window.SSculptLoyalty) {
      window.SSculptLoyalty.addSpend(total);
    }
  });

  goToStep(1);
})();
