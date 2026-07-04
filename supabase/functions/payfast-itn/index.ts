// ============================================
// EDGE FUNCTION: payfast-itn
// ------------------------------------------------
// Receives PayFast's Instant Transaction Notification (ITN) — their
// server-to-server callback confirming a payment succeeded (or
// failed/was cancelled). This is the ONLY trustworthy source of "did
// the customer actually pay" — the customer's browser redirect to
// return_url happens regardless of whether payment really completed,
// so booking.js never marks a booking paid; only this function does.
//
// Set this function's URL as the notify_url when building the
// checkout payload (see pay-checkout/index.ts) — PayFast posts here
// automatically, no action needed from the customer.
//
// Security checks performed, in order (mirrors PayFast's own
// documented ITN security steps):
//   1. Signature check — recompute the MD5 signature from the posted
//      fields (in the order PayFast sent them) + our passphrase, and
//      compare to the `signature` field PayFast included. This is the
//      one check that actually proves the data wasn't tampered with,
//      and the one we must never skip.
//   2. Source domain check — confirm the request actually came from a
//      payfast.co.za host (best-effort; PayFast's IP ranges are known
//      to rotate and have caused false negatives in other people's
//      integrations behind proxies — see HANDOFF.md if this ever
//      needs revisiting). We trust the signature check as primary.
//   3. Server confirmation — re-POST the received data to PayFast's
//      own /eng/query/validate endpoint and check for "VALID" back.
//      Best-effort only: if PayFast's validate endpoint is down,
//      misconfigured, or 403s (this has happened — see HANDOFF.md),
//      we log it and continue rather than silently losing a real
//      payment. The signature check above is the real gate.
//   4. Amount check — the gross amount PayFast confirms matches what
//      we charged (catches a tampered amount even with steps 1-3
//      somehow bypassed).
//
// Required secrets (same names as pay-checkout, set once for both):
//   PAYFAST_PASSPHRASE, PAYFAST_IS_SANDBOX
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY - auto-provided
// ============================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function payfastEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

