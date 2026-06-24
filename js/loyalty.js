// ============================================
// LOYALTY — points ring, tiers, localStorage demo
// ============================================
(function () {
  const STORAGE_KEY = "s-sculpt:loyalty-points";
  const RING_CIRCUMFERENCE = 2 * Math.PI * 84; // r=84

  const ringFg = document.getElementById("loyaltyRingFg");
  const pointsDisplay = document.getElementById("loyaltyPointsDisplay");
  const tierDisplay = document.getElementById("loyaltyTierDisplay");
  const nextDisplay = document.getElementById("loyaltyNextDisplay");
  const addVisitBtn = document.getElementById("addVisitBtn");
  const resetBtn = document.getElementById("resetLoyaltyBtn");

  const TIERS = [
    { name: "Bronze", min: 0, max: 199 },
    { name: "Silver", min: 200, max: 499 },
    { name: "Gold", min: 500, max: Infinity },
  ];

  function getPoints() {
    return Number(localStorage.getItem(STORAGE_KEY) || 0);
  }

  function setPoints(value) {
    localStorage.setItem(STORAGE_KEY, String(value));
    render();
  }

  function getTier(points) {
    return TIERS.find((t) => points >= t.min && points <= t.max);
  }

  function render() {
    const points = getPoints();
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

  function addSpend(amountRand) {
    const earned = Math.floor(amountRand / 10); // 1 point per R10
    setPoints(getPoints() + earned);
  }

  addVisitBtn.addEventListener("click", () => addSpend(450));
  resetBtn.addEventListener("click", () => setPoints(0));

  render();

  // Expose for booking.js to call after a confirmed booking
  window.SSculptLoyalty = { addSpend, getPoints };
})();
