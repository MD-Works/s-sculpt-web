-- ============================================================
-- S SCULPT — PayFast payment migration
-- Run this in Supabase SQL Editor (Project > SQL Editor > New query)
-- Safe to run once on the existing live database — only adds
-- new columns/defaults, doesn't touch existing data.
-- ============================================================

-- ---------- BOOKINGS: PayFast tracking fields ----------
alter table bookings
  add column if not exists payment_reference text,        -- our own m_payment_id sent to PayFast (== bookings.id, but stored for clarity/lookup)
  add column if not exists pf_payment_id text,             -- PayFast's own transaction id, from the ITN
  add column if not exists payment_amount_gross numeric(10,2); -- gross amount PayFast confirms was paid, from the ITN (sanity-check against price_charged)

-- ---------- TREATMENTS: per-treatment instore override ----------
-- null   = no override, follow the global salon_settings rule
-- true   = always allow instore for this treatment, regardless of amount
-- false  = never allow instore for this treatment (must pay online)
alter table treatments
  add column if not exists allow_instore boolean;

-- ---------- SALON SETTINGS: global payment controls ----------
alter table salon_settings
  add column if not exists instore_payment_enabled boolean not null default true,
  add column if not exists min_amount_for_instore numeric(10,2); -- null = no minimum, instore always allowed (subject to the two rules above)

-- ============================================================
-- Notes on how the three controls combine (enforced in booking.js,
-- not the database — RLS still allows public inserts either way):
--
--   1. salon_settings.instore_payment_enabled = false
--        -> instore is OFF everywhere, no exceptions.
--   2. treatments.allow_instore = false (for a specific treatment)
--        -> instore is OFF for that treatment, no exceptions.
--   3. treatments.allow_instore = true (for a specific treatment)
--        -> instore is ALWAYS allowed for that treatment, ignoring
--           min_amount_for_instore.
--   4. treatments.allow_instore is null (the default/unset state)
--        -> falls back to salon_settings.min_amount_for_instore:
--           if set, instore only allowed when price_charged is
--           below that amount; if null, instore is allowed.
-- ============================================================
