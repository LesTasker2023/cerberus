import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Shared clan sync backend. The anon key is public by design — access is
// governed by Row Level Security on the Supabase side, not by hiding the key.
// If the env vars are absent the client is null and sync features no-op.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, { realtime: { params: { eventsPerSecond: 5 } } })
    : null;

/** Whether clan sync is configured (env vars present). */
export const supabaseReady = supabase !== null;
