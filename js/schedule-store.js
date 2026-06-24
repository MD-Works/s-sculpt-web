// ============================================
// SCHEDULE STORE
// ------------------------------------------------
// Handles business hours, blocked dates, and bookings,
// and computes open slots from them.
//
// SWAP PLAN (see HANDOFF.md step 9):
// Once the Google Calendar Edge Function exists, replace
// the body of getOpenSlots() with a call to that function
// (it will return real free/busy from her actual calendar
// instead of computing it from local bookings). Keep the
// function signature and return shape identical — nothing
// in booking.js or admin.js needs to change.
//
// Replace saveBooking() with a Supabase insert once that
// table exists — same idea, same return shape.
// ============================================

const SCHEDULE_KEY = "ssculpt_schedule_v1";

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function defaultScheduleData() {
  return {
    // 0 = Sunday ... 6 = Saturday
    hours: {
      0: { open: false, start: "09:00", end: "13:00" },
      1: { open: true, start: "09:00", end: "17:00" },
      2: { open: true, start: "09:00", end: "17:00" },
      3: { open: true, start: "09:00", end: "17:00" },
      4: { open: true, start: "09:00", end: "17:00" },
      5: { open: true, start: "09:00", end: "17:00" },
      6: { open: true, start: "09:00", end: "13:00" },
    },
    slotIntervalMinutes: 30,
    blockedDates: [], // array of "YYYY-MM-DD" strings — her days off / holidays
    bookings: [], // { id, date, time, durationMinutes, treatmentId, name, phone }
  };
}

function loadSchedule() {
  try {
    const raw = localStorage.getItem(SCHEDULE_KEY);
    if (!raw) {
      const fresh = defaultScheduleData();
      localStorage.setItem(SCHEDULE_KEY, JSON.stringify(fresh));
      return fresh;
    }
    const parsed = JSON.parse(raw);
    // normalize keys to strings->numbers in case of older saved data
    return parsed;
  } catch (e) {
    console.error("Schedule store read failed, resetting to defaults", e);
    const fresh = defaultScheduleData();
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(fresh));
    return fresh;
  }
}

function saveSchedule(data) {
  localStorage.setItem(SCHEDULE_KEY, JSON.stringify(data));
}

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minutesToTime(mins) {
  const h = Math.floor(mins / 60).toString().padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

const ScheduleStore = {
  WEEKDAY_LABELS,

  // ---------- Hours ----------
  getHours() {
    return loadSchedule().hours;
  },

  setDayHours(weekday, { open, start, end }) {
    const data = loadSchedule();
    data.hours[weekday] = { open, start, end };
    saveSchedule(data);
  },

  getSlotInterval() {
    return loadSchedule().slotIntervalMinutes;
  },

  setSlotInterval(minutes) {
    const data = loadSchedule();
    data.slotIntervalMinutes = Number(minutes);
    saveSchedule(data);
  },

  // ---------- Blocked dates ----------
  getBlockedDates() {
    return loadSchedule().blockedDates;
  },

  addBlockedDate(dateStr) {
    const data = loadSchedule();
    if (!data.blockedDates.includes(dateStr)) {
      data.blockedDates.push(dateStr);
      data.blockedDates.sort();
      saveSchedule(data);
    }
  },

  removeBlockedDate(dateStr) {
    const data = loadSchedule();
    data.blockedDates = data.blockedDates.filter((d) => d !== dateStr);
    saveSchedule(data);
  },

  // ---------- Bookings ----------
  getBookingsForDate(dateStr) {
    return loadSchedule().bookings.filter((b) => b.date === dateStr);
  },

  getAllBookings() {
    return loadSchedule().bookings.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  },

  saveBooking(booking) {
    const data = loadSchedule();
    const newBooking = {
      id: `bk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      status: "confirmed",
      ...booking,
    };
    data.bookings.push(newBooking);
    saveSchedule(data);
    return newBooking;
  },

  cancelBooking(id) {
    const data = loadSchedule();
    const b = data.bookings.find((x) => x.id === id);
    if (b) {
      b.status = "cancelled";
      saveSchedule(data);
    }
    return b;
  },

  // ---------- Slot computation ----------
  // Returns an array of "HH:MM" strings: every slot start time on
  // dateStr where a treatment of durationMinutes would fit, given
  // business hours, blocked dates, and existing confirmed bookings.
  getOpenSlots(dateStr, durationMinutes) {
    const data = loadSchedule();

    if (data.blockedDates.includes(dateStr)) return [];

    // Avoid timezone drift: parse the date string as local, not UTC.
    const [y, m, d] = dateStr.split("-").map(Number);
    const weekday = new Date(y, m - 1, d).getDay();
    const dayHours = data.hours[weekday];
    if (!dayHours || !dayHours.open) return [];

    const interval = data.slotIntervalMinutes || 30;
    const dayStart = timeToMinutes(dayHours.start);
    const dayEnd = timeToMinutes(dayHours.end);
    const duration = durationMinutes || 60;

    const existingRanges = data.bookings
      .filter((b) => b.date === dateStr && b.status !== "cancelled")
      .map((b) => {
        const start = timeToMinutes(b.time);
        return { start, end: start + (b.durationMinutes || 60) };
      });

    const now = new Date();
    const isToday = now.getFullYear() === y && now.getMonth() === m - 1 && now.getDate() === d;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const slots = [];
    for (let start = dayStart; start + duration <= dayEnd; start += interval) {
      if (isToday && start <= nowMinutes) continue;

      const end = start + duration;
      const overlaps = existingRanges.some((r) => start < r.end && end > r.start);
      if (!overlaps) slots.push(minutesToTime(start));
    }
    return slots;
  },

  resetToDefaults() {
    const fresh = defaultScheduleData();
    saveSchedule(fresh);
    return fresh;
  },
};
