// ============================================
// SUPABASE CLIENT
// ------------------------------------------------
// One shared client instance, built from the project URL
// and anon (public) key. The anon key is safe to ship in
// frontend code — it's restricted by Row Level Security
// policies on the database side (see supabase/schema.sql).
//
// Loaded via CDN script tag in index.html / admin.html
// BEFORE this file:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
// ============================================

const SUPABASE_URL = "https://xnikxgqinuybeaigmeze.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuaWt4Z3FpbnV5YmVhaWdtZXplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNjkwODQsImV4cCI6MjA5Nzg0NTA4NH0.kIlQ-K19y1hR7GrqQ7HZttswMNcQJz1Zs61KY90P-dk";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Small shared helper: log + swallow Supabase errors consistently,
// so every store function can do `const { data, error } = await ...;
// if (error) return handleSbError(error, fallbackValue);`
function handleSbError(error, fallback) {
  console.error("Supabase error:", error.message || error);
  return fallback;
}
