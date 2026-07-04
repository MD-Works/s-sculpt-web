// ============================================
// EDGE FUNCTION: pay-checkout
// ------------------------------------------------
// Builds a signed PayFast checkout payload for an existing booking.
// The booking must already exist in Supabase (booking.js saves it
// first, as "pending"/"unpaid", THEN calls this function) so nothing
// is lost if the customer abandons checkout on PayFast's side.
//
// Returns { action_url, fields } — booking.js builds a real <form>
// from `fields` and submits it, which redirects the browser to
// PayFast's hosted payment page. We don't redirect from here directly
// since Edge Functions are called via fetch/invoke, not navigation.
//
// Why this needs to be a server-side function at all, rather than
// just signing in the browser: the PayFast PASSPHRASE is a secret —
// it must never reach client-side code. merchant_id/merchant_key are
// not secret (PayFast's own checkout form ships them as plain hidden
// fields) but the passphrase salts the signature and has to stay
// server-side, same reasoning as any API secret.
//
// Required secrets (set via `supabase secrets set`, same pattern as
// calendar-sync — see HANDOFF.md):
//   PAYFAST_MERCHANT_ID   - sandbox: 10000100 (PayFast's public test value)
//   PAYFAST_MERCHANT_KEY  - sandbox: 46f0cd694581a (PayFast's public test value)
//   PAYFAST_PASSPHRASE    - sandbox: jt7NOE43FZPn (PayFast's public test value)
//   PAYFAST_IS_SANDBOX    - "true" while testing, "false" once live
//   SITE_URL              - the public site's base URL, used to build
//                           return_url / cancel_url / notify_url
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY - auto-provided
//
// IMPORTANT — signature field order: PayFast's checkout-form signature
// uses the order fields are listed in their documentation (merchant
// details, then buyer details, then transaction details), NOT
// alphabetical order. This is a different, easily-confused scheme from
// their separate Custom/Subscriptions API signature, which IS
// alphabetical — don't borrow that logic here.
// ============================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Matches Python's urllib.parse.quote_plus exactly (which is what PayFast's
// own working examples use): encodeURIComponent() leaves !'()* unescaped,
// but quote_plus escapes them — a mismatch here breaks the signature.
function payfastEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

function buildSignature(fieldsInOrder: [string, string][], passphrase: string): string {
  const parts = fieldsInOrder
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(([key, value]) => `${key}=${payfastEncode(String(value).trim())}`);

  let paramString = parts.join("&");
  if (passphrase) {
    paramString += `&passphrase=${payfastEncode(passphrase.trim())}`;
  }

  // MD5 via Web Crypto isn't built in (MD5 isn't in SubtleCrypto), so we
  // use a small dependency-free MD5 implementation. PayFast requires MD5
  // specifically — this isn't a choice we get to make.
  return md5Hex(paramString);
}

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { booking_id } = await req.json();
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id is required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*, treatments(name)")
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    const merchantId = Deno.env.get("PAYFAST_MERCHANT_ID")!;
    const merchantKey = Deno.env.get("PAYFAST_MERCHANT_KEY")!;
    const passphrase = Deno.env.get("PAYFAST_PASSPHRASE") || "";
    const isSandbox = (Deno.env.get("PAYFAST_IS_SANDBOX") || "true").toLowerCase() !== "false";
    const siteUrl = (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");

    if (!merchantId || !merchantKey) {
      return new Response(JSON.stringify({ error: "PayFast secrets not configured" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Use the booking's own id as PayFast's m_payment_id — simplest
    // possible unique reference, and means the ITN webhook can find the
    // booking again without us needing a separate lookup table.
    const amount = Number(booking.price_charged).toFixed(2);
    const itemName = `${booking.treatments?.name || "Treatment"} booking`;

    const nameParts = String(booking.customer_name || "").trim().split(/\s+/);
    const nameFirst = nameParts[0] || "Customer";
    const nameLast = nameParts.slice(1).join(" ") || "";

    // Order matters here — this is the literal field order PayFast's
    // checkout-form signature expects. Don't alphabetise this list.
    const orderedFields: [string, string][] = [
      ["merchant_id", merchantId],
      ["merchant_key", merchantKey],
      ["return_url", `${siteUrl}/index.html?payment=success&booking_id=${booking.id}`],
      ["cancel_url", `${siteUrl}/index.html?payment=cancelled&booking_id=${booking.id}`],
      ["notify_url", `${Deno.env.get("SUPABASE_URL")}/functions/v1/payfast-itn`],
      ["name_first", nameFirst],
      ["name_last", nameLast],
      ["email_address", booking.customer_email || ""],
      ["m_payment_id", booking.id],
      ["amount", amount],
      ["item_name", itemName],
    ];

    const signature = buildSignature(orderedFields, passphrase);

    // Store our own reference on the booking now, before redirecting —
    // lets the admin console show "awaiting payment" even if the ITN
    // is delayed or the customer never completes checkout.
    await supabaseAdmin
      .from("bookings")
      .update({ payment_reference: booking.id })
      .eq("id", booking.id);

    const fields: Record<string, string> = {};
    orderedFields.forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        fields[key] = String(value).trim();
      }
    });
    fields.signature = signature;

    const actionUrl = isSandbox
      ? "https://sandbox.payfast.co.za/eng/process"
      : "https://www.payfast.co.za/eng/process";

    return new Response(JSON.stringify({ action_url: actionUrl, fields }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});

// ---- Minimal dependency-free MD5 (PayFast requires MD5 specifically) ----
function md5Hex(input: string): string {
  function rotl(x: number, c: number) {
    return (x << c) | (x >>> (32 - c));
  }
  function toBytesUtf8(str: string) {
    return new TextEncoder().encode(str);
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

  const msg = toBytesUtf8(input);
  const originalLenBits = msg.length * 8;
  let withOne = new Uint8Array(((msg.length + 8) >> 6) * 64 + 64);
  withOne.set(msg);
  withOne[msg.length] = 0x80;
  const dv = new DataView(withOne.buffer);
  dv.setUint32(withOne.length - 8, originalLenBits >>> 0, true);
  dv.setUint32(withOne.length - 4, Math.floor(originalLenBits / 4294967296), true);

  let a0 = 1732584193, b0 = -271733879, c0 = -1732584194, d0 = 271733878;

  for (let chunkStart = 0; chunkStart < withOne.length; chunkStart += 64) {
    const M = new Int32Array(16);
    for (let i = 0; i < 16; i++) {
      M[i] = dv.getInt32(chunkStart + i * 4, true);
    }
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
