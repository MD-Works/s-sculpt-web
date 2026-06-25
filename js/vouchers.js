// ============================================
// VOUCHERS — live preview builder, now a real DB row
// ------------------------------------------------
// Generates a real `vouchers` row with a unique code. Since
// payment isn't connected yet (see HANDOFF.md), this records
// the voucher as issued but doesn't take payment — the code
// works at checkout regardless, so don't hand it out until
// payment is actually collected another way (cash/EFT in person,
// confirmed over WhatsApp, etc.) until card payment goes live.
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

  // Tries a few random codes in case of a rare collision with an existing one.
  async function generateUniqueCode() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      const { data } = await sb.from("vouchers").select("id").eq("code", code).maybeSingle();
      if (!data) return code;
    }
    return `SCULPT-${Date.now().toString(36).toUpperCase()}`;
  }

  generateBtn.addEventListener("click", async () => {
    generateBtn.disabled = true;
    generateBtn.textContent = "Generating…";

    const code = await generateUniqueCode();
    const recipient = toInput.value.trim() || null;
    const from = fromInput.value.trim() || null;
    const message = msgInput.value.trim() || null;

    const { data, error } = await sb
      .from("vouchers")
      .insert({
        code,
        amount: selectedAmount,
        recipient_name: recipient,
        sender_name: from,
        message,
      })
      .select()
      .single();

    generateBtn.disabled = false;

    if (error || !data) {
      generateBtn.textContent = "Couldn't generate — try again";
      setTimeout(() => (generateBtn.textContent = "Generate voucher"), 2000);
      return;
    }

    previewCode.textContent = data.code;
    generateBtn.textContent = "Voucher generated ✓";
    generateBtn.classList.add("is-active");
    setTimeout(() => {
      generateBtn.textContent = "Generate another";
    }, 1600);

    const recipientLabel = recipient || "someone special";
    const fromLabel = from || "A friend";
    const note = message ? `\n"${message}"` : "";
    const msg = `🎁 Gift voucher for ${recipientLabel}\n${formatCurrency(selectedAmount)} at ${SITE_CONFIG.brandName}\nCode: ${data.code}\nFrom: ${fromLabel}${note}`;

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
