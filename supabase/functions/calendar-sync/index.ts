// ============================================
// EDGE FUNCTION: calendar-sync
// ------------------------------------------------
// Creates a Google Calendar event for a confirmed booking, using
// a Google service account (server-to-server auth — no OAuth
// consent screen, no per-user login). Her real calendar must be
// SHARED with the service account's email first (Google Calendar
// → Settings → [her calendar] → Share with specific people →
// add the service account email → "Make changes to events").
//
// Called from booking.js right after a booking is saved:
//   await sb.functions.invoke('calendar-sync', { body: { booking_id } })
//
// Required secrets (set via `supabase secrets set`, see HANDOFF.md):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL   - from the service account JSON ("client_email")
//   GOOGLE_SERVICE_ACCOUNT_KEY     - from the service account JSON ("private_key"), with
//                                    literal \n line breaks kept as \n (don't unescape)
//   GOOGLE_CALENDAR_ID             - her calendar's ID (her Gmail address works for
//                                    the primary calendar, or a calendar ID from
//                                    Calendar settings for a secondary calendar)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY - auto-provided by Supabase, used here
//                                    to read the booking and write the event id back
//                                    with full access (bypassing RLS, safely, since
//                                    this only runs server-side).
// ============================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---- Minimal JWT signing for Google's OAuth2 service-account flow ----
// (No external Google SDK needed — Deno's built-in crypto handles RS256.)
async function getGoogleAccessToken() {
  const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  let rawKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
  if (!email || !rawKey) throw new Error("Missing Google service account secrets");

  // Handles the key arriving in any of these forms, since different paste/
  // file-export paths produce different results:
  //   - literal backslash-n sequences (\n as two characters)
  //   - already-real newlines
  //   - wrapped in an extra pair of quotes
  rawKey = rawKey.trim();
  if (rawKey.startsWith('"') && rawKey.endsWith('"')) {
    rawKey = rawKey.slice(1, -1);
  }
  const privateKeyPem = rawKey.replace(/\\n/g, "\n");
  const pemBody = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  console.log("Parsed PEM body length:", pemBody.length, "first 12 chars:", pemBody.slice(0, 12));

  let keyBytes;
  try {
    keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  } catch (e) {
    throw new Error(`Failed to base64-decode private key (length ${pemBody.length}): ${e.message}`);
  }

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const base64url = (obj) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const toSign = `${base64url(header)}.${base64url(claims)}`;

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(toSign)
  );
  const sigBase64url = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const assertion = `${toSign}.${sigBase64url}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`Google token exchange failed: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { booking_id, action } = await req.json();
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id is required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*, treatments(name, duration_minutes)")
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    const calendarId = Deno.env.get("GOOGLE_CALENDAR_ID");
    const accessToken = await getGoogleAccessToken();

    // Cancellation: delete the existing calendar event, if one exists.
    if (action === "cancel") {
      if (booking.google_calendar_event_id) {
        await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${booking.google_calendar_event_id}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
        );
        await supabaseAdmin.from("bookings").update({ google_calendar_event_id: null }).eq("id", booking_id);
      }
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    // Build the event. booking_time is "HH:MM:SS"; booking_date is "YYYY-MM-DD".
    const durationMinutes = booking.treatments?.duration_minutes || 60;
    const startDateTime = `${booking.booking_date}T${booking.booking_time}`;
    const startDate = new Date(`${startDateTime}+02:00`); // SAST, fixed UTC+2 offset
    const endDate = new Date(startDate.getTime() + durationMinutes * 60000);

    const eventBody = {
      summary: `${booking.treatments?.name || "Treatment"} — ${booking.customer_name}`,
      description: `Phone: ${booking.customer_phone}${booking.notes ? `\nNotes: ${booking.notes}` : ""}`,
      start: { dateTime: startDate.toISOString(), timeZone: "Africa/Johannesburg" },
      end: { dateTime: endDate.toISOString(), timeZone: "Africa/Johannesburg" },
    };

    const isUpdate = !!booking.google_calendar_event_id;
    const url = isUpdate
      ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${booking.google_calendar_event_id}`
      : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

    const gcalRes = await fetch(url, {
      method: isUpdate ? "PUT" : "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(eventBody),
    });
    const gcalData = await gcalRes.json();

    if (!gcalRes.ok) {
      return new Response(JSON.stringify({ error: "Google Calendar error", detail: gcalData }), {
        status: 502,
        headers: corsHeaders,
      });
    }

    await supabaseAdmin.from("bookings").update({ google_calendar_event_id: gcalData.id }).eq("id", booking_id);

    return new Response(JSON.stringify({ success: true, event_id: gcalData.id }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
