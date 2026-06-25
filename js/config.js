// ============================================
// CONFIG — brand settings only.
// ------------------------------------------------
// Treatments used to be hardcoded here as TREATMENTS / ALL_TREATMENTS.
// They now live in the Supabase `treatments` table and are fetched
// by services.js / booking.js via TreatmentStore (see js/treatment-store.js).
// Edit treatments from the admin console, not this file.
// ============================================
const SITE_CONFIG = {
  brandName: "S Sculpt",
  whatsappNumber: "27678989347", // 067 898 9347 in international format
  currency: "R",
  email: "ssculpt71@gmail.com",
  address: "Palm Springs Shopping Centre, 30 Christoffel Street, van Riebeek Park, Kempton Park",
};

// Apply brand name everywhere it appears
document.querySelectorAll("[data-brand-name]").forEach((el) => {
  el.textContent = SITE_CONFIG.brandName;
});
document.title = `${SITE_CONFIG.brandName} — Slimming & Face Rejuvenation`;

function formatCurrency(amount) {
  return `${SITE_CONFIG.currency}${Number(amount).toLocaleString("en-ZA")}`;
}

function waLink(message) {
  return `https://wa.me/${SITE_CONFIG.whatsappNumber}?text=${encodeURIComponent(message)}`;
}

// Builds the same "6 x 120 min" / "120 min" display string the UI expects,
// from the real numeric columns in the database.
function buildDurationLabel(durationMinutes, sessionsCount) {
  const mins = Number(durationMinutes) || 60;
  const sessions = Number(sessionsCount) || 1;
  return sessions > 1 ? `${sessions} x ${mins} min` : `${mins} min`;
}
