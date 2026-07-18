import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { insertSighting, type NewSighting, type Sighting } from "../lib/sightings";

export type { Sighting, NewSighting, SightingKind } from "../lib/sightings";

export type SyncStatus = "off" | "connecting" | "live" | "error";

/** Live clan sightings: seeds with the recent rows, then streams inserts over
 *  Supabase realtime so every running app sees new shares instantly. */
export function useSightings(limit = 50) {
  const [items, setItems] = useState<Sighting[]>([]);
  const [status, setStatus] = useState<SyncStatus>(supabase ? "connecting" : "off");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    let active = true;

    sb.from("sightings")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error("[clan] fetch", error);
          setError(error.message);
          setStatus("error");
        } else if (data) {
          setItems(data as Sighting[]);
        }
      });

    const channel = sb
      .channel("sightings")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sightings" },
        (payload) => setItems((cur) => [payload.new as Sighting, ...cur].slice(0, limit)),
      )
      .subscribe((s, err) => {
        setStatus(s === "SUBSCRIBED" ? "live" : s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? "error" : "connecting");
        if (err) {
          console.error("[clan] realtime", s, err);
          setError(err.message ?? String(err));
        }
      });

    return () => {
      active = false;
      sb.removeChannel(channel);
    };
  }, [limit]);

  const share = useCallback((s: NewSighting) => insertSighting(s), []);

  return { items, status, error, share };
}
