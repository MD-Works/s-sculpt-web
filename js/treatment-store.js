// ============================================
// TREATMENT STORE
// ------------------------------------------------
// Single source of truth for treatments, backed by the
// Supabase `treatments` table. Used by:
//   - services.js / booking.js (public site, active only)
//   - admin.js (full CRUD, including hidden/inactive)
//
// Row shape from Supabase (snake_case) is normalized here
// into the camelCase shape the rest of the app already
// expects (id, name, price, durationMinutes, sessionsCount,
// duration, desc, category, active).
// ============================================

function normalizeTreatmentRow(row) {
  return {
    id: row.id,
    category: row.category,
    name: row.name,
    price: Number(row.price),
    durationMinutes: row.duration_minutes,
    sessionsCount: row.sessions_count,
    duration: buildDurationLabel(row.duration_minutes, row.sessions_count),
    desc: row.description || "",
    active: row.is_active,
    sortOrder: row.sort_order,
    // null = no override (follow the global payment setting),
    // true = always allow instore for this treatment, false = never.
    allowInstore: row.allow_instore === undefined ? null : row.allow_instore,
  };
}

const TreatmentStore = {
  // ---------- Public reads (active only) ----------
  async getActiveTreatments() {
    const { data, error } = await sb
      .from("treatments")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) return handleSbError(error, []);
    return data.map(normalizeTreatmentRow);
  },

  async getActiveByCategory(category) {
    const all = await this.getActiveTreatments();
    return all.filter((t) => t.category === category);
  },

  async findTreatment(id) {
    const { data, error } = await sb.from("treatments").select("*").eq("id", id).maybeSingle();
    if (error || !data) return handleSbError(error, null);
    return normalizeTreatmentRow(data);
  },

  // ---------- Admin reads (everything, including hidden) ----------
  async getTreatments(category) {
    let query = sb.from("treatments").select("*").order("sort_order", { ascending: true });
    if (category) query = query.eq("category", category);
    const { data, error } = await query;
    if (error) return handleSbError(error, []);
    return data.map(normalizeTreatmentRow);
  },

  // ---------- Admin writes ----------
  async saveTreatment(treatment) {
    const durationMinutes = Number(treatment.durationMinutes) || 60;
    const sessionsCount = Number(treatment.sessionsCount) || 1;

    const row = {
      category: treatment.category,
      name: treatment.name,
      price: Number(treatment.price) || 0,
      duration_minutes: durationMinutes,
      sessions_count: sessionsCount,
      description: treatment.desc || "",
      allow_instore: treatment.allowInstore === undefined ? null : treatment.allowInstore,
    };

    if (treatment.id) {
      const { data, error } = await sb.from("treatments").update(row).eq("id", treatment.id).select().single();
      if (error) return handleSbError(error, null);
      return normalizeTreatmentRow(data);
    }

    const { data, error } = await sb
      .from("treatments")
      .insert({ ...row, is_active: true })
      .select()
      .single();
    if (error) return handleSbError(error, null);
    return normalizeTreatmentRow(data);
  },

  async deleteTreatment(id) {
    const { error } = await sb.from("treatments").delete().eq("id", id);
    if (error) handleSbError(error, null);
  },

  async toggleTreatmentActive(id) {
    const { data: current, error: readError } = await sb.from("treatments").select("is_active").eq("id", id).single();
    if (readError) return handleSbError(readError, null);

    const { data, error } = await sb
      .from("treatments")
      .update({ is_active: !current.is_active })
      .eq("id", id)
      .select()
      .single();
    if (error) return handleSbError(error, null);
    return normalizeTreatmentRow(data);
  },
};
