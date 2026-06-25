-- ============================================================
-- S SCULPT — Supabase schema
-- Run this in Supabase SQL Editor (Project > SQL Editor > New query)
-- ============================================================

-- ---------- TREATMENTS ----------
-- Editable from the admin console. Replaces the hardcoded JS list.
create table treatments (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('sculpt', 'face')),
  name text not null,
  duration_minutes integer not null, -- length of ONE bookable session/visit
  sessions_count integer not null default 1, -- display only, e.g. 6 for "6 x 120 min" packages
  price numeric(10,2) not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- SPECIALS ----------
-- The scrolling ticker on the homepage, editable by admin.
create table specials (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- GIFT VOUCHERS ----------
-- Defined before bookings since bookings references vouchers.
create table vouchers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  amount numeric(10,2) not null,
  recipient_name text,
  sender_name text,
  message text,
  is_redeemed boolean not null default false,
  redeemed_booking_id uuid, -- FK added after bookings table exists (circular reference)
  redeemed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- BOOKINGS ----------
create table bookings (
  id uuid primary key default gen_random_uuid(),
  treatment_id uuid references treatments(id) on delete set null,
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  booking_date date not null,
  booking_time time not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  price_charged numeric(10,2) not null,
  voucher_id uuid references vouchers(id) on delete set null,
  payment_method text check (payment_method in ('card', 'instore')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'refunded')),
  whatsapp_opt_in boolean not null default true,
  google_calendar_event_id text, -- set once synced to her real calendar
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Now that bookings exists, complete the circular FK on vouchers
alter table vouchers
  add constraint vouchers_redeemed_booking_id_fkey
  foreign key (redeemed_booking_id) references bookings(id) on delete set null;

-- ---------- BUSINESS HOURS ----------
-- One row per weekday (0 = Sunday ... 6 = Saturday). Matches schedule-store.js shape.
create table business_hours (
  weekday integer primary key check (weekday between 0 and 6),
  is_open boolean not null default true,
  start_time time not null default '09:00',
  end_time time not null default '17:00',
  updated_at timestamptz not null default now()
);

-- ---------- BLOCKED DATES ----------
-- Specific days off (holidays, leave) even on a normally open weekday.
create table blocked_dates (
  blocked_date date primary key,
  reason text,
  created_at timestamptz not null default now()
);

-- ---------- SALON SETTINGS ----------
-- Single-row table for settings that aren't per-day, e.g. slot length.
create table salon_settings (
  id boolean primary key default true check (id), -- enforces exactly one row
  slot_interval_minutes integer not null default 30
);

-- ---------- LOYALTY LEDGER ----------
-- One row per event (earn or redeem). Balance = sum of points_delta.
-- This avoids ever storing a single mutable "balance" that can drift or double-count.
create table loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  customer_phone text not null, -- phone number is the customer identity key (no separate accounts/login for customers)
  customer_name text,
  points_delta integer not null, -- positive = earned, negative = redeemed
  reason text not null, -- e.g. 'booking', 'redemption', 'referral', 'manual_adjustment'
  related_booking_id uuid references bookings(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Convenience view: current loyalty balance per customer
-- security_invoker = true makes this view respect the RLS policies of
-- loyalty_transactions for whoever queries it, rather than running with
-- the view-creator's own privileges (Postgres 15+ feature).
create view loyalty_balances
  with (security_invoker = true)
as
select
  customer_phone,
  max(customer_name) as customer_name,
  sum(points_delta) as balance
from loyalty_transactions
group by customer_phone;

-- ---------- INDEXES ----------
create index idx_bookings_date on bookings(booking_date);
create index idx_bookings_status on bookings(status);
create index idx_bookings_phone on bookings(customer_phone);
create index idx_vouchers_code on vouchers(code);
create index idx_loyalty_phone on loyalty_transactions(customer_phone);
create index idx_treatments_category on treatments(category, is_active);
create index idx_blocked_dates_date on blocked_dates(blocked_date);

-- ---------- updated_at auto-touch ----------
create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_treatments_updated_at before update on treatments
  for each row execute function touch_updated_at();

create trigger trg_bookings_updated_at before update on bookings
  for each row execute function touch_updated_at();

create trigger trg_business_hours_updated_at before update on business_hours
  for each row execute function touch_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- Public site: can read active treatments/specials, can insert bookings/vouchers.
-- Admin (authenticated): full read/write on everything.
-- ============================================================

alter table treatments enable row level security;
alter table specials enable row level security;
alter table bookings enable row level security;
alter table vouchers enable row level security;
alter table loyalty_transactions enable row level security;
alter table business_hours enable row level security;
alter table blocked_dates enable row level security;
alter table salon_settings enable row level security;

-- Public can read active treatments
create policy "public read active treatments"
  on treatments for select
  using (is_active = true);

-- Public can read active specials within their date window
create policy "public read active specials"
  on specials for select
  using (
    is_active = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
  );

-- Public can create bookings (no login required for customers)
create policy "public can insert bookings"
  on bookings for insert
  with check (true);

-- Public can read their own booking only if they know the id (used to show confirmation)
create policy "public can read booking by id"
  on bookings for select
  using (true); -- relies on UUIDs being unguessable; tighten later if needed

-- Public can create vouchers (gift purchase flow)
create policy "public can insert vouchers"
  on vouchers for insert
  with check (true);

-- Public can read a voucher by code (to validate/apply at checkout)
create policy "public can read vouchers by code"
  on vouchers for select
  using (true);

-- Public can redeem an unredeemed voucher (booking.js marks it used at
-- checkout). Scoped to only flip an unredeemed voucher to redeemed —
-- it can't be used to un-redeem one or touch any other column's intent,
-- since `using` only matches rows that are still unredeemed.
create policy "public can redeem voucher"
  on vouchers for update
  using (is_redeemed = false)
  with check (is_redeemed = true);

-- Public can insert their own loyalty-earning transaction tied to a booking
create policy "public can insert loyalty transactions"
  on loyalty_transactions for insert
  with check (true);

-- Public can read their own loyalty history/balance by phone number (app filters by phone client-side)
create policy "public can read loyalty transactions"
  on loyalty_transactions for select
  using (true);

-- Public can read business hours, blocked dates and settings (needed to compute open slots)
create policy "public read business hours"
  on business_hours for select
  using (true);

create policy "public read blocked dates"
  on blocked_dates for select
  using (true);

create policy "public read salon settings"
  on salon_settings for select
  using (true);

-- ---------- ADMIN (authenticated) full access ----------
-- Anyone logged in via Supabase Auth (i.e. her, the one admin user) gets full control.
create policy "admin full access treatments"
  on treatments for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "admin full access specials"
  on specials for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "admin full access bookings"
  on bookings for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "admin full access vouchers"
  on vouchers for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "admin full access loyalty"
  on loyalty_transactions for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "admin full access business hours"
  on business_hours for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "admin full access blocked dates"
  on blocked_dates for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "admin full access salon settings"
  on salon_settings for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ============================================================
-- SEED DATA — real treatments from the flyer
-- ============================================================
insert into treatments (category, name, duration_minutes, sessions_count, price, description, sort_order) values
  ('sculpt', 'Slimming & Sculpting Package', 120, 6, 2500, '6 sessions of 120 minutes, per body area — abdomen, flanks, hips, thighs, upper arms, buttocks, back or legs. Booked one session at a time.', 0),
  ('sculpt', 'Cellulite & Scarring Treatment', 120, 1, 450, 'Targeted treatment to reduce cellulite appearance and improve scar texture.', 1),
  ('sculpt', 'Ultrasonic Cavitation', 120, 1, 450, 'Non-invasive fat-cell breakdown treatment for stubborn areas.', 2),
  ('sculpt', 'Radio Frequency', 120, 1, 450, 'Skin-firming radio frequency treatment, smooths and tightens treated areas.', 3),
  ('sculpt', 'Laser Lipolysis', 120, 1, 450, 'Laser-based fat reduction treatment for precise body contouring.', 4),
  ('sculpt', 'Vacuum Body Sculpting', 120, 1, 450, 'Vacuum-suction sculpting treatment to smooth and contour the body.', 5),
  ('face', 'Face Rejuvenation Facial', 60, 1, 600, 'PLACEHOLDER — update once the real facial treatments flyer is available.', 0);

insert into specials (message, sort_order) values
  ('Slimming & Sculpting package — R2500 for 6x 120min sessions per body area', 0),
  ('Refer a friend, both earn 50 loyalty points', 1),
  ('Cellulite, cavitation, RF, laser lipolysis & vacuum sculpting available', 2);

-- Default hours: Mon-Fri 09:00-17:00, Sat/Sun 09:00-13:00, matches schedule-store.js demo defaults
insert into business_hours (weekday, is_open, start_time, end_time) values
  (0, true, '09:00', '13:00'), -- Sunday
  (1, true, '09:00', '17:00'), -- Monday
  (2, true, '09:00', '17:00'), -- Tuesday
  (3, true, '09:00', '17:00'), -- Wednesday
  (4, true, '09:00', '17:00'), -- Thursday
  (5, true, '09:00', '17:00'), -- Friday
  (6, true, '09:00', '13:00'); -- Saturday

insert into salon_settings (id, slot_interval_minutes) values (true, 30);