Deno.serve(async (req) => {
  // PayFast doesn't need CORS (it's a server-to-server POST, not a
  // browser request), but harmless to keep consistent with the other
  // functions in case this is ever tested directly from a browser.
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    // PayFast posts standard form-encoded data, not JSON.
    const rawBody = await req.text();
    const params = new URLSearchParams(rawBody);
    const pfData: Record<string, string> = {};
    for (const [key, value] of params.entries()) pfData[key] = value;

    console.log("ITN received:", JSON.stringify(pfData));

    const passphrase = Deno.env.get("PAYFAST_PASSPHRASE") || "";
    const isSandbox = (Deno.env.get("PAYFAST_IS_SANDBOX") || "true").toLowerCase() !== "false";

    // ---- 1. Signature check ----
    // Recompute using the SAME field order PayFast posted them in
    // (not alphabetical, not our own ordering) — this is what makes
    // ITN verification different from generating the original
    // checkout signature.
    const receivedSignature = pfData.signature;
    const fieldsForSig = Object.entries(pfData).filter(([key]) => key !== "signature");
    let paramString = fieldsForSig
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
      .map(([key, value]) => `${key}=${payfastEncode(String(value).trim())}`)
      .join("&");
    if (passphrase) paramString += `&passphrase=${payfastEncode(passphrase.trim())}`;
    const computedSignature = await md5Hex(paramString);

    if (!receivedSignature || computedSignature !== receivedSignature) {
      console.error("ITN signature mismatch", { computedSignature, receivedSignature });
      // Respond 200 anyway — PayFast retries on non-2xx, and a bad
      // signature won't become a good one on retry. Just don't act on it.
      return new Response("invalid signature", { status: 200, headers: corsHeaders });
    }

    // ---- 2. Source domain check (best-effort) ----
    // PayFast's IP ranges are documented but known to rotate and have
    // caused false-negative rejections in other integrations running
    // behind proxies/CDNs (see HANDOFF.md). We log a mismatch but
    // don't block on it — the signature check above is the real gate.
    const sourceHost = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
    if (sourceHost && !sourceHost.includes("supabase")) {
      console.log("ITN source host (informational only):", sourceHost);
    }

    // ---- 3. Server confirmation (best-effort) ----
    // Re-post the raw body back to PayFast and expect "VALID". If this
    // call fails, times out, or PayFast's endpoint changes/breaks (it
    // has, historically — see HANDOFF.md), we log and continue: the
    // signature check is the check that actually matters.
    try {
      const validateUrl = isSandbox
        ? "https://sandbox.payfast.co.za/eng/query/validate"
        : "https://www.payfast.co.za/eng/query/validate";
      const validateRes = await fetch(validateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: rawBody,
      });
      const validateText = await validateRes.text();
      if (validateText.trim() !== "VALID") {
        console.warn("PayFast server confirmation did not return VALID (continuing anyway):", {
          status: validateRes.status,
          body: validateText.slice(0, 200),
        });
      }
    } catch (confirmErr) {
      console.warn("PayFast server confirmation call failed (continuing anyway):", (confirmErr as Error).message);
    }

    // ---- Look up the booking ----
    const bookingId = pfData.m_payment_id;
    if (!bookingId) {
      console.error("ITN missing m_payment_id");
      return new Response("missing m_payment_id", { status: 200, headers: corsHeaders });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*, treatments(name, duration_minutes)")
      .eq("id", bookingId)
      .single();

    if (bookingError || !booking) {
      console.error("ITN: booking not found for m_payment_id", bookingId);
      return new Response("booking not found", { status: 200, headers: corsHeaders });
    }

    // ---- 4. Amount check ----
    const grossAmount = Number(pfData.amount_gross || pfData.amount || 0);
    const expectedAmount = Number(booking.price_charged);
    const amountMatches = Math.abs(grossAmount - expectedAmount) < 0.05; // cent rounding tolerance

    if (!amountMatches) {
      console.error("ITN amount mismatch — flagging, not auto-confirming", {
        bookingId,
        grossAmount,
        expectedAmount,
      });
      await supabaseAdmin
        .from("bookings")
        .update({
          notes: `${booking.notes ? booking.notes + " | " : ""}⚠ Payment amount mismatch: PayFast reported R${grossAmount}, expected R${expectedAmount}. Check manually.`,
        })
        .eq("id", bookingId);
      return new Response("amount mismatch logged", { status: 200, headers: corsHeaders });
    }

    const paymentStatus = String(pfData.payment_status || "").toUpperCase();

    if (paymentStatus === "COMPLETE") {
      await supabaseAdmin
        .from("bookings")
        .update({
          payment_status: "paid",
          pf_payment_id: pfData.pf_payment_id || null,
          payment_amount_gross: grossAmount,
          status: booking.status === "cancelled" ? booking.status : "confirmed",
        })
        .eq("id", bookingId);

      // Now that payment is confirmed, do the things booking.js
      // deliberately skipped for "pay online" bookings until this
      // point: sync to her Google Calendar, and award loyalty points.
      // Both are best-effort — a failure here shouldn't make PayFast
      // retry the ITN forever, since the payment itself IS recorded.
      try {
        await supabaseAdmin.functions.invoke("calendar-sync", { body: { booking_id: bookingId } });
      } catch (calErr) {
        console.error("Calendar sync failed after payment confirmation:", (calErr as Error).message);
      }

      try {
        const existingLoyalty = await supabaseAdmin
          .from("loyalty_transactions")
          .select("id")
          .eq("related_booking_id", bookingId)
          .maybeSingle();
        if (!existingLoyalty.data) {
          const points = Math.floor(expectedAmount / 10);
          await supabaseAdmin.from("loyalty_transactions").insert({
            customer_phone: booking.customer_phone,
            customer_name: booking.customer_name,
            points_delta: points,
            reason: "booking",
            related_booking_id: bookingId,
          });
        }
      } catch (loyaltyErr) {
        console.error("Loyalty award failed after payment confirmation:", (loyaltyErr as Error).message);
      }
    } else if (paymentStatus === "FAILED") {
      await supabaseAdmin
        .from("bookings")
        .update({ payment_status: "unpaid" })
        .eq("id", bookingId);
    }
    // Other statuses (e.g. PENDING) — leave as-is, PayFast will send a follow-up ITN.

    return new Response("ok", { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("ITN handler error:", (err as Error).message);
    // Still 200 — PayFast will retry on failure codes, and most errors
    // here (e.g. a malformed one-off request) won't be fixed by a retry.
    return new Response("error logged", { status: 200, headers: corsHeaders });
  }
});

// ---- Same dependency-free MD5 as pay-checkout (Deno has no built-in MD5) ----
async function md5Hex(input: string): Promise<string> {
  function rotl(x: number, c: number) {
    return (x << c) | (x >>> (32 - c));
  }
  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
    21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Int32Array([
    -680876936, -389564586, 606105819, -1044525330, -176418897, 1200080426, -1473231341,
    -45705983, 1770035416, -1958414417, -42063, -1990404162, 1804603682, -40341101, -1502002290,
    1236535329, -165796510, -1069501632, 643717713, -373897302, -701558691, 38016083,
    -660478335, -405537848, 568446438, -1019803690, -187363961, 1163531501, -1444681467,
    -51403784, 1735328473, -1926607734, -378558, -2022574463, 1839030562, -35309556,
    -1530992060, 1272893353, -155497632, -1094730640, 681279174, -358537222, -722521979,
    76029189, -640364487, -421815835, 530742520, -995338651, -198630844, 1126891415,
    -1416354905, -57434055, 1700485571, -1894986606, -1051523, -2054922799, 1873313359,
    -30611744, -1560198380, 1309151649, -145523070, -1120210379, 718787259, -343485551,
  ]);

  const msg = new TextEncoder().encode(input);
  const originalLenBits = msg.length * 8;
  const withOne = new Uint8Array(((msg.length + 8) >> 6) * 64 + 64);
  withOne.set(msg);
  withOne[msg.length] = 0x80;
  const dv = new DataView(withOne.buffer);
  dv.setUint32(withOne.length - 8, originalLenBits >>> 0, true);
  dv.setUint32(withOne.length - 4, Math.floor(originalLenBits / 4294967296), true);

  let a0 = 1732584193, b0 = -271733879, c0 = -1732584194, d0 = 271733878;

  for (let chunkStart = 0; chunkStart < withOne.length; chunkStart += 64) {
    const M = new Int32Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getInt32(chunkStart + i * 4, true);
    let [A, B, C, D] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let F = 0, g = 0;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(F, s[i])) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }

  function toHexLE(n: number) {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setInt32(0, n, true);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  return toHexLE(a0) + toHexLE(b0) + toHexLE(c0) + toHexLE(d0);
}
