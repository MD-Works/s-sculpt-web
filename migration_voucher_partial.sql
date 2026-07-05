-- ============================================================
-- S SCULPT — Voucher partial redemption migration
-- Run in Supabase SQL Editor (Project > SQL Editor > New query)
-- Safe to run on the existing live database.
-- ============================================================

-- Add balance_remaining column to vouchers.
-- Starts as null (meaning "full amount still available").
-- Once a voucher is first used, this is set to whatever is left
-- after the booking is paid. If zero, is_redeemed flips to true.
alter table vouchers
  add column if not exists balance_remaining numeric(10,2),
  add column if not exists amount_used numeric(10,2); -- tracks how much was taken on last redemption, useful for the admin view

-- Update the public redemption RLS policy to also allow
-- updating balance_remaining and amount_used (not just is_redeemed).
-- Drop the old narrow policy and replace it with one that allows
-- the partial-redemption fields too.
drop policy if exists "public can redeem voucher" on vouchers;

create policy "public can redeem voucher"
  on vouchers for update
  using (is_redeemed = false)
  with check (true); -- booking.js controls what gets written; RLS just gates on "must be unredeemed to start with"

-- Add voucher_discount to bookings so the admin can always see how much was saved
alter table bookings
  add column if not exists voucher_discount numeric(10,2);
