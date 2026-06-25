// ============================================
// ADMIN DATA STORE — Specials
// ------------------------------------------------
// Treatments now live in js/treatment-store.js (shared with
// the public site). This file is specials only.
//
// The `specials` table has a single `message` column (the
// ticker just shows "✦ message"), so the admin form below
// uses one field, not separate title/description.
// ============================================

const DataStore = {
  // SPECIALS
  async getSpecials() {
    const { data, error } = await sb.from("specials").select("*").order("sort_order", { ascending: true });
    if (error) return handleSbError(error, []);
    return data.map((s) => ({ id: s.id, message: s.message, active: s.is_active, sortOrder: s.sort_order }));
  },

  async saveSpecial(special) {
    const row = { message: special.message };

    if (special.id) {
      const { data, error } = await sb.from("specials").update(row).eq("id", special.id).select().single();
      if (error) return handleSbError(error, null);
      return { id: data.id, message: data.message, active: data.is_active };
    }

    const { data, error } = await sb
      .from("specials")
      .insert({ ...row, is_active: true })
      .select()
      .single();
    if (error) return handleSbError(error, null);
    return { id: data.id, message: data.message, active: data.is_active };
  },

  async deleteSpecial(id) {
    const { error } = await sb.from("specials").delete().eq("id", id);
    if (error) handleSbError(error, null);
  },

  async toggleSpecialActive(id) {
    const { data: current, error: readError } = await sb.from("specials").select("is_active").eq("id", id).single();
    if (readError) return handleSbError(readError, null);

    const { data, error } = await sb
      .from("specials")
      .update({ is_active: !current.is_active })
      .eq("id", id)
      .select()
      .single();
    if (error) return handleSbError(error, null);
    return { id: data.id, message: data.message, active: data.is_active };
  },
};
