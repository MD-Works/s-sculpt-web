// ============================================
// LOYALTY — points ring, tiers, real Supabase data
// ------------------------------------------------
// Loyalty is keyed by phone number (no customer accounts).
// The ring shows nothing until a phone number is looked up
// via the "Check my points" field — there is no meaningful
// anonymous default anymore, since points belong to a real
// person's booking history, not to whoever is on this browser.
// ============================================
(function () {
  const RING_CIRCUMFERENCE = 2 * Math.PI * 84; // r=84

  const ringFg = document.getElementById("loyaltyRingFg");
  const pointsDisplay = document.getElementById("loyaltyPointsDisplay");
  const tierDisplay = document.getElementById("loyaltyTierDisplay");
  const nextDisplay = document.getElementById("loyaltyNextDisplay");
  const lookupInput = document.getElementById("loyaltyLookupInput");
  const lookupBtn = document.getElementById("loyaltyLookupBtn");
  const lookupFeedback = document.getElementById("loyaltyLookupFeedback");

  const TIERS = [
    { name: "Bronze", min: 0, max: 199 },
    { name: "Silver", min: 200, max: 499 },
    { name: "Gold", min: 500, max: Infinity },
  ];

  function getTier(points) {
    return TIERS.find((t) => points >= t.min && points <= t.max);
  }

  function render(points) {
    const tier = getTier(points);
    const cappedForRing = Math.min(points, 500);
    const ringFraction = cappedForRing / 500;
    const offset = RING_CIRCUMFERENCE * (1 - ringFraction);

    ringFg.style.strokeDashoffset = String(offset);
    pointsDisplay.textContent = points.toLocaleString("en-ZA");
    tierDisplay.textContent = `${tier.name} member`;

    if (tier.name === "Gold") {
      nextDisplay.textContent = "You've unlocked Gold — your next signature treatment is free.";
    } else {
      const next = TIERS[TIERS.indexOf(tier) + 1];
      const remaining = next.min - points;
      nextDisplay.textContent = `${remaining} points to ${next.name}.`;
    }
  }

  async function getBalance(phone) {
    const { data, error } = await sb.from("loyalty_balances").select("balance").eq("customer_phone", phone).maybeSingle();
    if (error) return handleSbError(error, 0);
    return data ? Number(data.balance) : 0;
  }

  // 1 point per R10 spent, recorded as a real ledger row tied to the booking.
  async function addSpend(phone, name, amountRand, bookingId) {
    const earned = Math.floor(amountRand / 10);
    if (earned <= 0) return;
    const { error } = await sb.from("loyalty_transactions").insert({
      customer_phone: phone,
      customer_name: name,
      points_delta: earned,
      reason: "booking",
      related_booking_id: bookingId || null,
    });
    if (error) handleSbError(error, null);
  }

  if (lookupBtn) {
    lookupBtn.addEventListener("click", async () => {
      const phone = lookupInput.value.trim();
      if (!phone) {
        lookupFeedback.textContent = "Enter the phone number used at booking.";
        return;
      }
      lookupBtn.disabled = true;
      lookupFeedback.textContent = "Checking…";
      const points = await getBalance(phone);
      lookupBtn.disabled = false;
      lookupFeedback.textContent = points > 0 ? "" : "No points found yet for this number — they appear after your first booking.";
      render(points);
    });
  }

  // Start at zero/Bronze until a real lookup happens.
  render(0);

  // Exposed for booking.js to call right after a confirmed booking.
  window.SSculptLoyalty = { addSpend, getBalance };
})();
