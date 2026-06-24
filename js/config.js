// ============================================
// CONFIG — change brand name / treatments here only
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

const TREATMENTS = {
  sculpt: [
    {
      id: "sculpt-package",
      name: "Slimming & Sculpting Package",
      duration: "6 x 120 min",
      price: 2500,
      desc: "6 sessions of 120 minutes, per body area — abdomen, flanks, hips, thighs, upper arms, buttocks, back or legs. Our signature package.",
    },
    {
      id: "sculpt-cellulite",
      name: "Cellulite & Scarring Treatment",
      duration: "120 min",
      price: 450,
      desc: "Targeted treatment to reduce cellulite appearance and improve scar texture.",
    },
    {
      id: "sculpt-cavitation",
      name: "Ultrasonic Cavitation",
      duration: "120 min",
      price: 450,
      desc: "Non-invasive fat-cell breakdown treatment for stubborn areas.",
    },
    {
      id: "sculpt-rf",
      name: "Radio Frequency",
      duration: "120 min",
      price: 450,
      desc: "Skin-firming radio frequency treatment, smooths and tightens treated areas.",
    },
    {
      id: "sculpt-laser",
      name: "Laser Lipolysis",
      duration: "120 min",
      price: 450,
      desc: "Laser-based fat reduction treatment for precise body contouring.",
    },
    {
      id: "sculpt-vacuum",
      name: "Vacuum Body Sculpting",
      duration: "120 min",
      price: 450,
      desc: "Vacuum-suction sculpting treatment to smooth and contour the body.",
    },
  ],
  // PLACEHOLDER — replace with real facial treatments flyer once available.
  // Currently using R600/session as seen in the WhatsApp screenshot.
  face: [
    {
      id: "face-rejuv",
      name: "Face Rejuvenation Facial",
      duration: "60 min",
      price: 600,
      desc: "Facial rejuvenation treatment. (Placeholder — update with real treatment details.)",
    },
  ],
};

// Flatten for easy lookup by id
const ALL_TREATMENTS = [...TREATMENTS.sculpt, ...TREATMENTS.face];

function findTreatment(id) {
  return ALL_TREATMENTS.find((t) => t.id === id);
}

function formatCurrency(amount) {
  return `${SITE_CONFIG.currency}${amount.toLocaleString("en-ZA")}`;
}

function waLink(message) {
  return `https://wa.me/${SITE_CONFIG.whatsappNumber}?text=${encodeURIComponent(message)}`;
}
