// ============================================
// SCHEDULE STORE
// ------------------------------------------------
// Business hours, blocked dates, settings and bookings —
// now backed by Supabase tables (business_hours, blocked_dates,
// salon_settings, bookings) instead of localStorage.
//
// FUTURE SWAP (see HANDOFF.md): once Google Calendar sync exists,
// getOpenSlots() becomes a call to a Supabase Edge Function that
// checks her real calendar instead of just the bookings table.
// Keep the function signature and return shape identical when
// that happens — nothing in booking.js or admin.js should need
// to change beyond that one function's internals.
// ============================================

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function timeToMinutes(t) {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
}
function minutesToTime(mins) {
  const h = Math.floor(mins / 60).toString().padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}
// Supabase returns time columns as "HH:MM:SS" — trim to "HH:MM" for the UI.
function trimSeconds(t) {
  return String(t).slice(0, 5);
}

function normalizeBookingRow(row) {
  return {
    id: row.id,
    treatmentId: row.treatment_id,
    date: row.booking_date,
    time: trimSeconds(row.booking_time),
    name: row.customer_name,
    phone: row.customer_phone,
    email: row.customer_email,
    total: Number(row.price_charged),
    status: row.status,
    voucherId: row.voucher_id,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    voucherDiscount: row.voucher_discount ? Number(row.voucher_discount) : 0,
  };
}

