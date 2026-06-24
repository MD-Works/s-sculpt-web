// ============================================
// VOUCHERS — live preview builder
// ============================================
(function () {
  const amountBtns = document.querySelectorAll(".amount-btn");
  const toInput = document.getElementById("voucherToInput");
  const fromInput = document.getElementById("voucherFromInput");
  const msgInput = document.getElementById("voucherMsgInput");
  const generateBtn = document.getElementById("generateVoucherBtn");

  const previewAmount = document.getElementById("voucherPreviewAmount");
  const previewTo = document.getElementById("voucherPreviewTo");
  const previewCode = document.getElementById("voucherPreviewCode");

  let selectedAmount = 500;
  let generatedCode = null;

  amountBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      amountBtns.forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      selectedAmount = Number(btn.dataset.amount);
      previewAmount.textContent = formatCurrency(selectedAmount);
    });
  });

  toInput.addEventListener("input", () => {
    previewTo.textContent = toInput.value ? `For ${toInput.value}` : "For someone special";
  });

  function randomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return `SCULPT-${code}`;
  }

  generateBtn.addEventListener("click", () => {
    generatedCode = randomCode();
    previewCode.textContent = generatedCode;

    generateBtn.textContent = "Voucher generated ✓";
    generateBtn.classList.add("is-active");

    setTimeout(() => {
      generateBtn.textContent = "Generate another";
    }, 1600);

    // Offer a WhatsApp share of the voucher
    const recipient = toInput.value || "someone special";
    const from = fromInput.value || "A friend";
    const note = msgInput.value ? `\n"${msgInput.value}"` : "";
    const msg = `🎁 Gift voucher for ${recipient}\n${formatCurrency(selectedAmount)} at ${SITE_CONFIG.brandName}\nCode: ${generatedCode}\nFrom: ${from}${note}`;

    let shareBtn = document.getElementById("voucherShareBtn");
    if (!shareBtn) {
      shareBtn = document.createElement("a");
      shareBtn.id = "voucherShareBtn";
      shareBtn.className = "btn btn-ghost";
      shareBtn.target = "_blank";
      shareBtn.rel = "noopener";
      shareBtn.style.marginTop = "0.6rem";
      shareBtn.style.width = "100%";
      shareBtn.style.justifyContent = "center";
      shareBtn.textContent = "Share via WhatsApp";
      generateBtn.insertAdjacentElement("afterend", shareBtn);
    }
    shareBtn.href = waLink(msg);
  });
})();
