import { supabase } from "./supabase";

export type SightingKind = "loot" | "location" | "waypoint";

/** A shared clan sighting — a loot drop, a location, or a waypoint. */
export interface Sighting {
  id: string;
  kind: SightingKind;
  name: string;
  x: number | null;
  y: number | null;
  z: number | null;
  value: number | null;
  pilot: string | null;
  created_at: string;
}

export type NewSighting = Omit<Sighting, "id" | "created_at">;

/** Post a sighting to the shared clan feed. No-ops if sync isn't configured. */
export async function insertSighting(s: NewSighting): Promise<void> {
  const sb = supabase;
  if (!sb) return;
  const { error } = await sb.from("sightings").insert(s);
  if (error) {
    console.error("[clan] sighting insert", error);
    throw error;
  }
}
