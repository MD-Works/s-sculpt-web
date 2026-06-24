// ============================================
// ADMIN DATA STORE
// ------------------------------------------------
// This is the ONLY file that needs to change when we
// connect Supabase. Every function here returns the same
// shape it will return once backed by a real database —
// admin.js never touches localStorage directly.
//
// Swap plan (see HANDOFF.md step 4): replace the body of
// each function below with a supabase-js call. Keep the
// function names and return shapes identical and nothing
// else in admin.js needs to change.
// ============================================

const STORE_KEY = "ssculpt_admin_data_v1";

function parseLegacyDuration(durationStr) {
  // One-time parse used ONLY when seeding from config.js's old string format
  // (e.g. "120 min" or "6 x 120 min"). New treatments never go through this —
  // they're created with a real durationMinutes number from the start.
  const str = String(durationStr || "");
  const sessionsMatch = str.match(/^(\d+)\s*x\s*(\d+)\s*min/i);
  if (sessionsMatch) {
    return { durationMinutes: Number(sessionsMatch[2]), sessionsCount: Number(sessionsMatch[1]) };
  }
  const singleMatch = str.match(/(\d+)\s*min/i);
  return { durationMinutes: singleMatch ? Number(singleMatch[1]) : 60, sessionsCount: 1 };
}

function buildDurationLabel(durationMinutes, sessionsCount) {
  const mins = Number(durationMinutes) || 60;
  const sessions = Number(sessionsCount) || 1;
  return sessions > 1 ? `${sessions} x ${mins} min` : `${mins} min`;
}

function defaultStoreData() {
  // Seeded directly from js/config.js so the admin console
  // starts in sync with what the live site currently shows.
  return {
    treatments: ALL_TREATMENTS.map((t) => {
      const { durationMinutes, sessionsCount } = parseLegacyDuration(t.duration);
      return {
        ...t,
        category: TREATMENTS.sculpt.includes(t) ? "sculpt" : "face",
        active: true,
        durationMinutes,
        sessionsCount,
      };
    }),
    specials: [
      {
        id: "special-promo",
        title: "Slimming & Sculpting Promo",
        description: "R2500 for 6 sessions of 120 minutes, per body area.",
        active: true,
      },
    ],
  };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) {
      const fresh = defaultStoreData();
      localStorage.setItem(STORE_KEY, JSON.stringify(fresh));
      return fresh;
    }
    return JSON.parse(raw);
  } catch (e) {
    console.error("Admin store read failed, resetting to defaults", e);
    const fresh = defaultStoreData();
    localStorage.setItem(STORE_KEY, JSON.stringify(fresh));
    return fresh;
  }
}

function saveStore(data) {
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
}

function genId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- Public API used by admin.js ----------

const DataStore = {
  // TREATMENTS
  getTreatments(category) {
    const data = loadStore();
    return category ? data.treatments.filter((t) => t.category === category) : data.treatments;
  },

  saveTreatment(treatment) {
    const data = loadStore();
    const durationMinutes = Number(treatment.durationMinutes) || 60;
    const sessionsCount = Number(treatment.sessionsCount) || 1;
    const normalized = {
      ...treatment,
      durationMinutes,
      sessionsCount,
      duration: buildDurationLabel(durationMinutes, sessionsCount), // kept for display compatibility
    };

    if (treatment.id) {
      const idx = data.treatments.findIndex((t) => t.id === treatment.id);
      if (idx !== -1) {
        data.treatments[idx] = { ...data.treatments[idx], ...normalized };
        saveStore(data);
        return data.treatments[idx];
      }
    }
    const newTreatment = { ...normalized, id: genId("t"), active: true };
    data.treatments.push(newTreatment);
    saveStore(data);
    return newTreatment;
  },

  deleteTreatment(id) {
    const data = loadStore();
    data.treatments = data.treatments.filter((t) => t.id !== id);
    saveStore(data);
  },

  toggleTreatmentActive(id) {
    const data = loadStore();
    const t = data.treatments.find((t) => t.id === id);
    if (t) {
      t.active = !t.active;
      saveStore(data);
    }
    return t;
  },

  // SPECIALS
  getSpecials() {
    return loadStore().specials;
  },

  saveSpecial(special) {
    const data = loadStore();
    if (special.id) {
      const idx = data.specials.findIndex((s) => s.id === special.id);
      if (idx !== -1) {
        data.specials[idx] = { ...data.specials[idx], ...special };
        saveStore(data);
        return data.specials[idx];
      }
    }
    const newSpecial = { ...special, id: genId("sp"), active: true };
    data.specials.push(newSpecial);
    saveStore(data);
    return newSpecial;
  },

  deleteSpecial(id) {
    const data = loadStore();
    data.specials = data.specials.filter((s) => s.id !== id);
    saveStore(data);
  },

  toggleSpecialActive(id) {
    const data = loadStore();
    const s = data.specials.find((s) => s.id === id);
    if (s) {
      s.active = !s.active;
      saveStore(data);
    }
    return s;
  },

  // RESET / EXPORT
  resetToDefaults() {
    const fresh = defaultStoreData();
    saveStore(fresh);
    return fresh;
  },

  exportAsConfigJs() {
    const data = loadStore();
    const sculpt = data.treatments.filter((t) => t.category === "sculpt" && t.active);
    const face = data.treatments.filter((t) => t.category === "face" && t.active);

    const fmt = (t) => `    {
      id: "${t.id}",
      name: "${t.name.replace(/"/g, '\\"')}",
      duration: "${t.duration}",
      durationMinutes: ${Number(t.durationMinutes) || 60},
      price: ${Number(t.price) || 0},
      desc: "${(t.desc || "").replace(/"/g, '\\"')}",
    }`;

    return `const TREATMENTS = {
  sculpt: [
${sculpt.map(fmt).join(",\n")}
  ],
  face: [
${face.map(fmt).join(",\n")}
  ],
};`;
  },
};
