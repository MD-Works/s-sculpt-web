# S Sculpt — Project Handoff

Pick this up in a new chat by uploading the project zip and this file, and saying "continue the S Sculpt build."

---

## 1. What this project is

A website for **S Sculpt** — a slimming, body sculpting & face rejuvenation salon in **Kempton Park, Gauteng, South Africa** (MD Works client, sister's business).

Full feature set: browse treatments, book online with real availability, earn loyalty points, buy/redeem gift vouchers, WhatsApp contact, bookings sync to a real Google Calendar, admin console to manage treatments/specials/hours/bookings.

---

## 2. Current status (end of this session)

✅ **Supabase backend + Google Calendar sync working end-to-end (confirmed in a prior session).**
🟡 **PayFast integration: code fully written this session, NOT yet deployed or tested — pick up here next.**

### Backend + Calendar sync (from previous sessions, unchanged)
- Supabase project live (`xnikxgqinuybeaigmeze`), schema run, URL/anon key wired into `js/supabase-client.js`.
- All data layers call Supabase directly. Real Supabase Auth for admin.
- Google Calendar sync (`supabase/functions/calendar-sync`) deployed and confirmed working against a real test booking. Still using the user's own calendar (`dam69mad@gmail.com`), migrate to sister's later — no code change needed, just re-share + update the `GOOGLE_CALENDAR_ID` secret.

### This session: PayFast integration — built, NOT deployed, NOT tested yet
User hasn't registered for PayFast yet (registering within ~1 week). To build without needing her personal/banking info, this session used **PayFast's publicly documented sandbox test credentials** (fixed values anyone can use, no registration needed):
- Merchant ID: `10000100`, Merchant Key: `46f0cd694581a`, Passphrase: `jt7NOE43FZPn`
- Sandbox checkout URL: `https://sandbox.payfast.co.za/eng/process`

**Decisions made this session:**

| Decision | Choice | Why |
|---|---|---|
| Booking-confirmation model | Pay-optional (not pay-to-confirm) | New to online payments — don't want a flaky webhook/abandoned checkout to silently lose a real customer's booking. Can tighten later. |
| Checkout style | Hosted redirect (not on-site iframe) | Simpler, no PCI burden, fine on mobile. |
| Payment controls | Global instore on/off + global minimum-amount-for-instore + per-treatment override (always/never/follow-global) | User explicitly asked for this — e.g. force the high-value 6x package to require online payment while small sessions stay flexible. |

**What was built (code complete, see Section 4 for files):**
- `supabase/schema.sql` updated + new `migration_payfast.sql` (run this migration on the LIVE db — schema.sql alone won't touch existing tables): adds `bookings.payment_reference/pf_payment_id/payment_amount_gross`, `treatments.allow_instore`, `salon_settings.instore_payment_enabled/min_amount_for_instore`.
- `supabase/functions/pay-checkout/index.ts` — NEW Edge Function. Takes a `booking_id`, builds a signed PayFast checkout payload server-side (passphrase never touches the browser), returns `{action_url, fields}` for booking.js to POST via a real `<form>` (browser navigation, not fetch).
- `supabase/functions/payfast-itn/index.ts` — NEW Edge Function, the ITN webhook. Verifies the MD5 signature (recomputed using PayFast's own field order from the POST, not alphabetical — this is a different scheme from their separate Custom/Subscriptions API signature, don't conflate them), does a best-effort server-confirmation call back to PayFast (logs but doesn't block if that endpoint is flaky — it has had outages historically), checks the amount matches, then marks the booking paid and only then fires calendar-sync + awards loyalty points (both were deliberately skipped at booking-save time for the online-pay path).
- Both functions include a dependency-free MD5 implementation (Deno has no built-in MD5) — verified against standard MD5 test vectors AND cross-checked byte-for-byte against a known-correct Python reference implementation using real booking-shaped test data. Both produced the identical signature. High confidence this part is correct.
- `js/config.js` — added `PAYFAST_CONFIG` (sandbox merchant_id/key, checkout URL; passphrase deliberately NOT here, server-side only).
- `js/schedule-store.js` — added `getPaymentSettings()`, `setPaymentSettings()`, and `isInstoreAllowed(settings, treatment, amount)` (the combining logic for global+per-treatment rules).
- `js/treatment-store.js` — added `allowInstore` (null/true/false) to the normalized shape + save function.
- `js/booking.js` — payment-method radios now render dynamically per treatment/amount via `isInstoreAllowed()`; submit handler branches: instore path unchanged (immediate confirm), online-pay path saves the booking as pending/unpaid FIRST, then calls `pay-checkout` and submits a real form to redirect to PayFast. Added a `handlePayfastReturn()` that reads `?payment=success|cancelled&booking_id=...` on page load (PayFast's return_url/cancel_url) and shows the right message — note this redirect is NOT the source of truth for payment status, only the ITN webhook is.
- `index.html` — payment-method section markup simplified to a container (`#payOptionsContainer`) that `booking.js` fills in dynamically, since the options now depend on the treatment/amount.

**NOT yet done (this is exactly where to pick up):**
- `admin.html` / `admin.js` — the actual settings UI (instore on/off toggle, minimum-amount input, per-treatment override dropdown in the treatment edit modal) has NOT been built yet. The backend/data-layer support for it exists (`schedule-store.js` functions, `treatment-store.js` field) but there's no UI to use them yet.
- Nothing has been deployed. `pay-checkout` and `payfast-itn` exist only as local files — need `supabase functions deploy pay-checkout` and `supabase functions deploy payfast-itn`.
- Secrets not set yet: `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE`, `PAYFAST_IS_SANDBOX` (set to "true" for now), `SITE_URL` (needed by pay-checkout to build return_url/cancel_url — use wherever the site is actually being served from during testing).
- `migration_payfast.sql` has NOT been run against the live database yet.
- No actual sandbox test payment has been attempted. The signature math is verified correct via cross-language testing, but the full live flow (real Edge Function deploy → real PayFast sandbox redirect → real ITN callback hitting the deployed function) has not been run even once. Treat this as unverified until a real sandbox booking is tested end-to-end.
- The `notify_url` passed to PayFast is built as `${SUPABASE_URL}/functions/v1/payfast-itn` inside `pay-checkout/index.ts` — should just work once deployed, but hasn't been confirmed in practice.

🔲 **Other pending items, unchanged from before (lower priority than finishing PayFast):**

- Facial treatments still placeholder data (R600, generic name) — real flyer never arrived.
- Uptime ping (UptimeRobot or similar) to stop the free Supabase project auto-pausing after 7 days idle.
- `.gitignore` for the Google service account JSON before any GitHub push.
- Confirm the voucher-redeem RLS policy migration is actually live on the database:
  ```sql
  create policy "public can redeem voucher"
    on vouchers for update
    using (is_redeemed = false)
    with check (is_redeemed = true);
  ```
- Eventually migrate the Google Calendar + Supabase project from the user's personal accounts to the sister's.
- Deploy the static site (Cloudflare Pages was the plan).

---

## 3. Decisions already made (don't re-litigate unless the user wants to)

| Decision | Choice | Why |
|---|---|---|
| Backend | Supabase (Postgres) | Relational data fits better than a document model |
| Supabase account | User's own for now, migrate to sister's later | Nothing in code is tied to account identity, only project URL/key |
| Loyalty model | Ledger table (`loyalty_transactions`), keyed by phone, no customer accounts | Avoids double-counting, gives real history |
| Voucher model | Real DB row + unique code, narrow public RLS update policy for redemption | One-time use, traceable, works without customer login |
| Admin identity | Single real Supabase Auth user (her) | Only one admin exists |
| Calendar sync | Google service account (server-to-server), Edge Function holds the secret | No OAuth consent screen; calendar just needs sharing once. **Confirmed working this session.** |
| Calendar account (temporary) | User's own Google Calendar (`dam69mad@gmail.com`), not the sister's yet | Same reasoning as Supabase account — swap later, no code change |
| Payment processor | **PayFast** (decided this session, was previously undecided) | Sister wants EFT, unhappy with her existing Yoco card machine's 2-day settlement; PayFast's Instant EFT matches what she actually wants. Her Yoco machine stays for in-person/card use — this is for online payments only. |
| Specials shape | Single `message` field, not title+description | Matches the actual ticker UI |
| Package treatment booking | The 6×120min package books one 120-min slot per visit, not all 6 at once | Matches how a real visit works |

---

## 4. Files that exist right now

```
index.html                                  — public site
admin.html                                  — admin console, real Supabase Auth login
css/style.css, css/admin.css                — design system (tokens below)
js/supabase-client.js                       — shared Supabase client (sb), URL/key live here
js/config.js                                — brand config + PAYFAST_CONFIG (sandbox merchant_id/key, NOT the passphrase)
js/treatment-store.js                       — treatments CRUD, shared by public site + admin, now incl. allowInstore
js/admin-store.js                           — specials CRUD only
js/schedule-store.js                        — business hours, blocked dates, bookings, getOpenSlots(), payment settings + isInstoreAllowed()
js/services.js                              — renders treatment cards/dropdown, exposes findTreatment()
js/booking.js                               — booking form, voucher validation, dynamic payment options, PayFast handoff + return handling, fires calendar-sync (instore path) / pay-checkout (online path)
js/vouchers.js                              — generates real voucher rows with unique codes
js/loyalty.js                               — phone-keyed balance lookup, real earn on booking
js/admin.js                                 — admin console logic, real Supabase Auth — PAYMENT SETTINGS UI NOT YET ADDED HERE
js/nav.js                                   — mobile nav toggle
supabase/schema.sql                         — full schema, RLS policies, seed data — run already (payment columns added to the FILE this session, but not yet re-run against the live db, see migration below)
migration_payfast.sql                       — NEW this session, lives at the project ROOT (not in supabase/) — run this against the LIVE database to add the payment columns without touching existing data
supabase/functions/calendar-sync/index.ts   — Edge Function, Google Calendar sync — DEPLOYED & WORKING
supabase/functions/pay-checkout/index.ts    — NEW Edge Function, builds signed PayFast checkout payload — NOT YET DEPLOYED
supabase/functions/payfast-itn/index.ts     — NEW Edge Function, PayFast ITN webhook — NOT YET DEPLOYED
```

**Script load order matters** (bottom of each HTML file): Supabase CDN script → `supabase-client.js` → `config.js` → `treatment-store.js` → other stores → page-specific scripts.

---

## 5. Real brand facts (confirmed from her actual flyer)

- **Business name:** S Sculpt
- **Location:** Palm Springs Shopping Centre, 30 Christoffel Street, van Riebeek Park, Kempton Park, Gauteng
- **Phone/WhatsApp:** 067 898 9347 (`27678989347` in code)
- **Email:** ssculpt71@gmail.com
- **Real promo offer:** R2500 for 6x 120-minute sessions per body area
- **Real treatment list (body):** Cellulite & scarring, Ultrasonic cavitation, Radio frequency, Laser lipolysis, Vacuum body sculpting
- **Facial treatments:** ⚠️ still unknown — only "R600.00 per session" seen. Ask again if continuing facial work.

### Design tokens (`css/style.css`)
```css
--clay-bg:      #F3ECE2;
--umber:        #2B1B12;
--terracotta:   #6B4226;
--sage:         #8A6D4E;
--amber:        #C9A24B;
--surface:      #FBF7F1;
--surface-line: #E5D9C8;
--success:      #6B8F5E;
--brand-brown:  #3D2B1F;
--brand-gold:   #C9A24B;
```
Fonts: **Fraunces** (display), **Inter** (body), **Space Mono** (prices/labels/ticker).

---

## 6. Database schema summary (`supabase/schema.sql`)

Tables: `treatments`, `specials`, `vouchers`, `bookings`, `business_hours`, `blocked_dates`, `salon_settings`, `loyalty_transactions` (+ `loyalty_balances` view, `security_invoker = true`).

Key relationships: `bookings.treatment_id` → `treatments.id`, `bookings.voucher_id` → `vouchers.id`, `vouchers.redeemed_booking_id` → `bookings.id` (circular FK), `loyalty_transactions.related_booking_id` → `bookings.id`, `customer_phone` is the identity key throughout.

RLS: public can insert bookings/vouchers/loyalty transactions, select active treatments/specials and all hours/blocked-dates/settings, and redeem (unredeemed→redeemed only) a voucher. Authenticated (her) gets full CRUD on everything.

**Payment columns:** added this session — see Section 2 for the full list (`bookings.payment_reference/pf_payment_id/payment_amount_gross`, `treatments.allow_instore`, `salon_settings.instore_payment_enabled/min_amount_for_instore`). Live in `schema.sql` for fresh installs; for the existing live database, run `migration_payfast.sql` (project root) instead.

---

## 7. Next steps, in order

1. **Build the admin settings UI** for the payment controls (data layer already exists, just needs UI):
   - In the "Hours" panel (or a new "Settings" panel) of `admin.html`: a toggle for `instore_payment_enabled` and a number input for `min_amount_for_instore`, wired to `ScheduleStore.getPaymentSettings()` / `setPaymentSettings()`.
   - In the treatment edit modal (`openTreatmentModal` in `js/admin.js`): a 3-way control (Follow global setting / Always allow instore / Never allow instore — i.e. null/true/false) for `allowInstore`, passed through to `TreatmentStore.saveTreatment()`.
2. **Deploy both new Edge Functions**: `supabase functions deploy pay-checkout` and `supabase functions deploy payfast-itn`.
3. **Set the PayFast secrets** (sandbox values for now): `PAYFAST_MERCHANT_ID=10000100`, `PAYFAST_MERCHANT_KEY=46f0cd694581a`, `PAYFAST_PASSPHRASE=jt7NOE43FZPn`, `PAYFAST_IS_SANDBOX=true`, `SITE_URL=<wherever the site is being served from for testing>`. Same `supabase secrets set` pattern as the Calendar sync secrets — see the PEM-mangling lesson above if any future secret involves a multi-line value, though none of these are multi-line so that specific issue shouldn't recur here.
4. **Run `migration_payfast.sql`** against the live Supabase database via the SQL Editor.
5. **Test the full sandbox flow end-to-end**, for the first time: make a real booking on the public site choosing "Pay online now," confirm it redirects to PayFast's sandbox, complete a test payment with the sandbox wallet, confirm the `payfast-itn` webhook fires, confirm the booking flips to `paid` in the database, confirm calendar-sync and loyalty points fire after that (not before). Check both functions' logs in the Supabase Dashboard if anything doesn't work as expected.
6. **Once she's registered with PayFast**: swap `PAYFAST_MERCHANT_ID` / `PAYFAST_MERCHANT_KEY` / `PAYFAST_PASSPHRASE` to her real live values and `PAYFAST_IS_SANDBOX=false` — no code changes needed, same pattern as every other secret swap in this project.
7. Confirm the voucher-redeem RLS policy is live on the actual database (see Section 2).
8. Set up an uptime ping for the Supabase project.
9. Add `.gitignore` for the Google service account JSON before any GitHub push.
10. Get the real facial treatments flyer, update via admin console (no code change needed).
11. Eventually migrate the Google Calendar and Supabase project from the user's personal accounts to the sister's.
12. Deploy the static site to Cloudflare Pages (or chosen host) — once deployed, update the `SITE_URL` secret to the real production URL.

GitHub/CI-CD for migrations was explicitly declined earlier (solo dev, infrequent changes, manual SQL Editor is fine) — don't suggest it again unless the user raises it.

---

## 8. Open questions for the user (ask early in the next session)

- Has PayFast registration happened yet, or still pending?
- What instore-payment rule does she actually want to start with — e.g. should the 6x120min package (R2500) require online payment while individual sessions (R450) stay flexible? Any specific minimum amount in mind, or leave instore unrestricted until she has a reason to change it?
- Where is the site currently reachable for testing (so `SITE_URL` can be set correctly for the PayFast redirect)? If nowhere yet, fine to use a placeholder/localhost for sandbox testing and revisit once deployed.
- Has the voucher-redeem RLS policy migration been confirmed live on the database?
- Has the `.gitignore` been added for the service account JSON?
- Do you have the real facial treatments flyer yet?
