import { supabase } from "./supabase";

/** A pilot's live location (one row per pilot). */
export interface ClanLocation {
  pilot_id: string;
  pilot: string | null;
  x: number;
  y: number;
  z: number;
  updated_at: string;
}

/** Upsert the caller's live position — one row per pilot, keyed on pilot_id. */
export async function upsertLocation(loc: {
  pilot_id: string;
  pilot: string;
  x: number;
  y: number;
  z: number;
}): Promise<void> {
  const sb = supabase;
  if (!sb) return;
  const { error } = await sb
    .from("locations")
    .upsert({ ...loc, updated_at: new Date().toISOString() }, { onConflict: "pilot_id" });
  if (error) console.error("[clan] location upsert", error);
}