const ScheduleStore = {
  WEEKDAY_LABELS,

  // ---------- Hours ----------
  // Returns { 0: {open, start, end}, ..., 6: {...} } keyed by weekday number.
  async getHours() {
    const { data, error } = await sb.from("business_hours").select("*");
    if (error) return handleSbError(error, {});
    const hours = {};
    data.forEach((row) => {
      hours[row.weekday] = { open: row.is_open, start: trimSeconds(row.start_time), end: trimSeconds(row.end_time) };
    });
    return hours;
  },

  async setDayHours(weekday, { open, start, end }) {
    const { error } = await sb
      .from("business_hours")
      .update({ is_open: open, start_time: start, end_time: end })
      .eq("weekday", weekday);
    if (error) handleSbError(error, null);
  },

  async getSlotInterval() {
    const { data, error } = await sb.from("salon_settings").select("slot_interval_minutes").eq("id", true).maybeSingle();
    if (error || !data) return handleSbError(error, 30);
    return data.slot_interval_minutes;
  },

  async setSlotInterval(minutes) {
    const { error } = await sb
      .from("salon_settings")
      .update({ slot_interval_minutes: Number(minutes) })
      .eq("id", true);
    if (error) handleSbError(error, null);
  },

  // ---------- Payment settings ----------
  // instoreEnabled: master switch for "pay in salon" across the whole site.
  // minAmountForInstore: null = no cap, otherwise instore only offered
  // below this amount (subject to each treatment's own override — see
  // treatment-store.js's allow_instore field and booking.js's combining logic).
  async getPaymentSettings() {
    const { data, error } = await sb
      .from("salon_settings")
      .select("instore_payment_enabled, min_amount_for_instore")
      .eq("id", true)
      .maybeSingle();
    if (error || !data) return handleSbError(error, { instoreEnabled: true, minAmountForInstore: null });
    return {
      instoreEnabled: data.instore_payment_enabled,
      minAmountForInstore: data.min_amount_for_instore === null ? null : Number(data.min_amount_for_instore),
    };
  },

  async setPaymentSettings({ instoreEnabled, minAmountForInstore }) {
    const row = {};
    if (instoreEnabled !== undefined) row.instore_payment_enabled = !!instoreEnabled;
    if (minAmountForInstore !== undefined) row.min_amount_for_instore = minAmountForInstore === null || minAmountForInstore === "" ? null : Number(minAmountForInstore);
    const { error } = await sb.from("salon_settings").update(row).eq("id", true);
    if (error) handleSbError(error, null);
  },

  // Combines the global instore switch + global minimum + a treatment's
  // own override into a single yes/no. Rules, in priority order:
  //   1. Global instore switch off              -> never allowed
  //   2. Treatment's allow_instore === false     -> never allowed
  //   3. Treatment's allow_instore === true       -> always allowed
  //   4. Otherwise, fall back to the global minimum: allowed only if
  //      amount is below min_amount_for_instore (or no minimum is set)
  isInstoreAllowed(paymentSettings, treatment, amount) {
    if (!paymentSettings.instoreEnabled) return false;
    if (treatment && treatment.allowInstore === false) return false;
    if (treatment && treatment.allowInstore === true) return true;
    if (paymentSettings.minAmountForInstore === null || paymentSettings.minAmountForInstore === undefined) return true;
    return Number(amount) < Number(paymentSettings.minAmountForInstore);
  },

  // ---------- Blocked dates ----------
  async getBlockedDates() {
    const { data, error } = await sb.from("blocked_dates").select("blocked_date").order("blocked_date", { ascending: true });
    if (error) return handleSbError(error, []);
    return data.map((r) => r.blocked_date);
  },

  async addBlockedDate(dateStr) {
    const { error } = await sb.from("blocked_dates").insert({ blocked_date: dateStr });
    // Ignore duplicate-date conflicts quietly; anything else gets logged.
    if (error && error.code !== "23505") handleSbError(error, null);
  },

  async removeBlockedDate(dateStr) {
    const { error } = await sb.from("blocked_dates").delete().eq("blocked_date", dateStr);
    if (error) handleSbError(error, null);
  },

  // ---------- Bookings ----------
  // Joins treatments to get each booking's own duration, so overlap
  // checks use the real width of every existing booking (not the
  // duration of whatever new treatment is currently being booked).
  async getBookingsForDate(dateStr) {
    const { data, error } = await sb
      .from("bookings")
      .select("*, treatments(duration_minutes, stations)")
      .eq("booking_date", dateStr);
    if (error) return handleSbError(error, []);
    return data.map((row) => ({
      ...normalizeBookingRow(row),
      durationMinutes: row.treatments ? row.treatments.duration_minutes : 60,
      treatmentStations: row.treatments ? (row.treatments.stations || 1) : 1,
    }));
  },

  async getAllBookings() {
    const { data, error } = await sb
      .from("bookings")
      .select("*, treatments(name)")
      .order("booking_date", { ascending: false })
      .order("booking_time", { ascending: false });
    if (error) return handleSbError(error, []);
    return data.map((row) => ({
      ...normalizeBookingRow(row),
      treatmentName: row.treatments ? row.treatments.name : "Treatment",
    }));
  },

  async saveBooking(booking) {
    const row = {
      treatment_id: booking.treatmentId,
      customer_name: booking.name,
      customer_phone: booking.phone,
      customer_email: booking.email || null,
      booking_date: booking.date,
      booking_time: booking.time,
      status: "confirmed",
      price_charged: booking.total,
      voucher_id: booking.voucherId || null,
      voucher_discount: booking.voucherDiscount || null,
      payment_method: booking.paymentMethod || null,
      whatsapp_opt_in: booking.whatsappOptIn !== false,
    };

    const { data, error } = await sb.from("bookings").insert(row).select().single();
    if (error) return handleSbError(error, null);
    return { ...normalizeBookingRow(data), treatmentName: booking.treatmentName };
  },

  async cancelBooking(id) {
    const { data, error } = await sb.from("bookings").update({ status: "cancelled" }).eq("id", id).select().single();
    if (error) return handleSbError(error, null);
    return normalizeBookingRow(data);
  },

  // ---------- Slot computation ----------
  // Returns an array of "HH:MM" strings: every slot start time on
  // dateStr where a specific treatment would fit.
  //
  // KEY CHANGE: treatments are now independent — a booking for RF does
  // not block a slot for Laser Lipolysis. Each treatment has a `stations`
  // count (default 1) — the number of machines/beds available for that
  // treatment simultaneously. A slot is only blocked for treatment X when
  // `stations` or more bookings for treatment X already overlap that slot.
  //
  // Parameters:
  //   dateStr        — "YYYY-MM-DD"
  //   durationMinutes — the new treatment's session length
  //   treatmentId    — the treatment being booked (used to filter bookings)
  //   stations       — how many concurrent bookings are allowed (default 1)
  async getOpenSlots(dateStr, durationMinutes, treatmentId, stations) {
    const blocked = await this.getBlockedDates();
    if (blocked.includes(dateStr)) return [];

    // Avoid timezone drift: parse as local date, not UTC.
    const [y, m, d] = dateStr.split("-").map(Number);
    const weekday = new Date(y, m - 1, d).getDay();

    const hours = await this.getHours();
    const dayHours = hours[weekday];
    if (!dayHours || !dayHours.open) return [];

    const interval = (await this.getSlotInterval()) || 30;
    const dayStart = timeToMinutes(dayHours.start);
    const dayEnd = timeToMinutes(dayHours.end);
    const duration = durationMinutes || 60;
    const maxConcurrent = stations || 1;

    const dayBookings = await this.getBookingsForDate(dateStr);

    // Only consider active bookings for THIS specific treatment.
    // Bookings for other treatments are irrelevant — different machines.
    const relevantBookings = treatmentId
      ? dayBookings.filter((b) => b.status !== "cancelled" && b.treatmentId === treatmentId)
      : dayBookings.filter((b) => b.status !== "cancelled");

    const now = new Date();
    const isToday = now.getFullYear() === y && now.getMonth() === m - 1 && now.getDate() === d;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const slots = [];
    for (let start = dayStart; start + duration <= dayEnd; start += interval) {
      if (isToday && start <= nowMinutes) continue;

      const end = start + duration;

      // Count how many existing bookings for this treatment overlap this slot.
      const concurrentCount = relevantBookings.filter((b) => {
        const bStart = timeToMinutes(b.time);
        const bEnd = bStart + (b.durationMinutes || 60);
        return start < bEnd && end > bStart;
      }).length;

      // Slot is available as long as we haven't hit the stations limit.
      if (concurrentCount < maxConcurrent) slots.push(minutesToTime(start));
    }
    return slots;
  },
};
